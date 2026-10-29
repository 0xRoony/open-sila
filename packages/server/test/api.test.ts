import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { Flow, Platform } from "@open-sila/core";
import { templates } from "../../../apps/dashboard/src/templates.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { loadMasterKey } from "../src/crypto.js";
import { Store } from "../src/db.js";
import { Runner } from "../src/runner.js";
import { Services } from "../src/services.js";

type App = Awaited<ReturnType<typeof createApp>>;

const dataDir = mkdtempSync(join(tmpdir(), "sila-api-"));
const config = loadConfig({ dataDir, port: 4599 });
const host = `127.0.0.1:${config.port}`;
let app: App;
let store: Store;
let runner: Runner;
let cookie = "";

interface Call {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
  key?: string;
  anonymous?: boolean;
  headers?: Record<string, string>;
}

async function call({ method = "GET", url, body, key, anonymous, headers = {} }: Call) {
  const response = await app.server.inject({
    method,
    url,
    payload: body === undefined ? undefined : (body as object),
    headers: {
      host,
      ...(key ? { authorization: `Bearer ${key}` } : anonymous ? {} : { cookie, "x-sila-request": "1" }),
      ...headers,
    },
  });
  const type = String(response.headers["content-type"] ?? "");
  return { status: response.statusCode, json: type.includes("json") && response.body ? response.json() : undefined, response };
}

