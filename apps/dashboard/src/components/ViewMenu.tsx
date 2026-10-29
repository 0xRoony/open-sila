import { Check, LayoutDashboard } from "lucide-react";
import { useRef, useState } from "react";
import { Popover } from "./Popover";
import { resetLayout, setPreferences, usePreferences, type EdgeStyle, type Preferences } from "../preferences";

const EDGE_STYLES: { value: EdgeStyle; label: string }[] = [
  { value: "default", label: "Curved" },
  { value: "smoothstep", label: "Rounded corners" },
  { value: "step", label: "Right angles" },
  { value: "straight", label: "Straight" },
];

type Toggle = keyof Pick<
  Preferences,
  "showPalette" | "showInspector" | "showConsole" | "showMinimap" | "showPortLabels" | "snapToGrid"
>;

const TOGGLES: { key: Toggle; label: string; keys?: string }[] = [
  { key: "showPalette", label: "Node list", keys: "Ctrl+B" },
  { key: "showInspector", label: "Inspector", keys: "Ctrl+." },
  { key: "showConsole", label: "Console", keys: "Ctrl+J" },
  { key: "showMinimap", label: "Minimap" },
  { key: "showPortLabels", label: "Port labels" },
  { key: "snapToGrid", label: "Snap to grid" },
];

interface Props {
  onArrange: () => void;
  onFit: () => void;
}

export function ViewMenu({ onArrange, onFit }: Props) {
  const [open, setOpen] = useState(false);
  const preferences = usePreferences();
  const button = useRef<HTMLButtonElement>(null);

  const run = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  return (
    <>
      <button
        ref={button}
        className={`button ghost ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <LayoutDashboard size={15} /> View
      </button>
      {open && (
        <Popover anchor={button} onClose={() => setOpen(false)}>
          <div className="menu-label">Panels</div>
          {TOGGLES.map(({ key, label, keys }) => (
            <button key={key} className="menu-item" role="menuitemcheckbox" aria-checked={preferences[key]} onClick={() => setPreferences({ [key]: !preferences[key] })}>
              {label}
              {keys && <kbd>{keys}</kbd>}
              {preferences[key] ? <Check size={14} className="check" /> : <span className="check" style={{ width: 14 }} />}
            </button>
          ))}
          <div className="menu-separator" />
          <div className="menu-label">Connections</div>
          {EDGE_STYLES.map(({ value, label }) => (
            <button key={value} className="menu-item" role="menuitemradio" aria-checked={preferences.edgeStyle === value} onClick={() => setPreferences({ edgeStyle: value })}>
              {label}
              {preferences.edgeStyle === value ? <Check size={14} className="check" /> : <span className="check" style={{ width: 14 }} />}
            </button>
          ))}
          <div className="menu-separator" />
          <button className="menu-item" onClick={run(onArrange)}>
            Arrange nodes <kbd>Shift+A</kbd>
          </button>
          <button className="menu-item" onClick={run(onFit)}>
            Fit to screen <kbd>Shift+1</kbd>
          </button>
          <button className="menu-item" onClick={run(resetLayout)}>
            Reset layout
          </button>
        </Popover>
      )}
    </>
  );
}
