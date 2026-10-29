import type { EmitContext, FieldDef, NodeDefinition, PortDef, PortType } from "../types.js";
import { identifier, lines, parseColor, rows, slug } from "../util.js";
import { block, defineNode, execIn, isFilled, next, requireRepliable } from "./common.js";

const discord = ["discord"] as const;

const user: PortDef = { id: "user", label: "User", type: "user" };
const member: PortDef = { id: "member", label: "Member", type: "member" };
const channel: PortDef = { id: "channel", label: "Channel", type: "channel" };
const message: PortDef = { id: "message", label: "Message", type: "message" };
const guild: PortDef = { id: "guild", label: "Server", type: "guild" };
const role: PortDef = { id: "role", label: "Role", type: "role" };

const interactionVars = { user: "user", member: "member", channel: "channel", guild: "guild", interaction: "interaction" };
const interactionOut: PortDef = { id: "interaction", label: "Interaction", type: "any" };
const interactionScope = ["const source = interaction;", "const { user, member, channel, guild } = interaction;"];

function listener(ctx: EmitContext, event: string, args: string, guard: string[], scope: string[], body: string) {
  return block(
    "export default function register(client) {",
    block(`client.on(${ctx.use("Events")}.${event}, async (${args}) => {`, [...guard, ...scope, body].join("\n"), "});"),
  );
}

function idOf(value: string): string {
  return `String(${value}?.id ?? ${value})`;
}

const OPTION_TYPES: Record<string, { code: number; port: PortType; getter: string }> = {
  text: { code: 3, port: "string", getter: "getString" },
  integer: { code: 4, port: "number", getter: "getInteger" },
  boolean: { code: 5, port: "boolean", getter: "getBoolean" },
  user: { code: 6, port: "user", getter: "getUser" },
  channel: { code: 7, port: "channel", getter: "getChannel" },
  role: { code: 8, port: "role", getter: "getRole" },
  number: { code: 10, port: "number", getter: "getNumber" },
};

function parseChoices(text: string, type: string) {
  const auto = /^auto\s*:/i.test(text.trim());
  const values = text
    .replace(/^auto\s*:/i, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [label, raw = label] = item.split("=").map((part) => part.trim());
      const value: string | number = type === "integer" || type === "number" ? Number(raw) || 0 : raw.slice(0, 100);
      return { name: label.slice(0, 100), value };
    });
  return { auto, values };
}

function parseOptions(text: string) {
  return rows(text)
    .map(([name = "", type = "text", description = "", required = "", choices = ""]) => {
      const kind = type.toLowerCase() in OPTION_TYPES ? type.toLowerCase() : "text";
      const parsed = ["text", "integer", "number"].includes(kind) ? parseChoices(choices, kind) : { auto: false, values: [] };
      return {
        name: slug(name).replace(/-/g, "_").slice(0, 32),
        type: kind,
        description: (description || name).slice(0, 100),
        required: required.toLowerCase() === "required",
        choices: parsed.values,
        autocomplete: parsed.auto && parsed.values.length > 0,
      };
    })
    .filter((option) => option.name)
    .slice(0, 25);
}

const PERMISSION_BITS: Record<string, string> = {
  Administrator: "8",
  ManageGuild: "32",
  ManageChannels: "16",
  ManageRoles: "268435456",
  ManageMessages: "8192",
  KickMembers: "2",
  BanMembers: "4",
  ModerateMembers: "1099511627776",
};

function localizations(text: string) {
  const names: Record<string, string> = {};
  const descriptions: Record<string, string> = {};
  for (const [locale = "", name = "", description = ""] of rows(text)) {
    if (!locale) continue;
    if (name) names[locale] = name.toLowerCase().replace(/\s+/g, "-").slice(0, 32);
    if (description) descriptions[locale] = description.slice(0, 100);
  }
  return { names, descriptions };
}

function modalInputs(text: string) {
  return rows(text)
    .map(([id = "", label = "", style = "short", required = "", placeholder = ""]) => ({
      id: slug(id).replace(/-/g, "_").slice(0, 100),
      label: (label || id).slice(0, 45),
      paragraph: style.toLowerCase() === "paragraph",
      required: required.toLowerCase() !== "optional",
      placeholder,
    }))
    .filter((input) => input.id)
    .slice(0, 5);
}

export const slashCommand = defineNode({
  type: "discord.slashCommand",
  label: "Slash command",
  description: "Runs when someone uses a /command. Each option becomes an output.",
  category: "trigger",
  icon: "Slash",
  platforms: discord,
  inputs: [],
  outputs: [next, user, member, channel, guild, interactionOut],
  fields: [
    {
      id: "name",
      label: "Command name",
      kind: "text",
      required: true,
      placeholder: "ping",
      help: "Use two or three words for subcommands, like ticket open or ticket admin close.",
    },
    { id: "description", label: "Description", kind: "text", required: true, placeholder: "Check if the bot is alive" },
    {
      id: "options", static: true,
      label: "Options",
      kind: "text",
      multiline: true,
      placeholder: "target | user | Who to greet | required\ncolor | text | Pick one | required | Red=red, Blue=blue\nfruit | text | Search | | auto: apple, banana, cherry",
      help: "One per line: name | type | description | required | choices. Types: text, integer, number, boolean, user, channel, role. Choices: Label=value, ... or auto: a, b, c for suggestions while typing.",
    },
    {
      id: "permission",
      static: true,
      label: "Who can use it",
      kind: "select",
      default: "",
      options: [
        { value: "", label: "Everyone" },
        { value: "Administrator", label: "Administrators" },
        { value: "ManageGuild", label: "Manage Server" },
        { value: "ManageChannels", label: "Manage Channels" },
        { value: "ManageRoles", label: "Manage Roles" },
        { value: "ManageMessages", label: "Manage Messages" },
        { value: "KickMembers", label: "Kick Members" },
        { value: "BanMembers", label: "Ban Members" },
        { value: "ModerateMembers", label: "Timeout Members" },
      ],
      help: "Server admins can change this later in Server Settings > Integrations.",
    },
    { id: "serverOnly", static: true, label: "Only in servers (not in DMs)", kind: "boolean", default: false },
    {
      id: "localizations",
      static: true,
      label: "Translations",
      kind: "text",
      multiline: true,
      placeholder: "ar | بينغ | تحقق من أن البوت يعمل\nfr | ping | Vérifie que le bot répond",
      help: "One per line: locale | name | description. Discord shows them to users with that language.",
    },
  ],
  ports: (data) => ({
    outputs: parseOptions(String(data.options ?? "")).map((option) => ({
      id: `opt_${option.name}`,
      label: option.name,
      type: OPTION_TYPES[option.type].port,
    })),
  }),
  trigger: (ctx) => {
    const words = String(ctx.field("name") ?? "")
      .trim()
      .split(/\s+/)
      .map((word) => slug(word).slice(0, 32))
      .filter(Boolean);
    if (words.length > 3) ctx.fail("A command has at most three words: command, group and subcommand.");
    const name = words[0] ?? "";
    const group = words.length === 3 ? words[1] : undefined;
    const sub = words.length >= 2 ? words[words.length - 1] : undefined;
    const options = parseOptions(String(ctx.field("options") ?? ""));
    const permission = PERMISSION_BITS[String(ctx.field("permission") ?? "")];
    const { names, descriptions } = localizations(String(ctx.field("localizations") ?? ""));
    const suggestions = options.filter((option) => option.autocomplete);
    const route = [
      `interaction.commandName !== ${JSON.stringify(name)}`,
      ...(sub ? [`interaction.options.getSubcommand(false) !== ${JSON.stringify(sub)}`] : []),
      ...(group ? [`interaction.options.getSubcommandGroup(false) !== ${JSON.stringify(group)}`] : []),
    ].join(" || ");
    const autocomplete = suggestions.length
      ? [
          `if (interaction.isAutocomplete() && !(${route})) {`,
          "  const focused = interaction.options.getFocused(true);",
          `  const lists = ${JSON.stringify(Object.fromEntries(suggestions.map((option) => [option.name, option.choices])))};`,
          "  const typed = String(focused.value).toLowerCase();",
          "  await interaction.respond((lists[focused.name] ?? []).filter((item) => item.name.toLowerCase().includes(typed)).slice(0, 25));",
          "  return;",
          "}",
        ]
      : [];
    const vars: Record<string, string> = { ...interactionVars };
    for (const option of options) vars[`opt_${option.name}`] = `options.${identifier(option.name)}`;
    const read = options.map(
      (option) =>
        `  ${identifier(option.name)}: interaction.options.${OPTION_TYPES[option.type].getter}(${JSON.stringify(option.name)})${option.type === "text" ? ' ?? ""' : ""},`,
    );
    return {
      file: `command-${words.join("-")}-${ctx.node.id}`,
      order: 0,
      scope: { context: "interaction", vars },
      command: {
        name,
        group,
        sub,
        description: String(ctx.field("description")).slice(0, 100),
        options: options.map((option) => ({
          name: option.name,
          description: option.description,
          type: OPTION_TYPES[option.type].code,
          required: option.required,
          ...(option.autocomplete ? { autocomplete: true } : option.choices.length ? { choices: option.choices.slice(0, 25) } : {}),
        })),
        ...(permission ? { default_member_permissions: permission } : {}),
        ...(ctx.field("serverOnly") === true ? { contexts: [0] } : {}),
        ...(Object.keys(names).length ? { name_localizations: names } : {}),
        ...(Object.keys(descriptions).length ? { description_localizations: descriptions } : {}),
      },
      wrap: (body) =>
        listener(
          ctx,
          "InteractionCreate",
          "interaction",
          [...autocomplete, `if (!interaction.isChatInputCommand() || ${route}) return;`],
          [...interactionScope, read.length > 0 ? `const options = {\n${read.join("\n")}\n};` : "const options = {};"],
          body,
        ),
    };
  },
});

function contextMenu(type: "user" | "message") {
  const isUser = type === "user";
  return defineNode({
    type: isUser ? "discord.userContextMenu" : "discord.messageContextMenu",
    label: isUser ? "User menu command" : "Message menu command",
    description: isUser
      ? "Runs from the Apps menu when right-clicking a user."
      : "Runs from the Apps menu when right-clicking a message.",
    category: "trigger",
    icon: isUser ? "UserRound" : "MessageCircle",
    platforms: discord,
    inputs: [],
    outputs: isUser
      ? [
          next,
          user,
          member,
          { id: "target", label: "Target user", type: "user" },
          { id: "targetMember", label: "Target member", type: "member" },
          channel,
          guild,
          interactionOut,
        ]
      : [next, user, member, { id: "target", label: "Target message", type: "message" }, channel, guild, interactionOut],
    fields: [
      { id: "name", label: "Menu label", kind: "text", required: true, placeholder: isUser ? "Show profile" : "Report message" },
    ],
    trigger: (ctx) => {
      const name = String(ctx.field("name")).trim().slice(0, 32);
      const check = isUser ? "isUserContextMenuCommand" : "isMessageContextMenuCommand";
      const targets = isUser
        ? ["const target = interaction.targetUser;", "const targetMember = interaction.targetMember;"]
        : ["const target = interaction.targetMessage;"];
      const vars: Record<string, string> = { ...interactionVars, target: "target" };
      if (isUser) vars.targetMember = "targetMember";
      return {
        file: `${type}-menu-${slug(name) || "menu"}-${ctx.node.id}`,
        order: 0,
        scope: { context: "interaction", vars },
        command: { name, type: isUser ? 2 : 3 },
        wrap: (body) =>
          listener(
            ctx,
            "InteractionCreate",
            "interaction",
            [`if (!interaction.${check}() || interaction.commandName !== ${JSON.stringify(name)}) return;`],
            [...interactionScope, ...targets],
            body,
          ),
      };
    },
  });
}

export const userContextMenu = contextMenu("user");
export const messageContextMenu = contextMenu("message");

export const messageCreate = defineNode({
  type: "discord.message",
  label: "Message received",
  description: "Runs when a message is posted in a server channel or sent to the bot in a direct message.",
  category: "trigger",
  icon: "MessageSquare",
  platforms: discord,
  inputs: [],
  outputs: [next, message, user, member, channel, guild, { id: "content", label: "Content", type: "string" }],
  fields: [
    {
      id: "where",
      label: "Where",
      kind: "select",
      default: "server",
      options: [
        { value: "server", label: "Server channels" },
        { value: "dm", label: "Direct messages to the bot" },
        { value: "all", label: "Both" },
      ],
    },
    { id: "contains", label: "Only when the message contains", kind: "text" },
    { id: "startsWith", label: "Only when the message starts with", kind: "text", placeholder: "!" },
    { id: "ignoreBots", label: "Ignore bots", kind: "boolean", default: true },
  ],
  trigger: (ctx) => {
    const contains = String(ctx.field("contains") ?? "").trim().toLowerCase();
    const prefix = String(ctx.field("startsWith") ?? "").trim().toLowerCase();
    const guard: string[] = [];
    const where = String(ctx.field("where") ?? "server");
    if (ctx.field("ignoreBots") !== false) guard.push("if (message.author.bot) return;");
    if (where === "server") guard.push("if (!message.inGuild()) return;");
    if (where === "dm") guard.push("if (message.inGuild()) return;");
    if (prefix) guard.push(`if (!message.content.toLowerCase().startsWith(${JSON.stringify(prefix)})) return;`);
    if (contains) guard.push(`if (!message.content.toLowerCase().includes(${JSON.stringify(contains)})) return;`);
    return {
      file: `message-${ctx.node.id}`,
      order: 2,
      scope: {
        context: "message",
        vars: { message: "message", user: "user", member: "member", channel: "channel", guild: "guild", content: "content" },
      },
      requires:
        where === "server"
          ? { intents: ["GuildMessages", "MessageContent"] }
          : {
              intents: where === "dm" ? ["DirectMessages", "MessageContent"] : ["GuildMessages", "DirectMessages", "MessageContent"],
              partials: ["Channel", "Message"],
            },
      wrap: (body) =>
        listener(
          ctx,
          "MessageCreate",
          "message",
          guard,
          ["const source = message;", "const { member, channel, guild, content } = message;", "const user = message.author;"],
          body,
        ),
    };
  },
});

