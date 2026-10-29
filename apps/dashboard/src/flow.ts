import { getNode, inputsOf, outputsOf, type FieldValue, type Flow, type PortType } from "@open-sila/core";
import type { Edge, Node } from "@xyflow/react";

export type SilaNodeData = {
  kind: string;
  values: Record<string, FieldValue>;
  issue?: "error" | "warning";
  active?: boolean;
};

export type SilaNode = Node<SilaNodeData, "sila">;

export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return prefix + Array.from(bytes, (byte) => "abcdefghijklmnopqrstuvwxyz0123456789"[byte % 36]).join("");
}

export function portType(
  node: { type: string; data: Record<string, FieldValue> } | undefined,
  port: string,
  direction: "input" | "output",
): PortType | undefined {
  const definition = node && getNode(node.type);
  if (!definition) return undefined;
  const ports = direction === "input" ? inputsOf(definition, node.data) : outputsOf(definition, node.data);
  return ports.find((item) => item.id === port)?.type;
}

export function edgeClass(type: PortType | undefined): string {
  return type === "exec" ? "edge-exec" : `edge-data edge-${type ?? "any"}`;
}

export function fromFlow(flow: Flow): { nodes: SilaNode[]; edges: Edge[] } {
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  return {
    nodes: flow.nodes.map((node) => ({
      id: node.id,
      type: "sila",
      position: node.position,
      data: { kind: node.type, values: node.data },
    })),
    edges: flow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      className: edgeClass(portType(byId.get(edge.source), edge.sourceHandle, "output")),
    })),
  };
}

export function toFlow(nodes: SilaNode[], edges: Edge[]): Flow {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.kind,
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      data: node.data.values,
    })),
    edges: edges
      .filter((edge) => edge.sourceHandle && edge.targetHandle)
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        sourceHandle: edge.sourceHandle as string,
        target: edge.target,
        targetHandle: edge.targetHandle as string,
      })),
  };
}
