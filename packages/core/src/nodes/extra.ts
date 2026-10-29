import type { EmitContext } from "../types.js";
import { indent } from "../util.js";
import { block, defineNode, execIn, next } from "./common.js";

const both = ["discord", "telegram"] as const;

function register(ctx: EmitContext, body: string): string {
  return ctx.platform === "discord"
    ? block("export default function register(client) {", body)
    : block("export default function register(bot, events) {", body);
}

function onReady(ctx: EmitContext, body: string): string {
  return ctx.platform === "discord"
    ? block(`client.once(${ctx.use("Events")}.ClientReady, () => {`, body, "});")
    : block("events.onReady(() => {", body, "});");
}

export const tryNode = defineNode({
  type: "core.try",
  label: "Try",
  description: "Runs the Try path. If any node in it fails, runs Catch with the error instead of stopping the flow.",
  category: "logic",
  icon: "ShieldAlert",
  platforms: both,
  inputs: [execIn],
  outputs: [
    { id: "try", label: "Try", type: "exec" },
    { id: "catch", label: "Catch", type: "exec" },
    { id: "error", label: "Error message", type: "string", scoped: "catch" },
    { id: "next", label: "Done", type: "exec" },
  ],
  fields: [],
  emit: (ctx) => {
    const attempt = ctx.branch("try");
    const failure = ctx.out("failure");
    const message = ctx.declare("error");
    const recover = ctx.branch("catch");
    return [
      block("try {", attempt || "// nothing to try", `} catch (${failure}) {`),
      `  const ${message} = ${failure} instanceof Error ? ${failure}.message : String(${failure});`,
      indent(recover || `console.error(${message});`, 2),
      "}",
    ].join("\n");
  },
});

export const repeatWhile = defineNode({
  type: "core.while",
  label: "Repeat while",
  description: "Runs the Loop path again and again while the condition is true, up to a safety limit.",
  category: "logic",
  icon: "RefreshCw",
  platforms: both,
  inputs: [execIn, { id: "condition", label: "Condition", type: "boolean" }],
  outputs: [
    { id: "loop", label: "Loop", type: "exec" },
    { id: "round", label: "Round", type: "number", scoped: "loop" },
    { id: "next", label: "Done", type: "exec" },
  ],
  fields: [
    { id: "condition", label: "Condition", kind: "expression", required: true, placeholder: "attempts < 3" },
    { id: "limit", label: "Stop after", kind: "number", default: 100, min: 1, max: 100000, help: "Rounds before the loop stops even if the condition is still true." },
  ],
  emit: (ctx) => {
    const round = ctx.declare("round");
    const body = ctx.branch("loop");
    return block(
      `for (let ${round} = 0; ${round} < Math.max(1, Number(${ctx.value("limit")})) && (${ctx.value("condition")}); ${round} += 1) {`,
      body || "// nothing to repeat",
    );
  },
});

export const manual = defineNode({
  type: "core.manual",
  label: "Manual run",
  description: "Runs when you press Run now in the editor, with a sample payload. Use it to test a path without Discord or Telegram.",
  category: "trigger",
  icon: "Play",
  platforms: both,
  inputs: [],
  outputs: [next, { id: "payload", label: "Payload", type: "any" }],
  fields: [
    { id: "name", static: true, label: "Name", kind: "text", default: "Test run" },
    {
      id: "payload",
      static: true,
      label: "Sample payload",
      kind: "code",
      default: '{\n  "user": "123",\n  "amount": 5\n}',
      help: "JSON sent to the flow as Payload. Edit it and press Run now.",
    },
  ],
  trigger: (ctx) => ({
    file: `manual-${ctx.node.id}`,
    order: 3,
    scope: { context: "none", vars: { payload: "payload" } },
    wrap: (body) =>
      register(
        ctx,
        block(
          `process.on("message", async (message) => {\n  if (message?.type !== "manual" || message.id !== ${JSON.stringify(ctx.node.id)}) return;\n  const payload = message.payload;`,
          body,
          "});",
        ),
      ),
  }),
});

