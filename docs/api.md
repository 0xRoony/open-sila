# REST API

Base URL: `http://127.0.0.1:4590/api/v1`

Authenticate with an API key:

```
Authorization: Bearer osk_...
```

Read-only keys can call `GET` endpoints. Write keys can call everything except the key management endpoints, which are only available from the dashboard.

Errors use one shape:

```json
{ "error": { "code": "not_found", "message": "Project not found." } }
```

Build failures return `422` with `error.diagnostics`.

## Endpoints

### Projects

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Server status and version. No authentication |
| `GET` | `/session` | Who the request is authenticated as |
| `GET` | `/nodes?platform=discord` | Node catalog with ports and fields |
| `GET` | `/projects` | Projects with their bot state |
| `POST` | `/projects` | Create a project: `{ name, platform, description?, flow? }` |
| `GET` | `/projects/:id` | Project with its flow |
| `PATCH` | `/projects/:id` | Update `name`, `description` or `flow`. Returns the project and diagnostics |
| `DELETE` | `/projects/:id` | Stop the bot and delete the project |
| `GET` | `/projects/:id/diagnostics` | Validation errors and warnings |
| `GET` | `/projects/:id/code?mode=production` | Generated files and requirements |
| `GET` | `/projects/:id/export` | ZIP of the production build. Add `?format=json` for the `.sila.json` project file |
| `POST` | `/projects/import?name=` | Create a project from a project file. Returns the project and diagnostics |

### Versions

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/projects/:id/versions` | Saved versions, newest first |
| `POST` | `/projects/:id/versions` | Save the current flow: `{ label? }` |
| `GET` | `/projects/:id/versions/:versionId` | One version with its flow |
| `POST` | `/projects/:id/versions/:versionId/restore` | Restore a version. The current flow is saved as a version first |

### Secrets

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/projects/:id/secrets` | Secret names with a masked preview |
| `PUT` | `/projects/:id/secrets/:name` | Set a secret: `{ value }` |
| `DELETE` | `/projects/:id/secrets/:name` | Remove a secret |

### Bot

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/projects/:id/bot` | Bot state, local port and the last 500 log lines |
| `POST` | `/projects/:id/bot/start` | Build and start the bot |
| `POST` | `/projects/:id/bot/stop` | Stop the bot |
| `POST` | `/projects/:id/bot/run` | Run a Manual run trigger in the running bot: `{ nodeId, payload? }` |
| `GET` | `/projects/:id/runs` | Recent runs and the latest step of each node |
| `GET` | `/projects/:id/runs/:runId` | One run with every step's inputs and outputs |
| `DELETE` | `/projects/:id/runs` | Clear the run history |
| `GET` | `/projects/:id/network` | Outgoing HTTP requests captured from the bot |
| `GET` | `/events` | WebSocket stream of `status`, `log`, `trace`, `run`, `step` and `net` events |

### API keys

Key management is only available from the dashboard session.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/keys` | List API keys |
| `POST` | `/keys` | Create a key: `{ name, scope: "read" \| "write" }`. The secret is returned once |
| `DELETE` | `/keys/:id` | Revoke a key |

## Example

```bash
KEY=osk_...
BASE=http://127.0.0.1:4590/api/v1

curl -s -X POST $BASE/projects -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" \
  -d '{"name":"Helper","platform":"telegram"}'

curl -s -X PUT $BASE/projects/<id>/secrets/TELEGRAM_TOKEN -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" -d '{"value":"123:abc"}'

curl -s -o helper.zip $BASE/projects/<id>/export -H "Authorization: Bearer $KEY"
```
