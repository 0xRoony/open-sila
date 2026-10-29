# Architecture

## Packages

| Package | Role |
| --- | --- |
| `@open-sila/core` | Flow schema (Zod), node catalog, validation and the code generator. Runs in Node and in the browser. |
| `@open-sila/server` | Fastify server and the `sila` CLI. Owns the database, runs bots and exposes the REST API, WebSocket events and the MCP endpoint. |
| `@open-sila/dashboard` | React editor built with Vite. Its build output is served by the server from `packages/server/public`. |

## Flow model

A project has one platform and one flow. A flow is a list of nodes and edges, plus optional database models:

```json
{
  "nodes": [{ "id": "n1", "type": "discord.slashCommand", "position": { "x": 0, "y": 0 }, "data": { "name": "ping" } }],
  "edges": [{ "id": "e1", "source": "n1", "sourceHandle": "next", "target": "n2", "targetHandle": "exec" }],
  "database": { "provider": "sqlite", "models": [] }
}
```

Ports are typed. `exec` ports set the run order; the other types carry values (`string`, `number`, `boolean`, `user`, `member`, `channel`, `message`, `role`, `guild`, `list` and `any`). Compatible types convert on the wire. A data input takes one connection, except text inputs, which merge several wires with `{{ $1 }}` placeholders. An input without a connection uses its field value, a custom JavaScript expression stored as `@<port>`, or the trigger variable with the same name.

## Compilation

`compileProject` in `packages/core/src/compiler` runs four steps:

1. **Validate.** Unknown or foreign node types, incompatible or duplicate connections, empty required fields, loops on the run path, duplicate commands, invalid database models, and warnings such as placeholders without wires or keys nobody writes.
2. **Generate handlers.** Each trigger becomes one file in `src/handlers/`. The generator walks the exec edges from the trigger and asks each node for its code. Values come from trigger variables, inline expressions from pure nodes, or variables declared by earlier nodes on the same path. Values scoped to a branch, such as a loop item or a caught error, are only visible inside that branch.
3. **Collect requirements.** Gateway intents, partials, Telegram update types, permissions, environment variables and runtime helpers from the nodes in use.
4. **Scaffold.** Entry point, handler index, the helpers that were used, `package.json`, `Dockerfile`, deployment files, `.env.example` and a README. Prisma files are added only when a node uses the database, and the HTTP server only when the flow has an incoming webhook.

Development builds wrap each run in a trace context and report every node's inputs, outputs and errors, plus outgoing HTTP requests. Production builds leave this out.

## Running bots

`Runner` in `packages/server/src/runner.ts`:

1. Writes a development build to `<data>/builds/<project>/`.
2. Resolves the build's dependencies with `Modules` (`packages/server/src/modules.ts`): packages the server already ships are linked, others are installed once into `<data>/packages` and shared between bots.
3. For flows that use the database, generates the Prisma client and pushes the schema when it changed. SQLite projects without `DATABASE_URL` get a file in `<data>/data/<project>/`.
4. Starts the bot with `child_process.fork`, passing the project secrets as environment variables.

The child reports runs, steps, errors and network requests over IPC; `RunLog` keeps the last 200 runs per project. Logs, status changes and traces reach the dashboard through the `/api/v1/events` WebSocket. A crashed bot restarts with exponential backoff, up to five times.

## Storage

`Store` in `packages/server/src/db.ts` opens `<data>/sila.db` with SQLite3 Multiple Ciphers and the master key, and applies migrations tracked with `PRAGMA user_version`.

| Table | Contents |
| --- | --- |
| `projects` | Name, description, platform and the flow as JSON |
| `secrets` | Bot tokens and other environment values, per project |
| `versions` | The last 50 saved flows per project |
| `api_keys` | Name, scope, prefix and SHA-256 hash of each key |
| `sessions` | SHA-256 hashes of dashboard session tokens with expiry |

## Authentication

| Client | How it authenticates |
| --- | --- |
| Dashboard | A one-time sign-in link printed at startup sets a 30-day session cookie. State-changing requests must send `x-sila-request: 1`. |
| Scripts | `Authorization: Bearer osk_...` with a read or write API key. |
| MCP clients | The same API keys on `POST /mcp`. Read-only keys only see the read tools. |

Every request must use a `Host` header from the allowed list. WebSocket connections also check the `Origin` header.

## Tests

| File | Covers |
| --- | --- |
| `packages/core/test/catalog.test.ts` | Every node compiles in development and production mode, and the output passes `node --check`. |
| `packages/core/test/runtime.test.ts` | Runs the generated code of every node, under every compatible trigger, against mocked discord.js and grammY clients in four scenarios (normal, unusual input, direct messages, failing API), plus every template. |
| `packages/core/test/compiler.test.ts` | Focused compiler behaviour: scoping, commands, webhooks, databases, deployment files. |
| `packages/server/test/api.test.ts` | REST API, authentication, secrets encryption, versions, import and export, and the MCP endpoint. |
