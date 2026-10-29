import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface Props {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

export function Popover({ anchor, onClose, className = "", children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const button = anchor.current?.getBoundingClientRect();
      const menu = panel.current?.getBoundingClientRect();
      if (!button || !menu) return;
      const left = Math.max(8, Math.min(button.right - menu.width, innerWidth - menu.width - 8));
      const below = button.bottom + 6;
      const top = below + menu.height > innerHeight - 8 ? Math.max(8, button.top - menu.height - 6) : below;
      setPosition({ top, left });
    };
    place();
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => {
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    addEventListener("mousedown", close);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("mousedown", close);
      removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panel}
      className={`menu popover ${className}`}
      role="menu"
      style={position ?? { top: -9999, left: -9999, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
