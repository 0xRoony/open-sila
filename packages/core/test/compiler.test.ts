import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { compileProject, fieldsFor, getNode, listNodes, templateLiteral, validateFlow, type CompileResult, type Flow, type FlowEdge } from "../src/index.js";

const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): FlowEdge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

function assertValidJavaScript(result: CompileResult): void {
  const dir = mkdtempSync(join(tmpdir(), "sila-test-"));
  try {
    for (const file of result.files.filter((item) => item.path.endsWith(".js"))) {
      const target = join(dir, file.path.replace(/\.js$/, ".mjs"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
      execFileSync(process.execPath, ["--check", target], { stdio: "pipe" });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const discordFlow: Flow = {
  nodes: [
    { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "Ping", description: "Ping", options: "who | text | Who" } },
    { id: "check", type: "core.compare", position: { x: 0, y: 0 }, data: { operator: "equals", b: "bot" } },
    { id: "branch", type: "core.if", position: { x: 0, y: 0 }, data: {} },
    { id: "yes", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "Hi `{{ user.username }}` ${x}", private: true } },
    { id: "embed", type: "discord.embed", position: { x: 0, y: 0 }, data: { title: "Hello", color: "#123456" } },
    { id: "count", type: "core.increment", position: { x: 0, y: 0 }, data: { key: "uses", amount: 1 } },
    { id: "code", type: "core.code", position: { x: 0, y: 0 }, data: { code: "return a * 2;" } },
    { id: "log", type: "core.log", position: { x: 0, y: 0 }, data: { text: "done" } },
  ],
  edges: [
    edge("cmd", "next", "branch", "exec"),
    edge("cmd", "opt_who", "check", "a"),
    edge("check", "result", "branch", "condition"),
    edge("branch", "true", "yes", "exec"),
    edge("branch", "false", "embed", "exec"),
    edge("embed", "next", "count", "exec"),
    edge("count", "next", "code", "exec"),
    edge("count", "total", "code", "a"),
    edge("code", "next", "log", "exec"),
    edge("code", "result", "log", "text"),
  ],
};

test("compiles a Discord flow into valid JavaScript", () => {
  const result = compileProject({ name: "Test Bot", platform: "discord", flow: discordFlow });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const handler = result.files.find((file) => file.path.startsWith("src/handlers/command-ping"));
  assert.ok(handler, "slash command handler is generated");
  assert.match(handler.content, /interaction\.commandName !== "ping"/);
  assert.match(handler.content, /MessageFlags\.Ephemeral/);
  assert.match(handler.content, /\.setColor\(1193046\)/);
  assert.ok(result.files.some((file) => file.path === "src/lib/store.js"));
  assert.ok(!result.files.some((file) => file.path === "src/lib/trace.js"));
  assertValidJavaScript(result);
});

test("development builds include tracing", () => {
  const result = compileProject({ name: "Test", platform: "discord", flow: discordFlow }, { mode: "development" });
  assert.equal(result.ok, true);
  const handler = result.files.find((file) => file.path.startsWith("src/handlers/command-ping"));
  const content = handler?.content ?? "";
  assert.match(content, /await run\("cmd", "Slash command: Ping", async \(\) => \{/);
  assert.match(content, /step\("yes", \(\) => \(\{ "text": /);
  assert.match(content, /done\("yes", \(\) => \(\{ "message": message_yes \}\)\);/);
  assert.match(content, /done\("branch", \(\) => \(\{ path: "true" \}\)\);/);
  assert.ok(result.files.find((file) => file.path === "src/index.js")?.content.includes("instrument(client);"));
  assertValidJavaScript(result);
});

test("compiles a Telegram flow with commands, keyboards and callbacks", () => {
  const flow: Flow = {
    nodes: [
      { id: "start", type: "telegram.command", position: { x: 0, y: 0 }, data: { name: "start", description: "Start" } },
      { id: "menu", type: "telegram.keyboard", position: { x: 0, y: 0 }, data: { text: "Pick", buttons: "One|one\nSite|https://example.com" } },
      { id: "press", type: "telegram.callback", position: { x: 0, y: 0 }, data: { data: "one" } },
      { id: "answer", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "You picked one, {{ user.first_name }}" } },
      { id: "tick", type: "core.interval", position: { x: 0, y: 0 }, data: { minutes: 5 } },
      { id: "post", type: "core.sendMessage", position: { x: 0, y: 0 }, data: { channel: "12345", text: "Still here" } },
    ],
    edges: [edge("start", "next", "menu", "exec"), edge("press", "next", "answer", "exec"), edge("tick", "next", "post", "exec")],
  };
  const result = compileProject({ name: "Tg", platform: "telegram", flow });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const index = result.files.find((file) => file.path === "src/handlers/index.js")?.content ?? "";
  assert.ok(index.indexOf("commandStart") < index.indexOf("buttonOne"), "commands register before other handlers");
  assert.match(index, /"command": "start"/);
  assertValidJavaScript(result);
});

test("reports incompatible connections and missing fields", () => {
  const flow: Flow = {
    nodes: [
      { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "", description: "x", options: "who | text | Who" } },
      { id: "role", type: "discord.addRole", position: { x: 0, y: 0 }, data: { role: "1" } },
    ],
    edges: [edge("cmd", "next", "role", "exec"), edge("cmd", "opt_who", "role", "member")],
  };
  const diagnostics = validateFlow(flow, "discord");
  assert.ok(diagnostics.some((item) => item.nodeId === "cmd" && item.message.includes("Command name is required")));
  assert.ok(diagnostics.some((item) => item.nodeId === "role" && item.message.includes("cannot connect")));
});

test("rejects nodes from another platform and loops", () => {
  const flow: Flow = {
    nodes: [
      { id: "cmd", type: "telegram.command", position: { x: 0, y: 0 }, data: { name: "a", description: "a" } },
      { id: "a", type: "core.log", position: { x: 0, y: 0 }, data: { text: "a" } },
      { id: "b", type: "core.log", position: { x: 0, y: 0 }, data: { text: "b" } },
    ],
    edges: [edge("cmd", "next", "a", "exec"), edge("a", "next", "b", "exec"), edge("b", "next", "a", "exec")],
  };
  const diagnostics = validateFlow(flow, "discord");
  assert.ok(diagnostics.some((item) => item.message.includes("not available for discord")));
  assert.ok(diagnostics.some((item) => item.message.includes("loops back")));
});

test("refuses to reply when the trigger has nothing to reply to", () => {
  const flow: Flow = {
    nodes: [
      { id: "join", type: "discord.memberJoin", position: { x: 0, y: 0 }, data: {} },
      { id: "reply", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "Welcome" } },
    ],
    edges: [edge("join", "next", "reply", "exec")],
  };
  const result = compileProject({ name: "x", platform: "discord", flow });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0]?.nodeId, "reply");
});

test("uses values only after the node that produces them", () => {
  const flow: Flow = {
    nodes: [
      { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "a", description: "a" } },
      { id: "read", type: "core.getValue", position: { x: 0, y: 0 }, data: { key: "k" } },
      { id: "say", type: "core.reply", position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [edge("cmd", "next", "say", "exec"), edge("say", "next", "read", "exec"), edge("read", "value", "say", "text")],
  };
  const result = compileProject({ name: "x", platform: "discord", flow });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.find((item) => item.level === "error")?.message ?? "", /before it runs/);
});

test("template text escapes literal backticks and interpolations", () => {
  assert.equal(templateLiteral("plain"), '"plain"');
  assert.equal(templateLiteral("a `b` ${c} {{ d.e }}"), "`a \\`b\\` \\${c} ${d.e}`");
});

test("shared nodes only show settings for the project platform", () => {
  const reply = getNode("core.reply");
  assert.ok(reply);
  const discord = fieldsFor(reply, "discord").map((field) => field.id);
  const telegram = fieldsFor(reply, "telegram").map((field) => field.id);
  assert.ok(discord.includes("private") && !discord.includes("format"));
  assert.ok(telegram.includes("format") && !telegram.includes("private"));

  for (const platform of ["discord", "telegram"] as const) {
    for (const definition of listNodes(platform)) {
      for (const field of fieldsFor(definition, platform)) {
        const other = platform === "discord" ? "telegram" : "discord";
        const text = `${field.label} ${field.help ?? ""}`.toLowerCase();
        assert.ok(!text.includes(other), `${definition.type}.${field.id} mentions ${other} in a ${platform} project`);
      }
    }
  }
});

test("converts values between types when ports differ", () => {
  const flow: Flow = {
    nodes: [
      { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "a", description: "a", options: "count | integer | How many" } },
      { id: "info", type: "discord.userInfo", position: { x: 0, y: 0 }, data: {} },
      { id: "first", type: "core.reply", position: { x: 0, y: 0 }, data: {} },
      { id: "second", type: "core.reply", position: { x: 0, y: 0 }, data: {} },
      { id: "third", type: "core.log", position: { x: 0, y: 0 }, data: {} },
      { id: "wait", type: "discord.purge", position: { x: 0, y: 0 }, data: {} },
      { id: "text", type: "core.text", position: { x: 0, y: 0 }, data: { text: "5" } },
    ],
    edges: [
      edge("cmd", "next", "first", "exec"),
      edge("first", "next", "second", "exec"),
      edge("second", "next", "third", "exec"),
      edge("third", "next", "wait", "exec"),
      edge("cmd", "opt_count", "first", "text"),
      edge("cmd", "user", "second", "text"),
      edge("info", "isBot", "third", "text"),
      edge("text", "text", "wait", "count"),
    ],
  };
  assert.equal(validateFlow(flow, "discord").filter((item) => item.level === "error").length, 0);
  const result = compileProject({ name: "convert", platform: "discord", flow });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const handler = result.files.find((file) => file.path.startsWith("src/handlers/command-a"))?.content ?? "";
  assert.match(handler, /content: String\(options\.count\)/);
  assert.match(handler, /content: toText\(user\)/);
  assert.match(handler, /console\.log\(String\(/);
  assert.match(handler, /bulkDelete\(Math\.min\(100, Math\.max\(1, Number\(Number\(/);
  assert.ok(result.files.find((file) => file.path === "src/lib/runtime.js")?.content.includes("export function toText"));
  assertValidJavaScript(result);
});

test("uses a custom expression for an input without a connection", () => {
  const flow: Flow = {
    nodes: [
      { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "a", description: "a" } },
      { id: "kick", type: "discord.kick", position: { x: 0, y: 0 }, data: { "@member": "interaction.options.getMember(\"target\")" } },
    ],
    edges: [edge("cmd", "next", "kick", "exec")],
  };
  const result = compileProject({ name: "custom", platform: "discord", flow });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const handler = result.files.find((file) => file.path.startsWith("src/handlers/command-a"))?.content ?? "";
  assert.match(handler, /await \(interaction\.options\.getMember\("target"\)\)\.kick\(/);
});

test("connects wires to settings, such as an HTTP body built from parts", () => {
  const flow: Flow = {
    nodes: [
      { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "a", description: "a", options: "score | integer | Score" } },
      { id: "body", type: "core.object", position: { x: 0, y: 0 }, data: { keys: "name\nscore", "@k_name": "user.username" } },
      { id: "auth", type: "core.text", position: { x: 0, y: 0 }, data: { text: "Bearer {{ process.env.API_KEY }}" } },
      { id: "headers", type: "core.object", position: { x: 0, y: 0 }, data: { keys: "authorization" } },
      { id: "url", type: "core.text", position: { x: 0, y: 0 }, data: { text: "https://api.example.com/scores" } },
      { id: "call", type: "core.http", position: { x: 0, y: 0 }, data: { method: "POST", url: "" } },
      { id: "wait", type: "core.delay", position: { x: 0, y: 0 }, data: { seconds: 1 } },
    ],
    edges: [
      edge("cmd", "next", "call", "exec"),
      edge("call", "next", "wait", "exec"),
      edge("cmd", "opt_score", "body", "k_score"),
      edge("auth", "text", "headers", "k_authorization"),
      edge("headers", "object", "call", "headers"),
      edge("body", "object", "call", "body"),
      edge("url", "text", "call", "url"),
      edge("call", "status", "wait", "seconds"),
    ],
  };
  assert.deepEqual(validateFlow(flow, "discord").filter((item) => item.level === "error"), []);
  const result = compileProject({ name: "http", platform: "discord", flow });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const handler = result.files.find((file) => file.path.startsWith("src/handlers/command-a"))?.content ?? "";
  assert.ok(handler.includes('body: JSON.stringify((({ "name": (user.username), "score": options.score })))'));
  assert.ok(handler.includes('"content-type": "application/json", ...(({ "authorization": (`Bearer ${process.env.API_KEY}`) }))'));
  assert.ok(handler.includes('fetch(("https://api.example.com/scores")'));
  assert.ok(handler.includes("await sleep(Math.max(0, Number(status_call)) * 1000);"));
  assertValidJavaScript(result);
});

test("merges several wires and typed text into one text input", () => {
  const flow: Flow = {
    nodes: [
      { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "a", description: "a", options: "item | text | Item" } },
      { id: "info", type: "discord.userInfo", position: { x: 0, y: 0 }, data: {} },
      { id: "say", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "{{ $1 }} picked {{ $2.toUpperCase() }}!" } },
      { id: "log", type: "core.log", position: { x: 0, y: 0 }, data: { text: "" } },
    ],
    edges: [
      edge("cmd", "next", "say", "exec"),
      edge("say", "next", "log", "exec"),
      { id: "w1", source: "info", sourceHandle: "name", target: "say", targetHandle: "text" },
      { id: "w2", source: "cmd", sourceHandle: "opt_item", target: "say", targetHandle: "text" },
      { id: "w3", source: "info", sourceHandle: "id", target: "log", targetHandle: "text" },
      { id: "w4", source: "cmd", sourceHandle: "opt_item", target: "log", targetHandle: "text" },
    ],
  };
  assert.deepEqual(validateFlow(flow, "discord").filter((item) => item.level === "error"), []);
  const result = compileProject({ name: "merge", platform: "discord", flow });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const handler = result.files.find((file) => file.path.startsWith("src/handlers/command-a"))?.content ?? "";
  assert.ok(handler.includes("content: `${((user.displayName ?? user.username))} picked ${(options.item).toUpperCase()}!`"), handler);
  assert.ok(handler.includes("console.log(`${(user.id)}${options.item}`);"), handler);
  assertValidJavaScript(result);
});

test("remembers an interaction and edits it from another flow", () => {
  const flow: Flow = {
    nodes: [
      { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "start", description: "s" } },
      { id: "keep", type: "core.remember", position: { x: 0, y: 0 }, data: { key: "panel:{{ user.id }}", minutes: 10 } },
      { id: "click", type: "discord.button", position: { x: 0, y: 0 }, data: { customId: "go" } },
      { id: "find", type: "core.recall", position: { x: 0, y: 0 }, data: { key: "panel:{{ user.id }}" } },
      { id: "edit", type: "discord.editReply", position: { x: 0, y: 0 }, data: { text: "Updated" } },
      { id: "answer", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "Done" } },
    ],
    edges: [
      edge("cmd", "next", "keep", "exec"),
      edge("cmd", "interaction", "keep", "value"),
      edge("click", "next", "edit", "exec"),
      edge("find", "value", "edit", "interaction"),
      edge("edit", "next", "answer", "exec"),
      edge("find", "value", "answer", "replyTo"),
    ],
  };
  const result = compileProject({ name: "memory", platform: "discord", flow });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const all = result.files.map((file) => file.content).join("\n");
  assert.match(all, /memory\.set\(`panel:\$\{user\.id\}`, interaction, Number\(10\)\);/);
  assert.match(all, /await \(memory\.get\(`panel:\$\{user\.id\}`\)\)\.editReply\(\{ content: "Updated" \}\);/);
  assert.match(all, /respond\(\(memory\.get\(`panel:\$\{user\.id\}`\)\), \{ content: "Done" \}\)/);
  assertValidJavaScript(result);
});

test("listens to direct messages with the right intents", () => {
  const flow: Flow = {
    nodes: [
      { id: "dm", type: "discord.message", position: { x: 0, y: 0 }, data: { where: "dm", ignoreBots: true } },
      { id: "say", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "Got your DM" } },
    ],
    edges: [edge("dm", "next", "say", "exec")],
  };
  const result = compileProject({ name: "dm", platform: "discord", flow });
  assert.equal(result.ok, true);
  const entry = result.files.find((file) => file.path === "src/index.js")?.content ?? "";
  assert.match(entry, /GatewayIntentBits\.DirectMessages/);
  assert.match(entry, /Partials\.Channel/);
  assert.match(result.files.find((file) => file.path.startsWith("src/handlers/message-"))?.content ?? "", /if \(message\.inGuild\(\)\) return;/);
  assertValidJavaScript(result);
});

test("asks Telegram for updates that are off by default", () => {
  const flow: Flow = {
    nodes: [
      { id: "react", type: "telegram.update", position: { x: 0, y: 0 }, data: { filter: "message_reaction" } },
      { id: "log", type: "core.log", position: { x: 0, y: 0 }, data: { text: "reaction" } },
    ],
    edges: [edge("react", "next", "log", "exec")],
  };
  const result = compileProject({ name: "tg", platform: "telegram", flow });
  assert.equal(result.ok, true);
  const entry = result.files.find((file) => file.path === "src/index.js")?.content ?? "";
  assert.match(entry, /allowed_updates: \[\.\.\.API_CONSTANTS\.DEFAULT_UPDATE_TYPES, "message_reaction"\]/);
  assertValidJavaScript(result);
});

test("saves an interaction and returns to it from another flow", () => {
  for (const platform of ["discord", "telegram"] as const) {
    const trigger = platform === "discord" ? "discord.slashCommand" : "telegram.command";
    const later = platform === "discord" ? "discord.button" : "telegram.callback";
    const flow: Flow = {
      nodes: [
        { id: "cmd", type: trigger, position: { x: 0, y: 0 }, data: { name: "open", description: "Open" } },
        { id: "save", type: "core.saveInteraction", position: { x: 0, y: 0 }, data: { key: "panel:{{ user.id }}" } },
        { id: "press", type: later, position: { x: 0, y: 0 }, data: { customId: "next", data: "next" } },
        { id: "load", type: "core.loadInteraction", position: { x: 0, y: 0 }, data: { key: "panel:{{ user.id }}" } },
        { id: "answer", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "Back again" } },
      ],
      edges: [
        edge("cmd", "next", "save", "exec"),
        edge("press", "next", "load", "exec"),
        edge("load", "next", "answer", "exec"),
        edge("load", "interaction", "answer", "replyTo"),
      ],
    };
    const result = compileProject({ name: "refs", platform, flow });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const all = result.files.map((file) => file.content).join("\n");
    assert.match(all, /await refs\.save\(`panel:\$\{user\.id\}`, (source|ctx)\);/);
    assert.ok(all.includes(`await refs.load(${platform === "discord" ? "client" : "bot"}, `));
    assert.ok(result.files.some((file) => file.path === "src/lib/store.js"));
    assertValidJavaScript(result);
  }
});

test("keeps loop and catch values inside their own path", () => {
  const flow: Flow = {
    nodes: [
      { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "a", description: "a" } },
      { id: "loop", type: "core.forEach", position: { x: 0, y: 0 }, data: { list: "a\nb" } },
      { id: "after", type: "core.log", position: { x: 0, y: 0 }, data: { text: "" } },
    ],
    edges: [edge("cmd", "next", "loop", "exec"), edge("loop", "next", "after", "exec"), edge("loop", "item", "after", "text")],
  };
  const result = compileProject({ name: "x", platform: "discord", flow });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics[0]?.message ?? "", /only exists inside its Each path/);
});

