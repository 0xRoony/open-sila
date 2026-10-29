import type { Platform, RuntimeHelper } from "../types.js";

const helpers: Record<Exclude<RuntimeHelper, "store" | "refs" | "db" | "http">, string> = {
  respond: `export async function respond(source, payload) {
  if (typeof source.isRepliable === "function" && source.isRepliable()) {
    if (source.deferred && !source.replied) return source.editReply(payload);
    if (source.replied) return source.followUp(payload);
    await source.reply(payload);
    return source.fetchReply();
  }
  const { flags, ...rest } = payload;
  if (typeof source.reply !== "function" && typeof source.send === "function") return source.send(rest);
  return source.reply(rest);
}`,
  resolveChannel: `export async function resolveChannel(client, value) {
  if (value && typeof value === "object") return value;
  const channel = await client.channels.fetch(String(value));
  if (!channel?.isTextBased()) throw new Error(\`Channel \${value} is not a text channel\`);
  return channel;
}`,
  chatId: `export function chatId(value) {
  return value && typeof value === "object" ? value.id : value;
}`,
  toText: `export function toText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(toText).join(", ");
  if (value.toString !== Object.prototype.toString) return String(value);
  return value.first_name ?? value.title ?? value.text ?? value.name ?? JSON.stringify(value);
}`,
  memory: `const entries = new Map();

export const memory = {
  set(key, value, minutes = 0) {
    entries.set(key, { value, expires: minutes > 0 ? Date.now() + minutes * 60_000 : 0 });
    return value;
  },
  get(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expires && entry.expires < Date.now()) {
      entries.delete(key);
      return undefined;
    }
    return entry.value;
  },
  delete(key) {
    entries.delete(key);
  },
};`,
  toCreate: `export function toCreate(data) {
  const created = {};
  for (const [key, value] of Object.entries(data)) {
    const operation = value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) ? value : null;
    if (operation && "increment" in operation) created[key] = operation.increment;
    else if (operation && "decrement" in operation) created[key] = -operation.decrement;
    else if (operation && "set" in operation) created[key] = operation.set;
    else created[key] = value;
  }
  return created;
}`,
  schedule: `function matches(part, value, min, max) {
  return part.split(",").some((item) => {
    const [range, step] = item.split("/");
    const every = Number(step) || 1;
    let [from, to] = range === "*" ? [min, max] : range.split("-").map(Number);
    if (to === undefined) to = step ? max : from;
    return value >= from && value <= to && (value - from) % every === 0;
  });
}

export function schedule(cron, timeZone, task) {
  const [minute, hour, day, month, weekday] = cron.trim().split(/\\s+/);
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
  });
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const tick = () => {
    const now = new Date();
    const parts = Object.fromEntries(format.formatToParts(now).map((part) => [part.type, part.value]));
    const weekdayValue = days[parts.weekday];
    const dayMatches = matches(day, Number(parts.day), 1, 31);
    const weekdayMatches = matches(weekday, weekdayValue, 0, 7) || (weekdayValue === 0 && matches(weekday, 7, 0, 7));
    const dayOk = day !== "*" && weekday !== "*" ? dayMatches || weekdayMatches : dayMatches && weekdayMatches;
    if (matches(minute, Number(parts.minute), 0, 59) && matches(hour, Number(parts.hour), 0, 23) && matches(month, Number(parts.month), 1, 12) && dayOk) {
      Promise.resolve(task(now.toISOString())).catch((error) => console.error(error));
    }
  };
  const start = () => {
    tick();
    setInterval(tick, 60_000);
  };
  setTimeout(start, 60_000 - (Date.now() % 60_000) + 50);
}`,
  replies: `const waiting = new Map();

export const replies = {
  wait(chat, user, ms) {
    const key = \`\${chat}:\${user}\`;
    waiting.get(key)?.(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), ms);
      const finish = (message) => {
        clearTimeout(timer);
        if (waiting.get(key) === finish) waiting.delete(key);
        resolve(message);
      };
      waiting.set(key, finish);
    });
  },
  middleware(ctx, next) {
    const key = \`\${ctx.chat?.id}:\${ctx.from?.id}\`;
    const finish = ctx.message && waiting.get(key);
    if (!finish) return next();
    finish(ctx.message);
  },
};`,
  sleep: `export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}`,
  cooldown: `const cooldowns = new Map();

export function cooldown(key, seconds) {
  const now = Date.now();
  const until = cooldowns.get(key) ?? 0;
  if (until > now) return Math.ceil((until - now) / 1000);
  cooldowns.set(key, now + seconds * 1000);
  return 0;
}`,
};

