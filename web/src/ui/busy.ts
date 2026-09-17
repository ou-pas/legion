// Shared "a button that calls the server shows it is waiting" mechanism (16/09).
//
// `Button`, `IconBtn` and `ConfirmAction` all show a spinner while a gesture is in flight, with a
// duration floor so a 50 ms response stays visible (operator feedback that introduced
// `MIN_SPIN_MS` in `save-button.tsx`, 02/09). One timer here instead of three that could diverge.
import { useEffect, useRef, useState } from "react";

/** Long enough to be seen, short enough not to feel sluggish. Same value as `save-button.tsx`:
 *  same rule, not a coincidence. */
export const MIN_BUSY_MS = 450;

/** Enough to know we must wait for settlement, not to type the promise fully. */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as { then?: unknown }).then === "function";
}

/** Turns a raw busy signal (external `loading` prop, or a promise returned by a handler) into a
 *  floored one: once the source goes back to `false`, `true` holds for the time missing to reach
 *  `floorMs` since it last became `true`. If the source turns `true` again before the floor ends,
 *  the effect cleanup cancels the pending timer: no off-on flicker, no stacked floors.
 *
 *  Switching to `true` happens during render (React's "adjust state when a prop changes"
 *  pattern; `oxlint react/set-state-in-effect` rejects an effect that only copies a prop).
 *  Only switching off needs an effect, because it depends on a timer. */
export function useBusyFloor(sourceBusy: boolean, floorMs = MIN_BUSY_MS): boolean {
  const [busy, setBusy] = useState(sourceBusy);
  const [prevSourceBusy, setPrevSourceBusy] = useState(sourceBusy);
  // `0`, not `Date.now()`: reading the clock during render is impure (oxlint react/purity). The
  // real timestamp is set by the effect below.
  const sinceRef = useRef(0);

  if (sourceBusy !== prevSourceBusy) {
    setPrevSourceBusy(sourceBusy);
    if (sourceBusy) setBusy(true);
  }

  useEffect(() => {
    if (sourceBusy) {
      sinceRef.current = Date.now();
      return undefined;
    }
    if (sinceRef.current === 0) return undefined;
    const rest = Math.max(0, floorMs - (Date.now() - sinceRef.current));
    sinceRef.current = 0;
    const timer = setTimeout(() => setBusy(false), rest);
    return () => clearTimeout(timer);
  }, [sourceBusy, floorMs]);

  return busy;
}
