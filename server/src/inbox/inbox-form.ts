import { INBOX_KIND } from "./inbox-enums.js";
// Inbox forms (v31, operator decision 24/08). A blocking question costs a full
// pause → destroy → resume cycle; a form lets the agent ask N questions in one pause, with rich
// context (markdown, SVG) and typed fields. Two boundaries, both here and tested:
//
//  1. On creation (`validateFormSpec`): structure, caps, unique ids. A refusal is named and sent
//     back to the agent as 400.
//  2. On answer (`validateFormAnswer`): each value is checked against the schema the agent
//     declared (required, bounds, options, no unknown keys), so the agent resumes with known keys.
//
// SVG safety: the boundary is DOMPurify at render time (web/src/inbox/svg-sanitize.ts). The
// `<script`/`javascript:` check below is a cheap early belt so the agent sees the refusal; it
// never replaces render-side sanitisation.

/** Form field types. `"text"` here is a field type, not an inbox entry `kind` (`INBOX_KIND.text`):
 *  spelt the same, meaning different things, and an automated replacement once confused them.
 *
 *  No column behind them: they live in the `form` JSON, validated by `validateFormSpec`, so this
 *  list is the source. */
export const FORM_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "select",
  "radio",
  "checkbox",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export type FormField = {
  id: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: { id: string; label: string }[]; // select | radio
  min?: number; // number
  max?: number; // number
  placeholder?: string;
  hint?: string;
  /** The pre-filled answer: the agent's recommendation, already set on the control (25/08).
   *  Without it a seven-question round asks for seven cold decisions. It decides nothing; the
   *  human changes what they want. */
  default?: string | number | boolean;
};

export type FormBlock =
  | { kind: "markdown"; text: string }
  | { kind: "svg"; svg: string; caption?: string }
  | { kind: "field"; field: FormField };

export type FormSpec = { blocks: FormBlock[] };

const FIELD_TYPES = [INBOX_KIND.text, "textarea", "number", "select", "radio", "checkbox"] as const;
const MAX_BLOCKS = 24;
const MAX_FIELDS = 12;
const MAX_MARKDOWN = 4_000;
const MAX_SVG = 32_000;
const MAX_LABEL = 160;
/** Wider than a label: a recommendation carries its why, and a reason cut in half is worse than
 *  none. */
const MAX_HINT = 400;
const MAX_OPTIONS = 12;
const MAX_TEXT_ANSWER = 2_000;
/** A comment has its own cap, ten times a text field's: a comment is where one argues. Its first
 *  serious use, correcting a seventeen-decision summary, needed 2 600 characters and was refused. */
const MAX_NOTE = 10_000;
const MAX_TEXTAREA_ANSWER = 8_000;

// Same sanitising as choice ids (inbox.ts): these ids travel through JSON, DOM attributes and the
// resume prompt, so no interpretable character.
const cleanId = (raw: unknown, fallback: string): string =>
  String(raw ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 32) || fallback;

function fail(message: string): never {
  throw new Error(`invalid form: ${message}`);
}

function validateMarkdownBlock(b: Record<string, unknown>, i: number): FormBlock {
  const text = String(b.text ?? "").trim();
  if (!text) fail(`block ${i}: empty markdown`);
  if (text.length > MAX_MARKDOWN) fail(`block ${i}: markdown > ${MAX_MARKDOWN} characters`);
  return { kind: "markdown", text };
}

function validateSvgBlock(b: Record<string, unknown>, i: number): FormBlock {
  const svg = String(b.svg ?? "").trim();
  if (!svg) fail(`block ${i}: empty svg`);
  if (svg.length > MAX_SVG) fail(`block ${i}: svg > ${MAX_SVG} characters`);
  if (!/^<svg[\s>]/i.test(svg)) fail(`block ${i}: the svg must start with <svg`);
  // Cheap belt; the boundary stays DOMPurify at render time (see header).
  if (/<script|javascript:|<foreignobject/i.test(svg))
    fail(`block ${i}: svg refused (script, javascript: or foreignObject)`);
  const caption = b.caption ? String(b.caption).slice(0, MAX_LABEL) : undefined;
  return { kind: "svg", svg, ...(caption ? { caption } : {}) };
}

