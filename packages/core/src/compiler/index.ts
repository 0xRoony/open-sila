import { DATABASE_CLIENT, EXAMPLE_URLS, prismaSchema, withDatabase, type Database } from "../database.js";
import { getNode } from "../nodes/index.js";
import type { CommandOption, CommandSpec, CompileOptions, CompileResult, Diagnostic, Flow, GeneratedFile, Platform, Requirements, RuntimeHelper } from "../types.js";
import { slug } from "../util.js";
import { hasErrors, validateFlow } from "../validate.js";
import { addRequirement, CompileError, generateHandler, type GeneratorState, type HandlerFile } from "./generator.js";
import { dependencies, httpFile, runtimeFile, storeFile, tokenVariable, traceFile } from "./runtime.js";

export interface CompileInput {
  name: string;
  platform: Platform;
  flow: Flow;
}

export function compileProject(project: CompileInput, options: CompileOptions = { mode: "production" }): CompileResult {
  return withDatabase(project.flow.database, () => compile(project, options));
}

function compile(project: CompileInput, options: CompileOptions): CompileResult {
  const diagnostics: Diagnostic[] = validateFlow(project.flow, project.platform);
  const requirements: Requirements = { intents: [], permissions: [], partials: [], updates: [] };
  const env = [tokenVariable[project.platform]];
  if (project.platform === "discord") env.push("DISCORD_GUILD_ID");
  const empty = (): CompileResult => ({ ok: false, files: [], diagnostics, requirements: { ...requirements, env } });

  if (hasErrors(diagnostics)) return empty();

  const state: GeneratorState = { helpers: new Set(), requirements };
  const handlers: HandlerFile[] = [];

  for (const node of project.flow.nodes) {
    const definition = getNode(node.type);
    if (!definition) continue;
    const requires = definition.requires?.[project.platform];
    for (const intent of requires?.intents ?? []) addRequirement(requirements.intents, intent);
    for (const permission of requires?.permissions ?? []) addRequirement(requirements.permissions, permission);
    for (const partial of requires?.partials ?? []) addRequirement(requirements.partials, partial);
    if (definition.category !== "trigger") continue;
    try {
      handlers.push(generateHandler(project.flow, node, project.platform, options, state));
    } catch (error) {
      if (!(error instanceof CompileError)) throw error;
      diagnostics.push({ level: "error", nodeId: error.nodeId, message: error.message });
    }
  }

  if (hasErrors(diagnostics)) return empty();

  handlers.sort((a, b) => a.order - b.order || a.path.localeCompare(b.path));
  const files: GeneratedFile[] = handlers.map(({ path, content }) => ({ path, content }));
  files.push({ path: "src/handlers/index.js", content: handlerIndex(handlers, project.platform) });

  const runtime = runtimeFile(state.helpers, project.platform);
  if (runtime) files.push({ path: "src/lib/runtime.js", content: runtime });
  if (state.helpers.has("store")) files.push({ path: "src/lib/store.js", content: storeFile });
  const database = state.helpers.has("db") && project.flow.database?.models.length ? project.flow.database : undefined;
  if (database) {
    files.push({ path: "prisma/schema.prisma", content: prismaSchema(database) });
    files.push({ path: "src/lib/db.js", content: DATABASE_CLIENT });
    env.push("DATABASE_URL");
  }
  if (options.mode === "development") files.push({ path: "src/lib/trace.js", content: traceFile });
  const webhooks = state.helpers.has("http");
  if (webhooks) {
    files.push({ path: "src/lib/http.js", content: httpFile });
    env.push("PORT");
  }
  files.push({
    path: "src/index.js",
    content: entry(project.platform, requirements, { development: options.mode === "development", helpers: state.helpers, database: Boolean(database), webhooks }),
  });

  files.push(...scaffold(project, requirements, env, database, webhooks));
  return { ok: true, files, diagnostics, requirements: { ...requirements, env } };
}

