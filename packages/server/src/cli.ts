#!/usr/bin/env node
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { createApp } from "./app.js";
import { KEY_PREFIX } from "./auth.js";
import { loadConfig } from "./config.js";
import { loadMasterKey, randomToken } from "./crypto.js";
import { Store } from "./db.js";
import { Runner } from "./runner.js";
import { Services } from "./services.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const HELP = `Open Sila ${version}

Usage
  sila start [--port 4590] [--host 127.0.0.1] [--data-dir ~/.open-sila]
  sila keys list
  sila keys create <name> [--read-only]
  sila keys revoke <id>

Environment
  OPEN_SILA_HOME           Data directory (default ~/.open-sila)
  OPEN_SILA_KEY            64 hex chars. Database key; otherwise master.key in the data directory is used
  OPEN_SILA_PUBLIC_URL     URL the dashboard is reached at, when behind a proxy
  OPEN_SILA_ALLOWED_HOSTS  Extra Host headers to accept, comma separated
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string" },
    host: { type: "string" },
    "data-dir": { type: "string" },
    "read-only": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
  },
});

const config = loadConfig({
  host: values.host,
  port: values.port ? Number(values.port) : undefined,
  dataDir: values["data-dir"],
});

function openStore(): Store {
  return new Store(config.dataDir, loadMasterKey(config.dataDir));
}

async function start(): Promise<void> {
  const store = openStore();
  const runner = new Runner(config.dataDir);
  const services = new Services(store, runner);
  const { server, loginToken } = await createApp(config, services, version);

  await server.listen({ host: config.host, port: config.port });

  console.log(`\nOpen Sila ${version}`);
  console.log(`Data      ${config.dataDir}`);
  console.log(`Dashboard ${config.publicUrl}/login?token=${loginToken}`);
  console.log(`API       ${config.publicUrl}/api/v1`);
  console.log(`MCP       ${config.publicUrl}/mcp\n`);
  if (config.host !== "127.0.0.1" && config.host !== "localhost") {
    console.warn("Warning: the server is reachable from other machines. Put it behind HTTPS before exposing it.\n");
  }

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await runner.stopAll();
    await server.close();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function keys(action: string | undefined, argument: string | undefined): void {
  const store = openStore();
  try {
    if (action === "list") {
      const list = store.listKeys();
      if (list.length === 0) console.log("No API keys.");
      for (const key of list) {
        console.log(`${key.id}  ${key.prefix}…  ${key.scope.padEnd(5)}  ${key.name}  last used ${key.lastUsedAt ?? "never"}`);
      }
    } else if (action === "create" && argument) {
      const secret = `${KEY_PREFIX}${randomToken(24)}`;
      const key = store.createKey(argument, values["read-only"] ? "read" : "write", secret);
      console.log(`Created ${key.scope} key ${key.id}. Store it now, it will not be shown again:\n\n${secret}\n`);
    } else if (action === "revoke" && argument) {
      console.log(store.deleteKey(argument) ? "Revoked." : "No key with that id.");
    } else {
      console.log(HELP);
      process.exitCode = 1;
    }
  } finally {
    store.close();
  }
}

const [command, action, argument] = positionals;

if (values.version) {
  console.log(version);
} else if (values.help || !command) {
  console.log(HELP);
} else if (command === "start") {
  start().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
} else if (command === "keys") {
  keys(action, argument);
} else {
  console.log(HELP);
  process.exitCode = 1;
}
