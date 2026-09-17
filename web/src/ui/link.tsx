// Implements no navigation: `render` receives the computed class and children, so the page
// provides its own navigation element (TanStack Router's `<Link>`) without the library depending
// on it.
import type { AnchorHTMLAttributes, ReactElement, ReactNode } from "react";
import "./link.css";

/** `plain` = no underline (the context carries the affordance: chip, list row).
 *  `inherit` = no underline and inherited color (fully clickable card). */
export type LinkVariant = "default" | "plain" | "inherit";

export function Link({
  variant = "default",
  render,
  className,
  children,
  ...rest
}: {
  variant?: LinkVariant;
  /** E.g. `render={(p) => <RouterLink to="/p/$projectId/tasks/$taskId" params={{ projectId, taskId }} {...p} />}`.
   *  `p` also carries the remaining native attributes (including an `aria-describedby` injected by
   *  a wrapping `Tooltip`): the element must spread them on itself. */
  render?: (
    props: { className: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>,
  ) => ReactElement;
  className?: string;
  children: ReactNode;
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  // Variant goes through the class, not a `data-*`: it must survive the trip to a foreign
  // component that may not accept arbitrary attributes.
  const cls = ["ui-link", variant !== "default" && `ui-link-${variant}`, className]
    .filter(Boolean)
    .join(" ");
  // `...rest` must reach the rendered element even when `render` provides its own: a wrapping
  // <Tooltip> sets `aria-describedby` via `cloneElement`, and it was silently lost here (same bug
  // as IconBtn, fixed the same day, a11y audit).
  if (render) return render({ className: cls, children, ...rest });
  return (
    <a className={cls} {...rest}>
      {children}
    </a>
  );
}