export const messageDelete = defineNode({
  type: "discord.messageDelete",
  label: "Message deleted",
  description: "Runs when a message is deleted. Content is only known for messages the bot saw.",
  category: "trigger",
  icon: "MessageSquareX",
  platforms: discord,
  inputs: [],
  outputs: [next, { id: "content", label: "Content", type: "string" }, user, channel, guild],
  fields: [],
  trigger: (ctx) => ({
    file: `message-delete-${ctx.node.id}`,
    order: 2,
    scope: { context: "none", vars: { content: "content", user: "user", channel: "channel", guild: "guild" } },
    requires: { intents: ["GuildMessages", "MessageContent"], partials: ["Message"] },
    wrap: (body) =>
      listener(
        ctx,
        "MessageDelete",
        "message",
        ["if (message.author?.bot) return;"],
        ["const { channel, guild } = message;", 'const content = message.content ?? "";', "const user = message.author;"],
        body,
      ),
  }),
});

export const messageUpdate = defineNode({
  type: "discord.messageUpdate",
  label: "Message edited",
  description: "Runs when a message is edited.",
  category: "trigger",
  icon: "Pencil",
  platforms: discord,
  inputs: [],
  outputs: [
    next,
    message,
    { id: "before", label: "Before", type: "string" },
    { id: "after", label: "After", type: "string" },
    user,
    channel,
    guild,
  ],
  fields: [],
  trigger: (ctx) => ({
    file: `message-edit-${ctx.node.id}`,
    order: 2,
    scope: {
      context: "message",
      vars: { message: "message", before: "before", after: "after", user: "user", channel: "channel", guild: "guild" },
    },
    requires: { intents: ["GuildMessages", "MessageContent"], partials: ["Message"] },
    wrap: (body) =>
      listener(
        ctx,
        "MessageUpdate",
        "previous, message",
        ["if (message.partial) await message.fetch();", "if (message.author.bot || previous.content === message.content) return;"],
        [
          "const source = message;",
          "const { channel, guild } = message;",
          "const user = message.author;",
          'const before = previous.content ?? "";',
          "const after = message.content;",
        ],
        body,
      ),
  }),
});

function memberEvent(kind: "join" | "leave") {
  const join = kind === "join";
  return defineNode({
    type: join ? "discord.memberJoin" : "discord.memberLeave",
    label: join ? "Member joined" : "Member left",
    description: join ? "Runs when someone joins a server." : "Runs when someone leaves or is removed from a server.",
    category: "trigger",
    icon: join ? "UserPlus" : "UserMinus",
    platforms: discord,
    inputs: [],
    outputs: [next, member, user, guild],
    fields: [],
    trigger: (ctx) => ({
      file: `member-${kind}-${ctx.node.id}`,
      order: 2,
      scope: { context: "member", vars: { member: "member", user: "user", guild: "guild" } },
      requires: { intents: ["GuildMembers"] },
      wrap: (body) =>
        listener(ctx, join ? "GuildMemberAdd" : "GuildMemberRemove", "member", [], ["const { user, guild } = member;"], body),
    }),
  });
}

export const memberJoin = memberEvent("join");
export const memberLeave = memberEvent("leave");

export const reaction = defineNode({
  type: "discord.reaction",
  label: "Reaction",
  description: "Runs when someone adds or removes a reaction.",
  category: "trigger",
  icon: "Smile",
  platforms: discord,
  inputs: [],
  outputs: [next, message, user, member, channel, guild, { id: "emoji", label: "Emoji", type: "string" }],
  fields: [
    {
      id: "event",
      label: "When",
      kind: "select",
      default: "add",
      options: [
        { value: "add", label: "A reaction is added" },
        { value: "remove", label: "A reaction is removed" },
      ],
    },
    { id: "emoji", label: "Only for emoji", kind: "text", placeholder: "👍" },
  ],
  trigger: (ctx) => {
    const emoji = String(ctx.field("emoji") ?? "").trim();
    const guard = ["if (user.bot) return;", "if (reaction.partial) await reaction.fetch();"];
    if (emoji) {
      guard.push(
        `if (reaction.emoji.name !== ${JSON.stringify(emoji)} && reaction.emoji.toString() !== ${JSON.stringify(emoji)}) return;`,
      );
    }
    const remove = ctx.field("event") === "remove";
    return {
      file: `reaction-${remove ? "remove" : "add"}-${ctx.node.id}`,
      order: 2,
      scope: {
        context: "message",
        vars: { message: "message", user: "user", member: "member", channel: "channel", guild: "guild", emoji: "emoji" },
      },
      requires: { intents: ["GuildMessageReactions"], partials: ["Message", "Channel", "Reaction"] },
      wrap: (body) =>
        listener(
          ctx,
          remove ? "MessageReactionRemove" : "MessageReactionAdd",
          "reaction, user",
          guard,
          [
            "const message = reaction.message;",
            "const source = message;",
            "const { channel, guild } = message;",
            "const member = await guild?.members.fetch(user.id);",
            "const emoji = reaction.emoji.toString();",
          ],
          body,
        ),
    };
  },
});

export const voice = defineNode({
  type: "discord.voice",
  label: "Voice activity",
  description: "Runs when a member joins, leaves or moves between voice channels.",
  category: "trigger",
  icon: "Mic",
  platforms: discord,
  inputs: [],
  outputs: [next, member, user, channel, guild],
  fields: [
    {
      id: "event",
      label: "When",
      kind: "select",
      default: "join",
      options: [
        { value: "join", label: "Joins a voice channel" },
        { value: "leave", label: "Leaves voice" },
        { value: "move", label: "Moves to another channel" },
      ],
    },
  ],
  trigger: (ctx) => {
    const guards: Record<string, string> = {
      join: "if (previous.channelId || !state.channelId) return;",
      leave: "if (!previous.channelId || state.channelId) return;",
      move: "if (!previous.channelId || !state.channelId || previous.channelId === state.channelId) return;",
    };
    const event = String(ctx.field("event")) in guards ? String(ctx.field("event")) : "join";
    return {
      file: `voice-${event}-${ctx.node.id}`,
      order: 2,
      scope: { context: "member", vars: { member: "member", user: "user", channel: "channel", guild: "guild" } },
      requires: { intents: ["GuildVoiceStates"] },
      wrap: (body) =>
        listener(
          ctx,
          "VoiceStateUpdate",
          "previous, state",
          [guards[event]],
          ["const { member, guild } = state;", "const user = member.user;", "const channel = state.channel ?? previous.channel;"],
          body,
        ),
    };
  },
});

export const guildJoin = defineNode({
  type: "discord.guildJoin",
  label: "Bot added to server",
  description: "Runs when the bot joins a new server.",
  category: "trigger",
  icon: "Server",
  platforms: discord,
  inputs: [],
  outputs: [next, guild],
  fields: [],
  trigger: (ctx) => ({
    file: `guild-join-${ctx.node.id}`,
    order: 2,
    scope: { context: "none", vars: { guild: "guild" } },
    wrap: (body) => listener(ctx, "GuildCreate", "guild", [], [], body),
  }),
});

export const buttonClick = defineNode({
  type: "discord.button",
  label: "Button clicked",
  description: "Runs when someone clicks a button with this ID.",
  category: "trigger",
  icon: "MousePointerClick",
  platforms: discord,
  inputs: [],
  outputs: [next, user, member, channel, guild, message, interactionOut],
  fields: [{ id: "customId", static: true, label: "Button ID", kind: "text", required: true, placeholder: "open-ticket" }],
  trigger: (ctx) => {
    const id = String(ctx.field("customId")).trim();
    return {
      file: `button-${slug(id) || "button"}-${ctx.node.id}`,
      order: 1,
      scope: { context: "interaction", vars: { ...interactionVars, message: "message" } },
      wrap: (body) =>
        listener(
          ctx,
          "InteractionCreate",
          "interaction",
          [`if (!interaction.isButton() || interaction.customId !== ${JSON.stringify(id)}) return;`],
          [...interactionScope, "const message = interaction.message;"],
          body,
        ),
    };
  },
});

export const selectUsed = defineNode({
  type: "discord.select",
  label: "Menu option chosen",
  description: "Runs when someone picks from a select menu with this ID.",
  category: "trigger",
  icon: "ListChecks",
  platforms: discord,
  inputs: [],
  outputs: [
    next,
    { id: "value", label: "Value", type: "string" },
    { id: "values", label: "All values", type: "list" },
    { id: "pickedUser", label: "Picked user", type: "user" },
    { id: "pickedRole", label: "Picked role", type: "role" },
    { id: "pickedChannel", label: "Picked channel", type: "channel" },
    user,
    member,
    channel,
    guild,
    interactionOut,
  ],
  fields: [{ id: "customId", static: true, label: "Menu ID", kind: "text", required: true, placeholder: "pick-role" }],
  trigger: (ctx) => {
    const id = String(ctx.field("customId")).trim();
    return {
      file: `select-${slug(id) || "menu"}-${ctx.node.id}`,
      order: 1,
      scope: {
        context: "interaction",
        vars: { ...interactionVars, value: "value", values: "values", pickedUser: "pickedUser", pickedRole: "pickedRole", pickedChannel: "pickedChannel" },
      },
      wrap: (body) =>
        listener(
          ctx,
          "InteractionCreate",
          "interaction",
          [`if (!interaction.isAnySelectMenu() || interaction.customId !== ${JSON.stringify(id)}) return;`],
          [
            ...interactionScope,
            "const values = interaction.values;",
            'const value = values[0] ?? "";',
            "const pickedUser = interaction.users?.first() ?? null;",
            "const pickedRole = interaction.roles?.first() ?? null;",
            "const pickedChannel = interaction.channels?.first() ?? null;",
          ],
          body,
        ),
    };
  },
});

export const modalSubmit = defineNode({
  type: "discord.modalSubmit",
  label: "Form submitted",
  description: "Runs when someone submits a form opened with Show form. Each input becomes an output.",
  category: "trigger",
  icon: "ClipboardCheck",
  platforms: discord,
  inputs: [],
  outputs: [next, user, member, channel, guild, interactionOut],
  fields: [
    { id: "customId", static: true, label: "Form ID", kind: "text", required: true, placeholder: "feedback" },
    {
      id: "inputs", static: true,
      label: "Input IDs",
      kind: "text",
      multiline: true,
      required: true,
      placeholder: "subject\ndetails",
      help: "One input ID per line, matching the form.",
    },
  ],
  ports: (data) => ({
    outputs: lines(String(data.inputs ?? "")).map((id) => ({
      id: `in_${slug(id).replace(/-/g, "_")}`,
      label: id,
      type: "string" as const,
    })),
  }),
  trigger: (ctx) => {
    const id = String(ctx.field("customId")).trim();
    const inputs = lines(String(ctx.field("inputs") ?? "")).map((input) => slug(input).replace(/-/g, "_"));
    const vars: Record<string, string> = { ...interactionVars };
    for (const input of inputs) vars[`in_${input}`] = `form.${identifier(input)}`;
    const read = inputs.map((input) => `  ${identifier(input)}: interaction.fields.getTextInputValue(${JSON.stringify(input)}),`);
    return {
      file: `form-${slug(id) || "form"}-${ctx.node.id}`,
      order: 1,
      scope: { context: "interaction", vars },
      wrap: (body) =>
        listener(
          ctx,
          "InteractionCreate",
          "interaction",
          [`if (!interaction.isModalSubmit() || interaction.customId !== ${JSON.stringify(id)}) return;`],
          [...interactionScope, `const form = {\n${read.join("\n")}\n};`],
          body,
        ),
    };
  },
});

export const defer = defineNode({
  type: "discord.defer",
  label: "Defer reply",
  description: "Shows “thinking…” so you have up to 15 minutes to reply. Use before slow steps.",
  category: "action",
  icon: "Loader",
  platforms: discord,
  inputs: [execIn],
  outputs: [next],
  fields: [{ id: "private", label: "Only visible to the user", kind: "boolean", default: false }],
  emit: (ctx) => {
    if (ctx.trigger.context !== "interaction") ctx.fail("Defer reply needs a command, button, menu or form trigger.");
    return ctx.field("private") === true
      ? `await source.deferReply({ flags: ${ctx.use("MessageFlags")}.Ephemeral });`
      : "await source.deferReply();";
  },
});

export const editReply = defineNode({
  type: "discord.editReply",
  label: "Edit reply",
  description: "Changes the bot's first reply to this interaction.",
  category: "action",
  icon: "PenLine",
  platforms: discord,
  inputs: [
    execIn,
    { id: "text", label: "Text", type: "string" },
    { id: "interaction", label: "Interaction", type: "any", optional: true },
  ],
  outputs: [next],
  fields: [{ id: "text", label: "Text", kind: "text", multiline: true, required: true }],
  emit: (ctx) => {
    const target = ctx.connected("interaction") || ctx.node.data["@interaction"] ? ctx.value("interaction") : "source";
    if (target === "source" && ctx.trigger.context !== "interaction") {
      ctx.fail("Edit reply needs a command, button, menu or form trigger, or a saved interaction.");
    }
    return `await ${target}.editReply({ content: ${ctx.value("text")} });`;
  },
});

