import { indent, itemPort, lines, slug } from "../util.js";
import { block, defineNode, execIn, isFilled, next, requireRepliable } from "./common.js";

const both = ["discord", "telegram"] as const;

export const ready = defineNode({
  type: "core.ready",
  label: "Bot ready",
  description: "Runs once when the bot connects.",
  category: "trigger",
  icon: "Power",
  platforms: both,
  inputs: [],
  outputs: [next],
  fields: [],
  trigger: (ctx) => ({
    file: `ready-${ctx.node.id}`,
    order: 3,
    scope: { context: "none", vars: {} },
    wrap: (body) =>
      ctx.platform === "discord"
        ? block(
            "export default function register(client) {",
            block(`client.once(${ctx.use("Events")}.ClientReady, async () => {`, body, "});"),
          )
        : block("export default function register(bot, events) {", block("events.onReady(async () => {", body, "});")),
  }),
});

export const interval = defineNode({
  type: "core.interval",
  label: "Every interval",
  description: "Runs repeatedly while the bot is online.",
  category: "trigger",
  icon: "Clock",
  platforms: both,
  inputs: [],
  outputs: [next],
  fields: [{ id: "minutes", label: "Every (minutes)", kind: "number", default: 60, min: 1, required: true }],
  trigger: (ctx) => {
    const ms = Math.max(1, Number(ctx.field("minutes")) || 1) * 60_000;
    const loop = (body: string) => block("setInterval(async () => {", body, `}, ${ms});`);
    return {
      file: `interval-${ctx.node.id}`,
      order: 3,
      scope: { context: "none", vars: {} },
      wrap: (body) =>
        ctx.platform === "discord"
          ? block(
              "export default function register(client) {",
              block(`client.once(${ctx.use("Events")}.ClientReady, () => {`, loop(body), "});"),
            )
          : block("export default function register(bot, events) {", block("events.onReady(() => {", loop(body), "});")),
    };
  },
});

export const reply = defineNode({
  type: "core.reply",
  label: "Reply",
  description: "Replies to the message or interaction that started this flow, or to one you connect to Reply to.",
  category: "action",
  icon: "Reply",
  platforms: both,
  inputs: [
    execIn,
    { id: "text", label: "Text", type: "string" },
    {
      id: "replyTo",
      label: "Reply to",
      type: "any",
      optional: true,
      variants: { telegram: { label: "Reply to (context)" } },
    },
  ],
  outputs: [next, { id: "message", label: "Message", type: "message" }],
  fields: [
    {
      id: "text",
      label: "Text",
      kind: "text",
      multiline: true,
      required: true,
      placeholder: "Hello {{ user.username }}",
      variants: { telegram: { placeholder: "Hello {{ user.first_name }}" } },
    },
    {
      id: "private",
      label: "Only visible to the user",
      kind: "boolean",
      default: false,
      platforms: ["discord"],
      help: "Works when replying to a command, button, menu or form.",
    },
    {
      id: "format",
      label: "Formatting",
      kind: "select",
      platforms: ["telegram"],
      default: "",
      options: [
        { value: "", label: "Plain text" },
        { value: "HTML", label: "HTML" },
        { value: "MarkdownV2", label: "MarkdownV2" },
      ],
    },
  ],
  emit: (ctx) => {
    const target = ctx.value("replyTo");
    const saved = target !== "undefined";
    if (!saved) requireRepliable(ctx, "Reply");
    const text = ctx.value("text");
    if (ctx.platform === "telegram") {
      const mode = String(ctx.field("format") ?? "");
      const extra = mode === "HTML" || mode === "MarkdownV2" ? `, { parse_mode: "${mode}" }` : "";
      return `const ${ctx.out("message")} = await ${saved ? target : "ctx"}.reply(${text}${extra});`;
    }
    const payload =
      (saved || ctx.trigger.context === "interaction") && ctx.field("private") === true
        ? `{ content: ${text}, flags: ${ctx.use("MessageFlags")}.Ephemeral }`
        : `{ content: ${text} }`;
    return `const ${ctx.out("message")} = await ${ctx.helper("respond")}(${saved ? target : "source"}, ${payload});`;
  },
});