const refs: Record<Platform, string> = {
  discord: `import { WebhookClient } from "discord.js";
import { store } from "./store.js";

const TOKEN_LIFETIME = 14 * 60_000;
const live = new Map();

async function answer(interaction, payload) {
  if (interaction.deferred && !interaction.replied) return interaction.editReply(payload);
  if (interaction.replied) return interaction.followUp(payload);
  await interaction.reply(payload);
  return interaction.fetchReply();
}

export const refs = {
  async save(key, source) {
    const repliable = typeof source.isRepliable === "function" && source.isRepliable();
    if (repliable && !source.replied && !source.deferred) await source.deferReply();
    if (repliable) live.set(key, source);
    const author = source.user ?? source.author ?? null;
    const ref = {
      savedAt: Date.now(),
      guildId: source.guildId ?? null,
      channelId: source.channelId ?? source.channel?.id ?? null,
      userId: author?.id ?? null,
      messageId: null,
      applicationId: source.applicationId ?? null,
      token: source.token ?? null,
      pending: repliable && !source.replied,
    };
    if (repliable) {
      if (source.replied) ref.messageId = (await source.fetchReply().catch(() => null))?.id ?? null;
    } else if (source.id && ref.channelId) {
      ref.messageId = source.id;
    }
    store.set(\`ref:\${key}\`, ref);
    return ref;
  },
  async load(client, key) {
    const ref = store.get(\`ref:\${key}\`);
    if (!ref) return null;
    const channel = ref.channelId ? await client.channels.fetch(ref.channelId).catch(() => null) : null;
    const message = channel?.messages && ref.messageId ? await channel.messages.fetch(ref.messageId).catch(() => null) : null;
    const user = ref.userId ? await client.users.fetch(ref.userId).catch(() => null) : null;
    const guild = ref.guildId ? await client.guilds.fetch(ref.guildId).catch(() => null) : null;
    const member = guild && user ? await guild.members.fetch(user.id).catch(() => null) : null;
    const fresh = Date.now() - ref.savedAt < TOKEN_LIFETIME;
    const interaction = fresh ? live.get(key) : null;
    const webhook = !interaction && fresh && ref.token ? new WebhookClient({ id: ref.applicationId, token: ref.token }) : null;
    const send = async (payload) => {
      const { flags, ...rest } = payload;
      if (interaction) return answer(interaction, payload);
      if (webhook && ref.pending) {
        ref.pending = false;
        store.set(\`ref:\${key}\`, ref);
        return webhook.editMessage("@original", rest);
      }
      if (webhook) return webhook.send(payload);
      return message ? message.reply(rest) : channel.send(rest);
    };
    return {
      channel,
      message,
      user,
      member,
      guild,
      savedAt: ref.savedAt,
      reply: send,
      followUp: send,
      editReply: (payload) =>
        interaction ? interaction.editReply(payload) : webhook ? webhook.editMessage("@original", payload) : message.edit(payload),
      delete: () => (interaction ? interaction.deleteReply() : message?.delete()),
    };
  },
  remove(key) {
    store.delete(\`ref:\${key}\`);
  },
};`,
  telegram: `import { store } from "./store.js";

export const refs = {
  async save(key, ctx) {
    const message = ctx.msg ?? ctx.callbackQuery?.message ?? null;
    const ref = { savedAt: Date.now(), chatId: ctx.chat?.id ?? null, messageId: message?.message_id ?? null, userId: ctx.from?.id ?? null };
    store.set(\`ref:\${key}\`, ref);
    return ref;
  },
  async load(bot, key) {
    const ref = store.get(\`ref:\${key}\`);
    if (!ref) return null;
    const message = ref.messageId ? { chat: { id: ref.chatId }, message_id: ref.messageId } : null;
    return {
      chat: { id: ref.chatId },
      user: { id: ref.userId },
      message,
      savedAt: ref.savedAt,
      reply: (text, other = {}) =>
        bot.api.sendMessage(ref.chatId, text, message ? { ...other, reply_parameters: { message_id: ref.messageId, allow_sending_without_reply: true } } : other),
      editMessageText: (text, other) => bot.api.editMessageText(ref.chatId, ref.messageId, text, other),
    };
  },
  remove(key) {
    store.delete(\`ref:\${key}\`);
  },
};`,
};