export const embed = defineNode({
  type: "discord.embed",
  label: "Send embed",
  description: "Replies with an embed, or sends it to a channel when one is set.",
  category: "action",
  icon: "PanelTop",
  platforms: discord,
  inputs: [
    execIn,
    { id: "target", label: "Channel", type: "channel", optional: true },
    { id: "title", label: "Title", type: "string" },
    { id: "description", label: "Description", type: "string" },
  ],
  outputs: [next, message],
  fields: [
    { id: "title", label: "Title", kind: "text" },
    { id: "description", label: "Description", kind: "text", multiline: true },
    { id: "color", static: true, label: "Color", kind: "text", default: "#FF6A3D" },
    { id: "url", label: "Title link", kind: "text" },
    { id: "author", label: "Author", kind: "text" },
    { id: "thumbnail", label: "Thumbnail URL", kind: "text" },
    { id: "image", label: "Image URL", kind: "text" },
    {
      id: "fields", static: true,
      label: "Fields",
      kind: "text",
      multiline: true,
      placeholder: "Level | 12 | inline\nJoined | 2024",
      help: "One per line: name | value | inline",
    },
    { id: "footer", label: "Footer", kind: "text" },
    { id: "timestamp", label: "Show time", kind: "boolean", default: false },
    { id: "private", label: "Only visible to the user (replies to commands)", kind: "boolean", default: false },
    { id: "target", label: "Channel ID", kind: "text", help: "Leave empty to reply." },
  ],
  emit: (ctx) => {
    const name = ctx.out("embed");
    const chain = [
      `const ${name} = new ${ctx.use("EmbedBuilder")}()`,
      `  .setColor(${parseColor(String(ctx.field("color") ?? ""), 0xff6a3d)})`,
    ];
    if (isFilled(ctx, "title")) chain.push(`  .setTitle(${ctx.value("title")})`);
    if (isFilled(ctx, "url")) chain.push(`  .setURL(${ctx.value("url")})`);
    if (isFilled(ctx, "author")) chain.push(`  .setAuthor({ name: ${ctx.value("author")} })`);
    if (isFilled(ctx, "description")) chain.push(`  .setDescription(${ctx.value("description")})`);
    if (isFilled(ctx, "thumbnail")) chain.push(`  .setThumbnail(${ctx.value("thumbnail")})`);
    if (isFilled(ctx, "image")) chain.push(`  .setImage(${ctx.value("image")})`);
    const fields = rows(String(ctx.field("fields") ?? "")).slice(0, 25);
    if (fields.length > 0) {
      const items = fields.map(
        ([fieldName = "", value = "", inline = ""]) =>
          `{ name: ${JSON.stringify(fieldName || "​")}, value: ${JSON.stringify(value || "​")}, inline: ${inline.toLowerCase() === "inline"} }`,
      );
      chain.push(`  .addFields(${items.join(", ")})`);
    }
    if (isFilled(ctx, "footer")) chain.push(`  .setFooter({ text: ${ctx.value("footer")} })`);
    if (ctx.field("timestamp") === true) chain.push("  .setTimestamp()");
    chain[chain.length - 1] += ";";
    if (isFilled(ctx, "target")) {
      chain.push(
        `const ${ctx.out("message")} = await (await ${ctx.helper("resolveChannel")}(client, ${ctx.value("target")})).send({ embeds: [${name}] });`,
      );
    } else {
      requireRepliable(ctx, "Send embed without a channel");
      const flags = ctx.field("private") === true ? `, flags: ${ctx.use("MessageFlags")}.Ephemeral` : "";
      chain.push(`const ${ctx.out("message")} = await ${ctx.helper("respond")}(source, { embeds: [${name}]${flags} });`);
    }
    return chain.join("\n");
  },
});

const BUTTON_STYLES: Record<string, string> = {
  primary: "Primary",
  secondary: "Secondary",
  success: "Success",
  danger: "Danger",
};

export const buttons = defineNode({
  type: "discord.buttons",
  label: "Reply with buttons",
  description: "Replies with up to five buttons. Pair each button with a Button clicked trigger.",
  category: "action",
  icon: "RectangleHorizontal",
  platforms: discord,
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
      placeholder: "Open ticket | open-ticket | success\nWebsite | https://example.com",
      help: "One per line: label | button-id | style, or label | https://link. Styles: primary, secondary, success, danger.",
    },
    { id: "private", label: "Only visible to the user (replies to commands)", kind: "boolean", default: false },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Reply with buttons");
    const Button = ctx.use("ButtonBuilder");
    const Style = ctx.use("ButtonStyle");
    const items = rows(String(ctx.field("buttons") ?? ""))
      .slice(0, 5)
      .map(([label = "", target = "", style = ""]) => {
        if (target.startsWith("http")) {
          return `new ${Button}().setLabel(${JSON.stringify(label)}).setStyle(${Style}.Link).setURL(${JSON.stringify(target)})`;
        }
        const variant = BUTTON_STYLES[style.toLowerCase()] ?? "Primary";
        return `new ${Button}().setLabel(${JSON.stringify(label)}).setStyle(${Style}.${variant}).setCustomId(${JSON.stringify(target || slug(label))})`;
      });
    if (items.length === 0) ctx.fail("Add at least one button.");
    const row = ctx.out("row");
    const flags = ctx.field("private") === true ? `, flags: ${ctx.use("MessageFlags")}.Ephemeral` : "";
    return [
      `const ${row} = new ${ctx.use("ActionRowBuilder")}().addComponents(`,
      ...items.map((item) => `  ${item},`),
      ");",
      `const ${ctx.out("message")} = await ${ctx.helper("respond")}(source, { content: ${ctx.value("text")}, components: [${row}]${flags} });`,
    ].join("\n");
  },
});

export const selectMenu = defineNode({
  type: "discord.selectMenu",
  label: "Reply with menu",
  description: "Replies with a dropdown menu. Pair it with a Menu option chosen trigger.",
  category: "action",
  icon: "ListFilter",
  platforms: discord,
  inputs: [execIn, { id: "text", label: "Text", type: "string" }],
  outputs: [next, message],
  fields: [
    { id: "text", label: "Text", kind: "text", multiline: true, required: true },
    { id: "customId", static: true, label: "Menu ID", kind: "text", required: true, placeholder: "pick-role" },
    { id: "placeholder", label: "Placeholder", kind: "text", default: "Choose an option" },
    {
      id: "options", static: true,
      label: "Options",
      kind: "text",
      multiline: true,
      required: true,
      placeholder: "Red team | red | Fight for red\nBlue team | blue",
      help: "One per line: label | value | description",
    },
    { id: "max", static: true, label: "Choices allowed", kind: "number", default: 1, min: 1, max: 25 },
    { id: "private", label: "Only visible to the user (replies to commands)", kind: "boolean", default: false },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Reply with menu");
    const options = rows(String(ctx.field("options") ?? ""))
      .slice(0, 25)
      .map(([label = "", value = "", description = ""]) => {
        const parts = [`label: ${JSON.stringify(label)}`, `value: ${JSON.stringify(value || slug(label) || label)}`];
        if (description) parts.push(`description: ${JSON.stringify(description)}`);
        return `{ ${parts.join(", ")} }`;
      });
    if (options.length === 0) ctx.fail("Add at least one option.");
    const max = Math.min(options.length, Math.max(1, Number(ctx.field("max")) || 1));
    const menu = ctx.out("menu");
    const flags = ctx.field("private") === true ? `, flags: ${ctx.use("MessageFlags")}.Ephemeral` : "";
    return [
      `const ${menu} = new ${ctx.use("StringSelectMenuBuilder")}()`,
      `  .setCustomId(${JSON.stringify(String(ctx.field("customId")).trim())})`,
      `  .setPlaceholder(${ctx.value("placeholder")})`,
      `  .setMaxValues(${max})`,
      `  .addOptions(${options.join(", ")});`,
      `const ${ctx.out("message")} = await ${ctx.helper("respond")}(source, { content: ${ctx.value("text")}, components: [new ${ctx.use("ActionRowBuilder")}().addComponents(${menu})]${flags} });`,
    ].join("\n");
  },
});

export const showModal = defineNode({
  type: "discord.showModal",
  label: "Show form",
  description: "Opens a pop-up form. Must be the first response to a command or button. Pair it with Form submitted.",
  category: "action",
  icon: "AppWindow",
  platforms: discord,
  inputs: [execIn],
  outputs: [next],
  fields: [
    { id: "customId", static: true, label: "Form ID", kind: "text", required: true, placeholder: "feedback" },
    { id: "title", label: "Title", kind: "text", required: true, default: "Feedback" },
    {
      id: "inputs", static: true,
      label: "Inputs",
      kind: "text",
      multiline: true,
      required: true,
      placeholder: "subject | Subject | short\ndetails | Tell us more | paragraph | optional",
      help: "Up to five, one per line: id | label | short or paragraph | optional | placeholder",
    },
  ],
  emit: (ctx) => {
    if (ctx.trigger.context !== "interaction") ctx.fail("Show form needs a command, button or menu trigger.");
    const inputs = modalInputs(String(ctx.field("inputs") ?? ""));
    if (inputs.length === 0) ctx.fail("Add at least one input.");
    const Row = ctx.use("ActionRowBuilder");
    const Input = ctx.use("TextInputBuilder");
    const Style = ctx.use("TextInputStyle");
    const modal = ctx.out("form");
    const components = inputs.map((input) => {
      const parts = [
        `new ${Input}()`,
        `.setCustomId(${JSON.stringify(input.id)})`,
        `.setLabel(${JSON.stringify(input.label)})`,
        `.setStyle(${Style}.${input.paragraph ? "Paragraph" : "Short"})`,
        `.setRequired(${input.required})`,
      ];
      if (input.placeholder) parts.push(`.setPlaceholder(${JSON.stringify(input.placeholder)})`);
      return `    new ${Row}().addComponents(${parts.join("")}),`;
    });
    return [
      `const ${modal} = new ${ctx.use("ModalBuilder")}()`,
      `  .setCustomId(${JSON.stringify(String(ctx.field("customId")).trim())})`,
      `  .setTitle(${ctx.value("title")})`,
      "  .addComponents(",
      ...components,
      "  );",
      `await source.showModal(${modal});`,
    ].join("\n");
  },
});

function roleChange(type: string, label: string, method: "add" | "remove") {
  return defineNode({
    type,
    label,
    description: `${label} for a member.`,
    category: "action",
    icon: method === "add" ? "ShieldPlus" : "ShieldMinus",
    platforms: discord,
    inputs: [execIn, member, { ...role, optional: true }],
    outputs: [next],
    fields: [{ id: "role", label: "Role ID", kind: "text", required: true }],
    requires: { discord: { permissions: ["ManageRoles"] } },
    emit: (ctx) => `await ${ctx.value("member")}.roles.${method}(${ctx.value("role")});`,
  });
}

export const addRole = roleChange("discord.addRole", "Give role", "add");
export const removeRole = roleChange("discord.removeRole", "Remove role", "remove");

export const createRole = defineNode({
  type: "discord.createRole",
  label: "Create role",
  description: "Creates a new role in the server.",
  category: "action",
  icon: "Shield",
  platforms: discord,
  inputs: [execIn, guild],
  outputs: [next, role],
  fields: [
    { id: "name", label: "Name", kind: "text", required: true },
    { id: "color", static: true, label: "Color", kind: "text", default: "#5865F2" },
    { id: "mentionable", label: "Anyone can mention it", kind: "boolean", default: false },
  ],
  requires: { discord: { permissions: ["ManageRoles"] } },
  emit: (ctx) =>
    `const ${ctx.out("role")} = await ${ctx.value("guild")}.roles.create({ name: ${ctx.value("name")}, color: ${parseColor(String(ctx.field("color") ?? ""), 0x5865f2)}, mentionable: ${ctx.field("mentionable") === true} });`,
});

export const hasRole = defineNode({
  type: "discord.hasRole",
  label: "Has role",
  description: "True when the member has the role.",
  category: "logic",
  icon: "ShieldCheck",
  platforms: discord,
  inputs: [member, { ...role, optional: true }],
  outputs: [{ id: "result", label: "Result", type: "boolean" }],
  fields: [{ id: "role", label: "Role ID", kind: "text", required: true }],
  expression: (ctx) => `${ctx.value("member")}.roles.cache.has(${idOf(ctx.value("role"))})`,
});

const PERMISSIONS = [
  "Administrator",
  "ManageGuild",
  "ManageChannels",
  "ManageRoles",
  "ManageMessages",
  "KickMembers",
  "BanMembers",
  "ModerateMembers",
  "MentionEveryone",
  "ManageNicknames",
];

export const hasPermission = defineNode({
  type: "discord.hasPermission",
  label: "Has permission",
  description: "True when the member has a server permission.",
  category: "logic",
  icon: "KeyRound",
  platforms: discord,
  inputs: [member],
  outputs: [{ id: "result", label: "Result", type: "boolean" }],
  fields: [
    {
      id: "permission",
      label: "Permission",
      kind: "select",
      default: "Administrator",
      options: PERMISSIONS.map((value) => ({ value, label: value.replace(/([a-z])([A-Z])/g, "$1 $2") })),
    },
  ],
  expression: (ctx) => {
    const permission = PERMISSIONS.includes(String(ctx.field("permission"))) ? String(ctx.field("permission")) : "Administrator";
    return `Boolean(${ctx.value("member")}?.permissions.has(${ctx.use("PermissionFlagsBits")}.${permission}))`;
  },
});

export const directMessage = defineNode({
  type: "discord.dm",
  label: "Direct message",
  description: "Sends a private message to a user.",
  category: "action",
  icon: "Mail",
  platforms: discord,
  inputs: [execIn, user, { id: "text", label: "Text", type: "string" }],
  outputs: [next, message],
  fields: [{ id: "text", label: "Text", kind: "text", multiline: true, required: true }],
  emit: (ctx) => `const ${ctx.out("message")} = await ${ctx.value("user")}.send(${ctx.value("text")});`,
});

export const kick = defineNode({
  type: "discord.kick",
  label: "Kick member",
  description: "Removes a member from the server.",
  category: "action",
  icon: "UserX",
  platforms: discord,
  inputs: [execIn, member],
  outputs: [next],
  fields: [{ id: "reason", label: "Reason", kind: "text" }],
  requires: { discord: { permissions: ["KickMembers"] } },
  emit: (ctx) => `await ${ctx.value("member")}.kick(${ctx.value("reason")} || undefined);`,
});

export const ban = defineNode({
  type: "discord.ban",
  label: "Ban member",
  description: "Bans a member and optionally deletes their recent messages.",
  category: "action",
  icon: "Gavel",
  platforms: discord,
  inputs: [execIn, member],
  outputs: [next],
  fields: [
    { id: "reason", label: "Reason", kind: "text" },
    { id: "deleteHours", static: true, label: "Delete messages from the last (hours)", kind: "number", default: 0, min: 0, max: 168 },
  ],
  requires: { discord: { permissions: ["BanMembers"] } },
  emit: (ctx) => {
    const seconds = Math.min(604800, Math.max(0, Number(ctx.field("deleteHours")) || 0) * 3600);
    return `await ${ctx.value("member")}.ban({ reason: ${ctx.value("reason")} || undefined, deleteMessageSeconds: ${seconds} });`;
  },
});

export const unban = defineNode({
  type: "discord.unban",
  label: "Unban user",
  description: "Lifts a ban by user ID.",
  category: "action",
  icon: "Undo2",
  platforms: discord,
  inputs: [execIn, guild, { id: "target", label: "User", type: "user", optional: true }],
  outputs: [next],
  fields: [{ id: "target", label: "User ID", kind: "text", required: true }],
  requires: { discord: { permissions: ["BanMembers"] } },
  emit: (ctx) => `await ${ctx.value("guild")}.members.unban(${idOf(ctx.value("target"))});`,
});