export const sendMessage = defineNode({
  type: "core.sendMessage",
  label: "Send message",
  description: "Sends a message somewhere else. Without an ID it uses the place the flow started in.",
  category: "action",
  icon: "Send",
  platforms: both,
  inputs: [
    execIn,
    { id: "channel", label: "Channel", type: "channel", variants: { telegram: { label: "Chat" } } },
    { id: "text", label: "Text", type: "string" },
  ],
  outputs: [next, { id: "message", label: "Message", type: "message" }],
  fields: [
    { id: "channel", label: "Channel ID", kind: "text", variants: { telegram: { label: "Chat ID" } } },
    { id: "text", label: "Text", kind: "text", multiline: true, required: true },
  ],
  emit: (ctx) => {
    const text = ctx.value("text");
    const variable = ctx.platform === "telegram" ? "chat" : "channel";
    if (!isFilled(ctx, "channel") && !ctx.trigger.vars[variable]) ctx.fail("Set a channel or chat ID for Send message.");
    const target = ctx.platform === "telegram" && !isFilled(ctx, "channel") ? "chat" : ctx.value("channel");
    if (ctx.platform === "telegram") {
      return `const ${ctx.out("message")} = await bot.api.sendMessage(${ctx.helper("chatId")}(${target}), ${text});`;
    }
    return `const ${ctx.out("message")} = await (await ${ctx.helper("resolveChannel")}(client, ${target})).send(${text});`;
  },
});

export const log = defineNode({
  type: "core.log",
  label: "Log",
  description: "Writes a line to the bot console.",
  category: "action",
  icon: "ScrollText",
  platforms: both,
  inputs: [execIn, { id: "text", label: "Text", type: "string" }],
  outputs: [next],
  fields: [{ id: "text", label: "Text", kind: "text", required: true }],
  emit: (ctx) => `console.log(${ctx.value("text")});`,
});

export const delay = defineNode({
  type: "core.delay",
  label: "Wait",
  description: "Pauses the flow.",
  category: "logic",
  icon: "Timer",
  platforms: both,
  inputs: [execIn],
  outputs: [next],
  fields: [{ id: "seconds", label: "Seconds", kind: "number", default: 1, min: 0 }],
  emit: (ctx) => `await ${ctx.helper("sleep")}(Math.max(0, Number(${ctx.value("seconds")})) * 1000);`,
});

export const branch = defineNode({
  type: "core.if",
  label: "If",
  description: "Runs one of two paths depending on a condition.",
  category: "logic",
  icon: "Split",
  platforms: both,
  inputs: [execIn, { id: "condition", label: "Condition", type: "boolean" }],
  outputs: [
    { id: "true", label: "True", type: "exec" },
    { id: "false", label: "False", type: "exec" },
  ],
  fields: [
    {
      id: "condition",
      label: "Condition",
      kind: "expression",
      required: true,
      placeholder: "user.bot === false",
      help: "A JavaScript expression. Used when the Condition input is not connected.",
    },
  ],
  emit: (ctx) => {
    const whenTrue = ctx.branch("true");
    const whenFalse = ctx.branch("false");
    const condition = ctx.value("condition");
    if (!whenFalse) return block(`if (${condition}) {`, whenTrue || "// nothing to do");
    if (!whenTrue) return block(`if (!(${condition})) {`, whenFalse);
    return `if (${condition}) {\n${indent(whenTrue, 2)}\n} else {\n${indent(whenFalse, 2)}\n}`;
  },
});

function caseId(value: string, index: number): string {
  return `case_${slug(value).replace(/-/g, "_").slice(0, 24) || index}`;
}

export const switchNode = defineNode({
  type: "core.switch",
  label: "Switch",
  description: "Picks a path by matching a value against a list of cases.",
  category: "logic",
  icon: "GitBranch",
  platforms: both,
  inputs: [execIn, { id: "value", label: "Value", type: "any" }],
  outputs: [{ id: "default", label: "No match", type: "exec" }],
  fields: [
    { id: "value", label: "Value", kind: "text", required: true },
    { id: "cases", static: true, label: "Cases", kind: "text", multiline: true, required: true, placeholder: "red\nblue\ngreen", help: "One value per line. Each case gets its own output." },
    { id: "ignoreCase", label: "Ignore upper and lower case", kind: "boolean", default: true },
  ],
  ports: (data) => ({
    outputs: lines(String(data.cases ?? ""))
      .slice(0, 20)
      .map((value, index) => ({ id: caseId(value, index), label: value, type: "exec" as const })),
  }),
  emit: (ctx) => {
    const cases = lines(String(ctx.field("cases") ?? "")).slice(0, 20);
    const ignoreCase = ctx.field("ignoreCase") !== false;
    const subject = ctx.out("subject");
    const parts = [`const ${subject} = String(${ctx.value("value")})${ignoreCase ? ".toLowerCase()" : ""};`];
    let first = true;
    for (const [index, value] of cases.entries()) {
      const body = ctx.branch(caseId(value, index));
      const match = JSON.stringify(ignoreCase ? value.toLowerCase() : value);
      parts.push(`${first ? "if" : "} else if"} (${subject} === ${match}) {`, indent(body || "// nothing to do", 2));
      first = false;
    }
    const fallback = ctx.branch("default");
    if (first) return [...parts, fallback].filter(Boolean).join("\n");
    if (fallback) parts.push("} else {", indent(fallback, 2));
    parts.push("}");
    return parts.join("\n");
  },
});

