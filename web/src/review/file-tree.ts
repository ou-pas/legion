// A diff's file tree (v33), PURE: flat paths in, a tree out. Apart from rendering because this is the
// part with logic (grouping, compacting).

export type TreeFile = {
  kind: "file";
  /** The displayed name: the last path segment. */
  name: string;
  /** The full path, as the API and comments name it. */
  path: string;
  repo: string;
  additions: number;
  deletions: number;
  comments: number;
};

export type TreeDir = { kind: "dir"; name: string; path: string; children: TreeNode[] };
export type TreeNode = TreeDir | TreeFile;

type Input = { repo: string; path: string; additions: number; deletions: number; comments: number };

/** Compacts single-child folders: `web/src/review` on ONE line rather than three empty levels, as IDE
 *  explorers do. On a 48-file diff that is the difference between a map and an accordion. */
function compact(dir: TreeDir): TreeDir {
  let node = dir;
  while (node.children.length === 1 && node.children[0]!.kind === "dir") {
    const only = node.children[0] as TreeDir;
    node = {
      kind: "dir",
      name: `${node.name}/${only.name}`,
      path: only.path,
      children: only.children,
    };
  }
  return { ...node, children: node.children.map((c) => (c.kind === "dir" ? compact(c) : c)) };
}

/** Folders first, then alphabetical: a file explorer's order. */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes]
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1))
    .map((n) => (n.kind === "dir" ? { ...n, children: sortNodes(n.children) } : n));
}

export function buildFileTree(files: Input[]): TreeNode[] {
  const root: TreeDir = { kind: "dir", name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    const fileName = parts.pop() ?? f.path;
    let cursor = root;
    let walked = "";
    for (const part of parts) {
      walked = walked ? `${walked}/${part}` : part;
      const found = cursor.children.find((c): c is TreeDir => c.kind === "dir" && c.name === part);
      if (found) {
        cursor = found;
        continue;
      }
      const dir: TreeDir = { kind: "dir", name: part, path: walked, children: [] };
      cursor.children.push(dir);
      cursor = dir;
    }
    cursor.children.push({ kind: "file", name: fileName, ...f });
  }
  return sortNodes(root.children.map((c) => (c.kind === "dir" ? compact(c) : c)));
}

/** A file's identity in the page, the DOM anchor for "go to this file". No interpretable character,
 *  same rule as inbox choice ids. */
export const fileAnchorId = (repo: string, path: string) =>
  `diff-${`${repo}-${path}`.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
