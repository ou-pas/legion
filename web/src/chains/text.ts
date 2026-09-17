// The text of the chains domain: the chains installed on a project (with, under each chain, the
// agent holding each role — merged in on 12/09 from the "Settings › Chains" page), the
// cross-project library, and the modal that shows the steps before you install blind.
import { defineText } from "../i18n/catalog.js";
import { plural } from "../ui/plural.js";

export const CHAIN_TEXT = defineText({
  /** How many steps a chain carries — the same number at the head of the row and in the tooltip. */
  stepCount: (count: number) => `${count} ${plural(count, "step")}`,
  stepCountTitle: "Number of steps",
  viewSteps: (count: number, name: string) => `See the ${count} steps of “${name}”`,

  installed: {
    title: "Installed chains",
    desc: "An installed chain is run from the task composer (“new task”). Removing a chain is refused while an unfinished task still follows it, and it names that task. Which agent holds each role is set under each chain below (role → agent mapping, v29); editing the steps themselves comes in a later slice.",
    listLabel: "Installed chains",
    emptyTitle: "No chain on this project",
    emptyWhy:
      "Install “feature” or “bugfix” from the library below, or promote a chain from another project.",
    // Icon plus tooltip, like its two neighbours (operator feedback: a text button between two
    // mute icons, and a "Promote" that did not say what it did).
    promote: "Promote to the library: the chain becomes installable in other projects",
    uninstall: "Remove from the project (the library itself does not move)",
  },

  library: {
    title: "Chain library",
    desc: "“Promote” on an installed chain (block above) adds it here; “Install in this project” creates the copy — along with any missing step agents.",
    listLabel: "Chain library",
    emptyTitle: "Library empty",
    install: "Install in this project",
    alreadyInstalled: "already installed",
    // A built-in entry has no bin at all — a greyed button explains nothing (the native `title`
    // does not show on a disabled button): the reason is written out in the row.
    builtin: "· ships with Legion, cannot be deleted",
    remove: "Remove from the library (copies already installed do not move)",
  },

  steps: {
    title: (name: string) => `Steps of “${name}”`,
    listLabel: (name: string) => `Steps of the ${name} chain`,
    stepAgent: "Step agent",
    gate: "gate",
    gateWhy: "Stops for a human approval before going on",
  },

  /** Which agent holds each role of an INSTALLED chain (v29), rendered under each row of the
   *  block above since 12/09 — "Settings › Chains", which carried this mapping apart, has been
   *  merged in here (its address now redirects). Resolved when a chain is RUN: a chain already in
   *  flight keeps its agents; a role mapped to an agent that is gone refuses the chain, naming
   *  it. */
  roles: {
    /** A role mapped to an agent from an uninstalled chain stays DISPLAYED, apart: hiding it
     *  would erase it on the next save, without anyone having asked. */
    orphanRole: "role inherited from an uninstalled chain",
    selectLabel: (role: string) => `Agent holding the role “${role}”`,
    catalogDefault: (agentName: string) => `catalog default (${agentName})`,
    removeMapping: "— remove this mapping —",
    /** Same rule as an unknown model id: a broken setting shows, it does not erase itself. */
    deletedAgent: "(agent deleted)",
    save: "Save",
    saved: "Saved",
  },

  /** A run's FLOW (26/08) — who produced what, who is waiting on whom. The board only ever showed
   *  the steps in columns, never in the order they chain: this view is the answer, one node per
   *  real task, in `stepIndex` order. */
  run: {
    fallbackTitle: "Chain",
    railLabel: (name: string) => `Flow of the ${name} chain`,
    request: "Original request",
    backToBoard: "Back to the board",
    notFoundTitle: "Run not found",
    notFoundWhy: "No task carries this run — it may have been deleted.",
    /** A single step is enough for the link to show on the task card. */
    openFromCard: "See the chain flow",
    openFromTask: "See the chain flow",
    /** The SHORT label of the pill — the full sentence lives in the tooltip (`openFromTask`). */
    chainLabel: "chain",
    awaitedBy: (names: string[]) => `awaited by ${names.join(", ")}`,
    gateCount: (n: number) => `${n} ${plural(n, "gate")}`,
  },
});
