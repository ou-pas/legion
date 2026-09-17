// The close button of a deep page (task, agent…): resume the thread rather than always landing in
// the same place. Still one button, never a second "back" beside it, but its destination depends
// on where you came from.
//
// `useCanGoBack` (TanStack Router) returns `false` on a direct arrival (bookmark, pasted link,
// reload): the router's internal history starts at index 0 and `back()` would leave the app. The
// close button then falls back to the page's own fallback (the project board for a task, the
// registry for an agent).
import { useCallback, useEffect, useRef } from "react";
import { useCanGoBack, useRouter } from "@tanstack/react-router";

/** `fallback` is a callback rather than a fixed destination: a page whose fallback depends on
 *  loaded data (the project id) recomputes it on each click.
 *
 *  The returned gesture is stable (15/09). It was recreated every render and its three callers
 *  pass it as a prop, so any downstream memoisation was dead on arrival. `fallback` is almost
 *  always an inline closure: it lives in a ref rather than in dependencies, otherwise stabilising
 *  the return would just move the problem. */
export function useBackOrFallback(fallback: () => void): () => void {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const latest = useRef(fallback);
  useEffect(() => {
    latest.current = fallback;
  }, [fallback]);
  return useCallback(() => {
    if (canGoBack) router.history.back();
    else latest.current();
  }, [canGoBack, router]);
}
