// StatusChip = a domain state · Chip = neutral label, optionally selectable · Tag = literal data
// (model, branch) · Badge = a counter. Status labels live with their domain
// (sessions/session-status.ts, tasks/task-status.ts): a dot draws, it does not know what a
// session is.
import type { ReactNode } from "react";
import { Tooltip, type TooltipSide } from "./tooltip.js";
import "./chip.css";

export type ChipState = "idle" | "run" | "wait" | "gate" | "ok" | "bad";
export type ChipSize = "sm" | "md";

/** `st-run` → `run`: some pages still pass the legacy class names. */
function toState(kind: string): ChipState {
  const k = kind.startsWith("st-") ? kind.slice(3) : kind;
  return k === "run" || k === "wait" || k === "gate" || k === "ok" || k === "bad" ? k : "idle";
}

/** The `run` dot pulses, because it is running. `title` is not the native attribute (invisible
 *  for ~1s, absent on keyboard) but the text of the app's single `Tooltip` (`ui/tooltip.tsx`). */
export function StatusChip({
  state,
  dot = true,
  size = "md",
  title,
  className,
  children,
}: {
  state: ChipState;
  dot?: boolean;
  size?: ChipSize;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const el = (
    <span
      className={["ui-chip", className].filter(Boolean).join(" ")}
      data-state={state}
      data-size={size}
    >
      {dot && <span className="ui-chip-dot" aria-hidden="true" />}
      {children}
    </span>
  );
  return title ? <Tooltip label={title}>{el}</Tooltip> : el;
}

/** State without the word; the word goes in the tooltip and the accessible name (05/09). For a
 *  header that is already full, e.g. a runner's, where spelling out the state wrapped the row.
 *  `label` is required: a color alone tells nothing to someone who cannot see it. */
export function StatusDot({
  state,
  label,
  className,
}: {
  state: ChipState;
  label: string;
  className?: string;
}) {
  return (
    <Tooltip label={label}>
      <span
        className={["ui-chip", "ui-chip-bare", className].filter(Boolean).join(" ")}
        data-state={state}
        role="img"
        aria-label={label}
      >
        <span className="ui-chip-dot" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

/** `onToggle` makes it a two-state filter. `kind`/`mono`/`dot` are the legacy API. */
export function Chip({
  kind = "st-neutral",
  mono = false,
  dot = false,
  selected,
  onToggle,
  size = "md",
  title,
  className,
  children,
}: {
  kind?: string;
  mono?: boolean;
  dot?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  size?: ChipSize;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const attrs = {
    className: ["ui-chip", className].filter(Boolean).join(" "),
    "data-state": toState(kind),
    "data-size": size,
    "data-mono": mono ? "true" : undefined,
  };
  const body = (
    <>
      {dot && <span className="ui-chip-dot" aria-hidden="true" />}
      {children}
    </>
  );
  const el =
    onToggle == null ? (
      <span {...attrs} data-selected={selected ? "true" : undefined}>
        {body}
      </span>
    ) : (
      <button
        {...attrs}
        type="button"
        data-toggle="true"
        aria-pressed={selected ?? false}
        onClick={onToggle}
      >
        {body}
      </button>
    );
  return title ? <Tooltip label={title}>{el}</Tooltip> : el;
}

/** The frame says "clickable" (16/09), hence two variants rather than a boolean. `framed` reads
 *  on its own in text or metadata; `flat` is for a row where markers sit next to buttons, where
 *  a framed Tag looked like a button. */
export type TagVariant = "framed" | "flat";

/** Literal data: a model `claude-sonnet-5`, a branch `legion/checkout`, a path. Mono and square
 *  so it reads apart from a state at a glance. `side` for a Tag in a dense list, where a
 *  top/bottom bubble would cover the next row. */
export function Tag({
  variant = "framed",
  title,
  side,
  className,
  children,
}: {
  variant?: TagVariant;
  title?: string;
  side?: TooltipSide;
  className?: string;
  children: ReactNode;
}) {
  const el = (
    <span className={["ui-tag", className].filter(Boolean).join(" ")} data-variant={variant}>
      {children}
    </span>
  );
  return title ? (
    <Tooltip label={title} side={side}>
      {el}
    </Tooltip>
  ) : (
    el
  );
}

/** `label` carries the meaning: "7 questions waiting". */
export function Badge({
  count,
  tone = "neutral",
  max = 99,
  label,
  className,
}: {
  count: number;
  tone?: "neutral" | "accent" | "wait" | "bad";
  max?: number;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={["ui-badge", className].filter(Boolean).join(" ")}
      data-tone={tone}
      role={label == null ? undefined : "status"}
      aria-label={label}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