test("catches a failing path with Try", () => {
  const flow: Flow = {
    nodes: [
      { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "a", description: "a" } },
      { id: "try", type: "core.try", position: { x: 0, y: 0 }, data: {} },
      { id: "fetch", type: "core.http", position: { x: 0, y: 0 }, data: { url: "https://example.com" } },
      { id: "sorry", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "Failed: {{ $1 }}" } },
      { id: "end", type: "core.log", position: { x: 0, y: 0 }, data: { text: "done" } },
    ],
    edges: [
      edge("cmd", "next", "try", "exec"),
      edge("try", "try", "fetch", "exec"),
      edge("try", "catch", "sorry", "exec"),
      edge("try", "error", "sorry", "text"),
      edge("try", "next", "end", "exec"),
    ],
  };
  for (const mode of ["production", "development"] as const) {
    const result = compileProject({ name: "x", platform: "discord", flow }, { mode });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const handler = result.files.find((file) => file.path.startsWith("src/handlers/command-"))?.content ?? "";
    assert.match(handler, /\} catch \(failure_try\) \{/);
    assertValidJavaScript(result);
  }
});

test("adds schedule, webhook, health check and graceful shutdown", () => {
  const flow: Flow = {
    nodes: [
      { id: "daily", type: "core.schedule", position: { x: 0, y: 0 }, data: { cron: "0 9 * * 1-5", timezone: "Asia/Riyadh" } },
      { id: "log1", type: "core.log", position: { x: 0, y: 0 }, data: { text: "morning" } },
      { id: "hook", type: "core.webhook", position: { x: 0, y: 0 }, data: { path: "/hooks/pay", secret: "WEBHOOK_SECRET" } },
      { id: "log2", type: "core.log", position: { x: 0, y: 0 }, data: { text: "" } },
    ],
    edges: [edge("daily", "next", "log1", "exec"), edge("hook", "next", "log2", "exec"), edge("hook", "body", "log2", "text")],
  };
  for (const platform of ["discord", "telegram"] as const) {
    const result = compileProject({ name: "x", platform, flow });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const all = result.files.map((file) => file.content).join("\n");
    assert.ok(all.includes('schedule("0 9 * * 1-5", "Asia/Riyadh"'));
    assert.ok(all.includes('http.on("/hooks/pay", {"method":"POST","secret":"WEBHOOK_SECRET"}'));
    assert.ok(all.includes("HEALTHCHECK"));
    assert.ok(all.includes('process.on(signal, () => void shutdown(signal))'));
    assertValidJavaScript(result);
  }
  const bad = compileProject({ name: "x", platform: "discord", flow: { ...flow, nodes: flow.nodes.map((node) => (node.id === "daily" ? { ...node, data: { cron: "every day" } } : node)) } });
  assert.match(bad.diagnostics[0]?.message ?? "", /five parts/);
});