export const forEach = defineNode({
  type: "core.forEach",
  label: "For each",
  description: "Runs the Each path once per item in a list, then continues with Done.",
  category: "logic",
  icon: "Repeat",
  platforms: both,
  inputs: [execIn, { id: "list", label: "List", type: "any" }],
  outputs: [
    { id: "each", label: "Each", type: "exec" },
    { id: "item", label: "Item", type: "any", scoped: "each" },
    { id: "index", label: "Index", type: "number", scoped: "each" },
    { id: "next", label: "Done", type: "exec" },
  ],
  fields: [
    { id: "list", label: "Items", kind: "text", multiline: true, help: "Used when List is not connected. One item per line." },
  ],
  emit: (ctx) => {
    const source = ctx.connected("list")
      ? `Array.from(${ctx.value("list")} ?? [])`
      : JSON.stringify(lines(String(ctx.field("list") ?? "")));
    const item = ctx.declare("item");
    const index = ctx.declare("index");
    const body = ctx.branch("each");
    return block(`for (const [${index}, ${item}] of ${source}.entries()) {`, body || "// nothing to do");
  },
});

export const cooldown = defineNode({
  type: "core.cooldown",
  label: "Cooldown",
  description: "Lets a path run once per user every few seconds. Extra runs go to Blocked.",
  category: "logic",
  icon: "Hourglass",
  platforms: both,
  inputs: [execIn],
  outputs: [
    { id: "next", label: "Allowed", type: "exec" },
    { id: "blocked", label: "Blocked", type: "exec" },
    { id: "remaining", label: "Seconds left", type: "number" },
  ],
  fields: [
    { id: "seconds", label: "Seconds", kind: "number", default: 10, min: 1 },
    { id: "key", label: "Per", kind: "text", default: "{{ user.id }}", help: "Each different value has its own cooldown." },
  ],
  emit: (ctx) => {
    const remaining = ctx.declare("remaining");
    const blocked = ctx.branch("blocked");
    const key = `${JSON.stringify(`${ctx.node.id}:`)} + ${ctx.value("key")}`;
    return [
      `const ${remaining} = ${ctx.helper("cooldown")}(${key}, Math.max(1, Number(${ctx.value("seconds")})));`,
      block(`if (${remaining} > 0) {`, [blocked, "return;"].filter(Boolean).join("\n")),
    ].join("\n");
  },
});

export const stop = defineNode({
  type: "core.stop",
  label: "Stop",
  description: "Ends the flow here.",
  category: "logic",
  icon: "OctagonX",
  platforms: both,
  inputs: [execIn],
  outputs: [],
  fields: [],
  emit: () => "return;",
});

const operators: Record<string, (a: string, b: string) => string> = {
  equals: (a, b) => `String(${a}) === String(${b})`,
  notEquals: (a, b) => `String(${a}) !== String(${b})`,
  greater: (a, b) => `Number(${a}) > Number(${b})`,
  less: (a, b) => `Number(${a}) < Number(${b})`,
  contains: (a, b) => `String(${a}).toLowerCase().includes(String(${b}).toLowerCase())`,
  startsWith: (a, b) => `String(${a}).toLowerCase().startsWith(String(${b}).toLowerCase())`,
  empty: (a) => `${a} === undefined || ${a} === null || String(${a}).trim() === ""`,
};

export const compare = defineNode({
  type: "core.compare",
  label: "Compare",
  description: "Compares two values.",
  category: "logic",
  icon: "Equal",
  platforms: both,
  inputs: [
    { id: "a", label: "A", type: "any" },
    { id: "b", label: "B", type: "any" },
  ],
  outputs: [{ id: "result", label: "Result", type: "boolean" }],
  fields: [
    { id: "a", label: "A", kind: "text" },
    {
      id: "operator",
      label: "Operator",
      kind: "select",
      default: "equals",
      options: [
        { value: "equals", label: "equals" },
        { value: "notEquals", label: "does not equal" },
        { value: "greater", label: "is greater than" },
        { value: "less", label: "is less than" },
        { value: "contains", label: "contains" },
        { value: "startsWith", label: "starts with" },
        { value: "empty", label: "is empty" },
      ],
    },
    { id: "b", label: "B", kind: "text" },
  ],
  expression: (ctx) => {
    const operator = operators[String(ctx.field("operator"))] ?? operators.equals;
    return operator(ctx.value("a"), ctx.value("b"));
  },
});

