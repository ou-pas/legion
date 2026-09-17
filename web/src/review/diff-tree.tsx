// The diff map (v33, operator request): with 48 collapsed files, one must know where to go BEFORE
// expanding. The tree is the table of contents: compacted folders, +/- count per file, comment
// badge. Clicking a file expands it and scrolls there.
import { ChevronDown, ChevronRight, FileCode2, MessageSquare } from "lucide-react";
import { type TreeNode } from "./file-tree.js";
import { REVIEW_TEXT } from "./text.js";
import { Badge } from "../ui/chip.js";
import { Row, Stack } from "../ui/flex.js";
import { Caption, Text } from "../ui/text.js";
import "./diff-tree.css";

function Node({
  node,
  depth,
  openDirs,
  current,
  onToggleDir,
  onPick,
}: {
  node: TreeNode;
  depth: number;
  openDirs: Set<string>;
  current: string | null;
  onToggleDir: (path: string) => void;
  onPick: (repo: string, path: string) => void;
}) {
  // Indentation is a CSS variable: one place decides the step (diff-tree.css).
  const style = { "--depth": depth } as React.CSSProperties;
  if (node.kind === "dir") {
    const open = openDirs.has(node.path);
    return (
      <li>
        <button
          type="button"
          className="dm-tree-row"
          data-kind="dir"
          // oxlint-disable-next-line react/forbid-dom-props -- computed depth: the value is a LEVEL, the step lives in CSS
          style={style}
          aria-expanded={open}
          onClick={() => onToggleDir(node.path)}
        >
          {open ? (
            <ChevronDown size={12} aria-hidden="true" />
          ) : (
            <ChevronRight size={12} aria-hidden="true" />
          )}
          <Text size="sm">{node.name}</Text>
        </button>
        {open && (
          <ul className="dm-tree-list">
            {node.children.map((c) => (
              <Node
                key={c.kind === "dir" ? `d:${c.path}` : `f:${c.repo}/${c.path}`}
                node={c}
                depth={depth + 1}
                openDirs={openDirs}
                current={current}
                onToggleDir={onToggleDir}
                onPick={onPick}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }
  const id = `${node.repo}/${node.path}`;
  return (
    <li>
      <button
        type="button"
        className="dm-tree-row"
        data-kind="file"
        // oxlint-disable-next-line react/forbid-dom-props -- computed depth, see above
        style={style}
        data-current={id === current || undefined}
        title={node.path}
        onClick={() => onPick(node.repo, node.path)}
      >
        <FileCode2 size={12} aria-hidden="true" />
        <Text size="sm" className="dm-tree-name">
          {node.name}
        </Text>
        {node.comments > 0 && (
          <span className="dm-tree-comments" title={REVIEW_TEXT.diff.treeComments(node.comments)}>
            <MessageSquare size={11} aria-hidden="true" />
            <Badge count={node.comments} tone="accent" />
          </span>
        )}
        <Caption className="dm-tree-stat" tone="ok">
          +{node.additions}
        </Caption>
        <Caption className="dm-tree-stat" tone="bad">
          −{node.deletions}
        </Caption>
      </button>
    </li>
  );
}

export function DiffTree({
  nodes,
  openDirs,
  current,
  onToggleDir,
  onPick,
  footer,
}: {
  nodes: TreeNode[];
  openDirs: Set<string>;
  /** `repo/path` of the last expanded file, marked in the map. */
  current: string | null;
  onToggleDir: (path: string) => void;
  onPick: (repo: string, path: string) => void;
  footer?: React.ReactNode;
}) {
  return (
    <Stack gap={6} className="dm-tree">
      <ul className="dm-tree-list">
        {nodes.map((n) => (
          <Node
            key={n.kind === "dir" ? `d:${n.path}` : `f:${n.repo}/${n.path}`}
            node={n}
            depth={0}
            openDirs={openDirs}
            current={current}
            onToggleDir={onToggleDir}
            onPick={onPick}
          />
        ))}
      </ul>
      {footer && (
        <Row gap={6} wrap>
          {footer}
        </Row>
      )}
    </Stack>
  );
}
