import type { Platform } from "@open-sila/core";
import { useEffect, useState, type FormEvent } from "react";
import { api, type SecretInfo } from "../api";
import { Dialog } from "./Dialog";

const TOKEN: Record<Platform, string> = { discord: "DISCORD_TOKEN", telegram: "TELEGRAM_TOKEN" };

export function SecretsDialog({
  projectId,
  platform,
  suggest,
  onClose,
}: {
  projectId: string;
  platform: Platform;
  suggest?: string;
  onClose: () => void;
}) {
  const [secrets, setSecrets] = useState<SecretInfo[]>([]);
  const [name, setName] = useState(suggest ?? TOKEN[platform]);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const load = () => api.secrets(projectId).then(setSecrets);

  useEffect(() => {
    void load();
  }, [projectId]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await api.setSecret(projectId, name.trim(), value);
      setValue("");
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const remove = async (secret: string) => {
    await api.deleteSecret(projectId, secret);
    await load();
  };

  return (
    <Dialog title="Secrets" onClose={onClose}>
      <p className="muted small">
        Stored in the encrypted local database and passed to the bot as environment variables. Values are never shown again
        after saving.
      </p>
      {platform === "discord" && (
        <p className="muted small">
          Add <code>DISCORD_GUILD_ID</code> with your test server ID to register slash commands there instantly.
        </p>
      )}
      <ul className="secret-list">
        {secrets.length === 0 && <li className="muted">No secrets yet. Add {TOKEN[platform]} to run the bot.</li>}
        {secrets.map((secret) => (
          <li key={secret.name}>
            <code>{secret.name}</code>
            <span className="muted mono">{secret.preview}</span>
            <button className="link" onClick={() => setName(secret.name)}>
              Replace
            </button>
            <button className="link danger" onClick={() => remove(secret.name)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form className="form" onSubmit={save}>
        <div className="row">
          <label className="grow">
            Name
            <input id="secret-name" className="mono" value={name} onChange={(event) => setName(event.target.value.toUpperCase())} />
          </label>
          <label className="grow">
            Value
            <input id="secret-value" type="password" autoComplete="off" value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row end">
          <button type="submit" className="button primary" disabled={!name.trim() || !value}>
            Save secret
          </button>
        </div>
      </form>
    </Dialog>
  );
}
