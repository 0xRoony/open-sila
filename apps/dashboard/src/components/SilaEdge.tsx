import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../preferences";

export type SilaEdgeData = { conversion?: string; value?: string };
export type SilaEdgeType = Edge<SilaEdgeData, "sila">;

const HIT_WIDTH = 28;

export function SilaEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, style, data }: EdgeProps<SilaEdgeType>) {
  const { edgeStyle } = usePreferences();
  const { deleteElements } = useReactFlow();
  const [hovered, setHovered] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout>>(undefined);
  const params = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  const [path, labelX, labelY] =
    edgeStyle === "straight"
      ? getStraightPath(params)
      : edgeStyle === "smoothstep"
        ? getSmoothStepPath(params)
        : edgeStyle === "step"
          ? getSmoothStepPath({ ...params, borderRadius: 0 })
          : getBezierPath(params);

  useEffect(() => () => clearTimeout(leave.current), []);

  const enter = () => {
    clearTimeout(leave.current);
    setHovered(true);
  };
  const exit = () => {
    clearTimeout(leave.current);
    leave.current = setTimeout(() => setHovered(false), 120);
  };

  const showDelete = selected || hovered;
  const center = { transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` };

  return (
    <>
      <BaseEdge id={id} path={path} style={style} interactionWidth={0} className={hovered ? "hovered" : ""} />
      <path d={path} className="edge-hit" strokeWidth={HIT_WIDTH} onMouseEnter={enter} onMouseLeave={exit} />
      <EdgeLabelRenderer>
        {data?.conversion && (
          <div
            className="edge-conversion nodrag nopan"
            style={{ transform: `translate(-50%, ${showDelete ? "-180%" : "-50%"}) translate(${labelX}px, ${labelY}px)` }}
            title="The value is converted automatically"
          >
            {data.conversion}
          </div>
        )}
        {hovered && data?.value && (
          <div
            className="edge-value nodrag nopan"
            style={{ transform: `translate(-50%, 70%) translate(${labelX}px, ${labelY}px)` }}
            title="Value from the last run"
          >
            {data.value}
          </div>
        )}
        {showDelete && (
          <button
            className="edge-delete nodrag nopan"
            style={center}
            onMouseEnter={enter}
            onMouseLeave={exit}
            onClick={() => void deleteElements({ edges: [{ id }] })}
            aria-label="Delete connection"
            title="Delete connection"
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
