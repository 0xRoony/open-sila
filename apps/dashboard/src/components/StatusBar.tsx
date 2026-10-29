import type { Platform } from "@open-sila/core";
import { useViewport } from "@xyflow/react";
import { CircleX, Magnet, SquareTerminal, TriangleAlert, WifiOff } from "lucide-react";
import type { BotState } from "../api";
import { setPreferences, usePreferences } from "../preferences";
import { BrandIcon, PLATFORM_NAME } from "./BrandIcon";

const STATE_LABEL: Record<BotState, string> = {
  stopped: "Bot stopped",
  starting: "Bot starting",
  running: "Bot running",
  crashed: "Bot crashed",
};

const EDGE_LABEL = { default: "Curved", smoothstep: "Rounded", step: "Right angle", straight: "Straight" };

interface Props {
  online: boolean;
  platform: Platform;
  bot: BotState;
  errors: number;
  warnings: number;
  nodes: number;
  edges: number;
}

export function StatusBar({ online, platform, bot, errors, warnings, nodes, edges }: Props) {
  const preferences = usePreferences();
  const { zoom } = useViewport();
  const openPanel = (panelTab: "console" | "problems") =>
    setPreferences(({ showConsole, panelTab: current }) =>
      showConsole && current === panelTab ? { showConsole: false } : { showConsole: true, panelTab },
    );

  return (
    <footer className="status-bar">
      <span className="status-item">
        <BrandIcon platform={platform} size={12} colored={false} />
        {PLATFORM_NAME[platform]}
      </span>
      {!online && (
        <span className="status-item offline" title="The dashboard lost its connection to the server. It reconnects automatically.">
          <WifiOff size={12} /> Server offline
        </span>
      )}
      <button className={`status-item bot-${bot}`} onClick={() => openPanel("console")} title="Show console">
        <i className="status-dot" />
        {STATE_LABEL[bot]}
      </button>
      <button className="status-item" onClick={() => openPanel("problems")} title="Show problems">
        <CircleX size={13} className={errors > 0 ? "issue-error-icon" : ""} /> {errors}
        <TriangleAlert size={13} className={warnings > 0 ? "issue-warning-icon" : ""} /> {warnings}
      </button>
      <span className="status-item muted">
        {nodes} nodes · {edges} connections
      </span>
      <span className="grow" />
      <button
        className={`status-item ${preferences.snapToGrid ? "on" : ""}`}
        onClick={() => setPreferences({ snapToGrid: !preferences.snapToGrid })}
        title="Snap to grid"
      >
        <Magnet size={12} /> {preferences.snapToGrid ? "Snap on" : "Snap off"}
      </button>
      <span className="status-item muted">{EDGE_LABEL[preferences.edgeStyle]} wires</span>
      <span className="status-item muted">{Math.round(zoom * 100)}%</span>
      <button className={`status-item ${preferences.showConsole ? "on" : ""}`} onClick={() => setPreferences({ showConsole: !preferences.showConsole })} title="Toggle panel (Ctrl+J)">
        <SquareTerminal size={12} /> Panel
      </button>
    </footer>
  );
}
