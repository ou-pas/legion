// What `Select` and `Combobox` did twice (06/09): the active index, the keys moving it (↑ ↓ Home
// End), and keeping the active option in view. A list whose arrows leave the frame is navigated
// blind, and that kind of defect only gets fixed in the half where it was seen.
//
// Left out on purpose: opening, choosing, closing. A `Select` opens on the chosen option and closes
// on Space; a `Combobox` opens on its text field, where Space is a character and left/right move the
// caret. One shared handler would need flags, and a flag saying "I am a select" means two different
// things were merged.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/** Typeahead accumulation window: two keystrokes further apart start over from one letter, like a
 *  native `<select>`. */
const TYPEAHEAD_MS = 800;

export interface Listbox {
  /** The keyboard-highlighted option. `-1` when the list is empty. */
  active: number;
  setActive: (i: number) => void;
  /** Moves `span` steps in a direction, skipping disabled options, without crossing the edge (10
   *  steps for PageUp/PageDown). */
  move: (dir: 1 | -1, span?: number) => void;
  /** ↑ ↓ Home End. Returns `true` if the key was consumed; otherwise the caller handles its own. */
  navigate: (e: KeyboardEvent) => boolean;
  /** Close keystrokes accumulate and target the first label starting with them. */
  typeahead: (key: string) => void;
}

export function useListbox<T>({
  items,
  view,
  labelOf,
  disabledOf = () => false,
}: {
  items: readonly T[];
  /** The scrolling viewport (not the floating surface), where the active option is brought into
   *  view. `null` while the list is closed. */
  view: HTMLElement | null;
  labelOf: (item: T) => string;
  disabledOf?: (item: T) => boolean;
}): Listbox {
  const [active, setActive] = useState(0);
  const typed = useRef({ buffer: "", at: 0 });

  // Minimal scrolling (no centering): the view only moves when the targeted option is hidden.
  //
  // `items.length`, not `items`: a combobox's filtered list changes identity on every keystroke,
  // and rerunning the effect each render would yank the view from someone scrolling it. When the
  // length does not change, the option at index `active` is in the same place.
  useEffect(() => {
    if (!view) return;
    const el = view.querySelector<HTMLElement>('[data-active="true"]');
    if (!el) return;
    const lo = el.offsetTop,
      hi = lo + el.offsetHeight;
    // oxlint-disable-next-line react/immutability, no-param-reassign -- DOM API (scrollTop), not React state
    if (lo < view.scrollTop) view.scrollTop = lo;
    // oxlint-disable-next-line react/immutability, no-param-reassign -- DOM API (scrollTop), not React state
    else if (hi > view.scrollTop + view.clientHeight) view.scrollTop = hi - view.clientHeight;
  }, [view, active, items.length]);

  const step = (from: number, dir: 1 | -1): number => {
    for (let i = from + dir; i >= 0 && i < items.length; i += dir) {
      const item = items[i];
      if (item !== undefined && !disabledOf(item)) return i;
    }
    return from;
  };

  const move = (dir: 1 | -1, span = 1) =>
    setActive((i) => {
      let j = i;
      for (let n = 0; n < span; n += 1) {
        const next = step(j, dir);
        if (next === j) break;
        j = next;
      }
      return j;
    });

  const navigate = (e: KeyboardEvent): boolean => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
      return true;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActive(step(-1, 1));
      return true;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActive(step(items.length, -1));
      return true;
    }
    return false;
  };

  const typeahead = (key: string) => {
    const now = performance.now();
    typed.current.buffer = now - typed.current.at > TYPEAHEAD_MS ? key : typed.current.buffer + key;
    typed.current.at = now;
    const needle = typed.current.buffer.toLowerCase();
    const hit = items.findIndex(
      (x) => !disabledOf(x) && labelOf(x).toLowerCase().startsWith(needle),
    );
    if (hit >= 0) setActive(hit);
  };

  return { active, setActive, move, navigate, typeahead };
}
