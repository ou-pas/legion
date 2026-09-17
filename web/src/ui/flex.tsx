// The only place in the app allowed to emit inline flex, since wrapping it is its job
// (.oxlintrc.json exempts this file).
import type { CSSProperties, KeyboardEventHandler, ReactNode, Ref } from "react";
import "./flex.css";

export interface FlexProps {
  gap?: number;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
  /** Grows to fill the remaining space. */
  flex?: number | string;
  minWidth?: number;
  className?: string;
  /** Escape hatch for true one-offs; avoid. */
  style?: CSSProperties;
  /** Only for a caller that must measure or wire a third-party DOM node (e.g. dnd-kit's
   *  `useDroppable` on a board column body). */
  ref?: Ref<HTMLDivElement>;
  /** Keys bubbling up from child fields: a submit shortcut valid from any field of a form
   *  (inbox/inbox-form.tsx) goes here rather than on each one. The container is not focusable. */
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
}

export interface GridProps {
  /** Explicit variants; they collapse on their own below 900px then 560px. */
  cols?: 2 | 3 | 4 | 5;
  /** Minimum cell width (px): auto-fit grid, `cols` is then ignored. */
  min?: number;
  gap?: number;
  align?: CSSProperties["alignItems"];
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

function flexStyle(p: FlexProps, direction: "row" | "column"): CSSProperties {
  return {
    display: "flex",
    flexDirection: direction,
    alignItems: p.align,
    justifyContent: p.justify,
    gap: p.gap,
    flexWrap: p.wrap ? "wrap" : undefined,
    flex: p.flex,
    minWidth: p.minWidth,
    ...p.style,
  };
}

/** `align` defaults to center, the common case in this app. */
export function Row({ align = "center", gap = 8, ref, ...p }: FlexProps) {
  return (
    <div
      ref={ref}
      className={p.className}
      onKeyDown={p.onKeyDown}
      style={flexStyle({ ...p, align, gap }, "row")}
    >
      {p.children}
    </div>
  );
}

export function Stack({ gap = 10, ref, ...p }: FlexProps) {
  return (
    <div
      ref={ref}
      className={p.className}
      onKeyDown={p.onKeyDown}
      style={flexStyle({ ...p, gap }, "column")}
    >
      {p.children}
    </div>
  );
}

/** `align` follows the CSS default (`stretch`): children in a row share a height. Pass
 *  `align="start"` for content-height blocks (the board used to inherit `start` by default, and
 *  four lanes ended at four heights depending on their empty state). */
export function Grid({ cols = 2, min, gap = 12, align, className, style, children }: GridProps) {
  const s: CSSProperties = {
    gap,
    alignItems: align,
    gridTemplateColumns:
      min === undefined ? undefined : `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`,
    ...style,
  };
  return (
    <div
      className={["ui-grid", className].filter(Boolean).join(" ")}
      data-cols={min === undefined ? cols : undefined}
      style={s}
    >
      {children}
    </div>
  );
}

/** Pushes what follows to the right. */
export function Spacer() {
  return <span className="ui-spacer" aria-hidden="true" />;
}
