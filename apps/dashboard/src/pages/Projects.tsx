import type { Platform } from "@open-sila/core";
import { FileJson, LayoutGrid, Plus, Rows3, Search, Trash2, Upload } from "lucide-react";
import { EmptyWire } from "../components/Logo";
import { SkeletonCards } from "../components/Loader";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, exportUrl, type ProjectListItem } from "../api";
import { PlatformBadge, StatePill } from "../components/Badges";
import { BrandIcon } from "../components/BrandIcon";
import { Dialog } from "../components/Dialog";
import { setPreferences, usePreferences } from "../preferences";
import { linkHandler, navigate } from "../router";
import { templatesFor, type TemplateGroup } from "../templates";

function relative(date: string): string {
  const minutes = Math.round((Date.now() - new Date(date).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(date).toLocaleDateString();
}

type Filter = "all" | Platform;

const SORTS = {
  updated: (a: ProjectListItem, b: ProjectListItem) => b.updatedAt.localeCompare(a.updatedAt),
  created: (a: ProjectListItem, b: ProjectListItem) => b.createdAt.localeCompare(a.createdAt),
  name: (a: ProjectListItem, b: ProjectListItem) => a.name.localeCompare(b.name),
};

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const { projectView, projectSort } = usePreferences();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const importFile = async (file: File) => {
    setError("");
    try {
      const document = JSON.parse(await file.text());
      const { project } = await api.importProject(document);
      navigate(`/projects/${project.id}`);
    } catch (reason) {
      setError(reason instanceof SyntaxError ? `${file.name} is not valid JSON.` : (reason as Error).message);
    }
  };

  useEffect(() => {
    const hasFile = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const over = (event: DragEvent) => {
      if (!hasFile(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFile(event)) return;
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file) void importFile(file);
    };
    addEventListener("dragover", over);
    addEventListener("dragleave", leave);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragover", over);
      removeEventListener("dragleave", leave);
      removeEventListener("drop", drop);
    };
  }, []);

  const load = () =>
    api
      .projects()
      .then(setProjects)
      .catch((reason: Error) => setError(reason.message));

  useEffect(() => {
    void load();
  }, []);

  const term = query.trim().toLowerCase();
  const visible = (projects ?? [])
    .filter((project) => filter === "all" || project.platform === filter)
    .filter((project) => !term || project.name.toLowerCase().includes(term) || project.description.toLowerCase().includes(term))
    .sort(SORTS[projectSort]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="muted">Each project is one bot. Build it on the canvas, run it here, export it when it is ready.</p>
        </div>
        <div className="row">
          <button className="button" onClick={() => fileInput.current?.click()}>
            <Upload size={15} /> Import
          </button>
          <button className="button primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> New project
          </button>
        </div>
        <input
          ref={fileInput}
          id="import-file"
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>
      {dragging && (
        <div className="drop-zone">
          <Upload size={28} />
          <strong>Drop a project file to import it</strong>
        </div>
      )}

      {projects && projects.length > 0 && (
        <div className="toolbar">
          <div className="search-box">
            <Search size={14} />
            <input id="project-search" placeholder="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="segmented" role="group" aria-label="Platform">
            {(["all", "discord", "telegram"] as const).map((value) => (
              <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
                {value === "all" ? "All" : value === "discord" ? "Discord" : "Telegram"}
              </button>
            ))}
          </div>
          <select
            id="project-sort"
            value={projectSort}
            onChange={(event) => setPreferences({ projectSort: event.target.value as keyof typeof SORTS })}
            style={{ width: "auto" }}
            aria-label="Sort projects"
          >
            <option value="updated">Recently edited</option>
            <option value="created">Recently created</option>
            <option value="name">Name</option>
          </select>
          <span className="grow" />
          <div className="segmented" role="group" aria-label="View">
            <button className={projectView === "grid" ? "active" : ""} onClick={() => setPreferences({ projectView: "grid" })} aria-label="Grid view" title="Grid view">
              <LayoutGrid size={14} />
            </button>
            <button className={projectView === "list" ? "active" : ""} onClick={() => setPreferences({ projectView: "list" })} aria-label="List view" title="List view">
              <Rows3 size={14} />
            </button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {projects === null && !error && <SkeletonCards />}
      {projects?.length === 0 && (
        <div className="empty">
          <EmptyWire />
          <h2>No projects yet</h2>
          <p className="muted">Create a Discord or Telegram bot, or import a project file.</p>
          <button className="button primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> Create your first bot
          </button>
        </div>
      )}
      {projects && projects.length > 0 && visible.length === 0 && <p className="muted">No projects match these filters.</p>}

      {visible.length > 0 && (
        <div className={projectView === "list" ? "list" : "grid"}>
          {visible.map((project) => (
            <ProjectCard key={project.id} project={project} onDeleted={load} />
          ))}
        </div>
      )}

      {creating && <CreateProject onClose={() => setCreating(false)} />}
    </>
  );
}

function ProjectCard({ project, onDeleted }: { project: ProjectListItem; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const path = `/projects/${project.id}`;

  const remove = async () => {
    await api.deleteProject(project.id);
    onDeleted();
  };

  return (
    <article className="card project-card">
      <a href={path} onClick={linkHandler(path)} className="card-link">
        <div className="row between">
          <span className="row">
            <span className={`project-icon ${project.platform}`}>
              <BrandIcon platform={project.platform} size={20} colored={false} />
            </span>
            <span>
              <h3>{project.name}</h3>
              <PlatformBadge platform={project.platform} />
            </span>
          </span>
          <StatePill state={project.bot} />
        </div>
        <p className="muted clamp">{project.description || "No description"}</p>
      </a>
      <div className="row between small">
        <span className="muted">Edited {relative(project.updatedAt)}</span>
        {confirming ? (
          <span className="row">
            <button className="link" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button className="link danger" onClick={remove}>
              Delete permanently
            </button>
          </span>
        ) : (
          <span className="row">
            <a className="link muted" href={exportUrl(project.id, "json")} download title="Download the project file">
              <FileJson size={13} /> Export
            </a>
            <button className="link muted" onClick={() => setConfirming(true)} aria-label={`Delete ${project.name}`}>
              <Trash2 size={13} /> Delete
            </button>
          </span>
        )}
      </div>
    </article>
  );
}

const GROUPS: TemplateGroup[] = ["Start", "Community", "Fun", "Moderation", "Data", "Automation"];

function CreateProject({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [platform, setPlatform] = useState<Platform>("discord");
  const [template, setTemplate] = useState("ping");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const available = templatesFor(platform);
      const chosen = available.find((item) => item.id === template) ?? available[0];
      const project = await api.createProject({ name, description, platform, flow: chosen.flow(platform) });
      navigate(`/projects/${project.id}`);
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="New project" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Name
          <input id="project-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} autoFocus />
        </label>
        <label>
          Description
          <input id="project-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} />
        </label>
        <fieldset>
          <legend>Platform</legend>
          <div className="segmented block">
            {(["discord", "telegram"] as const).map((value) => (
              <button
                type="button"
                key={value}
                className={platform === value ? "active" : ""}
                onClick={() => {
                  setPlatform(value);
                  if (!templatesFor(value).some((item) => item.id === template)) setTemplate("ping");
                }}
              >
                <PlatformBadge platform={value} />
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Start from</legend>
          <div className="template-groups">
            {GROUPS.map((group) => {
              const items = templatesFor(platform).filter((item) => item.group === group);
              if (items.length === 0) return null;
              return (
                <section key={group}>
                  <h4 className="section-title">{group}</h4>
                  <div className="choices">
                    {items.map((item) => (
                      <label key={item.id} className={`choice ${template === item.id ? "active" : ""}`}>
                        <input type="radio" name="template" value={item.id} checked={template === item.id} onChange={() => setTemplate(item.id)} />
                        <strong>{item.name}</strong>
                        <span className="muted small">{item.description}</span>
                      </label>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </fieldset>
        {error && <p className="error">{error}</p>}
        <div className="row end">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy || !name.trim()}>
            Create project
          </button>
        </div>
      </form>
    </Dialog>
  );
}
