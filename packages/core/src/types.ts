import type { Database } from "./database.js";

export type Platform = "discord" | "telegram";

export const PLATFORMS: readonly Platform[] = ["discord", "telegram"];

export type PortType =
  | "exec"
  | "string"
  | "number"
  | "boolean"
  | "user"
  | "member"
  | "channel"
  | "message"
  | "role"
  | "guild"
  | "list"
  | "any";

export type Category = "trigger" | "action" | "logic" | "data" | "code";

export interface PortDef {
  id: string;
  label: string;
  type: PortType;
  optional?: boolean;
  field?: boolean;
  scoped?: string;
  variants?: Partial<Record<Platform, { label: string }>>;
}

export interface FieldVariant {
  label?: string;
  placeholder?: string;
  help?: string;
}

interface FieldBase {
  id: string;
  label: string;
  help?: string;
  required?: boolean;
  static?: boolean;
  platforms?: Platform[];
  variants?: Partial<Record<Platform, FieldVariant>>;
}

export interface SelectOption {
  value: string;
  label: string;
  platforms?: Platform[];
}

export type FieldDef =
  | (FieldBase & { kind: "text"; default?: string; placeholder?: string; multiline?: boolean })
  | (FieldBase & { kind: "expression"; default?: string; placeholder?: string })
  | (FieldBase & { kind: "number"; default?: number; min?: number; max?: number })
  | (FieldBase & { kind: "boolean"; default?: boolean })
  | (FieldBase & { kind: "select"; default: string; options: SelectOption[] })
  | (FieldBase & { kind: "code"; default?: string })
  | (FieldBase & { kind: "list"; default?: string; placeholder?: string; itemLabel?: string; portPrefix?: string })
  | (FieldBase & { kind: "model"; default?: string });

export type FieldValue = string | number | boolean;

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, FieldValue>;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
  database?: Database;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  platform: Platform;
  createdAt: string;
  updatedAt: string;
}

export interface Project extends ProjectSummary {
  flow: Flow;
}

export type TriggerContext = "interaction" | "message" | "member" | "none";

export interface TriggerScope {
  context: TriggerContext;
  vars: Record<string, string>;
}

export interface Requirements {
  intents: string[];
  permissions: string[];
  partials: string[];
  updates: string[];
}

export interface EmitContext {
  platform: Platform;
  node: FlowNode;
  trigger: TriggerScope;
  value(id: string): string;
  connected(id: string): boolean;
  field<T extends FieldValue = FieldValue>(id: string): T;
  out(id: string): string;
  declare(id: string): string;
  branch(port: string): string;
  use(name: string): string;
  helper(name: RuntimeHelper): string;
  fail(message: string): never;
}

export type RuntimeHelper = "respond" | "resolveChannel" | "chatId" | "store" | "sleep" | "cooldown" | "toText" | "memory" | "refs" | "db" | "toCreate" | "schedule" | "http" | "replies";

export interface CommandOption {
  name: string;
  description: string;
  type: number;
  required?: boolean;
  choices?: { name: string; value: string | number }[];
  autocomplete?: boolean;
  options?: CommandOption[];
}

export interface CommandSpec {
  name: string;
  description?: string;
  type?: number;
  options?: CommandOption[];
  group?: string;
  sub?: string;
  default_member_permissions?: string;
  contexts?: number[];
  name_localizations?: Record<string, string>;
  description_localizations?: Record<string, string>;
}

export interface TriggerEmit {
  file: string;
  scope: TriggerScope;
  wrap(body: string): string;
  order?: number;
  command?: CommandSpec;
  requires?: Partial<Requirements>;
}

export interface NodeDefinition {
  type: string;
  label: string;
  description: string;
  category: Category;
  icon?: string;
  platforms: readonly Platform[];
  inputs: PortDef[];
  outputs: PortDef[];
  fields: FieldDef[];
  ports?(data: Record<string, FieldValue>): { inputs?: PortDef[]; outputs?: PortDef[] };
  requires?: Partial<Record<Platform, Partial<Requirements>>>;
  trigger?(ctx: EmitContext): TriggerEmit;
  emit?(ctx: EmitContext): string;
  expression?(ctx: EmitContext, output: string): string;
}

export interface Diagnostic {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface CompileOptions {
  mode: "development" | "production";
  name?: string;
}

export interface CompileResult {
  ok: boolean;
  files: GeneratedFile[];
  diagnostics: Diagnostic[];
  requirements: Requirements & { env: string[] };
}
