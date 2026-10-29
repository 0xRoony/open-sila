import {
  DATABASE_PROVIDERS,
  EXAMPLE_URLS,
  FIELD_TYPES,
  PROVIDER_LABELS,
  databaseProblems,
  type Database,
  type DatabaseProvider,
  type Model,
  type ModelField,
} from "@open-sila/core";
import { ChevronDown, ChevronRight, CircleAlert, Database as DatabaseIcon, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

interface Props {
  database: Database | undefined;
  onChange: (database: Database | undefined) => void;
  onSecrets: () => void;
}

function freeName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let index = 2;
  while (taken.includes(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}

const STARTER: Model = {
  name: "User",
  fields: [
    { name: "userId", type: "String", optional: false, unique: true, list: false },
    { name: "points", type: "Int", optional: false, unique: false, list: false, default: "0" },
  ],
};

export function DataPanel({ database, onChange, onSecrets }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (!database) {
    return (
      <div className="data-panel">
        <div className="data-empty">
          <DatabaseIcon size={28} />
          <p>Store records in a real database through Prisma. Pick SQLite to start; it needs no server.</p>
          <button className="button primary" onClick={() => onChange({ provider: "sqlite", models: [STARTER] })}>
            <Plus size={14} /> Add a database
          </button>
        </div>
      </div>
    );
  }

  const problems = databaseProblems(database);
  const setModels = (models: Model[]) => onChange({ ...database, models });
  const updateModel = (index: number, model: Model) => setModels(database.models.map((item, at) => (at === index ? model : item)));
  const updateField = (model: number, index: number, patch: Partial<ModelField>) => {
    const target = database.models[model];
    updateModel(model, { ...target, fields: target.fields.map((field, at) => (at === index ? { ...field, ...patch } : field)) });
  };

  const addModel = () => {
    const name = freeName("Record", database.models.map((model) => model.name));
    setModels([...database.models, { name, fields: [{ name: "name", type: "String", optional: false, unique: false, list: false }] }]);
    setOpen((current) => ({ ...current, [name]: true }));
  };

  return (
    <div className="data-panel">
      <label className="field">
        <span className="field-label">Database</span>
        <select value={database.provider} onChange={(event) => onChange({ ...database, provider: event.target.value as DatabaseProvider })}>
          {DATABASE_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {PROVIDER_LABELS[provider]}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        {database.provider === "sqlite" ? (
          <>The bot keeps a local file automatically. Add a DATABASE_URL secret to use another file.</>
        ) : (
          <>
            Add a <code>DATABASE_URL</code> secret, like <code className="break">{EXAMPLE_URLS[database.provider]}</code>
            {database.provider === "mongodb" && <>. MongoDB must run as a replica set; Atlas does by default.</>}
          </>
        )}
      </p>
      {database.provider !== "sqlite" && (
        <button className="button small" onClick={onSecrets}>
          <KeyRound size={13} /> Open secrets
        </button>
      )}

      {problems.length > 0 && (
        <ul className="data-problems">
          {problems.map((problem) => (
            <li key={problem}>
              <CircleAlert size={13} /> {problem}
            </li>
          ))}
        </ul>
      )}

      <h4 className="section-title">Models</h4>
      {database.models.map((model, modelIndex) => {
        const expanded = open[model.name] ?? database.models.length <= 2;
        return (
          <section key={modelIndex} className="data-model">
            <header>
              <button
                className="icon-button small"
                onClick={() => setOpen((current) => ({ ...current, [model.name]: !expanded }))}
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <input
                className="data-model-name"
                value={model.name}
                aria-label="Model name"
                spellCheck={false}
                onChange={(event) => {
                  const name = event.target.value.replace(/[^A-Za-z0-9_]/g, "");
                  setOpen((current) => ({ ...current, [name]: expanded }));
                  updateModel(modelIndex, { ...model, name });
                }}
              />
              <small className="muted">{model.fields.length + 3} columns</small>
              <button
                className="icon-button small"
                aria-label={`Delete ${model.name}`}
                title="Delete model"
                onClick={() => setModels(database.models.filter((_, at) => at !== modelIndex))}
              >
                <Trash2 size={13} />
              </button>
            </header>
            {expanded && (
              <div className="data-fields">
                <div className="data-field fixed">
                  <span className="mono">id</span>
                  <span className="muted">{database.provider === "mongodb" ? "ObjectId" : "Int"}, automatic</span>
                </div>
                {model.fields.map((field, fieldIndex) => (
                  <div key={fieldIndex} className="data-field">
                    <input
                      className="mono"
                      aria-label="Field name"
                      spellCheck={false}
                      value={field.name}
                      onChange={(event) => updateField(modelIndex, fieldIndex, { name: event.target.value.replace(/[^A-Za-z0-9_]/g, "") })}
                    />
                    <select
                      aria-label="Field type"
                      value={field.type}
                      onChange={(event) => updateField(modelIndex, fieldIndex, { type: event.target.value as ModelField["type"] })}
                    >
                      {FIELD_TYPES.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                    <button
                      className="icon-button small"
                      aria-label={`Delete ${field.name}`}
                      onClick={() => updateModel(modelIndex, { ...model, fields: model.fields.filter((_, at) => at !== fieldIndex) })}
                    >
                      <Trash2 size={12} />
                    </button>
                    <div className="data-flags">
                      {(["optional", "unique", "list"] as const).map((flag) => (
                        <label key={flag} className={field[flag] ? "on" : ""}>
                          <input type="checkbox" checked={field[flag]} onChange={(event) => updateField(modelIndex, fieldIndex, { [flag]: event.target.checked })} />
                          {flag}
                        </label>
                      ))}
                      <input
                        className="mono data-default"
                        placeholder="default"
                        aria-label="Default value"
                        value={field.default ?? ""}
                        onChange={(event) => updateField(modelIndex, fieldIndex, { default: event.target.value || undefined })}
                      />
                    </div>
                  </div>
                ))}
                <div className="data-field fixed">
                  <span className="mono">createdAt, updatedAt</span>
                  <span className="muted">DateTime, automatic</span>
                </div>
                <button
                  className="button ghost small"
                  onClick={() =>
                    updateModel(modelIndex, {
                      ...model,
                      fields: [
                        ...model.fields,
                        { name: freeName("field", model.fields.map((item) => item.name)), type: "String", optional: true, unique: false, list: false },
                      ],
                    })
                  }
                >
                  <Plus size={13} /> Add field
                </button>
              </div>
            )}
          </section>
        );
      })}
      <div className="data-actions">
        <button className="button small" onClick={addModel}>
          <Plus size={13} /> Add model
        </button>
        <button className="button ghost small" onClick={() => onChange(undefined)}>
          Remove database
        </button>
      </div>
      <p className="muted small">
        Use the Create, Find, Update, Save, Delete and Count record nodes in the Data category to work with these models.
      </p>
    </div>
  );
}