export const timeout = defineNode({
  type: "discord.timeout",
  label: "Time out member",
  description: "Stops a member from talking for a while. Set 0 minutes to remove a timeout.",
  category: "action",
  icon: "TimerOff",
  platforms: discord,
  inputs: [execIn, member],
  outputs: [next],
  fields: [
    { id: "minutes", label: "Minutes", kind: "number", default: 10, min: 0, max: 40320 },
    { id: "reason", label: "Reason", kind: "text" },
  ],
  requires: { discord: { permissions: ["ModerateMembers"] } },
  emit: (ctx) => {
    const minutes = ctx.value("minutes");
    return `await ${ctx.value("member")}.timeout(Number(${minutes}) > 0 ? Math.min(40320, Number(${minutes})) * 60000 : null, ${ctx.value("reason")} || undefined);`;
  },
});

export const nickname = defineNode({
  type: "discord.nickname",
  label: "Set nickname",
  description: "Changes a member's nickname. Leave empty to reset it.",
  category: "action",
  icon: "Tag",
  platforms: discord,
  inputs: [execIn, member, { id: "nickname", label: "Nickname", type: "string" }],
  outputs: [next],
  fields: [{ id: "nickname", label: "Nickname", kind: "text" }],
  requires: { discord: { permissions: ["ManageNicknames"] } },
  emit: (ctx) => `await ${ctx.value("member")}.setNickname(${ctx.value("nickname")} || null);`,
});

export const react = defineNode({
  type: "discord.react",
  label: "Add reaction",
  description: "Reacts to a message with an emoji.",
  category: "action",
  icon: "SmilePlus",
  platforms: discord,
  inputs: [execIn, message],
  outputs: [next],
  fields: [{ id: "emoji", label: "Emoji", kind: "text", required: true, default: "👍" }],
  emit: (ctx) => `await ${ctx.value("message")}.react(${ctx.value("emoji")});`,
});

export const editMessage = defineNode({
  type: "discord.editMessage",
  label: "Edit message",
  description: "Changes the text of a message the bot sent.",
  category: "action",
  icon: "Pencil",
  platforms: discord,
  inputs: [execIn, message, { id: "text", label: "Text", type: "string" }],
  outputs: [next],
  fields: [{ id: "text", label: "Text", kind: "text", multiline: true, required: true }],
  emit: (ctx) => `await ${ctx.value("message")}.edit(${ctx.value("text")});`,
});

export const deleteMessage = defineNode({
  type: "discord.deleteMessage",
  label: "Delete message",
  description: "Deletes a message.",
  category: "action",
  icon: "Trash2",
  platforms: discord,
  inputs: [execIn, message],
  outputs: [next],
  fields: [{ id: "delay", static: true, label: "After (seconds)", kind: "number", default: 0, min: 0 }],
  requires: { discord: { permissions: ["ManageMessages"] } },
  emit: (ctx) => {
    const seconds = Math.max(0, Number(ctx.field("delay")) || 0);
    const target = ctx.value("message");
    return seconds > 0
      ? `setTimeout(() => ${target}.delete().catch(() => {}), ${seconds * 1000});`
      : `await ${target}.delete();`;
  },
});

export const pin = defineNode({
  type: "discord.pin",
  label: "Pin message",
  description: "Pins or unpins a message.",
  category: "action",
  icon: "Pin",
  platforms: discord,
  inputs: [execIn, message],
  outputs: [next],
  fields: [{ id: "unpin", label: "Unpin instead", kind: "boolean", default: false }],
  requires: { discord: { permissions: ["ManageMessages"] } },
  emit: (ctx) => `await ${ctx.value("message")}.${ctx.field("unpin") === true ? "unpin" : "pin"}();`,
});

export const purge = defineNode({
  type: "discord.purge",
  label: "Clear messages",
  description: "Deletes recent messages in a channel. Messages older than 14 days are skipped.",
  category: "action",
  icon: "Eraser",
  platforms: discord,
  inputs: [execIn, channel, { id: "count", label: "Count", type: "number" }],
  outputs: [next, { id: "deleted", label: "Deleted", type: "number" }],
  fields: [{ id: "count", label: "How many", kind: "number", default: 10, min: 1, max: 100 }],
  requires: { discord: { permissions: ["ManageMessages"] } },
  emit: (ctx) =>
    `const ${ctx.out("deleted")} = (await ${ctx.value("channel")}.bulkDelete(Math.min(100, Math.max(1, Number(${ctx.value("count")}))), true)).size;`,
});

export const typing = defineNode({
  type: "discord.typing",
  label: "Show typing",
  description: "Shows the bot as typing in a channel for a few seconds.",
  category: "action",
  icon: "Keyboard",
  platforms: discord,
  inputs: [execIn, channel],
  outputs: [next],
  fields: [],
  emit: (ctx) => `await ${ctx.value("channel")}.sendTyping();`,
});

export const thread = defineNode({
  type: "discord.thread",
  label: "Start thread",
  description: "Starts a thread from a message.",
  category: "action",
  icon: "MessagesSquare",
  platforms: discord,
  inputs: [execIn, message, { id: "name", label: "Name", type: "string" }],
  outputs: [next, { id: "thread", label: "Thread", type: "channel" }],
  fields: [
    { id: "name", label: "Thread name", kind: "text", required: true },
    {
      id: "archive",
      label: "Archive after inactivity",
      kind: "select",
      default: "1440",
      options: [
        { value: "60", label: "1 hour" },
        { value: "1440", label: "1 day" },
        { value: "4320", label: "3 days" },
        { value: "10080", label: "1 week" },
      ],
    },
  ],
  emit: (ctx) =>
    `const ${ctx.out("thread")} = await ${ctx.value("message")}.startThread({ name: String(${ctx.value("name")}).slice(0, 100), autoArchiveDuration: ${Number(ctx.field("archive")) || 1440} });`,
});

const CHANNEL_KINDS = ["GuildText", "GuildVoice", "GuildCategory", "GuildAnnouncement"];

export const createChannel = defineNode({
  type: "discord.createChannel",
  label: "Create channel",
  description: "Creates a text or voice channel, optionally inside a category.",
  category: "action",
  icon: "Hash",
  platforms: discord,
  inputs: [execIn, guild, { id: "name", label: "Name", type: "string" }],
  outputs: [next, channel],
  fields: [
    { id: "name", label: "Name", kind: "text", required: true, placeholder: "ticket-{{ user.username }}" },
    {
      id: "kind",
      label: "Type",
      kind: "select",
      default: "GuildText",
      options: [
        { value: "GuildText", label: "Text" },
        { value: "GuildVoice", label: "Voice" },
        { value: "GuildCategory", label: "Category" },
        { value: "GuildAnnouncement", label: "Announcement" },
      ],
    },
    { id: "parent", label: "Category ID", kind: "text" },
    { id: "topic", label: "Topic", kind: "text" },
    { id: "private", label: "Only visible to the user who triggered it", kind: "boolean", default: false },
  ],
  requires: { discord: { permissions: ["ManageChannels"] } },
  emit: (ctx) => {
    const kind = CHANNEL_KINDS.includes(String(ctx.field("kind"))) ? String(ctx.field("kind")) : "GuildText";
    const target = ctx.value("guild");
    const options = [`name: ${ctx.value("name")}`, `type: ${ctx.use("ChannelType")}.${kind}`];
    if (isFilled(ctx, "parent")) options.push(`parent: ${ctx.value("parent")}`);
    if (isFilled(ctx, "topic")) options.push(`topic: ${ctx.value("topic")}`);
    if (ctx.field("private") === true) {
      if (!ctx.trigger.vars.user) ctx.fail("Private channels need a trigger with a user.");
      const flags = ctx.use("PermissionFlagsBits");
      options.push(
        `permissionOverwrites: [{ id: ${target}.roles.everyone.id, deny: [${flags}.ViewChannel] }, { id: user.id, allow: [${flags}.ViewChannel] }, { id: client.user.id, allow: [${flags}.ViewChannel] }]`,
      );
    }
    return `const ${ctx.out("channel")} = await ${target}.channels.create({ ${options.join(", ")} });`;
  },
});

export const deleteChannel = defineNode({
  type: "discord.deleteChannel",
  label: "Delete channel",
  description: "Deletes a channel or thread.",
  category: "action",
  icon: "Trash",
  platforms: discord,
  inputs: [execIn, channel],
  outputs: [next],
  fields: [{ id: "reason", label: "Reason", kind: "text" }],
  requires: { discord: { permissions: ["ManageChannels"] } },
  emit: (ctx) => `await ${ctx.value("channel")}.delete(${ctx.value("reason")} || undefined);`,
});

export const invite = defineNode({
  type: "discord.invite",
  label: "Create invite",
  description: "Creates an invite link to a channel.",
  category: "action",
  icon: "Link",
  platforms: discord,
  inputs: [execIn, channel],
  outputs: [next, { id: "url", label: "Link", type: "string" }],
  fields: [
    { id: "hours", static: true, label: "Expires after (hours, 0 = never)", kind: "number", default: 24, min: 0, max: 168 },
    { id: "uses", static: true, label: "Max uses (0 = unlimited)", kind: "number", default: 0, min: 0, max: 100 },
  ],
  requires: { discord: { permissions: ["CreateInstantInvite"] } },
  emit: (ctx) => {
    const maxAge = Math.min(604800, Math.max(0, Number(ctx.field("hours")) || 0) * 3600);
    const maxUses = Math.max(0, Number(ctx.field("uses")) || 0);
    return `const ${ctx.out("url")} = (await ${ctx.value("channel")}.createInvite({ maxAge: ${maxAge}, maxUses: ${maxUses}, unique: true })).url;`;
  },
});

const ACTIVITIES = ["Custom", "Playing", "Watching", "Listening", "Competing"];

export const presence = defineNode({
  type: "discord.presence",
  label: "Set status",
  description: "Changes the bot's online status and activity.",
  category: "action",
  icon: "Activity",
  platforms: discord,
  inputs: [execIn, { id: "text", label: "Text", type: "string" }],
  outputs: [next],
  fields: [
    {
      id: "status",
      label: "Status",
      kind: "select",
      default: "online",
      options: [
        { value: "online", label: "Online" },
        { value: "idle", label: "Idle" },
        { value: "dnd", label: "Do not disturb" },
        { value: "invisible", label: "Invisible" },
      ],
    },
    {
      id: "activity",
      label: "Activity",
      kind: "select",
      default: "Custom",
      options: [
        { value: "Custom", label: "Custom status" },
        { value: "Playing", label: "Playing" },
        { value: "Watching", label: "Watching" },
        { value: "Listening", label: "Listening to" },
        { value: "Competing", label: "Competing in" },
      ],
    },
    { id: "text", label: "Text", kind: "text", placeholder: "Serving {{ client.guilds.cache.size }} servers" },
  ],
  emit: (ctx) => {
    const type = ACTIVITIES.includes(String(ctx.field("activity"))) ? String(ctx.field("activity")) : "Custom";
    const Activity = ctx.use("ActivityType");
    const text = ctx.value("text");
    const activity =
      type === "Custom"
        ? `{ name: "Custom Status", state: ${text}, type: ${Activity}.Custom }`
        : `{ name: ${text}, type: ${Activity}.${type} }`;
    const activities = isFilled(ctx, "text") ? `[${activity}]` : "[]";
    return `client.user.setPresence({ status: ${JSON.stringify(String(ctx.field("status") || "online"))}, activities: ${activities} });`;
  },
});

export const webhook = defineNode({
  type: "discord.webhook",
  label: "Send webhook",
  description: "Posts a message through a webhook URL, with a custom name and avatar.",
  category: "action",
  icon: "Webhook",
  platforms: discord,
  inputs: [execIn, { id: "text", label: "Text", type: "string" }],
  outputs: [next],
  fields: [
    { id: "url", label: "Webhook URL", kind: "text", required: true },
    { id: "text", label: "Text", kind: "text", multiline: true, required: true },
    { id: "username", label: "Name", kind: "text" },
    { id: "avatar", label: "Avatar URL", kind: "text" },
  ],
  emit: (ctx) => {
    const body = [`content: ${ctx.value("text")}`];
    if (isFilled(ctx, "username")) body.push(`username: ${ctx.value("username")}`);
    if (isFilled(ctx, "avatar")) body.push(`avatar_url: ${ctx.value("avatar")}`);
    return `await fetch(${ctx.value("url")}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ${body.join(", ")} }) });`;
  },
});

export const fetchMember = defineNode({
  type: "discord.fetchMember",
  label: "Find member",
  description: "Looks up a server member by user ID.",
  category: "data",
  icon: "Search",
  platforms: discord,
  inputs: [execIn, guild, { id: "target", label: "User", type: "user", optional: true }],
  outputs: [next, { id: "found", label: "Member", type: "member" }],
  fields: [{ id: "target", label: "User ID", kind: "text", required: true }],
  emit: (ctx) =>
    `const ${ctx.out("found")} = await ${ctx.value("guild")}.members.fetch(${idOf(ctx.value("target"))}).catch(() => null);`,
});

export const fetchUser = defineNode({
  type: "discord.fetchUser",
  label: "Find user",
  description: "Looks up any Discord user by ID.",
  category: "data",
  icon: "UserSearch",
  platforms: discord,
  inputs: [execIn, { id: "id", label: "ID", type: "string" }],
  outputs: [next, { id: "found", label: "User", type: "user" }],
  fields: [{ id: "id", label: "User ID", kind: "text", required: true }],
  emit: (ctx) => `const ${ctx.out("found")} = await client.users.fetch(String(${ctx.value("id")})).catch(() => null);`,
});

export const fetchChannel = defineNode({
  type: "discord.fetchChannel",
  label: "Find channel",
  description: "Looks up a channel by ID.",
  category: "data",
  icon: "SearchCode",
  platforms: discord,
  inputs: [execIn, { id: "id", label: "ID", type: "string" }],
  outputs: [next, { id: "found", label: "Channel", type: "channel" }],
  fields: [{ id: "id", label: "Channel ID", kind: "text", required: true }],
  emit: (ctx) => `const ${ctx.out("found")} = await client.channels.fetch(String(${ctx.value("id")})).catch(() => null);`,
});

