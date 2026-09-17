// With Kbd and Num, the only modules allowed to use `--mono`: mono marks a literal the operator
// can copy (path, hash, command, payload), not a kind of text.
import type { ReactNode } from "react";
import "./code.css";

/** `wash` = recessed pill (in prose) · `bare` = plain mono (in a chip, list row or cell, where the
 *  container already carries the background). */
export function Code({
  variant = "wash",
  className,
  title,
  children,
}: {
  variant?: "wash" | "bare";
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <code
      className={["ui-code", className].filter(Boolean).join(" ")}
      data-variant={variant}
      title={title}
    >
      {children}
    </code>
  );
}

/** `scroll` = one line is one line, horizontal overflow (JSON payloads) · `wrap` = wrapping (a
 *  rule's text) · `preview` = `wrap` with a capped height. */
export function CodeBlock({
  variant = "scroll",
  label,
  className,
  children,
}: {
  variant?: "scroll" | "wrap" | "preview";
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // tabIndex: a scrolling region must be keyboard-reachable (WCAG 2.1.1).
    <pre
      className={["ui-codeblock", className].filter(Boolean).join(" ")}
      data-variant={variant}
      tabIndex={0}
      role={label ? "region" : undefined}
      aria-label={label}
    >
      <code>{children}</code>
    </pre>
  );
}
