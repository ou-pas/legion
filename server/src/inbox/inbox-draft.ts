// A round's draft (07/09): already decided, not yet sent.
//
// A six-question round is answered from a dedicated page one leaves and comes back to; without a
// draft, leaving erased the work and pushed towards answering fast rather than right.
//
// Not a partial answer server-side: `status` stays `open`, the session sleeps the same, the badge
// counts the same, and the runner never reads this column. "Partially answered" is derived for
// the screen (see v62 in `shared/migrations/v61-v65.ts`).
//
// `validateFormAnswer` (inbox-form.ts) judges a finished answer. A draft is work in progress:
// nothing is required, a value may be half typed. Only declared keys and bounded values are
// checked.
import { broadcast } from "../shared/events.js";
import { FORM_COMMENT_KEY, acceptsNote, formFields, noteKey, type FormSpec } from "./inbox-form.js";
import { INBOX_STATUS } from "./inbox-enums.js";
import { inboxDraftRowById, writeDraft } from "./inbox-draft-store.js";

/** Cap on a draft value, the same as an answer comment (`MAX_NOTE`, inbox-form.ts): a draft must
 *  not refuse what the final answer accepts. */
const MAX_DRAFT_VALUE = 10_000;
/** Caps a forged body's key count; unknown keys are refused below anyway. */
const MAX_DRAFT_KEYS = 32;

export type DraftValues = Record<string, unknown>;

/** A named refusal, sent as 400. */
function fail(message: string): never {
  throw new Error(`invalid draft: ${message}`);
}

/** Keys a draft may carry: declared fields, a choice field's note, and the round comment. The same
 *  family as `validateFormAnswer`, or the draft would accept what sending refuses. */
function draftKeys(spec: FormSpec): Set<string> {
  const known = new Set<string>([FORM_COMMENT_KEY]);
  for (const f of formFields(spec)) {
    known.add(f.id);
    if (acceptsNote(f)) known.add(noteKey(f.id));
  }
  return known;
}

/** Validates a draft against the agent's spec and returns it unchanged. Unlike
 *  `validateFormAnswer`, no normalisation: the screen must get back exactly what it stored,
 *  including an empty string ("I erased my answer"). */
export function validateFormDraft(spec: FormSpec, data: unknown): DraftValues {
  if (typeof data !== "object" || data === null || Array.isArray(data))
    fail("expected an object { fieldId: value }");
  const input = data as DraftValues;
  const keys = Object.keys(input);
  if (keys.length > MAX_DRAFT_KEYS) fail(`at most ${MAX_DRAFT_KEYS} keys`);
  const known = draftKeys(spec);
  const unknown = keys.filter((k) => !known.has(k));
  if (unknown.length) fail(`unknown key(s): ${unknown.join(", ")}`);

  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "boolean") continue;
    if (typeof value === "number") {
      // `NaN` and `Infinity` become `null` in `JSON.stringify`, so the draft would read back
      // differently.
      if (!Number.isFinite(value)) fail(`“${key}”: number expected`);
      continue;
    }
    if (typeof value !== "string") fail(`“${key}”: text, number or boolean expected`);
    if (value.length > MAX_DRAFT_VALUE) fail(`“${key}”: ${MAX_DRAFT_VALUE} characters max`);
  }
  return input;
}

/** Blank: absent, null or whitespace. `false` and `0` are real answers, as in
 *  `validateFormAnswer`. */
const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** How many questions are decided, out of how many: the "2 / 6" the card, the inbox row and the
 *  waiting panel all show, from one function.
 *
 *  A checkbox at `false` counts as answered: the screen sets `false` up front on a checkbox without
 *  default (`initialValues`, web/src/inbox/inbox-round-answers.ts), so treating it as absent would
 *  show "0 / 6" on a fully decided round. */
export function answeredCount(
  spec: FormSpec | null,
  draft: DraftValues | null,
): {
  answered: number;
  total: number;
} {
  if (!spec) return { answered: 0, total: 0 };
  const fields = formFields(spec);
  if (!draft) return { answered: 0, total: fields.length };
  return {
    answered: fields.filter((f) => !isBlank(draft[f.id])).length,
    total: fields.length,
  };
}

/** A row's draft, or `null`. A hand-repaired database must not break the whole queue; the entry
 *  then reads as not started. */
export function parseDraft(raw: string | null): DraftValues | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as DraftValues)
      : null;
  } catch {
    return null;
  }
}

/** Writes an open entry's draft and announces it on the bus.
 *
 *  Refused (409) once the entry is no longer open, never silently overwritten: it may have been
 *  answered from Discord or another tab meanwhile.
 *
 *  The event carries the count, not the values: that is all other surfaces need ("2 / 6 ·
 *  Resume"). */
export function saveInboxDraft(
  inboxId: string,
  formData: unknown,
): { answered: number; total: number } {
  const msg = inboxDraftRowById(inboxId);
  if (!msg) throw new Error("inbox message not found");
  if (msg.status !== INBOX_STATUS.open) throw new Error("the question is no longer open");
  if (!msg.form) throw new Error("this question has no form");

  const spec = JSON.parse(msg.form) as FormSpec;
  const draft = validateFormDraft(spec, formData);
  const counts = answeredCount(spec, draft);

  writeDraft(inboxId, JSON.stringify(draft));
  // Broadcast, not stored (16/09): the screen saves half a second after each keystroke, which put
  // ten identical lines in fifty seconds on the session trace. Typing is a signal for screens,
  // not a session fact.
  broadcast(msg.sessionId, "inbox_draft", {
    inboxId,
    answered: counts.answered,
    total: counts.total,
  });
  return counts;
}
