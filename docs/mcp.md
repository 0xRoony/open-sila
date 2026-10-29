# MCP

Open Sila exposes a stateless Streamable HTTP MCP endpoint at `POST /mcp`. Authenticate with an API key as a Bearer token.

## Connecting

Claude Code:

```bash
claude mcp add --transport http open-sila http://127.0.0.1:4590/mcp --header "Authorization: Bearer osk_..."
```

Clients that use a JSON config:

```json
{
  "mcpServers": {
    "open-sila": {
      "type": "http",
      "url": "http://127.0.0.1:4590/mcp",
      "headers": { "Authorization": "Bearer osk_..." }
    }
  }
}
```

## Tools

Available with any key:

| Tool | Description |
| --- | --- |
| `list_node_types` | Node types with ports and fields, optionally for one platform |
| `list_projects` | Projects with platform and bot state |
| `get_project` | A project with its full flow |
| `validate_project` | Errors and warnings for the flow |
| `get_generated_code` | The generated bot source files |
| `bot_status` | Bot state and the last 50 log lines |
| `export_project` | The project as a project file document |

Available with write keys:

| Tool | Description |
| --- | --- |
| `create_project` | Create an empty project |
| `import_project` | Create a project from a project file document |
| `set_flow` | Replace the whole flow |
| `add_node` | Add a node and return its id |
| `connect_nodes` | Connect an output port to an input port |
| `remove_node` | Remove a node and its connections |
| `set_secret` | Store a secret such as `DISCORD_TOKEN` |
| `list_versions` | Saved versions of the flow, newest first |
| `restore_version` | Replace the flow with a saved version; the current flow is saved first |
| `start_bot` | Build and start the bot |
| `run_manual` | Run a Manual run trigger in the running bot with a JSON payload |
| `stop_bot` | Stop the bot |

## Building a flow

A typical sequence for an assistant:

1. `list_node_types` with the project platform.
2. `add_node` for a trigger, then for each action.
3. `connect_nodes` from each node's `next` port to the following node's `exec` port, and data ports where values are passed.
4. `validate_project` and fix what it reports.
5. `start_bot`, then `bot_status` to read the logs.
