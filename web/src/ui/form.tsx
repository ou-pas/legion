// The <label> wraps the control (one target) and the error is really announced: aria-invalid /
// aria-describedby / aria-required go through context (ui/field-aria), not cloneElement, to
// cross intermediate components.
import { useId, useMemo, type ReactNode } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { FieldAriaProvider } from "./field-aria.js";
import { UI_TEXT } from "./vocabulary.js";
import "./form.css";

export function Field({
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const uid = useId();
  const hintId = hint ? `${uid}-hint` : undefined;
  const errorId = error ? `${uid}-error` : undefined;
  // Error before hint: it is what should be heard first.
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const aria = useMemo(
    () => ({ describedBy, invalid: Boolean(error), required }),
    [describedBy, error, required],
  );
  return (
    <label
      className={["ui-field", className].filter(Boolean).join(" ")}
      data-invalid={error ? "true" : undefined}
    >
      <span className="ui-field-label">
        {label}
        {required && <span className="ui-field-req">{UI_TEXT.required}</span>}
      </span>
      <FieldAriaProvider value={aria}>{children}</FieldAriaProvider>
      {hint && (
        <span className="ui-field-hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="ui-field-error" id={errorId}>
          <TriangleAlert size={13} aria-hidden="true" />
          {error}
        </span>
      )}
    </label>
  );
}

/** Fields forming one decision (a rule's scope, a goal's budget). */
export function Fieldset({
  legend,
  hint,
  className,
  children,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={["ui-fieldset", className].filter(Boolean).join(" ")}>
      <legend className="ui-fieldset-legend">{legend}</legend>
      {hint && <p className="ui-fieldset-hint">{hint}</p>}
      {children}
    </fieldset>
  );
}

/** Stacked below 700px, where three columns no longer fit. */
export function FormRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={["ui-form-row", className].filter(Boolean).join(" ")}>{children}</div>;
}

/** Server refusal, form-level validation. */
export function FormError({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p
      role="alert"
      className={["ui-form-msg", className].filter(Boolean).join(" ")}
      data-tone="bad"
    >
      <TriangleAlert size={13} aria-hidden="true" />
      {children}
    </p>
  );
}

/** Rule added, webhook saved. */
export function FormOk({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p
      aria-live="polite"
      className={["ui-form-msg", className].filter(Boolean).join(" ")}
      data-tone="ok"
    >
      <Check size={13} aria-hidden="true" />
      {children}
    </p>
  );
}
