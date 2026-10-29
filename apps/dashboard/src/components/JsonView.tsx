import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

function Leaf({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="json-null">null</span>;
  if (typeof value === "string") return <span className="json-string">"{value}"</span>;
  if (typeof value === "number") return <span className="json-number">{value}</span>;
  if (typeof value === "boolean") return <span className="json-boolean">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function Node({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const branch = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 2);
  const label = name !== undefined && <span className="json-key">{name}: </span>;

  if (!branch) {
    return (
      <div className="json-row">
        {label}
        <Leaf value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value as object);
  const type = !Array.isArray(value) && (value as { $type?: string }).$type;
  const summary = Array.isArray(value) ? `[${entries.length}]` : type ? type : `{${entries.length}}`;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="json-branch">
      <button className="json-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Chevron size={11} />
        {label}
        <span className="json-summary">{summary}</span>
      </button>
      {open && (
        <div className="json-children">
          {entries
            .filter(([key]) => key !== "$type")
            .map(([key, item]) => (
              <Node key={key} name={key} value={item} depth={depth + 1} />
            ))}
        </div>
      )}
    </div>
  );
}

export function JsonView({ value, empty = "No data" }: { value: unknown; empty?: string }) {
  if (value === undefined || (value && typeof value === "object" && Object.keys(value as object).length === 0)) {
    return <p className="muted small">{empty}</p>;
  }
  return (
    <div className="json-view">
      <Node value={value} depth={0} />
    </div>
  );
}

export function preview(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value.length > 40 ? `"${value.slice(0, 40)}…"` : `"${value}"`;
  if (typeof value !== "object") return String(value);
  const typed = value as { $type?: string; name?: unknown; username?: unknown; id?: unknown };
  if (typed.$type) return `${typed.$type}${typed.username ?? typed.name ?? typed.id ? ` ${String(typed.username ?? typed.name ?? typed.id)}` : ""}`;
  if (Array.isArray(value)) return `[${value.length} items]`;
  return `{${Object.keys(value).slice(0, 3).join(", ")}${Object.keys(value).length > 3 ? ", …" : ""}}`;
}
