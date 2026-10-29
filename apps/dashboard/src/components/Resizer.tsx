import { useEffect, useRef, useState, type PointerEvent } from "react";

interface Props {
  direction: "horizontal" | "vertical";
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  label: string;
  onChange: (value: number) => void;
}

export function Resizer({ direction, value, min, max, invert = false, label, onChange }: Props) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ pointer: 0, value: 0 });
  const vertical = direction === "vertical";

  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("resizing");
    document.body.classList.toggle("rows", vertical);
    return () => document.body.classList.remove("resizing", "rows");
  }, [dragging, vertical]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { pointer: vertical ? event.clientY : event.clientX, value };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const delta = (vertical ? event.clientY : event.clientX) - start.current.pointer;
    onChange(Math.round(Math.min(max, Math.max(min, start.current.value + (invert ? -delta : delta)))));
  };

  return (
    <div
      className={`resizer ${vertical ? "horizontal" : ""} ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onLostPointerCapture={() => setDragging(false)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        const grow = vertical ? event.key === "ArrowUp" : event.key === "ArrowRight";
        const shrink = vertical ? event.key === "ArrowDown" : event.key === "ArrowLeft";
        if (!grow && !shrink) return;
        event.preventDefault();
        const direction = (grow ? 1 : -1) * (invert ? -1 : 1);
        onChange(Math.min(max, Math.max(min, value + direction * step)));
      }}
    />
  );
}