async function mcp(key: string, method: string, params: object = {}) {
  const response = await app.server.inject({
    method: "POST",
    url: "/mcp",
    payload: { jsonrpc: "2.0", id: 1, method, params },
    headers: { host, authorization: `Bearer ${key}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
  });
  const body = response.body.trim();
  const text = body.startsWith("{") ? body : (body.split("\n").find((line) => line.startsWith("data:")) ?? "").slice(5);
  return { status: response.statusCode, message: text ? JSON.parse(text) : undefined };
}

before(async () => {
  store = new Store(dataDir, loadMasterKey(dataDir));
  runner = new Runner(dataDir);
  app = await createApp(config, new Services(store, runner), "test");
  const login = await app.server.inject({ method: "GET", url: `/login?token=${app.loginToken}`, headers: { host } });
  assert.equal(login.statusCode, 302);
  cookie = String(login.headers["set-cookie"]).split(";")[0];
});

after(async () => {
  await runner.stopAll();
  await app.server.close();
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("security", () => {
  test("rejects unknown Host headers", async () => {
    const { status } = await call({ url: "/api/v1/projects", headers: { host: "evil.example.com" } });
    assert.equal(status, 421);
  });

  test("needs a session or an API key", async () => {
    assert.equal((await call({ url: "/api/v1/projects", anonymous: true })).status, 401);
    assert.equal((await call({ url: "/api/v1/projects", key: "sila_wrong" })).status, 401);
    const bad = await app.server.inject({ method: "GET", url: "/login?token=nope", headers: { host } });
    assert.equal(bad.statusCode, 401);
  });

  test("API keys respect their scope and can be revoked", async () => {
    const read = (await call({ method: "POST", url: "/api/v1/keys", body: { name: "reader", scope: "read" } })).json;
    const write = (await call({ method: "POST", url: "/api/v1/keys", body: { name: "writer", scope: "write" } })).json;
    assert.ok(read.secret && write.secret);
    assert.equal((await call({ url: "/api/v1/projects", key: read.secret })).status, 200);
    const denied = await call({ method: "POST", url: "/api/v1/projects", key: read.secret, body: { name: "x", platform: "discord" } });
    assert.equal(denied.status, 403);
    const created = await call({ method: "POST", url: "/api/v1/projects", key: write.secret, body: { name: "by key", platform: "telegram" } });
    assert.equal(created.status, 201);
    assert.equal((await call({ url: "/api/v1/keys", key: write.secret })).status, 403, "keys are managed from the dashboard only");
    assert.equal((await call({ method: "DELETE", url: `/api/v1/keys/${read.id}` })).status, 204);
    assert.equal((await call({ url: "/api/v1/projects", key: read.secret })).status, 401);
    const keys = (await call({ url: "/api/v1/keys" })).json as { id: string; name: string }[];
    assert.ok(!keys.some((key) => key.id === read.id));
    assert.ok(!JSON.stringify(keys).includes(write.secret), "secrets are never listed");
  });
});

describe("projects", () => {
  test("lists every node with its ports", async () => {
    for (const platform of ["discord", "telegram"] as const) {
      const nodes = (await call({ url: `/api/v1/nodes?platform=${platform}` })).json as { type: string }[];
      assert.ok(nodes.length > 110, `${platform} has ${nodes.length} nodes`);
      assert.ok(nodes.every((node) => node.type.startsWith("core.") || node.type.startsWith(`${platform}.`)));
    }
  });

  test("every template creates a valid project that builds, exports and imports", async () => {
    for (const template of templates) {
      for (const platform of template.platforms ?? (["discord", "telegram"] as Platform[])) {
        const flow = template.flow(platform);
        const created = await call({ method: "POST", url: "/api/v1/projects", body: { name: `${template.name} ${platform}`, description: "", platform, flow } });
        assert.equal(created.status, 201, `${template.id}: ${JSON.stringify(created.json)}`);
        const id = created.json.id as string;

        const diagnostics = (await call({ url: `/api/v1/projects/${id}/diagnostics` })).json as { level: string; message: string }[];
        assert.deepEqual(diagnostics.filter((item) => item.level === "error"), [], template.id);

        const code = (await call({ url: `/api/v1/projects/${id}/code` })).json;
        assert.equal(code.ok, true, template.id);
        assert.ok(code.files.some((file: { path: string }) => file.path === "src/index.js"));

        const zip = await call({ url: `/api/v1/projects/${id}/export` });
        assert.equal(zip.status, 200);
        assert.equal(zip.response.rawPayload.subarray(0, 2).toString(), "PK");

        const document = (await call({ url: `/api/v1/projects/${id}/export?format=json` })).json;
        assert.equal(document.format, "open-sila");
        const imported = await call({ method: "POST", url: "/api/v1/projects/import?name=Copy", body: document });
        assert.equal(imported.status, 201, JSON.stringify(imported.json));
        const copy = (await call({ url: `/api/v1/projects/${imported.json.project?.id ?? imported.json.id}` })).json;
        assert.deepEqual(copy.flow, (await call({ url: `/api/v1/projects/${id}` })).json.flow, `${template.id} round trip`);
      }
    }
  });

  test("rejects invalid input with clear errors", async () => {
    assert.equal((await call({ method: "POST", url: "/api/v1/projects", body: { name: "", platform: "discord" } })).status, 400);
    assert.equal((await call({ method: "POST", url: "/api/v1/projects", body: { name: "x", platform: "whatsapp" } })).status, 400);
    const project = (await call({ method: "POST", url: "/api/v1/projects", body: { name: "bad flow", platform: "discord" } })).json;
    const broken = await call({ method: "PATCH", url: `/api/v1/projects/${project.id}`, body: { flow: { nodes: "nope", edges: [] } } });
    assert.equal(broken.status, 400);
    assert.equal((await call({ url: "/api/v1/projects/missing" })).status, 404);
    assert.equal((await call({ method: "POST", url: "/api/v1/projects/import", body: { format: "other" } })).status, 400);
  });

  test("reports problems in a flow without saving it broken", async () => {
    const project = (await call({ method: "POST", url: "/api/v1/projects", body: { name: "problems", platform: "discord" } })).json;
    const flow: Flow = {
      nodes: [
        { id: "a", type: "discord.slashCommand", position: { x: 0, y: 0 }, data: { name: "a", description: "a" } },
        { id: "b", type: "core.reply", position: { x: 0, y: 0 }, data: { text: "" } },
      ],
      edges: [{ id: "e", source: "a", sourceHandle: "next", target: "b", targetHandle: "exec" }],
    };
    const saved = await call({ method: "PATCH", url: `/api/v1/projects/${project.id}`, body: { flow } });
    assert.equal(saved.status, 200);
    assert.ok(saved.json.diagnostics.some((item: { level: string; nodeId?: string }) => item.level === "error" && item.nodeId === "b"));
    const code = (await call({ url: `/api/v1/projects/${project.id}/code` })).json;
    assert.equal(code.ok, false);
  });
});

describe("secrets, versions and the bot", () => {
  let id = "";

  before(async () => {
    const ping = templates.find((template) => template.id === "ping")!;
    id = (await call({ method: "POST", url: "/api/v1/projects", body: { name: "lifecycle", platform: "discord", flow: ping.flow("discord") } })).json.id;
  });

  test("stores secrets encrypted and only shows a preview", async () => {
    assert.equal((await call({ method: "PUT", url: `/api/v1/projects/${id}/secrets/DISCORD_TOKEN`, body: { value: "abcdefghijklmnopqrstuvwxyz" } })).status, 204);
    const listed = (await call({ url: `/api/v1/projects/${id}/secrets` })).json as { name: string; preview: string }[];
    assert.equal(listed[0].name, "DISCORD_TOKEN");
    assert.ok(!listed[0].preview.includes("abcdefghijklmnop"));
    store.db.pragma("wal_checkpoint(TRUNCATE)");
    for (const file of ["sila.db", "sila.db-wal"]) {
      const path = join(dataDir, file);
      if (existsSync(path)) assert.ok(!readFileSync(path).includes("abcdefghijklmnop"), `${file} holds the secret in plain text`);
    }
    assert.equal((await call({ method: "PUT", url: `/api/v1/projects/${id}/secrets/bad name`, body: { value: "x" } })).status, 400);
    assert.equal((await call({ method: "DELETE", url: `/api/v1/projects/${id}/secrets/DISCORD_TOKEN` })).status, 204);
  });

  test("refuses to start a bot without its token, and Run now without a bot", async () => {
    const start = await call({ method: "POST", url: `/api/v1/projects/${id}/bot/start` });
    assert.equal(start.status, 422);
    assert.match(start.json.error.message, /DISCORD_TOKEN/);
    const manual = await call({ method: "POST", url: `/api/v1/projects/${id}/bot/run`, body: { nodeId: "trigger" } });
    assert.equal(manual.status, 404, "only Manual run triggers can be run");
    assert.equal((await call({ url: `/api/v1/projects/${id}/bot` })).json.state, "stopped");
  });

  test("saves, lists and restores versions", async () => {
    const original = (await call({ url: `/api/v1/projects/${id}` })).json.flow as Flow;
    const saved = (await call({ method: "POST", url: `/api/v1/projects/${id}/versions`, body: { label: "Before change" } })).json;
    await call({ method: "PATCH", url: `/api/v1/projects/${id}`, body: { flow: { nodes: [], edges: [] } } });
    const restored = await call({ method: "POST", url: `/api/v1/projects/${id}/versions/${saved.id}/restore` });
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.json.project.flow, original);
    const versions = (await call({ url: `/api/v1/projects/${id}/versions` })).json as { label: string; nodes: number }[];
    assert.ok(versions.some((version) => version.label === "Before restore" && version.nodes === 0));
    assert.equal((await call({ url: `/api/v1/projects/${id}/versions/missing` })).status, 404);
  });

  test("runs and network logs start empty and can be cleared", async () => {
    const runs = (await call({ url: `/api/v1/projects/${id}/runs` })).json;
    assert.deepEqual(runs.runs, []);
    assert.equal((await call({ method: "DELETE", url: `/api/v1/projects/${id}/runs` })).status, 204);
    assert.deepEqual((await call({ url: `/api/v1/projects/${id}/network` })).json, []);
  });

  test("deleting a project removes it everywhere", async () => {
    assert.equal((await call({ method: "DELETE", url: `/api/v1/projects/${id}` })).status, 204);
    assert.equal((await call({ url: `/api/v1/projects/${id}` })).status, 404);
    assert.equal((await call({ url: `/api/v1/projects/${id}/versions` })).status, 404);
  });
});

describe("MCP", () => {
  let reader = "";
  let writer = "";

  before(async () => {
    reader = (await call({ method: "POST", url: "/api/v1/keys", body: { name: "mcp read", scope: "read" } })).json.secret;
    writer = (await call({ method: "POST", url: "/api/v1/keys", body: { name: "mcp write", scope: "write" } })).json.secret;
  });

  test("needs an API key", async () => {
    const response = await app.server.inject({ method: "POST", url: "/mcp", payload: {}, headers: { host, cookie } });
    assert.equal(response.statusCode, 401);
  });

  test("lists tools by scope and builds a bot through them", async () => {
    const init = await mcp(writer, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.equal(init.status, 200);
    assert.equal(init.message.result.serverInfo.name, "open-sila");

    const readTools = (await mcp(reader, "tools/list")).message.result.tools.map((tool: { name: string }) => tool.name);
    const writeTools = (await mcp(writer, "tools/list")).message.result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(readTools.includes("list_projects"));
    assert.ok(!readTools.includes("create_project"), "read keys cannot change anything");
    for (const name of ["create_project", "add_node", "connect_nodes", "set_flow", "export_project", "import_project", "list_versions", "restore_version", "run_manual"]) {
      assert.ok(writeTools.includes(name), `missing ${name}`);
    }

    const tool = async (name: string, args: object) => {
      const { message } = await mcp(writer, "tools/call", { name, arguments: args });
      assert.ok(!message.result?.isError, `${name}: ${JSON.stringify(message)}`);
      return JSON.parse(message.result.content[0].text);
    };
    const project = await tool("create_project", { name: "From MCP", platform: "telegram" });
    const command = await tool("add_node", { projectId: project.id, type: "telegram.command", data: { name: "hi", description: "Say hi" } });
    const reply = await tool("add_node", { projectId: project.id, type: "core.reply", data: { text: "Hello!" } });
    const link = await tool("connect_nodes", { projectId: project.id, source: command.nodeId, sourcePort: "next", target: reply.nodeId, targetPort: "exec" });
    assert.deepEqual(link.diagnostics.filter((item: { level: string }) => item.level === "error"), []);
    const code = await tool("get_generated_code", { projectId: project.id });
    assert.ok(JSON.stringify(code).includes("Hello!"));
    const versions = await tool("list_versions", { projectId: project.id });
    assert.ok(Array.isArray(versions));

    const unknown = await mcp(writer, "tools/call", { name: "add_node", arguments: { projectId: project.id, type: "core.nope" } });
    assert.ok(unknown.message.result?.isError || unknown.message.error, "unknown node types are refused");
  });
});
