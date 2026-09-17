// What makes a form a ROUND (07/09), the rule in one place. Operator decision of 07/09: a `form` of at
// least TWO fields goes to the dedicated page; a `text`, a `choice` and a one-field `form` are answered
// in place on their card. This boundary decides three things: collapsing the action receipt, a rail in
// the questionnaire, and an answer link rather than a form. Two copies of a THRESHOLD drift the day one
// changes.
import type { FormField, FormSpec } from "../api/inbox.js";

/** Two, because one question has neither rail nor recap: a full page would only add a navigation for
 *  one click. */
const ROUND_MIN_FIELDS = 2;

/** The agent's declared fields, in order. Empty for a question without form: the caller need not tell
 *  "no spec" from "spec without field". */
export const formFieldsOf = (spec: FormSpec | null | undefined): FormField[] =>
  (spec?.blocks ?? []).flatMap((b) => (b.kind === "field" ? [b.field] : []));

/** Is this form a ROUND, something with its own page? */
export const isRoundForm = (spec: FormSpec | null | undefined): boolean =>
  formFieldsOf(spec).length >= ROUND_MIN_FIELDS;
