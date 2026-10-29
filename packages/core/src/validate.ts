import { databaseProblems, withDatabase } from "./database.js";
import { acceptsMany, fieldsFor, getNode, inputsOf, outputsOf } from "./nodes/index.js";
import type { Diagnostic, Flow, FlowNode, NodeDefinition, Platform, PortType } from "./types.js";

const CONVERTIBLE: PortType[] = ["string", "number", "boolean"];

export function canConnect(from: PortType, to: PortType): boolean {
  if (from === "exec" || to === "exec") return from === to;
  if (from === to || from === "any" || to === "any") return true;
  if (CONVERTIBLE.includes(to)) return true;
  return to === "user" && from === "member";
}

export function convertsTo(from: PortType, to: PortType): boolean {
  return from !== to && from !== "any" && to !== "any" && from !== "exec" && canConnect(from, to);
}

const COMMAND_TRIGGERS = new Set([
  "discord.slashCommand",
  "discord.userContextMenu",
  "discord.messageContextMenu",
  "telegram.command",
]);

function isEmpty(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.trim() === "");
}

export function validateFlow(flow: Flow, platform: Platform): Diagnostic[] {
  return withDatabase(flow.database, () => validate(flow, platform));
}

function validate(flow: Flow, platform: Platform): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const message of flow.database ? databaseProblems(flow.database) : []) diagnostics.push({ level: "error", message: `Data: ${message}` });
  const nodes = new Map<string, { node: FlowNode; definition: NodeDefinition }>();

  for (const node of flow.nodes) {
    if (nodes.has(node.id)) {
      diagnostics.push({ level: "error", nodeId: node.id, message: `Duplicate node id ${node.id}.` });
      continue;
    }
    const definition = getNode(node.type);
    if (!definition) {
      diagnostics.push({ level: "error", nodeId: node.id, message: `Unknown node type ${node.type}.` });
      continue;
    }
    if (!definition.platforms.includes(platform)) {
      diagnostics.push({
        level: "error",
        nodeId: node.id,
        message: `${definition.label} is not available for ${platform} projects.`,
      });
    }
    nodes.set(node.id, { node, definition });
  }

  const connectedInputs = new Set<string>();
  const execTargets = new Map<string, string[]>();

  for (const edge of flow.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      diagnostics.push({ level: "error", edgeId: edge.id, message: "A connection points to a node that does not exist." });
      continue;
    }
    const output = outputsOf(source.definition, source.node.data).find((port) => port.id === edge.sourceHandle);
    const input = inputsOf(target.definition, target.node.data).find((port) => port.id === edge.targetHandle);
    if (!output || !input) {
      diagnostics.push({
        level: "error",
        edgeId: edge.id,
        nodeId: target.node.id,
        message: `A connection between ${source.definition.label} and ${target.definition.label} uses a port that does not exist.`,
      });
      continue;
    }
    if (!canConnect(output.type, input.type)) {
      diagnostics.push({
        level: "error",
        edgeId: edge.id,
        nodeId: target.node.id,
        message: `${output.label} (${output.type}) cannot connect to ${input.label} (${input.type}) on ${target.definition.label}.`,
      });
    }
    if (input.type === "exec") {
      execTargets.set(edge.source, [...(execTargets.get(edge.source) ?? []), edge.target]);
    } else {
      const key = `${edge.target}:${edge.targetHandle}`;
      if (connectedInputs.has(key) && !acceptsMany(target.definition, input.id)) {
        diagnostics.push({
          level: "error",
          nodeId: target.node.id,
          message: `${input.label} on ${target.definition.label} has more than one connection.`,
        });
      }
      connectedInputs.add(key);
    }
  }

  const reachable = new Set<string>();
  const done = new Set<string>();
  const commandNames = new Map<string, string>();
  let triggers = 0;

  for (const { node, definition } of nodes.values()) {
    for (const field of fieldsFor(definition, platform)) {
      if (!field.required) continue;
      if (connectedInputs.has(`${node.id}:${field.id}`)) continue;
      if (isEmpty(node.data[field.id])) {
        diagnostics.push({ level: "error", nodeId: node.id, message: `${definition.label}: ${field.label} is required.` });
      }
    }
    if (definition.category !== "trigger") continue;
    triggers += 1;
    if (COMMAND_TRIGGERS.has(definition.type)) {
      const name = `${definition.type}:${String(node.data.name ?? "").trim().toLowerCase().replace(/\s+/g, " ")}`;
      if (commandNames.has(name)) {
        diagnostics.push({ level: "error", nodeId: node.id, message: `The command ${node.data.name} is defined twice.` });
      }
      commandNames.set(name, node.id);
    }
    walk(node.id, new Set(), done, reachable, execTargets, diagnostics);
  }

  diagnostics.push(...placeholderWarnings(flow, nodes, platform), ...keyWarnings(nodes));
  for (const edge of flow.edges) {
    const target = nodes.get(edge.target);
    const source = nodes.get(edge.source);
    if (!target || !source || edge.targetHandle !== "replyTo") continue;
    const output = outputsOf(source.definition, source.node.data).find((port) => port.id === edge.sourceHandle);
    if (output && ["user", "member", "channel"].includes(output.type)) {
      diagnostics.push({
        level: "warning",
        nodeId: target.node.id,
        message: `Reply to is connected to ${output.label}, so this sends a new message instead of answering. Connect Interaction to answer the saved event.`,
      });
    }
  }

  const slashNames = all(nodes, "discord.slashCommand").map(({ node }) => String(node.data.name ?? "").trim().toLowerCase().split(/\s+/));
  for (const { node } of all(nodes, "discord.slashCommand")) {
    const words = String(node.data.name ?? "").trim().toLowerCase().split(/\s+/);
    if (words.length === 1 && slashNames.some((other) => other.length > 1 && other[0] === words[0])) {
      diagnostics.push({
        level: "error",
        nodeId: node.id,
        message: `/${words[0]} has subcommands, so it cannot run by itself. Rename it, for example to ${words[0]} help.`,
      });
    }
  }

  if (triggers === 0 && nodes.size > 0) {
    diagnostics.push({ level: "warning", message: "Add a trigger so the bot knows when to run your flow." });
  }

  for (const { node, definition } of nodes.values()) {
    const runs = definition.inputs.some((port) => port.type === "exec");
    if (runs && !reachable.has(node.id)) {
      diagnostics.push({
        level: "warning",
        nodeId: node.id,
        message: `${definition.label} is not connected to a trigger and will not run.`,
      });
    }
  }

  return diagnostics;
}

