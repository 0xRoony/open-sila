import type { Edge } from "@xyflow/react";
import type { SilaNode } from "./flow";

const COLUMN_GAP = 90;
const ROW_GAP = 40;
const GROUP_GAP = 120;
const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 120;

function components(nodes: SilaNode[], edges: Edge[]): SilaNode[][] {
  const parent = new Map(nodes.map((node) => [node.id, node.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(id, root);
    return root;
  };
  for (const edge of edges) {
    if (parent.has(edge.source) && parent.has(edge.target)) parent.set(find(edge.source), find(edge.target));
  }
  const groups = new Map<string, SilaNode[]>();
  for (const node of nodes) groups.set(find(node.id), [...(groups.get(find(node.id)) ?? []), node]);
  return [...groups.values()].sort((a, b) => Math.min(...a.map((n) => n.position.y)) - Math.min(...b.map((n) => n.position.y)));
}

function ranks(nodes: SilaNode[], edges: Edge[]): Map<string, number> {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const rank = new Map<string, number>();
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  for (const id of queue) rank.set(id, 0);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const target of outgoing.get(id) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(id) ?? 0) + 1));
      const remaining = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }
  for (const node of nodes) if (!rank.has(node.id)) rank.set(node.id, 0);

  for (const edge of edges) {
    const sourceRank = rank.get(edge.source);
    const targetRank = rank.get(edge.target);
    if (sourceRank === undefined || targetRank === undefined) continue;
    const consumers = outgoing.get(edge.source) ?? [];
    if (consumers.length > 0 && !edges.some((item) => item.target === edge.source)) {
      const nearest = Math.min(...consumers.map((id) => rank.get(id) ?? 0)) - 1;
      if (nearest > sourceRank) rank.set(edge.source, nearest);
    }
  }
  return rank;
}

type Size = { width: number; height: number };

export function autoArrange(nodes: SilaNode[], edges: Edge[], sizeOf: (id: string) => Size | undefined = () => undefined): SilaNode[] {
  const height = (node: SilaNode) => sizeOf(node.id)?.height ?? node.measured?.height ?? DEFAULT_HEIGHT;
  const width = (node: SilaNode) => sizeOf(node.id)?.width ?? node.measured?.width ?? DEFAULT_WIDTH;
  const placed = new Map<string, { x: number; y: number }>();
  let offsetY = 0;

  for (const group of components(nodes, edges)) {
    const rank = ranks(group, edges);
    const columns = new Map<number, SilaNode[]>();
    for (const node of group) {
      const column = rank.get(node.id) ?? 0;
      columns.set(column, [...(columns.get(column) ?? []), node]);
    }

    const order = new Map<string, number>();
    const widths = new Map<number, number>();
    let groupHeight = 0;
    for (const column of [...columns.keys()].sort((a, b) => a - b)) {
      const items = columns.get(column) as SilaNode[];
      const weight = (node: SilaNode) => {
        const sources = edges.filter((edge) => edge.target === node.id && order.has(edge.source)).map((edge) => order.get(edge.source) as number);
        return sources.length > 0 ? sources.reduce((sum, value) => sum + value, 0) / sources.length : node.position.y;
      };
      items.sort((a, b) => weight(a) - weight(b));
      let y = 0;
      for (const node of items) {
        order.set(node.id, y);
        placed.set(node.id, { x: column, y: offsetY + y });
        y += height(node) + ROW_GAP;
      }
      widths.set(column, Math.max(...items.map(width)));
      groupHeight = Math.max(groupHeight, y);
    }

    let x = 0;
    const columnX = new Map<number, number>();
    for (const column of [...widths.keys()].sort((a, b) => a - b)) {
      columnX.set(column, x);
      x += (widths.get(column) ?? DEFAULT_WIDTH) + COLUMN_GAP;
    }
    for (const node of group) {
      const spot = placed.get(node.id) as { x: number; y: number };
      placed.set(node.id, { x: columnX.get(spot.x) ?? 0, y: spot.y });
    }
    offsetY += groupHeight + GROUP_GAP;
  }

  return nodes.map((node) => ({ ...node, position: placed.get(node.id) ?? node.position }));
}