test("warns about missing wires and keys nobody writes", () => {
  const flow: Flow = {
    nodes: [
      { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "a", description: "a" } },
      { id: "recall", type: "core.recall", position: { x: 0, y: 0 }, data: { key: "ticket:{{ user.id }}" } },
      { id: "say", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "{{ $1 }} and {{ $2 }}" } },
    ],
    edges: [edge("cmd", "next", "say", "exec"), edge("recall", "value", "say", "text")],
  };
  const messages = validateFlow(flow, "discord").map((item) => item.message);
  assert.ok(messages.some((message) => message.includes("uses $2 but only 1 wire is connected")));
  assert.ok(messages.some((message) => message.includes("no Remember node writes a key like it")));
});

test("groups subcommands and adds choices, suggestions and permissions", () => {
  const command = (id: string, name: string, extra: Record<string, string | boolean> = {}) => ({
    id,
    type: "discord.slashCommand",
    position: { x: 0, y: 0 },
    data: { name, description: `Run ${name}`, ...extra },
  });
  const flow: Flow = {
    nodes: [
      command("open", "ticket open", { options: "topic | text | Topic | required | Bug=bug, Idea=idea", permission: "ManageMessages" }),
      command("close", "ticket admin close", { options: "reason | text | Why | | auto: spam, solved, duplicate" }),
      command("ping", "ping", { serverOnly: true, localizations: "ar | بينغ | فحص" }),
    ],
    edges: [],
  };
  const result = compileProject({ name: "x", platform: "discord", flow });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const index = result.files.find((file) => file.path === "src/handlers/index.js")?.content ?? "";
  const commands = JSON.parse(index.slice(index.indexOf("export const commands = ") + 24).replace(/;\s*$/, ""));
  const ticket = commands.find((item: { name: string }) => item.name === "ticket");
  assert.equal(ticket.default_member_permissions, "8192");
  type Option = { type: number; name: string; options: Option[]; choices?: unknown; autocomplete?: boolean };
  const open = ticket.options.find((option: Option) => option.name === "open") as Option;
  const admin = ticket.options.find((option: Option) => option.name === "admin") as Option;
  assert.equal(open.type, 1);
  assert.equal(admin.type, 2);
  assert.deepEqual(open.options[0].choices, [
    { name: "Bug", value: "bug" },
    { name: "Idea", value: "idea" },
  ]);
  assert.equal(admin.options[0].options[0].autocomplete, true);
  const ping = commands.find((item: { name: string }) => item.name === "ping");
  assert.deepEqual(ping.contexts, [0]);
  assert.equal(ping.name_localizations.ar, "بينغ");
  const close = result.files.find((file) => file.path.includes("command-ticket-admin-close"))?.content ?? "";
  assert.ok(close.includes("interaction.isAutocomplete()"));
  assert.ok(close.includes('interaction.options.getSubcommandGroup(false) !== "admin"'));
  assertValidJavaScript(result);

  const clash = compileProject({ name: "x", platform: "discord", flow: { nodes: [...flow.nodes, command("bare", "ticket")], edges: [] } });
  assert.match(clash.diagnostics.find((item) => item.level === "error")?.message ?? "", /has subcommands/);
});

