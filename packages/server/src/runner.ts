import { execFile, fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, sep } from "node:path";
import { compileProject, type Diagnostic, type Project } from "@open-sila/core";
import { Modules, unlinkModules } from "./modules.js";
import { RunLog, type RunEvent, type TraceMessage } from "./runs.js";

export type BotState = "stopped" | "starting" | "running" | "crashed";

export interface LogEntry {
  at: number;
  level: "info" | "error" | "system";
  message: string;
  nodeId?: string;
}

export interface BotStatus {
  state: BotState;
  startedAt: number | null;
  exitCode: number | null;
  port: number | null;
  logs: LogEntry[];
}

export type RunnerEvent =
  | { type: "status"; projectId: string; state: BotState }
  | { type: "log"; projectId: string; entry: LogEntry }
  | { type: "trace"; projectId: string; nodeId: string; at: number }
  | (RunEvent & { projectId: string });

export class BuildError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics.find((item) => item.level === "error")?.message ?? "The project has errors.");
  }
}

interface Bot {
  child?: ChildProcess;
  state: BotState;
  startedAt: number | null;
  exitCode: number | null;
  logs: LogEntry[];
  port?: number;
  restarts: number;
  retry?: NodeJS.Timeout;
}

const MAX_LOGS = 500;
const MAX_RESTARTS = 5;
const STABLE_AFTER = 60_000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("No free port"))));
    });
  });
}

