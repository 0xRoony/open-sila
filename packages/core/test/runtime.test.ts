import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { compileProject, getNode, listNodes, type FlowNode, type Platform } from "../src/index.js";
import { templates } from "../../../apps/dashboard/src/templates.js";
import { chain, DATABASE, TRIGGERS } from "./fixtures.js";

// Runs the code every node generates against mocked discord.js and grammY objects, in several scenarios,
// and fails on any error the generated code throws or logs.

type Scenario = "normal" | "direct" | "failing" | "unusual";

interface Harness {
  scenario: Scenario;
  calls: string[];
  errors: string[];
  capture: ((handler: (...args: unknown[]) => unknown) => void) | null;
  realTimeout: typeof setTimeout;
  wired?: unknown;
}

const root = mkdtempSync(join(tmpdir(), "sila-runtime-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
  const open = process.getActiveResourcesInfo().filter((kind) => kind !== "TTYWrap" && kind !== "PipeWrap");
  if (open.length > 0) process.stdout.write(`open handles: ${open.join(", ")}\n`);
});

const MOCK = String.raw`
const state = globalThis.__sila;

function plain(name, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || value.__mock) return value;
  return mock(name, value);
}

function failing(name) {
  const error = new Error("API failed: " + name);
  return mock(name, {
    then: (resolve, reject) => Promise.reject(error).then(resolve, reject),
    catch: (handle) => Promise.reject(error).catch(handle),
    finally: (handle) => Promise.reject(error).finally(handle),
  });
}

export function mock(name, overrides = {}) {
  const cache = new Map();
  const target = function () {};
  return new Proxy(target, {
    get(_, key) {
      if (key === "__mock") return true;
      if (typeof key === "string" && Object.prototype.hasOwnProperty.call(overrides, key)) {
        return typeof overrides[key] === "function" ? overrides[key] : plain(name + "." + key, overrides[key]);
      }
      if (key === "then") return undefined;
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.asyncIterator) return async function* () {};
      if (key === Symbol.toPrimitive) return (hint) => (hint === "number" ? 1 : "mock");
      if (key === "toJSON" || key === "toString" || key === "valueOf") return () => "mock";
      if (typeof key === "symbol") return undefined;
      if (!cache.has(key)) cache.set(key, mock(name + "." + key));
      return cache.get(key);
    },
    has(_, key) {
      return typeof key === "string" && Object.prototype.hasOwnProperty.call(overrides, key);
    },
    apply(_, __, args) {
      state.calls.push(name);
      const handler = args.findLast?.((arg) => typeof arg === "function" && !arg.__mock);
      if (handler && state.capture) state.capture(handler);
      if (state.scenario === "failing" && !/^(client|bot)\.(on|once|command|callbackQuery|inlineQuery|hears|use)$/.test(name)) {
        return failing(name + "()");
      }
      return mock(name + "()");
    },
    construct(_, args) {
      state.calls.push("new " + name);
      return mock("new " + name);
    },
  });
}
`;

function moduleFile(names: string[]): string {
  return (
    [`import { mock } from "../../mock.mjs";`, ...names.map((name) => `export const ${name} = mock(${JSON.stringify(name)});`)].join("\n") +
    "\n"
  );
}

const HTTP_MOCK = `export const http = { on: (path, options, handler) => globalThis.__sila.capture?.(handler) };
export function listen() {}
export function markReady() {}
export async function closeHttp() {}
`;

const DB_MOCK = `import { mock } from "../../../mock.mjs";
export const db = mock("db");
`;

interface Built {
  dir: string;
  node: FlowNode;
  trigger: FlowNode;
  mode: "production" | "development";
}

