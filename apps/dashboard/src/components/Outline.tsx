import { getNode, type Category } from "@open-sila/core";
import type { Edge } from "@xyflow/react";
import { CircleX, Search, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import type { SilaNode } from "../flow";
import { nodeIcon } from "../icons";

interface Props {
  nodes: SilaNode[];
  edges: Edge[];
  issues: Map<string, "error" | "warning">;
  onSelect: (id: string) => void;
}

interface Row {
  node: SilaNode;
  depth: number;
}

function label(node: SilaNode): string {
  const values = node.data.values;
  const text = values.name ?? values.customId ?? values.text ?? values.key ?? values.title ?? "";
  const first = String(text).split("\n")[0];
  return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}

export function Outline({ nodes, edges, issues, onSelect }: Props) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const next = new Map<string, string[]>();
    for (const edge of edges) next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const seen = new Set<string>();
    const result: Row[] = [];
    const visit = (id: string, depth: number) => {
      const node = byId.get(id);
      if (!node || seen.has(id)) return;
      seen.add(id);
      result.push({ node, depth });
      for (const target of next.get(id) ?? []) visit(target, depth + 1);
    };
    const triggers = nodes.filter((node) => getNode(node.data.kind)?.category === "trigger").sort((a, b) => a.position.y - b.position.y);
    for (const trigger of triggers) visit(trigger.id, 0);
    const loose = nodes.filter((node) => !seen.has(node.id));
    return { connected: result, loose };
  }, [nodes, edges]);

  const term = query.trim().toLowerCase();
  const matches = (node: SilaNode) => {
    if (!term) return true;
    const definition = getNode(node.data.kind);
    return `${definition?.label ?? ""} ${label(node)}`.toLowerCase().includes(term);
  };

  const item = ({ node, depth }: Row) => {
    const definition = getNode(node.data.kind);
    const category: Category = definition?.category ?? "action";
    const Icon = nodeIcon(definition?.icon, category);
    const issue = issues.get(node.id);
    return (
      <button
        key={node.id}
        className={`outline-item category-${category} ${node.selected ? "selected" : ""}`}
        style={{ paddingLeft: 8 + Math.min(depth, 6) * 14 }}
        onClick={() => onSelect(node.id)}
      >
        <span className="node-icon small">
          <Icon size={12} />
        </span>
        <span className="outline-text">
          <strong>{definition?.label ?? node.data.kind}</strong>
          {label(node) && <small>{label(node)}</small>}
        </span>
        {issue === "error" && <CircleX size={13} className="issue-error-icon" />}
        {issue === "warning" && <TriangleAlert size={13} className="issue-warning-icon" />}
      </button>
    );
  };

  const connected = rows.connected.filter((row) => matches(row.node));
  const loose = rows.loose.filter(matches);

  return (
    <div className="outline">
      <div className="search-box">
        <Search size={14} />
        <input id="outline-search" placeholder="Find in this flow" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {nodes.length === 0 && <p className="muted small">The flow is empty. Add a trigger from the Nodes view.</p>}
      {connected.length > 0 && (
        <section>
          <h4 className="section-title">Flows</h4>
          {connected.map(item)}
        </section>
      )}
      {loose.length > 0 && (
        <section>
          <h4 className="section-title">Values and unconnected nodes</h4>
          {loose.map((node) => item({ node, depth: 0 }))}
        </section>
      )}
    </div>
  );
}
