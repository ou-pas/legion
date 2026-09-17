// What the task awaits from the operator, in one word: the rule, taken out of rendering. The action
// band (`channel-action-band.tsx`) needs the SAME answer before rendering anything: a band framing a
// component that renders `null` would show an empty bordered sheet on every task awaiting nothing.
//
// The 26/08 distinction: `review` parks BOTH outcomes, a dead session exactly like a successful one.
// Read from status alone, the screen presented a crash as delivered work.
import { TASK_STATUS } from "../api/tasks.js";
import type { Task } from "../api/tasks.js";

/** The three moments. There is no fourth: `null` says there is nothing to decide. */
export const CHANNEL_DECISION = {
  /** The session died. The first gesture is relaunching, not approving. */
  failed: "failed",
  /** The work is deposited and awaits approval. */
  now: "now",
  /** The gate is announced, the work is not there yet. Nothing to do. */
  later: "later",
} as const;

export type ChannelDecision = (typeof CHANNEL_DECISION)[keyof typeof CHANNEL_DECISION];

export function channelDecision({
  status,
  approvalGate,
  failure,
}: {
  status: Task["status"];
  /** The task declares a gate: it will not move to `done` by itself. */
  approvalGate: boolean;
  /** The last session's end reason if it FAILED, otherwise `null`. */
  failure?: string | null;
}): ChannelDecision | null {
  if (failure != null) return CHANNEL_DECISION.failed;
  if (status === TASK_STATUS.review) return CHANNEL_DECISION.now;
  if (approvalGate) return CHANNEL_DECISION.later;
  return null;
}
