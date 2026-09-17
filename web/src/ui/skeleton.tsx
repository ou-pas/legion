// A shape is never announced (aria-hidden): the container carries aria-busy and says what is
// loading. Opacity pulse only, no shiny sweep: this is not a loader.
import { UI_TEXT } from "./vocabulary.js";
import "./skeleton.css";

/** text = a line of text · block = a slab (preview, card) · chip = a label · circle = an avatar. */
export type SkeletonShape = "text" | "block" | "chip" | "circle";
/** Discrete widths: a loading shape does not deserve inline style. */
export type SkeletonWidth = "full" | "lg" | "md" | "sm";

export function Skeleton({
  shape = "text",
  width = "full",
  className,
}: {
  shape?: SkeletonShape;
  width?: SkeletonWidth;
  className?: string;
}) {
  return (
    <span
      className={["ui-skeleton", className].filter(Boolean).join(" ")}
      data-shape={shape}
      data-width={width}
      aria-hidden="true"
    />
  );
}

/** `lines` lines, the last one shorter (that makes the shape believable). The block carries
 *  role="status", aria-busy and the label of what is loading. */
export function SkeletonText({
  lines = 3,
  width = "full",
  label = UI_TEXT.loading,
  className,
}: {
  lines?: number;
  width?: SkeletonWidth;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={["ui-skeleton-text", className].filter(Boolean).join(" ")}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <Skeleton key={i} shape="text" width={i === lines - 1 && lines > 1 ? "sm" : width} />
      ))}
    </div>
  );
}
