import {
  defaultData,
  getNode,
  inputsOf,
  outputsOf,
  type FieldValue,
  type FlowEdge,
  type FlowNode,
  type NodeDefinition,
  type Platform,
} from "../src/index.js";

export const SAMPLES: Record<string, string> = {
  buttons: "Yes | yes || Site | https://example.com\nNo | no",
  options: "Red | red | The red team\nBlue | blue",
  inputs: "subject | Subject\ndetails | Details | paragraph | optional",
  cases: "red\nblue",
  results: "Hello | Hello there | Sends a greeting",
  url: "https://example.com/image.png",
  path: "data.items.0",
  model: "Ticket",
  match: "code",
  code: "a",
  answers: "Yes\nNo",
  words: "spam",
};

export const TRIGGERS: Record<Platform, string[]> = {
  discord: ["discord.message", "discord.button", "discord.slashCommand"],
  telegram: ["telegram.message", "telegram.callback", "telegram.inline"],
};

let counter = 0;

export function sampleData(definition: NodeDefinition): Record<string, FieldValue> {
  const data: Record<string, FieldValue> = defaultData(definition);
  counter += 1;
  for (const field of definition.fields) {
    if (field.id === "name") data.name = `cmd${counter}`;
    else if (field.id === "customId" || field.id === "data") data[field.id] = `id${counter}`;
    else if (field.required && (data[field.id] === undefined || data[field.id] === "")) {
      data[field.id] = field.kind === "number" ? 1 : (SAMPLES[field.id] ?? (field.kind === "expression" ? "true" : "123"));
    }
  }
  if (definition.fields.some((field) => field.id === "allow")) data.allow = "SendMessages";
  if (definition.type.startsWith("core.db")) {
    data["@f_code"] = '"A1"';
    data["@s_name"] = '"Renamed"';
    data["@w_code"] = '"A1"';
  }
  return data;
}

export const DATABASE = {
  provider: "postgresql" as const,
  models: [
    {
      name: "Ticket",
      fields: [
        { name: "code", type: "String" as const, optional: true, unique: true, list: false },
        { name: "name", type: "String" as const, optional: true, unique: false, list: false },
        { name: "score", type: "Int" as const, optional: true, unique: false, list: false, default: "0" },
      ],
    },
  ],
};

export interface Chain {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export function chain(platform: Platform, definition: NodeDefinition, triggerType: string): Chain {
  const id = (suffix: string) => `${definition.type.replace(/\W/g, "_")}_${suffix}`;
  const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): FlowEdge => ({
    id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  });

  if (definition.category === "trigger") {
    const trigger = { id: id("t"), type: definition.type, position: { x: 0, y: 0 }, data: sampleData(definition) };
    const log = { id: id("log"), type: "core.log", position: { x: 0, y: 0 }, data: { text: "ran" } };
    return { nodes: [trigger, log], edges: [edge(trigger.id, "next", log.id, "exec")] };
  }

  const triggerDefinition = getNode(triggerType) as NodeDefinition;
  const trigger: FlowNode = { id: id("t"), type: triggerType, position: { x: 0, y: 0 }, data: sampleData(triggerDefinition) };
  const node: FlowNode = { id: id("n"), type: definition.type, position: { x: 0, y: 0 }, data: sampleData(definition) };
  const nodes = [trigger, node];
  const edges: FlowEdge[] = [];
  const triggerOutputs = new Set(outputsOf(triggerDefinition, trigger.data).map((port) => port.id));

  for (const port of inputsOf(definition, node.data)) {
    if (port.type === "exec" || port.optional) continue;
    if (definition.fields.some((field) => field.id === port.id)) continue;
    if (triggerOutputs.has(port.id)) continue;
    const value = { id: id(`v_${port.id}`), type: "core.expression", position: { x: 0, y: 0 }, data: { code: "(globalThis.__sila?.wired ?? {})" } };
    nodes.push(value);
    edges.push(edge(value.id, "result", node.id, port.id));
  }

  if (definition.emit) {
    edges.push(edge(trigger.id, "next", node.id, "exec"));
    let previous = node.id;
    for (const output of outputsOf(definition, node.data).filter((port) => port.type !== "exec")) {
      const consumer = { id: id(`use_${output.id}`), type: "core.code", position: { x: 0, y: 0 }, data: { code: "return a;" } };
      nodes.push(consumer);
      if (output.scoped) {
        edges.push(edge(node.id, output.scoped, consumer.id, "exec"), edge(node.id, output.id, consumer.id, "a"));
        continue;
      }
      edges.push(edge(previous, "next", consumer.id, "exec"), edge(node.id, output.id, consumer.id, "a"));
      previous = consumer.id;
    }
  } else {
    let previous = trigger.id;
    for (const output of outputsOf(definition, node.data)) {
      const consumer = { id: id(`use_${output.id}`), type: "core.code", position: { x: 0, y: 0 }, data: { code: "return a;" } };
      nodes.push(consumer);
      edges.push(edge(previous, "next", consumer.id, "exec"), edge(node.id, output.id, consumer.id, "a"));
      previous = consumer.id;
    }
  }
  return { nodes, edges };
}
