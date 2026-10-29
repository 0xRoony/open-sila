import type { Diagnostic } from "@open-sila/core";
import { CircleAlert, CircleX, Download, Globe, History, ListX, Maximize2, Minimize2, Search, SquareTerminal, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LogEntry, NetworkRecord, RunRecord, RunSummary } from "../api";
import { setPreferences, usePreferences, type PanelTab } from "../preferences";
import { NetworkPanel, RunsPanel } from "./RunsPanel";

interface Props {
  height: number;
  logs: LogEntry[];
  diagnostics: Diagnostic[];
  runs: RunSummary[];
  selectedRun: RunRecord | null;
  network: NetworkRecord[];
  nodeLabel: (nodeId: string) => string;
  onSelectRun: (runId: string) => void;
  onSelectNode: (id: string) => void;
  onClear: (tab: PanelTab) => void;
}

const LEVELS = ["all", "info", "error", "system"] as const;

export function ConsolePanel({ height, logs, diagnostics, runs, selectedRun, network, nodeLabel, onSelectRun, onSelectNode, onClear }: Props) {
  const { panelTab: tab, panelMaximized } = usePreferences();
  const body = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("all");
  const [query, setQuery] = useState("");
  const errors = diagnostics.filter((item) => item.level === "error").length;
  const failedRuns = runs.filter((run) => run.status === "error").length;

  const visibleLogs = useMemo(() => {
    const term = query.trim().toLowerCase();
    return logs.filter((entry) => (level === "all" || entry.level === level) && (!term || entry.message.toLowerCase().includes(term)));
  }, [logs, level, query]);

  useEffect(() => {
    if (tab === "console" && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [visibleLogs.length, tab]);

  const exportLogs = () => {
    const text = logs.map((entry) => `${new Date(entry.at).toISOString()} [${entry.level}] ${entry.message}`).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    link.download = "bot-console.log";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const tabButton = (id: PanelTab, label: string, icon: ReactNode, badge?: ReactNode) => (
    <button className={`tab ${tab === id ? "active" : ""}`} onClick={() => setPreferences({ panelTab: id })} title={label} aria-label={label}>
      {icon}
      <span className="tab-label">{label}</span>
      {badge}
    </button>
  );

  return (
    <section className={`panel-bottom ${panelMaximized ? "maximized" : ""}`} style={panelMaximized ? undefined : { height }} aria-label="Bottom panel">
      <header>
        {tabButton("console", "Console", <SquareTerminal size={14} />, logs.length > 0 && <span className="count neutral">{logs.length}</span>)}
        {tabButton(
          "runs",
          "Runs",
          <History size={14} />,
          runs.length > 0 && <span className={`count ${failedRuns > 0 ? "error" : "neutral"}`}>{failedRuns > 0 ? failedRuns : runs.length}</span>,
        )}
        {tabButton("network", "Network", <Globe size={14} />, network.length > 0 && <span className="count neutral">{network.length}</span>)}
        {tabButton(
          "problems",
          "Problems",
          <CircleAlert size={14} />,
          diagnostics.length > 0 && <span className={`count ${errors > 0 ? "error" : "warning"}`}>{diagnostics.length}</span>,
        )}
        <span className="grow" />
        {tab === "console" && (
          <>
            <div className="search-box panel-search">
              <Search size={13} />
              <input id="console-search" placeholder="Filter" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <select id="console-level" value={level} onChange={(event) => setLevel(event.target.value as typeof level)} aria-label="Level">
              {LEVELS.map((item) => (
                <option key={item} value={item}>
                  {item === "all" ? "All levels" : item}
                </option>
              ))}
            </select>
            <button className="icon-button" onClick={exportLogs} aria-label="Download console log" title="Download console log" disabled={logs.length === 0}>
              <Download size={14} />
            </button>
          </>
        )}
        {tab !== "problems" && (
          <button className="icon-button" onClick={() => onClear(tab)} aria-label={`Clear ${tab}`} title={`Clear ${tab}`}>
            <ListX size={15} />
          </button>
        )}
        <button
          className="icon-button"
          onClick={() => setPreferences({ panelMaximized: !panelMaximized })}
          aria-label={panelMaximized ? "Restore panel size" : "Maximize panel"}
          title={panelMaximized ? "Restore panel size" : "Maximize panel"}
        >
          {panelMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button className="icon-button" onClick={() => setPreferences({ showConsole: false })} aria-label="Close panel" title="Close panel (Ctrl+J)">
          <X size={15} />
        </button>
      </header>
      <div key={tab} className={`panel-body ${tab === "runs" || tab === "network" ? "flush" : ""}`} ref={body}>
        {tab === "console" &&
          (visibleLogs.length === 0 ? (
            <p className="muted">{logs.length === 0 ? "Press Run to start the bot. Its output appears here." : "No lines match the filter."}</p>
          ) : (
            visibleLogs.map((entry, index) => (
              <div key={index} className={`log log-${entry.level}`}>
                <time>{new Date(entry.at).toLocaleTimeString()}</time>
                <span>{entry.message}</span>
                {entry.nodeId && (
                  <button className="link" onClick={() => onSelectNode(entry.nodeId as string)}>
                    Show node
                  </button>
                )}
              </div>
            ))
          ))}
        {tab === "runs" && (
          <RunsPanel runs={runs} selected={selectedRun} nodeLabel={nodeLabel} onSelectRun={onSelectRun} onSelectNode={onSelectNode} />
        )}
        {tab === "network" && <NetworkPanel entries={network} nodeLabel={nodeLabel} onSelectNode={onSelectNode} />}
        {tab === "problems" &&
          (diagnostics.length === 0 ? (
            <p className="muted">No problems found.</p>
          ) : (
            diagnostics.map((item, index) => (
              <button
                key={index}
                className={`problem problem-${item.level}`}
                onClick={() => item.nodeId && onSelectNode(item.nodeId)}
                disabled={!item.nodeId}
              >
                {item.level === "error" ? <CircleX size={14} /> : <TriangleAlert size={14} />}
                <span>{item.message}</span>
              </button>
            ))
          ))}
      </div>
    </section>
  );
}
