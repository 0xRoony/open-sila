import type { EmitContext, NodeDefinition, PortDef } from "../types.js";
import { indent } from "../util.js";

export const execIn: PortDef = { id: "exec", label: "Run", type: "exec" };
export const next: PortDef = { id: "next", label: "Next", type: "exec" };

export function defineNode(definition: NodeDefinition): NodeDefinition {
  return definition;
}

export function block(header: string, body: string, footer = "}"): string {
  return `${header}\n${indent(body, 2)}\n${footer}`;
}

export function requireRepliable(ctx: EmitContext, what: string): void {
  const { context } = ctx.trigger;
  if (context === "none" || context === "member") {
    ctx.fail(`${what} needs a trigger that can be replied to, such as a command, button or message.`);
  }
}

export function isFilled(ctx: EmitContext, id: string): boolean {
  if (ctx.connected(id)) return true;
  const raw = ctx.node.data[id];
  return typeof raw === "string" ? raw.trim().length > 0 : raw !== undefined;
}