function validateFieldOptions(
  f: Record<string, unknown>,
  id: string,
  type: FormField["type"],
): FormField["options"] {
  if (type !== "select" && type !== "radio") return undefined;
  const raw = Array.isArray(f.options) ? f.options : [];
  if (raw.length < 2) fail(`field “${id}”: ${type} requires at least 2 options`);
  if (raw.length > MAX_OPTIONS) fail(`field “${id}”: at most ${MAX_OPTIONS} options`);
  const options = raw.map((o, j) => {
    const opt = o as Record<string, unknown>;
    const label = String(opt.label ?? "")
      .trim()
      .slice(0, MAX_LABEL);
    if (!label) fail(`field “${id}”: option ${j} without a label`);
    return { id: cleanId(opt.id, `o${j}`), label };
  });
  if (new Set(options.map((o) => o.id)).size !== options.length)
    fail(`field “${id}”: duplicate option ids`);
  return options;
}

function validateFieldNumberBounds(
  f: Record<string, unknown>,
  id: string,
): { min?: number; max?: number } {
  const min = f.min !== undefined ? Number(f.min) : undefined;
  const max = f.max !== undefined ? Number(f.max) : undefined;
  if ([min, max].some((v) => v !== undefined && !Number.isFinite(v)))
    fail(`field “${id}”: min/max must be numbers`);
  if (min !== undefined && max !== undefined && min > max) fail(`field “${id}”: min > max`);
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

/** The default is validated after the options: a default naming no option would silently select
 *  nothing, and the agent would believe it had recommended. */
function validateFieldDefault(
  f: Record<string, unknown>,
  id: string,
  type: FormField["type"],
  options: FormField["options"],
): FormField["default"] {
  if (f.default === undefined || f.default === null) return undefined;
  if (type === "checkbox") {
    if (typeof f.default !== "boolean") fail(`field “${id}”: default must be a boolean`);
    return f.default;
  }
  if (type === "number") {
    const n = Number(f.default);
    if (!Number.isFinite(n)) fail(`field “${id}”: default must be a number`);
    return n;
  }
  if (type === "select" || type === "radio") {
    const d = String(f.default);
    if (!options?.some((o) => o.id === d))
      fail(
        `field “${id}”: default “${d}” is not an option id (${options?.map((o) => o.id).join(", ")})`,
      );
    return d;
  }
  return String(f.default).slice(0, MAX_TEXT_ANSWER);
}

function validateFieldBlock(
  b: Record<string, unknown>,
  i: number,
  seenIds: Set<string>,
): FormBlock {
  const f = (b.field ?? {}) as Record<string, unknown>;
  const id = cleanId(f.id, `f${i}`);
  // Sibling answer keys (`__comment`, `<id>__note`) are read next to the fields: a field named
  // like one would be read twice (a `__comment` checkbox made every valid answer fail).
  if (id === FORM_COMMENT_KEY || id.endsWith(NOTE_SUFFIX)) fail(`field “${id}”: reserved id`);
  if (seenIds.has(id)) fail(`field “${id}”: duplicate id`);
  seenIds.add(id);
  const label = String(f.label ?? "")
    .trim()
    .slice(0, MAX_LABEL);
  if (!label) fail(`field “${id}”: label required`);
  const type = f.type as FormField["type"];
  if (!FIELD_TYPES.includes(type)) fail(`field “${id}”: unknown type “${String(f.type) || "?"}”`);
  const field: FormField = { id, label, type };
  if (f.required === true) field.required = true;
  if (f.placeholder) field.placeholder = String(f.placeholder).slice(0, MAX_LABEL);
  if (f.hint) field.hint = String(f.hint).slice(0, MAX_HINT);
  const options = validateFieldOptions(f, id, type);
  if (options) field.options = options;
  if (type === "number") Object.assign(field, validateFieldNumberBounds(f, id));
  const def = validateFieldDefault(f, id, type, field.options);
  if (def !== undefined) field.default = def;
  return { kind: "field", field };
}

function validatedRawBlocks(input: unknown): unknown[] {
  if (
    typeof input !== "object" ||
    input === null ||
    !Array.isArray((input as { blocks?: unknown }).blocks)
  )
    fail("`blocks` (an array) is required");
  const rawBlocks = (input as { blocks: unknown[] }).blocks;
  if (rawBlocks.length === 0) fail("at least one block");
  if (rawBlocks.length > MAX_BLOCKS) fail(`at most ${MAX_BLOCKS} blocks`);
  return rawBlocks;
}

/** One block by `kind`; the caller keeps the field count across the whole spec. */
function validateBlock(
  b: Record<string, unknown>,
  i: number,
  seenIds: Set<string>,
  fieldCount: number,
): FormBlock {
  if (b?.kind === "markdown") return validateMarkdownBlock(b, i);
  if (b?.kind === "svg") return validateSvgBlock(b, i);
  if (b?.kind === "field") {
    if (fieldCount > MAX_FIELDS) fail(`at most ${MAX_FIELDS} fields`);
    return validateFieldBlock(b, i, seenIds);
  }
  fail(`block ${i}: unknown kind “${String(b?.kind ?? "?")}” (markdown | svg | field)`);
}

/** Validates and normalises the agent's spec, or throws a named error (sent back as 400). */
export function validateFormSpec(input: unknown): FormSpec {
  const rawBlocks = validatedRawBlocks(input);
  const blocks: FormBlock[] = [];
  const seenIds = new Set<string>();
  let fieldCount = 0;

  for (const [i, raw] of rawBlocks.entries()) {
    const b = raw as Record<string, unknown>;
    if (b?.kind === "field") fieldCount += 1;
    blocks.push(validateBlock(b, i, seenIds, fieldCount));
  }
  if (fieldCount === 0) fail("at least one field — with no field, use a text question or choices");
  return { blocks };
}

export const formFields = (spec: FormSpec): FormField[] =>
  spec.blocks.flatMap((b) => (b.kind === "field" ? [b.field] : []));

/** A comment attached to an answer (25/08, operator's request), returned to the agent under a
 *  sibling key `<id>__note`.
 *
 *  A sibling key rather than `{ value, note }`: `q3` must stay the chosen option the agent
 *  declared, and a composite would break every existing spec.
 *
 *  On every field type since 08/09: a text field's value is the answer (a branch name), not what
 *  one has to say about the question. */
const NOTE_SUFFIX = "__note";
export const noteKey = (fieldId: string): string => `${fieldId}${NOTE_SUFFIX}`;
export const acceptsNote = (_f: FormField): boolean => true;

/** The round comment (07/09): one, entered at the summary, covering all answers; what one tells
 *  the agent rarely fits a single question. It travels in the same JSON under a double-underscore
 *  key outside the declared schema. `<id>__note` keys are still accepted, so an answer from
 *  Discord or an older screen is not refused. */
export const FORM_COMMENT_KEY = "__comment";

function knownAnswerKeys(fields: FormField[]): Set<string> {
  const known = new Set(fields.map((f) => f.id));
  // Comment keys are accepted for each declared field; `<id>__note` on an unknown id stays
  // unknown.
  for (const f of fields) if (acceptsNote(f)) known.add(noteKey(f.id));
  known.add(FORM_COMMENT_KEY);
  return known;
}

function normalizeTextValue(f: FormField, v: unknown): string {
  if (typeof v !== "string") fail(`field “${f.label}”: text expected`);
  const cap = f.type === INBOX_KIND.text ? MAX_TEXT_ANSWER : MAX_TEXTAREA_ANSWER;
  if (v.length > cap) fail(`field “${f.label}”: ${cap} characters max`);
  return v.trim();
}

function normalizeNumberValue(f: FormField, v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) fail(`field “${f.label}”: number expected`);
  if (f.min !== undefined && n < f.min) fail(`field “${f.label}”: minimum ${f.min}`);
  if (f.max !== undefined && n > f.max) fail(`field “${f.label}”: maximum ${f.max}`);
  return n;
}

