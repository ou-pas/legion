// The column that holds the thread of a multi-screen flow: each step, its number, its label, and
// under the label what was decided there. Born from the inbox questionnaire (inbox-decoupes.html
// mockup, direction A, 07/09): one question per screen only works if the others stay visible at a
// glance.
//
// Not a `Stepper` (ui/stepper.tsx is a numeric −/+) nor a `Nav`: a step is revisited (click to
// correct) and carries an answer. No domain here: "question", "recommended", "to decide" are written
// by the caller.
import { useEffect, useRef, type ReactNode } from "react";
import { ProgressBar } from "./meter.js";
import { Label } from "./text.js";
import "./step-rail.css";

export function StepRail({
  label,
  heading,
  progress,
  className,
  children,
}: {
  /** Accessible name of the rail ("Round questions"). */
  label: string;
  /** Capital label at the top ("6 questions, then send"). */
  heading?: ReactNode;
  /** `value` steps done out of `max`. The design system meter turns green when full: the final
   *  screen. */
  progress: { value: number; max: number; label: string };
  className?: string;
  children: ReactNode;
}) {
  return (
    <nav aria-label={label} className={["ui-steprail", className].filter(Boolean).join(" ")}>
      {heading && (
        <Label as="p" className="ui-steprail-head">
          {heading}
        </Label>
      )}
      <div className="ui-steprail-items">{children}</div>
      <ProgressBar
        bare
        size="sm"
        name={progress.label}
        value={progress.value}
        max={progress.max}
        className="ui-steprail-progress"
      />
    </nav>
  );
}

/** `current` marks it as the displayed screen (`aria-current="step"`); `done` colors its index (it
 *  has an answer). `sub` is what was decided, or what remains. */
export function StepRailItem({
  index,
  title,
  sub,
  current = false,
  done = false,
  onSelect,
}: {
  index: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  current?: boolean;
  done?: boolean;
  onSelect: () => void;
}) {
  const el = useRef<HTMLButtonElement>(null);
  // Below 900px the rail is a scrolling band: the current step must stay in view as you advance.
  // In an effect on `current`, not a callback ref: that one changed identity on every parent render,
  // and the parent renders on each keystroke in the comment field, so it scrolled on every key.
  // Optional: jsdom has no `scrollIntoView`, and a test must not fail on scrolling comfort.
  useEffect(() => {
    if (current) el.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current]);
  return (
    <button
      type="button"
      className="ui-steprail-item"
      aria-current={current ? "step" : undefined}
      data-done={done ? "true" : undefined}
      onClick={onSelect}
      ref={el}
    >
      <span className="ui-steprail-index">{index}</span>
      <span className="ui-steprail-text">
        <span className="ui-steprail-title">{title}</span>
        {sub && <span className="ui-steprail-sub">{sub}</span>}
      </span>
    </button>
  );
}

/** Separates the flow's steps from the final step (summary, send). */
export function StepRailDivider() {
  return <hr className="ui-steprail-rule" />;
}
