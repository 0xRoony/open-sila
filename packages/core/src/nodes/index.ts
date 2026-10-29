import type { FieldDef, FieldValue, NodeDefinition, Platform, PortDef } from "../types.js";
import { coreNodes } from "./core.js";
import { databaseNodes } from "./database.js";
import { extraNodes } from "./extra.js";
import { discordNodes } from "./discord.js";
import { telegramNodes } from "./telegram.js";

const registry = new Map<string, NodeDefinition>();

export function registerNode(definition: NodeDefinition): void {
  if (registry.has(definition.type)) throw new Error(`Node type ${definition.type} is already registered`);
  registry.set(definition.type, definition);
}

for (const definition of [...coreNodes, ...extraNodes, ...databaseNodes, ...discordNodes, ...telegramNodes]) registerNode(definition);

export function getNode(type: string): NodeDefinition | undefined {
  return registry.get(type);
}

const FIELD_PORT_TYPES = { text: "string", expression: "any", number: "number" } as const;

export function fieldPorts(definition: NodeDefinition, taken: Set<string>): PortDef[] {
  if (definition.category === "trigger") return [];
  return definition.fields.flatMap((field) => {
    if (field.static || taken.has(field.id) || !(field.kind in FIELD_PORT_TYPES)) return [];
    const type = FIELD_PORT_TYPES[field.kind as keyof typeof FIELD_PORT_TYPES];
    return [{ id: field.id, label: field.label, type, optional: true, field: true }];
  });
}

export function inputsOf(definition: NodeDefinition, data: Record<string, FieldValue>): PortDef[] {
  const base = [...definition.inputs, ...(definition.ports?.(data).inputs ?? [])];
  return [...base, ...fieldPorts(definition, new Set(base.map((port) => port.id)))];
}

export function acceptsMany(definition: NodeDefinition, port: string): boolean {
  return definition.fields.some((field) => field.id === port && field.kind === "text" && !field.static);
}

export function outputsOf(definition: NodeDefinition, data: Record<string, FieldValue>): PortDef[] {
  const extra = definition.ports?.(data).outputs ?? [];
  return extra.length > 0 ? [...definition.outputs, ...extra] : definition.outputs;
}

export function fieldsFor(definition: NodeDefinition, platform: Platform): FieldDef[] {
  return definition.fields
    .filter((field) => !field.platforms || field.platforms.includes(platform))
    .map((field) => {
      const variant = field.variants?.[platform];
      const resolved = variant ? ({ ...field, ...variant } as FieldDef) : field;
      if (resolved.kind !== "select") return resolved;
      return { ...resolved, options: resolved.options.filter((option) => !option.platforms || option.platforms.includes(platform)) };
    });
}

export function portLabel(port: PortDef, platform: Platform): string {
  return port.variants?.[platform]?.label ?? port.label;
}

export function listNodes(platform?: Platform): NodeDefinition[] {
  const all = [...registry.values()];
  return platform ? all.filter((node) => node.platforms.includes(platform)) : all;
}

export interface NodeInfo {
  type: string;
  label: string;
  description: string;
  category: NodeDefinition["category"];
  icon?: string;
  platforms: Platform[];
  inputs: PortDef[];
  outputs: PortDef[];
  fields: FieldDef[];
}

export function describeNode(definition: NodeDefinition): NodeInfo {
  return {
    type: definition.type,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    icon: definition.icon,
    platforms: [...definition.platforms],
    inputs: definition.inputs,
    outputs: definition.outputs,
    fields: definition.fields,
  };
}

export function defaultData(definition: NodeDefinition): Record<string, string | number | boolean> {
  const data: Record<string, string | number | boolean> = {};
  for (const field of definition.fields) {
    if (field.default !== undefined) data[field.id] = field.default;
  }
  return data;
}
