import { useEffect, useSyncExternalStore } from "react";

export type ThemeMode = "system" | "dark" | "light";
export type Density = "comfortable" | "compact";
export type PanelTab = "console" | "runs" | "network" | "problems";
export type EdgeStyle = "default" | "smoothstep" | "step" | "straight";

export interface Preferences {
  theme: ThemeMode;
  density: Density;
  edgeStyle: EdgeStyle;
  snapToGrid: boolean;
  showPalette: boolean;
  showInspector: boolean;
  showConsole: boolean;
  showMinimap: boolean;
  showPortLabels: boolean;
  paletteWidth: number;
  inspectorWidth: number;
  consoleHeight: number;
  collapsedGroups: string[];
  sidebarView: "nodes" | "outline" | "data" | "history";
  panelTab: PanelTab;
  panelMaximized: boolean;
  dragMode: "pan" | "select";
  projectView: "grid" | "list";
  projectSort: "updated" | "name" | "created";
}

export const DEFAULTS: Preferences = {
  theme: "system",
  density: "comfortable",
  edgeStyle: "default",
  snapToGrid: false,
  showPalette: true,
  showInspector: true,
  showConsole: true,
  showMinimap: true,
  showPortLabels: true,
  paletteWidth: 260,
  inspectorWidth: 330,
  consoleHeight: 200,
  collapsedGroups: [],
  sidebarView: "nodes",
  panelTab: "console",
  panelMaximized: false,
  dragMode: "pan",
  projectView: "grid",
  projectSort: "updated",
};

const KEY = "open-sila:preferences";
const listeners = new Set<() => void>();

function load(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Preferences>;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();

export function setPreferences(patch: Partial<Preferences> | ((value: Preferences) => Partial<Preferences>)): void {
  const changes = typeof patch === "function" ? patch(current) : patch;
  current = { ...current, ...changes };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage can be unavailable in private windows; preferences then last for the session.
  }
  for (const listener of listeners) listener();
}

export function resetLayout(): void {
  const { theme, density, projectView, projectSort } = current;
  setPreferences({ ...DEFAULTS, theme, density, projectView, projectSort });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, () => current);
}

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function subscribeScheme(listener: () => void): () => void {
  darkQuery.addEventListener("change", listener);
  return () => darkQuery.removeEventListener("change", listener);
}

export function useResolvedTheme(): "dark" | "light" {
  const { theme } = usePreferences();
  const systemDark = useSyncExternalStore(subscribeScheme, () => darkQuery.matches);
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function useApplyTheme(): void {
  const { density } = usePreferences();
  const resolved = useResolvedTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.density = density;
  }, [resolved, density]);
}