test("answers a saved slash command later and warns about the wrong Reply to wire", () => {
  const flow: Flow = {
    nodes: [
      { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "ping", description: "ping" } },
      { id: "save", type: "core.saveInteraction", position: { x: 0, y: 0 }, data: { key: "test:{{user.id}}" } },
      { id: "wait", type: "core.delay", position: { x: 0, y: 0 }, data: { seconds: 1 } },
      { id: "load", type: "core.loadInteraction", position: { x: 0, y: 0 }, data: { key: "test:{{user.id}}" } },
      { id: "reply", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "pong" } },
    ],
    edges: [
      edge("cmd", "next", "save", "exec"),
      edge("cmd", "interaction", "save", "source"),
      edge("save", "next", "wait", "exec"),
      edge("wait", "next", "load", "exec"),
      edge("load", "next", "reply", "exec"),
      edge("load", "user", "reply", "replyTo"),
    ],
  };
  const result = compileProject({ name: "x", platform: "discord", flow });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.diagnostics.some((item) => item.message.includes("Connect Interaction to answer")));
  const runtime = result.files.find((file) => file.path === "src/lib/runtime.js")?.content ?? "";
  assert.ok(runtime.includes("await source.deferReply()"));
  assertValidJavaScript(result);
});

test("adds the HTTP server only when the flow has an incoming webhook", () => {
  const command = (platform: "discord" | "telegram"): Flow => ({
    nodes: [
      {
        id: "cmd",
        type: platform === "discord" ? "discord.slashCommand" : "telegram.command",
        position: { x: 0, y: 0 },
        data: { name: "ping", description: "Ping" },
      },
      { id: "say", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "pong" } },
    ],
    edges: [edge("cmd", "next", "say", "exec")],
  });
  const hook: Flow["nodes"] = [
    { id: "hook", type: "core.webhook", position: { x: 0, y: 0 }, data: { path: "/hooks/in" } },
    { id: "log", type: "core.log", position: { x: 0, y: 0 }, data: { text: "got it" } },
  ];

  for (const platform of ["discord", "telegram"] as const) {
    const plain = compileProject({ name: "plain", platform, flow: command(platform) });
    assert.equal(plain.ok, true, JSON.stringify(plain.diagnostics));
    const file = (result: typeof plain, path: string) => result.files.find((item) => item.path === path)?.content ?? "";
    assert.ok(!plain.files.some((item) => item.path === "src/lib/http.js"));
    assert.ok(!file(plain, "src/index.js").includes("http.js"));
    assert.ok(!file(plain, "src/index.js").includes("listen()"));
    assert.ok(!file(plain, "Dockerfile").includes("HEALTHCHECK"));
    assert.ok(!file(plain, "Dockerfile").includes("PORT"));
    assert.ok(!file(plain, "railway.json").includes("healthcheckPath"));
    assert.ok(!file(plain, "fly.toml").includes("http_service"));
    assert.ok(!plain.requirements.env.includes("PORT"));
    assertValidJavaScript(plain);

    const flow = command(platform);
    const served = compileProject({ name: "served", platform, flow: { nodes: [...flow.nodes, ...hook], edges: [...flow.edges, edge("hook", "next", "log", "exec")] } });
    assert.equal(served.ok, true, JSON.stringify(served.diagnostics));
    assert.ok(served.files.some((item) => item.path === "src/lib/http.js"));
    assert.ok(file(served, "src/index.js").includes("listen();"));
    assert.ok(file(served, "Dockerfile").includes("HEALTHCHECK"));
    assert.ok(file(served, "fly.toml").includes("http_service"));
    assert.ok(served.requirements.env.includes("PORT"));
    if (platform === "telegram") assert.ok(file(served, "src/index.js").includes("process.env.WEBHOOK_URL"));
    assertValidJavaScript(served);
  }
});