export const userInfo = defineNode({
  type: "discord.userInfo",
  label: "User details",
  description: "Name, ID, mention and avatar of a user.",
  category: "data",
  icon: "IdCard",
  platforms: discord,
  inputs: [user],
  outputs: [
    { id: "name", label: "Display name", type: "string" },
    { id: "username", label: "Username", type: "string" },
    { id: "id", label: "ID", type: "string" },
    { id: "mention", label: "Mention", type: "string" },
    { id: "avatar", label: "Avatar URL", type: "string" },
    { id: "isBot", label: "Is bot", type: "boolean" },
    { id: "created", label: "Account created", type: "string" },
  ],
  fields: [],
  expression: (ctx, output) => {
    const target = ctx.value("user");
    switch (output) {
      case "name":
        return `${target}.displayName ?? ${target}.username`;
      case "username":
        return `${target}.username ?? ${target}.user?.username`;
      case "id":
        return `${target}.id`;
      case "mention":
        return `\`<@\${${target}.id}>\``;
      case "avatar":
        return `${target}.displayAvatarURL({ size: 512 })`;
      case "isBot":
        return `Boolean(${target}.bot ?? ${target}.user?.bot)`;
      default:
        return `(${target}.createdAt ?? ${target}.user?.createdAt).toISOString()`;
    }
  },
});

export const memberInfo = defineNode({
  type: "discord.memberInfo",
  label: "Member details",
  description: "Nickname, join date and roles of a member.",
  category: "data",
  icon: "BadgeInfo",
  platforms: discord,
  inputs: [member],
  outputs: [
    { id: "name", label: "Display name", type: "string" },
    { id: "joined", label: "Joined at", type: "string" },
    { id: "roles", label: "Role names", type: "string" },
    { id: "topRole", label: "Highest role", type: "role" },
    { id: "user", label: "User", type: "user" },
  ],
  fields: [],
  expression: (ctx, output) => {
    const target = ctx.value("member");
    switch (output) {
      case "name":
        return `${target}.displayName`;
      case "joined":
        return `${target}.joinedAt?.toISOString() ?? ""`;
      case "roles":
        return `${target}.roles.cache.filter((role) => role.id !== ${target}.guild.id).map((role) => role.name).join(", ")`;
      case "topRole":
        return `${target}.roles.highest`;
      default:
        return `${target}.user`;
    }
  },
});

export const serverInfo = defineNode({
  type: "discord.serverInfo",
  label: "Server details",
  description: "Name, member count and icon of a server.",
  category: "data",
  icon: "Server",
  platforms: discord,
  inputs: [guild],
  outputs: [
    { id: "name", label: "Name", type: "string" },
    { id: "id", label: "ID", type: "string" },
    { id: "members", label: "Member count", type: "number" },
    { id: "icon", label: "Icon URL", type: "string" },
    { id: "owner", label: "Owner ID", type: "string" },
  ],
  fields: [],
  expression: (ctx, output) => {
    const target = ctx.value("guild");
    switch (output) {
      case "name":
        return `${target}.name`;
      case "id":
        return `${target}.id`;
      case "members":
        return `${target}.memberCount`;
      case "icon":
        return `${target}.iconURL({ size: 512 }) ?? ""`;
      default:
        return `${target}.ownerId`;
    }
  },
});

export const channelInfo = defineNode({
  type: "discord.channelInfo",
  label: "Channel details",
  description: "Name, ID and mention of a channel.",
  category: "data",
  icon: "Info",
  platforms: discord,
  inputs: [channel],
  outputs: [
    { id: "name", label: "Name", type: "string" },
    { id: "id", label: "ID", type: "string" },
    { id: "mention", label: "Mention", type: "string" },
  ],
  fields: [],
  expression: (ctx, output) => {
    const target = ctx.value("channel");
    if (output === "name") return `${target}.name ?? ""`;
    if (output === "id") return `${target}.id`;
    return `\`<#\${${target}.id}>\``;
  },
});

export const messageInfo = defineNode({
  type: "discord.messageInfo",
  label: "Message details",
  description: "Content, author, link and first attachment of a message.",
  category: "data",
  icon: "FileText",
  platforms: discord,
  inputs: [message],
  outputs: [
    { id: "content", label: "Content", type: "string" },
    { id: "author", label: "Author", type: "user" },
    { id: "url", label: "Link", type: "string" },
    { id: "id", label: "ID", type: "string" },
    { id: "attachment", label: "Attachment URL", type: "string" },
  ],
  fields: [],
  expression: (ctx, output) => {
    const target = ctx.value("message");
    switch (output) {
      case "content":
        return `${target}.content ?? ""`;
      case "author":
        return `${target}.author`;
      case "url":
        return `${target}.url`;
      case "id":
        return `${target}.id`;
      default:
        return `${target}.attachments.first()?.url ?? ""`;
    }
  },
});

type EventArgument = [string, string, PortType];

const EVENTS: Record<string, { label: string; intents: string[]; args: EventArgument[] }> = {
  ChannelCreate: { label: "Channel created", intents: [], args: [["channel", "Channel", "channel"]] },
  ChannelDelete: { label: "Channel deleted", intents: [], args: [["channel", "Channel", "channel"]] },
  ChannelUpdate: { label: "Channel changed", intents: [], args: [["before", "Before", "channel"], ["after", "After", "channel"]] },
  ChannelPinsUpdate: { label: "Pins changed", intents: [], args: [["channel", "Channel", "channel"], ["time", "Time", "any"]] },
  ThreadCreate: { label: "Thread created", intents: [], args: [["thread", "Thread", "channel"], ["isNew", "Newly created", "boolean"]] },
  ThreadDelete: { label: "Thread deleted", intents: [], args: [["thread", "Thread", "channel"]] },
  ThreadUpdate: { label: "Thread changed", intents: [], args: [["before", "Before", "channel"], ["after", "After", "channel"]] },
  GuildRoleCreate: { label: "Role created", intents: [], args: [["role", "Role", "role"]] },
  GuildRoleDelete: { label: "Role deleted", intents: [], args: [["role", "Role", "role"]] },
  GuildRoleUpdate: { label: "Role changed", intents: [], args: [["before", "Before", "role"], ["after", "After", "role"]] },
  GuildUpdate: { label: "Server settings changed", intents: [], args: [["before", "Before", "guild"], ["after", "After", "guild"]] },
  GuildDelete: { label: "Bot removed from a server", intents: [], args: [["guild", "Server", "guild"]] },
  GuildMemberUpdate: { label: "Member changed", intents: ["GuildMembers"], args: [["before", "Before", "member"], ["after", "After", "member"]] },
  GuildBanAdd: { label: "Member banned", intents: ["GuildModeration"], args: [["ban", "Ban", "any"]] },
  GuildBanRemove: { label: "Member unbanned", intents: ["GuildModeration"], args: [["ban", "Ban", "any"]] },
  GuildAuditLogEntryCreate: { label: "Audit log entry", intents: ["GuildModeration"], args: [["entry", "Entry", "any"], ["guild", "Server", "guild"]] },
  GuildEmojiCreate: { label: "Emoji added", intents: ["GuildExpressions"], args: [["emoji", "Emoji", "any"]] },
  GuildEmojiDelete: { label: "Emoji removed", intents: ["GuildExpressions"], args: [["emoji", "Emoji", "any"]] },
  InviteCreate: { label: "Invite created", intents: ["GuildInvites"], args: [["invite", "Invite", "any"]] },
  InviteDelete: { label: "Invite deleted", intents: ["GuildInvites"], args: [["invite", "Invite", "any"]] },
  MessageBulkDelete: { label: "Messages bulk deleted", intents: ["GuildMessages"], args: [["messages", "Messages", "any"], ["channel", "Channel", "channel"]] },
  MessageReactionRemoveAll: { label: "All reactions removed", intents: ["GuildMessageReactions"], args: [["message", "Message", "message"]] },
  TypingStart: { label: "Someone started typing", intents: ["GuildMessageTyping", "DirectMessageTyping"], args: [["typing", "Typing", "any"]] },
  UserUpdate: { label: "User profile changed", intents: [], args: [["before", "Before", "user"], ["after", "After", "user"]] },
  WebhooksUpdate: { label: "Webhooks changed", intents: ["GuildWebhooks"], args: [["channel", "Channel", "channel"]] },
  GuildScheduledEventCreate: { label: "Event scheduled", intents: ["GuildScheduledEvents"], args: [["event", "Event", "any"]] },
  GuildScheduledEventUpdate: { label: "Scheduled event changed", intents: ["GuildScheduledEvents"], args: [["before", "Before", "any"], ["after", "After", "any"]] },
  GuildScheduledEventDelete: { label: "Scheduled event cancelled", intents: ["GuildScheduledEvents"], args: [["event", "Event", "any"]] },
  GuildScheduledEventUserAdd: { label: "Someone joined a scheduled event", intents: ["GuildScheduledEvents"], args: [["event", "Event", "any"], ["user", "User", "user"]] },
  GuildScheduledEventUserRemove: { label: "Someone left a scheduled event", intents: ["GuildScheduledEvents"], args: [["event", "Event", "any"], ["user", "User", "user"]] },
  StageInstanceCreate: { label: "Stage started", intents: [], args: [["stage", "Stage", "any"]] },
  StageInstanceDelete: { label: "Stage ended", intents: [], args: [["stage", "Stage", "any"]] },
  AutoModerationActionExecution: { label: "AutoMod took action", intents: ["AutoModerationExecution"], args: [["execution", "Execution", "any"]] },
  MessagePollVoteAdd: { label: "Poll vote added", intents: ["GuildMessagePolls"], args: [["answer", "Answer", "any"], ["userId", "User ID", "string"]] },
  MessagePollVoteRemove: { label: "Poll vote removed", intents: ["GuildMessagePolls"], args: [["answer", "Answer", "any"], ["userId", "User ID", "string"]] },
  PresenceUpdate: { label: "Presence changed (privileged)", intents: ["GuildPresences"], args: [["before", "Before", "any"], ["after", "After", "any"]] },
  Error: { label: "Client error", intents: [], args: [["error", "Error", "any"]] },
  Warn: { label: "Client warning", intents: [], args: [["message", "Message", "string"]] },
};

function eventOf(data: Record<string, unknown>): string {
  const event = String(data.event ?? "");
  return event in EVENTS ? event : "ChannelCreate";
}

export const anyEvent = defineNode({
  type: "discord.event",
  label: "Discord event",
  description: "Runs on any other Discord event, such as roles, channels, bans, invites, threads, typing or scheduled events.",
  category: "trigger",
  icon: "Radio",
  platforms: discord,
  inputs: [],
  outputs: [next, { id: "args", label: "All values", type: "list" }],
  fields: [
    {
      id: "event",
      label: "Event",
      kind: "select",
      default: "ChannelCreate",
      options: Object.entries(EVENTS).map(([value, item]) => ({ value, label: item.label })),
    },
  ],
  ports: (data) => ({
    outputs: EVENTS[eventOf(data)].args.map(([id, label, type]) => ({ id: `arg_${id}`, label, type })),
  }),
  trigger: (ctx) => {
    const event = eventOf(ctx.node.data);
    const spec = EVENTS[event];
    const vars: Record<string, string> = { args: "args" };
    spec.args.forEach(([id], index) => {
      vars[`arg_${id}`] = `args[${index}]`;
    });
    const guild = spec.args.find(([, , type]) => type === "guild");
    if (guild) vars.guild = vars[`arg_${guild[0]}`];
    return {
      file: `event-${slug(event)}-${ctx.node.id}`,
      order: 2,
      scope: { context: "none", vars },
      requires: { intents: spec.intents },
      wrap: (body) =>
        block(
          "export default function register(client) {",
          block(`client.on(${ctx.use("Events")}.${event}, async (...args) => {`, body, "});"),
        ),
    };
  },
});

export const memberUpdate = defineNode({
  type: "discord.memberUpdate",
  label: "Member roles or nickname changed",
  description: "Runs when a member gains or loses a role, or changes nickname.",
  category: "trigger",
  icon: "UserCog",
  platforms: discord,
  inputs: [],
  outputs: [
    next,
    member,
    user,
    guild,
    { id: "added", label: "Roles added", type: "list" },
    { id: "removed", label: "Roles removed", type: "list" },
    { id: "before", label: "Nickname before", type: "string" },
  ],
  fields: [
    {
      id: "change",
      label: "When",
      kind: "select",
      default: "any",
      options: [
        { value: "any", label: "Roles or nickname change" },
        { value: "added", label: "A role is added" },
        { value: "removed", label: "A role is removed" },
        { value: "nickname", label: "The nickname changes" },
      ],
    },
  ],
  trigger: (ctx) => {
    const guards: Record<string, string> = {
      any: "if (added.length === 0 && removed.length === 0 && before === (member.nickname ?? \"\")) return;",
      added: "if (added.length === 0) return;",
      removed: "if (removed.length === 0) return;",
      nickname: "if (before === (member.nickname ?? \"\")) return;",
    };
    const change = String(ctx.field("change") ?? "any");
    return {
      file: `member-update-${ctx.node.id}`,
      order: 2,
      scope: { context: "member", vars: { member: "member", user: "user", guild: "guild", added: "added", removed: "removed", before: "before" } },
      requires: { intents: ["GuildMembers"] },
      wrap: (body) =>
        listener(
          ctx,
          "GuildMemberUpdate",
          "previous, member",
          [
            "const added = [...member.roles.cache.filter((role) => !previous.roles.cache.has(role.id)).values()];",
            "const removed = [...previous.roles.cache.filter((role) => !member.roles.cache.has(role.id)).values()];",
            'const before = previous.nickname ?? "";',
            guards[change] ?? guards.any,
          ],
          ["const { user, guild } = member;"],
          body,
        ),
    };
  },
});

