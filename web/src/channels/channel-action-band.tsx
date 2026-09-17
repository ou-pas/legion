// The action band: one main thing per page state.
//
// Operator finding on the channels page: "how everything fits is not clear at first sight". The cause
// was structural: what AWAITS a decision travelled in the scrolling thread, among what NARRATES it. A
// question asked three hundred events ago sat at the bottom, collapsed, next to a composer that looked
// like the answer field without being one.
//
// This module places what waits, and knows neither answering, approving nor reconnecting: it gets
// nodes built by the screen (like `ChannelDecision` and `ChannelThread`), orders them by priority,
// and returns `null` when all are absent, since an empty frame is exactly the noise being removed.
//
// Order is priority, top to bottom: the cut stream first (while it lasts, what is read below may be
// stale), then the question (the gesture expected from the human), then the decision (gate, failure).
// They can coexist: stacked, none hidden.
//
// Two positions, an explicit variant (spec 16/09, D2): `head` is the fixed region at the top of the
// pane, `thread` sits at the end of the thread without a surface, since what it carries already has a
// frame. A boolean would leave guessing which is `true`.
import type { ReactNode } from "react";
import { CHANNELS_TEXT } from "./text.js";
import "./channel-action-band.css";

export function ChannelActionBand({
  variant,
  notice,
  pending,
  decision,
}: {
  /** `head`: fixed above the pane, carries only the stream cut. `thread`: last turn in the thread,
   *  carries question and decision, with no surface of its own. */
  variant: "head" | "thread";
  /** About the STREAM, not the conversation: the SSE cut and its way out. */
  notice?: ReactNode;
  /** The open question, its TEXT and choices, not just buttons. A slot: answering belongs to the inbox
   *  domain, this module never talks to the API. */
  pending?: ReactNode;
  /** Approval gate or session failure (`ChannelDecision`). The caller builds it ONLY when there is
   *  something to decide (`channelDecision`): a node rendering `null` would still pass this test and
   *  show an empty sheet. */
  decision?: ReactNode;
}) {
  if (notice == null && pending == null && decision == null) return null;
  // `thread` has no wrapping section: what it carries (Banner, InboxCard) already has its frame, and
  // a section would draw two frames around one object. `head` stays a region with its own surface.
  if (variant === "thread") {
    return (
      <>
        {notice}
        {pending}
        {decision}
      </>
    );
  }
  return (
    <section className={`ch-action ch-action--${variant}`} aria-label={CHANNELS_TEXT.action.label}>
      {notice}
      {pending}
      {decision}
    </section>
  );
}