export const logic = defineNode({
  type: "core.logic",
  label: "And / Or / Not",
  description: "Combines true and false values.",
  category: "logic",
  icon: "Binary",
  platforms: both,
  inputs: [
    { id: "a", label: "A", type: "boolean" },
    { id: "b", label: "B", type: "boolean", optional: true },
  ],
  outputs: [{ id: "result", label: "Result", type: "boolean" }],
  fields: [
    {
      id: "operator",
      label: "Operator",
      kind: "select",
      default: "and",
      options: [
        { value: "and", label: "A and B" },
        { value: "or", label: "A or B" },
        { value: "not", label: "Not A" },
      ],
    },
  ],
  expression: (ctx) => {
    const a = `Boolean(${ctx.value("a")})`;
    if (ctx.field("operator") === "not") return `!${a}`;
    return `${a} ${ctx.field("operator") === "or" ? "||" : "&&"} Boolean(${ctx.value("b")})`;
  },
});

export const text = defineNode({
  type: "core.text",
  label: "Text",
  description: "Builds a string. Use {{ expression }} to insert values.",
  category: "data",
  icon: "Type",
  platforms: both,
  inputs: [],
  outputs: [{ id: "text", label: "Text", type: "string" }],
  fields: [{ id: "text", label: "Text", kind: "text", multiline: true }],
  expression: (ctx) => ctx.value("text"),
});

const TEXT_OPERATIONS: Record<string, (value: string, argument: string) => string> = {
  upper: (value) => `String(${value}).toUpperCase()`,
  lower: (value) => `String(${value}).toLowerCase()`,
  trim: (value) => `String(${value}).trim()`,
  length: (value) => `String(${value}).length`,
  words: (value) => `String(${value}).trim().split(/\\s+/).filter(Boolean)`,
  split: (value, argument) => `String(${value}).split(${argument})`,
  replace: (value, argument) => `String(${value}).replaceAll(${argument}.split("=>")[0], ${argument}.split("=>")[1] ?? "")`,
  join: (value, argument) => `Array.from(${value} ?? []).join(${argument})`,
};

export const textTools = defineNode({
  type: "core.textTools",
  label: "Text tools",
  description: "Changes case, trims, splits, joins or replaces text.",
  category: "data",
  icon: "CaseSensitive",
  platforms: both,
  inputs: [{ id: "value", label: "Value", type: "any" }],
  outputs: [{ id: "result", label: "Result", type: "any" }],
  fields: [
    {
      id: "operation",
      label: "Operation",
      kind: "select",
      default: "upper",
      options: [
        { value: "upper", label: "UPPERCASE" },
        { value: "lower", label: "lowercase" },
        { value: "trim", label: "Trim spaces" },
        { value: "length", label: "Length" },
        { value: "words", label: "Split into words" },
        { value: "split", label: "Split by separator" },
        { value: "join", label: "Join list with separator" },
        { value: "replace", label: "Replace (old=>new)" },
      ],
    },
    { id: "value", label: "Value", kind: "text" },
    { id: "argument", label: "Separator or old=>new", kind: "text", default: "," },
  ],
  expression: (ctx) => {
    const operation = TEXT_OPERATIONS[String(ctx.field("operation"))] ?? TEXT_OPERATIONS.upper;
    return operation(ctx.value("value"), ctx.value("argument"));
  },
});

const MATH: Record<string, (a: string, b: string) => string> = {
  add: (a, b) => `Number(${a}) + Number(${b})`,
  subtract: (a, b) => `Number(${a}) - Number(${b})`,
  multiply: (a, b) => `Number(${a}) * Number(${b})`,
  divide: (a, b) => `Number(${a}) / Number(${b})`,
  modulo: (a, b) => `Number(${a}) % Number(${b})`,
  power: (a, b) => `Number(${a}) ** Number(${b})`,
  min: (a, b) => `Math.min(Number(${a}), Number(${b}))`,
  max: (a, b) => `Math.max(Number(${a}), Number(${b}))`,
  round: (a) => `Math.round(Number(${a}))`,
  floor: (a) => `Math.floor(Number(${a}))`,
};

export const math = defineNode({
  type: "core.math",
  label: "Math",
  description: "Adds, subtracts, multiplies, rounds and more.",
  category: "data",
  icon: "Calculator",
  platforms: both,
  inputs: [
    { id: "a", label: "A", type: "number" },
    { id: "b", label: "B", type: "number" },
  ],
  outputs: [{ id: "result", label: "Result", type: "number" }],
  fields: [
    { id: "a", label: "A", kind: "number", default: 0 },
    {
      id: "operator",
      label: "Operation",
      kind: "select",
      default: "add",
      options: [
        { value: "add", label: "A + B" },
        { value: "subtract", label: "A − B" },
        { value: "multiply", label: "A × B" },
        { value: "divide", label: "A ÷ B" },
        { value: "modulo", label: "Remainder of A ÷ B" },
        { value: "power", label: "A to the power of B" },
        { value: "min", label: "Smaller of A and B" },
        { value: "max", label: "Larger of A and B" },
        { value: "round", label: "Round A" },
        { value: "floor", label: "Round A down" },
      ],
    },
    { id: "b", label: "B", kind: "number", default: 0 },
  ],
  expression: (ctx) => (MATH[String(ctx.field("operator"))] ?? MATH.add)(ctx.value("a"), ctx.value("b")),
});

