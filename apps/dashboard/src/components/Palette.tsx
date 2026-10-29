import { listNodes, type Category, type NodeDefinition, type Platform } from "@open-sila/core";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useMemo, useRef, useState, type RefObject } from "react";
import { nodeIcon } from "../icons";
import { BrandIcon } from "./BrandIcon";
import { setPreferences, usePreferences } from "../preferences";

const GROUPS: { category: Category; label: string }[] = [
  { category: "trigger", label: "Triggers" },
  { category: "action", label: "Actions" },
  { category: "logic", label: "Logic" },
  { category: "data", label: "Data" },
  { category: "code", label: "Code" },
];

export const DRAG_TYPE = "application/x-sila-node";

interface Props {
  platform: Platform;
  searchRef?: RefObject<HTMLInputElement | null>;
  onAdd: (type: string) => void;
}

export function Palette({ platform, searchRef, onAdd }: Props) {
  const [query, setQuery] = useState("");
  const { collapsedGroups } = usePreferences();
  const fallbackRef = useRef<HTMLInputElement>(null);
  const nodes = useMemo(() => listNodes(platform), [platform]);
  const term = query.trim().toLowerCase();
  const matches = (node: NodeDefinition) =>
    !term || node.label.toLowerCase().includes(term) || node.description.toLowerCase().includes(term) || node.type.includes(term);
  const visible = nodes.filter(matches);

  const toggle = (category: string) =>
    setPreferences(({ collapsedGroups: current }) => ({
      collapsedGroups: current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    }));

  return (
    <div className="palette">
      <div className="search-box">
        <Search size={14} />
        <input
          id="palette-search"
          ref={searchRef ?? fallbackRef}
          placeholder="Search nodes  (Ctrl+K)"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && visible[0]) onAdd(visible[0].type);
            if (event.key === "Escape") setQuery("");
          }}
        />
      </div>
      <p className="palette-count">
        {term ? `${visible.length} of ${nodes.length} nodes match.` : `${nodes.length} nodes.`} Drag onto the canvas or click to add.
      </p>
      {GROUPS.map(({ category, label }) => {
        const items = visible.filter((node) => node.category === category);
        if (items.length === 0) return null;
        const collapsed = !term && collapsedGroups.includes(category);
        const Chevron = collapsed ? ChevronRight : ChevronDown;
        return (
          <section key={category} className={`category-${category}`}>
            <button className="group-title" onClick={() => toggle(category)} aria-expanded={!collapsed}>
              <Chevron size={13} />
              <i />
              {label}
              <span className="count">{items.length}</span>
            </button>
            {!collapsed &&
              items.map((node) => {
                const Icon = nodeIcon(node.icon, node.category);
                const only = node.platforms.length === 1 ? node.platforms[0] : undefined;
                return (
                  <button
                    key={node.type}
                    className={`palette-item category-${category}`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_TYPE, node.type);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => onAdd(node.type)}
                    title={node.description}
                  >
                    <span className="node-icon">
                      <Icon size={14} />
                    </span>
                    <span>
                      <strong>{node.label}</strong>
                      <small>{node.description}</small>
                    </span>
                    {only && (
                      <span className="palette-brand" title={`${only === "discord" ? "Discord" : "Telegram"} only`}>
                        <BrandIcon platform={only} size={11} colored={false} />
                      </span>
                    )}
                  </button>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}
