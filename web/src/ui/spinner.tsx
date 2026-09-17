// Indeterminate wait. The label is required: a spinning disc that does not say what it waits for
// informs nobody (visually hidden, read by screen readers).
import { Loader2 } from "lucide-react";
import "./spinner.css";

export function Spinner({
  size = "md",
  label,
  className,
}: {
  size?: "sm" | "md" | "lg";
  /** What is awaited: "Starting container…", "Loading sessions…". */
  label: string;
  className?: string;
}) {
  return (
    <span
      className={["ui-spinner", className].filter(Boolean).join(" ")}
      data-size={size}
      role="status"
    >
      <Loader2 aria-hidden="true" />
      <span className="ui-sr">{label}</span>
    </span>
  );
}
