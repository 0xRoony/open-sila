import { ChevronRight, Database, FileCode, FileJson, FileKey, FileText, Folder, FolderOpen, Settings2, type LucideIcon } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";

interface Branch {
  name: string;
  path: string;
  folders: Branch[];
  files: { name: string; path: string }[];
}

function build(paths: string[]): Branch {
  const root: Branch = { name: "", path: "", folders: [], files: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let branch = root;
    parts.slice(0, -1).forEach((part, index) => {
      const folderPath = parts.slice(0, index + 1).join("/");
      let next = branch.folders.find((folder) => folder.path === folderPath);
      if (!next) {
        next = { name: part, path: folderPath, folders: [], files: [] };
        branch.folders.push(next);
      }
      branch = next;
    });
    branch.files.push({ name: parts[parts.length - 1], path });
  }
  const sort = (branch: Branch) => {
    branch.folders.sort((a, b) => a.name.localeCompare(b.name));
    branch.files.sort((a, b) => Number(b.name.startsWith(".")) - Number(a.name.startsWith(".")) || a.name.localeCompare(b.name));
    branch.folders.forEach(sort);
  };
  sort(root);
  return root;
}

function fileIcon(name: string): LucideIcon {
  if (/\.(m?js|ts)$/.test(name)) return FileCode;
  if (name.endsWith(".json")) return FileJson;
  if (name.endsWith(".prisma")) return Database;
  if (name.startsWith(".env")) return FileKey;
  if (name.endsWith(".toml") || name === "Dockerfile" || name.startsWith(".")) return Settings2;
  return FileText;
}

function parents(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

interface Props {
  paths: string[];
  selected: string | undefined;
  onSelect: (path: string) => void;
}

export function FileTree({ paths, selected, onSelect }: Props) {
  const tree = useMemo(() => build(paths), [paths]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(["src", ...(selected ? parents(selected) : [])]));

  const toggle = (path: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, folder: string) => {
    if (event.key === "ArrowRight" && !open.has(folder)) toggle(folder);
    if (event.key === "ArrowLeft" && open.has(folder)) toggle(folder);
  };

  const render = (branch: Branch, depth: number) => (
    <>
      {branch.folders.map((folder) => {
        const expanded = open.has(folder.path);
        const Icon = expanded ? FolderOpen : Folder;
        const count = paths.filter((path) => path.startsWith(`${folder.path}/`)).length;
        return (
          <li key={folder.path} role="treeitem" aria-expanded={expanded}>
            <button
              className="tree-row tree-folder"
              style={{ paddingLeft: 6 + depth * 14 }}
              onClick={() => toggle(folder.path)}
              onKeyDown={(event) => onKey(event, folder.path)}
              title={folder.path}
            >
              <ChevronRight size={13} className={`tree-chevron ${expanded ? "open" : ""}`} />
              <Icon size={14} className="tree-icon folder" />
              <span className="tree-name">{folder.name}</span>
              <span className="tree-count">{count}</span>
            </button>
            {expanded && (
              <ul role="group" className="tree-group">
                {render(folder, depth + 1)}
              </ul>
            )}
          </li>
        );
      })}
      {branch.files.map((file) => {
        const Icon = fileIcon(file.name);
        return (
          <li key={file.path} role="treeitem" aria-selected={file.path === selected}>
            <button
              className={`tree-row tree-file ${file.path === selected ? "active" : ""}`}
              style={{ paddingLeft: 6 + depth * 14 + 17 }}
              onClick={() => onSelect(file.path)}
              title={file.path}
            >
              <Icon size={14} className="tree-icon" />
              <span className="tree-name">{file.name}</span>
            </button>
          </li>
        );
      })}
    </>
  );

  const folders = paths.flatMap(parents);
  const allOpen = folders.every((folder) => open.has(folder));

  return (
    <div className="file-tree">
      <div className="tree-head">
        <span>Files</span>
        <button className="link muted" onClick={() => setOpen(allOpen ? new Set() : new Set(folders))}>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <ul role="tree" aria-label="Generated files" className="tree-root">
        {render(tree, 0)}
      </ul>
    </div>
  );
}