export const banned = defineNode({
  type: "discord.ban.event",
  label: "Member banned or unbanned",
  description: "Runs when someone is banned from or unbanned in a server.",
  category: "trigger",
  icon: "Gavel",
  platforms: discord,
  inputs: [],
  outputs: [next, user, guild, { id: "reason", label: "Reason", type: "string" }],
  fields: [
    {
      id: "event",
      label: "When",
      kind: "select",
      default: "ban",
      options: [
        { value: "ban", label: "Someone is banned" },
        { value: "unban", label: "Someone is unbanned" },
      ],
    },
  ],
  trigger: (ctx) => ({
    file: `ban-${ctx.field("event") === "unban" ? "remove" : "add"}-${ctx.node.id}`,
    order: 2,
    scope: { context: "none", vars: { user: "user", guild: "guild", reason: "reason" } },
    requires: { intents: ["GuildModeration"] },
    wrap: (body) =>
      listener(
        ctx,
        ctx.field("event") === "unban" ? "GuildBanRemove" : "GuildBanAdd",
        "ban",
        [],
        ["const { user, guild } = ban;", 'const reason = ban.reason ?? "";'],
        body,
      ),
  }),
});

const PICKERS: Record<string, string> = {
  user: "UserSelectMenuBuilder",
  role: "RoleSelectMenuBuilder",
  channel: "ChannelSelectMenuBuilder",
  mentionable: "MentionableSelectMenuBuilder",
};

export const pickerMenu = defineNode({
  type: "discord.pickerMenu",
  label: "Reply with picker",
  description: "Replies with a menu to pick users, roles or channels from the server. Pair it with Menu option chosen.",
  category: "action",
  icon: "UserSearch",
  platforms: discord,
  inputs: [execIn, { id: "text", label: "Text", type: "string" }],
  outputs: [next, message],
  fields: [
    { id: "text", label: "Text", kind: "text", multiline: true, required: true },
    { id: "customId", static: true, label: "Menu ID", kind: "text", required: true, placeholder: "pick-member" },
    {
      id: "pick",
      label: "Pick",
      kind: "select",
      default: "user",
      options: [
        { value: "user", label: "Users" },
        { value: "role", label: "Roles" },
        { value: "channel", label: "Channels" },
        { value: "mentionable", label: "Users and roles" },
      ],
    },
    { id: "placeholder", label: "Placeholder", kind: "text", default: "Choose" },
    { id: "max", static: true, label: "Choices allowed", kind: "number", default: 1, min: 1, max: 25 },
    { id: "private", label: "Only visible to the user (replies to commands)", kind: "boolean", default: false },
  ],
  emit: (ctx) => {
    requireRepliable(ctx, "Reply with picker");
    const builder = PICKERS[String(ctx.field("pick") ?? "user")] ?? PICKERS.user;
    const max = Math.min(25, Math.max(1, Number(ctx.field("max")) || 1));
    const menu = ctx.out("menu");
    const flags = ctx.field("private") === true ? `, flags: ${ctx.use("MessageFlags")}.Ephemeral` : "";
    return [
      `const ${menu} = new ${ctx.use(builder)}()`,
      `  .setCustomId(${JSON.stringify(String(ctx.field("customId")).trim())})`,
      `  .setPlaceholder(${ctx.value("placeholder")})`,
      `  .setMaxValues(${max});`,
      `const ${ctx.out("message")} = await ${ctx.helper("respond")}(source, { content: ${ctx.value("text")}, components: [new ${ctx.use("ActionRowBuilder")}().addComponents(${menu})]${flags} });`,
    ].join("\n");
  },
});

export const sendFile = defineNode({
  type: "discord.sendFile",
  label: "Send file",
  description: "Sends a file from a link or from text you build, as a reply or to a channel.",
  category: "action",
  icon: "Paperclip",
  platforms: discord,
  inputs: [
    execIn,
    { id: "content", label: "Link or text", type: "string" },
    { id: "channel", label: "Channel", type: "channel", optional: true },
  ],
  outputs: [next, message],
  fields: [
    {
      id: "source",
      label: "File from",
      kind: "select",
      default: "url",
      options: [
        { value: "url", label: "A link (image, PDF, ...)" },
        { value: "text", label: "Text, saved as a file" },
      ],
    },
    { id: "content", label: "Link or text", kind: "text", multiline: true, required: true },
    { id: "name", label: "File name", kind: "text", default: "file.txt" },
    { id: "text", label: "Message", kind: "text" },
  ],
  emit: (ctx) => {
    const file = ctx.out("file");
    const data = ctx.field("source") === "text" ? `Buffer.from(String(${ctx.value("content")}))` : ctx.value("content");
    const payload = `{ content: ${ctx.value("text")} || undefined, files: [${file}] }`;
    if (!ctx.connected("channel")) requireRepliable(ctx, "Send file without a Channel");
    const send = ctx.connected("channel")
      ? `await (await ${ctx.helper("resolveChannel")}(client, ${ctx.value("channel")})).send(${payload})`
      : `await ${ctx.helper("respond")}(source, ${payload})`;
    return [`const ${file} = new ${ctx.use("AttachmentBuilder")}(${data}, { name: ${ctx.value("name")} });`, `const ${ctx.out("message")} = ${send};`].join("\n");
  },
});

export const attachments = defineNode({
  type: "discord.attachments",
  label: "Message files",
  description: "Lists the files attached to a message, with links, names, sizes and types.",
  category: "data",
  icon: "FileStack",
  platforms: discord,
  inputs: [message],
  outputs: [
    { id: "files", label: "Files", type: "list" },
    { id: "first", label: "First link", type: "string" },
    { id: "count", label: "Count", type: "number" },
  ],
  fields: [],
  expression: (ctx, output) => {
    const files = `[...(${ctx.value("message")}?.attachments?.values() ?? [])].map((file) => ({ url: file.url, name: file.name, size: file.size, type: file.contentType }))`;
    if (output === "first") return `(${files}[0]?.url ?? "")`;
    if (output === "count") return `${files}.length`;
    return files;
  },
});

const threadPort: PortDef = { id: "thread", label: "Thread", type: "channel" };
const list = (id: string, label: string): PortDef => ({ id, label, type: "list" });

function action(definition: {
  type: string;
  label: string;
  description: string;
  icon: string;
  category?: "action" | "data";
  inputs?: PortDef[];
  outputs?: PortDef[];
  fields?: FieldDef[];
  requires?: NodeDefinition["requires"];
  emit: (ctx: EmitContext) => string;
}) {
  return defineNode({
    category: "action",
    platforms: discord,
    ...definition,
    inputs: [execIn, ...(definition.inputs ?? [])],
    outputs: [next, ...(definition.outputs ?? [])],
    fields: definition.fields ?? [],
  });
}

function defined(entries: string): string {
  return `Object.fromEntries(Object.entries({ ${entries} }).filter(([, value]) => value !== "" && value !== undefined && value !== null && !Number.isNaN(value)))`;
}

function listOf(text: string): string {
  return `String(${text}).split(/[\\n,]/).map((item) => item.trim()).filter(Boolean)`;
}

export const fetchMessages = action({
  type: "discord.fetchMessages",
  label: "Get recent messages",
  description: "Reads the latest messages in a channel, newest first.",
  icon: "MessagesSquare",
  category: "data",
  inputs: [channel],
  outputs: [list("messages", "Messages"), { id: "count", label: "Count", type: "number" }],
  fields: [{ id: "limit", label: "How many (1-100)", kind: "number", default: 20, min: 1, max: 100 }],
  emit: (ctx) => {
    const messages = ctx.out("messages");
    return [
      `const ${messages} = [...(await ${ctx.helper("resolveChannel")}(client, ${ctx.value("channel")}).then((target) => target.messages.fetch({ limit: Math.min(100, Math.max(1, Number(${ctx.value("limit")}))) }))).values()];`,
      `const ${ctx.out("count")} = ${messages}.length;`,
    ].join("\n");
  },
});

export const fetchMessage = action({
  type: "discord.fetchMessage",
  label: "Find message",
  description: "Looks up one message in a channel by its ID.",
  icon: "Search",
  category: "data",
  inputs: [channel],
  outputs: [{ id: "found", label: "Message", type: "message" }],
  fields: [{ id: "id", label: "Message ID", kind: "text", required: true }],
  emit: (ctx) =>
    `const ${ctx.out("found")} = await ${ctx.helper("resolveChannel")}(client, ${ctx.value("channel")}).then((target) => target.messages.fetch(String(${ctx.value("id")}))).catch(() => null);`,
});

export const unpin = action({
  type: "discord.unpin",
  label: "Unpin message",
  description: "Removes a message from the channel's pins.",
  icon: "PinOff",
  inputs: [message],
  emit: (ctx) => `await ${ctx.value("message")}.unpin();`,
});

export const clearReactions = action({
  type: "discord.clearReactions",
  label: "Remove reactions",
  description: "Removes every reaction from a message, or only one emoji.",
  icon: "SmilePlus",
  inputs: [message],
  fields: [{ id: "emoji", label: "Only this emoji", kind: "text", placeholder: "👍 (empty removes all)" }],
  emit: (ctx) => {
    const emoji = ctx.value("emoji");
    return `if (${emoji}) await ${ctx.value("message")}.reactions.resolve(${emoji})?.remove();\nelse await ${ctx.value("message")}.reactions.removeAll();`;
  },
});

export const crosspost = action({
  type: "discord.crosspost",
  label: "Publish announcement",
  description: "Publishes a message in an announcement channel to every server that follows it.",
  icon: "Megaphone",
  inputs: [message],
  emit: (ctx) => `await ${ctx.value("message")}.crosspost();`,
});

export const poll = action({
  type: "discord.poll",
  label: "Send poll",
  description: "Sends a native Discord poll, as a reply or to a channel.",
  icon: "Vote",
  inputs: [{ id: "channel", label: "Channel", type: "channel", optional: true }],
  outputs: [message],
  fields: [
    { id: "question", label: "Question", kind: "text", required: true, default: "What should we play?" },
    { id: "answers", static: true, label: "Answers", kind: "text", multiline: true, required: true, placeholder: "🎮 Minecraft\n🔫 Valorant", help: "One per line, up to 10. Start with an emoji to show it." },
    { id: "hours", label: "Open for (hours)", kind: "number", default: 24, min: 1, max: 768 },
    { id: "multiple", label: "Allow several answers", kind: "boolean", default: false },
  ],
  emit: (ctx) => {
    const answers = lines(String(ctx.field("answers") ?? "")).slice(0, 10);
    if (answers.length < 2) ctx.fail("A poll needs at least two answers.");
    const items = answers.map((answer) => {
      const [, emoji, text] = answer.match(/^(\p{Extended_Pictographic}\uFE0F?)\s*(.*)$/u) ?? [];
      return emoji ? `{ text: ${JSON.stringify(text)}, emoji: ${JSON.stringify(emoji)} }` : `{ text: ${JSON.stringify(answer)} }`;
    });
    const payload = `{ poll: { question: { text: String(${ctx.value("question")}).slice(0, 300) }, answers: [${items.join(", ")}], duration: Math.max(1, Number(${ctx.value("hours")})), allowMultiselect: ${ctx.value("multiple")} } }`;
    if (ctx.connected("channel")) {
      return `const ${ctx.out("message")} = await (await ${ctx.helper("resolveChannel")}(client, ${ctx.value("channel")})).send(${payload});`;
    }
    requireRepliable(ctx, "Send poll without a Channel");
    return `const ${ctx.out("message")} = await ${ctx.helper("respond")}(source, ${payload});`;
  },
});

export const endPoll = action({
  type: "discord.endPoll",
  label: "End poll",
  description: "Closes a poll now and shows the results.",
  icon: "Vote",
  inputs: [message],
  emit: (ctx) => `await ${ctx.value("message")}.poll?.end();`,
});

export const pollVote = defineNode({
  type: "discord.pollVote",
  label: "Poll vote",
  description: "Runs when someone votes on, or removes a vote from, a poll.",
  category: "trigger",
  icon: "Vote",
  platforms: discord,
  inputs: [],
  outputs: [next, user, message, channel, { id: "answer", label: "Answer", type: "string" }, { id: "removed", label: "Vote removed", type: "boolean" }],
  fields: [
    {
      id: "event",
      label: "When",
      kind: "select",
      default: "add",
      options: [
        { value: "add", label: "A vote is added" },
        { value: "remove", label: "A vote is removed" },
      ],
    },
  ],
  requires: { discord: { intents: ["GuildMessagePolls", "DirectMessagePolls"] } },
  trigger: (ctx) => {
    const removed = ctx.field("event") === "remove";
    return {
      file: `poll-vote-${ctx.node.id}`,
      order: 2,
      scope: { context: "none", vars: { user: "user", message: "message", channel: "channel", answer: "answer", removed: "removed" } },
      wrap: (body) =>
        listener(
          ctx,
          removed ? "MessagePollVoteRemove" : "MessagePollVoteAdd",
          "pollAnswer, userId",
          [],
          [
            "const user = await client.users.fetch(userId);",
            "const message = pollAnswer.poll.message;",
            "const channel = message.channel;",
            'const answer = pollAnswer.text ?? "";',
            `const removed = ${removed};`,
          ],
          body,
        ),
    };
  },
});

export const editChannel = action({
  type: "discord.editChannel",
  label: "Edit channel",
  description: "Changes a channel's name, topic, slowmode or age restriction. Empty settings stay as they are.",
  icon: "Settings2",
  inputs: [channel],
  fields: [
    { id: "name", label: "Name", kind: "text" },
    { id: "topic", label: "Topic", kind: "text" },
    { id: "slowmode", label: "Slowmode (seconds, -1 keeps it)", kind: "number", default: -1, min: -1, max: 21600 },
    {
      id: "nsfw",
      label: "Age restricted",
      kind: "select",
      default: "",
      options: [
        { value: "", label: "Keep as it is" },
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ],
    },
  ],
  emit: (ctx) => {
    const nsfw = String(ctx.field("nsfw") ?? "");
    const parts = [
      `name: ${ctx.value("name")}`,
      `topic: ${ctx.value("topic")}`,
      `rateLimitPerUser: Number(${ctx.value("slowmode")}) >= 0 ? Number(${ctx.value("slowmode")}) : undefined`,
      ...(nsfw ? [`nsfw: ${nsfw}`] : []),
    ];
    return `await (await ${ctx.helper("resolveChannel")}(client, ${ctx.value("channel")})).edit(${defined(parts.join(", "))});`;
  },
});

const PERMISSION_NAMES =
  "ViewChannel, SendMessages, SendMessagesInThreads, CreatePublicThreads, AttachFiles, EmbedLinks, AddReactions, MentionEveryone, ManageMessages, ReadMessageHistory, Connect, Speak, Stream, UseApplicationCommands";