export const schedule = defineNode({
  type: "core.schedule",
  label: "Schedule",
  description: "Runs on a cron schedule, such as every day at 9:00, in the time zone you choose.",
  category: "trigger",
  icon: "CalendarClock",
  platforms: both,
  inputs: [],
  outputs: [next, { id: "time", label: "Time", type: "string" }],
  fields: [
    {
      id: "cron",
      static: true,
      label: "Cron",
      kind: "text",
      required: true,
      default: "0 9 * * *",
      help: "minute hour day month weekday. Examples: */15 * * * * (every 15 minutes), 0 18 * * 5 (Fridays at 18:00).",
    },
    { id: "timezone", static: true, label: "Time zone", kind: "text", default: "UTC", placeholder: "Asia/Riyadh" },
  ],
  trigger: (ctx) => {
    const cron = String(ctx.field("cron") ?? "").trim();
    if (cron.split(/\s+/).length !== 5) ctx.fail("A cron needs five parts: minute hour day month weekday.");
    const zone = String(ctx.field("timezone") ?? "").trim() || "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
    } catch {
      ctx.fail(`${zone} is not a known time zone. Use a name like Europe/London.`);
    }
    const run = ctx.helper("schedule");
    return {
      file: `schedule-${ctx.node.id}`,
      order: 3,
      scope: { context: "none", vars: { time: "time" } },
      wrap: (body) => register(ctx, onReady(ctx, block(`${run}(${JSON.stringify(cron)}, ${JSON.stringify(zone)}, async (time) => {`, body, "});"))),
    };
  },
});

export const webhook = defineNode({
  type: "core.webhook",
  label: "Incoming webhook",
  description: "Runs when another service sends an HTTP request to the bot, such as a payment, a form or a GitHub event.",
  category: "trigger",
  icon: "Webhook",
  platforms: both,
  inputs: [],
  outputs: [
    next,
    { id: "body", label: "Body", type: "any" },
    { id: "query", label: "Query", type: "any" },
    { id: "headers", label: "Headers", type: "any" },
  ],
  fields: [
    { id: "path", static: true, label: "Path", kind: "text", required: true, default: "/hooks/my-hook", placeholder: "/hooks/github" },
    {
      id: "method",
      label: "Method",
      kind: "select",
      default: "POST",
      options: [
        { value: "POST", label: "POST" },
        { value: "GET", label: "GET" },
        { value: "ANY", label: "Any method" },
      ],
    },
    {
      id: "secret",
      static: true,
      label: "Secret variable",
      kind: "text",
      placeholder: "WEBHOOK_SECRET",
      help: "Optional. When set, callers must send the value of this secret in the X-Webhook-Secret header.",
    },
  ],
  trigger: (ctx) => {
    const path = String(ctx.field("path") ?? "").trim();
    if (!/^\/[\w\-/.]*$/.test(path)) ctx.fail("The path starts with / and uses letters, digits, -, _ and /.");
    if (path === "/health") ctx.fail("/health is reserved for the health check.");
    const secret = String(ctx.field("secret") ?? "").trim();
    if (secret && !/^[A-Z_][A-Z0-9_]*$/.test(secret)) ctx.fail("The secret variable uses capitals, digits and _, like WEBHOOK_SECRET.");
    const route = ctx.helper("http");
    const options = JSON.stringify({ method: ctx.field("method") ?? "POST", secret: secret || undefined });
    return {
      file: `webhook-${ctx.node.id}`,
      order: 3,
      scope: { context: "none", vars: { body: "body", query: "query", headers: "headers" } },
      wrap: (body) => register(ctx, block(`${route}.on(${JSON.stringify(path)}, ${options}, async ({ body, query, headers }) => {`, body, "});")),
    };
  },
});

