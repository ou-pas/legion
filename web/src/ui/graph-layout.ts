// Pure layout of a goal's DAG: depth → column, stacking → row, label wrapping. `graph.tsx` only
// draws what this module placed.

/** Five tints (`graph.css`), all the graph knows. It does not know task statuses (`ui/` does not
 *  import `api/`): the caller maps its status to a node state. `blocked` has no database
 *  equivalent; a task held by a link stays `todo` there. */
export type GraphNodeState = "todo" | "doing" | "review" | "done" | "blocked";
export interface GraphNode {
  id: string;
  label: string;
  agent?: string;
  state?: GraphNodeState;
}
export interface GraphEdge {
  from: string;
  to: string;
  critical?: boolean;
}

/* SVG units: coordinates, not styles. */
export const BOX = { w: 176, h: 64, gapX: 64, gapY: 18, pad: 10, line: 15, chars: 22 };

export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
  lines: string[];
}

/** Two lines max, broken at words: a label never overlaps its neighbour. */
function wrap(label: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of label.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > BOX.chars) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  const rest = lines.slice(1).join(" ");
  return [lines[0] ?? "", `${rest.slice(0, BOX.chars - 1)}…`];
}

/** Depth = longest path from a root. Nodes at the same depth stack: the plan's parallelism reads
 *  vertically, progression horizontally. */
export function place(nodes: GraphNode[], edges: GraphEdge[]) {
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  // Relaxation: a DAG converges in at most as many passes as it has nodes.
  for (let i = 0; i < nodes.length; i++) {
    for (const e of edges) {
      if (!depth.has(e.from) || !depth.has(e.to)) continue;
      depth.set(e.to, Math.max(depth.get(e.to) ?? 0, (depth.get(e.from) ?? 0) + 1));
    }
  }
  // Column heights first, so columns center against each other; otherwise a lone step aligns to
  // the top and the graph looks shifted.
  const height = new Map<number, number>();
  for (const n of nodes) {
    const col = depth.get(n.id) ?? 0;
    height.set(col, (height.get(col) ?? 0) + 1);
  }
  const cols = Math.max(1, ...[...height.keys()].map((c) => c + 1));
  const deep = Math.max(1, ...height.values());
  const step = BOX.h + BOX.gapY;
  const rows = new Map<number, number>();
  const placed: PlacedNode[] = nodes.map((n) => {
    const col = depth.get(n.id) ?? 0;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    return {
      ...n,
      x: BOX.pad + col * (BOX.w + BOX.gapX),
      y: BOX.pad + ((deep - (height.get(col) ?? 1)) * step) / 2 + row * step,
      lines: wrap(n.label),
    };
  });
  return {
    nodes: placed,
    width: BOX.pad * 2 + cols * BOX.w + (cols - 1) * BOX.gapX,
    height: BOX.pad * 2 + deep * BOX.h + (deep - 1) * BOX.gapY,
  };
}

/** Upstream (`up`) or downstream transitive closure of a node, what hover highlights. */
export function reach(id: string, edges: GraphEdge[], up: boolean): Set<string> {
  const seen = new Set([id]);
  for (let i = 0; i <= edges.length; i++) {
    for (const e of edges) {
      const from = up ? e.to : e.from;
      const to = up ? e.from : e.to;
      if (seen.has(from)) seen.add(to);
    }
  }
  return seen;
}
