import { getNode, inputsOf, outputsOf } from "../nodes/index.js";
import type {
  CompileOptions,
  EmitContext,
  Flow,
  FlowEdge,
  FlowNode,
  NodeDefinition,
  Platform,
  PortType,
  Requirements,
  RuntimeHelper,
  TriggerEmit,
  TriggerScope,
} from "../types.js";
import { camel, customKey, identifier, indent, lines, mergeInputs, templateLiteral, usesInputs } from "../util.js";

export { customKey };

export class CompileError extends Error {
  constructor(
    message: string,
    readonly nodeId: string,
  ) {
    super(message);
  }
}

export interface HandlerFile {
  path: string;
  name: string;
  content: string;
  order: number;
  command?: TriggerEmit["command"];
}

export interface GeneratorState {
  helpers: Set<RuntimeHelper>;
  requirements: Requirements;
}

const LIBRARY: Record<Platform, string> = { discord: "discord.js", telegram: "grammy" };

export function variableName(nodeId: string, port: string): string {
  return `${camel(identifier(port))}_${identifier(nodeId)}`;
}

export function generateHandler(
  flow: Flow,
  trigger: FlowNode,
  platform: Platform,
  options: CompileOptions,
  state: GeneratorState,
): HandlerFile {
  const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, FlowEdge[]>();
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of flow.edges) {
    const target = `${edge.target}:${edge.targetHandle}`;
    incoming.set(target, [...(incoming.get(target) ?? []), edge]);
    const key = `${edge.source}:${edge.sourceHandle}`;
    outgoing.set(key, [...(outgoing.get(key) ?? []), edge]);
  }

  const imports = new Map<string, Set<string>>();
  const addImport = (from: string, name: string) => {
    imports.set(from, (imports.get(from) ?? new Set()).add(name));
    return name;
  };
  const development = options.mode === "development";
  let scope: TriggerScope = { context: "none", vars: {} };

  function definitionOf(node: FlowNode): NodeDefinition {
    const definition = getNode(node.type);
    if (!definition) throw new CompileError(`Unknown node type ${node.type}.`, node.id);
    return definition;
  }

  function context(node: FlowNode, declared: Set<string>, depth: number): EmitContext {
    const definition = definitionOf(node);
    const fail = (message: string): never => {
      throw new CompileError(message, node.id);
    };

    const ctx: EmitContext = {
      platform,
      node,
      trigger: scope,
      connected: (id) => incoming.has(`${node.id}:${id}`),
      field: <T,>(id: string) => {
        const field = definition.fields.find((item) => item.id === id);
        return (node.data[id] ?? field?.default) as T;
      },
      out: (id) => variableName(node.id, id),
      declare: (id) => {
        declared.add(`${node.id}:${id}`);
        return variableName(node.id, id);
      },
      use: (name) => addImport(LIBRARY[platform], name),
      helper: (name) => {
        state.helpers.add(name);
        if (name === "refs") state.helpers.add("store");
        return addImport(name === "store" ? "../lib/store.js" : name === "db" ? "../lib/db.js" : name === "http" ? "../lib/http.js" : "../lib/runtime.js", name);
      },
      fail,
      branch: (port) => {
        const code = chain(node.id, port, new Set(declared));
        if (!development) return code;
        return [`${addImport("../lib/trace.js", "done")}(${JSON.stringify(node.id)}, () => ({ path: ${JSON.stringify(port)} }));`, code]
          .filter(Boolean)
          .join("\n");
      },
      value: (id) => {
        const wires = incoming.get(`${node.id}:${id}`) ?? [];
        const field = definition.fields.find((item) => item.id === id);
        if (wires.length > 0) {
          const refs = wires.map((wire) => reference(wire, declared, depth, node));
          if (field?.kind === "text" && (refs.length > 1 || usesInputs(String(node.data[id] ?? "")))) {
            return mergeInputs(String(node.data[id] ?? ""), refs);
          }
          return refs[0];
        }
        const custom = node.data[customKey(id)];
        if (typeof custom === "string" && custom.trim()) return `(${custom.trim()})`;
        if (field) {
          const raw = node.data[id] ?? field.default;
          if ((field.kind === "text" || field.kind === "expression") && !String(raw ?? "").trim() && scope.vars[id]) {
            return scope.vars[id];
          }
          switch (field.kind) {
            case "text":
              return templateLiteral(String(raw ?? ""));
            case "expression":
            case "code":
              return String(raw ?? "").trim() || "undefined";
            case "number":
              return String(Number(raw) || 0);
            case "boolean":
              return raw === true ? "true" : "false";
            case "select":
              return JSON.stringify(String(raw ?? field.default));
            case "list":
              return JSON.stringify(lines(String(raw ?? "")));
          }
        }
        if (scope.vars[id]) return scope.vars[id];
        const port = inputsOf(definition, node.data).find((item) => item.id === id);
        if (port?.optional) return "undefined";
        return fail(`Connect the ${port?.label ?? id} input of ${definition.label}, or give it a custom value.`);
      },
    };
    return ctx;
  }

  function convert(value: string, from: PortType, to: PortType): string {
    if (from === to || to === "any" || from === "any") return value;
    if (to === "string") {
      if (from === "number" || from === "boolean") return `String(${value})`;
      state.helpers.add("toText");
      return `${addImport("../lib/runtime.js", "toText")}(${value})`;
    }
    if (to === "number") return `Number(${value})`;
    if (to === "boolean") return `Boolean(${value})`;
    if (to === "user" && from === "member") return `(${value}.user ?? ${value})`;
    return value;
  }

  function reference(edge: FlowEdge, declared: Set<string>, depth: number, target: FlowNode): string {
    const source = nodes.get(edge.source);
    if (!source) throw new CompileError("A connection points to a missing node.", target.id);
    const definition = definitionOf(source);
    const from = outputsOf(definition, source.data).find((port) => port.id === edge.sourceHandle)?.type ?? "any";
    const to = inputsOf(definitionOf(target), target.data).find((port) => port.id === edge.targetHandle)?.type ?? "any";
    return convert(resolve(edge, source, definition, declared, depth, target), from, to);
  }

  function resolve(
    edge: FlowEdge,
    source: FlowNode,
    definition: NodeDefinition,
    declared: Set<string>,
    depth: number,
    target: FlowNode,
  ): string {
    if (definition.category === "trigger") {
      if (source.id !== trigger.id) {
        throw new CompileError(`This node uses a value from a different trigger (${definition.label}).`, target.id);
      }
      const value = scope.vars[edge.sourceHandle];
      if (!value) throw new CompileError(`${definition.label} has no ${edge.sourceHandle} value.`, target.id);
      return value;
    }
    if (definition.expression) {
      if (depth > 50) throw new CompileError("Values are connected in a loop.", source.id);
      return `(${definition.expression(context(source, declared, depth + 1), edge.sourceHandle)})`;
    }
    if (!declared.has(`${source.id}:${edge.sourceHandle}`)) {
      const port = outputsOf(definition, source.data).find((item) => item.id === edge.sourceHandle);
      if (port?.scoped) {
        const path = outputsOf(definition, source.data).find((item) => item.id === port.scoped)?.label ?? port.scoped;
        throw new CompileError(`${port.label} from ${definition.label} only exists inside its ${path} path.`, target.id);
      }
      throw new CompileError(
        `This node uses ${definition.label} before it runs. Connect it later in the same path.`,
        target.id,
      );
    }
    return variableName(source.id, edge.sourceHandle);
  }

  function chain(nodeId: string, port: string, declared: Set<string>): string {
    const parts: string[] = [];
    for (const edge of outgoing.get(`${nodeId}:${port}`) ?? []) {
      const target = nodes.get(edge.target);
      if (target) parts.push(emit(target, declared));
    }
    return parts.filter(Boolean).join("\n");
  }

  function traceInputs(node: FlowNode, declared: Set<string>): string {
    const definition = definitionOf(node);
    const ctx = context(node, declared, 0);
    const entries: string[] = [];
    for (const port of inputsOf(definition, node.data)) {
      if (port.type === "exec") continue;
      try {
        entries.push(`${JSON.stringify(port.id)}: ${ctx.value(port.id)}`);
      } catch {
        continue;
      }
    }
    return `{ ${entries.join(", ")} }`;
  }

  function emit(node: FlowNode, declared: Set<string>): string {
    const definition = definitionOf(node);
    if (!definition.emit) throw new CompileError(`${definition.label} cannot be placed in a flow path.`, node.id);
    const inputs = development ? traceInputs(node, new Set(declared)) : "";
    const code = definition.emit(context(node, declared, 0));
    const outputs = outputsOf(definition, node.data).filter((output) => output.type !== "exec" && !output.scoped);
    for (const output of outputsOf(definition, node.data)) {
      if (output.scoped) declared.delete(`${node.id}:${output.id}`);
    }
    for (const output of outputs) declared.add(`${node.id}:${output.id}`);
    const id = JSON.stringify(node.id);
    const branching = definition.outputs.some((port) => port.type === "exec" && port.id !== "next");
    const hasNext = definition.outputs.some((port) => port.id === "next");
    const parts = [code];
    if (development) {
      parts.unshift(`${addImport("../lib/trace.js", "step")}(${id}, () => (${inputs}));`);
      const done = addImport("../lib/trace.js", "done");
      const values = outputs.map((output) => `${JSON.stringify(output.id)}: ${variableName(node.id, output.id)}`).join(", ");
      if (!branching) parts.push(`${done}(${id}, () => ({ ${values} }));`);
      else if (hasNext) parts.push(`${done}(${id}, () => ({ path: "next" }));`);
    }
    if (hasNext) parts.push(chain(node.id, "next", declared));
    return parts.filter(Boolean).join("\n");
  }

  const definition = definitionOf(trigger);
  if (!definition.trigger) throw new CompileError(`${definition.label} is not a trigger.`, trigger.id);
  const emitted = definition.trigger(context(trigger, new Set(), 0));
  scope = emitted.scope;

  const body = chain(trigger.id, "next", new Set());
  const failure = development ? `${addImport("../lib/trace.js", "fail")}(error);` : "console.error(error);";
  let guarded = body
    ? `try {\n${indent(body, 2)}\n} catch (error) {\n  ${failure}\n}`
    : "// Connect nodes to this trigger to make it do something.";
  if (development && body) {
    const values = outputsOf(definition, trigger.data)
      .filter((port) => port.type !== "exec" && scope.vars[port.id])
      .map((port) => `${JSON.stringify(port.id)}: ${scope.vars[port.id]}`)
      .join(", ");
    const detail = String(trigger.data.name ?? trigger.data.customId ?? trigger.data.event ?? trigger.data.filter ?? "").trim();
    const label = JSON.stringify(detail ? `${definition.label}: ${detail}` : definition.label);
    const done = `${addImport("../lib/trace.js", "done")}(${JSON.stringify(trigger.id)}, () => ({ ${values} }));`;
    guarded = `await ${addImport("../lib/trace.js", "run")}(${JSON.stringify(trigger.id)}, ${label}, async () => {\n${indent(`${done}\n${guarded}`, 2)}\n});`;
  }

  const content = emitted.wrap(guarded);

  for (const intent of emitted.requires?.intents ?? []) addRequirement(state.requirements.intents, intent);
  for (const permission of emitted.requires?.permissions ?? []) addRequirement(state.requirements.permissions, permission);
  for (const partial of emitted.requires?.partials ?? []) addRequirement(state.requirements.partials, partial);
  for (const update of emitted.requires?.updates ?? []) addRequirement(state.requirements.updates, update);

  const header = [...imports.entries()]
    .sort(([a], [b]) => (a.startsWith(".") ? 1 : 0) - (b.startsWith(".") ? 1 : 0) || a.localeCompare(b))
    .map(([from, names]) => `import { ${[...names].sort().join(", ")} } from ${JSON.stringify(from)};`)
    .join("\n");

  return {
    path: `src/handlers/${emitted.file}.js`,
    name: camel(identifier(emitted.file)),
    content: `${header ? `${header}\n\n` : ""}${content}\n`,
    order: emitted.order ?? 2,
    command: emitted.command,
  };
}

export function addRequirement(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}