export const random = defineNode({
  type: "core.random",
  label: "Random number",
  description: "A whole number between min and max, inclusive.",
  category: "data",
  icon: "Dices",
  platforms: both,
  inputs: [],
  outputs: [{ id: "value", label: "Value", type: "number" }],
  fields: [
    { id: "min", label: "Min", kind: "number", default: 1 },
    { id: "max", label: "Max", kind: "number", default: 100 },
  ],
  expression: (ctx) => {
    return `((min, max) => Math.floor(Math.random() * (Math.max(min, max) - min + 1)) + min)(Math.floor(Number(${ctx.value("min")})), Math.floor(Number(${ctx.value("max")})))`;
  },
});

export const pick = defineNode({
  type: "core.pick",
  label: "Random pick",
  description: "Picks one item at random from a list.",
  category: "data",
  icon: "Shuffle",
  platforms: both,
  inputs: [{ id: "list", label: "List", type: "any" }],
  outputs: [{ id: "item", label: "Item", type: "any" }],
  fields: [{ id: "list", label: "Items", kind: "text", multiline: true, placeholder: "Heads\nTails", help: "One item per line, used when List is not connected." }],
  expression: (ctx) => {
    const list = ctx.connected("list") ? `Array.from(${ctx.value("list")})` : JSON.stringify(lines(String(ctx.field("list") ?? "")));
    return `((items) => items[Math.floor(Math.random() * items.length)])(${list})`;
  },
});

export const jsonValue = defineNode({
  type: "core.jsonValue",
  label: "Get property",
  description: "Reads a value from an object, such as an HTTP response, by path.",
  category: "data",
  icon: "Braces",
  platforms: both,
  inputs: [{ id: "object", label: "Object", type: "any" }],
  outputs: [{ id: "value", label: "Value", type: "any" }],
  fields: [{ id: "path", static: true, label: "Path", kind: "text", required: true, placeholder: "data.items.0.name" }],
  expression: (ctx) => {
    const path = String(ctx.field("path") ?? "")
      .split(".")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => `?.[${/^\d+$/.test(part) ? part : JSON.stringify(part)}]`)
      .join("");
    return `${ctx.value("object")}${path}`;
  },
});

const DATE_FORMATS: Record<string, string> = {
  iso: "new Date().toISOString()",
  date: "new Date().toLocaleDateString()",
  time: "new Date().toLocaleTimeString()",
  full: "new Date().toLocaleString()",
  unix: "Math.floor(Date.now() / 1000)",
  relative: "`<t:${Math.floor(Date.now() / 1000)}:R>`",
};

export const now = defineNode({
  type: "core.now",
  label: "Date and time",
  description: "The current date or time in a chosen format.",
  category: "data",
  icon: "CalendarClock",
  platforms: both,
  inputs: [],
  outputs: [{ id: "value", label: "Value", type: "string" }],
  fields: [
    {
      id: "format",
      label: "Format",
      kind: "select",
      default: "full",
      options: [
        { value: "full", label: "Date and time" },
        { value: "date", label: "Date" },
        { value: "time", label: "Time" },
        { value: "iso", label: "ISO 8601" },
        { value: "unix", label: "Unix seconds" },
        { value: "relative", label: "Relative time (in 5 minutes)", platforms: ["discord"] },
      ],
    },
  ],
  expression: (ctx) => DATE_FORMATS[String(ctx.field("format"))] ?? DATE_FORMATS.full,
});

export const setValue = defineNode({
  type: "core.setValue",
  label: "Save value",
  description: "Stores a value that survives restarts.",
  category: "data",
  icon: "Save",
  platforms: both,
  inputs: [
    execIn,
    { id: "key", label: "Key", type: "string" },
    { id: "value", label: "Value", type: "any" },
  ],
  outputs: [next],
  fields: [
    { id: "key", label: "Key", kind: "text", required: true, placeholder: "points:{{ user.id }}" },
    { id: "value", label: "Value", kind: "text" },
  ],
  emit: (ctx) => `${ctx.helper("store")}.set(${ctx.value("key")}, ${ctx.value("value")});`,
});

export const getValue = defineNode({
  type: "core.getValue",
  label: "Read value",
  description: "Reads a stored value.",
  category: "data",
  icon: "Database",
  platforms: both,
  inputs: [execIn, { id: "key", label: "Key", type: "string" }],
  outputs: [next, { id: "value", label: "Value", type: "any" }],
  fields: [
    { id: "key", label: "Key", kind: "text", required: true },
    { id: "fallback", label: "Default", kind: "text" },
  ],
  emit: (ctx) => `const ${ctx.out("value")} = ${ctx.helper("store")}.get(${ctx.value("key")}, ${ctx.value("fallback")});`,
});

