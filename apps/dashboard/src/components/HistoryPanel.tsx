import type { Flow } from "@open-sila/core";
import { History, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type VersionInfo } from "../api";

interface Props {
  projectId: string;
  onBeforeSave: () => Promise<void>;
  onRestore: (flow: Flow) => void;
}

function when(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function HistoryPanel({ projectId, onBeforeSave, onRestore }: Props) {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => void api.versions(projectId).then(setVersions), [projectId]);
  useEffect(load, [load]);

  const save = async () => {
    setBusy(true);
    await onBeforeSave();
    await api.saveVersion(projectId, label);
    setLabel("");
    setBusy(false);
    load();
  };

  const restore = async (id: string) => {
    if (!confirm("Replace the current flow with this version? The current flow is saved as a version first.")) return;
    setBusy(true);
    await onBeforeSave();
    const result = await api.restoreVersion(projectId, id);
    onRestore(result.project.flow);
    setBusy(false);
    load();
  };

  return (
    <div className="history-panel">
      <form
        className="history-save"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <input placeholder="Name this version" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
        <button className="button small" disabled={busy}>
          <Save size={13} /> Save
        </button>
      </form>
      <p className="muted small">A version is also saved each time you start the bot. The last 50 are kept.</p>
      {versions.length === 0 && (
        <div className="data-empty">
          <History size={24} />
          <p>No versions yet.</p>
        </div>
      )}
      <ul className="history-list">
        {versions.map((version) => (
          <li key={version.id}>
            <div>
              <strong>{version.label}</strong>
              <small className="muted">
                {when(version.createdAt)} · {version.nodes} {version.nodes === 1 ? "node" : "nodes"}
              </small>
            </div>
            <button className="icon-button small" disabled={busy} onClick={() => void restore(version.id)} aria-label={`Restore ${version.label}`} title="Restore">
              <RotateCcw size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
