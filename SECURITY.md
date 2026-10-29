# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Use [GitHub private vulnerability reporting](https://github.com/0xRoony/open-sila/security/advisories/new) and include the version, steps to reproduce and the impact you expect. You will get an answer within a week, and a fix or mitigation plan once the report is confirmed.

## Supported versions

Only the latest release receives security fixes.

## Security model

Open Sila is a local tool. It assumes the person who can reach the dashboard is the owner of the machine.

**Network**

- The server binds to `127.0.0.1` by default. Binding to another address prints a warning; put the server behind HTTPS before exposing it.
- Requests whose `Host` header is not in the allowed list are rejected, which blocks DNS rebinding. WebSocket connections also check `Origin`.

**Authentication**

- The dashboard signs in with a one-time link printed at startup. It sets an `httpOnly`, `SameSite=Strict` session cookie, and every state-changing request must send the `x-sila-request` header.
- API keys are stored as SHA-256 hashes, are either read-only or read-write, and cannot create other keys. Read-only keys only see read tools over MCP.

**Storage**

- The database is encrypted with SQLite3 Multiple Ciphers. By default the key lives in `master.key` in the data directory, which protects a copied database file but not a copied data directory. Set `OPEN_SILA_KEY` from a secret manager for stronger separation.
- Bot tokens and other secrets are never returned by the API; the dashboard only shows their last four characters.
- Data saved by bots with the **Save value** node is plain JSON in the data directory. Databases configured in the **Data** panel follow the security of the database you connect.

**Bots**

- Bots run as child processes with their project secrets as environment variables. The dashboard's own key is removed from that environment.
- The JavaScript and Expression nodes run inside the bot without a sandbox. Only run flows you trust, and review imported project files before running them.
- Incoming webhook triggers accept requests from anyone who can reach the bot. Set a secret variable on the node to require the `X-Webhook-Secret` header.
