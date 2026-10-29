import type { EmitContext, FieldDef, PortDef } from "../types.js";
import { lines, rows, slug } from "../util.js";
import { block, defineNode, execIn, isFilled, next, requireRepliable } from "./common.js";

const telegram = ["telegram"] as const;

const user: PortDef = { id: "user", label: "User", type: "user" };
const chat: PortDef = { id: "chat", label: "Chat", type: "channel" };
const message: PortDef = { id: "message", label: "Message", type: "message" };
const context: PortDef = { id: "ctx", label: "Context", type: "any" };

function register(handler: string, body: string, close = "});"): string {
  return block("export default function register(bot) {", block(handler, body, close));
}

function chatOf(ctx: EmitContext, id = "chat"): string {
  return `${ctx.helper("chatId")}(${ctx.value(id)})`;
}

function userIdOf(value: string): string {
  return `(${value}?.id ?? ${value})`;
}

function untilDate(minutes: number): string {
  return minutes > 0 ? `Math.floor(Date.now() / 1000) + ${minutes * 60}` : "0";
}

export const command = defineNode({
  type: "telegram.command",
  label: "Command",
  description: "Runs when someone sends /command. Text after the command is in Arguments.",
  category: "trigger",
  icon: "Slash",
  platforms: telegram,
  inputs: [],
  outputs: [next, context, user, chat, message, { id: "args", label: "Arguments", type: "string" }],
  fields: [
    { id: "name", label: "Command name", kind: "text", required: true, placeholder: "start" },
    { id: "description", label: "Description", kind: "text", required: true, placeholder: "Start the bot" },
  ],
  trigger: (ctx) => {
    const name = slug(String(ctx.field("name"))).replace(/-/g, "_").slice(0, 32);
    return {
      file: `command-${name}-${ctx.node.id}`,
      order: 0,
      scope: { context: "message", vars: { ctx: "ctx", user: "user", chat: "chat", message: "message", args: "args" } },
      command: { name, description: String(ctx.field("description")).slice(0, 256) },
      wrap: (body) =>
        register(
          `bot.command(${JSON.stringify(name)}, async (ctx) => {`,
          ["const user = ctx.from;", "const chat = ctx.chat;", "const message = ctx.message;", 'const args = ctx.match ?? "";', body].join("\n"),
        ),
    };
  },
});

export const textMessage = defineNode({
  type: "telegram.message",
  label: "Message received",
  description: "Runs on text messages, optionally only when they contain or start with a phrase.",
  category: "trigger",
  icon: "MessageSquare",
  platforms: telegram,
  inputs: [],
  outputs: [next, context, message, user, chat, { id: "text", label: "Text", type: "string" }],
  fields: [
    { id: "contains", label: "Only when the message contains", kind: "text" },
    { id: "startsWith", label: "Only when the message starts with", kind: "text" },
    {
      id: "where",
      label: "Where",
      kind: "select",
      default: "all",
      options: [
        { value: "all", label: "Private chats and groups" },
        { value: "private", label: "Private chats only" },
        { value: "group", label: "Groups only" },
      ],
    },
  ],
  trigger: (ctx) => {
    const contains = String(ctx.field("contains") ?? "").trim().toLowerCase();
    const prefix = String(ctx.field("startsWith") ?? "").trim().toLowerCase();
    const where = String(ctx.field("where") ?? "all");
    const guard: string[] = [];
    if (where === "private") guard.push('if (ctx.chat.type !== "private") return next();');
    if (where === "group") guard.push('if (ctx.chat.type === "private") return next();');
    if (prefix) guard.push(`if (!text.toLowerCase().startsWith(${JSON.stringify(prefix)})) return next();`);
    if (contains) guard.push(`if (!text.toLowerCase().includes(${JSON.stringify(contains)})) return next();`);
    return {
      file: `message-${ctx.node.id}`,
      order: 2,
      scope: { context: "message", vars: { ctx: "ctx", message: "message", user: "user", chat: "chat", text: "text" } },
      wrap: (body) =>
        register(
          'bot.on("message:text", async (ctx, next) => {',
          ["const message = ctx.message;", "const text = message.text;", ...guard, "const user = ctx.from;", "const chat = ctx.chat;", body, "await next();"].join("\n"),
        ),
    };
  },
});

const MEDIA = ["photo", "video", "document", "audio", "voice", "animation", "sticker", "location", "contact"];

export const media = defineNode({
  type: "telegram.media",
  label: "Media received",
  description: "Runs when someone sends a photo, file, voice note, location or other media.",
  category: "trigger",
  icon: "Image",
  platforms: telegram,
  inputs: [],
  outputs: [
    next,
    context,
    message,
    user,
    chat,
    { id: "file", label: "File ID or value", type: "string" },
    { id: "caption", label: "Caption", type: "string" },
  ],
  fields: [
    {
      id: "kind",
      label: "Type",
      kind: "select",
      default: "photo",
      options: MEDIA.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })),
    },
  ],
  trigger: (ctx) => {
    const kind = MEDIA.includes(String(ctx.field("kind"))) ? String(ctx.field("kind")) : "photo";
    const file =
      kind === "photo"
        ? "message.photo.at(-1).file_id"
        : kind === "location"
          ? "`${message.location.latitude},${message.location.longitude}`"
          : kind === "contact"
            ? "message.contact.phone_number"
            : `message.${kind}.file_id`;
    return {
      file: `media-${kind}-${ctx.node.id}`,
      order: 2,
      scope: { context: "message", vars: { ctx: "ctx", message: "message", user: "user", chat: "chat", file: "file", caption: "caption" } },
      wrap: (body) =>
        register(
          `bot.on("message:${kind}", async (ctx, next) => {`,
          [
            "const message = ctx.message;",
            "const user = ctx.from;",
            "const chat = ctx.chat;",
            `const file = ${file};`,
            'const caption = message.caption ?? "";',
            body,
            "await next();",
          ].join("\n"),
        ),
    };
  },
});

