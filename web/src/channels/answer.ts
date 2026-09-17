// A round's answer, reread. The control plane stores a FORM answer as JSON (`serializeFormAnswer`,
// { fieldId: value }) and a free answer as text, both in the `answer` field of `inbox_answer`: they
// are told apart here, once, not in every component showing them.
//
// Field comments carry the `__note` suffix (mirror of `noteKey`, server and form side): justifications,
// not answers, read separately.

const NOTE_SUFFIX = "__note";

export interface ReadAnswer {
  /** Chosen values in field order: what one rereads of a collapsed round. */
  fields: unknown[];
  /** Comments left next to the choices. */
  notes: string[];
  /** A free-text answer, when it was not a form. */
  free: string | null;
}

export function readAnswer(answer: string): ReadAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer) as unknown;
  } catch {
    parsed = undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { fields: [], notes: [], free: answer.trim() || null };
  }
  const fields: unknown[] = [];
  const notes: string[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (key.endsWith(NOTE_SUFFIX)) {
      if (typeof value === "string" && value.trim()) notes.push(value.trim());
    } else if (value !== undefined && value !== null && value !== "") {
      fields.push(value);
    }
  }
  return { fields, notes, free: null };
}