export function runtimeFile(used: Set<RuntimeHelper>, platform: Platform): string | undefined {
  const parts = (Object.keys(helpers) as (keyof typeof helpers)[])
    .filter((name) => used.has(name))
    .map((name) => helpers[name]);
  if (used.has("refs")) parts.unshift(refs[platform]);
  return parts.length > 0 ? `${parts.join("\n\n")}\n` : undefined;
}

export const storeFile = `import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const file = resolve(process.env.STORE_FILE ?? "data/store.json");
let data = {};

try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch {
  data = {};
}

function persist() {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(\`\${file}.tmp\`, JSON.stringify(data, null, 2));
  renameSync(\`\${file}.tmp\`, file);
}

export const store = {
  get(key, fallback = null) {
    return key in data ? data[key] : fallback;
  },
  set(key, value) {
    data[key] = value;
    persist();
    return value;
  },
  increment(key, amount = 1) {
    return this.set(key, Number(data[key] ?? 0) + amount);
  },
  delete(key) {
    delete data[key];
    persist();
  },
};
`;

export const traceFile = `import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const context = new AsyncLocalStorage();
const SECRET = /token|secret|password|authorization|cookie/i;
const SUMMARY = ["id", "name", "username", "globalName", "displayName", "tag", "content", "title", "type", "url", "customId", "commandName", "first_name", "last_name", "text", "caption", "message_id", "data", "status", "from", "chat"];
const OWN_APIS = /discord\\.com\\/api|api\\.telegram\\.org/;

function send(message) {
  process.send?.(message);
}

function redact(text) {
  return String(text)
    .replace(/\\/bot\\d+:[\\w-]+/g, "/bot••••")
    .replace(/(\\/webhooks\\/\\d+\\/)[\\w-]+/g, "$1••••");
}

export function snapshot(value, depth = 0) {
  if (value === undefined || value === null) return value ?? null;
  const kind = typeof value;
  if (kind === "string") return value.length > 2000 ? \`\${value.slice(0, 2000)}…\` : value;
  if (kind === "number" || kind === "boolean") return value;
  if (kind === "bigint") return String(value);
  if (kind === "function") return "[function]";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { error: value.message };
  if (depth >= 3) return \`[\${value.constructor?.name ?? "Object"}]\`;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => snapshot(item, depth + 1));
  if (value instanceof Map) {
    return { size: value.size, items: [...value.values()].slice(0, 10).map((item) => snapshot(item, depth + 1)) };
  }
  const name = value.constructor?.name;
  if (name && name !== "Object") {
    const summary = { $type: name };
    for (const key of SUMMARY) {
      if (key in value && typeof value[key] !== "function") summary[key] = snapshot(value[key], depth + 1);
    }
    return summary;
  }
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) out[key] = SECRET.test(key) ? "••••" : snapshot(item, depth + 1);
  return out;
}

function evaluate(read) {
  try {
    return snapshot(read());
  } catch (error) {
    return { unavailable: error?.message ?? String(error) };
  }
}

export async function run(triggerId, label, body) {
  const record = { id: randomUUID(), node: triggerId, started: performance.now(), stepStarted: performance.now(), failed: false };
  send({ type: "run:start", runId: record.id, triggerId, label, at: Date.now() });
  await context.run(record, body);
  send({ type: "run:end", runId: record.id, status: record.failed ? "error" : "ok", ms: performance.now() - record.started });
}

export function step(nodeId, read) {
  const record = context.getStore();
  if (!record) return;
  record.node = nodeId;
  record.stepStarted = performance.now();
  send({ type: "step", runId: record.id, nodeId, inputs: evaluate(read), at: Date.now() });
}

export function done(nodeId, read) {
  const record = context.getStore();
  if (!record) return;
  send({ type: "done", runId: record.id, nodeId, outputs: evaluate(read), ms: performance.now() - record.stepStarted });
}

export function fail(error) {
  const record = context.getStore();
  if (record) record.failed = true;
  send({ type: "error", runId: record?.id ?? null, nodeId: record?.node ?? null, message: error?.message ?? String(error) });
  console.error(error);
}

function network(entry) {
  const record = context.getStore();
  send({ type: "net", runId: record?.id ?? null, nodeId: record?.node ?? null, at: Date.now(), ...entry, url: redact(entry.url) });
}

function preview(body) {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") {
    try {
      return snapshot(JSON.parse(body));
    } catch {
      return body.slice(0, 2000);
    }
  }
  try {
    return snapshot(body);
  } catch {
    return "[body]";
  }
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (OWN_APIS.test(url)) return originalFetch(input, init);
  const method = String(init.method ?? input?.method ?? "GET").toUpperCase();
  const started = performance.now();
  try {
    const response = await originalFetch(input, init);
    let body = null;
    try {
      body = preview(await response.clone().text());
    } catch {
      body = null;
    }
    network({ source: "http", method, url, status: response.status, ms: performance.now() - started, request: preview(init.body), response: body });
    return response;
  } catch (error) {
    network({ source: "http", method, url, status: 0, ms: performance.now() - started, request: preview(init.body), error: error?.message ?? String(error) });
    throw error;
  }
};

export function instrument(target) {
  if (target.rest?.on) {
    target.rest.on("response", (request, response) => {
      network({ source: "discord", method: request.method, url: request.path, status: response.status, ms: null, request: preview(request.data?.body) });
    });
  }
  if (target.api?.config?.use) {
    target.api.config.use(async (previous, method, payload, signal) => {
      const started = performance.now();
      try {
        const result = await previous(method, payload, signal);
        network({
          source: "telegram",
          method: "POST",
          url: method,
          status: result.ok ? 200 : (result.error_code ?? 400),
          ms: performance.now() - started,
          request: preview(payload),
          response: result.ok ? preview(result.result) : result.description,
        });
        return result;
      } catch (error) {
        network({ source: "telegram", method: "POST", url: method, status: 0, ms: performance.now() - started, request: preview(payload), error: error?.message ?? String(error) });
        throw error;
      }
    });
  }
}
`;