export const callback = defineNode({
  type: "telegram.callback",
  label: "Button pressed",
  description: "Runs when an inline keyboard button with this data is pressed.",
  category: "trigger",
  icon: "MousePointerClick",
  platforms: telegram,
  inputs: [],
  outputs: [next, context, user, chat, message, { id: "data", label: "Data", type: "string" }],
  fields: [
    { id: "data", label: "Button data", kind: "text", required: true, placeholder: "open_ticket" },
    {
      id: "match",
      label: "Match",
      kind: "select",
      default: "exact",
      options: [
        { value: "exact", label: "Exactly" },
        { value: "prefix", label: "Starts with" },
      ],
    },
    {
      id: "autoAnswer",
      label: "Answer the button press automatically",
      kind: "boolean",
      default: true,
      help: "Turn off to use Show alert instead.",
    },
  ],
  trigger: (ctx) => {
    const data = String(ctx.field("data")).trim();
    const pattern =
      ctx.field("match") === "prefix" ? `new RegExp(${JSON.stringify(`^${data.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)})` : JSON.stringify(data);
    const setup = ["const user = ctx.from;", "const chat = ctx.chat;", "const message = ctx.callbackQuery.message;", "const data = ctx.callbackQuery.data;"];
    if (ctx.field("autoAnswer") !== false) setup.unshift("await ctx.answerCallbackQuery();");
    return {
      file: `button-${slug(data) || "button"}-${ctx.node.id}`,
      order: 1,
      scope: { context: "interaction", vars: { ctx: "ctx", user: "user", chat: "chat", message: "message", data: "data" } },
      wrap: (body) => register(`bot.callbackQuery(${pattern}, async (ctx) => {`, [...setup, body].join("\n")),
    };
  },
});

function membership(kind: "join" | "leave") {
  const join = kind === "join";
  return defineNode({
    type: join ? "telegram.memberJoin" : "telegram.memberLeave",
    label: join ? "Member joined" : "Member left",
    description: join ? "Runs for each person who joins a group." : "Runs when someone leaves or is removed from a group.",
    category: "trigger",
    icon: join ? "UserPlus" : "UserMinus",
    platforms: telegram,
    inputs: [],
    outputs: [next, context, user, chat, message],
    fields: [],
    trigger: (ctx) => ({
      file: `member-${kind}-${ctx.node.id}`,
      order: 2,
      scope: { context: "message", vars: { ctx: "ctx", user: "user", chat: "chat", message: "message" } },
      wrap: (body) =>
        join
          ? register(
              'bot.on("message:new_chat_members", async (ctx, next) => {',
              ["const chat = ctx.chat;", "const message = ctx.message;", block("for (const user of message.new_chat_members) {", body), "await next();"].join("\n"),
            )
          : register(
              'bot.on("message:left_chat_member", async (ctx, next) => {',
              ["const chat = ctx.chat;", "const message = ctx.message;", "const user = message.left_chat_member;", body, "await next();"].join("\n"),
            ),
    }),
  });
}

export const memberJoin = membership("join");
export const memberLeave = membership("leave");

export const edited = defineNode({
  type: "telegram.edited",
  label: "Message edited",
  description: "Runs when someone edits a text message.",
  category: "trigger",
  icon: "Pencil",
  platforms: telegram,
  inputs: [],
  outputs: [next, context, message, user, chat, { id: "text", label: "New text", type: "string" }],
  fields: [],
  trigger: (ctx) => ({
    file: `edited-${ctx.node.id}`,
    order: 2,
    scope: { context: "message", vars: { ctx: "ctx", message: "message", user: "user", chat: "chat", text: "text" } },
    wrap: (body) =>
      register(
        'bot.on("edited_message:text", async (ctx, next) => {',
        ["const message = ctx.editedMessage;", "const text = message.text;", "const user = ctx.from;", "const chat = ctx.chat;", body, "await next();"].join("\n"),
      ),
  }),
});

export const inlineQuery = defineNode({
  type: "telegram.inline",
  label: "Inline query",
  description: "Runs when someone types @yourbot in any chat. Enable inline mode in BotFather first.",
  category: "trigger",
  icon: "AtSign",
  platforms: telegram,
  inputs: [],
  outputs: [next, context, user, { id: "query", label: "Query", type: "string" }],
  fields: [],
  trigger: (ctx) => ({
    file: `inline-${ctx.node.id}`,
    order: 1,
    scope: { context: "none", vars: { ctx: "ctx", user: "user", query: "query" } },
    wrap: (body) =>
      register('bot.on("inline_query", async (ctx) => {', ["const user = ctx.from;", "const query = ctx.inlineQuery.query;", body].join("\n")),
  }),
});

function inlineButtons(ctx: EmitContext, field: string): string {
  const keyboard = ctx.use("InlineKeyboard");
  const parsed = lines(String(ctx.field(field) ?? "")).map((line) =>
    line.split("||").map((button) => {
      const [label = "", target = ""] = button.split("|").map((part) => part.trim());
      return target.startsWith("http")
        ? `.url(${JSON.stringify(label)}, ${JSON.stringify(target)})`
        : `.text(${JSON.stringify(label)}, ${JSON.stringify(target || slug(label) || label)})`;
    }),
  );
  if (parsed.length === 0) ctx.fail("Add at least one button.");
  return `new ${keyboard}()${parsed.map((row) => row.join("")).join(".row()")}`;
}

const PARSE_MODES = [
  { value: "", label: "Plain text" },
  { value: "HTML", label: "HTML" },
  { value: "MarkdownV2", label: "MarkdownV2" },
];

function parseMode(ctx: EmitContext): string[] {
  const mode = String(ctx.field("format") ?? "");
  return mode === "HTML" || mode === "MarkdownV2" ? [`parse_mode: "${mode}"`] : [];
}

export const keyboard = defineNode({
  type: "telegram.keyboard",
  label: "Reply with buttons",
  description: "Replies with inline buttons under the message. Pair each button with a Button pressed trigger.",
  category: "action",
  icon: "RectangleHorizontal",
  platforms: telegram,
  inputs: [execIn, { id: "text", label: "Text", type: "string" }],
  outputs: [next, message],
  fields: [
    { id: "text", label: "Text", kind: "text", multiline: true, required: true },
    {
      id: "buttons", static: true,
      label: "Buttons",
      kind: "text",
      multiline: true,
      required: true,
      placeholder: "Yes | vote_yes || No | vote_no\nWebsite | https://example.com",
      help: "One row per line: label | data. Put several buttons on a row with ||.",
    },
    { id: "format", label: "Formatting", kind: "select", default: "", options: PARSE_MODES },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Reply with buttons");
    const options = [`reply_markup: ${inlineButtons(ctx, "buttons")}`, ...parseMode(ctx)];
    return `const ${ctx.out("message")} = await ctx.reply(${ctx.value("text")}, { ${options.join(", ")} });`;
  },
});

export const replyKeyboard = defineNode({
  type: "telegram.replyKeyboard",
  label: "Show keyboard",
  description: "Replaces the phone keyboard with buttons. Each press sends the label as a message.",
  category: "action",
  icon: "Keyboard",
  platforms: telegram,
  inputs: [execIn, { id: "text", label: "Text", type: "string" }],
  outputs: [next],
  fields: [
    { id: "text", label: "Text", kind: "text", multiline: true, required: true },
    { id: "buttons", static: true, label: "Buttons", kind: "text", multiline: true, required: true, placeholder: "Menu | Help\nContact us", help: "One row per line, buttons separated by |." },
    { id: "oneTime", label: "Hide after one press", kind: "boolean", default: false },
    { id: "placeholder", label: "Input placeholder", kind: "text" },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Show keyboard");
    const keyboardRows = rows(String(ctx.field("buttons") ?? "")).map((row) => row.filter(Boolean).map((label) => `.text(${JSON.stringify(label)})`).join(""));
    if (keyboardRows.length === 0) ctx.fail("Add at least one button.");
    let markup = `new ${ctx.use("Keyboard")}()${keyboardRows.join(".row()")}.resized()`;
    if (ctx.field("oneTime") === true) markup += ".oneTime()";
    if (isFilled(ctx, "placeholder")) markup += `.placeholder(${ctx.value("placeholder")})`;
    return `await ctx.reply(${ctx.value("text")}, { reply_markup: ${markup} });`;
  },
});

export const removeKeyboard = defineNode({
  type: "telegram.removeKeyboard",
  label: "Hide keyboard",
  description: "Replies and restores the normal phone keyboard.",
  category: "action",
  icon: "KeyboardOff",
  platforms: telegram,
  inputs: [execIn, { id: "text", label: "Text", type: "string" }],
  outputs: [next],
  fields: [{ id: "text", label: "Text", kind: "text", required: true, default: "Done." }],
  emit: (ctx) => {
    requireRepliable(ctx, "Hide keyboard");
    return `await ctx.reply(${ctx.value("text")}, { reply_markup: { remove_keyboard: true } });`;
  },
});

const MEDIA_METHODS: Record<string, string> = {
  photo: "replyWithPhoto",
  video: "replyWithVideo",
  document: "replyWithDocument",
  audio: "replyWithAudio",
  voice: "replyWithVoice",
  animation: "replyWithAnimation",
  sticker: "replyWithSticker",
};

export const replyMedia = defineNode({
  type: "telegram.photo",
  label: "Reply with media",
  description: "Replies with a photo, video, file, audio, voice note, GIF or sticker from a URL or file ID.",
  category: "action",
  icon: "ImageUp",
  platforms: telegram,
  inputs: [execIn, { id: "url", label: "URL or file ID", type: "string" }],
  outputs: [next, message],
  fields: [
    {
      id: "kind",
      label: "Type",
      kind: "select",
      default: "photo",
      options: Object.keys(MEDIA_METHODS).map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })),
    },
    { id: "url", label: "URL or file ID", kind: "text", required: true },
    { id: "caption", label: "Caption", kind: "text", multiline: true },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Reply with media");
    const method = MEDIA_METHODS[String(ctx.field("kind") ?? "photo")] ?? "replyWithPhoto";
    const extra = method === "replyWithSticker" ? "" : `, { caption: ${ctx.value("caption")} }`;
    return `const ${ctx.out("message")} = await ctx.${method}(${ctx.value("url")}${extra});`;
  },
});

export const location = defineNode({
  type: "telegram.location",
  label: "Reply with location",
  description: "Sends a map pin.",
  category: "action",
  icon: "MapPin",
  platforms: telegram,
  inputs: [execIn],
  outputs: [next],
  fields: [
    { id: "latitude", label: "Latitude", kind: "number", default: 24.7136 },
    { id: "longitude", label: "Longitude", kind: "number", default: 46.6753 },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Reply with location");
    return `await ctx.replyWithLocation(Number(${ctx.value("latitude")}), Number(${ctx.value("longitude")}));`;
  },
});

export const poll = defineNode({
  type: "telegram.poll",
  label: "Create poll",
  description: "Sends a poll or quiz.",
  category: "action",
  icon: "Vote",
  platforms: telegram,
  inputs: [execIn, { id: "question", label: "Question", type: "string" }],
  outputs: [next, message],
  fields: [
    { id: "question", label: "Question", kind: "text", required: true },
    { id: "options", static: true, label: "Answers", kind: "text", multiline: true, required: true, placeholder: "Yes\nNo\nMaybe", help: "One answer per line, 2 to 10." },
    { id: "anonymous", label: "Anonymous", kind: "boolean", default: true },
    { id: "multiple", label: "Allow several answers", kind: "boolean", default: false },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Create poll");
    const answers = lines(String(ctx.field("options") ?? "")).slice(0, 10);
    if (answers.length < 2) ctx.fail("A poll needs at least two answers.");
    const options = answers.map((text) => `{ text: ${JSON.stringify(text)} }`).join(", ");
    return `const ${ctx.out("message")} = await ctx.replyWithPoll(${ctx.value("question")}, [${options}], { is_anonymous: ${ctx.field("anonymous") !== false}, allows_multiple_answers: ${ctx.field("multiple") === true} });`;
  },
});

export const dice = defineNode({
  type: "telegram.dice",
  label: "Roll dice",
  description: "Sends an animated dice and returns the rolled value.",
  category: "action",
  icon: "Dices",
  platforms: telegram,
  inputs: [execIn],
  outputs: [next, { id: "value", label: "Value", type: "number" }],
  fields: [
    {
      id: "emoji",
      label: "Game",
      kind: "select",
      default: "🎲",
      options: [
        { value: "🎲", label: "Dice (1-6)" },
        { value: "🎯", label: "Darts (1-6)" },
        { value: "🏀", label: "Basketball (1-5)" },
        { value: "⚽", label: "Football (1-5)" },
        { value: "🎳", label: "Bowling (1-6)" },
        { value: "🎰", label: "Slot machine (1-64)" },
      ],
    },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Roll dice");
    return `const ${ctx.out("value")} = (await ctx.replyWithDice(${ctx.value("emoji")})).dice.value;`;
  },
});

export const chatAction = defineNode({
  type: "telegram.chatAction",
  label: "Show activity",
  description: "Shows “typing…” or “sending photo…” in the chat for a few seconds.",
  category: "action",
  icon: "Ellipsis",
  platforms: telegram,
  inputs: [execIn],
  outputs: [next],
  fields: [
    {
      id: "action",
      label: "Activity",
      kind: "select",
      default: "typing",
      options: [
        { value: "typing", label: "Typing" },
        { value: "upload_photo", label: "Sending photo" },
        { value: "upload_video", label: "Sending video" },
        { value: "upload_document", label: "Sending file" },
        { value: "record_voice", label: "Recording voice" },
      ],
    },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Show activity");
    return `await ctx.replyWithChatAction(${ctx.value("action")});`;
  },
});

export const editMessage = defineNode({
  type: "telegram.editMessage",
  label: "Edit message",
  description: "Changes the text of a message the bot sent. With a button trigger, edits the message the button is on.",
  category: "action",
  icon: "PenLine",
  platforms: telegram,
  inputs: [execIn, message, { id: "text", label: "Text", type: "string" }],
  outputs: [next],
  fields: [
    { id: "text", label: "Text", kind: "text", multiline: true, required: true },
    { id: "keepButtons", label: "Keep buttons", kind: "boolean", default: false },
    { id: "format", label: "Formatting", kind: "select", default: "", options: PARSE_MODES },
  ],
  emit: (ctx) => {
    const target = ctx.value("message");
    const options = parseMode(ctx);
    if (ctx.field("keepButtons") === true) options.push(`reply_markup: ${target}.reply_markup`);
    const extra = options.length > 0 ? `, { ${options.join(", ")} }` : "";
    return `await bot.api.editMessageText(${target}.chat.id, ${target}.message_id, ${ctx.value("text")}${extra});`;
  },
});

export const deleteMessage = defineNode({
  type: "telegram.deleteMessage",
  label: "Delete message",
  description: "Deletes a message. In groups the bot must be an admin to delete other people's messages.",
  category: "action",
  icon: "Trash2",
  platforms: telegram,
  inputs: [execIn, message],
  outputs: [next],
  fields: [],
  emit: (ctx) => {
    const target = ctx.value("message");
    return `await bot.api.deleteMessage(${target}.chat.id, ${target}.message_id);`;
  },
});

export const pin = defineNode({
  type: "telegram.pin",
  label: "Pin message",
  description: "Pins or unpins a message in the chat.",
  category: "action",
  icon: "Pin",
  platforms: telegram,
  inputs: [execIn, message],
  outputs: [next],
  fields: [
    { id: "unpin", label: "Unpin instead", kind: "boolean", default: false },
    { id: "silent", label: "Pin without notifying", kind: "boolean", default: true },
  ],
  emit: (ctx) => {
    const target = ctx.value("message");
    return ctx.field("unpin") === true
      ? `await bot.api.unpinChatMessage(${target}.chat.id, ${target}.message_id);`
      : `await bot.api.pinChatMessage(${target}.chat.id, ${target}.message_id, { disable_notification: ${ctx.field("silent") !== false} });`;
  },
});

export const copy = defineNode({
  type: "telegram.copy",
  label: "Forward message",
  description: "Sends a copy of a message to another chat.",
  category: "action",
  icon: "Forward",
  platforms: telegram,
  inputs: [execIn, message, { id: "to", label: "To chat", type: "channel" }],
  outputs: [next],
  fields: [
    { id: "to", label: "Chat ID", kind: "text", required: true },
    { id: "showSource", label: "Show “Forwarded from”", kind: "boolean", default: false },
  ],
  emit: (ctx) => {
    const target = ctx.value("message");
    const method = ctx.field("showSource") === true ? "forwardMessage" : "copyMessage";
    return `await bot.api.${method}(${chatOf(ctx, "to")}, ${target}.chat.id, ${target}.message_id);`;
  },
});

export const ban = defineNode({
  type: "telegram.ban",
  label: "Ban member",
  description: "Removes a user from the group. Set minutes to 0 to ban forever.",
  category: "action",
  icon: "Gavel",
  platforms: telegram,
  inputs: [execIn, user, chat],
  outputs: [next],
  fields: [{ id: "minutes", static: true, label: "Minutes", kind: "number", default: 0, min: 0 }],
  emit: (ctx) =>
    `await bot.api.banChatMember(${chatOf(ctx)}, ${userIdOf(ctx.value("user"))}, { until_date: ${untilDate(Number(ctx.field("minutes")) || 0)} });`,
});

export const unban = defineNode({
  type: "telegram.unban",
  label: "Unban member",
  description: "Lets a banned user join again.",
  category: "action",
  icon: "Undo2",
  platforms: telegram,
  inputs: [execIn, user, chat],
  outputs: [next],
  fields: [],
  emit: (ctx) => `await bot.api.unbanChatMember(${chatOf(ctx)}, ${userIdOf(ctx.value("user"))}, { only_if_banned: true });`,
});

export const mute = defineNode({
  type: "telegram.mute",
  label: "Mute member",
  description: "Stops a member from sending messages. Set minutes to 0 to unmute.",
  category: "action",
  icon: "VolumeX",
  platforms: telegram,
  inputs: [execIn, user, chat],
  outputs: [next],
  fields: [{ id: "minutes", static: true, label: "Minutes", kind: "number", default: 10, min: 0 }],
  emit: (ctx) => {
    const minutes = Math.max(0, Number(ctx.field("minutes")) || 0);
    const target = chatOf(ctx);
    const who = userIdOf(ctx.value("user"));
    if (minutes === 0) {
      return `await bot.api.restrictChatMember(${target}, ${who}, (await bot.api.getChat(${target})).permissions ?? { can_send_messages: true });`;
    }
    return `await bot.api.restrictChatMember(${target}, ${who}, { can_send_messages: false }, { until_date: ${untilDate(minutes)} });`;
  },
});

export const getMember = defineNode({
  type: "telegram.getMember",
  label: "Check member",
  description: "Gets a user's status in a chat and whether they are an admin.",
  category: "data",
  icon: "UserCheck",
  platforms: telegram,
  inputs: [execIn, user, chat],
  outputs: [
    next,
    { id: "status", label: "Status", type: "string" },
    { id: "isAdmin", label: "Is admin", type: "boolean" },
  ],
  fields: [],
  emit: (ctx) => {
    const status = ctx.out("status");
    return [
      `const ${status} = (await bot.api.getChatMember(${chatOf(ctx)}, ${userIdOf(ctx.value("user"))})).status;`,
      `const ${ctx.out("isAdmin")} = ${status} === "creator" || ${status} === "administrator";`,
    ].join("\n");
  },
});

export const alert = defineNode({
  type: "telegram.alert",
  label: "Show alert",
  description: "Answers a button press with a pop-up or a short notice. Turn off automatic answering on the trigger.",
  category: "action",
  icon: "BellRing",
  platforms: telegram,
  inputs: [execIn, { id: "text", label: "Text", type: "string" }],
  outputs: [next],
  fields: [
    { id: "text", label: "Text", kind: "text", required: true },
    { id: "popup", label: "Show as a pop-up", kind: "boolean", default: true },
  ],
  emit: (ctx) => {
    if (ctx.trigger.context !== "interaction") ctx.fail("Show alert needs a Button pressed trigger.");
    return `await ctx.answerCallbackQuery({ text: ${ctx.value("text")}, show_alert: ${ctx.field("popup") !== false} });`;
  },
});

export const answerInline = defineNode({
  type: "telegram.answerInline",
  label: "Answer inline query",
  description: "Shows results under the inline query. Picking one sends its text.",
  category: "action",
  icon: "ListTree",
  platforms: telegram,
  inputs: [execIn],
  outputs: [next],
  fields: [
    {
      id: "results", static: true,
      label: "Results",
      kind: "text",
      multiline: true,
      required: true,
      placeholder: "Hello | Hello, {{ user.first_name }}! | Sends a greeting",
      help: "One per line: title | text to send | description",
    },
    { id: "cache", static: true, label: "Cache for (seconds)", kind: "number", default: 10, min: 0 },
  ],
  emit: (ctx) => {
    if (!ctx.trigger.vars.query) ctx.fail("Answer inline query needs an Inline query trigger.");
    const results = lines(String(ctx.field("results") ?? "")).map((line, index) => {
      const [title = "", text = "", description = ""] = line.split("|").map((part) => part.trim());
      const parts = [
        'type: "article"',
        `id: "${index}"`,
        `title: ${JSON.stringify(title)}`,
        `input_message_content: { message_text: ${JSON.stringify(text || title)} }`,
      ];
      if (description) parts.push(`description: ${JSON.stringify(description)}`);
      return `  { ${parts.join(", ")} },`;
    });
    if (results.length === 0) ctx.fail("Add at least one result.");
    return [`await ctx.answerInlineQuery([`, ...results, `], { cache_time: ${Math.max(0, Number(ctx.field("cache")) || 0)} });`].join("\n");
  },
});

export const chatSettings = defineNode({
  type: "telegram.chatSettings",
  label: "Change chat info",
  description: "Sets a group's title or description. The bot must be an admin.",
  category: "action",
  icon: "Settings2",
  platforms: telegram,
  inputs: [execIn, chat, { id: "text", label: "Text", type: "string" }],
  outputs: [next],
  fields: [
    {
      id: "what",
      label: "Change",
      kind: "select",
      default: "title",
      options: [
        { value: "title", label: "Title" },
        { value: "description", label: "Description" },
      ],
    },
    { id: "text", label: "Text", kind: "text", required: true },
  ],
  emit: (ctx) =>
    `await bot.api.${ctx.field("what") === "description" ? "setChatDescription" : "setChatTitle"}(${chatOf(ctx)}, ${ctx.value("text")});`,
});

export const inviteLink = defineNode({
  type: "telegram.invite",
  label: "Create invite link",
  description: "Creates an invite link for a group. The bot must be an admin.",
  category: "action",
  icon: "Link",
  platforms: telegram,
  inputs: [execIn, chat],
  outputs: [next, { id: "url", label: "Link", type: "string" }],
  fields: [
    { id: "hours", static: true, label: "Expires after (hours, 0 = never)", kind: "number", default: 24, min: 0 },
    { id: "uses", static: true, label: "Max uses (0 = unlimited)", kind: "number", default: 0, min: 0, max: 99999 },
  ],
  emit: (ctx) => {
    const hours = Math.max(0, Number(ctx.field("hours")) || 0);
    const options = [];
    if (hours > 0) options.push(`expire_date: Math.floor(Date.now() / 1000) + ${hours * 3600}`);
    const uses = Math.max(0, Number(ctx.field("uses")) || 0);
    if (uses > 0) options.push(`member_limit: ${uses}`);
    return `const ${ctx.out("url")} = (await bot.api.createChatInviteLink(${chatOf(ctx)}, { ${options.join(", ")} })).invite_link;`;
  },
});

export const userInfo = defineNode({
  type: "telegram.userInfo",
  label: "User details",
  description: "Name, username, ID and language of a user.",
  category: "data",
  icon: "IdCard",
  platforms: telegram,
  inputs: [user],
  outputs: [
    { id: "name", label: "Full name", type: "string" },
    { id: "username", label: "Username", type: "string" },
    { id: "id", label: "ID", type: "number" },
    { id: "mention", label: "Mention", type: "string" },
    { id: "language", label: "Language", type: "string" },
    { id: "isBot", label: "Is bot", type: "boolean" },
  ],
  fields: [],
  expression: (ctx, output) => {
    const target = ctx.value("user");
    switch (output) {
      case "name":
        return `[${target}.first_name, ${target}.last_name].filter(Boolean).join(" ")`;
      case "username":
        return `${target}.username ?? ""`;
      case "id":
        return `${target}.id`;
      case "mention":
        return `(${target}.username ? "@" + ${target}.username : ${target}.first_name)`;
      case "language":
        return `${target}.language_code ?? ""`;
      default:
        return `Boolean(${target}.is_bot)`;
    }
  },
});

export const chatInfo = defineNode({
  type: "telegram.chatInfo",
  label: "Chat details",
  description: "ID, title and type of a chat.",
  category: "data",
  icon: "Info",
  platforms: telegram,
  inputs: [chat],
  outputs: [
    { id: "id", label: "ID", type: "number" },
    { id: "title", label: "Title", type: "string" },
    { id: "type", label: "Type", type: "string" },
    { id: "isGroup", label: "Is group", type: "boolean" },
  ],
  fields: [],
  expression: (ctx, output) => {
    const target = ctx.value("chat");
    switch (output) {
      case "id":
        return `${target}.id`;
      case "title":
        return `${target}.title ?? ${target}.first_name ?? ""`;
      case "type":
        return `${target}.type`;
      default:
        return `${target}.type === "group" || ${target}.type === "supergroup"`;
    }
  },
});

export const messageInfo = defineNode({
  type: "telegram.messageInfo",
  label: "Message details",
  description: "Text, ID, sender and reply of a message.",
  category: "data",
  icon: "FileText",
  platforms: telegram,
  inputs: [message],
  outputs: [
    { id: "text", label: "Text", type: "string" },
    { id: "id", label: "ID", type: "number" },
    { id: "from", label: "Sender", type: "user" },
    { id: "replyTo", label: "Replied message", type: "message" },
    { id: "date", label: "Sent at", type: "string" },
  ],
  fields: [],
  expression: (ctx, output) => {
    const target = ctx.value("message");
    switch (output) {
      case "text":
        return `${target}.text ?? ${target}.caption ?? ""`;
      case "id":
        return `${target}.message_id`;
      case "from":
        return `${target}.from`;
      case "replyTo":
        return `${target}.reply_to_message`;
      default:
        return `new Date(${target}.date * 1000).toISOString()`;
    }
  },
});

const SPECIAL_UPDATES = ["chat_member", "message_reaction", "message_reaction_count", "chat_boost", "removed_chat_boost"];

const FILTERS: [string, string][] = [
  ["message", "Any message"],
  ["message:text", "Text message"],
  ["message:entities:url", "Message with a link"],
  ["message:photo", "Photo"],
  ["message:video", "Video"],
  ["message:voice", "Voice note"],
  ["message:document", "File"],
  ["message:sticker", "Sticker"],
  ["message:poll", "Poll"],
  ["message:pinned_message", "Message pinned"],
  ["message:forward_origin", "Forwarded message"],
  ["edited_message", "Edited message"],
  ["channel_post", "Channel post"],
  ["edited_channel_post", "Edited channel post"],
  ["callback_query:data", "Any button press"],
  ["inline_query", "Inline query"],
  ["chosen_inline_result", "Inline result chosen"],
  ["poll_answer", "Poll answer"],
  ["my_chat_member", "Bot added, removed or promoted"],
  ["chat_member", "Member status changed (admin bot only)"],
  ["chat_join_request", "Join request"],
  ["message_reaction", "Reaction changed (admin bot only)"],
  ["chat_boost", "Chat boosted"],
];

export const anyUpdate = defineNode({
  type: "telegram.update",
  label: "Telegram event",
  description: "Runs on any Telegram update: channel posts, reactions, join requests, poll answers, member changes and more.",
  category: "trigger",
  icon: "Radio",
  platforms: telegram,
  inputs: [],
  outputs: [next, context, user, chat, message, { id: "update", label: "Raw update", type: "any" }],
  fields: [
    {
      id: "filter",
      label: "Event",
      kind: "select",
      default: "message",
      options: FILTERS.map(([value, label]) => ({ value, label })),
    },
    {
      id: "custom",
      static: true,
      label: "Custom filter query",
      kind: "text",
      placeholder: "message:entities:hashtag",
      help: "Optional. Any grammY filter query; it replaces the event above.",
    },
  ],
  trigger: (ctx) => {
    const custom = String(ctx.field("custom") ?? "").trim();
    const filter = custom || String(ctx.field("filter") ?? "message");
    const root = filter.split(":")[0];
    return {
      file: `update-${slug(filter) || "event"}-${ctx.node.id}`,
      order: 2,
      scope: { context: "message", vars: { ctx: "ctx", user: "user", chat: "chat", message: "message", update: "update" } },
      requires: SPECIAL_UPDATES.includes(root) ? { updates: [root] } : undefined,
      wrap: (body) =>
        register(
          `bot.on(${JSON.stringify(filter)}, async (ctx, next) => {`,
          ["const update = ctx.update;", "const user = ctx.from;", "const chat = ctx.chat;", "const message = ctx.msg;", body, "await next();"].join("\n"),
        ),
    };
  },
});

export const joinRequest = defineNode({
  type: "telegram.joinRequest",
  label: "Join request",
  description: "Runs when someone asks to join a group or channel that needs approval. The bot must be an admin.",
  category: "trigger",
  icon: "DoorOpen",
  platforms: telegram,
  inputs: [],
  outputs: [next, context, user, chat, { id: "bio", label: "Bio", type: "string" }],
  fields: [],
  trigger: (ctx) => ({
    file: `join-request-${ctx.node.id}`,
    order: 2,
    scope: { context: "none", vars: { ctx: "ctx", user: "user", chat: "chat", bio: "bio" } },
    wrap: (body) =>
      register(
        'bot.on("chat_join_request", async (ctx) => {',
        ["const request = ctx.chatJoinRequest;", "const user = request.from;", "const chat = request.chat;", 'const bio = request.bio ?? "";', body].join("\n"),
      ),
  }),
});

export const answerJoin = defineNode({
  type: "telegram.answerJoin",
  label: "Answer join request",
  description: "Approves or declines a join request.",
  category: "action",
  icon: "DoorOpen",
  platforms: telegram,
  inputs: [execIn, user, chat],
  outputs: [next],
  fields: [
    {
      id: "answer",
      label: "Answer",
      kind: "select",
      default: "approve",
      options: [
        { value: "approve", label: "Approve" },
        { value: "decline", label: "Decline" },
      ],
    },
  ],
  emit: (ctx) =>
    `await bot.api.${ctx.field("answer") === "decline" ? "declineChatJoinRequest" : "approveChatJoinRequest"}(${chatOf(ctx)}, ${userIdOf(ctx.value("user"))});`,
});

export const botMembership = defineNode({
  type: "telegram.botMembership",
  label: "Bot added or removed",
  description: "Runs when the bot is added to or removed from a group or channel, or its admin rights change.",
  category: "trigger",
  icon: "Bot",
  platforms: telegram,
  inputs: [],
  outputs: [next, context, user, chat, { id: "status", label: "New status", type: "string" }],
  fields: [
    {
      id: "when",
      label: "When",
      kind: "select",
      default: "added",
      options: [
        { value: "added", label: "The bot is added" },
        { value: "removed", label: "The bot is removed" },
        { value: "any", label: "Any change" },
      ],
    },
  ],
  trigger: (ctx) => {
    const when = String(ctx.field("when") ?? "added");
    const guard =
      when === "added"
        ? 'if (!["member", "administrator"].includes(status) || ["member", "administrator"].includes(previous)) return;'
        : when === "removed"
          ? 'if (!["left", "kicked"].includes(status)) return;'
          : "";
    return {
      file: `bot-membership-${ctx.node.id}`,
      order: 2,
      scope: { context: "none", vars: { ctx: "ctx", user: "user", chat: "chat", status: "status" } },
      wrap: (body) =>
        register(
          'bot.on("my_chat_member", async (ctx) => {',
          [
            "const update = ctx.myChatMember;",
            "const status = update.new_chat_member.status;",
            "const previous = update.old_chat_member.status;",
            guard,
            "const user = update.from;",
            "const chat = update.chat;",
            body,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
    };
  },
});

export const invoice = defineNode({
  type: "telegram.invoice",
  label: "Ask for Stars",
  description: "Sends an invoice paid with Telegram Stars. Pair it with Payment received to deliver what was bought.",
  category: "action",
  icon: "Star",
  platforms: telegram,
  inputs: [execIn, { id: "amount", label: "Stars", type: "number" }],
  outputs: [next, message],
  fields: [
    { id: "title", label: "Title", kind: "text", required: true, default: "Premium access" },
    { id: "description", label: "Description", kind: "text", required: true, default: "Unlocks premium commands for 30 days." },
    { id: "amount", label: "Stars", kind: "number", default: 50, min: 1, max: 100000 },
    { id: "payload", label: "Order data", kind: "text", default: "premium", help: "Sent back with the payment so you know what was bought." },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Ask for Stars");
    return `const ${ctx.out("message")} = await ctx.replyWithInvoice(${ctx.value("title")}, ${ctx.value("description")}, ${ctx.value("payload")}, "XTR", [{ label: ${ctx.value("title")}, amount: Math.max(1, Math.round(Number(${ctx.value("amount")}))) }]);`;
  },
});

export const payment = defineNode({
  type: "telegram.payment",
  label: "Payment received",
  description: "Runs after someone pays an invoice. Checkout is approved automatically.",
  category: "trigger",
  icon: "BadgeDollarSign",
  platforms: telegram,
  inputs: [],
  outputs: [
    next,
    context,
    user,
    chat,
    { id: "payload", label: "Order data", type: "string" },
    { id: "amount", label: "Amount", type: "number" },
    { id: "currency", label: "Currency", type: "string" },
    { id: "chargeId", label: "Charge ID", type: "string" },
  ],
  fields: [{ id: "payload", static: true, label: "Only for order data", kind: "text", placeholder: "premium", help: "Leave empty to run for every payment." }],
  trigger: (ctx) => {
    const only = String(ctx.field("payload") ?? "").trim();
    return {
      file: `payment-${ctx.node.id}`,
      order: 2,
      scope: { context: "message", vars: { ctx: "ctx", user: "user", chat: "chat", payload: "payload", amount: "amount", currency: "currency", chargeId: "chargeId" } },
      wrap: (body) =>
        block(
          "export default function register(bot) {",
          [
            block('bot.on("pre_checkout_query", async (ctx, next) => {', `${only ? `if (ctx.preCheckoutQuery.invoice_payload !== ${JSON.stringify(only)}) return next();\n` : ""}await ctx.answerPreCheckoutQuery(true);`, "});"),
            block(
              'bot.on("message:successful_payment", async (ctx, next) => {',
              [
                "const paid = ctx.message.successful_payment;",
                ...(only ? [`if (paid.invoice_payload !== ${JSON.stringify(only)}) return next();`] : []),
                "const user = ctx.from;",
                "const chat = ctx.chat;",
                "const payload = paid.invoice_payload;",
                "const amount = paid.total_amount;",
                "const currency = paid.currency;",
                "const chargeId = paid.telegram_payment_charge_id;",
                body,
                "await next();",
              ].join("\n"),
              "});",
            ),
          ].join("\n"),
        ),
    };
  },
});

export const refund = defineNode({
  type: "telegram.refund",
  label: "Refund Stars",
  description: "Gives back the Stars from a payment.",
  category: "action",
  icon: "Undo2",
  platforms: telegram,
  inputs: [execIn, { id: "user", label: "User", type: "user" }, { id: "chargeId", label: "Charge ID", type: "string" }],
  outputs: [next],
  fields: [],
  emit: (ctx) => `await bot.api.refundStarPayment(${userIdOf(ctx.value("user"))}, ${ctx.value("chargeId")});`,
});

export const quiz = defineNode({
  type: "telegram.quiz",
  label: "Send quiz",
  description: "Sends a quiz with one correct answer and an optional explanation.",
  category: "action",
  icon: "BadgeHelp",
  platforms: telegram,
  inputs: [execIn, { id: "question", label: "Question", type: "string" }],
  outputs: [next, message],
  fields: [
    { id: "question", label: "Question", kind: "text", required: true },
    { id: "options", static: true, label: "Answers", kind: "text", multiline: true, required: true, placeholder: "Paris\nLondon\nRome", help: "One answer per line, 2 to 10." },
    { id: "correct", label: "Correct answer number", kind: "number", default: 1, min: 1, max: 10 },
    { id: "explanation", label: "Explanation", kind: "text", help: "Shown after a wrong answer." },
    { id: "seconds", label: "Time limit (seconds)", kind: "number", default: 0, min: 0, max: 600, help: "0 means no limit." },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Send quiz");
    const answers = lines(String(ctx.field("options") ?? "")).slice(0, 10);
    if (answers.length < 2) ctx.fail("A quiz needs at least two answers.");
    const correct = Math.min(answers.length, Math.max(1, Number(ctx.field("correct")) || 1)) - 1;
    const seconds = Math.max(0, Math.min(600, Number(ctx.field("seconds")) || 0));
    const extra = [`type: "quiz"`, `correct_option_id: ${correct}`, "is_anonymous: false"];
    if (isFilled(ctx, "explanation")) extra.push(`explanation: ${ctx.value("explanation")}`);
    if (seconds >= 5) extra.push(`open_period: ${seconds}`);
    const options = answers.map((text) => `{ text: ${JSON.stringify(text)} }`).join(", ");
    return `const ${ctx.out("message")} = await ctx.replyWithPoll(${ctx.value("question")}, [${options}], { ${extra.join(", ")} });`;
  },
});

export const fileLink = defineNode({
  type: "telegram.fileLink",
  label: "File link",
  description: "Turns a file ID from Media received into a download link, so you can save or forward the file.",
  category: "action",
  icon: "FileDown",
  platforms: telegram,
  inputs: [execIn, { id: "file", label: "File ID", type: "string" }],
  outputs: [next, { id: "url", label: "Link", type: "string" }, { id: "size", label: "Size (bytes)", type: "number" }],
  fields: [],
  emit: (ctx) => {
    const info = ctx.out("info");
    return [
      `const ${info} = await bot.api.getFile(${ctx.value("file")});`,
      `const ${ctx.out("url")} = \`https://api.telegram.org/file/bot\${process.env.TELEGRAM_TOKEN}/\${${info}.file_path}\`;`,
      `const ${ctx.out("size")} = ${info}.file_size ?? 0;`,
    ].join("\n");
  },
});

function tgAction(definition: {
  type: string;
  label: string;
  description: string;
  icon: string;
  category?: "action" | "data";
  inputs?: PortDef[];
  outputs?: PortDef[];
  fields?: FieldDef[];
  emit: (ctx: EmitContext) => string;
}) {
  return defineNode({
    category: "action",
    platforms: telegram,
    ...definition,
    inputs: [execIn, ...(definition.inputs ?? [])],
    outputs: [next, ...(definition.outputs ?? [])],
    fields: definition.fields ?? [],
  });
}

const threadId: PortDef = { id: "topic", label: "Topic ID", type: "number" };

function chatAndMessage(ctx: EmitContext): [string, string] {
  const target = ctx.value("message");
  return [`${target}.chat.id`, `${target}.message_id`];
}

export const album = tgAction({
  type: "telegram.album",
  label: "Send album",
  description: "Sends several photos or videos as one album.",
  icon: "Images",
  inputs: [chat],
  outputs: [{ id: "messages", label: "Messages", type: "list" }],
  fields: [
    { id: "urls", label: "Links or file IDs", kind: "text", multiline: true, required: true, placeholder: "https://example.com/1.jpg\nhttps://example.com/2.jpg", help: "2 to 10, one per line." },
    { id: "kind", label: "Type", kind: "select", default: "photo", options: [{ value: "photo", label: "Photos" }, { value: "video", label: "Videos" }, { value: "document", label: "Files" }] },
    { id: "caption", label: "Caption", kind: "text" },
  ],
  emit: (ctx) => {
    const kind = JSON.stringify(String(ctx.field("kind") ?? "photo"));
    return `const ${ctx.out("messages")} = await bot.api.sendMediaGroup(${chatOf(ctx)}, String(${ctx.value("urls")}).split("\\n").map((item) => item.trim()).filter(Boolean).slice(0, 10).map((media, index) => ({ type: ${kind}, media, ...(index === 0 && ${ctx.value("caption")} ? { caption: ${ctx.value("caption")} } : {}) })));`;
  },
});

export const venue = tgAction({
  type: "telegram.venue",
  label: "Send venue",
  description: "Sends a place with a name and address on a map.",
  icon: "MapPinned",
  inputs: [chat],
  outputs: [message],
  fields: [
    { id: "latitude", label: "Latitude", kind: "number", default: 24.7136 },
    { id: "longitude", label: "Longitude", kind: "number", default: 46.6753 },
    { id: "title", label: "Name", kind: "text", required: true },
    { id: "address", label: "Address", kind: "text", required: true },
  ],
  emit: (ctx) =>
    `const ${ctx.out("message")} = await bot.api.sendVenue(${chatOf(ctx)}, Number(${ctx.value("latitude")}), Number(${ctx.value("longitude")}), ${ctx.value("title")}, ${ctx.value("address")});`,
});

export const contact = tgAction({
  type: "telegram.contact",
  label: "Send contact",
  description: "Sends a phone contact card.",
  icon: "Contact",
  inputs: [chat],
  outputs: [message],
  fields: [
    { id: "phone", label: "Phone number", kind: "text", required: true, placeholder: "+966500000000" },
    { id: "name", label: "First name", kind: "text", required: true },
  ],
  emit: (ctx) => `const ${ctx.out("message")} = await bot.api.sendContact(${chatOf(ctx)}, ${ctx.value("phone")}, ${ctx.value("name")});`,
});

export const forward = tgAction({
  type: "telegram.forward",
  label: "Forward message",
  description: "Forwards a message to another chat, showing who sent it first.",
  icon: "Forward",
  inputs: [message, { id: "to", label: "To chat", type: "any" }],
  outputs: [{ id: "forwarded", label: "Forwarded", type: "message" }],
  fields: [{ id: "to", label: "To chat ID", kind: "text", required: true }],
  emit: (ctx) => {
    const [from, id] = chatAndMessage(ctx);
    return `const ${ctx.out("forwarded")} = await bot.api.forwardMessage(${ctx.helper("chatId")}(${ctx.value("to")}), ${from}, ${id});`;
  },
});

export const editCaption = tgAction({
  type: "telegram.editCaption",
  label: "Edit caption",
  description: "Changes the caption of a photo, video or file message.",
  icon: "PenLine",
  inputs: [message],
  fields: [{ id: "caption", label: "Caption", kind: "text", multiline: true, required: true }, { id: "format", label: "Formatting", kind: "select", default: "", options: PARSE_MODES }],
  emit: (ctx) => {
    const [chatId, id] = chatAndMessage(ctx);
    return `await bot.api.editMessageCaption(${chatId}, ${id}, { caption: ${ctx.value("caption")}${parseMode(ctx).map((item) => `, ${item}`).join("")} });`;
  },
});

export const editButtons = tgAction({
  type: "telegram.editButtons",
  label: "Edit buttons",
  description: "Replaces the inline buttons under a message, or removes them.",
  icon: "RectangleHorizontal",
  inputs: [message],
  fields: [
    { id: "buttons", static: true, label: "Buttons", kind: "text", multiline: true, placeholder: "Next | page_2 || Close | close", help: "Same format as Reply with buttons. Empty removes them." },
  ],
  emit: (ctx) => {
    const [chatId, id] = chatAndMessage(ctx);
    const markup = String(ctx.field("buttons") ?? "").trim() ? inlineButtons(ctx, "buttons") : "{ inline_keyboard: [] }";
    return `await bot.api.editMessageReplyMarkup(${chatId}, ${id}, { reply_markup: ${markup} });`;
  },
});

export const stopPoll = tgAction({
  type: "telegram.stopPoll",
  label: "Close poll",
  description: "Closes a poll and returns the final results.",
  icon: "Vote",
  inputs: [message],
  outputs: [{ id: "results", label: "Results", type: "list" }],
  emit: (ctx) => {
    const [chatId, id] = chatAndMessage(ctx);
    return `const ${ctx.out("results")} = (await bot.api.stopPoll(${chatId}, ${id})).options.map((option) => ({ text: option.text, votes: option.voter_count }));`;
  },
});

export const reactTg = tgAction({
  type: "telegram.react",
  label: "React to message",
  description: "Adds an emoji reaction to a message. Empty removes the bot's reaction.",
  icon: "SmilePlus",
  inputs: [message],
  fields: [{ id: "emoji", label: "Emoji", kind: "text", default: "👍", help: "One of Telegram's reaction emoji, such as 👍 ❤ 🔥 🎉 😁." }],
  emit: (ctx) => {
    const [chatId, id] = chatAndMessage(ctx);
    return `await bot.api.setMessageReaction(${chatId}, ${id}, ${ctx.value("emoji")} ? [{ type: "emoji", emoji: ${ctx.value("emoji")} }] : []);`;
  },
});

export const promote = tgAction({
  type: "telegram.promote",
  label: "Promote to admin",
  description: "Makes a member an admin with the rights you choose. Turn all off to demote.",
  icon: "ShieldPlus",
  inputs: [user, chat],
  fields: [
    { id: "delete", label: "Delete messages", kind: "boolean", default: true },
    { id: "restrict", label: "Ban and mute members", kind: "boolean", default: true },
    { id: "pin", label: "Pin messages", kind: "boolean", default: true },
    { id: "invite", label: "Invite users", kind: "boolean", default: true },
    { id: "info", label: "Change group info", kind: "boolean", default: false },
    { id: "topics", label: "Manage topics", kind: "boolean", default: false },
    { id: "promote", label: "Add new admins", kind: "boolean", default: false },
  ],
  emit: (ctx) => {
    const rights: Record<string, string> = {
      delete: "can_delete_messages",
      restrict: "can_restrict_members",
      pin: "can_pin_messages",
      invite: "can_invite_users",
      info: "can_change_info",
      topics: "can_manage_topics",
      promote: "can_promote_members",
    };
    const entries = Object.entries(rights).map(([field, right]) => `${right}: ${ctx.value(field)}`);
    return `await bot.api.promoteChatMember(${chatOf(ctx)}, ${userIdOf(ctx.value("user"))}, { ${entries.join(", ")} });`;
  },
});

export const adminTitle = tgAction({
  type: "telegram.adminTitle",
  label: "Set admin title",
  description: "Sets the custom title shown next to an admin's name.",
  icon: "BadgeCheck",
  inputs: [user, chat],
  fields: [{ id: "title", label: "Title", kind: "text", required: true, placeholder: "Moderator" }],
  emit: (ctx) => `await bot.api.setChatAdministratorCustomTitle(${chatOf(ctx)}, ${userIdOf(ctx.value("user"))}, String(${ctx.value("title")}).slice(0, 16));`,
});

export const editChat = tgAction({
  type: "telegram.editChat",
  label: "Edit group",
  description: "Changes the group's title, description or photo. Empty settings stay as they are.",
  icon: "Settings2",
  inputs: [chat],
  fields: [
    { id: "title", label: "Title", kind: "text" },
    { id: "description", label: "Description", kind: "text", multiline: true },
    { id: "photo", label: "Photo URL", kind: "text" },
  ],
  emit: (ctx) => {
    const id = ctx.out("chat");
    return [
      `const ${id} = ${chatOf(ctx)};`,
      `if (${ctx.value("title")}) await bot.api.setChatTitle(${id}, ${ctx.value("title")});`,
      `if (${ctx.value("description")}) await bot.api.setChatDescription(${id}, ${ctx.value("description")});`,
      `if (${ctx.value("photo")}) await bot.api.setChatPhoto(${id}, new ${ctx.use("InputFile")}(new URL(${ctx.value("photo")})));`,
    ].join("\n");
  },
});

export const permissions = tgAction({
  type: "telegram.permissions",
  label: "Set group permissions",
  description: "Sets what every member may do in the group.",
  icon: "ShieldCheck",
  inputs: [chat],
  fields: [
    { id: "messages", label: "Send messages", kind: "boolean", default: true },
    { id: "media", label: "Send photos, videos and files", kind: "boolean", default: true },
    { id: "polls", label: "Send polls", kind: "boolean", default: true },
    { id: "links", label: "Add link previews", kind: "boolean", default: true },
    { id: "invite", label: "Invite users", kind: "boolean", default: true },
    { id: "pin", label: "Pin messages", kind: "boolean", default: false },
  ],
  emit: (ctx) => {
    const media = ctx.value("media");
    const parts = [
      `can_send_messages: ${ctx.value("messages")}`,
      ...["photos", "videos", "documents", "audios", "voice_notes", "video_notes", "other_messages"].map((kind) => `can_send_${kind}: ${media}`),
      `can_send_polls: ${ctx.value("polls")}`,
      `can_add_web_page_previews: ${ctx.value("links")}`,
      `can_invite_users: ${ctx.value("invite")}`,
      `can_pin_messages: ${ctx.value("pin")}`,
    ];
    return `await bot.api.setChatPermissions(${chatOf(ctx)}, { ${parts.join(", ")} });`;
  },
});

export const unpinAll = tgAction({
  type: "telegram.unpinAll",
  label: "Unpin all",
  description: "Removes every pinned message in the chat.",
  icon: "PinOff",
  inputs: [chat],
  emit: (ctx) => `await bot.api.unpinAllChatMessages(${chatOf(ctx)});`,
});

export const leave = tgAction({
  type: "telegram.leave",
  label: "Leave chat",
  description: "Makes the bot leave a group or channel.",
  icon: "DoorOpen",
  inputs: [chat],
  emit: (ctx) => `await bot.api.leaveChat(${chatOf(ctx)});`,
});

export const admins = tgAction({
  type: "telegram.admins",
  label: "Get admins",
  description: "Lists the chat's admins and the member count.",
  icon: "Users",
  category: "data",
  inputs: [chat],
  outputs: [
    { id: "admins", label: "Admins", type: "list" },
    { id: "count", label: "Members", type: "number" },
  ],
  emit: (ctx) => {
    const id = ctx.out("chat");
    return [
      `const ${id} = ${chatOf(ctx)};`,
      `const ${ctx.out("admins")} = (await bot.api.getChatAdministrators(${id})).map((admin) => ({ ...admin.user, status: admin.status, title: admin.custom_title ?? "" }));`,
      `const ${ctx.out("count")} = await bot.api.getChatMemberCount(${id});`,
    ].join("\n");
  },
});

export const topic = tgAction({
  type: "telegram.topic",
  label: "Forum topic",
  description: "Creates, renames, closes, reopens or deletes a topic in a forum group.",
  icon: "MessagesSquare",
  inputs: [chat, { ...threadId, optional: true }],
  outputs: [{ id: "id", label: "Topic ID", type: "number" }],
  fields: [
    {
      id: "do",
      label: "Action",
      kind: "select",
      default: "create",
      options: [
        { value: "create", label: "Create" },
        { value: "rename", label: "Rename" },
        { value: "close", label: "Close" },
        { value: "reopen", label: "Reopen" },
        { value: "delete", label: "Delete" },
      ],
    },
    { id: "name", label: "Name", kind: "text", placeholder: "Support" },
  ],
  emit: (ctx) => {
    const action = String(ctx.field("do") ?? "create");
    const chatId = chatOf(ctx);
    const out = ctx.out("id");
    if (action === "create") return `const ${out} = (await bot.api.createForumTopic(${chatId}, String(${ctx.value("name")}).slice(0, 128))).message_thread_id;`;
    const topicId = ctx.value("topic");
    if (topicId === "undefined") ctx.fail("Connect Topic ID to change a topic.");
    const call =
      action === "rename"
        ? `editForumTopic(${chatId}, ${topicId}, { name: String(${ctx.value("name")}).slice(0, 128) })`
        : `${action === "close" ? "closeForumTopic" : action === "reopen" ? "reopenForumTopic" : "deleteForumTopic"}(${chatId}, ${topicId})`;
    return `await bot.api.${call};\nconst ${out} = ${topicId};`;
  },
});

export const revokeInvite = tgAction({
  type: "telegram.revokeInvite",
  label: "Revoke invite link",
  description: "Stops an invite link from working.",
  icon: "Unlink",
  inputs: [chat],
  fields: [{ id: "link", label: "Invite link", kind: "text", required: true }],
  emit: (ctx) => `await bot.api.revokeChatInviteLink(${chatOf(ctx)}, ${ctx.value("link")});`,
});

export const setCommands = tgAction({
  type: "telegram.setCommands",
  label: "Set command menu",
  description: "Sets the / command menu for a scope, such as only admins or only private chats, in a language.",
  icon: "ListOrdered",
  fields: [
    { id: "commands", static: true, label: "Commands", kind: "text", multiline: true, required: true, placeholder: "start | Start the bot\nhelp | Show help" },
    {
      id: "scope",
      label: "Shown in",
      kind: "select",
      default: "default",
      options: [
        { value: "default", label: "Everywhere" },
        { value: "all_private_chats", label: "Private chats" },
        { value: "all_group_chats", label: "Groups" },
        { value: "all_chat_administrators", label: "Group admins" },
      ],
    },
    { id: "language", label: "Language code", kind: "text", placeholder: "ar (empty for all)" },
  ],
  emit: (ctx) => {
    const commands = rows(String(ctx.field("commands") ?? ""))
      .map(([command = "", description = ""]) => ({ command: command.replace(/^\//, "").toLowerCase(), description: description || command }))
      .filter((item) => item.command);
    if (commands.length === 0) ctx.fail("Add at least one command.");
    return `await bot.api.setMyCommands(${JSON.stringify(commands)}, { scope: { type: ${JSON.stringify(ctx.field("scope") ?? "default")} }, ...(${ctx.value("language")} ? { language_code: ${ctx.value("language")} } : {}) });`;
  },
});

export const botProfileTg = tgAction({
  type: "telegram.botProfile",
  label: "Change bot profile",
  description: "Changes the bot's name, description and short description. Empty settings stay as they are.",
  icon: "Bot",
  fields: [
    { id: "name", label: "Name", kind: "text" },
    { id: "description", label: "Description (shown before /start)", kind: "text", multiline: true },
    { id: "short", label: "Short description (profile)", kind: "text" },
  ],
  emit: (ctx) =>
    [
      `if (${ctx.value("name")}) await bot.api.setMyName(${ctx.value("name")});`,
      `if (${ctx.value("description")}) await bot.api.setMyDescription(${ctx.value("description")});`,
      `if (${ctx.value("short")}) await bot.api.setMyShortDescription(${ctx.value("short")});`,
    ].join("\n"),
});

export const menuButton = tgAction({
  type: "telegram.menuButton",
  label: "Set menu button",
  description: "Sets the button next to the message box: the command list, or a Mini App.",
  icon: "PanelTop",
  inputs: [{ ...chat, optional: true }],
  fields: [
    { id: "kind", label: "Button", kind: "select", default: "commands", options: [{ value: "commands", label: "Command list" }, { value: "web_app", label: "Open a Mini App" }] },
    { id: "text", label: "Mini App button text", kind: "text", default: "Open" },
    { id: "url", label: "Mini App URL", kind: "text", placeholder: "https://example.com/app" },
  ],
  emit: (ctx) => {
    const button = ctx.field("kind") === "web_app" ? `{ type: "web_app", text: ${ctx.value("text")}, web_app: { url: ${ctx.value("url")} } }` : `{ type: "commands" }`;
    const target = ctx.connected("chat") ? `chat_id: ${chatOf(ctx)}, ` : "";
    return `await bot.api.setChatMenuButton({ ${target}menu_button: ${button} });`;
  },
});

export const webAppButton = tgAction({
  type: "telegram.webAppButton",
  label: "Reply with Mini App",
  description: "Replies with a button that opens a Telegram Mini App (a web page inside Telegram).",
  icon: "AppWindow",
  inputs: [{ id: "text", label: "Text", type: "string" }],
  outputs: [message],
  fields: [
    { id: "text", label: "Text", kind: "text", required: true, default: "Open the app" },
    { id: "label", label: "Button label", kind: "text", default: "Open" },
    { id: "url", label: "App URL (https)", kind: "text", required: true, placeholder: "https://example.com/app" },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Reply with Mini App");
    return `const ${ctx.out("message")} = await ctx.reply(${ctx.value("text")}, { reply_markup: { inline_keyboard: [[{ text: ${ctx.value("label")}, web_app: { url: ${ctx.value("url")} } }]] } });`;
  },
});

export const profilePhotos = tgAction({
  type: "telegram.profilePhotos",
  label: "Profile photos",
  description: "Gets a user's profile photos as file IDs you can send again.",
  icon: "ImageUp",
  category: "data",
  inputs: [user],
  outputs: [
    { id: "photos", label: "Photo IDs", type: "list" },
    { id: "first", label: "Current photo", type: "string" },
  ],
  fields: [{ id: "limit", label: "How many", kind: "number", default: 5, min: 1, max: 100 }],
  emit: (ctx) => {
    const photos = ctx.out("photos");
    return [
      `const ${photos} = (await bot.api.getUserProfilePhotos(${userIdOf(ctx.value("user"))}, { limit: Number(${ctx.value("limit")}) || 5 })).photos.map((sizes) => sizes.at(-1).file_id);`,
      `const ${ctx.out("first")} = ${photos}[0] ?? "";`,
    ].join("\n");
  },
});

export const mentionTg = defineNode({
  type: "telegram.mention",
  label: "Mention user",
  description: "Builds a clickable mention of a user. Use HTML formatting in the message.",
  category: "data",
  icon: "AtSign",
  platforms: telegram,
  inputs: [user],
  outputs: [{ id: "text", label: "HTML", type: "string" }],
  fields: [],
  expression: (ctx) => {
    const target = ctx.value("user");
    return `\`<a href="tg://user?id=\${${target}?.id ?? ${target}}">\${String(${target}?.first_name ?? ${target}?.username ?? "user").replace(/[<>&]/g, "")}</a>\``;
  },
});

export const pollAnswer = defineNode({
  type: "telegram.pollAnswer",
  label: "Poll answer",
  description: "Runs when someone answers a non-anonymous poll or quiz sent by the bot.",
  category: "trigger",
  icon: "Vote",
  platforms: telegram,
  inputs: [],
  outputs: [next, user, { id: "pollId", label: "Poll ID", type: "string" }, { id: "options", label: "Chosen options", type: "list" }],
  fields: [],
  trigger: (ctx) => ({
    file: `poll-answer-${ctx.node.id}`,
    order: 2,
    scope: { context: "none", vars: { user: "user", pollId: "pollId", options: "options" } },
    requires: { updates: ["poll_answer"] },
    wrap: (body) =>
      register(
        'bot.on("poll_answer", async (ctx, next) => {',
        ["const answer = ctx.pollAnswer;", "const user = answer.user;", "const pollId = answer.poll_id;", "const options = answer.option_ids;", body, "await next();"].join("\n"),
      ),
  }),
});

export const reaction = defineNode({
  type: "telegram.reaction",
  label: "Reaction added",
  description: "Runs when someone adds or removes an emoji reaction. The bot must be an admin in groups.",
  category: "trigger",
  icon: "SmilePlus",
  platforms: telegram,
  inputs: [],
  outputs: [next, context, user, chat, { id: "added", label: "Added emoji", type: "list" }, { id: "removed", label: "Removed emoji", type: "list" }, { id: "messageId", label: "Message ID", type: "number" }],
  fields: [{ id: "emoji", static: true, label: "Only this emoji", kind: "text", placeholder: "🔥" }],
  trigger: (ctx) => {
    const only = String(ctx.field("emoji") ?? "").trim();
    return {
      file: `reaction-${ctx.node.id}`,
      order: 2,
      scope: { context: "message", vars: { ctx: "ctx", user: "user", chat: "chat", added: "added", removed: "removed", messageId: "messageId" } },
      requires: { updates: ["message_reaction"] },
      wrap: (body) =>
        register(
          'bot.on("message_reaction", async (ctx, next) => {',
          [
            "const { emojiAdded: added, emojiRemoved: removed } = ctx.reactions();",
            ...(only ? [`if (!added.includes(${JSON.stringify(only)})) return next();`] : []),
            "const user = ctx.from;",
            "const chat = ctx.chat;",
            "const messageId = ctx.messageReaction.message_id;",
            body,
            "await next();",
          ].join("\n"),
        ),
    };
  },
});

export const webAppData = defineNode({
  type: "telegram.webAppData",
  label: "Mini App data",
  description: "Runs when a Mini App opened from a keyboard button sends data back with sendData.",
  category: "trigger",
  icon: "AppWindow",
  platforms: telegram,
  inputs: [],
  outputs: [next, context, user, chat, { id: "data", label: "Data", type: "string" }, { id: "json", label: "Data as JSON", type: "any" }],
  fields: [],
  trigger: (ctx) => ({
    file: `web-app-data-${ctx.node.id}`,
    order: 2,
    scope: { context: "message", vars: { ctx: "ctx", user: "user", chat: "chat", data: "data", json: "json" } },
    wrap: (body) =>
      register(
        'bot.on("message:web_app_data", async (ctx, next) => {',
        [
          "const user = ctx.from;",
          "const chat = ctx.chat;",
          "const data = ctx.message.web_app_data.data;",
          "let json = null;",
          "try {",
          "  json = JSON.parse(data);",
          "} catch {",
          "  json = null;",
          "}",
          body,
          "await next();",
        ].join("\n"),
      ),
  }),
});

export const moreTelegramNodes = [
  pollAnswer,
  reaction,
  webAppData,
  album,
  venue,
  contact,
  forward,
  editCaption,
  editButtons,
  stopPoll,
  reactTg,
  promote,
  adminTitle,
  editChat,
  permissions,
  unpinAll,
  leave,
  admins,
  topic,
  revokeInvite,
  setCommands,
  botProfileTg,
  menuButton,
  webAppButton,
  profilePhotos,
  mentionTg,
];

export const telegramNodes = [
  invoice,
  payment,
  refund,
  quiz,
  fileLink,
  command,
  textMessage,
  media,
  callback,
  memberJoin,
  memberLeave,
  edited,
  inlineQuery,
  anyUpdate,
  joinRequest,
  botMembership,
  answerJoin,
  keyboard,
  replyKeyboard,
  removeKeyboard,
  replyMedia,
  location,
  poll,
  dice,
  chatAction,
  editMessage,
  deleteMessage,
  pin,
  copy,
  ban,
  unban,
  mute,
  getMember,
  alert,
  answerInline,
  chatSettings,
  inviteLink,
  userInfo,
  chatInfo,
  messageInfo,
  ...moreTelegramNodes,
];
