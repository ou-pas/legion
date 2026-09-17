// Drawn select replacing the native <select> (WAI-ARIA listbox pattern).
//
// A native <select>'s dropdown is rendered by the OS (blue macOS menu, Windows menu) and no CSS
// reaches it: the closed control had the design, the open list did not (operator report).
//
// The API stays native-shaped so existing calls do not change: <option>/<optgroup> children and an
// `onChange` receiving `{ target: { value } }`. Children are never mounted: they are a declaration,
// read with Children.
import {
  Children,
  isValidElement,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useEdgeShadow } from "./edge-shadow.js";
import { Ellipsis } from "./ellipsis.js";
import { useFieldAria } from "./field-aria.js";
import { maxSurfaceWidth, useAnchoredPoint, useDismiss } from "./floating.js";
import { useListbox } from "./use-listbox.js";
import { UI_TEXT } from "./vocabulary.js";
import "./select.css";

interface Entry {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}
/** Entry plus the group heading to show before it (computed once, not during render). */
interface Row extends Entry {
  head?: string;
}

/** Reads the <option>/<optgroup> declaration without mounting it. */
function read(children: ReactNode, group?: string): Entry[] {
  return Children.toArray(children).flatMap((child): Entry[] => {
    if (!isValidElement(child)) return [];
    const el = child as ReactElement<{
      value?: string;
      label?: string;
      disabled?: boolean;
      children?: ReactNode;
    }>;
    if (el.type === "optgroup") return read(el.props.children, el.props.label);
    if (el.type !== "option") return [];
    const label = Children.toArray(el.props.children)
      .filter((c) => typeof c === "string" || typeof c === "number")
      .join("");
    return [
      {
        value: String(el.props.value ?? label),
        label: label || String(el.props.value ?? ""),
        group,
        disabled: el.props.disabled,
      },
    ];
  });
}

