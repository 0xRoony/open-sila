import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  publicUrl: string;
  allowedHosts: string[];
}

export function loadConfig(overrides: Partial<Pick<Config, "host" | "port" | "dataDir">> = {}): Config {
  const host = overrides.host ?? process.env.OPEN_SILA_HOST ?? "127.0.0.1";
  const port = overrides.port ?? Number(process.env.OPEN_SILA_PORT ?? 4590);
  const dataDir = resolve(overrides.dataDir ?? process.env.OPEN_SILA_HOME ?? join(homedir(), ".open-sila"));
  const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const publicUrl = process.env.OPEN_SILA_PUBLIC_URL ?? `http://${displayHost}:${port}`;
  const extra = (process.env.OPEN_SILA_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedHosts = [
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
    `${displayHost}:${port}`,
    new URL(publicUrl).host,
    ...extra,
  ];
  return { host, port, dataDir, publicUrl, allowedHosts: [...new Set(allowedHosts)] };
}