function build(platform: Platform): Built[] {
  const built: Built[] = [];
  const imports = new Map<string, Set<string>>([
    ["discord.js", new Set()],
    ["grammy", new Set()],
  ]);
  const covered = new Set<string>();
  const write = (dir: string, files: { path: string; content: string }[]) => {
    for (const file of files) {
      const target = join(dir, file.path);
      mkdirSync(dirname(target), { recursive: true });
      let content = file.path === "src/lib/http.js" ? HTTP_MOCK : file.path === "src/lib/db.js" ? DB_MOCK : file.content;
      for (const match of content.matchAll(/import \{([^}]+)\} from "(discord\.js|grammy)";/g)) {
        for (const name of match[1].split(",")) imports.get(match[2])?.add(name.trim().split(/\s+as\s+/)[0]);
      }
      if (file.path.endsWith(".js")) content = content.replace(/^import "dotenv\/config";\n/m, "");
      writeFileSync(target, content);
    }
  };
  for (const definition of listNodes(platform)) {
    for (const triggerType of definition.category === "trigger" ? [""] : TRIGGERS[platform]) {
      for (const mode of ["production", "development"] as const) {
        const candidate = chain(platform, definition, triggerType);
        const result = compileProject({ name: "runtime", platform, flow: { ...candidate, database: DATABASE } }, { mode });
        if (!result.ok) continue;
        covered.add(definition.type);
        const dir = join(root, platform, `${definition.type}-${triggerType}-${mode}`.replace(/\W/g, "_"));
        write(dir, result.files);
        const node = candidate.nodes.find((item) => item.type === definition.type) as FlowNode;
        const trigger = candidate.nodes.find((item) => getNode(item.type)?.category === "trigger") as FlowNode;
        built.push({ dir, node, trigger, mode });
      }
    }
  }
  for (const template of templates) {
    if (template.platforms && !template.platforms.includes(platform)) continue;
    const flow = template.flow(platform);
    const result = compileProject({ name: template.name, platform, flow });
    assert.ok(result.ok, `${template.id} on ${platform}: ${JSON.stringify(result.diagnostics)}`);
    const dir = join(root, platform, `template-${template.id}`);
    write(dir, result.files);
    for (const trigger of flow.nodes.filter((item) => getNode(item.type)?.category === "trigger")) {
      built.push({ dir, node: { ...trigger, type: `template:${template.id}` }, trigger, mode: "production" });
    }
  }
  const missing = listNodes(platform).filter((definition) => !covered.has(definition.type));
  assert.deepEqual(
    missing.map((definition) => definition.type),
    [],
    "every node must build in at least one chain",
  );
  writeFileSync(join(root, platform, "mock.mjs"), MOCK);
  for (const [library, names] of imports) {
    const folder = join(root, platform, "node_modules", library);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "package.json"), JSON.stringify({ name: library, type: "module", main: "index.js" }));
    writeFileSync(join(folder, "index.js"), moduleFile([...names]));
  }
  writeFileSync(join(root, platform, "package.json"), JSON.stringify({ type: "module" }));
  return built;
}

async function load(path: string) {
  return import(pathToFileURL(path).href + `?t=${Date.now()}${Math.random()}`);
}

function discordEvent(mock: (name: string, overrides?: object) => unknown, trigger: FlowNode, scenario: Scenario) {
  const direct = scenario === "direct";
  const user = mock("user", {
    id: "10",
    username: scenario === "unusual" ? "<b>&amp;</b> مستخدم" : "ann",
    bot: false,
    tag: "ann#0001",
  });
  const guild = direct ? null : mock("guild", { id: "40", name: "Guild" });
  const member = direct ? null : mock("member", { id: "10", user });
  const channel = mock("channel", { id: "20", isTextBased: () => true });
  return mock("event", {
    id: "30",
    author: user,
    user,
    member,
    guild,
    guildId: direct ? null : "40",
    channel,
    channelId: "20",
    content: scenario === "unusual" ? "مرحبا 👋 <script>&\u0000 ${x} `tick`" : "hello world",
    inGuild: () => !direct,
    isButton: () => true,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isAnySelectMenu: () => true,
    isStringSelectMenu: () => true,
    isModalSubmit: () => true,
    isRepliable: () => true,
    replied: false,
    deferred: false,
    customId: String(trigger.data.customId ?? ""),
    commandName: String(trigger.data.name ?? ""),
    values: ["red"],
    options: mock("options", {
      getSubcommand: () => null,
      getSubcommandGroup: () => null,
    }),
    message: mock("message", { id: "31", content: "earlier" }),
  });
}

function telegramContext(mock: (name: string, overrides?: object) => unknown, trigger: FlowNode, scenario: Scenario) {
  const unusual = scenario === "unusual";
  const from = { id: 10, first_name: unusual ? "<b>نور</b> & 😀" : "Ann", username: unusual ? undefined : "ann", is_bot: false };
  const chat = {
    id: scenario === "direct" ? 10 : -20,
    type: scenario === "direct" ? "private" : "supergroup",
    title: "Group",
  };
  const message = { message_id: 30, text: unusual ? "مرحبا 👋 <i>&</i> ${x} `tick`" : "hello world", chat, from, date: 1 };
  return mock("ctx", {
    from,
    chat,
    message,
    msg: message,
    match: "",
    callbackQuery: {
      id: "cb",
      data: String(trigger.data.data ?? ""),
      message,
      from,
    },
    inlineQuery: { id: "iq", query: "search", from },
    reactions: () => ({ emojiAdded: ["👍"], emojiRemoved: [] }),
  });
}

