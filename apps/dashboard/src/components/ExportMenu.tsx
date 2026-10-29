import { ChevronDown, Download, FileArchive, FileJson } from "lucide-react";
import { useRef, useState } from "react";
import { exportUrl } from "../api";
import { Popover } from "./Popover";

export function ExportMenu({ projectId, canBuild }: { projectId: string; canBuild: boolean }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={button}
        className={`button ghost ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Download size={15} /> Export <ChevronDown size={13} />
      </button>
      {open && (
        <Popover anchor={button} onClose={() => setOpen(false)} className="export-menu">
          <a
            className={`menu-item tall ${canBuild ? "" : "disabled"}`}
            role="menuitem"
            href={canBuild ? exportUrl(projectId) : undefined}
            download
            onClick={() => setOpen(false)}
          >
            <FileArchive size={16} />
            <span>
              <strong>Bot code (.zip)</strong>
              <small>{canBuild ? "A ready-to-run Node.js project to host anywhere." : "Fix the problems in the flow first."}</small>
            </span>
          </a>
          <a className="menu-item tall" role="menuitem" href={exportUrl(projectId, "json")} download onClick={() => setOpen(false)}>
            <FileJson size={16} />
            <span>
              <strong>Project file (.json)</strong>
              <small>The flow itself. Import it to get the same workflow back. Secrets are not included.</small>
            </span>
          </a>
        </Popover>
      )}
    </>
  );
}