function normalizeChoiceValue(f: FormField, v: unknown): unknown {
  if (!f.options?.some((o) => o.id === v))
    fail(`field “${f.label}”: “${String(v)}” is not an option`);
  return v;
}

function normalizeCheckboxValue(f: FormField, v: unknown): boolean {
  if (typeof v !== "boolean") fail(`field “${f.label}”: boolean expected`);
  return v;
}

function normalizeFieldValue(f: FormField, v: unknown): unknown {
  switch (f.type) {
    case INBOX_KIND.text:
    case "textarea":
      return normalizeTextValue(f, v);
    case "number":
      return normalizeNumberValue(f, v);
    case "select":
    case "radio":
      return normalizeChoiceValue(f, v);
    case "checkbox":
      return normalizeCheckboxValue(f, v);
  }
}

function answerOfField(f: FormField, input: Record<string, unknown>): unknown {
  const v = input[f.id];
  const missing = v === undefined || v === null || (typeof v === "string" && !v.trim());
  if (!missing) return normalizeFieldValue(f, v);
  if (f.required) fail(`field “${f.label}” required`);
  // An unticked checkbox is a real answer (false), not an absence.
  return f.type === "checkbox" ? false : null;
}

/** A field's comment. Empty ones are dropped (noise in the resume prompt); on an unanswered
 *  question it is still legitimate ("I cannot decide, here is why"). */
