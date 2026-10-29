# @open-sila/server

The [Open Sila](https://github.com/0xRoony/open-sila) server and `sila` CLI: the dashboard, REST API, MCP endpoint, encrypted local store and bot runner.

```bash
npx @open-sila/server start
```

| Command | Description |
| --- | --- |
| `sila start [--port 4590] [--host 127.0.0.1] [--data-dir ~/.open-sila]` | Start the server and print a sign-in link |
| `sila keys list` | List API keys |
| `sila keys create <name> [--read-only]` | Create an API key; the secret is shown once |
| `sila keys revoke <id>` | Revoke an API key |

Requires Node.js 20.12 or newer. See the [main README](https://github.com/0xRoony/open-sila#readme) for configuration, security and the API.

## License

MIT
