import { CircleCheck, CircleX, Globe, LoaderCircle } from "lucide-react";
import type { NetworkRecord, RunRecord, RunStatus, RunSummary, StepRecord } from "../api";
import { JsonView } from "./JsonView";

export function StatusIcon({ status }: { status: RunStatus }) {
  if (status === "running") return <LoaderCircle size={13} className="run-running" />;
  if (status === "error") return <CircleX size={13} className="run-error" />;
  return <CircleCheck size={13} className="run-ok" />;
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "…";
  return ms < 1 ? "<1 ms" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString();
}

interface Props {
  runs: RunSummary[];
  selected: RunRecord | null;
  nodeLabel: (nodeId: string) => string;
  onSelectRun: (runId: string) => void;
  onSelectNode: (nodeId: string) => void;
}

function Step({ step, label, network, onSelectNode }: { step: StepRecord; label: string; network: NetworkRecord[]; onSelectNode: () => void }) {
  return (
    <details className={`step step-${step.status}`} open={step.status === "error"}>
      <summary>
        <StatusIcon status={step.status} />
        <button className="link" onClick={(event) => (event.preventDefault(), onSelectNode())}>
          {label}
        </button>
        {step.path && <span className="step-path">→ {step.path}</span>}
        {network.length > 0 && (
          <span className="step-net">
            <Globe size={11} /> {network.length}
          </span>
        )}
        <span className="grow" />
        <span className="muted">{duration(step.ms)}</span>
      </summary>
      <div className="step-body">
        {step.error && <p className="error">{step.error}</p>}
        <div className="step-columns">
          <div>
            <h5>Inputs</h5>
            <JsonView value={step.inputs} empty="No inputs" />
          </div>
          <div>
            <h5>Outputs</h5>
            <JsonView value={step.outputs} empty={step.status === "running" ? "Still running" : "No outputs"} />
          </div>
        </div>
        {network.map((entry) => (
          <div key={entry.id} className="step-request">
            <span className={`http-status status-${Math.floor(entry.status / 100)}`}>{entry.status || "ERR"}</span>
            <code>
              {entry.method} {entry.url}
            </code>
          </div>
        ))}
      </div>
    </details>
  );
}

export function RunsPanel({ runs, selected, nodeLabel, onSelectRun, onSelectNode }: Props) {
  if (runs.length === 0) {
    return <p className="muted panel-empty">No runs yet. Start the bot and trigger a command or event; each one appears here with every node's inputs and outputs.</p>;
  }
  return (
    <div className="runs-layout">
      <div className="runs-list" role="listbox" aria-label="Runs">
        {runs.map((run) => (
          <button
            key={run.id}
            role="option"
            aria-selected={selected?.id === run.id}
            className={`run-item ${selected?.id === run.id ? "active" : ""}`}
            onClick={() => onSelectRun(run.id)}
          >
            <StatusIcon status={run.status} />
            <span className="run-label">{run.label}</span>
            <span className="muted">{duration(run.ms)}</span>
            <span className="muted run-time">{time(run.startedAt)}</span>
          </button>
        ))}
      </div>
      <div className="run-detail">
        {!selected ? (
          <p className="muted panel-empty">Select a run to see what each node received and produced.</p>
        ) : (
          <>
            <header className="run-head">
              <StatusIcon status={selected.status} />
              <strong>{selected.label}</strong>
              <span className="muted">
                {time(selected.startedAt)} · {duration(selected.ms)} · {selected.steps.length} steps · {selected.network.length} requests
              </span>
            </header>
            {selected.error && <p className="error">{selected.error}</p>}
            {selected.steps.map((step, index) => (
              <Step
                key={`${step.nodeId}-${index}`}
                step={step}
                label={nodeLabel(step.nodeId)}
                network={selected.network.filter((entry) => entry.nodeId === step.nodeId)}
                onSelectNode={() => onSelectNode(step.nodeId)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export function NetworkPanel({ entries, nodeLabel, onSelectNode }: { entries: NetworkRecord[]; nodeLabel: (nodeId: string) => string; onSelectNode: (nodeId: string) => void }) {
  if (entries.length === 0) {
    return <p className="muted panel-empty">No requests yet. HTTP requests, webhooks and Discord or Telegram API calls made by the bot appear here.</p>;
  }
  return (
    <div className="network-list">
      <div className="network-row head">
        <span>Status</span>
        <span>Source</span>
        <span>Request</span>
        <span>Node</span>
        <span>Time</span>
      </div>
      {entries.map((entry) => (
        <details key={entry.id} className="network-entry">
          <summary className="network-row">
            <span className={`http-status status-${Math.floor(entry.status / 100)}`}>{entry.status || "ERR"}</span>
            <span className={`net-source source-${entry.source}`}>{entry.source}</span>
            <code className="net-url">
              {entry.method} {entry.url}
            </code>
            <span>
              {entry.nodeId ? (
                <button className="link" onClick={(event) => (event.preventDefault(), onSelectNode(entry.nodeId as string))}>
                  {nodeLabel(entry.nodeId)}
                </button>
              ) : (
                <span className="muted">-</span>
              )}
            </span>
            <span className="muted">{duration(entry.ms)}</span>
          </summary>
          <div className="step-body">
            {entry.error && <p className="error">{entry.error}</p>}
            <div className="step-columns">
              <div>
                <h5>Request body</h5>
                <JsonView value={entry.request ?? undefined} empty="No body" />
              </div>
              <div>
                <h5>Response</h5>
                <JsonView value={entry.response ?? undefined} empty="No body" />
              </div>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
