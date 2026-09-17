// Reads a breakpoint from JavaScript when CSS is not enough.
//
// Breakpoints live in CSS: a media query needs no React to hide a rail. This hook is for the
// opposite case, when what changes is what gets rendered. The board on a phone shows a single lane,
// and an unrendered lane is not a hidden one: hidden in CSS, its cards would stay in the DOM, in
// dnd-kit's tree and in keyboard navigation.
//
// `matchMedia`, not a `resize` listener: the browser only evaluates the query when crossing it,
// while `resize` wakes React on every pixel of a rotation or a retracting bar.
//
// `useSyncExternalStore` because that is exactly what it is: a source of truth outside React.
// With `useState` + `useEffect` the first render would lie and the correction would land in an
// effect, which `react(set-state-in-effect)` rightly refuses.
import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = useCallback(() => window.matchMedia(query).matches, [query]);
  // The third argument is the server render value, which has no screen: false is the right default,
  // it renders the wide layout, the one that assumes nothing.
  return useSyncExternalStore(subscribe, read, () => false);
}

/** The repo's phone breakpoint, written once. Same number as `ui/shell.css` and
 *  `scripts/arch-metrics.ts` (`BREAKPOINTS`). */
export const COMPACT_QUERY = "(max-width: 640px)";