function noteOfField(f: FormField, input: Record<string, unknown>): string | undefined {
  if (!acceptsNote(f)) return undefined;
  const raw = input[noteKey(f.id)];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") fail(`comment on “${f.label}”: text expected`);
  const note = raw.trim();
  if (!note) return undefined;
  if (note.length > MAX_NOTE) fail(`comment on “${f.label}”: ${MAX_NOTE} characters max`);
  return note;
}

/** The round comment: same rules as a field note. */
function roundComment(input: Record<string, unknown>): string | undefined {
  const raw = input[FORM_COMMENT_KEY];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") fail("round comment: text expected");
  const comment = raw.trim();
  if (comment.length > MAX_NOTE) fail(`round comment: ${MAX_NOTE} characters max`);
  return comment || undefined;
}

/** Validates the human submission against the agent's schema. Named refusals are shown as-is
 *  (toast "Answer refused"). Returns the normalised object (declared keys, guaranteed types) that
 *  goes into the resume prompt. */
export function validateFormAnswer(spec: FormSpec, data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data))
    fail("the answer must be an object { fieldId: value }");
  const input = data as Record<string, unknown>;
  const fields = formFields(spec);
  const known = knownAnswerKeys(fields);
  const unknownKeys = Object.keys(input).filter((k) => !known.has(k));
  if (unknownKeys.length) fail(`unknown key(s): ${unknownKeys.join(", ")}`);

  const out: Record<string, unknown> = {};
  for (const f of fields) out[f.id] = answerOfField(f, input);
  for (const f of fields) {
    const note = noteOfField(f, input);
    if (note !== undefined) out[noteKey(f.id)] = note;
  }
  const comment = roundComment(input);
  if (comment !== undefined) out[FORM_COMMENT_KEY] = comment;
  return out;
}

/** What the session resumes with: compact JSON with the keys the agent declared. */
export const serializeFormAnswer = (answers: Record<string, unknown>): string =>
  JSON.stringify(answers);
