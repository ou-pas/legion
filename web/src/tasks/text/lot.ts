// The text of the batch approval panel. Written for the operator at the moment of deciding: they
// read slices proposed by an agent and they only press once.
import { defineText } from "../../i18n/catalog.js";
import { plural } from "../../ui/plural.js";

export const TASK_LOT_TEXT = defineText({
  title: (n: number) => `${n} ${plural(n, "slice")} proposed`,
  emptyTitle: "No readable slice",
  /** The sentence that says what the button DOES, because it does a lot and it cannot be undone:
   *  this gesture alone ends the Breakdown step. */
  why: "Approving creates these tasks at once, with their blockers, and ends this step. It is the only gesture that ends it, and it cannot be taken back.",
  listLabel: "Slices of the batch, in rank order",
  outcome: "Observable outcome",
  validatedBy: "Validation command",
  blockedBy: (ranks: readonly number[]) => `blocked by ${ranks.join(", ")}`,
  free: "no blocker",
  approve: "Approve the batch",
  approving: "Approving…",
  /** The refusal, with its faults. The same text as the task thread and as the brief of the
   *  rerun: the operator and the agent read the same reproach. */
  refusedTitle: "Batch refused, nothing was created",
  refusedWhy:
    "Run the Breakdown step again: its agent will find these faults in its brief and drop a new batch.",
  faultsLabel: "Faults of the batch",
  noLabel: "no label",
});
