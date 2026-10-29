import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";

const require = createRequire(import.meta.url);

// Packages that install native engines need their install scripts.
const TRUSTED_SCRIPTS = ["prisma", "@prisma/client", "@prisma/engines"];

function bundledModules(): string {
  const entry = require.resolve("discord.js");
  const marker = `${sep}node_modules${sep}`;
  return entry.slice(0, entry.lastIndexOf(marker) + marker.length - 1);
}

function versionOf(folder: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

function satisfies(installed: string | undefined, wanted: string): boolean {
  if (!installed) return false;
  if (/^\d/.test(wanted)) return installed === wanted;
  const major = wanted.replace(/^[\^~]/, "").split(".")[0];
  return installed.split(".")[0] === major;
}

function npm(args: string[], cwd: string): Promise<string> {
  const bundled = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const cli = process.env.npm_execpath?.endsWith(".js") ? process.env.npm_execpath : existsSync(bundled) ? bundled : undefined;
  return new Promise((resolve, reject) => {
    const done = (error: Error | null, stdout: string, stderr: string) => (error ? reject(new Error(`${stderr}\n${stdout}`.trim() || error.message)) : resolve(stdout));
    if (cli) execFile(process.execPath, [cli, ...args], { cwd, maxBuffer: 20 * 1024 * 1024 }, done);
    else execFile("npm", args, { cwd, shell: true, maxBuffer: 20 * 1024 * 1024 }, done);
  });
}

export function unlinkModules(root: string): void {
  const folder = join(root, "node_modules");
  if (!existsSync(folder)) return;
  if (lstatSync(folder).isSymbolicLink()) return unlinkSync(folder);
  for (const entry of readdirSync(folder)) {
    const path = join(folder, entry);
    if (lstatSync(path).isSymbolicLink()) unlinkSync(path);
    else if (entry.startsWith("@")) {
      for (const scoped of readdirSync(path)) {
        const inner = join(path, scoped);
        if (lstatSync(inner).isSymbolicLink()) unlinkSync(inner);
      }
    }
  }
}

// Gives each bot only the packages its package.json asks for: from the dashboard's own install when present,
// otherwise installed once into a shared cache the first time a bot needs them.
export class Modules {
  private readonly cache: string;
  private pending: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.cache = join(dataDir, "packages");
  }

  private find(name: string, wanted: string): string | undefined {
    for (const base of [bundledModules(), join(this.cache, "node_modules")]) {
      const folder = join(base, ...name.split("/"));
      if (satisfies(versionOf(folder), wanted)) return folder;
    }
    return undefined;
  }

  async ensure(dependencies: Record<string, string>, log: (message: string) => void): Promise<Record<string, string>> {
    const missing = Object.entries(dependencies).filter(([name, wanted]) => !this.find(name, wanted));
    if (missing.length > 0) {
      const install = this.pending.then(async () => {
        const still = missing.filter(([name, wanted]) => !this.find(name, wanted));
        if (still.length === 0) return;
        mkdirSync(this.cache, { recursive: true });
        const manifest = join(this.cache, "package.json");
        if (!existsSync(manifest)) {
          writeFileSync(manifest, `${JSON.stringify({ private: true, allowScripts: Object.fromEntries(TRUSTED_SCRIPTS.map((name) => [name, true])) }, null, 2)}\n`);
        }
        log(`Installing ${still.map(([name, wanted]) => `${name}@${wanted}`).join(", ")} (first time only, needs internet)`);
        await npm(["install", "--no-audit", "--no-fund", "--loglevel=error", ...still.map(([name, wanted]) => `${name}@${wanted}`)], this.cache);
      });
      this.pending = install.catch(() => undefined);
      await install;
    }
    const paths: Record<string, string> = {};
    for (const [name, wanted] of Object.entries(dependencies)) {
      const folder = this.find(name, wanted);
      if (!folder) throw new Error(`Could not install ${name}@${wanted}.`);
      paths[name] = folder;
    }
    return paths;
  }

  link(root: string, paths: Record<string, string>): void {
    unlinkModules(root);
    const folder = join(root, "node_modules");
    mkdirSync(folder, { recursive: true });
    for (const [name, target] of Object.entries(paths)) {
      const path = join(folder, ...name.split("/"));
      mkdirSync(dirname(path), { recursive: true });
      symlinkSync(target, path, "junction");
    }
  }

  resolve(paths: Record<string, string>, name: string, file: string): string {
    return join(paths[name], file);
  }
}