export const regex = defineNode({
  type: "core.regex",
  label: "Regex",
  description: "Tests, finds or replaces text with a regular expression.",
  category: "data",
  icon: "Regex",
  platforms: both,
  inputs: [execIn, { id: "text", label: "Text", type: "string" }],
  outputs: [
    next,
    { id: "matched", label: "Matched", type: "boolean" },
    { id: "match", label: "First match", type: "string" },
    { id: "groups", label: "Groups", type: "list" },
    { id: "all", label: "All matches", type: "list" },
    { id: "result", label: "Replaced text", type: "string" },
  ],
  fields: [
    { id: "text", label: "Text", kind: "text" },
    { id: "pattern", static: true, label: "Pattern", kind: "text", required: true, placeholder: "(\\d+)\\s*coins" },
    { id: "flags", static: true, label: "Flags", kind: "text", default: "i", placeholder: "gim" },
    { id: "replace", label: "Replace with", kind: "text", placeholder: "$1 points", help: "Optional. $1 is the first group." },
  ],
  emit: (ctx) => {
    const pattern = String(ctx.field("pattern") ?? "");
    const flags = String(ctx.field("flags") ?? "").replace(/[^dgimsuy]/g, "");
    try {
      new RegExp(pattern, flags);
    } catch (error) {
      ctx.fail(`The pattern is not valid: ${(error as Error).message}`);
    }
    const source = ctx.out("source");
    const expression = `new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags.replace("g", ""))})`;
    const found = ctx.out("found");
    return [
      `const ${source} = String(${ctx.value("text")} ?? "");`,
      `const ${found} = ${source}.match(${expression});`,
      `const ${ctx.out("matched")} = ${found} !== null;`,
      `const ${ctx.out("match")} = ${found}?.[0] ?? "";`,
      `const ${ctx.out("groups")} = ${found} ? ${found}.slice(1) : [];`,
      `const ${ctx.out("all")} = [...${source}.matchAll(new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags.includes("g") ? flags : `${flags}g`)}))].map((item) => item[0]);`,
      `const ${ctx.out("result")} = ${source}.replace(new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags)}), ${ctx.value("replace")});`,
    ].join("\n");
  },
});

const UNITS = [
  { value: "seconds", label: "Seconds" },
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
];

export const dateMath = defineNode({
  type: "core.date",
  label: "Date and time",
  description: "Takes a date (or now), adds time to it, and formats it for people or for Discord timestamps.",
  category: "data",
  icon: "CalendarDays",
  platforms: both,
  inputs: [{ id: "date", label: "Date", type: "any", optional: true }],
  outputs: [
    { id: "date", label: "Date", type: "any" },
    { id: "text", label: "Text", type: "string" },
    { id: "iso", label: "ISO", type: "string" },
    { id: "unix", label: "Unix seconds", type: "number" },
    { id: "relative", label: "Discord relative", type: "string" },
  ],
  fields: [
    { id: "add", label: "Add", kind: "number", default: 0, help: "Use a negative number to go back in time." },
    { id: "unit", label: "Unit", kind: "select", default: "minutes", options: UNITS },
    { id: "timezone", static: true, label: "Time zone", kind: "text", default: "UTC" },
    {
      id: "style",
      label: "Text style",
      kind: "select",
      default: "medium",
      options: [
        { value: "short", label: "Short (1/2/26, 9:00 AM)" },
        { value: "medium", label: "Medium (Jan 2, 2026, 9:00 AM)" },
        { value: "long", label: "Long (January 2, 2026 at 9:00 AM UTC)" },
        { value: "date", label: "Date only" },
        { value: "time", label: "Time only" },
      ],
    },
  ],
  expression: (ctx, output) => {
    const seconds = { seconds: 1, minutes: 60, hours: 3600, days: 86400, weeks: 604800 }[String(ctx.field("unit") ?? "minutes")] ?? 60;
    const base = ctx.connected("date") ? `new Date(${ctx.value("date")})` : "new Date()";
    const date = `new Date(${base}.getTime() + Number(${ctx.value("add")}) * ${seconds * 1000})`;
    const zone = JSON.stringify(String(ctx.field("timezone") ?? "").trim() || "UTC");
    const style = String(ctx.field("style") ?? "medium");
    const options =
      style === "date"
        ? `{ dateStyle: "medium", timeZone: ${zone} }`
        : style === "time"
          ? `{ timeStyle: "short", timeZone: ${zone} }`
          : `{ dateStyle: ${JSON.stringify(style)}, timeStyle: ${JSON.stringify(style === "long" ? "long" : "short")}, timeZone: ${zone} }`;
    switch (output) {
      case "text":
        return `new Intl.DateTimeFormat("en-US", ${options}).format(${date})`;
      case "iso":
        return `${date}.toISOString()`;
      case "unix":
        return `Math.floor(${date}.getTime() / 1000)`;
      case "relative":
        return `\`<t:\${Math.floor(${date}.getTime() / 1000)}:R>\``;
      default:
        return date;
    }
  },
});

