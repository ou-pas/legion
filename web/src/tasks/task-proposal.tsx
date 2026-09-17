// The composer's PROPOSAL line (operator decision, 23/08): the human writes title and brief, the
// settings (agent or chain, complexity, gate) are proposed by /api/tasks/classify, not decided for
// them. The line says WHAT WILL BE SENT on launch and where it comes from: analysing (classification
// running), proposed (with its why), defaults (fallback, classification failed), or set by hand
// (the operator touched the settings: their hand wins, proposals stop). Never a blocker: whatever
// its state, the Run button stays usable.
import type { ReactNode } from "react";
import { Bot, PenLine, Sparkles, Workflow } from "lucide-react";
import { Tag } from "../ui/chip.js";
import { Row } from "../ui/flex.js";
import { Caption } from "../ui/text.js";
import { Tooltip } from "../ui/tooltip.js";
import { TASK_PROPOSAL_TEXT as T } from "./text/proposal.js";
// Complexity levels are domain words shared with the card and settings (`text/vocabulary.ts`), not
// part of the proposal catalog: copying them here left two tables that could silently disagree.
import { TASK_TEXT } from "./text/vocabulary.js";
import "./task-proposal.css";
import type { Complexity } from "../api/tasks.js";

/** Where these values come from: the operator's hand, a fallback because classification failed, or
 *  the model, with its WHY on hover when it gave one. Never a silent mix of sources. */
function Source({
  manual,
  fallback,
  reason,
  word,
}: {
  manual: boolean;
  fallback: boolean;
  reason?: string | null;
  /** "proposed" or "proposed around your settings", depending on whether a pin constrains the model. */
  word: string;
}) {
  if (manual)
    return (
      <Caption>
        <PenLine size={11} aria-hidden="true" /> {T.manual}
      </Caption>
    );
  if (fallback) return <Caption>{T.fallback}</Caption>;
  const said = (
    <Caption className={reason ? "dm-proposal-why" : undefined}>
      <Sparkles size={11} aria-hidden="true" /> {word}
    </Caption>
  );
  return reason ? <Tooltip label={reason}>{said}</Tooltip> : said;
}

/** One proposal value, with the pen mark when the operator set it: what comes from the hand and what
 *  comes from the model shows at a glance. */
function Value({ pinned, children }: { pinned: boolean; children: ReactNode }) {
  return (
    <Tag>
      {children}
      {pinned && (
        <>
          {" "}
          <PenLine size={10} aria-label={T.pinned} />
        </>
      )}
    </Tag>
  );
}

export function TaskProposal({
  pending,
  manual,
  kind,
  name,
  complexity,
  gate,
  reason,
  pinned,
}: {
  /** Classification running (debounce + haiku round trip). */
  pending: boolean;
  /** EVERYTHING set by hand: nothing is proposed any more. */
  manual: boolean;
  kind: "agent" | "chain";
  /** Name of the agent or chain that will be sent. */
  name: string;
  complexity: Complexity;
  gate: boolean;
  /** The model's WHY, "fallback" when classification failed. */
  reason?: string | null;
  /** Per-field pins: a pinned field is the operator's choice, a CONSTRAINT the classifier respects
   *  while proposing the others around it. Its chip carries the pen mark. */
  pinned?: { target: boolean; complexity: boolean; gate: boolean };
}) {
  if (pending) {
    return (
      <Row gap={6} className="dm-proposal" data-state="pending">
        <Sparkles size={13} aria-hidden="true" />
        <Caption>{T.pending}</Caption>
      </Row>
    );
  }
  const pins = pinned ?? { target: false, complexity: false, gate: false };
  const anyPin = pins.target || pins.complexity || pins.gate;
  const fallback = !manual && reason === "repli";
  const proposedWord = anyPin ? T.proposedAround : T.proposed;
  return (
    <Row
      gap={6}
      wrap
      className="dm-proposal"
      data-state={manual ? "manual" : fallback ? "fallback" : "proposed"}
    >
      <Value pinned={pins.target}>
        {kind === "chain" ? (
          <Workflow size={11} aria-hidden="true" />
        ) : (
          <Bot size={11} aria-hidden="true" />
        )}{" "}
        {name}
      </Value>
      {kind === "agent" && (
        <Value pinned={pins.complexity}>{TASK_TEXT.complexity[complexity]}</Value>
      )}
      {kind === "agent" && (gate || pins.gate) && (
        <Value pinned={pins.gate}>{gate ? T.gate : T.noGate}</Value>
      )}
      <Source manual={manual} fallback={fallback} reason={reason} word={proposedWord} />
    </Row>
  );
}