test("keeps the generated Prisma client out of Git and Docker builds", () => {
  const flow: Flow = {
    database: { provider: "sqlite", models: [{ name: "Note", fields: [{ name: "text", type: "String", optional: false, unique: false, list: false }] }] },
    nodes: [
      { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "note", description: "Save a note" } },
      { id: "save", type: "core.dbCreate", position: { x: 0, y: 0 }, data: { model: "Note", "@f_text": '"hi"' } },
    ],
    edges: [edge("cmd", "next", "save", "exec")],
  };
  const result = compileProject({ name: "notes", platform: "discord", flow });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const file = (path: string) => result.files.find((item) => item.path === path)?.content ?? "";
  assert.ok(file(".dockerignore").split("\n").includes("generated"));
  assert.ok(file(".gitignore").split("\n").includes("generated/"));
  assert.ok(file("Dockerfile").indexOf("RUN npm install") < file("Dockerfile").indexOf("COPY . ."));
});

test("adds Prisma only when a node uses the database", () => {
  const database: Flow["database"] = {
    provider: "sqlite",
    models: [{ name: "Note", fields: [{ name: "text", type: "String", optional: false, unique: false, list: false }] }],
  };
  const command = { id: "cmd", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "note", description: "Save a note" } };
  const unused = compileProject({
    name: "plain",
    platform: "discord",
    flow: { database, nodes: [command, { id: "say", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "hi" } }], edges: [edge("cmd", "next", "say", "exec")] },
  });
  assert.equal(unused.ok, true, JSON.stringify(unused.diagnostics));
  const packageJson = JSON.parse(unused.files.find((file) => file.path === "package.json")?.content ?? "{}");
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), ["discord.js", "dotenv"]);
  assert.ok(!unused.files.some((file) => file.path.startsWith("prisma/") || file.path === "src/lib/db.js"));
  assert.ok(!unused.requirements.env.includes("DATABASE_URL"));
  assert.ok(!(unused.files.find((file) => file.path === "Dockerfile")?.content ?? "").includes("openssl"));

  const used = compileProject({
    name: "notes",
    platform: "discord",
    flow: {
      database,
      nodes: [command, { id: "save", type: "core.dbCreate", position: { x: 0, y: 0 }, data: { model: "Note", "@f_text": '"hi"' } }],
      edges: [edge("cmd", "next", "save", "exec")],
    },
  });
  assert.equal(used.ok, true, JSON.stringify(used.diagnostics));
  const usedPackage = JSON.parse(used.files.find((file) => file.path === "package.json")?.content ?? "{}");
  assert.ok(usedPackage.dependencies.prisma && usedPackage.dependencies["@prisma/client"]);
  assert.ok(used.files.some((file) => file.path === "prisma/schema.prisma"));
});