export const deleteValue = defineNode({
  type: "core.deleteValue",
  label: "Delete value",
  description: "Removes a stored value.",
  category: "data",
  icon: "DatabaseZap",
  platforms: both,
  inputs: [execIn, { id: "key", label: "Key", type: "string" }],
  outputs: [next],
  fields: [{ id: "key", label: "Key", kind: "text", required: true }],
  emit: (ctx) => `${ctx.helper("store")}.delete(${ctx.value("key")});`,
});

export const increment = defineNode({
  type: "core.increment",
  label: "Add to number",
  description: "Adds to a stored number and returns the new total.",
  category: "data",
  icon: "Plus",
  platforms: both,
  inputs: [execIn, { id: "key", label: "Key", type: "string" }],
  outputs: [next, { id: "total", label: "Total", type: "number" }],
  fields: [
    { id: "key", label: "Key", kind: "text", required: true },
    { id: "amount", label: "Amount", kind: "number", default: 1 },
  ],
  emit: (ctx) =>
    `const ${ctx.out("total")} = ${ctx.helper("store")}.increment(${ctx.value("key")}, Number(${ctx.value("amount")}));`,
});

export const http = defineNode({
  type: "core.http",
  label: "HTTP request",
  description: "Calls a URL and returns the response body.",
  category: "data",
  icon: "Globe",
  platforms: both,
  inputs: [execIn, { id: "url", label: "URL", type: "string" }],
  outputs: [
    next,
    { id: "data", label: "Body", type: "any" },
    { id: "status", label: "Status", type: "number" },
  ],
  fields: [
    { id: "url", label: "URL", kind: "text", required: true, placeholder: "https://api.example.com/items" },
    {
      id: "method",
      label: "Method",
      kind: "select",
      default: "GET",
      options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ value, label: value })),
    },
    {
      id: "headers",
      label: "Headers",
      kind: "expression",
      placeholder: '{ authorization: "Bearer " + process.env.API_KEY }',
      help: "An object. Connect a Build object node to assemble it from parts.",
    },
    {
      id: "body",
      label: "JSON body",
      kind: "expression",
      placeholder: "{ name: user.username }",
      variants: { telegram: { placeholder: "{ name: user.first_name }" } },
    },
  ],
  emit: (ctx) => {
    const response = ctx.out("response");
    const method = String(ctx.field("method") || "GET");
    const headers = isFilled(ctx, "headers") ? ctx.value("headers") : "";
    const body = isFilled(ctx, "body") ? ctx.value("body") : "";
    const init = [`method: ${JSON.stringify(method)}`];
    if (body) {
      init.push(`headers: { "content-type": "application/json"${headers ? `, ...${headers}` : ""} }`, `body: JSON.stringify(${body})`);
    } else if (headers) {
      init.push(`headers: ${headers}`);
    }
    return [
      `const ${response} = await fetch(${ctx.value("url")}, { ${init.join(", ")} });`,
      `const ${ctx.out("status")} = ${response}.status;`,
      `const ${ctx.out("data")} = (${response}.headers.get("content-type") ?? "").includes("json")`,
      `  ? await ${response}.json()`,
      `  : await ${response}.text();`,
    ].join("\n");
  },
});

export const code = defineNode({
  type: "core.code",
  label: "JavaScript",
  description: "Runs your own code. Everything in the flow scope is available, and the returned value goes to Result.",
  category: "code",
  icon: "Code",
  platforms: both,
  inputs: [
    execIn,
    { id: "a", label: "a", type: "any", optional: true },
    { id: "b", label: "b", type: "any", optional: true },
  ],
  outputs: [next, { id: "result", label: "Result", type: "any" }],
  fields: [
    {
      id: "code",
      label: "Code",
      kind: "code",
      default: "return a;",
      help: "Async function body. Inputs are available as a and b.",
    },
  ],
  emit: (ctx) => {
    const source = String(ctx.field("code") ?? "").trim() || "return undefined;";
    return block(
      `const ${ctx.out("result")} = await (async (a, b) => {`,
      source,
      `})(${ctx.value("a")}, ${ctx.value("b")});`,
    );
  },
});

export const expression = defineNode({
  type: "core.expression",
  label: "Expression",
  description: "A one-line JavaScript expression as a value.",
  category: "code",
  icon: "SquareFunction",
  platforms: both,
  inputs: [
    { id: "a", label: "a", type: "any", optional: true },
    { id: "b", label: "b", type: "any", optional: true },
  ],
  outputs: [{ id: "result", label: "Result", type: "any" }],
  fields: [{ id: "code", label: "Expression", kind: "expression", required: true, placeholder: "a * 2 + b" }],
  expression: (ctx) => `((a, b) => (${String(ctx.field("code") ?? "").trim() || "undefined"}))(${ctx.value("a")}, ${ctx.value("b")})`,
});

