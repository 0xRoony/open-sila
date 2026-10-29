import { Blocks, Database, History, ListTree, Settings } from "lucide-react";
import { linkHandler } from "../router";
import { setPreferences, usePreferences, type Preferences } from "../preferences";

const VIEWS: { view: Preferences["sidebarView"]; label: string; keys: string; icon: typeof Blocks }[] = [
  { view: "nodes", label: "Nodes", keys: "Ctrl+B", icon: Blocks },
  { view: "outline", label: "Outline", keys: "Ctrl+Shift+O", icon: ListTree },
  { view: "data", label: "Data", keys: "Ctrl+Shift+D", icon: Database },
  { view: "history", label: "History", keys: "Ctrl+Shift+H", icon: History },
];

export function openSidebar(view: Preferences["sidebarView"]): void {
  setPreferences(({ showPalette, sidebarView }) =>
    showPalette && sidebarView === view ? { showPalette: false } : { showPalette: true, sidebarView: view },
  );
}

export function ActivityBar({ issues }: { issues: number }) {
  const { showPalette, sidebarView } = usePreferences();
  return (
    <nav className="activity-bar" aria-label="Sidebar views">
      {VIEWS.map(({ view, label, keys, icon: Icon }) => {
        const active = showPalette && sidebarView === view;
        return (
          <button
            key={view}
            className={`activity ${active ? "active" : ""}`}
            onClick={() => openSidebar(view)}
            aria-pressed={active}
            aria-label={label}
            title={`${label} (${keys})`}
          >
            <Icon size={20} strokeWidth={1.8} />
            {view === "outline" && issues > 0 && <span className="activity-badge">{issues}</span>}
          </button>
        );
      })}
      <span className="grow" />
      <a href="/settings#editor" className="activity" onClick={linkHandler("/settings#editor")} aria-label="Editor settings" title="Editor settings">
        <Settings size={20} strokeWidth={1.8} />
      </a>
    </nav>
  );
}