function all(nodes: Map<string, { node: FlowNode; definition: NodeDefinition }>, type: string) {
  return [...nodes.values()].filter(({ definition }) => definition.type === type);
}

function placeholderWarnings(flow: Flow, nodes: Map<string, { node: FlowNode; definition: NodeDefinition }>, platform: Platform): Diagnostic[] {
  const wires = new Map<string, number>();
  for (const edge of flow.edges) wires.set(`${edge.target}:${edge.targetHandle}`, (wires.get(`${edge.target}:${edge.targetHandle}`) ?? 0) + 1);
  const result: Diagnostic[] = [];
  for (const { node, definition } of nodes.values()) {
    for (const field of fieldsFor(definition, platform)) {
      if (field.kind !== "text") continue;
      const text = String(node.data[field.id] ?? "");
      const count = wires.get(`${node.id}:${field.id}`) ?? 0;
      const highest = Math.max(0, ...[...text.matchAll(/\{\{[^}]*\$(\d+)[^}]*\}\}/g)].map((match) => Number(match[1])));
      if (highest > count) {
        result.push({
          level: "warning",
          nodeId: node.id,
          message: `${definition.label}: ${field.label} uses $${highest} but ${count === 0 ? "no wire is" : count === 1 ? "only 1 wire is" : `only ${count} wires are`} connected to it.`,
        });
      }
    }
  }
  return result;
}

const KEY_PAIRS: [reader: string, writers: string[], what: string][] = [
  ["core.recall", ["core.remember"], "Remember"],
  ["core.loadInteraction", ["core.saveInteraction"], "Save interaction"],
  ["core.getValue", ["core.setValue", "core.increment"], "Set value or Increment"],
];

function keyPrefix(value: unknown): string {
  return String(value ?? "").split("{{")[0].trim().toLowerCase();
}

function keyWarnings(nodes: Map<string, { node: FlowNode; definition: NodeDefinition }>): Diagnostic[] {
  const result: Diagnostic[] = [];
  const all = [...nodes.values()];
  for (const [reader, writers, what] of KEY_PAIRS) {
    const written = all.filter(({ definition }) => writers.includes(definition.type)).map(({ node }) => keyPrefix(node.data.key));
    for (const { node, definition } of all) {
      if (definition.type !== reader || node.data.key === undefined) continue;
      const prefix = keyPrefix(node.data.key);
      if (written.some((other) => other.startsWith(prefix) || prefix.startsWith(other))) continue;
      result.push({
        level: "warning",
        nodeId: node.id,
        message: `${definition.label} reads "${String(node.data.key)}", but no ${what} node writes a key like it in this project.`,
      });
    }
  }
  return result;
}

function walk(
  id: string,
  visiting: Set<string>,
  done: Set<string>,
  reachable: Set<string>,
  edges: Map<string, string[]>,
  diagnostics: Diagnostic[],
): void {
  visiting.add(id);
  for (const target of edges.get(id) ?? []) {
    if (visiting.has(target)) {
      diagnostics.push({ level: "error", nodeId: target, message: "This node loops back into its own flow." });
      continue;
    }
    reachable.add(target);
    if (!done.has(target)) walk(target, visiting, done, reachable, edges, diagnostics);
  }
  visiting.delete(id);
  done.add(id);
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.level === "error");
}
