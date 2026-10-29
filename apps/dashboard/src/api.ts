import type { CompileResult, Diagnostic, Flow, NodeInfo, Platform, Project, ProjectSummary } from "@open-sila/core";

export type BotState = "stopped" | "starting" | "running" | "crashed";

export interface LogEntry {
  at: number;
  level: "info" | "error" | "system";
  message: string;
  nodeId?: string;
}

export interface BotStatus {
  state: BotState;
  startedAt: number | null;
  exitCode: number | null;
  port: number | null;
  logs: LogEntry[];
}

export interface ProjectListItem extends ProjectSummary {
  bot: BotState;
}

export interface SecretInfo {
  name: string;
  preview: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "write";
  createdAt: string;
  lastUsedAt: string | null;
}

export type RunStatus = "running" | "ok" | "error";

export interface StepRecord {
  nodeId: string;
  startedAt: number;
  ms: number | null;
  status: RunStatus;
  inputs?: unknown;
  outputs?: unknown;
  path?: string;
  error?: string;
}

export interface NetworkRecord {
  id: string;
  runId: string | null;
  nodeId: string | null;
  at: number;
  source: "http" | "discord" | "telegram";
  method: string;
  url: string;
  status: number;
  ms: number | null;
  request?: unknown;
  response?: unknown;
  error?: string;
}

export interface VersionInfo {
  id: string;
  label: string;
  nodes: number;
  createdAt: string;
}

export interface RunSummary {
  id: string;
  triggerId: string;
  label: string;
  startedAt: number;
  ms: number | null;
  status: RunStatus;
  error?: string;
  steps: number;
  requests: number;
}

export interface RunRecord extends Omit<RunSummary, "steps" | "requests"> {
  steps: StepRecord[];
  network: NetworkRecord[];
}

export type ServerEvent =
  | { type: "status"; projectId: string; state: BotState }
  | { type: "log"; projectId: string; entry: LogEntry }
  | { type: "trace"; projectId: string; nodeId: string; at: number }
  | { type: "run"; projectId: string; run: RunSummary }
  | { type: "step"; projectId: string; runId: string; step: StepRecord }
  | { type: "net"; projectId: string; entry: NetworkRecord };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly diagnostics: Diagnostic[] = [],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "x-sila-request": "1",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload.error ?? {};
    throw new ApiError(response.status, error.message ?? `Request failed (${response.status})`, error.diagnostics);
  }
  return payload as T;
}

export const api = {
  session: () => request<{ kind: string; version: string }>("GET", "/session"),
  nodes: () => request<NodeInfo[]>("GET", "/nodes"),
  projects: () => request<ProjectListItem[]>("GET", "/projects"),
  project: (id: string) => request<Project>("GET", `/projects/${id}`),
  importProject: (document: unknown) =>
    request<{ project: Project; diagnostics: Diagnostic[] }>("POST", "/projects/import", document),
  createProject: (input: { name: string; description: string; platform: Platform; flow?: Flow }) =>
    request<Project>("POST", "/projects", input),
  updateProject: (id: string, patch: { name?: string; description?: string; flow?: Flow }) =>
    request<{ project: Project; diagnostics: Diagnostic[] }>("PATCH", `/projects/${id}`, patch),
  deleteProject: (id: string) => request<void>("DELETE", `/projects/${id}`),
  code: (id: string) => request<CompileResult>("GET", `/projects/${id}/code`),
  secrets: (id: string) => request<SecretInfo[]>("GET", `/projects/${id}/secrets`),
  setSecret: (id: string, name: string, value: string) =>
    request<void>("PUT", `/projects/${id}/secrets/${encodeURIComponent(name)}`, { value }),
  deleteSecret: (id: string, name: string) => request<void>("DELETE", `/projects/${id}/secrets/${encodeURIComponent(name)}`),
  bot: (id: string) => request<BotStatus>("GET", `/projects/${id}/bot`),
  runs: (id: string) => request<{ runs: RunSummary[]; latest: Record<string, StepRecord> }>("GET", `/projects/${id}/runs`),
  run: (id: string, runId: string) => request<RunRecord>("GET", `/projects/${id}/runs/${runId}`),
  clearRuns: (id: string) => request<void>("DELETE", `/projects/${id}/runs`),
  network: (id: string) => request<NetworkRecord[]>("GET", `/projects/${id}/network`),
  startBot: (id: string) => request<BotStatus>("POST", `/projects/${id}/bot/start`),
  stopBot: (id: string) => request<BotStatus>("POST", `/projects/${id}/bot/stop`),
  versions: (id: string) => request<VersionInfo[]>("GET", `/projects/${id}/versions`),
  saveVersion: (id: string, label: string) => request<VersionInfo>("POST", `/projects/${id}/versions`, { label }),
  restoreVersion: (id: string, versionId: string) =>
    request<{ project: Project; diagnostics: Diagnostic[] }>("POST", `/projects/${id}/versions/${versionId}/restore`),
  runManual: (id: string, nodeId: string, payload: unknown) => request<{ sent: boolean }>("POST", `/projects/${id}/bot/run`, { nodeId, payload }),
  keys: () => request<ApiKey[]>("GET", "/keys"),
  createKey: (name: string, scope: "read" | "write") => request<ApiKey & { secret: string }>("POST", "/keys", { name, scope }),
  deleteKey: (id: string) => request<void>("DELETE", `/keys/${id}`),
  logout: () => fetch("/logout", { method: "POST", credentials: "same-origin" }),
};

export function exportUrl(id: string, format: "zip" | "json" = "zip"): string {
  return `/api/v1/projects/${id}/export${format === "json" ? "?format=json" : ""}`;
}

export function subscribe(onEvent: (event: ServerEvent) => void, onConnection?: (connected: boolean) => void): () => void {
  let socket: WebSocket | undefined;
  let closed = false;
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${protocol}://${location.host}/api/v1/events`);
    socket.onopen = () => {
      attempts = 0;
      onConnection?.(true);
    };
    socket.onmessage = (message) => onEvent(JSON.parse(String(message.data)) as ServerEvent);
    socket.onclose = () => {
      if (closed) return;
      onConnection?.(false);
      retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts));
      attempts += 1;
    };
  };

  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    socket?.close();
  };
}
