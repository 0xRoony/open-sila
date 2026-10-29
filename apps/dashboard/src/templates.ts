import type { Database, FieldValue, Flow, FlowEdge, FlowNode, Platform } from "@open-sila/core";

export type TemplateGroup = "Start" | "Community" | "Fun" | "Moderation" | "Data" | "Automation";

export interface Template {
  id: string;
  name: string;
  description: string;
  group: TemplateGroup;
  platforms?: Platform[];
  flow(platform: Platform): Flow;
}

const node = (id: string, type: string, x: number, y: number, data: Record<string, FieldValue>): FlowNode => ({
  id,
  type,
  position: { x, y },
  data,
});

const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): FlowEdge => ({
  id: `e_${source}_${sourceHandle}_${target}_${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

const run = (from: string, to: string, port = "next") => edge(from, port, to, "exec");

function command(id: string, platform: Platform, name: string, description: string, y: number, extra: Record<string, FieldValue> = {}): FlowNode {
  return platform === "discord"
    ? node(id, "discord.slashCommand", 0, y, { name, description, options: "", ...extra })
    : node(id, "telegram.command", 0, y, { name, description });
}

function onMessage(id: string, platform: Platform, y: number): FlowNode {
  return platform === "discord"
    ? node(id, "discord.message", 0, y, { where: "server", contains: "", ignoreBots: true })
    : node(id, "telegram.message", 0, y, { contains: "", where: "all" });
}

const userName = (platform: Platform) => (platform === "discord" ? "{{ user.username }}" : "{{ user.first_name }}");

const LEADERBOARD: Database = {
  provider: "sqlite",
  models: [
    {
      name: "Member",
      fields: [
        { name: "userId", type: "String", optional: false, unique: true, list: false },
        { name: "name", type: "String", optional: false, unique: false, list: false },
        { name: "points", type: "Int", optional: false, unique: false, list: false, default: "0" },
      ],
    },
  ],
};

export const templates: Template[] = [
  {
    id: "empty",
    name: "Empty",
    description: "Start from a blank canvas.",
    group: "Start",
    flow: () => ({ nodes: [], edges: [] }),
  },
  {
    id: "ping",
    name: "Ping command",
    description: "A command that replies, to check the bot works.",
    group: "Start",
    flow: (platform) => ({
      nodes: [
        command("trigger", platform, "ping", "Check that the bot is online", 0),
        node("reply", "core.reply", 340, 0, { text: `Pong, ${userName(platform)}!`, private: false }),
      ],
      edges: [run("trigger", "reply")],
    }),
  },
  {
    id: "test-run",
    name: "Test with Run now",
    description: "A Manual run trigger with a sample payload, to try logic without opening Discord or Telegram.",
    group: "Start",
    flow: () => ({
      nodes: [
        node("manual", "core.manual", 0, 0, { name: "Test run", payload: '{\n  "user": "Sara",\n  "amount": 5\n}' }),
        node("double", "core.code", 340, 0, { code: "return { ...a, amount: a.amount * 2 };" }),
        node("log", "core.log", 680, 0, { text: "Doubled: {{ $1 }}" }),
      ],
      edges: [run("manual", "double"), edge("manual", "payload", "double", "a"), run("double", "log"), edge("double", "result", "log", "text")],
    }),
  },
  {
    id: "welcome",
    name: "Welcome new members",
    description: "Greets people when they join, privately on Discord and by approving join requests on Telegram.",
    group: "Community",
    flow: (platform) =>
      platform === "discord"
        ? {
            nodes: [
              node("join", "discord.memberJoin", 0, 0, {}),
              node("dm", "discord.dm", 340, 0, { text: "Welcome to {{ guild.name }}, {{ user.username }}! Read the rules channel to get started." }),
            ],
            edges: [run("join", "dm")],
          }
        : {
            nodes: [
              node("request", "telegram.joinRequest", 0, 0, {}),
              node("approve", "telegram.answerJoin", 340, 0, { answer: "approve" }),
            ],
            edges: [run("request", "approve")],
          },
  },
  {
    id: "points",
    name: "Points counter",
    description: "Members earn points per message and check them with a command.",
    group: "Community",
    flow: (platform) => ({
      nodes: [
        onMessage("onMessage", platform, 0),
        node("addPoint", "core.increment", 340, 0, { key: "points:{{ user.id }}", amount: 1 }),
        command("command", platform, "points", "Show your points", 260),
        node("readPoints", "core.getValue", 340, 260, { key: "points:{{ user.id }}", fallback: "0" }),
        node("answer", "core.reply", 680, 260, { text: "You have {{ $1 }} points.", private: true }),
      ],
      edges: [
        run("onMessage", "addPoint"),
        run("command", "readPoints"),
        run("readPoints", "answer"),
        edge("readPoints", "value", "answer", "text"),
      ],
    }),
  },
  {
    id: "leaderboard",
    name: "Leaderboard with a database",
    description: "Stores points in SQLite through Prisma and shows the top 10. Switch to PostgreSQL or MongoDB in the Data panel.",
    group: "Data",
    flow: (platform) => ({
      database: LEADERBOARD,
      nodes: [
        onMessage("onMessage", platform, 0),
        node("save", "core.dbUpsert", 340, 0, {
          model: "Member",
          match: "userId",
          "@f_userId": "String(user.id)",
          "@f_name": platform === "discord" ? "user.username" : "user.first_name",
          "@f_points": "{ increment: 1 }",
        }),
        command("top", platform, "top", "Show the top 10 members", 300),
        node("find", "core.dbFind", 340, 300, { model: "Member", orderBy: "points", direction: "desc", limit: 10 }),
        node("format", "core.code", 680, 300, {
          code: 'return a.map((member, index) => `${index + 1}. ${member.name}: ${member.points}`).join("\\n") || "No points yet.";',
        }),
        node("answer", "core.reply", 1020, 300, { text: "Top members:\n{{ $1 }}", private: false }),
      ],
      edges: [
        run("onMessage", "save"),
        run("top", "find"),
        run("find", "format"),
        edge("find", "records", "format", "a"),
        run("format", "answer"),
        edge("format", "result", "answer", "text"),
      ],
    }),
  },
  {
    id: "coin",
    name: "Coin flip and dice",
    description: "Commands that flip a coin and roll a number from 1 to 100.",
    group: "Fun",
    flow: (platform) => ({
      nodes: [
        command("flip", platform, "flip", "Flip a coin", 0),
        node("side", "core.pick", 340, 0, { list: "Heads\nTails" }),
        node("flipReply", "core.reply", 680, 0, { text: "🪙 {{ $1 }}", private: false }),
        command("roll", platform, "roll", "Roll from 1 to 100", 240),
        node("number", "core.random", 340, 240, { min: 1, max: 100 }),
        node("rollReply", "core.reply", 680, 240, { text: "🎲 You rolled {{ $1 }}", private: false }),
      ],
      edges: [
        run("flip", "flipReply"),
        edge("side", "item", "flipReply", "text"),
        run("roll", "rollReply"),
        edge("number", "value", "rollReply", "text"),
      ],
    }),
  },
  {
    id: "eightball",
    name: "Magic 8-ball",
    description: "Answers a yes or no question with a random reply.",
    group: "Fun",
    flow: (platform) => ({
      nodes: [
        command("ask", platform, "ask", "Ask the magic 8-ball", 0),
        node("answer", "core.pick", 340, 160, { list: "It is certain.\nAsk again later.\nDon't count on it.\nYes, definitely.\nMy sources say no.\nSigns point to yes." }),
        node("reply", "core.reply", 680, 0, { text: "🎱 {{ $1 }}", private: false }),
      ],
      edges: [run("ask", "reply"), edge("answer", "item", "reply", "text")],
    }),
  },
  {
    id: "joke",
    name: "Random joke from an API",
    description: "Calls a public API, picks fields from the JSON and replies. Shows HTTP request and Try.",
    group: "Fun",
    flow: (platform) => ({
      nodes: [
        command("joke", platform, "joke", "Tell a random joke", 0),
        node("try", "core.try", 300, 0, {}),
        node("http", "core.http", 600, -80, { url: "https://official-joke-api.appspot.com/random_joke", method: "GET" }),
        node("setup", "core.jsonValue", 900, 60, { path: "setup" }),
        node("punchline", "core.jsonValue", 900, 180, { path: "punchline" }),
        node("reply", "core.reply", 1200, -80, { text: "{{ $1 }}\n\n||{{ $2 }}||", private: false }),
        node("sorry", "core.reply", 600, 220, { text: "The joke service is down: {{ $1 }}", private: true }),
      ],
      edges: [
        run("joke", "try"),
        run("try", "http", "try"),
        run("http", "reply"),
        edge("http", "data", "setup", "object"),
        edge("http", "data", "punchline", "object"),
        edge("setup", "value", "reply", "text"),
        edge("punchline", "value", "reply", "text"),
        run("try", "sorry", "catch"),
        edge("try", "error", "sorry", "text"),
      ],
    }),
  },
  {
    id: "conversation",
    name: "Ask and wait for an answer",
    description: "Asks a question, waits for the user's next message, and answers or times out.",
    group: "Fun",
    flow: (platform) => ({
      nodes: [
        command("hello", platform, "hello", "Introduce yourself", 0),
        node("question", "core.reply", 300, 0, { text: "Hi! What's your name?", private: false }),
        node("wait", "core.waitForReply", 600, 0, { seconds: 60 }),
        node("thanks", "core.sendMessage", 900, -60, { text: "Nice to meet you, {{ $1 }}!" }),
        node("late", "core.sendMessage", 900, 140, { text: "No answer, maybe next time." }),
      ],
      edges: [
        run("hello", "question"),
        run("question", "wait"),
        run("wait", "thanks"),
        edge("wait", "text", "thanks", "text"),
        run("wait", "late", "timeout"),
        edge("hello", platform === "discord" ? "channel" : "chat", "thanks", "channel"),
        edge("hello", platform === "discord" ? "channel" : "chat", "late", "channel"),
      ],
    }),
  },
  {
    id: "quiz",
    name: "Quiz",
    description: "Sends a quiz with one correct answer and an explanation.",
    group: "Fun",
    platforms: ["telegram"],
    flow: (platform) => ({
      nodes: [
        command("quiz", platform, "quiz", "Start a quiz", 0),
        node("send", "telegram.quiz", 340, 0, {
          question: "What is the capital of Japan?",
          options: "Osaka\nTokyo\nKyoto",
          correct: 2,
          explanation: "Tokyo has been the capital since 1868.",
          seconds: 30,
        }),
      ],
      edges: [run("quiz", "send")],
    }),
  },
  {
    id: "roles",
    name: "Self-assign roles",
    description: "Buttons that give members a role when they press them. Put your role ID in Add role.",
    group: "Community",
    platforms: ["discord"],
    flow: (platform) => ({
      nodes: [
        command("panel", platform, "roles", "Post the role buttons", 0, { permission: "ManageRoles" }),
        node("buttons", "discord.buttons", 340, 0, { text: "Pick your notifications:", buttons: "📢 News | role-news\n🎮 Events | role-events", private: false }),
        node("news", "discord.button", 0, 260, { customId: "role-news" }),
        node("give", "discord.addRole", 340, 260, { role: "ROLE_ID" }),
        node("done", "core.reply", 680, 260, { text: "Done! You now get news pings.", private: true }),
      ],
      edges: [run("panel", "buttons"), run("news", "give"), edge("news", "member", "give", "member"), run("give", "done")],
    }),
  },
  {
    id: "feedback",
    name: "Feedback form",
    description: "Opens a pop-up form and posts the answers to a staff channel.",
    group: "Community",
    platforms: ["discord"],
    flow: (platform) => ({
      nodes: [
        command("feedback", platform, "feedback", "Send feedback to the team", 0),
        node("form", "discord.showModal", 340, 0, {
          customId: "feedback",
          title: "Feedback",
          inputs: "subject | Subject | short\ndetails | Tell us more | paragraph",
        }),
        node("submitted", "discord.modalSubmit", 0, 240, { customId: "feedback", inputs: "subject\ndetails" }),
        node("post", "core.sendMessage", 340, 240, { channel: "STAFF_CHANNEL_ID", text: "📝 **{{ $1 }}** from {{ user.username }}\n{{ $2 }}" }),
        node("thanks", "core.reply", 680, 240, { text: "Thanks, the team got it.", private: true }),
      ],
      edges: [
        run("feedback", "form"),
        run("submitted", "post"),
        edge("submitted", "in_subject", "post", "text"),
        edge("submitted", "in_details", "post", "text"),
        run("post", "thanks"),
      ],
    }),
  },
  {
    id: "clear",
    name: "Clear messages",
    description: "/clear deletes the last messages in a channel. Only members who can manage messages see it.",
    group: "Moderation",
    platforms: ["discord"],
    flow: (platform) => ({
      nodes: [
        command("clear", platform, "clear", "Delete recent messages", 0, {
          options: "count | integer | How many (1-100) | required",
          permission: "ManageMessages",
          serverOnly: true,
        }),
        node("purge", "discord.purge", 340, 0, { count: 10 }),
        node("done", "core.reply", 680, 0, { text: "Deleted {{ $1 }} messages.", private: true }),
      ],
      edges: [
        run("clear", "purge"),
        edge("clear", "channel", "purge", "channel"),
        edge("clear", "opt_count", "purge", "count"),
        run("purge", "done"),
        edge("purge", "deleted", "done", "text"),
      ],
    }),
  },
  {
    id: "slowmode",
    name: "Spam guard",
    description: "Lets each member post once every few seconds and warns them when they go faster.",
    group: "Moderation",
    flow: (platform) => ({
      nodes: [
        onMessage("message", platform, 0),
        node("limit", "core.cooldown", 340, 0, { seconds: 3, key: "{{ user.id }}" }),
        node("warn", "core.reply", 680, 120, { text: `Slow down, ${userName(platform)}. Wait {{ $1 }}s.`, private: false }),
      ],
      edges: [run("message", "limit"), run("limit", "warn", "blocked"), edge("limit", "remaining", "warn", "text")],
    }),
  },
  {
    id: "daily",
    name: "Daily reminder",
    description: "Posts a message every weekday at 9:00 in your time zone. Set the channel or chat ID.",
    group: "Automation",
    flow: () => ({
      nodes: [
        node("schedule", "core.schedule", 0, 0, { cron: "0 9 * * 1-5", timezone: "UTC" }),
        node("post", "core.sendMessage", 340, 0, { channel: "CHANNEL_OR_CHAT_ID", text: "☀️ Good morning! Stand-up in 15 minutes." }),
      ],
      edges: [run("schedule", "post")],
    }),
  },
  {
    id: "webhook",
    name: "Webhook to chat",
    description: "Receives HTTP requests from another service and posts them to a channel or chat.",
    group: "Automation",
    flow: () => ({
      nodes: [
        node("hook", "core.webhook", 0, 0, { path: "/hooks/notify", method: "POST", secret: "" }),
        node("text", "core.jsonValue", 300, 140, { path: "text" }),
        node("post", "core.sendMessage", 600, 0, { channel: "CHANNEL_OR_CHAT_ID", text: "🔔 {{ $1 }}" }),
      ],
      edges: [run("hook", "post"), edge("hook", "body", "text", "object"), edge("text", "value", "post", "text")],
    }),
  },
  {
    id: "stars",
    name: "Stars shop",
    description: "Sells premium access for Telegram Stars and thanks the buyer after payment.",
    group: "Automation",
    platforms: ["telegram"],
    flow: (platform) => ({
      nodes: [
        command("buy", platform, "buy", "Buy premium access", 0),
        node("invoice", "telegram.invoice", 340, 0, { title: "Premium access", description: "Unlocks premium for 30 days.", amount: 50, payload: "premium" }),
        node("paid", "telegram.payment", 0, 260, { payload: "premium" }),
        node("unlock", "core.setValue", 340, 260, { key: "premium:{{ user.id }}", value: "true" }),
        node("thanks", "core.reply", 680, 260, { text: "Thank you! Premium is now active. ⭐", private: false }),
      ],
      edges: [run("buy", "invoice"), run("paid", "unlock"), run("unlock", "thanks")],
    }),
  },
];

export function templatesFor(platform: Platform): Template[] {
  return templates.filter((template) => !template.platforms || template.platforms.includes(platform));
}