export const numberFormat = defineNode({
  type: "core.numberFormat",
  label: "Format number",
  description: "Rounds a number and formats it with separators, as currency, percent or compact (1.2K).",
  category: "data",
  icon: "Hash",
  platforms: both,
  inputs: [{ id: "number", label: "Number", type: "number" }],
  outputs: [{ id: "text", label: "Text", type: "string" }],
  fields: [
    { id: "number", label: "Number", kind: "number", default: 0 },
    {
      id: "style",
      label: "Style",
      kind: "select",
      default: "decimal",
      options: [
        { value: "decimal", label: "1,234.5" },
        { value: "compact", label: "1.2K" },
        { value: "percent", label: "45%" },
        { value: "currency", label: "Currency" },
      ],
    },
    { id: "digits", label: "Decimals", kind: "number", default: 0, min: 0, max: 10 },
    { id: "currency", static: true, label: "Currency code", kind: "text", default: "USD" },
    { id: "locale", static: true, label: "Locale", kind: "text", default: "en-US", placeholder: "ar-SA" },
  ],
  expression: (ctx) => {
    const style = String(ctx.field("style") ?? "decimal");
    const digits = Math.max(0, Math.min(10, Number(ctx.field("digits")) || 0));
    const options: Record<string, unknown> = { maximumFractionDigits: digits };
    if (style === "compact") options.notation = "compact";
    else if (style === "percent") options.style = "percent";
    else if (style === "currency") Object.assign(options, { style: "currency", currency: String(ctx.field("currency") ?? "USD").trim() || "USD" });
    const locale = JSON.stringify(String(ctx.field("locale") ?? "").trim() || "en-US");
    return `new Intl.NumberFormat(${locale}, ${JSON.stringify(options)}).format(Number(${ctx.value("number")}))`;
  },
});

export const listTools = defineNode({
  type: "core.listTools",
  label: "Filter and sort list",
  description: "Keeps the items that pass a test, sorts them and takes the first few. item is each entry in the expressions.",
  category: "data",
  icon: "ListFilter",
  platforms: both,
  inputs: [{ id: "list", label: "List", type: "list" }],
  outputs: [
    { id: "list", label: "List", type: "list" },
    { id: "count", label: "Count", type: "number" },
    { id: "first", label: "First", type: "any" },
  ],
  fields: [
    { id: "filter", static: true, label: "Keep when", kind: "expression", placeholder: "item.score > 10" },
    { id: "sortBy", static: true, label: "Sort by", kind: "expression", placeholder: "item.score" },
    {
      id: "order",
      label: "Order",
      kind: "select",
      default: "desc",
      options: [
        { value: "desc", label: "Highest first" },
        { value: "asc", label: "Lowest first" },
      ],
    },
    { id: "limit", label: "Take", kind: "number", default: 0, min: 0, help: "0 keeps every item." },
  ],
  expression: (ctx, output) => {
    const filter = String(ctx.field("filter") ?? "").trim();
    const sortBy = String(ctx.field("sortBy") ?? "").trim();
    const sign = ctx.field("order") === "asc" ? 1 : -1;
    let list = `Array.from(${ctx.value("list")} ?? [])`;
    if (filter) list += `.filter((item, index) => (${filter}))`;
    if (sortBy) {
      list += `.map((item) => [item, (${sortBy})]).sort(([, a], [, b]) => (a > b ? ${sign} : a < b ? ${-sign} : 0)).map(([item]) => item)`;
    }
    list = `${list}.slice(0, Number(${ctx.value("limit")}) || undefined)`;
    if (output === "count") return `${list}.length`;
    if (output === "first") return `${list}[0]`;
    return list;
  },
});

