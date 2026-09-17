// Thin wrappers over native fields already styled by base.css, adding only what native cannot do
// (size, invalid state, clearing).
import { useRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import { useFieldAria } from "./field-aria.js";
import { UI_TEXT } from "./vocabulary.js";
import "./input.css";

type Size = "sm" | "md";
type Own = { size?: Size; invalid?: boolean };
type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

/** Legion is a single-operator control plane: no field here has a use for the browser's saved
 *  cards. A contact card ("Nancy – work", macOS Contacts label format) showed above the ⌘K
 *  palette.
 *
 *  `autocomplete="off"` is the right value per spec, but browsers treat it as advice, so it is
 *  not always enough. The `data-*` below are the documented opt-outs of password manager
 *  extensions, which do not read `autocomplete` at all.
 *
 *  Tried and abandoned: `autocomplete="one-time-code"`. Fine in Chrome, but Safari really supports
 *  it (SMS codes) and was then asked to offer a code. Do not go back. Contact autofill in Safari is
 *  a browser setting, not something the page controls.
 *
 *  Placed before the spread: a caller that needs autocomplete asks for it again. */
const NO_AUTOFILL = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  "data-1p-ignore": "", // 1Password
  "data-bwignore": "", // Bitwarden
  "data-lpignore": "true", // LastPass
  "data-form-type": "other", // Dashlane
} as const;

// `aria-invalid` goes before the spread: an invalid <Field> wrapping the input has the last word
// without repeating `invalid` on both sides.
export function Input({ size = "md", invalid = false, className, ...rest }: Own & NativeInput) {
  // What the parent <Field> declared (required, error, hint). `...rest` comes after: the caller's
  // explicit props always win.
  const field = useFieldAria();
  return (
    <input
      aria-invalid={invalid || undefined}
      {...field}
      {...NO_AUTOFILL}
      {...rest}
      className={["ui-input", className].filter(Boolean).join(" ")}
      data-size={size}
    />
  );
}

/** Magnifier icon; clearing exists only when there is text. */
export function SearchInput({
  value,
  onValueChange,
  size = "md",
  placeholder = UI_TEXT.search,
  className,
  ...rest
}: {
  value: string;
  onValueChange: (next: string) => void;
} & Own &
  Omit<NativeInput, "value" | "onChange" | "type">) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={["ui-search", className].filter(Boolean).join(" ")} data-size={size}>
      <Search size={14} className="ui-search-icon" aria-hidden="true" />
      {/* spellCheck off: branch names and ids, not prose. */}
      <input
        {...NO_AUTOFILL}
        spellCheck={false}
        {...rest}
        ref={ref}
        type="search"
        className="ui-input ui-search-input"
        data-size={size}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)}
      />
      {value !== "" && (
        <button
          type="button"
          className="ui-search-clear"
          aria-label={UI_TEXT.clearSearch}
          onClick={() => {
            onValueChange("");
            ref.current?.focus();
          }}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** Resizable in height only (never width: it breaks the column). */
export function Textarea({
  rows = 4,
  size = "md",
  invalid = false,
  className,
  ...rest
}: Own & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const field = useFieldAria();
  return (
    <textarea
      aria-invalid={invalid || undefined}
      {...field}
      {...NO_AUTOFILL}
      {...rest}
      rows={rows}
      className={["ui-textarea", className].filter(Boolean).join(" ")}
      data-size={size}
    />
  );
}
