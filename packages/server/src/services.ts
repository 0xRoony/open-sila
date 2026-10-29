import JSZip from "jszip";
import {
  compileProject,
  createProjectSchema,
  projectDocumentSchema,
  toProjectDocument,
  flowSchema,
  updateProjectSchema,
  validateFlow,
  type CompileResult,
  type Diagnostic,
  type Project,
} from "@open-sila/core";
import type { Store } from "./db.js";
import type { Runner } from "./runner.js";

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found.`);
  }
}

export class InputError extends Error {}

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

function fileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sila-bot";
}

export class Services {
  constructor(
    readonly store: Store,
    readonly runner: Runner,
  ) {}

  project(id: string): Project {
    const project = this.store.getProject(id);
    if (!project) throw new NotFoundError("Project");
    return project;
  }

  listProjects() {
    return this.store.listProjects().map((project) => ({ ...project, bot: this.runner.status(project.id).state }));
  }

  createProject(input: unknown): Project {
    const parsed = createProjectSchema.parse(input);
    return this.store.createProject(parsed);
  }

  updateProject(id: string, input: unknown): { project: Project; diagnostics: Diagnostic[] } {
    const patch = updateProjectSchema.parse(input);
    const project = this.store.updateProject(id, patch);
    if (!project) throw new NotFoundError("Project");
    return { project, diagnostics: validateFlow(project.flow, project.platform) };
  }

  setFlow(id: string, flow: unknown) {
    return this.updateProject(id, { flow: flowSchema.parse(flow) });
  }

  async deleteProject(id: string): Promise<void> {
    this.project(id);
    await this.runner.stop(id);
    this.runner.forget(id);
    this.store.deleteProject(id);
  }

  validate(id: string): Diagnostic[] {
    const project = this.project(id);
    return validateFlow(project.flow, project.platform);
  }

  compile(id: string, mode: "development" | "production" = "production"): CompileResult {
    const project = this.project(id);
    return compileProject(project, { mode });
  }

  exportDocument(id: string) {
    const project = this.project(id);
    return { name: `${fileName(project.name)}.sila.json`, document: toProjectDocument(project) };
  }

  importDocument(input: unknown, name?: string): { project: Project; diagnostics: Diagnostic[] } {
    const parsed = projectDocumentSchema.safeParse(input);
    if (!parsed.success) {
      throw new InputError("This is not an Open Sila project file. Export one from the editor with Export > Project file.");
    }
    const { project: source } = parsed.data;
    const project = this.store.createProject({ ...source, name: name?.trim() || source.name });
    return { project, diagnostics: validateFlow(project.flow, project.platform) };
  }

  async exportZip(id: string): Promise<{ name: string; data: Buffer }> {
    const project = this.project(id);
    const result = compileProject(project, { mode: "production" });
    if (!result.ok) throw new InputError(result.diagnostics.find((item) => item.level === "error")?.message ?? "Fix the errors before exporting.");
    const zip = new JSZip();
    const folder = fileName(project.name);
    for (const file of result.files) zip.file(`${folder}/${file.path}`, file.content);
    return { name: `${folder}.zip`, data: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) };
  }

  listSecrets(id: string) {
    this.project(id);
    return this.store.listSecrets(id);
  }

  setSecret(id: string, name: string, value: unknown): void {
    this.project(id);
    if (!SECRET_NAME.test(name)) throw new InputError("Secret names use capital letters, digits and underscores, like DISCORD_TOKEN.");
    if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
      throw new InputError("Secret value must be a non-empty string.");
    }
    this.store.setSecret(id, name, value);
  }

  deleteSecret(id: string, name: string): void {
    this.project(id);
    if (!this.store.deleteSecret(id, name)) throw new NotFoundError("Secret");
  }

  startBot(id: string) {
    const project = this.project(id);
    this.store.addVersion(id, "Started the bot", project.flow);
    return this.runner.start(project, this.store.readSecrets(id));
  }

  listVersions(id: string) {
    this.project(id);
    return this.store.listVersions(id);
  }

  saveVersion(id: string, label: string) {
    const project = this.project(id);
    return this.store.addVersion(id, label.trim() || "Saved version", project.flow);
  }

  getVersion(id: string, versionId: string) {
    this.project(id);
    const version = this.store.getVersion(id, versionId);
    if (!version) throw new NotFoundError("Version");
    return version;
  }

  restoreVersion(id: string, versionId: string) {
    const project = this.project(id);
    const version = this.getVersion(id, versionId);
    this.store.addVersion(id, "Before restore", project.flow);
    return this.setFlow(id, version.flow);
  }

  runManual(id: string, nodeId: string, payload: unknown) {
    const project = this.project(id);
    const node = project.flow.nodes.find((item) => item.id === nodeId);
    if (!node || node.type !== "core.manual") throw new NotFoundError("Manual run trigger");
    try {
      this.runner.trigger(id, nodeId, payload);
    } catch (error) {
      throw new InputError((error as Error).message);
    }
    return { sent: true };
  }

  stopBot(id: string) {
    this.project(id);
    return this.runner.stop(id);
  }

  botStatus(id: string) {
    this.project(id);
    return this.runner.status(id);
  }
}
