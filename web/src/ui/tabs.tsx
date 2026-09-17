// Compound component: state lives in the provider. By default the inactive panel is not rendered:
// an SSE timeline must not keep living backstage.
import { createContext, use, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import "./tabs.css";

/** underline = navigation within a page · segmented = choosing a view (joined buttons). */
export type TabsVariant = "underline" | "segmented";

interface TabsCtx {
  value: string;
  select: (v: string) => void;
  baseId: string;
  unmountInactive: boolean;
}
const TabsContext = createContext<TabsCtx | null>(null);

function useTabs(): TabsCtx {
  const ctx = use(TabsContext);
  if (!ctx) throw new Error("Tab / TabList / TabPanel must be rendered inside <Tabs>.");
  return ctx;
}

export function Tabs({
  value,
  defaultValue = "",
  onValueChange,
  variant = "underline",
  unmountInactive = true,
  className,
  children,
}: {
  /** Controlled: `value` + `onValueChange`. Uncontrolled: `defaultValue` alone. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  variant?: TabsVariant;
  /** false = inactive panels stay mounted and are only hidden (state kept). */
  unmountInactive?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue);
  const current = value ?? internal;
  const select = (next: string) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };
  return (
    <TabsContext value={{ value: current, select, baseId, unmountInactive }}>
      <div className={["ui-tabs", className].filter(Boolean).join(" ")} data-variant={variant}>
        {children}
      </div>
    </TabsContext>
  );
}

/** Wrapping ←/→ arrows, Home/End, activation on focus move. */
export function TabList({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const { select } = useTabs();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const tabs = [
      ...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    ];
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight"
        ? i === last
          ? 0
          : i + 1
        : e.key === "ArrowLeft"
          ? i === 0
            ? last
            : i - 1
          : e.key === "Home"
            ? 0
            : last;
    const target = tabs[next];
    if (!target) return;
    e.preventDefault();
    target.focus();
    if (target.dataset["value"] != null) select(target.dataset["value"]);
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={["ui-tablist", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

/** Only the active tab is in the tab order (roving tabindex). */
export function Tab({
  value,
  count,
  icon,
  disabled = false,
  className,
  children,
}: {
  value: string;
  count?: number;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { value: current, select, baseId } = useTabs();
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      data-value={value}
      disabled={disabled}
      id={`${baseId}t-${value}`}
      aria-controls={`${baseId}p-${value}`}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={["ui-tab", className].filter(Boolean).join(" ")}
      onClick={() => select(value)}
    >
      {icon}
      {children}
      {count != null && <span className="ui-tab-count">{count}</span>}
    </button>
  );
}

export function TabPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const { value: current, baseId, unmountInactive } = useTabs();
  const active = current === value;
  if (unmountInactive && !active) return null;
  return (
    <div
      role="tabpanel"
      hidden={!active}
      tabIndex={0}
      id={`${baseId}p-${value}`}
      aria-labelledby={`${baseId}t-${value}`}
      className={["ui-tabpanel", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}
