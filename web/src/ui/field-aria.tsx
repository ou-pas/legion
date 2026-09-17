// Links a <Field> to its control through context, not cloneElement.
//
// `Field` used to inject `aria-invalid` / `aria-describedby` / `aria-required` on its direct
// child. As soon as a domain component sat in between (`<Field><TaskComposer.Name/></Field>`),
// those props were ignored: the field looked required and did not announce it (2 of 4 task
// composer fields, measured). With context, depth no longer matters. A native `<input>` placed
// directly in a `<Field>` reads nothing: use the library's controls.
import { createContext, useContext } from "react";

export interface FieldAria {
  /** Ids of the error message then the hint, in reading order. */
  describedBy?: string;
  invalid?: boolean;
  required?: boolean;
}

const FieldAriaContext = createContext<FieldAria | null>(null);
export const FieldAriaProvider = FieldAriaContext.Provider;

/** The caller's explicit props still win: these are defaults, not a takeover. */
export function useFieldAria(): {
  "aria-invalid"?: true;
  "aria-describedby"?: string;
  "aria-required"?: true;
} {
  const f = useContext(FieldAriaContext);
  if (!f) return {};
  return {
    ...(f.invalid ? { "aria-invalid": true as const } : {}),
    ...(f.describedBy ? { "aria-describedby": f.describedBy } : {}),
    ...(f.required ? { "aria-required": true as const } : {}),
  };
}
