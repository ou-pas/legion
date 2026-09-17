// Detects whether a node really overflows its box, so `Ellipsis` only opens a tooltip when
// truncation actually happened.
//
// One `ResizeObserver` per instance over a list of hundreds of rows would be costly, but a single
// observer shared by the whole app is not: its callback only iterates the batch it already receives,
// whether it observes 3 nodes or 3000.
import { useCallback, useEffect, useRef, useState } from "react";

type Check = () => void;

let shared: ResizeObserver | null = null;
const checks = new Map<Element, Check>();

function observer(): ResizeObserver {
  // One `ResizeObserver` for the whole process: its callback receives a batch of entries (one per
  // moved node) and makes one round-trip to React per affected node.
  shared ??= new ResizeObserver((entries) => {
    for (const entry of entries) checks.get(entry.target)?.();
  });
  return shared;
}

/** True if the element overflows its box: width for single-line truncation, height for
 *  `-webkit-line-clamp` (`multiline`). The measured node is the one the caller puts `ref` on, not
 *  an added wrapper, which would skew the measure. `content` only retriggers measuring: the
 *  `ResizeObserver` reacts to box changes, not to longer text in a fixed-size box. */
export function useTruncated<T extends Element>(multiline: boolean, content?: unknown) {
  const ref = useRef<T>(null);
  const [truncated, setTruncated] = useState(false);

  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setTruncated(multiline ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth);
  }, [multiline]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    check();
    checks.set(el, check);
    observer().observe(el);
    return () => {
      checks.delete(el);
      observer().unobserve(el);
    };
  }, [check]);

  // Remeasure only when the displayed text changes, not on every render.
  useEffect(check, [check, content]);

  return { ref, truncated };
}
