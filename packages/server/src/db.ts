import Database from "better-sqlite3-multiple-ciphers";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Flow, Platform, Project, ProjectSummary } from "@open-sila/core";
import { randomId, sha256 } from "./crypto.js";

type Connection = InstanceType<typeof Database>;

const MIGRATIONS = [
  `CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL,
    flow TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE secrets (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, name)
  );
  CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE TABLE sessions (
    hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );`,
  `CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    flow TEXT NOT NULL,
    nodes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX versions_project ON versions(project_id, created_at);`,
];

const MAX_VERSIONS = 50;

export interface VersionInfo {
  id: string;
  label: string;
  nodes: number;
  createdAt: string;
}

export type KeyScope = "read" | "write";

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scope: KeyScope;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface SecretInfo {
  name: string;
  preview: string;
  updatedAt: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  platform: Platform;
  flow: string;
  created_at: string;
  updated_at: string;
}

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scope: KeyScope;
  created_at: string;
  last_used_at: string | null;
}

const now = () => new Date().toISOString();

function summary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    platform: row.platform,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function key(row: KeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scope: row.scope,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export class Store {
  readonly db: Connection;

  constructor(dataDir: string, masterKey: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, "sila.db"));
    this.db.pragma(`hexkey='${masterKey}'`);
    try {
      this.db.prepare("SELECT count(*) FROM sqlite_master").get();
    } catch {
      this.db.close();
      throw new Error("Could not open the database. The encryption key does not match this data directory.");
    }
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    for (let index = version; index < MIGRATIONS.length; index++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[index]);
        this.db.pragma(`user_version = ${index + 1}`);
      })();
    }
  }

  close(): void {
    this.db.close();
  }

  listProjects(): ProjectSummary[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];
    return rows.map(summary);
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? { ...summary(row), flow: JSON.parse(row.flow) as Flow } : undefined;
  }

  createProject(input: { name: string; description: string; platform: Platform; flow?: Flow }): Project {
    const id = randomId();
    const timestamp = now();
    const flow = input.flow ?? { nodes: [], edges: [] };
    this.db
      .prepare(
        "INSERT INTO projects (id, name, description, platform, flow, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, input.name, input.description, input.platform, JSON.stringify(flow), timestamp, timestamp);
    return this.getProject(id) as Project;
  }

  updateProject(id: string, patch: { name?: string; description?: string; flow?: Flow }): Project | undefined {
    const current = this.getProject(id);
    if (!current) return undefined;
    this.db
      .prepare("UPDATE projects SET name = ?, description = ?, flow = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.name ?? current.name,
        patch.description ?? current.description,
        JSON.stringify(patch.flow ?? current.flow),
        now(),
        id,
      );
    return this.getProject(id);
  }

  listVersions(projectId: string): VersionInfo[] {
    return this.db
      .prepare("SELECT id, label, nodes, created_at AS createdAt FROM versions WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as VersionInfo[];
  }

  getVersion(projectId: string, id: string): (VersionInfo & { flow: Flow }) | undefined {
    const row = this.db
      .prepare("SELECT id, label, nodes, flow, created_at AS createdAt FROM versions WHERE project_id = ? AND id = ?")
      .get(projectId, id) as (VersionInfo & { flow: string }) | undefined;
    return row ? { ...row, flow: JSON.parse(row.flow) as Flow } : undefined;
  }

  addVersion(projectId: string, label: string, flow: Flow): VersionInfo {
    const serialized = JSON.stringify(flow);
    const latest = this.db
      .prepare("SELECT flow FROM versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(projectId) as { flow: string } | undefined;
    const id = randomId();
    const createdAt = now();
    if (latest?.flow === serialized && label !== "Before restore") {
      this.db.prepare("UPDATE versions SET label = ?, created_at = ? WHERE id = (SELECT id FROM versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1)").run(label, createdAt, projectId);
      return this.listVersions(projectId)[0];
    }
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO versions (id, project_id, label, flow, nodes, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, projectId, label, serialized, flow.nodes.length, createdAt);
      this.db
        .prepare(
          "DELETE FROM versions WHERE project_id = ? AND id NOT IN (SELECT id FROM versions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?)",
        )
        .run(projectId, projectId, MAX_VERSIONS);
    })();
    return { id, label, nodes: flow.nodes.length, createdAt };
  }

  deleteProject(id: string): boolean {
    return this.db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
  }

  listSecrets(projectId: string): SecretInfo[] {
    const rows = this.db
      .prepare("SELECT name, value, updated_at FROM secrets WHERE project_id = ? ORDER BY name")
      .all(projectId) as { name: string; value: string; updated_at: string }[];
    return rows.map((row) => ({
      name: row.name,
      preview: row.value.length > 8 ? `••••${row.value.slice(-4)}` : "••••",
      updatedAt: row.updated_at,
    }));
  }

  readSecrets(projectId: string): Record<string, string> {
    const rows = this.db.prepare("SELECT name, value FROM secrets WHERE project_id = ?").all(projectId) as {
      name: string;
      value: string;
    }[];
    return Object.fromEntries(rows.map((row) => [row.name, row.value]));
  }

  setSecret(projectId: string, name: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO secrets (project_id, name, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id, name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(projectId, name, value, now());
  }

  deleteSecret(projectId: string, name: string): boolean {
    return this.db.prepare("DELETE FROM secrets WHERE project_id = ? AND name = ?").run(projectId, name).changes > 0;
  }

  listKeys(): ApiKey[] {
    const rows = this.db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all() as KeyRow[];
    return rows.map(key);
  }

  createKey(name: string, scope: KeyScope, secret: string): ApiKey {
    const id = randomId();
    this.db
      .prepare("INSERT INTO api_keys (id, name, prefix, hash, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, name, secret.slice(0, 12), sha256(secret), scope, now());
    return key(this.db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as KeyRow);
  }

  findKey(secret: string): ApiKey | undefined {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE hash = ?").get(sha256(secret)) as KeyRow | undefined;
    if (!row) return undefined;
    this.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(now(), row.id);
    return key(row);
  }

  deleteKey(id: string): boolean {
    return this.db.prepare("DELETE FROM api_keys WHERE id = ?").run(id).changes > 0;
  }

  createSession(token: string, days: number): void {
    const expires = new Date(Date.now() + days * 86_400_000).toISOString();
    this.db.prepare("INSERT INTO sessions (hash, created_at, expires_at) VALUES (?, ?, ?)").run(sha256(token), now(), expires);
  }

  hasSession(token: string): boolean {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now());
    return this.db.prepare("SELECT 1 FROM sessions WHERE hash = ?").get(sha256(token)) !== undefined;
  }

  deleteSession(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE hash = ?").run(sha256(token));
  }
}
