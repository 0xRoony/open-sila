import type { CompileResult } from "@open-sila/core";
import { Check, ChevronRight, Copy, Download, FileDown } from "lucide-react";
import { useMemo, useState } from "react";
import { highlight } from "../highlight";
import { exportUrl } from "../api";
import { Dialog } from "./Dialog";
import { FileTree } from "./FileTree";

export function CodeDialog({ projectId, result, onClose }: { projectId: string; result: CompileResult; onClose: () => void }) {
  const files = result.files;
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const [path, setPath] = useState(files.find((file) => file.path.startsWith("src/handlers/") && !file.path.endsWith("index.js"))?.path ?? files[0]?.path);
  const [copied, setCopied] = useState(false);
  const current = files.find((file) => file.path === path);
  const tokens = useMemo(() => (current ? highlight(current.path, current.content) : []), [current]);
  const lineCount = current ? current.content.split("\n").length : 0;

  const copy = async () => {
    if (!current) return;
    await navigator.clipboard.writeText(current.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    if (!current) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([current.content], { type: "text/plain" }));
    link.download = current.path.split("/").pop() ?? "file.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <Dialog title="Generated code" onClose={onClose} wide>
      {!result.ok ? (
        <p className="error">Fix the problems in the flow to see the generated code.</p>
      ) : (
        <div className="code-view">
          <FileTree paths={paths} selected={path} onSelect={setPath} />
          <div className="code-pane">
            <div className="code-toolbar">
              <span className="code-crumbs">
                {(path ?? "").split("/").map((part, index, parts) => (
                  <span key={index} className={index === parts.length - 1 ? "current" : ""}>
                    {index > 0 && <ChevronRight size={12} />}
                    {part}
                  </span>
                ))}
              </span>
              <span className="muted small">{lineCount} lines</span>
              <button className="icon-button small" onClick={copy} aria-label="Copy file" title="Copy file">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button className="icon-button small" onClick={download} aria-label="Download file" title="Download this file">
                <FileDown size={14} />
              </button>
            </div>
            <pre className="code-block" key={path}>
              <span className="code-lines" aria-hidden="true">
                {Array.from({ length: lineCount }, (_, index) => `${index + 1}\n`).join("")}
              </span>
              <code>
                {tokens.map((token, index) =>
                  token.type === "plain" ? (
                    token.text
                  ) : (
                    <span key={index} className={`tok-${token.type}`}>
                      {token.text}
                    </span>
                  ),
                )}
              </code>
            </pre>
          </div>
        </div>
      )}
      <div className="row between">
        <span className="muted small">
          {result.requirements.intents.length > 0 && <>Intents: {result.requirements.intents.join(", ")}. </>}
          Environment: {result.requirements.env.join(", ")}
        </span>
        {result.ok && (
          <a className="button primary" href={exportUrl(projectId)} download>
            <Download size={14} /> Download ZIP
          </a>
        )}
      </div>
    </Dialog>
  );
}
