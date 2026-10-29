import { ChevronsLeft } from "lucide-react";
import type { ReactNode } from "react";
import { setPreferences } from "../preferences";

export function Sidebar({ title, width, children }: { title: string; width: number; children: ReactNode }) {
  return (
    <aside className="sidebar side-panel" style={{ width }} aria-label={title}>
      <header className="side-head">
        <h4>{title}</h4>
        <button className="icon-button" onClick={() => setPreferences({ showPalette: false })} aria-label="Hide sidebar" title="Hide sidebar (Ctrl+B)">
          <ChevronsLeft size={15} />
        </button>
      </header>
      <div className="side-body">{children}</div>
    </aside>
  );
}
