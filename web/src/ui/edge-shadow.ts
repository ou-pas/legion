// Edge shadow: "there is more above / below" (06/09).
//
// A fixed gradient would lie when content fits, so the measure reruns on every scroll and resize.
// CSS reads `data-edge` on the frame, not on the scrolling viewport: pseudo-elements would scroll
// away with the content. The hook serves `Select`, which holds its nodes in state; `ScrollArea`
// calls `paintEdges` from its own effect, where it also watches mutations and bottom-following.
import { useEffect } from "react";

export function paintEdges(host: HTMLElement, view: HTMLElement): void {
  const above = view.scrollTop > 1;
  const below = Math.ceil(view.scrollTop + view.clientHeight) < view.scrollHeight - 1;
  // Both nodes are held in state (callback-ref pattern): the rule sees a mutated React state, but
  // `dataset` is an imperative DOM API.
  // oxlint-disable-next-line react/immutability, no-param-reassign -- DOM API (dataset), not React state
  host.dataset.edge = above && below ? "both" : above ? "top" : below ? "bottom" : "none";
}

/** Keeps `data-edge` current while both nodes are mounted. No mutation observer, unlike
 *  `ScrollArea`: dropdown lists do not change content while open. */
export function useEdgeShadow(host: HTMLElement | null, view: HTMLElement | null): void {
  useEffect(() => {
    if (!host || !view) return;
    const update = () => paintEdges(host, view);
    update();
    view.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(view);
    return () => {
      view.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [host, view]);
}