export const channelPermissions = action({
  type: "discord.channelPermissions",
  label: "Set channel permissions",
  description: "Allows or denies permissions in one channel for a role or a member.",
  icon: "ShieldCheck",
  inputs: [channel, { id: "target", label: "Role or member", type: "any" }],
  fields: [
    { id: "allow", static: true, label: "Allow", kind: "text", placeholder: "ViewChannel, SendMessages", help: `Names from: ${PERMISSION_NAMES}.` },
    { id: "deny", static: true, label: "Deny", kind: "text", placeholder: "SendMessages" },
    { id: "reset", static: true, label: "Reset to default", kind: "text", placeholder: "AttachFiles", help: "Removes the override so the server setting applies." },
  ],
  emit: (ctx) => {
    const names = (id: string) =>
      String(ctx.field(id) ?? "")
        .split(/[\s,]+/)
        .filter(Boolean);
    const entries = [
      ...names("allow").map((name) => `${JSON.stringify(name)}: true`),
      ...names("deny").map((name) => `${JSON.stringify(name)}: false`),
      ...names("reset").map((name) => `${JSON.stringify(name)}: null`),
    ];
    if (entries.length === 0) ctx.fail("List at least one permission to allow, deny or reset.");
    return `await (await ${ctx.helper("resolveChannel")}(client, ${ctx.value("channel")})).permissionOverwrites.edit(${idOf(ctx.value("target"))}, { ${entries.join(", ")} });`;
  },
});

export const lockChannel = action({
  type: "discord.lockChannel",
  label: "Lock channel",
  description: "Stops everyone from sending messages in a channel, or opens it again.",
  icon: "Lock",
  inputs: [channel],
  fields: [
    {
      id: "mode",
      label: "Action",
      kind: "select",
      default: "lock",
      options: [
        { value: "lock", label: "Lock" },
        { value: "unlock", label: "Unlock" },
      ],
    },
  ],
  emit: (ctx) => {
    const target = ctx.out("target");
    return [
      `const ${target} = await ${ctx.helper("resolveChannel")}(client, ${ctx.value("channel")});`,
      `await ${target}.permissionOverwrites.edit(${target}.guild.roles.everyone, { SendMessages: ${ctx.field("mode") === "unlock" ? "null" : "false"} });`,
    ].join("\n");
  },
});

export const cloneChannel = action({
  type: "discord.cloneChannel",
  label: "Clone channel",
  description: "Creates a copy of a channel with the same settings and permissions.",
  icon: "Copy",
  inputs: [channel],
  outputs: [{ id: "copy", label: "Copy", type: "channel" }],
  fields: [{ id: "name", label: "New name", kind: "text", placeholder: "Empty keeps the name" }],
  emit: (ctx) =>
    `const ${ctx.out("copy")} = await (await ${ctx.helper("resolveChannel")}(client, ${ctx.value("channel")})).clone(${defined(`name: ${ctx.value("name")}`)});`,
});

export const moveChannel = action({
  type: "discord.moveChannel",
  label: "Move channel",
  description: "Moves a channel into a category or to a new position.",
  icon: "MoveVertical",
  inputs: [channel],
  fields: [
    { id: "category", label: "Category ID", kind: "text", placeholder: "Empty keeps the category" },
    { id: "position", label: "Position (-1 keeps it)", kind: "number", default: -1, min: -1 },
  ],
  emit: (ctx) => {
    const target = ctx.out("target");
    return [
      `const ${target} = await ${ctx.helper("resolveChannel")}(client, ${ctx.value("channel")});`,
      `if (${ctx.value("category")}) await ${target}.setParent(String(${ctx.value("category")}), { lockPermissions: false });`,
      `if (Number(${ctx.value("position")}) >= 0) await ${target}.setPosition(Number(${ctx.value("position")}));`,
    ].join("\n");
  },
});

export const createThread = action({
  type: "discord.createThread",
  label: "Create thread",
  description: "Creates a public or private thread in a channel without a starter message.",
  icon: "MessagesSquare",
  inputs: [channel],
  outputs: [threadPort],
  fields: [
    { id: "name", label: "Name", kind: "text", required: true, default: "Ticket {{ user.username }}" },
    { id: "private", label: "Private (only invited members)", kind: "boolean", default: false },
  ],
  emit: (ctx) =>
    `const ${ctx.out("thread")} = await (await ${ctx.helper("resolveChannel")}(client, ${ctx.value("channel")})).threads.create({ name: String(${ctx.value("name")}).slice(0, 100), type: ${ctx.use("ChannelType")}.${ctx.field("private") === true ? "PrivateThread" : "PublicThread"} });`,
});

export const threadAction = action({
  type: "discord.threadAction",
  label: "Manage thread",
  description: "Archives, locks, joins or leaves a thread.",
  icon: "Archive",
  inputs: [threadPort],
  fields: [
    {
      id: "do",
      label: "Action",
      kind: "select",
      default: "archive",
      options: [
        { value: "archive", label: "Archive" },
        { value: "unarchive", label: "Unarchive" },
        { value: "lock", label: "Lock" },
        { value: "unlock", label: "Unlock" },
        { value: "join", label: "Bot joins" },
        { value: "leave", label: "Bot leaves" },
      ],
    },
  ],
  emit: (ctx) => {
    const call: Record<string, string> = {
      archive: "setArchived(true)",
      unarchive: "setArchived(false)",
      lock: "setLocked(true)",
      unlock: "setLocked(false)",
      join: "join()",
      leave: "leave()",
    };
    return `await ${ctx.value("thread")}.${call[String(ctx.field("do"))] ?? call.archive};`;
  },
});

export const threadMember = action({
  type: "discord.threadMember",
  label: "Thread member",
  description: "Adds someone to a thread, or removes them.",
  icon: "UserPlus",
  inputs: [threadPort, user],
  fields: [
    {
      id: "do",
      label: "Action",
      kind: "select",
      default: "add",
      options: [
        { value: "add", label: "Add" },
        { value: "remove", label: "Remove" },
      ],
    },
  ],
  emit: (ctx) => `await ${ctx.value("thread")}.members.${ctx.field("do") === "remove" ? "remove" : "add"}(${idOf(ctx.value("user"))});`,
});

export const forumPost = action({
  type: "discord.forumPost",
  label: "Create forum post",
  description: "Starts a new post in a forum channel, with tags.",
  icon: "LayoutList",
  inputs: [channel],
  outputs: [{ id: "post", label: "Post", type: "channel" }],
  fields: [
    { id: "title", label: "Title", kind: "text", required: true },
    { id: "text", label: "First message", kind: "text", multiline: true, required: true },
    { id: "tags", label: "Tags", kind: "text", placeholder: "Bug, Urgent", help: "Names of tags that exist in the forum." },
  ],
  emit: (ctx) => {
    const forum = ctx.out("forum");
    const tags = ctx.out("tags");
    return [
      `const ${forum} = await ${ctx.helper("resolveChannel")}(client, ${ctx.value("channel")});`,
      `const ${tags} = ${listOf(ctx.value("tags"))}.map((name) => ${forum}.availableTags?.find((tag) => tag.name.toLowerCase() === name.toLowerCase())?.id).filter(Boolean);`,
      `const ${ctx.out("post")} = await ${forum}.threads.create({ name: String(${ctx.value("title")}).slice(0, 100), message: { content: ${ctx.value("text")} }, appliedTags: ${tags} });`,
    ].join("\n");
  },
});

export const createWebhook = action({
  type: "discord.createWebhook",
  label: "Create webhook",
  description: "Creates a webhook in a channel and returns its URL.",
  icon: "Webhook",
  inputs: [channel],
  outputs: [{ id: "url", label: "URL", type: "string" }],
  fields: [{ id: "name", label: "Name", kind: "text", required: true, default: "Notifications" }],
  emit: (ctx) => {
    const hook = ctx.out("hook");
    return [
      `const ${hook} = await (await ${ctx.helper("resolveChannel")}(client, ${ctx.value("channel")})).createWebhook({ name: ${ctx.value("name")} });`,
      `const ${ctx.out("url")} = ${hook}.url;`,
    ].join("\n");
  },
});

export const listInvites = action({
  type: "discord.listInvites",
  label: "Get invites",
  description: "Lists the server's invites with their codes, uses and creators.",
  icon: "Link",
  category: "data",
  inputs: [guild],
  outputs: [list("invites", "Invites")],
  emit: (ctx) =>
    `const ${ctx.out("invites")} = [...(await ${ctx.value("guild")}.invites.fetch()).values()].map((invite) => ({ code: invite.code, url: invite.url, uses: invite.uses ?? 0, inviter: invite.inviter ?? null, channel: invite.channel ?? null }));`,
});

export const editRole = action({
  type: "discord.editRole",
  label: "Edit role",
  description: "Changes a role's name, colour or how it shows. Empty settings stay as they are.",
  icon: "Tag",
  inputs: [role],
  fields: [
    { id: "name", label: "Name", kind: "text" },
    { id: "color", label: "Colour", kind: "text", placeholder: "#ff6a3d" },
    {
      id: "hoist",
      label: "Show members separately",
      kind: "select",
      default: "",
      options: [
        { value: "", label: "Keep as it is" },
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ],
    },
    {
      id: "mentionable",
      label: "Anyone can mention",
      kind: "select",
      default: "",
      options: [
        { value: "", label: "Keep as it is" },
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ],
    },
  ],
  emit: (ctx) => {
    const flags = ["hoist", "mentionable"].flatMap((id) => (ctx.field(id) ? [`${id}: ${ctx.field(id)}`] : []));
    return `await ${ctx.value("role")}.edit(${defined([`name: ${ctx.value("name")}`, `color: ${ctx.value("color")} || undefined`, ...flags].join(", "))});`;
  },
});

export const deleteRole = action({
  type: "discord.deleteRole",
  label: "Delete role",
  description: "Deletes a role from the server.",
  icon: "ShieldMinus",
  inputs: [role],
  fields: [{ id: "reason", label: "Reason", kind: "text" }],
  emit: (ctx) => `await ${ctx.value("role")}.delete(${ctx.value("reason")} || undefined);`,
});

export const fetchRole = action({
  type: "discord.fetchRole",
  label: "Find role",
  description: "Looks up a role by ID or exact name.",
  icon: "Search",
  category: "data",
  inputs: [guild],
  outputs: [{ id: "found", label: "Role", type: "role" }],
  fields: [{ id: "id", label: "Role ID or name", kind: "text", required: true }],
  emit: (ctx) => {
    const key = ctx.out("key");
    const roles = `${ctx.value("guild")}.roles`;
    return [
      `const ${key} = String(${ctx.value("id")});`,
      `const ${ctx.out("found")} = /^\\d+$/.test(${key}) ? await ${roles}.fetch(${key}).catch(() => null) : ([...(await ${roles}.fetch()).values()].find((item) => item.name === ${key}) ?? null);`,
    ].join("\n");
  },
});

export const listMembers = action({
  type: "discord.listMembers",
  label: "Get members",
  description: "Lists the server's members. Needs the Server Members intent in the developer portal.",
  icon: "Users",
  category: "data",
  inputs: [guild],
  outputs: [list("members", "Members"), { id: "count", label: "Count", type: "number" }],
  fields: [{ id: "limit", label: "How many (0 = all)", kind: "number", default: 100, min: 0 }],
  requires: { discord: { intents: ["GuildMembers"] } },
  emit: (ctx) => {
    const members = ctx.out("members");
    return [
      `const ${members} = [...(await ${ctx.value("guild")}.members.fetch(Number(${ctx.value("limit")}) > 0 ? { limit: Number(${ctx.value("limit")}) } : undefined)).values()];`,
      `const ${ctx.out("count")} = ${members}.length;`,
    ].join("\n");
  },
});

export const listRoles = action({
  type: "discord.listRoles",
  label: "Get roles",
  description: "Lists the server's roles from highest to lowest.",
  icon: "Tags",
  category: "data",
  inputs: [guild],
  outputs: [list("roles", "Roles")],
  emit: (ctx) =>
    `const ${ctx.out("roles")} = [...(await ${ctx.value("guild")}.roles.fetch()).values()].sort((a, b) => b.position - a.position);`,
});

export const listChannels = action({
  type: "discord.listChannels",
  label: "Get channels",
  description: "Lists the server's channels, optionally only one kind.",
  icon: "Hash",
  category: "data",
  inputs: [guild],
  outputs: [list("channels", "Channels")],
  fields: [
    {
      id: "kind",
      label: "Kind",
      kind: "select",
      default: "",
      options: [
        { value: "", label: "All" },
        { value: "GuildText", label: "Text" },
        { value: "GuildVoice", label: "Voice" },
        { value: "GuildCategory", label: "Categories" },
        { value: "GuildForum", label: "Forums" },
        { value: "GuildAnnouncement", label: "Announcements" },
      ],
    },
  ],
  emit: (ctx) => {
    const kind = String(ctx.field("kind") ?? "");
    const filter = kind ? `.filter((item) => item?.type === ${ctx.use("ChannelType")}.${kind})` : ".filter(Boolean)";
    return `const ${ctx.out("channels")} = [...(await ${ctx.value("guild")}.channels.fetch()).values()]${filter};`;
  },
});

export const listBans = action({
  type: "discord.listBans",
  label: "Get bans",
  description: "Lists banned users with their ban reasons.",
  icon: "Gavel",
  category: "data",
  inputs: [guild],
  outputs: [list("bans", "Bans")],
  emit: (ctx) =>
    `const ${ctx.out("bans")} = [...(await ${ctx.value("guild")}.bans.fetch()).values()].map((ban) => ({ user: ban.user, reason: ban.reason ?? "" }));`,
});

export const voiceMove = action({
  type: "discord.voiceMove",
  label: "Move in voice",
  description: "Moves a member to another voice channel, or disconnects them.",
  icon: "ArrowRightLeft",
  inputs: [member, { id: "channel", label: "Voice channel", type: "channel", optional: true }],
  fields: [{ id: "channel", label: "Voice channel ID", kind: "text", placeholder: "Empty disconnects" }],
  emit: (ctx) => `await ${ctx.value("member")}.voice.setChannel(${idOf(ctx.value("channel"))} || null);`,
});

