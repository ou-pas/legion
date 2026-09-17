// Grants given to an agent (least privilege). This is security information: the level is an
// acronym plus an icon shape, never color alone, readable printed in black and white.
import type { ReactNode } from "react";
import {
  Ban,
  BookMarked,
  Eye,
  Folder,
  GitBranch,
  Globe,
  KeyRound,
  Pencil,
  Puzzle,
  Server,
  Wrench,
} from "lucide-react";
import { Ellipsis } from "./ellipsis.js";
import { AutoHeading, HeadingScope } from "./heading-level.js";
import { UI_TEXT } from "./vocabulary.js";
import "./permission-list.css";

export type PermissionLevel = "rw" | "r" | "none";
export type PermissionScope =
  | "repos"
  | "folders"
  | "mcp"
  | "network"
  | "skills"
  | "rules"
  | "secrets"
  | "tools";

const SCOPE = {
  repos: { icon: GitBranch, title: UI_TEXT.permission.scope.repos },
  folders: { icon: Folder, title: UI_TEXT.permission.scope.folders },
  mcp: { icon: Server, title: UI_TEXT.permission.scope.mcp },
  network: { icon: Globe, title: UI_TEXT.permission.scope.network },
  skills: { icon: Puzzle, title: UI_TEXT.permission.scope.skills },
  rules: { icon: BookMarked, title: UI_TEXT.permission.scope.rules },
  secrets: { icon: KeyRound, title: UI_TEXT.permission.scope.secrets },
  tools: { icon: Wrench, title: UI_TEXT.permission.scope.tools },
} as const;

const LEVEL = {
  rw: { mark: "RW", icon: Pencil, label: UI_TEXT.permission.level.rw },
  r: { mark: "R", icon: Eye, label: UI_TEXT.permission.level.r },
  none: { mark: "—", icon: Ban, label: UI_TEXT.permission.level.none },
} as const;

export function PermissionList({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={["ui-perm-list", className].filter(Boolean).join(" ")}
      role={label == null ? undefined : "group"}
      aria-label={label}
    >
      {/* Scopes (Repos, Folders, MCP…) are sub-parts of the containing block: their tag goes one
          level down instead of a hardcoded h4 that skipped a level outside a section. */}
      <HeadingScope>{children}</HeadingScope>
    </div>
  );
}

export function PermissionGroup({
  scope,
  title,
  density = "comfortable",
  hideHeading = false,
  className,
  children,
}: {
  scope: PermissionScope;
  title?: ReactNode;
  /** `compact`: tighter rows for a narrow side column (agent margin), same acronym and icon. */
  density?: "comfortable" | "compact";
  /** The caller already shows the group label elsewhere (a `Disclosure` summary). */
  hideHeading?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { icon: Icon, title: fallback } = SCOPE[scope];
  return (
    <section
      className={["ui-perm-group", className].filter(Boolean).join(" ")}
      data-density={density}
    >
      {!hideHeading && (
        <AutoHeading className="ui-perm-head">
          <Icon size={13} aria-hidden="true" />
          {title ?? fallback}
        </AutoHeading>
      )}
      <ul className="ui-perm-items">{children}</ul>
    </section>
  );
}

/**
 * A grant row. The name fits on its line with its mark: an id split over two lines is no easier to
 * read, and the mark left alone above reads as an entry of its own (seen 26/08).
 *
 * A plain-text `name` is truncated here, with a tooltip for the full name only when it was really
 * cut (`Ellipsis` measures it). A composed `name` (a checkbox, a link) is the caller's
 * responsibility: only it knows whether it already carries a competing tooltip.
 */
export function Permission({
  name,
  level,
  detail,
  className,
}: {
  name: ReactNode;
  level: PermissionLevel;
  /** Detail on the right: mounted path, allowed host, skill version. */
  detail?: ReactNode;
  className?: string;
}) {
  const { mark, icon: Icon, label } = LEVEL[level];
  return (
    <li className={["ui-perm", className].filter(Boolean).join(" ")} data-level={level}>
      {/* The acronym is the visible mark; the full label stays in the flow for screen readers. */}
      <span className="ui-perm-mark" aria-hidden="true">
        <Icon size={13} />
        {mark}
      </span>
      <span className="ui-perm-name">
        {typeof name === "string" ? <Ellipsis>{name}</Ellipsis> : name}
      </span>
      <span className="ui-sr">{label}</span>
      {detail != null && <span className="ui-perm-detail">{detail}</span>}
    </li>
  );
}
