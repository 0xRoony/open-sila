import {
  currentDatabase,
  customKey,
  fieldsFor,
  itemPort,
  getNode,
  inputsOf,
  portLabel,
  type Diagnostic,
  type FieldDef,
  type FieldValue,
  type Platform,
  type PortDef,
  type PortType,
} from "@open-sila/core";
import { CircleAlert, Copy, Link2, Plus, Trash2, TriangleAlert, Unlink, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { StepRecord } from "../api";
import { listItems, uniqueName } from "../growable";
import { JsonView } from "./JsonView";
import { duration, StatusIcon } from "./RunsPanel";
import type { SilaNode } from "../flow";
import { nodeIcon } from "../icons";
import { BrandIcon } from "./BrandIcon";

interface Props {
  platform: Platform;
  node: SilaNode | undefined;
  width: number;
  sources: Map<string, Source[]>;
  onRemoveEdge: (edgeId: string) => void;
  onPatch: (patch: Record<string, FieldValue | undefined>) => void;
  onRewire: (from: string, to: string | null) => void;
  onDisconnect: (port: string) => void;
  diagnostics: Diagnostic[];
  onChange: (id: string, value: FieldValue) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
  lastStep?: StepRecord;
  tools?: ReactNode;
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl+K", "Search nodes"],
  ["Ctrl+B", "Toggle sidebar"],
  ["Ctrl+P", "Command palette"],
  ["Ctrl+Shift+O", "Flow outline"],
  ["Ctrl+Shift+D", "Database models"],
  ["Ctrl+Shift+H", "Version history"],
  ["Ctrl+J", "Toggle console"],
  ["Ctrl+Shift+M", "Show problems"],
  ["Ctrl+.", "Toggle this panel"],
  ["Ctrl+D", "Duplicate node"],
  ["Ctrl+C / V", "Copy and paste"],
  ["Ctrl+Z / Y", "Undo and redo"],
  ["Hold + drag", "Select an area"],
  ["V / H", "Select or hand tool"],
  ["Ctrl+A", "Select all"],
  ["Right-click", "Actions menu"],
  ["Shift+A", "Arrange nodes"],
  ["Delete", "Delete selection"],
  ["Ctrl+S", "Save now"],
];

export function Inspector({
  platform,
  node,
  width,
  sources,
  onRemoveEdge,
  onDisconnect,
  onPatch,
  onRewire,
  diagnostics,
  onChange,
  onDelete,
  onDuplicate,
  onClose,
  lastStep,
  tools,
}: Props) {
  const definition = node && getNode(node.data.kind);

  if (!node || !definition) {
    return (
      <aside className="sidebar inspector" style={{ width }} aria-label="Inspector">
        <div className="inspector-empty">
          <h3>Nothing selected</h3>
          <p>
            Select a node to edit its settings. Write {platform === "discord" ? "{{ user.username }}" : "{{ user.first_name }}"} in any
            text field to insert a value.
          </p>
          <dl>
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys} style={{ display: "contents" }}>
                <dt>{keys}</dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    );
  }

  const Icon = nodeIcon(definition.icon, definition.category);
  const fields = fieldsFor(definition, platform);
  const fieldIds = new Set(fields.map((field) => field.id));
  const prefixes = fields.flatMap((field) => (field.kind === "list" && field.portPrefix ? [field.portPrefix] : []));
  const customPorts = inputsOf(definition, node.data.values).filter(
    (port) => port.type !== "exec" && !fieldIds.has(port.id) && !prefixes.some((prefix) => port.id.startsWith(prefix)),
  );

  return (
    <aside className="sidebar inspector" style={{ width }} aria-label="Inspector">
      <header className={`inspector-head category-${definition.category}`}>
        <span className="node-icon">
          <Icon size={17} />
        </span>
        <div className="titles">
          <span className="eyebrow">
            {definition.category}
            {definition.platforms.length === 1 && <BrandIcon platform={definition.platforms[0]} size={11} colored={false} />}
          </span>
          <h3>{definition.label}</h3>
          <p className="muted small">{definition.description}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close inspector">
          <X size={15} />
        </button>
      </header>

      {diagnostics.length > 0 && (
        <ul className="issues">
          {diagnostics.map((item, index) => (
            <li key={index} className={item.level}>
              {item.level === "error" ? <CircleAlert size={14} /> : <TriangleAlert size={14} />}
              {item.message}
            </li>
          ))}
        </ul>
      )}

      <div className="form">
        {fields.length === 0 && customPorts.length === 0 && <p className="muted small">This node has no settings.</p>}
        {fields.map((field) =>
          field.kind === "list" ? (
            <ListEditor
              key={field.id}
              field={field}
              values={node.data.values}
              sources={sources}
              onPatch={onPatch}
              onRewire={onRewire}
              onDisconnect={onDisconnect}
            />
          ) : (
          <Field
            key={field.id}
            field={field}
            nodeId={node.id}
            value={node.data.values[field.id] ?? field.default}
            sources={sources.get(field.id) ?? []}
            onRemoveEdge={onRemoveEdge}
            onDisconnect={() => onDisconnect(field.id)}
            onChange={(value) => onChange(field.id, value)}
          />
          ),
        )}
      </div>

      {customPorts.length > 0 && (
        <div className="form inputs-section">
          <div className="section-head">
            <h4>Inputs</h4>
            <p className="muted small">Connect a wire, or write a JavaScript value. Empty inputs use the value from the trigger.</p>
          </div>
          {customPorts.map((port) => (
            <PortInput
              key={port.id}
              port={port}
              platform={platform}
              nodeId={node.id}
              value={String(node.data.values[customKey(port.id)] ?? "")}
              source={sources.get(port.id)?.[0]?.label}
              onDisconnect={() => onDisconnect(port.id)}
              onChange={(value) => onChange(customKey(port.id), value)}
            />
          ))}
        </div>
      )}

      {tools}

      <div className="form last-run">
        <div className="section-head">
          <h4>Last run</h4>
          {lastStep ? (
            <p className="muted small row">
              <StatusIcon status={lastStep.status} /> {new Date(lastStep.startedAt).toLocaleTimeString()} · {duration(lastStep.ms)}
              {lastStep.path ? ` · took ${lastStep.path}` : ""}
            </p>
          ) : (
            <p className="muted small">Run the bot and trigger this flow to see what this node received and produced.</p>
          )}
        </div>
        {lastStep?.error && <p className="error small">{lastStep.error}</p>}
        {lastStep && lastStep.inputs !== undefined && (
          <div>
            <h5>Inputs</h5>
            <JsonView value={lastStep.inputs} empty="No inputs" />
          </div>
        )}
        {lastStep && lastStep.outputs !== undefined && (
          <div>
            <h5>Outputs</h5>
            <JsonView value={lastStep.outputs} empty="No outputs" />
          </div>
        )}
      </div>

      <footer className="inspector-foot">
        <code className="muted small">{node.id}</code>
        <span className="row">
          <button className="link muted" onClick={onDuplicate}>
            <Copy size={13} /> Duplicate
          </button>
          <button className="link danger" onClick={onDelete}>
            <Trash2 size={13} /> Delete
          </button>
        </span>
      </footer>
    </aside>
  );
}

