import { useReactFlow, useViewport } from "@xyflow/react";
import { Hand, Magnet, Map, Maximize, MousePointer2, Redo2, Undo2, WandSparkles, ZoomIn, ZoomOut } from "lucide-react";
import { setPreferences, usePreferences } from "../preferences";

interface Props {
  onArrange: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function CanvasToolbar({ onArrange, onUndo, onRedo, canUndo, canRedo }: Props) {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const { snapToGrid, showMinimap, dragMode } = usePreferences();

  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas">
      <button
        className={`tool ${dragMode === "select" ? "on" : ""}`}
        onClick={() => setPreferences({ dragMode: "select" })}
        aria-pressed={dragMode === "select"}
        aria-label="Select tool"
        title="Select tool (V): drag on the canvas to select"
      >
        <MousePointer2 size={15} />
      </button>
      <button
        className={`tool ${dragMode === "pan" ? "on" : ""}`}
        onClick={() => setPreferences({ dragMode: "pan" })}
        aria-pressed={dragMode === "pan"}
        aria-label="Hand tool"
        title="Hand tool (H): drag to move, press and hold to select"
      >
        <Hand size={15} />
      </button>
      <span className="tool-divider" />
      <button className="tool" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
        <Undo2 size={15} />
      </button>
      <button className="tool" onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
        <Redo2 size={15} />
      </button>
      <span className="tool-divider" />
      <button className="tool" onClick={() => void zoomOut({ duration: 150 })} aria-label="Zoom out" title="Zoom out">
        <ZoomOut size={15} />
      </button>
      <button className="tool zoom" onClick={() => void zoomTo(1, { duration: 200 })} title="Reset zoom to 100%">
        {Math.round(zoom * 100)}%
      </button>
      <button className="tool" onClick={() => void zoomIn({ duration: 150 })} aria-label="Zoom in" title="Zoom in">
        <ZoomIn size={15} />
      </button>
      <button className="tool" onClick={() => void fitView({ padding: 0.2, duration: 300 })} aria-label="Fit to screen" title="Fit to screen (Shift+1)">
        <Maximize size={15} />
      </button>
      <span className="tool-divider" />
      <button className="tool" onClick={onArrange} aria-label="Arrange nodes" title="Arrange nodes (Shift+A)">
        <WandSparkles size={15} />
      </button>
      <button
        className={`tool ${snapToGrid ? "on" : ""}`}
        onClick={() => setPreferences({ snapToGrid: !snapToGrid })}
        aria-pressed={snapToGrid}
        aria-label="Snap to grid"
        title="Snap to grid"
      >
        <Magnet size={15} />
      </button>
      <button
        className={`tool ${showMinimap ? "on" : ""}`}
        onClick={() => setPreferences({ showMinimap: !showMinimap })}
        aria-pressed={showMinimap}
        aria-label="Minimap"
        title="Minimap"
      >
        <Map size={15} />
      </button>
    </div>
  );
}