async function run(platform: Platform, built: Built, scenario: Scenario): Promise<string[]> {
  const state = (globalThis as unknown as { __sila: Harness }).__sila;
  const { mock } = await load(join(root, platform, "mock.mjs"));
  const handlers: ((...args: unknown[]) => unknown)[] = [];
  state.scenario = scenario;
  state.errors = [];
  state.wired = mock("wired", { id: "50", name: "Wired" });
  state.capture = (handler) => handlers.push(handler);
  const before = process.listeners("message").length;
  const index = await load(join(built.dir, "src/handlers/index.js"));
  const host = platform === "discord" ? mock("client") : mock("bot");
  const events = {
    onReady: (listener: (...args: unknown[]) => unknown) => handlers.push(listener),
  };
  for (const register of index.handlers) register(host, events);
  state.capture = null;

  const event = platform === "discord" ? discordEvent(mock, built.trigger, scenario) : telegramContext(mock, built.trigger, scenario);
  const settle = async (work: () => unknown) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      Promise.resolve()
        .then(work)
        .then(
          () => "done",
          (error: Error) => {
            state.errors.push(`threw: ${error?.message ?? error}`);
            return "done";
          },
        ),
      new Promise((resolve) => {
        timer = state.realTimeout(() => resolve("timeout"), 3000);
      }),
    ]);
    clearTimeout(timer);
    if (outcome === "timeout") state.errors.push("timed out");
  };
  const rest = platform === "discord" ? [event, event] : [async () => undefined];
  for (const listener of handlers) await settle(() => listener(event, ...rest));
  const manual = process.listeners("message").slice(before);
  for (const listener of manual) {
    await settle(() =>
      (listener as (message: unknown) => unknown)({
        type: "manual",
        id: built.trigger.id,
        payload: { amount: 1 },
      }),
    );
    process.off("message", listener as never);
  }
  await new Promise((resolve) => state.realTimeout(resolve, 5));
  return state.errors;
}

for (const platform of ["discord", "telegram"] as const) {
  test(`every ${platform} node runs without errors in every scenario`, { timeout: 600_000 }, async () => {
    const realTimeout = globalThis.setTimeout;
    const realInterval = globalThis.setInterval;
    const realFetch = globalThis.fetch;
    const realError = console.error;
    const realLog = console.log;
    const state: Harness = {
      scenario: "normal",
      calls: [],
      errors: [],
      capture: null,
      realTimeout,
    };
    (globalThis as unknown as { __sila: Harness }).__sila = state;
    process.env.STORE_FILE = join(root, `${platform}-store.json`);

    const unhandled: string[] = [];
    const onRejection = (reason: unknown) => unhandled.push(String((reason as Error)?.message ?? reason));
    process.on("unhandledRejection", onRejection);
    globalThis.setInterval = (() => 0) as never;
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...args: unknown[]) =>
      realTimeout(fn, ms && ms >= 2000 ? 0 : ms, ...args)) as never;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ items: [1, 2], name: "x" }),
      text: async () => "{}",
    })) as never;
    console.log = () => undefined;
    console.error = (...args: unknown[]) =>
      state.errors.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));

    const failures: string[] = [];
    try {
      const built = build(platform);
      for (const scenario of ["normal", "unusual", "direct", "failing"] as const) {
        for (const item of built) {
          if (item.mode === "development" && scenario !== "normal") continue;
          unhandled.length = 0;
          const errors = await run(platform, item, scenario);
          const expected =
            scenario === "normal" || scenario === "unusual" ? [] : errors.filter((error) => /API failed|of null|of undefined/.test(error));
          const unexpected = errors.filter((error) => !expected.includes(error));
          if (unexpected.length > 0)
            failures.push(`[${scenario}/${item.mode}/${item.trigger.type}] ${item.node.type}: ${unexpected.join(" | ")}`);
          if (unhandled.length > 0) failures.push(`[${scenario}] ${item.node.type}: unhandled ${unhandled.join(" | ")}`);
        }
      }
    } finally {
      globalThis.setTimeout = realTimeout;
      globalThis.setInterval = realInterval;
      globalThis.fetch = realFetch;
      console.error = realError;
      console.log = realLog;
      process.off("unhandledRejection", onRejection);
    }
    if (failures.length > 0) writeFileSync(join(tmpdir(), `sila-runtime-${platform}.txt`), failures.join("\n"));
    assert.equal(failures.length, 0, `${failures.length} failures, first: ${failures.slice(0, 15).join("\n")}`);
    assert.ok(readFileSync(join(root, platform, "mock.mjs"), "utf8").length > 0);
  });
}
