// The project rail's collapsed state: hold it, persist it, listen for the shortcut.
//
// Application state, not router state: it does not describe where you are but how you look. In the
// URL it would travel with a shared link and vanish on a reload at the root.
//
// Every storage access is wrapped: Safari private browsing and browsers blocking third-party cookies
// throw on `localStorage`. An expanded rail is an acceptable degradation, a blank page is not.
import { useCallback, useEffect, useState } from "react";

/** Named after the product: local storage is shared per origin. */
export const RAIL_STORAGE_KEY = "legion.rail.collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, String(collapsed));
  } catch {
    // Storage refused: the collapse lasts for the open session only. Better than not collapsing.
  }
}

/** The ⌘B / Ctrl+B shortcut does exactly what the button does: one path, so mouse and keyboard
 *  cannot diverge. */
export function useRail(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = useCallback(() => setCollapsed((current) => !current), []);

  // Writing is an effect, not part of `setState`: React 19 replays the updater in development to
  // check it is pure, and an updater that writes is not.
  useEffect(() => {
    writeCollapsed(collapsed);
  }, [collapsed]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // ⌘B on macOS, Ctrl+B elsewhere, the same pair as the palette (⌘K).
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return { collapsed, toggle };
}