function keyPort(key: string): string {
  return itemPort("k_", key);
}

export const buildObject = defineNode({
  type: "core.object",
  label: "Build object",
  description: "Assembles an object from parts, for an HTTP body, headers or stored data. Each key becomes an input.",
  category: "data",
  icon: "Braces",
  platforms: both,
  inputs: [],
  outputs: [{ id: "object", label: "Object", type: "any" }],
  fields: [
    {
      id: "keys",
      static: true,
      label: "Keys",
      kind: "list",
      itemLabel: "key",
      portPrefix: "k_",
      required: true,
      default: "name",
      help: "Add keys here or with the + on the node. Drop a wire on the node to add a key for it.",
    },
  ],
  ports: (data) => ({
    inputs: lines(String(data.keys ?? "")).map((key) => ({ id: keyPort(key), label: key, type: "any" as const, optional: true })),
  }),
  expression: (ctx) => {
    const keys = lines(String(ctx.field("keys") ?? ""));
    if (keys.length === 0) return "({})";
    return `({ ${keys.map((key) => `${JSON.stringify(key)}: ${ctx.value(keyPort(key))}`).join(", ")} })`;
  },
});

export const buildList = defineNode({
  type: "core.list",
  label: "Build list",
  description: "Collects values into a list. Each item becomes an input.",
  category: "data",
  icon: "ListOrdered",
  platforms: both,
  inputs: [],
  outputs: [
    { id: "list", label: "List", type: "list" },
    { id: "count", label: "Count", type: "number" },
  ],
  fields: [
    { id: "count", static: true, label: "Number of items", kind: "number", default: 3, min: 1, max: 20 },
    { id: "skipEmpty", label: "Leave out empty items", kind: "boolean", default: true },
  ],
  ports: (data) => ({
    inputs: Array.from({ length: Math.min(20, Math.max(1, Number(data.count) || 1)) }, (_, index) => ({
      id: `item_${index + 1}`,
      label: `Item ${index + 1}`,
      type: "any" as const,
      optional: true,
    })),
  }),
  expression: (ctx, output) => {
    const count = Math.min(20, Math.max(1, Number(ctx.field("count")) || 1));
    const items = Array.from({ length: count }, (_, index) => ctx.value(`item_${index + 1}`));
    const list = `[${items.join(", ")}]${ctx.field("skipEmpty") !== false ? ".filter((item) => item !== undefined && item !== null && item !== \"\")" : ""}`;
    return output === "count" ? `${list}.length` : list;
  },
});

export const json = defineNode({
  type: "core.json",
  label: "JSON",
  description: "Turns an object into JSON text, or JSON text back into an object.",
  category: "data",
  icon: "FileJson",
  platforms: both,
  inputs: [{ id: "value", label: "Value", type: "any" }],
  outputs: [{ id: "result", label: "Result", type: "any" }],
  fields: [
    {
      id: "mode",
      label: "Direction",
      kind: "select",
      default: "stringify",
      options: [
        { value: "stringify", label: "Object to JSON text" },
        { value: "parse", label: "JSON text to object" },
      ],
    },
    { id: "pretty", label: "Indent the text", kind: "boolean", default: false },
  ],
  expression: (ctx) =>
    ctx.field("mode") === "parse"
      ? `JSON.parse(String(${ctx.value("value")}))`
      : `JSON.stringify(${ctx.value("value")}${ctx.field("pretty") === true ? ", null, 2" : ""})`,
});

export const remember = defineNode({
  type: "core.remember",
  label: "Remember",
  description: "Keeps a value in memory so another flow can use it later. Leave Value empty to keep the event that started this flow. To reply to an event later, Save interaction is safer.",
  category: "data",
  icon: "BookmarkPlus",
  platforms: both,
  inputs: [execIn, { id: "value", label: "Value (empty = this event)", type: "any", optional: true }],
  outputs: [next],
  fields: [
    { id: "key", label: "Key", kind: "text", required: true, placeholder: "ticket:{{ user.id }}" },
    { id: "minutes", label: "Forget after (minutes, 0 = while running)", kind: "number", default: 15, min: 0 },
  ],
  emit: (ctx) => {
    const custom = ctx.node.data["@value"];
    const given = ctx.connected("value") || (typeof custom === "string" && custom.trim() !== "");
    if (!given && (ctx.trigger.context === "none" || ctx.trigger.context === "member")) {
      ctx.fail("Connect Value. This trigger has no event to remember.");
    }
    const value = given ? ctx.value("value") : ctx.platform === "discord" ? "source" : "ctx";
    return `${ctx.helper("memory")}.set(${ctx.value("key")}, ${value}, Number(${ctx.value("minutes")}));`;
  },
});

