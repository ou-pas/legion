// Two-step destructive action without a modal: the button turns into "Confirm? / Cancel", then
// reverts as soon as it loses focus. A modal would interrupt a task that needs neither
// interruption nor a focus trap (banned by the craft floor).
//
// Automatic disarming was removed on 26/08 as a safety fix. It reverted after 4 seconds, which
// changed the layout back: the button shrank, "Cancel" vanished, neighbours slid over. A click
// aimed at "Delete the task and 1 session?" landed on the button that had just taken its place,
// three times in a row on the task page, whose neighbour is "Resume in the terminal". Blur already
// keeps an armed action from lingering, and blur is caused by the user, so the layout never moves
// under the cursor by itself.
import { useState, type FocusEvent, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "./button.js";
import { Tooltip } from "./tooltip.js";
import { UI_TEXT } from "./vocabulary.js";
import "./confirm-action.css";

// oxlint-disable-next-line complexity -- a two-faced button: seven default prop values, the rest is `armed ? … : …` on the same node
export function ConfirmAction({
  label,
  confirmLabel = UI_TEXT.confirm,
  cancelLabel = UI_TEXT.cancel,
  announce,
  onConfirm,
  leading,
  variant = "danger",
  size = "md",
  disabled = false,
  loading,
  className,
  iconOnly = false,
}: {
  /** Resting label: "Kill switch", "Delete rule". */
  label: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Announced once armed; derived from the label by default. */
  announce?: string;
  /** Returning the promise (instead of `void`-ing it) makes the button spin, same contract as
   *  `Button`/`IconBtn` (`ui/busy.ts`). */
  onConfirm: () => void | Promise<unknown>;
  leading?: ReactNode;
  /** Used both at rest and armed: arming does not change the variant. */
  variant?: "primary" | "danger" | "default" | "quiet";
  size?: "sm" | "md";
  disabled?: boolean;
  /** Wins over the promise returned by `onConfirm`, for a caller already driving a mutation
   *  (e.g. `cleanup.isPending`) that wants the spinner past the gesture itself. */
  loading?: boolean;
  className?: string;
  /** At rest, icon only (name and tooltip from `label`/`confirmLabel`); the confirm step keeps
   *  its text label. The tooltip wraps both states so the button stays the same DOM node on
   *  click (keyboard focus does not jump). */
  iconOnly?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  // Leaving the group (Tab, click elsewhere) disarms: a destructive action does not stay primed
  // behind you.
  const onBlur = (e: FocusEvent<HTMLSpanElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setArmed(false);
  };

  // Same DOM element in both states so keyboard focus is not lost. Only "danger" changes its icon,
  // to signal the alert.
  const trigger = (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      loading={loading}
      leading={armed && variant === "danger" ? <TriangleAlert size={13} /> : leading}
      className={iconOnly && !armed ? "ui-btn-icon" : undefined}
      aria-label={iconOnly && !armed ? label : undefined}
      onClick={() => {
        if (armed) {
          setArmed(false);
          // Return the result: `Button` already detects the promise and applies its floor.
          return onConfirm();
        }
        setArmed(true);
        return undefined;
      }}
    >
      {iconOnly && !armed ? null : armed ? confirmLabel : label}
    </Button>
  );

  return (
    <span
      className={["ui-confirm", className].filter(Boolean).join(" ")}
      data-armed={armed ? "true" : undefined}
      onBlur={onBlur}
    >
      {/* The tooltip wraps both states, otherwise the node changes parent on click and focus
          falls back to the body. */}
      {iconOnly ? <Tooltip label={armed ? confirmLabel : label}>{trigger}</Tooltip> : trigger}
      {armed && (
        <Button variant="quiet" size={size} onClick={() => setArmed(false)}>
          {cancelLabel}
        </Button>
      )}
      <span className="ui-sr" role="status">
        {armed ? (announce ?? UI_TEXT.confirmAnnounce(label)) : ""}
      </span>
    </span>
  );
}
