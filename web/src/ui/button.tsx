// Explicit variants, icon slots, and a width-stable `loading` state (the label does not jump
// when the spinner appears).
import {
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { isThenable, useBusyFloor } from "./busy.js";
import { Tooltip, type TooltipSide } from "./tooltip.js";
import "./button.css";

type Variant = "primary" | "default" | "quiet" | "danger";
type Size = "sm" | "md";

export function Button({
  variant = "default",
  size = "md",
  leading,
  trailing,
  icon,
  shortcut,
  loading,
  full = false,
  type = "button",
  disabled = false,
  className,
  onClick,
  children,
  ...rest
}: {
  /** "ghost" is the legacy name of "quiet"; `icon` is the legacy alias of `leading`. */
  variant?: Variant | "ghost";
  size?: Size;
  leading?: ReactNode;
  trailing?: ReactNode;
  icon?: ReactNode;
  /** Hint for the keyboard shortcut that triggers the same action, shown ON the button (12/09):
   *  as a separate caption the operator read it as a ghost second button. Text buttons only; an
   *  icon-only button shows it in its Tooltip (`IconBtn`). */
  shortcut?: ReactNode;
  /** Explicit, it always wins; when `undefined`, `Button` spins on its own if `onClick` returned
   *  a promise. Either way the shared floor (`ui/busy.ts`) keeps the spinner visible. Same
   *  contract as `IconBtn`. */
  loading?: boolean;
  full?: boolean;
  // Return type is `void`, not `void | Promise<unknown>`: hundreds of callers have handlers that
  // return something else (`cond && call()`), which TypeScript accepts only while the expected
  // type is plain `void`. Promise detection is a runtime matter (`isThenable`).
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  const [pending, setPending] = useState(false);
  const busy = useBusyFloor(loading ?? pending);

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) return;
    const result = onClick?.(e);
    if (isThenable(result)) {
      setPending(true);
      const clear = () => setPending(false);
      // `.then(clear, clear)`, not `.catch().finally()`: a second consumer never starves the
      // caller's own `.catch`; the rejection still reaches it.
      result.then(clear, clear);
    }
  };

  return (
    <button
      {...rest}
      type={type}
      className={["ui-btn", className].filter(Boolean).join(" ")}
      data-variant={variant === "ghost" ? "quiet" : variant}
      data-size={size}
      data-loading={busy ? "true" : undefined}
      data-full={full ? "true" : undefined}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={handleClick}
    >
      {/* The content stays in flow when hidden, so the width does not change. */}
      <span className="ui-btn-body">
        {leading ?? icon}
        {children}
        {trailing}
        {/* aria-hidden: otherwise the accessible name becomes the label and shortcut glued
            together, and someone activating with Enter/Space has no use for the hint. */}
        {shortcut && (
          <span className="ui-btn-shortcut" aria-hidden="true">
            {shortcut}
          </span>
        )}
      </span>
      {busy && (
        <span className="ui-btn-spin" aria-hidden="true">
          <Loader2 size={14} />
        </span>
      )}
    </button>
  );
}

/** Icon-only button. `title` is required: it is both the accessible name (`aria-label`) and the
 *  Tooltip text (`ui/tooltip.tsx`). The tooltip also opens on a `disabled` button, where it helps
 *  most: twice on 20/08 a button was removed rather than explained, because the native `title`
 *  does not show on a disabled control. `danger` and `small` are legacy aliases of
 *  `variant="danger"` / `size="sm"`.
 *
 *  Loading: an explicit `loading` wins (the caller may extend the spinner past the request, e.g.
 *  during a cache invalidation). Without it, a promise returned by `onClick` is awaited until it
 *  settles, so callers just return their promise instead of `void`-ing it. The `title` does not
 *  change while loading. The shared floor (`ui/busy.ts`) keeps the spinner visible. */
export function IconBtn({
  title,
  side,
  variant,
  size,
  danger = false,
  small = false,
  disabled = false,
  loading,
  onClick,
  render,
  className,
  children,
  ...rest
}: {
  title: string;
  side?: TooltipSide;
  /** "primary" exists for THE main gesture of an icon-only bar (task action bar, ≤640px):
   *  without a label, the solid fill is the only cue of what to do. */
  variant?: "primary" | "default" | "quiet" | "danger";
  size?: Size;
  danger?: boolean;
  small?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void | Promise<unknown>;
  /** E.g. `render={(p) => <Link to="/wiki" {...p} />}`, same escape hatch as `ui/nav.tsx` and
   *  `ui/link.tsx`. An entry that leads somewhere must be an anchor: a button calling
   *  `navigate()` loses middle-click, open in new tab and hover preloading. */
  render?: (
    props: { className: string; children: ReactNode } & HTMLAttributes<HTMLElement>,
  ) => ReactElement;
  className?: string;
  children: ReactNode;
} & Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-labelledby" | "aria-expanded" | "aria-haspopup" | "aria-controls" | "aria-pressed" | "id"
>) {
  const [pending, setPending] = useState(false);
  const busy = useBusyFloor(loading ?? pending);

  // Guard on top of native `disabled`, for when it has not taken effect yet (jsdom, synthetic
  // clicks).
  const handleClick = () => {
    if (busy) return;
    const result = onClick?.();
    if (isThenable(result)) {
      setPending(true);
      const clear = () => setPending(false);
      // `.then(clear, clear)`, not `.catch().finally()`: see `Button` above.
      result.then(clear, clear);
    }
  };

  const shared = {
    className: ["ui-btn", "ui-btn-icon", className].filter(Boolean).join(" "),
    "data-variant": variant ?? (danger ? "danger" : "default"),
    "data-size": size ?? (small ? "sm" : "md"),
    "data-loading": busy ? "true" : undefined,
    "aria-busy": busy || undefined,
    "aria-label": title,
    ...rest,
  };
  return (
    <Tooltip label={title} side={side}>
      {render ? (
        render({ ...shared, children })
      ) : (
        <button type="button" {...shared} disabled={disabled || busy} onClick={handleClick}>
          <span className="ui-btn-body">{children}</span>
          {busy && (
            <span className="ui-btn-spin" aria-hidden="true">
              <Loader2 size={14} />
            </span>
          )}
        </button>
      )}
    </Tooltip>
  );
}

/** Canonical name of `IconBtn` for new screens. */
export const IconButton = IconBtn;

/** Shared lines, radii on the ends only. */
export function ButtonGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={["ui-btn-group", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

/** Two-state button (active filter, view option); state is carried by aria-pressed. */
export function ToggleButton({
  pressed,
  onPressedChange,
  size = "md",
  leading,
  className,
  children,
}: {
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  size?: Size;
  leading?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Button
      size={size}
      leading={leading}
      className={className}
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
    >
      {children}
    </Button>
  );
}