export const recall = defineNode({
  type: "core.recall",
  label: "Recall",
  description: "Gets a value kept with Remember. Memory is cleared when the bot restarts; use Save value for data that must last.",
  category: "data",
  icon: "BookmarkCheck",
  platforms: both,
  inputs: [],
  outputs: [
    { id: "value", label: "Value", type: "any" },
    { id: "found", label: "Found", type: "boolean" },
  ],
  fields: [{ id: "key", label: "Key", kind: "text", required: true, placeholder: "ticket:{{ user.id }}" }],
  expression: (ctx, output) => {
    const value = `${ctx.helper("memory")}.get(${ctx.value("key")})`;
    return output === "found" ? `${value} !== undefined` : value;
  },
});

export const forget = defineNode({
  type: "core.forget",
  label: "Forget",
  description: "Removes a value kept with Remember.",
  category: "data",
  icon: "BookmarkX",
  platforms: both,
  inputs: [execIn],
  outputs: [next],
  fields: [{ id: "key", label: "Key", kind: "text", required: true }],
  emit: (ctx) => `${ctx.helper("memory")}.delete(${ctx.value("key")});`,
});

export const saveInteraction = defineNode({
  type: "core.saveInteraction",
  label: "Save interaction",
  description: "Saves the interaction, message or chat this flow started from, so any flow can return to it later, even after a restart.",
  category: "data",
  icon: "BookmarkPlus",
  platforms: both,
  inputs: [execIn, { id: "source", label: "Interaction", type: "any", optional: true, variants: { telegram: { label: "Context" } } }],
  outputs: [next],
  fields: [{ id: "key", label: "Save as", kind: "text", required: true, placeholder: "ticket:{{ user.id }}" }],
  emit: (ctx) => {
    const custom = ctx.connected("source") || ctx.node.data["@source"];
    if (!custom && (ctx.trigger.context === "none" || ctx.trigger.context === "member")) {
      ctx.fail("Save interaction needs a command, button, menu, form or message trigger, or a connected Interaction.");
    }
    const source = custom ? ctx.value("source") : ctx.platform === "discord" ? "source" : "ctx";
    return `await ${ctx.helper("refs")}.save(${ctx.value("key")}, ${source});`;
  },
});

export const loadInteraction = defineNode({
  type: "core.loadInteraction",
  label: "Load interaction",
  description: "Returns to a saved interaction from any flow. Reply, Edit reply and Send embed accept it as their target.",
  category: "data",
  icon: "BookmarkCheck",
  platforms: both,
  inputs: [execIn],
  outputs: [
    next,
    { id: "interaction", label: "Interaction", type: "any", variants: { telegram: { label: "Context" } } },
    { id: "found", label: "Found", type: "boolean" },
    { id: "channel", label: "Channel", type: "channel", variants: { telegram: { label: "Chat" } } },
    { id: "message", label: "Message", type: "message" },
    { id: "user", label: "User", type: "user" },
    { id: "age", label: "Saved (seconds ago)", type: "number" },
  ],
  fields: [{ id: "key", label: "Saved as", kind: "text", required: true, placeholder: "ticket:{{ user.id }}" }],
  emit: (ctx) => {
    const handle = ctx.out("interaction");
    const client = ctx.platform === "discord" ? "client" : "bot";
    return [
      `const ${handle} = await ${ctx.helper("refs")}.load(${client}, ${ctx.value("key")});`,
      `const ${ctx.out("found")} = ${handle} !== null;`,
      `const ${ctx.out("channel")} = ${handle}?.${ctx.platform === "discord" ? "channel" : "chat"} ?? null;`,
      `const ${ctx.out("message")} = ${handle}?.message ?? null;`,
      `const ${ctx.out("user")} = ${handle}?.user ?? null;`,
      `const ${ctx.out("age")} = ${handle} ? Math.round((Date.now() - ${handle}.savedAt) / 1000) : 0;`,
    ].join("\n");
  },
});

export const forgetInteraction = defineNode({
  type: "core.forgetInteraction",
  label: "Forget interaction",
  description: "Deletes a saved interaction.",
  category: "data",
  icon: "BookmarkX",
  platforms: both,
  inputs: [execIn],
  outputs: [next],
  fields: [{ id: "key", label: "Saved as", kind: "text", required: true }],
  emit: (ctx) => `${ctx.helper("refs")}.remove(${ctx.value("key")});`,
});

export const coreNodes = [
  ready,
  interval,
  reply,
  sendMessage,
  log,
  delay,
  branch,
  switchNode,
  forEach,
  cooldown,
  stop,
  compare,
  logic,
  text,
  textTools,
  math,
  random,
  pick,
  jsonValue,
  now,
  setValue,
  getValue,
  deleteValue,
  increment,
  http,
  code,
  expression,
  buildObject,
  buildList,
  json,
  remember,
  recall,
  forget,
  saveInteraction,
  loadInteraction,
  forgetInteraction,
];