// oxlint-disable-next-line complexity -- five default props, then seven `data-*` and `aria-*` attributes as `x ? … : undefined` on one tree: the design system idiom for a boolean in the DOM
export function Select({
  value,
  onChange,
  size = "md",
  invalid = false,
  disabled = false,
  placeholder = UI_TEXT.selectPlaceholder,
  className,
  title,
  children,
  ...aria
}: {
  /** Accepts a number (standup hour): comparison is done on the string. */
  value: string | number;
  /** Same shape as the native event, so existing calls do not change. */
  onChange: (e: { target: { value: string } }) => void;
  size?: "sm" | "md";
  invalid?: boolean;
  disabled?: boolean;
  /** Shown when `value` matches no option. */
  placeholder?: string;
  className?: string;
  title?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-required"?: true;
}) {
  // What the parent <Field> declared: without it a required select stayed silent, since context
  // did not cross the domain components wrapping it (see ui/field-aria).
  const field = useFieldAria();
  const entries = useMemo<Row[]>(() => {
    const flat = read(children);
    // No mutated variable: the heading is inferred from the previous neighbour.
    return flat.map((e, i) => ({
      ...e,
      head: e.group && e.group !== flat[i - 1]?.group ? e.group : undefined,
    }));
  }, [children]);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const current = String(value);
  const selectedIndex = entries.findIndex((e) => e.value === current);
  const point = useAnchoredPoint({ anchor, surface, open });
  useDismiss(
    open,
    (viaKeyboard) => {
      setOpen(false);
      if (viaKeyboard) anchor?.focus();
    },
    anchor,
    surface,
  );
  // Without it a long list (models) seemed to end at its last visible row (operator feedback).
  useEdgeShadow(surface, view);
  // Active index, movement keys, typeahead and keeping the active option in view: shared with
  // `Combobox` (06/09).
  const list = useListbox({
    items: entries,
    view,
    labelOf: (e) => e.label,
    disabledOf: (e) => e.disabled === true,
  });
  const { active, setActive } = list;

  const selected = selectedIndex < 0 ? undefined : entries[selectedIndex];
  const id = (i: number) => `${aria["aria-label"] ?? "sel"}-opt-${i}`.replace(/\s+/g, "-");

  const openAt = () => {
    setActive(selectedIndex < 0 ? 0 : selectedIndex);
    setOpen(true);
  };
  const pick = (i: number) => {
    const e = entries[i];
    if (!e || e.disabled) return;
    onChange({ target: { value: e.value } });
    setOpen(false);
    anchor?.focus();
  };
  // oxlint-disable-next-line complexity -- a listbox's keyboard dispatch: one key per branch, and their ORDER is the contract (closed first, navigation next, Tab last)
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    if (!open && (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ")) {
      e.preventDefault();
      openAt();
      return;
    }
    if (!open) return;
    if (list.navigate(e)) return; // ↑ ↓ Home End
    // An open list owns the keyboard. Left/right and PageUp/Down were not swallowed, so the browser
    // scrolled the page behind the list (the kanban moved under an open select, operator feedback).
    // Left/right move up/down like a native Windows select; PageUp/Down jump by 10 (WAI-ARIA
    // listbox). `Combobox` does not take them: its text field needs them.
    if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      list.move(k === "ArrowRight" ? 1 : -1);
    } else if (k === "PageDown" || k === "PageUp") {
      e.preventDefault();
      list.move(k === "PageDown" ? 1 : -1, 10);
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      pick(active);
    }
    // Tab proceeds (no preventDefault): it closes the list and moves on. The list used to stay open,
    // orphaned, while focus left.
    else if (k === "Tab") {
      setOpen(false);
    } else if (k.length === 1) list.typeahead(k);
  };

  return (
    <>
      <button
        type="button"
        ref={setAnchor}
        disabled={disabled}
        title={title}
        onKeyDown={onKey}
        onClick={() => (open ? setOpen(false) : openAt())}
        className={["ui-select", className].filter(Boolean).join(" ")}
        data-size={size}
        data-open={open ? "true" : undefined}
        data-placeholder={selected ? undefined : "true"}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-activedescendant={open ? id(active) : undefined}
        {...field}
        {...aria}
      >
        <span className="ui-select-value">{selected?.label ?? placeholder}</span>
        <span className="ui-select-chevron" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={setSurface}
            className="ui-select-list"
            role="listbox"
            tabIndex={-1}
            onKeyDown={onKey}
            aria-label={aria["aria-label"]}
            data-placed={point ? "true" : undefined}
            /* `minWidth` is capped by the same bound as `--surface-max-w`: in CSS `min-width` beats
               `max-width`, so the bound in select.css would stay silent. */
            // oxlint-disable-next-line react/forbid-dom-props -- measured position and width
            style={
              {
                ...(point ? { top: point.top, left: point.left } : null),
                minWidth: Math.min(anchor?.offsetWidth ?? 0, point?.maxWidth ?? maxSurfaceWidth()),
                "--surface-max-w": `${point?.maxWidth ?? maxSurfaceWidth()}px`,
              } as React.CSSProperties
            }
          >
            {/* The scrolling viewport is a child: the surface carries the edge shadows
              (::before/::after), which would scroll away if it scrolled itself. */}
            <div ref={setView} className="ui-select-scroll">
              {entries.map((e, i) => (
                <div key={`${e.value}-${i}`}>
                  {e.head && <div className="ui-select-group">{e.head}</div>}
                  <div
                    id={id(i)}
                    role="option"
                    aria-selected={e.value === current}
                    aria-disabled={e.disabled}
                    className="ui-select-option"
                    data-active={i === active ? "true" : undefined}
                    onMouseMove={() => !e.disabled && setActive(i)}
                    onClick={() => pick(i)}
                  >
                    <span className="ui-select-mark">
                      {e.value === current && <Check size={13} />}
                    </span>
                    <Ellipsis as="span" lines={2} className="ui-select-label">
                      {e.label}
                    </Ellipsis>
                  </div>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