function handlerIndex(handlers: HandlerFile[], platform: Platform): string {
  const imports = handlers.map((handler) => `import ${handler.name} from "./${handler.path.slice("src/handlers/".length)}";`);
  const specs = handlers.flatMap(({ command }) => (command ? [command] : []));
  const commands = platform === "telegram" ? specs.map((command) => ({ command: command.name, description: command.description ?? command.name })) : discordCommands(specs);

  return [
    ...imports,
    imports.length > 0 ? "" : undefined,
    `export const handlers = [${handlers.map((handler) => handler.name).join(", ")}];`,
    "",
    `export const commands = ${JSON.stringify(commands, null, 2)};`,
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

const LOGGING = `if (process.env.LOG_FORMAT === "json") {
  for (const level of ["log", "info", "warn", "error"]) {
    const write = level === "error" || level === "warn" ? process.stderr : process.stdout;
    console[level] = (...args) => {
      const message = args.map((arg) => (arg instanceof Error ? arg.stack : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
      write.write(JSON.stringify({ time: new Date().toISOString(), level: level === "log" ? "info" : level, message }) + "\\n");
    };
  }
}
`;

function shutdown(stop: string, database: boolean, webhooks: boolean): string {
  return `let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(\`Received \${signal}, shutting down\`);
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
  await Promise.allSettled([${webhooks ? "closeHttp(), " : ""}${stop}${database ? ", db.$disconnect()" : ""}]);
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void shutdown(signal));
process.on("unhandledRejection", (error) => console.error(error));
`;
}

function discordCommands(specs: CommandSpec[]): object[] {
  const result: Record<string, unknown>[] = [];
  const roots = new Map<string, Record<string, unknown> & { options: CommandOption[] }>();
  for (const spec of specs) {
    const { group, sub, options = [], ...rest } = spec;
    if (spec.type && spec.type !== 1) {
      result.push({ name: spec.name, type: spec.type });
      continue;
    }
    if (!sub) {
      result.push({ ...rest, options });
      continue;
    }
    let root = roots.get(spec.name);
    if (!root) {
      root = { name: spec.name, description: spec.description ?? spec.name, options: [] };
      roots.set(spec.name, root);
      result.push(root);
    }
    for (const key of ["default_member_permissions", "contexts"] as const) {
      if (rest[key] !== undefined && root[key] === undefined) root[key] = rest[key];
    }
    const entry: CommandOption = { type: 1, name: sub, description: spec.description ?? sub, options };
    if (rest.description_localizations) Object.assign(entry, { description_localizations: rest.description_localizations });
    if (!group) {
      root.options.push(entry);
      continue;
    }
    let holder = root.options.find((option) => option.type === 2 && option.name === group);
    if (!holder) {
      holder = { type: 2, name: group, description: group, options: [] };
      root.options.push(holder);
    }
    holder.options?.push(entry);
  }
  return result;
}

interface EntryOptions {
  development: boolean;
  helpers: Set<RuntimeHelper>;
  database: boolean;
  webhooks: boolean;
}

function entry(platform: Platform, requirements: Requirements, { development, helpers, database, webhooks }: EntryOptions): string {
  const instrument = development ? 'import { instrument } from "./lib/trace.js";\n' : "";
  const db = database ? 'import { db } from "./lib/db.js";\n' : "";
  const http = webhooks ? `import { closeHttp, ${platform === "telegram" ? "http, " : ""}listen, markReady } from "./lib/http.js";\n` : "";
  const ready = webhooks ? "\n  markReady();" : "";
  if (platform === "telegram") {
    const updates = requirements.updates.length > 0;
    const replies = helpers.has("replies");
    const start = updates
      ? `bot.start({\n  allowed_updates: [...API_CONSTANTS.DEFAULT_UPDATE_TYPES, ${requirements.updates.map((update) => JSON.stringify(update)).join(", ")}],\n  onStart:`
      : "bot.start({\n  onStart:";
    return `import "dotenv/config";
import { ${updates ? "API_CONSTANTS, " : ""}Bot } from "grammy";
import { commands, handlers } from "./handlers/index.js";
${http}${db}${replies ? 'import { replies } from "./lib/runtime.js";\n' : ""}${instrument}
${LOGGING}
const bot = new Bot(process.env.TELEGRAM_TOKEN);
${development ? "instrument(bot);\n" : ""}${replies ? "bot.use(replies.middleware);\n" : ""}const readyListeners = [];
const events = { onReady: (listener) => readyListeners.push(listener) };

for (const register of handlers) register(bot, events);

bot.catch(({ error }) => console.error(error));

${shutdown("bot.stop()", database, webhooks)}
${webhooks ? "listen();\n" : ""}if (commands.length > 0) await bot.api.setMyCommands(commands);

function started(me) {
  console.log(\`Logged in as @\${me.username}\`);${ready}
  for (const listener of readyListeners) listener(me);
}

${webhooks ? telegramWebhook(start, updates, requirements) : `${start} started,\n});`}
`;
  }

  const intents = ["Guilds", ...requirements.intents.filter((intent) => intent !== "Guilds")]
    .map((intent) => `GatewayIntentBits.${intent}`)
    .join(", ");

  const partials = requirements.partials.map((partial) => `Partials.${partial}`).join(", ");
  const options = partials
    ? `{\n  intents: [${intents}],\n  partials: [${partials}],\n}`
    : `{ intents: [${intents}] }`;

  return `import "dotenv/config";
import { Client, Events, GatewayIntentBits${partials ? ", Partials" : ""} } from "discord.js";
import { commands, handlers } from "./handlers/index.js";
${http}${db}${instrument}
${LOGGING}
const client = new Client(${options});
${development ? "instrument(client);\n" : ""}
for (const register of handlers) register(client);

client.once(Events.ClientReady, async (ready) => {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (guildId) await ready.application.commands.set(commands, guildId);
  else if (commands.length > 0) await ready.application.commands.set(commands);
  console.log(\`Logged in as \${ready.user.tag}\`);${ready}
});

client.on(Events.Error, (error) => console.error(error));

${shutdown("client.destroy()", database, webhooks)}
${webhooks ? "listen();\n" : ""}client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
}

function telegramWebhook(start: string, updates: boolean, requirements: Requirements): string {
  const allowed = updates ? `\n    allowed_updates: [...API_CONSTANTS.DEFAULT_UPDATE_TYPES, ${requirements.updates.map((update) => JSON.stringify(update)).join(", ")}],` : "";
  return `if (process.env.WEBHOOK_URL) {
  const secret = process.env.WEBHOOK_SECRET ? "WEBHOOK_SECRET" : undefined;
  http.on("/telegram", { method: "POST", secret, header: "x-telegram-bot-api-secret-token" }, ({ body }) => bot.handleUpdate(body));
  await bot.init();
  await bot.api.setWebhook(new URL("/telegram", process.env.WEBHOOK_URL).href, {
    secret_token: process.env.WEBHOOK_SECRET,${allowed}
  });
  started(bot.botInfo);
} else {
  ${start.replace(/\n/g, "\n  ")} started,
  });
}`;
}

const PRIVILEGED = ["GuildMembers", "MessageContent", "GuildPresences"];

const PRISMA_VERSION = "6.19.3";

function scaffold(project: CompileInput, requirements: Requirements, env: string[], database: Database | undefined, webhooks: boolean): GeneratedFile[] {
  const name = slug(project.name) || "sila-bot";
  const token = tokenVariable[project.platform];
  const privileged = requirements.intents.filter((intent) => PRIVILEGED.includes(intent));

  const notes: string[] = [];

  const packageJson = {
    name,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      ...(database ? { postinstall: "prisma generate", "db:push": "prisma db push" } : {}),
      start: database ? "prisma db push --skip-generate && node src/index.js" : "node src/index.js",
      ...(project.platform === "discord" ? { "start:shards": "node src/shards.js" } : {}),
    },
    engines: { node: ">=20" },
    dependencies: database
      ? { ...dependencies[project.platform], "@prisma/client": PRISMA_VERSION, prisma: PRISMA_VERSION }
      : dependencies[project.platform],
  };

  if (database) {
    notes.push(
      "## Database",
      "",
      `The bot uses ${database.provider} through Prisma. Set \`DATABASE_URL\`, for example \`${EXAMPLE_URLS[database.provider]}\`.`,
      "`npm start` creates or updates the tables before the bot starts. The schema is in `prisma/schema.prisma`.",
      database.provider === "mongodb" ? "MongoDB must run as a replica set; MongoDB Atlas does by default." : "",
      "",
    );
  }

  if (project.platform === "discord") {
    if (privileged.length > 0) {
      notes.push(
        "## Required intents",
        "",
        "Enable these under **Bot > Privileged Gateway Intents** in the Discord developer portal:",
        "",
        ...privileged.map((intent) => `- ${intent}`),
        "",
      );
    }
    if (requirements.permissions.length > 0) {
      notes.push("## Bot permissions", "", ...requirements.permissions.map((permission) => `- ${permission}`), "");
    }
  }

  const readme = [
    `# ${project.name}`,
    "",
    `A ${project.platform === "discord" ? "Discord" : "Telegram"} bot generated by [Open Sila](https://github.com/0xRoony/open-sila).`,
    "",
    "## Run",
    "",
    "```bash",
    "npm install",
    "cp .env.example .env",
    "npm start",
    "```",
    "",
    `Put your bot token in \`${token}\`.${project.platform === "discord" ? " Set `DISCORD_GUILD_ID` to register slash commands on one server instantly while testing." : ""}`,
    "",
    ...notes,
    "## Production",
    "",
    ...(webhooks
      ? [
          "- The bot serves its incoming webhooks on `PORT` (3000 by default), plus `GET /health`, which answers 200 once the bot is connected.",
          ...(project.platform === "telegram" ? ["- Set `WEBHOOK_URL` to the public address to receive Telegram updates by webhook instead of polling."] : []),
        ]
      : []),
    "- Set `LOG_FORMAT=json` for one JSON object per log line.",
    "- The bot stops cleanly on SIGTERM and SIGINT, closing the connection" + (database ? " and the database" : "") + " first.",
    ...(project.platform === "discord" ? ["- For bots in more than 2,500 servers, run `npm run start:shards` to split the bot into shards."] : []),
    "",
    "## Deploy",
    "",
    webhooks
      ? "- **Docker:** `docker build -t " + name + " . && docker run --env-file .env -p 3000:3000 " + name + "`. The image has a health check."
      : "- **Docker:** `docker build -t " + name + " . && docker run --env-file .env " + name + "`",
    "- **Railway:** push this folder to GitHub and create a project from it. `railway.json` sets the start command" + (webhooks ? " and health check." : "."),
    "- **Fly.io:** `fly launch --copy-config` then `fly secrets set " + token + "=...` and `fly deploy`. `fly.toml` is included.",
    "- **VPS:** `npm install --omit=dev && npx pm2 start src/index.js --name " + name + "`",
    "",
  ].join("\n");

  return [
    { path: "package.json", content: `${JSON.stringify(packageJson, null, 2)}\n` },
    {
      path: ".env.example",
      content: env.map((key) => `${key}=${key === "DATABASE_URL" && database ? EXAMPLE_URLS[database.provider] : ""}`).join("\n") + "\n",
    },
    { path: ".gitignore", content: `node_modules/\n.env\ndata/\n${database ? "generated/\n" : ""}` },
    {
      path: "Dockerfile",
      content: `FROM node:22-alpine
${database ? "RUN apk add --no-cache openssl\n" : ""}WORKDIR /app
ENV NODE_ENV=production${webhooks ? " PORT=3000" : ""}
COPY package*.json ./
${database ? "COPY prisma ./prisma\n" : ""}RUN npm install --omit=dev
COPY . .
VOLUME ["/app/data"]
${webhooks ? "EXPOSE 3000\nHEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1\n" : ""}CMD ["npm", "start"]
`,
    },
    {
      path: "railway.json",
      content: `${JSON.stringify(
        {
          $schema: "https://railway.com/railway.schema.json",
          build: { builder: "DOCKERFILE" },
          deploy: {
            ...(webhooks ? { healthcheckPath: "/health", healthcheckTimeout: 120 } : {}),
            restartPolicyType: "ON_FAILURE",
            restartPolicyMaxRetries: 10,
          },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: "fly.toml",
      content: webhooks
        ? `app = "${name}"

[build]

[env]
  PORT = "3000"

[http_service]
  internal_port = 3000
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

[[http_service.checks]]
  method = "GET"
  path = "/health"
  interval = "30s"
  timeout = "5s"
  grace_period = "30s"
`
        : `app = "${name}"

[build]

[[vm]]
  size = "shared-cpu-1x"
`,
    },
    ...(project.platform === "discord"
      ? [
          {
            path: "src/shards.js",
            content: `import "dotenv/config";
import { ShardingManager } from "discord.js";
import { fileURLToPath } from "node:url";

const manager = new ShardingManager(fileURLToPath(new URL("./index.js", import.meta.url)), {
  token: process.env.DISCORD_TOKEN,
  totalShards: process.env.SHARDS ? Number(process.env.SHARDS) : "auto",
});

manager.on("shardCreate", (shard) => console.log(\`Started shard \${shard.id}\`));
await manager.spawn();
`,
          },
        ]
      : []),
    { path: ".dockerignore", content: `node_modules\n.env\ndata\n${database ? "generated\n" : ""}` },
    { path: "README.md", content: readme },
  ];
}
