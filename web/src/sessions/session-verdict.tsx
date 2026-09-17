// A session's verdict: the task page first answers "what happened, what must I decide?", the raw
// trace comes AFTER (operator's choice, 23/08, proposal C). Pure presentation: the page derives the
// state, this component says it. Same tone grammar as Banner (fg/wash/line triplet + icon set by
// the tone, never a thick left stripe).
import type { ReactNode } from "react";
import { CircleCheck, Clock, Loader, MessageCircleQuestion, TriangleAlert } from "lucide-react";
import "./session-verdict.css";

export type VerdictTone = "ok" | "bad" | "run" | "wait" | "neutral";

/** The icon belongs to the TONE, not the caller: that keeps the state recognisable across screens.
 *  `run` spins (the animation lives in CSS). */
const TONE_ICON: Record<VerdictTone, ReactNode> = {
  ok: <CircleCheck aria-hidden="true" />,
  bad: <TriangleAlert aria-hidden="true" />,
  run: <Loader aria-hidden="true" />,
  wait: <MessageCircleQuestion aria-hidden="true" />,
  neutral: <Clock aria-hidden="true" />,
};

export function SessionVerdict({
  tone,
  title,
  meta,
  actions,
  compact = false,
  children,
}: {
  tone: VerdictTone;
  /** ONE LINE (04/09): verdict, facts and measures side by side, the shape of a FINISHED session,
   *  which has nothing left to decide and must not take three lines above the view. */
  compact?: boolean;
  /** The verdict in one sentence. */
  title: ReactNode;
  /** Session measures (cost, duration, model), right of the title. */
  meta?: ReactNode;
  /** Gestures following from the verdict (relaunch, open the PR draft). */
  actions?: ReactNode;
  /** <VerdictFact>s, one per line. */
  children?: ReactNode;
}) {
  return (
    <section
      className="ui-verdict"
      data-tone={tone}
      data-compact={compact ? "true" : undefined}
      role={tone === "bad" ? "alert" : "status"}
    >
      <header className="ui-verdict-head">
        <span className="ui-verdict-icon">{TONE_ICON[tone]}</span>
        <h2 className="ui-verdict-title">{title}</h2>
        {meta != null && !compact && <div className="ui-verdict-meta">{meta}</div>}
      </header>
      {children != null && <div className="ui-verdict-facts">{children}</div>}
      {/* On one line, the measures close the line: after the facts, not in the head. */}
      {meta != null && compact && <div className="ui-verdict-meta">{meta}</div>}
      {actions != null && <div className="ui-verdict-actions">{actions}</div>}
    </section>
  );
}

/** A fact established by the session: pushed branch, deposited draft, end reason. `icon` is a 13px
 *  lucide; `end` carries a one-off gesture tied to THIS fact. */
export function VerdictFact({
  icon,
  end,
  shrink = false,
  children,
}: {
  icon?: ReactNode;
  end?: ReactNode;
  /** On one line (`compact`), THIS fact yields when the line is too short: the branch, recognised
   *  from its start. The others keep their width. */
  shrink?: boolean;
  children: ReactNode;
}) {
  return (
    <p className="ui-verdict-fact" data-shrink={shrink ? "true" : undefined}>
      {icon != null && <span className="ui-verdict-fact-icon">{icon}</span>}
      <span className="ui-verdict-fact-text">{children}</span>
      {end != null && <span className="ui-verdict-fact-end">{end}</span>}
    </p>
  );
}
