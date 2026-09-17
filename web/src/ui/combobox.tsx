// Pick from a long list: type three letters, choose (WAI-ARIA combobox pattern).
//
// Lives next to `Select` rather than replacing it: a three-option menu does not need a search,
// and adding one costs a keystroke. This starts paying off where `Select` runs out, around twenty
// entries (a Linear workspace's twenty-six members, measured 01/09).
//
// Knows no domain: a list of `{ id, label }`, a value, a change callback (CLAUDE.md's rule; on
// 30/08 a dot placed here knowing what a task was had to be moved out).
//
// The keyboard is not optional. It replaces a native `<select>`: arrows, Enter, Escape, Home/End,
// and an accessible name.
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { Ellipsis } from "./ellipsis.js";
import { useFieldAria } from "./field-aria.js";
import { maxSurfaceWidth, useAnchoredPoint, useDismiss } from "./floating.js";
import { Spinner } from "./spinner.js";
import { useListbox } from "./use-listbox.js";
import { UI_TEXT } from "./vocabulary.js";
import "./combobox.css";

export interface ComboboxOption {
  id: string;
  label: string;
}

/** Accent folding: "chloe" must find "Chloé". Without it search punishes fast typists, the very
 *  people it exists for. */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

// oxlint-disable-next-line complexity -- four default props, then a single tree where each attribute carries its case: open/closed on `value` and `placeholder`, loading/empty/results on the list
export function Combobox({
  value,
  onChange,
  options,
  label,
  placeholder = UI_TEXT.selectPlaceholder,
  loading = false,
  disabled = false,
  size = "md",
  className,
}: {
  /** The chosen `id`. A value missing from the options leaves the placeholder visible. */
  value: string;
  onChange: (id: string) => void;
  options: readonly ComboboxOption[];
  /** Required: a text field without a name is not announced. */
  label: string;
  placeholder?: string;
  /** Options are still arriving: the list says it is waiting instead of saying it is empty. */
  loading?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const field = useFieldAria();
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = fold(query.trim());
    return needle === "" ? [...options] : options.filter((o) => fold(o.label).includes(needle));
  }, [options, query]);

  const selected = options.find((o) => o.id === value);
  const point = useAnchoredPoint({ anchor, surface, open });
  useDismiss(
    open,
    (viaKeyboard) => {
      setOpen(false);
      setQuery("");
      if (viaKeyboard) input.current?.focus();
    },
    anchor,
    surface,
  );
  // Active index, ↑ ↓ Home End, and keeping the active option in view: the same hook as `Select`
  // (06/09). No option is disabled here, hence the default `disabledOf`.
  const list = useListbox({ items: matches, view, labelOf: (o) => o.label });
  const { active, setActive } = list;

  const openAt = () => {
    const at = matches.findIndex((o) => o.id === value);
    setActive(at < 0 ? 0 : at);
    setOpen(true);
  };
  const pick = (i: number) => {
    const o = matches[i];
    if (!o) return;
    onChange(o.id);
    setOpen(false);
    setQuery("");
    input.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter") {
        e.preventDefault();
        openAt();
      }
      return;
    }
    if (list.navigate(e)) return; // ↑ ↓ Home End
    if (k === "Enter") {
      e.preventDefault();
      pick(active);
    }
    // Tab proceeds (no preventDefault): it closes the list and moves on. Otherwise the surface
    // stays open, orphaned, while focus has gone elsewhere.
    else if (k === "Tab") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <>
      <div
        ref={setAnchor}
        data-size={size}
        data-open={open ? "true" : undefined}
        className={["ui-combobox", className].filter(Boolean).join(" ")}
      >
        <input
          ref={input}
          type="text"
          role="combobox"
          className="ui-combobox-input"
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches.length > 0 ? optionId(active) : undefined}
          {...field}
          // Open, the field holds the search with the chosen value as placeholder; closed, it
          // holds the value. Otherwise typing would erase on screen the choice being reconsidered.
          value={open ? query : (selected?.label ?? "")}
          placeholder={open ? (selected?.label ?? placeholder) : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            if (!open) setOpen(true);
          }}
          onMouseDown={() => {
            if (!open) openAt();
          }}
          onKeyDown={onKey}
        />
        <span className="ui-combobox-chevron" aria-hidden="true" />
      </div>
      {open &&
        createPortal(
          <div
            ref={setSurface}
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            className="ui-combobox-list"
            data-placed={point ? "true" : undefined}
            /* `minWidth` is capped by the same bound as `--surface-max-w`: in CSS `min-width` beats
               `max-width`, so the bound in combobox.css would stay silent. */
            // oxlint-disable-next-line react/forbid-dom-props -- measured position and width
            style={
              {
                ...(point ? { top: point.top, left: point.left } : null),
                minWidth: Math.min(anchor?.offsetWidth ?? 0, point?.maxWidth ?? maxSurfaceWidth()),
                "--surface-max-w": `${point?.maxWidth ?? maxSurfaceWidth()}px`,
              } as React.CSSProperties
            }
          >
            {/* The Spinner's label is already read by screen readers, so the visible text is
              hidden from them, otherwise "Loading…" is announced twice. */}
            {loading && (
              <div className="ui-combobox-note">
                <Spinner size="sm" label={UI_TEXT.loading} />
                <span aria-hidden="true">{UI_TEXT.loading}</span>
              </div>
            )}
            {!loading && matches.length === 0 && (
              <div className="ui-combobox-note">
                {options.length === 0 ? UI_TEXT.combobox.empty : UI_TEXT.combobox.noMatch}
              </div>
            )}
            {!loading && matches.length > 0 && (
              <div ref={setView} className="ui-combobox-scroll">
                {matches.map((o, i) => (
                  <div
                    key={o.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={o.id === value}
                    className="ui-combobox-option"
                    data-active={i === active ? "true" : undefined}
                    onMouseMove={() => setActive(i)}
                    onClick={() => pick(i)}
                  >
                    <span className="ui-combobox-mark">
                      {o.id === value && <Check size={13} />}
                    </span>
                    <Ellipsis as="span" lines={2} className="ui-combobox-label">
                      {o.label}
                    </Ellipsis>
                  </div>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
