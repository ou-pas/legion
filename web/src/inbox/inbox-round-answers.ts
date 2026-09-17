// A round's answers as the screen reads them (07/09). The questionnaire keeps RAW values (those the
// server validates, `inbox-form.ts`), but rail and recap show what the human saw: an option's label, a
// word for a checkbox. This is the only place that reading happens, so rail and recap never diverge.
import type { FormField } from "../api/inbox.js";

export type RoundValues = Record<string, unknown>;

/** A question's NOTE (08/09) travels in the SAME values under the sibling key `<id>__note` the server
 *  expects (`noteKey`, inbox-form.ts): draft and send carry it as is, and a note resumed from a draft
 *  finds its question by itself. */
const NOTE_SUFFIX = "__note";
export const noteKey = (fieldId: string): string => `${fieldId}${NOTE_SUFFIX}`;
export const isNoteKey = (key: string): boolean => key.endsWith(NOTE_SUFFIX);
export const noteOf = (values: RoundValues, fieldId: string): string => {
  const v = values[noteKey(fieldId)];
  return typeof v === "string" ? v : "";
};

/** Absent, null, or a whitespace string. `false` and `0` are answers. */
export const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && !v.trim());

/** The agent's recommendation preset on each control; a checkbox without default starts at `false`,
 *  since an unticked box is a REAL answer (the server only refuses absence). Otherwise an untouched
 *  required checkbox would block sending when "no" is exactly what the human means. */
export function initialValues(fields: readonly FormField[]): RoundValues {
  return Object.fromEntries(
    fields.flatMap((f) => {
      if (f.default !== undefined) return [[f.id, f.default]];
      return f.type === "checkbox" ? [[f.id, false]] : [];
    }),
  );
}

/** An answer's label, or `null` when blank. */
export function answerLabel(field: FormField, value: unknown): string | null {
  if (isBlank(value)) return null;
  if (field.type === "checkbox") return value === true ? "yes" : "no";
  if (field.type === "radio" || field.type === "select")
    return field.options?.find((o) => o.id === value)?.label ?? String(value);
  return String(value);
}

export const isDefaultAnswer = (field: FormField, value: unknown): boolean =>
  field.default !== undefined && value === field.default;

/** One "question → answer" row (07/09). The card shows three and counts the rest, the read page shows
 *  all: two surfaces, one computation, or they would end up naming an option differently. */
export type AnswerRow = {
  /** 1-based: card and recap both number. */
  index: number;
  label: string;
  /** The answer label, or `null` while still blank (to decide). */
  value: string | null;
  /** The agent's recommendation was followed. */
  recommended: boolean;
  /** What the agent recommended when NOT followed: the read page says it plainly, since a decision
   *  rereads by what it refused. `null` when the agent recommended nothing. */
  discarded: string | null;
  /** What was said ABOUT this question, next to the answer. `null` when nothing. */
  note: string | null;
};

export function answerRows(fields: readonly FormField[], values: RoundValues): AnswerRow[] {
  return fields.map((field, i) => {
    const value = answerLabel(field, values[field.id]);
    const recommended = value !== null && isDefaultAnswer(field, values[field.id]);
    const suggestion = field.default === undefined ? null : answerLabel(field, field.default);
    const note = noteOf(values, field.id).trim();
    return {
      index: i + 1,
      label: field.label,
      value,
      recommended,
      discarded: !recommended && value !== null ? suggestion : null,
      note: note || null,
    };
  });
}

export const missingRequired = (fields: readonly FormField[], values: RoundValues): FormField[] =>
  fields.filter((f) => f.required && isBlank(values[f.id]));
