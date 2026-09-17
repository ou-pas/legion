// The "Run" shortcut, bound to the PAGE rather than a field: the action bar's Run button
// (task-actions-bar.tsx) has no input of its own, unlike the composer where ⌘/Ctrl+Enter starts
// from the typed title. Same gesture as everywhere else (ui/submit-key.ts).
//
// Silent while typing: a review comment or a secret submit on the SAME combo, and a `doing` task
// that can be rerun after a dead session can show those fields alongside the Run button. The two
// gestures must never fire together, hence the target guard: an input always has the last word.
//
// The hint is visible on the button since 14/09 (`ui/submit-shortcut.tsx`, decision D6), reversing
// the 13/09 call to hide it (ebb2dc9).
import { useEffect } from "react";
import { isSubmitKey } from "../ui/submit-key.js";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/** `enabled` is the same `runnable` that decides whether the button shows: no button, no shortcut. */
export function useLaunchShortcut(enabled: boolean, onLaunch: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (!isSubmitKey({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, nativeEvent: e }))
        return;
      e.preventDefault();
      onLaunch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onLaunch]);
}
