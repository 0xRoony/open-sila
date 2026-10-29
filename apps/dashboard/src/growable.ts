import { itemPort, type FieldDef, type FieldValue, type NodeDefinition } from "@open-sila/core";

export const ADD_PORT = "__add";

type ListField = Extract<FieldDef, { kind: "list" }>;

export type Growable =
  | { kind: "keys"; field: ListField; prefix: string; noun: string }
  | { kind: "count"; fieldId: string; noun: string; max: number };

export function growable(definition: NodeDefinition | undefined): Growable | null {
  if (!definition) return null;
  const field = definition.fields.find((item): item is ListField => item.kind === "list" && Boolean(item.portPrefix));
  if (field) return { kind: "keys", field, prefix: field.portPrefix as string, noun: field.itemLabel ?? "item" };
  if (definition.type === "core.list") return { kind: "count", fieldId: "count", noun: "item", max: 20 };
  return null;
}

export function listItems(value: FieldValue | undefined): string[] {
  return String(value ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function uniqueName(existing: string[], base: string): string {
  const clean = base.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "key";
  const taken = new Set(existing.map((item) => item.toLowerCase()));
  if (!taken.has(clean.toLowerCase())) return clean;
  let index = 2;
  while (taken.has(`${clean}${index}`.toLowerCase())) index += 1;
  return `${clean}${index}`;
}

export function addEntry(
  grow: Growable,
  values: Record<string, FieldValue>,
  base?: string,
): { values: Record<string, FieldValue>; port: string } | null {
  if (grow.kind === "count") {
    const count = Math.max(1, Number(values[grow.fieldId]) || 1);
    if (count >= grow.max) return null;
    return { values: { ...values, [grow.fieldId]: count + 1 }, port: `item_${count + 1}` };
  }
  const items = listItems(values[grow.field.id] ?? grow.field.default);
  const name = uniqueName(items, base ?? grow.noun);
  return { values: { ...values, [grow.field.id]: [...items, name].join("\n") }, port: itemPort(grow.prefix, name) };
}
