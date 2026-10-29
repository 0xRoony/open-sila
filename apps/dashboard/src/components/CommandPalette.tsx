import { Search, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  keys?: string;
  icon?: LucideIcon;
  run: () => void;
}

function matches(command: Command, words: string[]): boolean {
  const text = `${command.group} ${command.label} ${command.hint ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((command) => matches(command, words)).slice(0, 80);
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(".command-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  return createPortal(
    <div className="command-overlay" onMouseDown={onClose}>
      <div className="command-palette" role="dialog" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="search-box">
          <Search size={15} />
          <input
            ref={input}
            placeholder="Type a command, a node to add, or a node to go to"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(results.length - 1, index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(results[active]);
              }
            }}
          />
        </div>
        <div className="command-list" ref={list} role="listbox">
          {results.length === 0 && <p className="muted small command-empty">Nothing matches “{query}”.</p>}
          {results.map((command, index) => {
            const Icon = command.icon;
            return (
              <button
                key={command.id}
                role="option"
                aria-selected={index === active}
                className={`command-item ${index === active ? "active" : ""}`}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(command)}
              >
                <span className="command-group">{command.group}</span>
                {Icon && <Icon size={14} />}
                <span className="command-label">
                  {command.label}
                  {command.hint && <small className="muted">{command.hint}</small>}
                </span>
                {command.keys && <kbd>{command.keys}</kbd>}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