const EXAMPLES: Record<Platform, Partial<Record<PortType, string>>> = {
  discord: {
    user: "message.mentions.users.first()",
    member: "guild.members.cache.get(\"123456789\")",
    channel: "guild.channels.cache.get(\"123456789\")",
    message: "await channel.messages.fetch(\"123456789\")",
    guild: "client.guilds.cache.get(\"123456789\")",
    role: "guild.roles.cache.find((role) => role.name === \"VIP\")",
    list: "[\"red\", \"blue\"]",
    string: "\"Hello\"",
    number: "42",
    boolean: "true",
    any: "{ name: user.username }",
  },
  telegram: {
    user: "message.reply_to_message?.from",
    channel: "-1001234567890",
    message: "message.reply_to_message",
    list: "[\"red\", \"blue\"]",
    string: "\"Hello\"",
    number: "42",
    boolean: "true",
    any: "{ name: user.first_name }",
  },
};

type ListField = Extract<FieldDef, { kind: "list" }>;

function ItemName({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const clean = draft.trim();
    if (clean && clean !== value) onCommit(clean);
    else setDraft(value);
  };
  return (
    <input
      className="mono item-name"
      value={draft}
      aria-label="Name"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(value);
      }}
    />
  );
}

function ListEditor({
  field,
  values,
  sources,
  onPatch,
  onRewire,
  onDisconnect,
}: {
  field: ListField;
  values: Record<string, FieldValue>;
  sources: Map<string, Source[]>;
  onPatch: (patch: Record<string, FieldValue | undefined>) => void;
  onRewire: (from: string, to: string | null) => void;
  onDisconnect: (port: string) => void;
}) {
  const items = listItems(values[field.id] ?? field.default);
  const prefix = field.portPrefix;
  const noun = field.itemLabel ?? "item";

  const rename = (index: number, name: string) => {
    const unique = uniqueName(items.filter((_, position) => position !== index), name);
    const next = items.map((item, position) => (position === index ? unique : item));
    const patch: Record<string, FieldValue | undefined> = { [field.id]: next.join("\n") };
    if (prefix) {
      const from = itemPort(prefix, items[index]);
      const to = itemPort(prefix, unique);
      patch[customKey(from)] = undefined;
      if (values[customKey(from)] !== undefined) patch[customKey(to)] = values[customKey(from)];
      onRewire(from, to);
    }
    onPatch(patch);
  };

  const remove = (index: number) => {
    const patch: Record<string, FieldValue | undefined> = { [field.id]: items.filter((_, position) => position !== index).join("\n") };
    if (prefix) {
      const port = itemPort(prefix, items[index]);
      patch[customKey(port)] = undefined;
      onRewire(port, null);
    }
    onPatch(patch);
  };

  return (
    <div className="field">
      <span className="field-label">
        {field.label}
        <em>{items.length}</em>
      </span>
      <div className="list-editor">
        {items.length === 0 && <p className="muted small">No {noun}s yet.</p>}
        {items.map((item, index) => {
          const port = prefix ? itemPort(prefix, item) : "";
          const source = prefix ? sources.get(port)?.[0]?.label : undefined;
          return (
            <div className="list-row" key={`${item}-${index}`}>
              <ItemName value={item} onCommit={(name) => rename(index, name)} />
              {prefix &&
                (source ? (
                  <ConnectedNote source={source} onDisconnect={() => onDisconnect(port)} />
                ) : (
                  <input
                    className="mono"
                    placeholder="value or wire"
                    aria-label={`Value of ${item}`}
                    value={String(values[customKey(port)] ?? "")}
                    onChange={(event) => onPatch({ [customKey(port)]: event.target.value || undefined })}
                  />
                ))}
              <button className="icon-button small" onClick={() => remove(index)} aria-label={`Remove ${item}`} title={`Remove ${noun}`}>
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
        <button className="button small" onClick={() => onPatch({ [field.id]: [...items, uniqueName(items, noun)].join("\n") })}>
          <Plus size={13} /> Add {noun}
        </button>
      </div>
      {field.help && <small className="muted">{field.help}</small>}
    </div>
  );
}

function ConnectedNote({ source, onDisconnect }: { source: string; onDisconnect: () => void }) {
  return (
    <div className="connected-note">
      <Link2 size={13} />
      <span className="grow">From {source}</span>
      <button className="icon-button small" onClick={onDisconnect} aria-label="Remove this connection" title="Remove this connection">
        <Unlink size={13} />
      </button>
    </div>
  );
}

function PortInput({
  port,
  platform,
  nodeId,
  value,
  source,
  onDisconnect,
  onChange,
}: {
  port: PortDef;
  platform: Platform;
  nodeId: string;
  value: string;
  source: string | undefined;
  onDisconnect: () => void;
  onChange: (value: string) => void;
}) {
  const id = `input-${nodeId}-${port.id}`;
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">
        {portLabel(port, platform)}
        <em>
          <i className={`type-dot handle-${port.type}`} /> {port.type}
          {port.optional ? " · optional" : ""}
        </em>
      </span>
      {source ? (
        <ConnectedNote source={source} onDisconnect={onDisconnect} />
      ) : (
        <input
          id={id}
          className="mono"
          spellCheck={false}
          placeholder={EXAMPLES[platform][port.type] ?? ""}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

export interface Source {
  label: string;
  edgeId: string;
}

function Field({
  field,
  nodeId,
  value,
  sources,
  onRemoveEdge,
  onDisconnect,
  onChange,
}: {
  field: FieldDef;
  nodeId: string;
  value: FieldValue | undefined;
  sources: Source[];
  onRemoveEdge: (edgeId: string) => void;
  onDisconnect: () => void;
  onChange: (value: FieldValue) => void;
}) {
  const id = `field-${nodeId}-${field.id}`;
  const source = sources[0]?.label;
  const label = (
    <span className="field-label">
      {field.label}
      {field.required && !source && <em>required</em>}
    </span>
  );

  if (source && field.kind === "text") {
    const text = String(value ?? "");
    return (
      <div className="field">
        {label}
        <div className="wire-list">
          {sources.map((item, index) => (
            <div className="wire-chip" key={item.edgeId}>
              <button
                className="wire-ref"
                onClick={() => onChange(`${text}{{ $${index + 1} }}`)}
                title={`Insert {{ $${index + 1} }} into the text`}
              >
                ${index + 1}
              </button>
              <span className="grow">{item.label}</span>
              <button className="icon-button small" onClick={() => onRemoveEdge(item.edgeId)} aria-label="Remove this connection" title="Remove this connection">
                <Unlink size={13} />
              </button>
            </div>
          ))}
        </div>
        <textarea
          id={id}
          rows={2}
          placeholder={sources.length > 1 ? "Empty: the values are joined in order" : "Empty: the connected value is used as is"}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
        <small className="muted">Write {"{{ $1 }}"} to place a connected value inside your text. You can connect more wires to this input.</small>
      </div>
    );
  }

  if (source) {
    return (
      <div className="field">
        {label}
        <ConnectedNote source={source} onDisconnect={onDisconnect} />
      </div>
    );
  }

  let control;
  switch (field.kind) {
    case "boolean":
      return (
        <label className="field checkbox" htmlFor={id}>
          <input id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
          <span>{field.label}</span>
        </label>
      );
    case "number":
      control = (
        <input
          id={id}
          type="number"
          value={value === undefined ? "" : Number(value)}
          min={field.min}
          max={field.max}
          onChange={(event) => onChange(event.target.value === "" ? 0 : Number(event.target.value))}
        />
      );
      break;
    case "model": {
      const models = currentDatabase()?.models ?? [];
      control = (
        <select id={id} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
          <option value="" disabled>
            {models.length ? "Choose a model" : "No models yet"}
          </option>
          {models.map((model) => (
            <option key={model.name} value={model.name}>
              {model.name}
            </option>
          ))}
          {value && !models.some((model) => model.name === value) && <option value={String(value)}>{String(value)} (missing)</option>}
        </select>
      );
      break;
    }
    case "select":
      control = (
        <select id={id} value={String(value ?? field.default)} onChange={(event) => onChange(event.target.value)}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
      break;
    case "code":
      control = (
        <textarea
          id={id}
          className="code-input"
          spellCheck={false}
          rows={10}
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            event.preventDefault();
            const target = event.currentTarget;
            const start = target.selectionStart;
            onChange(`${target.value.slice(0, start)}  ${target.value.slice(target.selectionEnd)}`);
            requestAnimationFrame(() => target.setSelectionRange(start + 2, start + 2));
          }}
        />
      );
      break;
    case "expression":
      control = (
        <input
          id={id}
          className="mono"
          spellCheck={false}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
        />
      );
      break;
    default:
      control = field.kind === "text" && field.multiline ? (
        <textarea
          id={id}
          rows={3}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input id={id} placeholder={field.placeholder} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />
      );
  }

  return (
    <label className="field" htmlFor={id}>
      {label}
      {control}
      {field.help && <small className="muted">{field.help}</small>}
    </label>
  );
}