export const waitForReply = defineNode({
  type: "core.waitForReply",
  label: "Wait for reply",
  description: "Pauses the flow until the same user sends a message in the same chat, or the time runs out.",
  category: "logic",
  icon: "MessageCircleQuestion",
  platforms: both,
  inputs: [
    execIn,
    { id: "user", label: "From user", type: "user", optional: true },
    { id: "channel", label: "In channel", type: "any", optional: true, variants: { telegram: { label: "In chat" } } },
  ],
  outputs: [
    { id: "next", label: "Replied", type: "exec" },
    { id: "timeout", label: "Timed out", type: "exec" },
    { id: "reply", label: "Reply message", type: "message" },
    { id: "text", label: "Reply text", type: "string" },
  ],
  fields: [{ id: "seconds", label: "Wait up to (seconds)", kind: "number", default: 60, min: 5, max: 3600 }],
  requires: {
    discord: { intents: ["GuildMessages", "MessageContent", "DirectMessages"], partials: ["Channel"] },
  },
  emit: (ctx) => {
    const user = ctx.value("user");
    if (user === "undefined") ctx.fail("Connect From user; this trigger has no user.");
    let channel = ctx.value("channel");
    if (channel === "undefined" && ctx.platform === "telegram") channel = ctx.trigger.vars.chat ?? "undefined";
    if (channel === "undefined") ctx.fail(`Connect ${ctx.platform === "discord" ? "In channel" : "In chat"}; this trigger has none.`);
    const ms = `Math.max(5, Number(${ctx.value("seconds")})) * 1000`;
    const reply = ctx.out("reply");
    const timeout = ctx.branch("timeout");
    const expired = timeout ? block(`if (!${reply}) {`, `${timeout}\nreturn;`) : `if (!${reply}) return;`;
    if (ctx.platform === "discord") {
      const target = ctx.out("target");
      return [
        `const ${target} = ${ctx.helper("resolveChannel")}(client, ${channel});`,
        `const ${reply} = (await (await ${target}).awaitMessages({ filter: (message) => message.author.id === (${user}?.id ?? ${user}), max: 1, time: ${ms} })).first();`,
        expired,
        `const ${ctx.out("text")} = ${reply}.content;`,
      ].join("\n");
    }
    return [
      `const ${reply} = await ${ctx.helper("replies")}.wait(${ctx.helper("chatId")}(${channel}), ${user}?.id ?? ${user}, ${ms});`,
      expired,
      `const ${ctx.out("text")} = ${reply}.text ?? ${reply}.caption ?? "";`,
    ].join("\n");
  },
});

export const note = defineNode({
  type: "core.note",
  label: "Note",
  description: "A sticky note to explain part of the flow. It does nothing when the bot runs.",
  category: "code",
  icon: "StickyNote",
  platforms: both,
  inputs: [],
  outputs: [],
  fields: [
    { id: "text", static: true, label: "Text", kind: "text", multiline: true, default: "Write a note" },
    {
      id: "color",
      label: "Color",
      kind: "select",
      default: "yellow",
      options: [
        { value: "yellow", label: "Yellow" },
        { value: "blue", label: "Blue" },
        { value: "green", label: "Green" },
        { value: "pink", label: "Pink" },
      ],
    },
  ],
});

export const extraNodes = [note, tryNode, repeatWhile, manual, schedule, webhook, regex, dateMath, numberFormat, listTools, waitForReply];
