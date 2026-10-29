import { randomUUID } from "node:crypto";

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

export interface RunRecord {
  id: string;
  triggerId: string;
  label: string;
  startedAt: number;
  ms: number | null;
  status: RunStatus;
  error?: string;
  steps: StepRecord[];
  network: NetworkRecord[];
}

export type RunSummary = Omit<RunRecord, "steps" | "network"> & { steps: number; requests: number };

export type RunEvent =
  | { type: "run"; run: RunSummary }
  | { type: "step"; runId: string; step: StepRecord }
  | { type: "net"; entry: NetworkRecord };

const MAX_RUNS = 200;
const MAX_STEPS = 300;
const MAX_NETWORK = 300;

export interface TraceMessage {
  type?: string;
  runId?: string | null;
  triggerId?: string;
  label?: string;
  nodeId?: string | null;
  at?: number;
  ms?: number | null;
  status?: string;
  inputs?: unknown;
  outputs?: unknown;
  message?: string;
  source?: NetworkRecord["source"];
  method?: string;
  url?: string;
  request?: unknown;
  response?: unknown;
  error?: string;
}

export function summarize(run: RunRecord): RunSummary {
  const { steps, network, ...rest } = run;
  return { ...rest, steps: steps.length, requests: network.length };
}

class ProjectRuns {
  readonly runs = new Map<string, RunRecord>();
  readonly network: NetworkRecord[] = [];

  add(run: RunRecord): void {
    this.runs.set(run.id, run);
    if (this.runs.size > MAX_RUNS) this.runs.delete(this.runs.keys().next().value as string);
  }
}

export class RunLog {
  private projects = new Map<string, ProjectRuns>();

  private project(projectId: string): ProjectRuns {
    let entry = this.projects.get(projectId);
    if (!entry) {
      entry = new ProjectRuns();
      this.projects.set(projectId, entry);
    }
    return entry;
  }

  list(projectId: string): RunSummary[] {
    return [...this.project(projectId).runs.values()].reverse().map(summarize);
  }

  get(projectId: string, runId: string): RunRecord | undefined {
    return this.project(projectId).runs.get(runId);
  }

  network(projectId: string): NetworkRecord[] {
    return [...this.project(projectId).network].reverse();
  }

  latestSteps(projectId: string): Record<string, StepRecord> {
    const latest: Record<string, StepRecord> = {};
    for (const run of this.project(projectId).runs.values()) {
      for (const step of run.steps) latest[step.nodeId] = step;
    }
    return latest;
  }

  clear(projectId: string): void {
    this.projects.delete(projectId);
  }

  stopAll(projectId: string, reason: string): RunEvent[] {
    const events: RunEvent[] = [];
    for (const run of this.project(projectId).runs.values()) {
      if (run.status !== "running") continue;
      run.status = "error";
      run.error = reason;
      events.push({ type: "run", run: summarize(run) });
    }
    return events;
  }

  handle(projectId: string, message: TraceMessage): RunEvent[] {
    const project = this.project(projectId);
    const run = message.runId ? project.runs.get(message.runId) : undefined;

    switch (message.type) {
      case "run:start": {
        if (!message.runId) return [];
        const record: RunRecord = {
          id: message.runId,
          triggerId: message.triggerId ?? "",
          label: message.label ?? "Run",
          startedAt: message.at ?? Date.now(),
          ms: null,
          status: "running",
          steps: [{ nodeId: message.triggerId ?? "", startedAt: message.at ?? Date.now(), ms: 0, status: "ok" }],
          network: [],
        };
        project.add(record);
        return [{ type: "run", run: summarize(record) }];
      }
      case "step": {
        if (!run || !message.nodeId || run.steps.length >= MAX_STEPS) return [];
        const step: StepRecord = { nodeId: message.nodeId, startedAt: message.at ?? Date.now(), ms: null, status: "running", inputs: message.inputs };
        run.steps.push(step);
        return [{ type: "step", runId: run.id, step }];
      }
      case "done": {
        if (!run || !message.nodeId) return [];
        const step = [...run.steps].reverse().find((item) => item.nodeId === message.nodeId);
        if (!step) return [];
        step.status = "ok";
        step.ms = message.ms ?? null;
        const outputs = message.outputs as Record<string, unknown> | undefined;
        if (outputs && typeof outputs === "object" && "path" in outputs && Object.keys(outputs).length === 1) step.path = String(outputs.path);
        else step.outputs = outputs;
        return [{ type: "step", runId: run.id, step }];
      }
      case "error": {
        if (!run) return [];
        run.status = "error";
        run.error = message.message;
        const step = [...run.steps].reverse().find((item) => item.nodeId === message.nodeId);
        if (step) {
          step.status = "error";
          step.error = message.message;
          return [{ type: "step", runId: run.id, step }, { type: "run", run: summarize(run) }];
        }
        return [{ type: "run", run: summarize(run) }];
      }
      case "run:end": {
        if (!run) return [];
        run.ms = message.ms ?? null;
        if (run.status === "running") run.status = message.status === "error" ? "error" : "ok";
        return [{ type: "run", run: summarize(run) }];
      }
      case "net": {
        const entry: NetworkRecord = {
          id: randomUUID(),
          runId: message.runId ?? null,
          nodeId: message.nodeId ?? null,
          at: message.at ?? Date.now(),
          source: message.source ?? "http",
          method: message.method ?? "GET",
          url: message.url ?? "",
          status: Number(message.status ?? 0),
          ms: message.ms ?? null,
          request: message.request,
          response: message.response,
          error: message.error,
        };
        project.network.push(entry);
        if (project.network.length > MAX_NETWORK) project.network.splice(0, project.network.length - MAX_NETWORK);
        if (run && run.network.length < MAX_NETWORK) run.network.push(entry);
        return [{ type: "net", entry }];
      }
      default:
        return [];
    }
  }
}
