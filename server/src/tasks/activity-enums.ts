// Who spoke, on a task's activity feed.
//
// Three emitters, and the distinction is not cosmetic: it decides the provenance the screen shows,
// and a `system` attributed to an agent would suggest a model decided what the control plane did
// on its own.
//
// The value is read as `from` in the database, a language keyword, so a field that cannot be
// replaced blindly: `from` appears in every import. The replacement targeted `from: "…"`, never the
// bare value.
import type { schema } from "../shared/db.js";

export type ActivityFrom = (typeof schema.taskActivity.$inferSelect)["from"];
export const ACTIVITY_FROM = {
  /** The session's agent: a report, a passing note. */
  agent: "agent",
  /** The operator: an instruction, an inbox answer. */
  human: "human",
  /** The control plane itself: a wake-up, a dependency release, a tidy-up. */
  system: "system",
} as const satisfies Record<string, ActivityFrom>;
export const ACTIVITY_FROMS = [
  ACTIVITY_FROM.agent,
  ACTIVITY_FROM.human,
  ACTIVITY_FROM.system,
] as const;
