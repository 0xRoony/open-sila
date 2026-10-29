import { Check, Copy, KeyRound, LayoutDashboard, Monitor, Moon, Palette, Plug, Sun } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api, type ApiKey } from "../api";
import { resetLayout, setPreferences, usePreferences, type EdgeStyle, type ThemeMode } from "../preferences";
import type { SettingsSection } from "../router";

const THEMES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
];

const EDGES: { value: EdgeStyle; label: string }[] = [
  { value: "default", label: "Curved" },
  { value: "smoothstep", label: "Rounded" },
  { value: "step", label: "Right angle" },
  { value: "straight", label: "Straight" },
];

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-block">
      <pre>{text}</pre>
      <button
        className="button small"
        onClick={() =>
          navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => setCopied(false),
          )
        }
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Switch({ id, checked, onChange }: { id: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />;
}

export function SettingsPage({ section }: { section: SettingsSection }) {
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  useEffect(() => {
    document.getElementById(section)?.scrollIntoView({ block: "start" });
  }, [section]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Appearance and editor preferences are saved in this browser. API keys are stored on the server.</p>
        </div>
      </div>
      <div className="settings-grid">
        <nav className="settings-nav" aria-label="Settings sections">
          <a href="#appearance">
            <Palette size={15} /> Appearance
          </a>
          <a href="#editor">
            <LayoutDashboard size={15} /> Editor layout
          </a>
          <a href="#api">
            <KeyRound size={15} /> API keys
          </a>
          <a href="#mcp">
            <Plug size={15} /> MCP and REST
          </a>
        </nav>
        <div className="stack">
          <Appearance />
          <EditorSettings />
          <ApiKeys created={createdKey} onCreated={setCreatedKey} />
          <Connect secret={createdKey} />
        </div>
      </div>
    </>
  );
}

function Appearance() {
  const preferences = usePreferences();
  return (
    <section className="panel" id="appearance">
      <h2>Appearance</h2>
      <div className="setting-row">
        <div>
          <h3>Theme</h3>
          <p className="muted">System follows your operating system.</p>
        </div>
        <div className="segmented">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button key={value} className={preferences.theme === value ? "active" : ""} onClick={() => setPreferences({ theme: value })}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <div>
          <h3>Density</h3>
          <p className="muted">Compact fits more on screen and hides node descriptions in the list.</p>
        </div>
        <div className="segmented">
          {(["comfortable", "compact"] as const).map((value) => (
            <button key={value} className={preferences.density === value ? "active" : ""} onClick={() => setPreferences({ density: value })}>
              {value === "comfortable" ? "Comfortable" : "Compact"}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function EditorSettings() {
  const preferences = usePreferences();
  const toggles = [
    { key: "showPalette", label: "Node list", hint: "The searchable list of nodes on the left. Ctrl+B" },
    { key: "showInspector", label: "Inspector", hint: "Settings for the selected node on the right. Ctrl+." },
    { key: "showConsole", label: "Console", hint: "Bot output and problems at the bottom. Ctrl+J" },
    { key: "showMinimap", label: "Minimap", hint: "Overview of the canvas in the corner." },
    { key: "showPortLabels", label: "Port labels", hint: "Names next to each connection point." },
    { key: "snapToGrid", label: "Snap to grid", hint: "Moves nodes in 20px steps for tidy rows." },
  ] as const;

  return (
    <section className="panel" id="editor">
      <h2>Editor layout</h2>
      <div className="setting-row">
        <div>
          <h3>Connection style</h3>
          <p className="muted">How wires between nodes are drawn.</p>
        </div>
        <div className="segmented">
          {EDGES.map(({ value, label }) => (
            <button key={value} className={preferences.edgeStyle === value ? "active" : ""} onClick={() => setPreferences({ edgeStyle: value })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {toggles.map(({ key, label, hint }) => (
        <label className="setting-row" key={key} htmlFor={`pref-${key}`}>
          <div>
            <h3>{label}</h3>
            <p className="muted">{hint}</p>
          </div>
          <Switch id={`pref-${key}`} checked={preferences[key]} onChange={(value) => setPreferences({ [key]: value })} />
        </label>
      ))}
      <div className="setting-row">
        <div>
          <h3>Panel sizes</h3>
          <p className="muted">
            Node list {preferences.paletteWidth}px, inspector {preferences.inspectorWidth}px, console {preferences.consoleHeight}px. Drag
            the panel edges in the editor to resize them.
          </p>
        </div>
        <button className="button" onClick={resetLayout}>
          Reset layout
        </button>
      </div>
    </section>
  );
}

function ApiKeys({ created, onCreated }: { created: string | null; onCreated: (secret: string) => void }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("write");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = () => api.keys().then(setKeys).catch((reason: Error) => setError(reason.message));

  useEffect(() => {
    void load();
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const key = await api.createKey(name.trim(), scope);
    onCreated(key.secret);
    setName("");
    await load();
  };

  const revoke = async (id: string) => {
    await api.deleteKey(id);
    setConfirming(null);
    await load();
  };

  return (
    <section className="panel stack" id="api">
      <h2>API keys</h2>
      <p className="muted">Keys let scripts, CI and AI assistants manage your projects. Read-only keys cannot change anything.</p>
      <form className="row wrap" onSubmit={create}>
        <input
          id="key-name"
          className="grow"
          placeholder="Key name, for example Claude Desktop"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          style={{ minWidth: 220 }}
        />
        <select id="key-scope" value={scope} onChange={(event) => setScope(event.target.value as "read" | "write")} style={{ width: "auto" }}>
          <option value="write">Read and write</option>
          <option value="read">Read only</option>
        </select>
        <button className="button primary" disabled={!name.trim()}>
          <KeyRound size={14} /> Create key
        </button>
      </form>

      {created && (
        <div className="callout">
          <strong>Copy this key now. It will not be shown again.</strong>
          <CopyBlock text={created} />
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <div className="table">
        <div className="table-row head">
          <span>Name</span>
          <span>Key</span>
          <span>Access</span>
          <span>Last used</span>
          <span />
        </div>
        {keys.length === 0 && <div className="table-row muted">No keys yet.</div>}
        {keys.map((key) => (
          <div className="table-row" key={key.id}>
            <span>{key.name}</span>
            <code>{key.prefix}…</code>
            <span>{key.scope === "write" ? "Read and write" : "Read only"}</span>
            <span className="muted">{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}</span>
            <span className="end">
              {confirming === key.id ? (
                <>
                  <button className="link" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  <button className="link danger" onClick={() => revoke(key.id)}>
                    Revoke
                  </button>
                </>
              ) : (
                <button className="link muted" onClick={() => setConfirming(key.id)}>
                  Revoke
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Connect({ secret }: { secret: string | null }) {
  const origin = location.origin;
  const keyText = secret ?? "osk_your_key";
  return (
    <section className="panel stack" id="mcp">
      <h2>MCP and REST</h2>
      <p className="muted">
        The MCP endpoint lets an assistant list node types, build flows, set secrets and run bots. A read-only key only exposes the
        read tools.
      </p>
      <h3>Claude Code</h3>
      <CopyBlock text={`claude mcp add --transport http open-sila ${origin}/mcp --header "Authorization: Bearer ${keyText}"`} />
      <h3>JSON config (Claude Desktop, Cursor, others)</h3>
      <CopyBlock
        text={JSON.stringify(
          { mcpServers: { "open-sila": { type: "http", url: `${origin}/mcp`, headers: { Authorization: `Bearer ${keyText}` } } } },
          null,
          2,
        )}
      />
      <h3>REST API</h3>
      <p className="muted">
        Base URL <code>{origin}/api/v1</code>
      </p>
      <CopyBlock text={`curl -H "Authorization: Bearer ${keyText}" ${origin}/api/v1/projects`} />
    </section>
  );
}
