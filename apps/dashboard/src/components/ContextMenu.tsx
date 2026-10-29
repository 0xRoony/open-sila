import { listNodes, type Platform } from "@open-sila/core";
import { Search, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { nodeIcon } from "../icons";

export interface MenuAction {
  label: string;
  icon?: LucideIcon;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export type MenuEntry = MenuAction | "separator";

interface Props {
  x: number;
  y: number;
  title?: string;
  items: MenuEntry[];
  addNodes?: { platform: Platform; onAdd: (type: string) => void };
  onClose: () => void;
}

export function ContextMenu({ x, y, title, items, addNodes, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [query, setQuery] = useState("");

  useLayoutEffect(() => {
    const menu = root.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, innerHeight - height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const close = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    addEventListener("pointerdown", close, true);
    addEventListener("keydown", onKey);
    addEventListener("blur", onClose);
    return () => {
      removeEventListener("pointerdown", close, true);
      removeEventListener("keydown", onKey);
      removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const matches = useMemo(() => {
    if (!addNodes) return [];
    const term = query.trim().toLowerCase();
    return listNodes(addNodes.platform)
      .filter((node) => !term || node.label.toLowerCase().includes(term) || node.description.toLowerCase().includes(term))
      .slice(0, term ? 8 : 6);
  }, [addNodes, query]);

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div className="menu context-menu" style={position} ref={root} role="menu" onContextMenu={(event) => event.preventDefault()}>
      {title && <div className="menu-label">{title}</div>}
      {addNodes && (
        <>
          <div className="search-box menu-search">
            <Search size={14} />
            <input
              id="context-search"
              autoFocus
              placeholder="Add a node…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches[0]) run(() => addNodes.onAdd(matches[0].type));
              }}
            />
          </div>
          {matches.map((node) => {
            const Icon = nodeIcon(node.icon, node.category);
            return (
              <button key={node.type} className={`menu-item category-${node.category}`} role="menuitem" onClick={() => run(() => addNodes.onAdd(node.type))}>
                <span className="node-icon small">
                  <Icon size={12} />
                </span>
                {node.label}
              </button>
            );
          })}
          {matches.length === 0 && <div className="menu-empty">No nodes match.</div>}
          {items.length > 0 && <div className="menu-separator" />}
        </>
      )}
      {items.map((item, index) =>
        item === "separator" ? (
          <div key={`separator-${index}`} className="menu-separator" />
        ) : (
          <button
            key={item.label}
            className={`menu-item ${item.danger ? "danger" : ""}`}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => run(item.onSelect)}
          >
            {item.icon ? <item.icon size={14} /> : <span style={{ width: 14 }} />}
            {item.label}
            {item.keys && <kbd>{item.keys}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