export const httpFile = `import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const routes = new Map();
const LIMIT = 1024 * 1024;
let server;
let ready = false;

export function markReady() {
  ready = true;
}

export function listen() {
  if (server) return;
  const port = Number(process.env.PORT) || 3000;
  server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      console.error(error);
      send(response, 500, { error: "The flow failed" });
    });
  });
  server.listen(port, () => console.log(\`HTTP server listening on http://localhost:\${port}\`));
}

export function closeHttp() {
  return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
}

export const http = {
  on(path, options, handler) {
    routes.set(path, { ...options, handler });
    listen();
  },
};

function send(response, status, body) {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function same(given, expected) {
  if (typeof given !== "string" || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function read(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > LIMIT) throw new Error("Request body is larger than 1 MB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parse(text, type = "") {
  if (!text) return null;
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function handle(request, response) {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/health") {
    return send(response, ready ? 200 : 503, { status: ready ? "ok" : "starting", uptime: Math.round(process.uptime()) });
  }
  const route = routes.get(url.pathname);
  if (!route) return send(response, 404, { error: "Not found" });
  if (route.method !== "ANY" && request.method !== route.method) return send(response, 405, { error: "Method not allowed" });
  if (route.secret && !same(request.headers[route.header ?? "x-webhook-secret"], process.env[route.secret])) {
    return send(response, 401, { error: "Unauthorized" });
  }
  const body = parse(await read(request), request.headers["content-type"]);
  await route.handler({ body, query: Object.fromEntries(url.searchParams), headers: request.headers });
  send(response, 200, { ok: true });
}
`;

export const dependencies: Record<Platform, Record<string, string>> = {
  discord: { "discord.js": "^14.21.0", dotenv: "^16.4.5" },
  telegram: { grammy: "^1.36.0", dotenv: "^16.4.5" },
};

export const tokenVariable: Record<Platform, string> = {
  discord: "DISCORD_TOKEN",
  telegram: "TELEGRAM_TOKEN",
};
