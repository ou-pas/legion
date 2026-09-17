// Bounded scroll area: a task's timeline, a goal's log, the ⌘K palette list. Edge shadows are
// computed on scroll to say "there is more above / below"; a fixed gradient would lie when content
// fits.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { paintEdges } from "./edge-shadow.js";
import { UI_TEXT } from "./vocabulary.js";
import "./scroll-area.css";

/** Tolerance for "at the bottom": a rounding pixel must not drop following, and a half-visible
 *  line still counts as the bottom. */
const AT_BOTTOM_SLACK = 24;

export function ScrollArea({
  size = "md",
  label,
  follow = false,
  count,
  liveNoun = UI_TEXT.scroll.defaultNoun,
  className,
  children,
}: {
  /** `fill`: the pane takes the height its parent leaves instead of a fixed cap. A window-height
   *  conversation needs it: a pixel `max-height` left a gap on large screens and cut the thread on
   *  small ones. */
  size?: "sm" | "md" | "lg" | "viewport" | "fill";
  /** Name of the area: makes it keyboard-reachable even when its content is text. */
  label?: string;
  /** Live pane: follows the bottom as content arrives, but only if you were already there.
   *
   *  Replaced the task page's `scrollIntoView()`, which had two defects: it scrolled every
   *  scrollable ancestor, document included (the whole page moved on each SSE event), and it
   *  scrolled unconditionally, so reading an older event was impossible. Here only this container's
   *  `scrollTop` moves, and following stops when the operator scrolls up and resumes when they come
   *  back down, like a terminal. */
  follow?: boolean;
  /** Item count from the caller, used only to number the "new below" pill. Counting DOM mutations
   *  would be wrong as soon as an item updates in place; the caller knows what an item is. */
  count?: number;
  /** What is counted, in the singular: the pill agrees it with `count`. */
  liveNoun?: string;
  className?: string;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  // True at start: a freshly opened pane follows. A ref, not state: it is read in the mutation
  // observer, a render would be wasted.
  const atBottom = useRef(true);
  // What arrived while looking elsewhere. The view is never forced down: scrolling up to read is an
  // intent, breaking it is the defect fixed here. It is signalled, one click to go back down.
  const [unseen, setUnseen] = useState(0);
  const seen = useRef(count ?? 0);

  const toBottom = useCallback(() => {
    const v = view.current;
    if (!v) return;
    v.scrollTop = v.scrollHeight;
    atBottom.current = true;
    setUnseen(0);
  }, []);

  useEffect(() => {
    const v = view.current,
      f = frame.current;
    if (!v || !f) return;
    // Same measure as `Select`, from `edge-shadow.ts`, called directly rather than through its hook
    // because this effect also handles bottom-following and the mutation observer.
    const update = () => paintEdges(f, v);
    // Measured on every scroll, so always before new content: when the observer fires, the
    // container has already grown and a measure then would be wrong.
    const remember = () => {
      atBottom.current = v.scrollHeight - v.scrollTop - v.clientHeight <= AT_BOTTOM_SLACK;
      // Scrolling back down by hand acknowledges. An unconditional `setUnseen(0)` would render on
      // every wheel notch; returning the same value lets React bail out.
      if (atBottom.current) setUnseen((u) => (u === 0 ? u : 0));
    };
    const onScroll = () => {
      remember();
      update();
    };
    update();
    // Initial position, not only a reaction to additions: when opening a session already under way,
    // the whole SSE replay is there before mount, so no mutation follows and the pane stayed at the
    // top of a three-hundred-line trace.
    if (follow) v.scrollTop = v.scrollHeight;
    v.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(v);
    // Content grows on its own (SSE log stream): otherwise the bottom shadow would lie.
    const mo = new MutationObserver(() => {
      // Instant, not `smooth`: at two events per second animations stack and the pane never stops
      // moving.
      if (follow && atBottom.current) v.scrollTop = v.scrollHeight;
      update();
    });
    mo.observe(v, { childList: true, subtree: true, characterData: true });
    return () => {
      v.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
    };
  }, [follow]);
  // Counted here rather than in the mutation observer: when this effect runs the DOM is committed
  // but `atBottom` still holds the measure from before growth, which is exactly the question ("were
  // we at the bottom?").
  useEffect(() => {
    if (count === undefined) return;
    const grown = count - seen.current;
    seen.current = count;
    if (grown <= 0) return;
    if (!atBottom.current) setUnseen((u) => u + grown);
  }, [count]);

  return (
    <div
      className={["ui-scroll", className].filter(Boolean).join(" ")}
      ref={frame}
      data-edge="none"
      data-fill={size === "fill" ? "true" : undefined}
    >
      <div
        className="ui-scroll-view"
        ref={view}
        data-size={size}
        role={label ? "region" : undefined}
        aria-label={label}
        tabIndex={label ? 0 : undefined}
      >
        {children}
      </div>
      {/* Only present when there is something to acknowledge. A button, not text: it is an action
          and must be keyboard-reachable like the rest of the pane. */}
      {follow && unseen > 0 && (
        <button type="button" className="ui-scroll-jump" onClick={toBottom}>
          <ArrowDown size={12} aria-hidden="true" />
          {UI_TEXT.scroll.unseenBelow(unseen, liveNoun)}
        </button>
      )}
    </div>
  );
}
