import { useSyncExternalStore } from "react";
import type { Preferences } from "./preferences";

const ACTIVITY_BAR = 48;
const CANVAS_MIN_WIDTH = 420;
const CANVAS_MIN_HEIGHT = 240;
const CHROME_HEIGHT = 52 + 28;

export const SIDEBAR = { min: 200, max: 440 };
export const INSPECTOR = { min: 260, max: 560 };
export const CONSOLE = { min: 100, max: 640 };

export interface Limit {
  min: number;
  max: number;
  value: number;
}

export interface PanelLimits {
  sidebar: Limit;
  inspector: Limit;
  console: Limit;
}

function subscribe(callback: () => void) {
  addEventListener("resize", callback);
  return () => removeEventListener("resize", callback);
}

const width = () => innerWidth;
const height = () => innerHeight;

export function useWindowSize(): { width: number; height: number } {
  return { width: useSyncExternalStore(subscribe, width), height: useSyncExternalStore(subscribe, height) };
}

function limit(value: number, min: number, max: number): Limit {
  const top = Math.max(min, max);
  return { min, max: top, value: Math.min(top, Math.max(min, value)) };
}

// Panel sizes always leave the canvas usable: each panel can only grow into the room the others leave free.
export function panelLimits(size: { width: number; height: number }, preferences: Preferences): PanelLimits {
  const room = size.width - ACTIVITY_BAR - CANVAS_MIN_WIDTH;
  const inspector = limit(preferences.inspectorWidth, INSPECTOR.min, Math.min(INSPECTOR.max, room - (preferences.showPalette ? SIDEBAR.min : 0)));
  const sidebar = limit(
    preferences.paletteWidth,
    SIDEBAR.min,
    Math.min(SIDEBAR.max, room - (preferences.showInspector ? inspector.value : 0)),
  );
  const console = limit(preferences.consoleHeight, CONSOLE.min, Math.min(CONSOLE.max, size.height - CHROME_HEIGHT - CANVAS_MIN_HEIGHT));
  return { sidebar, inspector, console };
}
