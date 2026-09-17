// A session's state as DRAWN, in the domain, not the primitive: `Chip` knows nothing of the runtime
// statuses (batch 41). Labels live in `sessions/text.ts` (SESSION_TEXT).
import { type Session } from "../api/sessions.js";
import type { ChipState } from "../ui/chip.js";
import { SESSION_STATUS } from "../api/sessions.js";

/** `blocked` takes `st-gate`, the state the design system reserves for "to approve"
 *  (`ui/chip.css`), so the eye does not confuse it with `waiting`: a question awaits an answer, a
 *  gate awaits a decision, handled differently and at different times. */
export const SESSION_CHIP: Record<Session["status"], ChipState | string> = {
  starting: "st-wait",
  running: "st-run",
  [SESSION_STATUS.waiting]: "st-wait",
  blocked: "st-gate",
  committing: "st-run",
  destroyed: "st-ok",
  failed: "st-bad",
};

/** Statuses PROMISING work in progress, mirror of the server's `ACTIVE_STATUSES`
 *  (`sessions/session-terminal.ts`). `blocked` belongs: stopped, not finished; forgetting it here
 *  would hide it from the active session count. */
export const ACTIVE_STATES = [
  "starting",
  "running",
  SESSION_STATUS.waiting,
  "blocked",
  "committing",
];
