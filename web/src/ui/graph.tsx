// A goal's step DAG in SVG. Hovering a step lights up everything it depends on and everything
// depending on it; the critical path is marked on the edge.
import { useId, useMemo, useState } from "react";
import { BOX, place, reach, type GraphEdge, type GraphNode } from "./graph-layout.js";
import { UI_TEXT } from "./vocabulary.js";
import "./graph.css";

export type { GraphEdge, GraphNode, GraphNodeState } from "./graph-layout.js";

export function Graph({
  nodes,
  edges,
  label,
  className,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Screen-reader name ("Plan of goal Harden the checkout flow"). */
  label: string;
  className?: string;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const uid = useId().replace(/:/g, "");
  const { nodes: placed, width, height } = useMemo(() => place(nodes, edges), [nodes, edges]);
  const lit = useMemo(
    () =>
      focus == null ? null : new Set([...reach(focus, edges, true), ...reach(focus, edges, false)]),
    [focus, edges],
  );
  const at = new Map(placed.map((n) => [n.id, n]));
  return (
    <div className={["ui-graph", className].filter(Boolean).join(" ")}>
      <svg
        className="ui-graph-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="list"
        aria-label={label}
      >
        <defs>
          {["plain", "critical"].map((k) => (
            <marker
              key={k}
              id={`${uid}-${k}`}
              className="ui-graph-arrow"
              data-critical={k === "critical" || undefined}
              markerWidth="7"
              markerHeight="7"
              refX="7"
              refY="3.5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M0 0 L7 3.5 L0 7 Z" />
            </marker>
          ))}
        </defs>
        {edges.map((e) => {
          const a = at.get(e.from),
            b = at.get(e.to);
          if (!a || !b) return null;
          // Anchored on edges: out of the source's right side, into the target's left side.
          const x1 = a.x + BOX.w,
            y1 = a.y + BOX.h / 2,
            x2 = b.x - 3,
            y2 = b.y + BOX.h / 2;
          const bend = BOX.gapX / 2;
          return (
            <path
              key={`${e.from}-${e.to}`}
              className="ui-graph-edge"
              aria-hidden="true"
              data-critical={e.critical || undefined}
              data-dim={lit != null && !(lit.has(e.from) && lit.has(e.to)) ? "true" : undefined}
              d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
              markerEnd={`url(#${uid}-${e.critical ? "critical" : "plain"})`}
            />
          );
        })}
        {placed.map((n) => {
          const state = n.state ?? "todo";
          const top = n.lines.length === 1 ? 26 : 22;
          return (
            <g
              key={n.id}
              className="ui-graph-node"
              data-state={state}
              tabIndex={0}
              role="listitem"
              data-dim={lit != null && !lit.has(n.id) ? "true" : undefined}
              aria-label={UI_TEXT.graph.node(
                n.label,
                n.agent ?? UI_TEXT.graph.noAgent,
                UI_TEXT.graph.state[state],
              )}
              onMouseEnter={() => setFocus(n.id)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(n.id)}
              onBlur={() => setFocus(null)}
            >
              <rect className="ui-graph-box" x={n.x} y={n.y} width={BOX.w} height={BOX.h} />
              {n.lines.map((line, i) => (
                <text
                  key={line}
                  className="ui-graph-label"
                  x={n.x + 12}
                  y={n.y + top + i * BOX.line}
                >
                  {line}
                </text>
              ))}
              {n.agent != null && (
                <text
                  className="ui-graph-agent"
                  x={n.x + 12}
                  y={n.y + top + n.lines.length * BOX.line + 3}
                >
                  {n.agent}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
