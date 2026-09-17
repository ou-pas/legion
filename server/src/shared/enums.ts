// Cross-domain enums, owned by no single domain (domain-owned ones live with their domain).
// The key names the concept, the value is the serialisation, the type comes from the column.
//
// Types are read from `drizzle/schema.ts`, not `db.ts` (06/09): `db.ts` needs this vocabulary to
// seed, and the cycle was hidden behind a top-level `await import` that made the data layer async
// for the whole graph.
import type * as schema from "../../drizzle/schema.js";

/** Control plane log level. Three only: `debug` would fill the table unread, and the 5 000-row
 *  rotation would erase what matters. */
export type ControlLevel = (typeof schema.controlEvents.$inferSelect)["level"];
export const CONTROL_LEVEL = {
  info: "info",
  warn: "warn",
  error: "error",
} as const satisfies Record<string, ControlLevel>;
export const CONTROL_LEVELS = [
  CONTROL_LEVEL.info,
  CONTROL_LEVEL.warn,
  CONTROL_LEVEL.error,
] as const;

/** Runner kind. `docker` covers local and remote (`ssh://`) daemons (only `docker_host` differs);
 *  `process` runs without a container. */
export type RunnerKind = (typeof schema.runners.$inferSelect)["kind"];
export const RUNNER_KIND = {
  docker: "docker",
  process: "process",
} as const satisfies Record<string, RunnerKind>;

/** Session environment egress. `limited` restricts sessions to a host list; `open` is the default,
 *  and the screen says so. */
export type Networking = (typeof schema.environments.$inferSelect)["networking"];
export const NETWORKING = {
  open: "open",
  limited: "limited",
} as const satisfies Record<string, Networking>;

/** Repository access granted to an agent. `read` clones without pushing, which makes audit tasks
 *  safe and is why they never produce a PR. */
export type RepoAccess = (typeof schema.agents.$inferSelect)["repoAccess"];
export const REPO_ACCESS = {
  none: "none",
  read: "read",
  write: "write",
} as const satisfies Record<string, RepoAccess>;
export const REPO_ACCESSES = [REPO_ACCESS.none, REPO_ACCESS.read, REPO_ACCESS.write] as const;
