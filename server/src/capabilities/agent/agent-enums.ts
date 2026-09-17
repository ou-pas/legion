// An agent's reasoning settings (`effort`, `thinking`) and a rule's status.
// Column types are read from `drizzle/schema.ts`, which depends on nothing, rather than `db.ts`:
// only the type is needed, not the database.
import type * as schema from "../../../drizzle/schema.js";

/** Reasoning effort asked of the model. Not a task's complexity: complexity picks the model,
 *  effort sets how hard it thinks. Both use `low` and `high`, hence two constants. */
export type AgentEffort = NonNullable<(typeof schema.agents.$inferSelect)["effort"]>;
export const AGENT_EFFORT = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
} as const satisfies Record<string, AgentEffort>;
export const AGENT_EFFORTS = [
  AGENT_EFFORT.low,
  AGENT_EFFORT.medium,
  AGENT_EFFORT.high,
  AGENT_EFFORT.xhigh,
  AGENT_EFFORT.max,
] as const;

/** Thinking mode. `adaptive` (the default) lets the model decide: forcing `enabled` on a trivial
 *  task costs tokens for nothing. */
export type AgentThinking = NonNullable<(typeof schema.agents.$inferSelect)["thinking"]>;
export const AGENT_THINKING = {
  adaptive: "adaptive",
  enabled: "enabled",
  disabled: "disabled",
} as const satisfies Record<string, AgentThinking>;
export const AGENT_THINKINGS = [
  AGENT_THINKING.adaptive,
  AGENT_THINKING.enabled,
  AGENT_THINKING.disabled,
] as const;

/** A rule's status. `suggested` = proposed by memory (a human correction turned into a rule,
 *  v10), awaiting approval. `active` is spelt like a goal status and is unrelated. */
export type RuleStatus = (typeof schema.rules.$inferSelect)["status"];
export const RULE_STATUS = {
  active: "active",
  suggested: "suggested",
} as const satisfies Record<string, RuleStatus>;
export const RULE_STATUSES = [RULE_STATUS.active, RULE_STATUS.suggested] as const;
