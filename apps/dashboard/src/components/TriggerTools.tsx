import { Copy, Play } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import type { SilaNode } from "../flow";

interface Props {
  projectId: string;
  node: SilaNode;
  live: boolean;
  port: number | null;
  onSave: () => Promise<void>;
}

export function TriggerTools({ projectId, node, live, port, onSave }: Props) {
  const [message, setMessage] = useState("");
  const values = node.data.values;

  if (node.data.kind === "core.manual") {
    const run = async () => {
      let payload: unknown = null;
      const raw = String(values.payload ?? "").trim();
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch (error) {
        return setMessage(`The sample payload is not valid JSON: ${(error as Error).message}`);
      }
      await onSave();
      try {
        await api.runManual(projectId, node.id, payload);
        setMessage("Sent. Open the Runs tab to follow it.");
      } catch (error) {
        setMessage((error as Error).message);
      }
    };
    return (
      <div className="form trigger-tools">
        <button className="button primary" onClick={run} disabled={!live} title={live ? "Run this flow now" : "Start the bot first"}>
          <Play size={14} /> Run now
        </button>
        <small className="muted">{live ? message || "Runs this flow in the running bot with the sample payload." : "Start the bot, then press Run now."}</small>
      </div>
    );
  }

  if (node.data.kind === "core.webhook") {
    const url = port ? `http://localhost:${port}${String(values.path ?? "")}` : "";
    return (
      <div className="form trigger-tools">
        <span className="field-label">Local URL</span>
        {url ? (
          <div className="copy-row">
            <code>{url}</code>
            <button className="icon-button small" aria-label="Copy URL" onClick={() => void navigator.clipboard.writeText(url)}>
              <Copy size={13} />
            </button>
          </div>
        ) : (
          <small className="muted">Start the bot to get a local URL. In production the bot listens on PORT.</small>
        )}
        {url && <small className="muted">Other services need a public address; use a tunnel such as cloudflared or deploy the bot.</small>}
      </div>
    );
  }

  return null;
}