export const voiceMute = action({
  type: "discord.voiceMute",
  label: "Server mute or deafen",
  description: "Server-mutes or deafens a member who is in a voice channel.",
  icon: "MicOff",
  inputs: [member],
  fields: [
    { id: "mute", label: "Muted", kind: "boolean", default: true },
    { id: "deaf", label: "Deafened", kind: "boolean", default: false },
  ],
  emit: (ctx) => `await ${ctx.value("member")}.voice.setMute(${ctx.value("mute")});\nawait ${ctx.value("member")}.voice.setDeaf(${ctx.value("deaf")});`,
});

const AUDIT = ["", "MemberKick", "MemberBanAdd", "MemberBanRemove", "MemberUpdate", "MemberRoleUpdate", "ChannelCreate", "ChannelDelete", "RoleCreate", "RoleDelete", "MessageDelete", "MessageBulkDelete", "InviteCreate"];

export const auditLog = action({
  type: "discord.auditLog",
  label: "Get audit log",
  description: "Reads recent entries from the server's audit log, such as who kicked or banned someone.",
  icon: "ScrollText",
  category: "data",
  inputs: [guild],
  outputs: [list("entries", "Entries"), { id: "first", label: "Latest", type: "any" }],
  fields: [
    { id: "type", label: "Action", kind: "select", default: "", options: AUDIT.map((value) => ({ value, label: value || "Any" })) },
    { id: "limit", label: "How many", kind: "number", default: 10, min: 1, max: 100 },
  ],
  emit: (ctx) => {
    const type = String(ctx.field("type") ?? "");
    const entries = ctx.out("entries");
    return [
      `const ${entries} = [...(await ${ctx.value("guild")}.fetchAuditLogs({ limit: Number(${ctx.value("limit")}) || 10${type ? `, type: ${ctx.use("AuditLogEvent")}.${type}` : ""} })).entries.values()].map((entry) => ({ action: entry.action, executor: entry.executor, target: entry.target, reason: entry.reason ?? "", createdAt: entry.createdAt }));`,
      `const ${ctx.out("first")} = ${entries}[0] ?? null;`,
    ].join("\n");
  },
});

export const editServer = action({
  type: "discord.editServer",
  label: "Edit server",
  description: "Changes the server's name or icon. Empty settings stay as they are.",
  icon: "Server",
  inputs: [guild],
  fields: [
    { id: "name", label: "Name", kind: "text" },
    { id: "icon", label: "Icon URL", kind: "text" },
  ],
  emit: (ctx) => `await ${ctx.value("guild")}.edit(${defined(`name: ${ctx.value("name")}, icon: ${ctx.value("icon")}`)});`,
});

export const emoji = action({
  type: "discord.emoji",
  label: "Add or remove emoji",
  description: "Uploads a custom emoji from an image link, or deletes one.",
  icon: "Smile",
  inputs: [guild],
  outputs: [{ id: "emoji", label: "Emoji", type: "string" }],
  fields: [
    {
      id: "do",
      label: "Action",
      kind: "select",
      default: "add",
      options: [
        { value: "add", label: "Add" },
        { value: "remove", label: "Remove" },
      ],
    },
    { id: "name", label: "Name", kind: "text", required: true, placeholder: "party" },
    { id: "url", label: "Image URL (to add)", kind: "text" },
  ],
  emit: (ctx) => {
    if (ctx.field("do") === "remove") {
      return `const ${ctx.out("emoji")} = "";\nawait ${ctx.value("guild")}.emojis.cache.find((item) => item.name === ${ctx.value("name")})?.delete();`;
    }
    return `const ${ctx.out("emoji")} = String(await ${ctx.value("guild")}.emojis.create({ attachment: ${ctx.value("url")}, name: ${ctx.value("name")} }));`;
  },
});

export const scheduledEvent = action({
  type: "discord.scheduledEvent",
  label: "Create event",
  description: "Creates a scheduled server event, in a voice channel or at an outside place.",
  icon: "CalendarPlus",
  inputs: [guild, { id: "channel", label: "Voice channel", type: "channel", optional: true }],
  outputs: [{ id: "event", label: "Event", type: "any" }, { id: "url", label: "Link", type: "string" }],
  fields: [
    { id: "name", label: "Name", kind: "text", required: true },
    { id: "description", label: "Description", kind: "text", multiline: true },
    { id: "start", label: "Starts (date or ISO time)", kind: "text", required: true, placeholder: "2026-12-31T20:00:00Z" },
    { id: "hours", label: "Lasts (hours)", kind: "number", default: 2, min: 0 },
    { id: "location", label: "Place (without a voice channel)", kind: "text", default: "Online" },
  ],
  emit: (ctx) => {
    const start = ctx.out("start");
    const event = ctx.out("event");
    const voice = ctx.connected("channel");
    const where = voice
      ? `entityType: ${ctx.use("GuildScheduledEventEntityType")}.Voice, channel: ${idOf(ctx.value("channel"))}`
      : `entityType: ${ctx.use("GuildScheduledEventEntityType")}.External, entityMetadata: { location: ${ctx.value("location")} }, scheduledEndTime: new Date(${start}.getTime() + Math.max(0.25, Number(${ctx.value("hours")})) * 3600000)`;
    return [
      `const ${start} = new Date(${ctx.value("start")});`,
      `const ${event} = await ${ctx.value("guild")}.scheduledEvents.create({ name: ${ctx.value("name")}, description: ${ctx.value("description")} || undefined, scheduledStartTime: ${start}, privacyLevel: ${ctx.use("GuildScheduledEventPrivacyLevel")}.GuildOnly, ${where} });`,
      `const ${ctx.out("url")} = ${event}.url;`,
    ].join("\n");
  },
});

export const automod = action({
  type: "discord.automod",
  label: "Create AutoMod rule",
  description: "Adds an AutoMod rule that blocks messages containing words you list.",
  icon: "ShieldAlert",
  inputs: [guild],
  fields: [
    { id: "name", label: "Rule name", kind: "text", required: true, default: "Blocked words" },
    { id: "words", static: true, label: "Words", kind: "text", multiline: true, required: true, placeholder: "spam\n*scam*", help: "One per line or comma separated. * matches any letters." },
    { id: "alert", label: "Alert channel ID", kind: "text", help: "Optional. Posts an alert there when a message is blocked." },
    { id: "timeout", label: "Time out for (seconds, 0 = no)", kind: "number", default: 0, min: 0, max: 2419200 },
  ],
  emit: (ctx) => {
    const words = String(ctx.field("words") ?? "")
      .split(/[\n,]/)
      .map((word) => word.trim())
      .filter(Boolean)
      .slice(0, 1000);
    if (words.length === 0) ctx.fail("List at least one word.");
    const type = ctx.use("AutoModerationActionType");
    const actions = ctx.out("actions");
    return [
      `const ${actions} = [{ type: ${type}.BlockMessage }];`,
      `if (${ctx.value("alert")}) ${actions}.push({ type: ${type}.SendAlertMessage, metadata: { channel: String(${ctx.value("alert")}) } });`,
      `if (Number(${ctx.value("timeout")}) > 0) ${actions}.push({ type: ${type}.Timeout, metadata: { durationSeconds: Number(${ctx.value("timeout")}) } });`,
      `await ${ctx.value("guild")}.autoModerationRules.create({ name: ${ctx.value("name")}, eventType: ${ctx.use("AutoModerationRuleEventType")}.MessageSend, triggerType: ${ctx.use("AutoModerationRuleTriggerType")}.Keyword, triggerMetadata: { keywordFilter: ${JSON.stringify(words)} }, actions: ${actions}, enabled: true });`,
    ].join("\n");
  },
});

export const leaveServer = action({
  type: "discord.leaveServer",
  label: "Leave server",
  description: "Makes the bot leave a server.",
  icon: "DoorOpen",
  inputs: [guild],
  emit: (ctx) => `await ${ctx.value("guild")}.leave();`,
});

export const updateMessage = action({
  type: "discord.updateMessage",
  label: "Update clicked message",
  description: "Edits the message whose button or menu was used, instead of sending a new reply.",
  icon: "PenLine",
  inputs: [{ id: "text", label: "Text", type: "string" }],
  fields: [
    { id: "text", label: "New text", kind: "text", multiline: true, required: true },
    { id: "keep", label: "Keep the buttons", kind: "boolean", default: true },
  ],
  emit: (ctx) => {
    if (ctx.trigger.context !== "interaction" || !ctx.trigger.vars.message) {
      ctx.fail("Update clicked message works after a Button pressed or Menu option chosen trigger.");
    }
    return `await interaction.update({ content: ${ctx.value("text")}${ctx.field("keep") === false ? ", components: []" : ""} });`;
  },
});

export const deleteReply = action({
  type: "discord.deleteReply",
  label: "Delete reply",
  description: "Deletes the bot's reply to this command or button.",
  icon: "Trash2",
  emit: (ctx) => {
    if (ctx.trigger.context !== "interaction") ctx.fail("Delete reply works after a command, button, menu or form trigger.");
    return "await interaction.deleteReply().catch(() => null);";
  },
});

export const avatar = defineNode({
  type: "discord.avatar",
  label: "Avatar and banner",
  description: "Gets the image links of a user's or server's avatar, icon and banner.",
  category: "data",
  icon: "Image",
  platforms: discord,
  inputs: [{ id: "target", label: "User, member or server", type: "any" }],
  outputs: [
    { id: "avatar", label: "Avatar / icon", type: "string" },
    { id: "banner", label: "Banner", type: "string" },
  ],
  fields: [
    {
      id: "size",
      label: "Size",
      kind: "select",
      default: "512",
      options: ["64", "128", "256", "512", "1024", "4096"].map((value) => ({ value, label: `${value} px` })),
    },
  ],
  expression: (ctx, output) => {
    const size = Number(ctx.field("size")) || 512;
    const target = ctx.value("target");
    if (output === "banner") return `(${target}?.bannerURL?.({ size: ${size} }) ?? "")`;
    return `(${target}?.displayAvatarURL?.({ size: ${size} }) ?? ${target}?.iconURL?.({ size: ${size} }) ?? "")`;
  },
});

export const mention = defineNode({
  type: "discord.mention",
  label: "Mention and timestamp",
  description: "Builds a mention for a user, role or channel, or a timestamp that shows in each reader's time zone.",
  category: "data",
  icon: "AtSign",
  platforms: discord,
  inputs: [{ id: "target", label: "User, role, channel or date", type: "any" }],
  outputs: [{ id: "text", label: "Text", type: "string" }],
  fields: [
    {
      id: "kind",
      label: "Make",
      kind: "select",
      default: "user",
      options: [
        { value: "user", label: "User mention" },
        { value: "role", label: "Role mention" },
        { value: "channel", label: "Channel mention" },
        { value: "R", label: "Relative time (in 5 minutes)" },
        { value: "f", label: "Date and time" },
        { value: "D", label: "Date" },
        { value: "t", label: "Time" },
      ],
    },
  ],
  expression: (ctx) => {
    const kind = String(ctx.field("kind") ?? "user");
    const target = ctx.value("target");
    if (kind === "user") return `\`<@\${${idOf(target)}}>\``;
    if (kind === "role") return `\`<@&\${${idOf(target)}}>\``;
    if (kind === "channel") return `\`<#\${${idOf(target)}}>\``;
    return `\`<t:\${Math.floor(new Date(${target} ?? Date.now()).getTime() / 1000)}:${kind}>\``;
  },
});

export const memberRoles = defineNode({
  type: "discord.memberRoles",
  label: "Member roles and permissions",
  description: "Lists a member's roles and permission names.",
  category: "data",
  icon: "ShieldCheck",
  platforms: discord,
  inputs: [member],
  outputs: [list("roles", "Roles"), list("permissions", "Permissions"), { id: "highest", label: "Highest role", type: "role" }],
  fields: [],
  expression: (ctx, output) => {
    const target = ctx.value("member");
    if (output === "permissions") return `(${target}?.permissions?.toArray?.() ?? [])`;
    if (output === "highest") return `(${target}?.roles?.highest ?? null)`;
    return `[...(${target}?.roles?.cache?.values?.() ?? [])].filter((item) => item.name !== "@everyone")`;
  },
});

export const botProfile = action({
  type: "discord.botProfile",
  label: "Change bot profile",
  description: "Changes the bot's username or avatar. Discord limits this to a few times per hour.",
  icon: "Bot",
  fields: [
    { id: "username", label: "Username", kind: "text" },
    { id: "avatar", label: "Avatar URL", kind: "text" },
  ],
  emit: (ctx) =>
    [
      `if (${ctx.value("username")}) await client.user.setUsername(${ctx.value("username")});`,
      `if (${ctx.value("avatar")}) await client.user.setAvatar(${ctx.value("avatar")});`,
    ].join("\n"),
});

export const moreDiscordNodes = [
  pollVote,
  fetchMessages,
  fetchMessage,
  unpin,
  clearReactions,
  crosspost,
  poll,
  endPoll,
  editChannel,
  channelPermissions,
  lockChannel,
  cloneChannel,
  moveChannel,
  createThread,
  threadAction,
  threadMember,
  forumPost,
  createWebhook,
  listInvites,
  editRole,
  deleteRole,
  fetchRole,
  listMembers,
  listRoles,
  listChannels,
  listBans,
  voiceMove,
  voiceMute,
  auditLog,
  editServer,
  emoji,
  scheduledEvent,
  automod,
  leaveServer,
  updateMessage,
  deleteReply,
  avatar,
  mention,
  memberRoles,
  botProfile,
];

export const discordNodes = [
  pickerMenu,
  sendFile,
  attachments,
  slashCommand,
  userContextMenu,
  messageContextMenu,
  messageCreate,
  messageDelete,
  messageUpdate,
  memberJoin,
  memberLeave,
  reaction,
  voice,
  guildJoin,
  memberUpdate,
  banned,
  anyEvent,
  buttonClick,
  selectUsed,
  modalSubmit,
  defer,
  editReply,
  embed,
  buttons,
  selectMenu,
  showModal,
  addRole,
  removeRole,
  createRole,
  hasRole,
  hasPermission,
  directMessage,
  kick,
  ban,
  unban,
  timeout,
  nickname,
  react,
  editMessage,
  deleteMessage,
  pin,
  purge,
  typing,
  thread,
  createChannel,
  deleteChannel,
  invite,
  presence,
  webhook,
  fetchMember,
  fetchUser,
  fetchChannel,
  userInfo,
  memberInfo,
  serverInfo,
  channelInfo,
  messageInfo,
  ...moreDiscordNodes,
];