function prisma(cli: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [cli, ...args], { cwd, env, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve();
      const detail = `${stderr}\n${stdout}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("Prisma schema loaded") && !line.startsWith("Datasource"))
        .slice(-6)
        .join(" ");
      reject(new BuildError([{ level: "error", message: `Database setup failed: ${detail || error.message}` }]));
    });
  });
}

export class Runner extends EventEmitter<{ event: [RunnerEvent] }> {
  private bots = new Map<string, Bot>();
  readonly runs = new RunLog();
  private readonly modules: Modules;

  constructor(private readonly dataDir: string) {
    super();
    this.modules = new Modules(dataDir);
  }

  status(projectId: string): BotStatus {
    const bot = this.bots.get(projectId);
    return {
      state: bot?.state ?? "stopped",
      startedAt: bot?.startedAt ?? null,
      exitCode: bot?.exitCode ?? null,
      port: bot?.child ? (bot.port ?? null) : null,
      logs: bot?.logs ?? [],
    };
  }

  running(): string[] {
    return [...this.bots.entries()]
      .filter(([, bot]) => bot.state === "running" || bot.state === "starting")
      .map(([id]) => id);
  }

  trigger(projectId: string, nodeId: string, payload: unknown): void {
    const child = this.bots.get(projectId)?.child;
    if (!child?.connected) throw new Error("Start the bot first, then press Run now.");
    child.send({ type: "manual", id: nodeId, payload });
  }

  async start(project: Project, secrets: Record<string, string>, restart = false): Promise<BotStatus> {
    const previous = this.bots.get(project.id);
    if (previous) {
      clearTimeout(previous.retry);
      if (!restart) previous.restarts = 0;
    }
    await this.stop(project.id);
    const result = compileProject(project, { mode: "development" });
    if (!result.ok) throw new BuildError(result.diagnostics);

    const missing = result.requirements.env.filter((name) => name.endsWith("_TOKEN") && !secrets[name]);
    if (missing.length > 0) {
      throw new BuildError([{ level: "error", message: `Add ${missing.join(", ")} in the project secrets first.` }]);
    }

    const root = join(this.dataDir, "builds", project.id);
    rmSync(join(root, "src"), { recursive: true, force: true });
    for (const file of result.files) {
      const target = join(root, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    const bot: Bot = this.bots.get(project.id) ?? { state: "stopped", startedAt: null, exitCode: null, logs: [], restarts: 0 };
    this.bots.set(project.id, bot);
    bot.exitCode = null;
    bot.startedAt = Date.now();
    this.setState(project.id, bot, "starting");
    this.log(project.id, bot, { at: Date.now(), level: "system", message: `Starting ${project.name}` });

    const manifest = JSON.parse(result.files.find((file) => file.path === "package.json")?.content ?? "{}") as { dependencies?: Record<string, string> };
    let packages: Record<string, string>;
    try {
      packages = await this.modules.ensure(manifest.dependencies ?? {}, (message) => this.log(project.id, bot, { at: Date.now(), level: "system", message }));
      this.modules.link(root, packages);
    } catch (error) {
      this.setState(project.id, bot, "crashed");
      throw new BuildError([{ level: "error", message: `Could not install the bot's packages: ${(error as Error).message.split("\n").slice(-3).join(" ")}` }]);
    }

    const webhooks = result.files.some((file) => file.path === "src/lib/http.js");
    bot.port = webhooks ? (secrets.PORT ? Number(secrets.PORT) : await freePort()) : undefined;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...secrets,
      ...(bot.port ? { PORT: String(bot.port) } : {}),
      STORE_FILE: join(this.dataDir, "data", project.id, "store.json"),
    };
    delete env.OPEN_SILA_KEY;

    const schema = result.files.find((file) => file.path === "prisma/schema.prisma");
    if (schema) {
      try {
        await this.prepareDatabase(project, root, schema.content, env, bot, join(packages.prisma, "build", "index.js"));
      } catch (error) {
        this.setState(project.id, bot, "crashed");
        throw error;
      }
    }

    const child = fork(join(root, "src", "index.js"), [], { cwd: root, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    bot.child = child;

    const pipe = (level: LogEntry["level"]) => (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.log(project.id, bot, { at: Date.now(), level, message: line });
        if (level === "info" && bot.state === "starting" && line.startsWith("Logged in as")) {
          this.setState(project.id, bot, "running");
        }
      }
    };
    child.stdout?.on("data", pipe("info"));
    child.stderr?.on("data", pipe("error"));

    child.on("message", (message: TraceMessage) => {
      for (const event of this.runs.handle(project.id, message)) this.emit("event", { ...event, projectId: project.id });
      if (message.type === "step" && message.nodeId) {
        this.emit("event", { type: "trace", projectId: project.id, nodeId: message.nodeId, at: message.at ?? Date.now() });
      } else if (message.type === "error") {
        this.log(project.id, bot, {
          at: Date.now(),
          level: "error",
          message: message.message ?? "Unknown error",
          nodeId: message.nodeId ?? undefined,
        });
      }
    });

    child.on("exit", (code, signal) => {
      if (bot.child !== child) return;
      bot.child = undefined;
      bot.exitCode = code;
      for (const event of this.runs.stopAll(project.id, "The bot stopped before this run finished.")) {
        this.emit("event", { ...event, projectId: project.id });
      }
      const stopped = signal !== null || bot.state === "stopped";
      this.log(project.id, bot, {
        at: Date.now(),
        level: "system",
        message: stopped ? "Bot stopped" : `Bot exited with code ${code}`,
      });
      const crashed = !stopped && code !== 0;
      this.setState(project.id, bot, crashed ? "crashed" : "stopped");
      if (crashed) this.scheduleRestart(project, secrets, bot);
    });

    return this.status(project.id);
  }

  private scheduleRestart(project: Project, secrets: Record<string, string>, bot: Bot): void {
    if (bot.startedAt && Date.now() - bot.startedAt > STABLE_AFTER) bot.restarts = 0;
    if (bot.restarts >= MAX_RESTARTS) {
      this.log(project.id, bot, { at: Date.now(), level: "system", message: `Gave up after ${MAX_RESTARTS} restarts. Fix the error and start the bot again.` });
      return;
    }
    const delay = 2 ** bot.restarts * 1000;
    bot.restarts += 1;
    this.log(project.id, bot, {
      at: Date.now(),
      level: "system",
      message: `Restarting in ${delay / 1000}s (attempt ${bot.restarts} of ${MAX_RESTARTS})`,
    });
    bot.retry = setTimeout(() => {
      bot.retry = undefined;
      this.start(project, secrets, true).catch((error: Error) => {
        this.log(project.id, bot, { at: Date.now(), level: "error", message: error.message });
      });
    }, delay);
  }

  async stop(projectId: string): Promise<BotStatus> {
    const bot = this.bots.get(projectId);
    if (bot?.retry) {
      clearTimeout(bot.retry);
      bot.retry = undefined;
    }
    const child = bot?.child;
    if (!bot || !child) return this.status(projectId);
    bot.state = "stopped";
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill();
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timeout);
    return this.status(projectId);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.bots.keys()].map((id) => this.stop(id)));
  }

  forget(projectId: string): void {
    this.runs.clear(projectId);
    this.bots.delete(projectId);
    const root = join(this.dataDir, "builds", projectId);
    unlinkModules(root);
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  private async prepareDatabase(project: Project, root: string, schema: string, env: NodeJS.ProcessEnv, bot: Bot, cli: string): Promise<void> {
    const provider = project.flow.database?.provider;
    if (!env.DATABASE_URL) {
      if (provider !== "sqlite") {
        throw new BuildError([{ level: "error", message: "Add DATABASE_URL in the project secrets to connect to your database." }]);
      }
      const folder = join(this.dataDir, "data", project.id);
      mkdirSync(folder, { recursive: true });
      env.DATABASE_URL = `file:${join(folder, "database.db").split(sep).join("/")}`;
    }
    const marker = join(root, "generated", ".schema");
    const fingerprint = createHash("sha256").update(schema).update(env.DATABASE_URL).digest("hex");
    if (existsSync(marker) && readFileSync(marker, "utf8") === fingerprint) return;

    const log = (message: string) => this.log(project.id, bot, { at: Date.now(), level: "system", message });
    log("Preparing the database");
    await prisma(cli, ["generate", "--schema", "prisma/schema.prisma"], root, env);
    log("Updating the database tables");
    await prisma(cli, ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], root, env);
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, fingerprint);
    log("Database ready");
  }

  private setState(projectId: string, bot: Bot, state: BotState): void {
    bot.state = state;
    this.emit("event", { type: "status", projectId, state });
  }

  private log(projectId: string, bot: Bot, entry: LogEntry): void {
    bot.logs.push(entry);
    if (bot.logs.length > MAX_LOGS) bot.logs.splice(0, bot.logs.length - MAX_LOGS);
    this.emit("event", { type: "log", projectId, entry });
  }
}
