// What was decided outlives the session that asked (14/09).
//
// An interview writes its `spec.md` at the end (`data/skills/grilling/SKILL.md`, "What you
// produce"), so an interview cut at round 2 left nothing although round 1 was answered. Seen on
// `OgH7TFVsRH`: four decisions stored as opaque keys (`{"perimetre":"titre_gestes",…}`),
// unreadable even by the agent resuming.
//
// Here rather than in the skill: a prompt instruction is a request, forgotten exactly in the case
// that matters, and in that case `fs_write` was among the cut tools anyway. The control plane
// holds the answer when it arrives.
//
// Pure: an answered entry in, markdown out. Writing is in `round-log-store.ts`.
import type { InboxMessageRow } from "./inbox-store.js";

/** A form question as `inbox_ask` asked it. Permissive: model-written JSON, and a missing field
 *  must not lose the round. */
type FormField = {
  id?: unknown;
  label?: unknown;
  hint?: unknown;
  options?: { id?: unknown; label?: unknown }[];
};
type FormBlock = { kind?: unknown; text?: unknown; field?: FormField };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** The label of what was chosen, never the key: a form id means nothing to whoever rereads the
 *  decision later. A free answer (text, number) is its own label. */
function chosenLabel(field: FormField, value: unknown): string {
  const options = Array.isArray(field.options) ? field.options : [];
  const hit = options.find((o) => str(o.id) === String(value));
  return hit ? str(hit.label) : String(value ?? "").trim();
}

/** The round as markdown, or `null` for an entry without a form: a simple question is a round
 *  trip, not an interview round, and logging dozens would drown the ones that matter. */
export function renderRound(msg: InboxMessageRow, at: Date): string | null {
  const form = parse<{ blocks?: FormBlock[] }>(msg.form);
  const fields = (form?.blocks ?? []).filter((b) => b.kind === "field" && b.field);
  if (fields.length === 0) return null;

  const answers = parse<Record<string, unknown>>(msg.answerText) ?? {};
  const lines: string[] = [`## ${str(msg.body) || "Round without a title"}`, ""];
  lines.push(`Answered on ${at.toISOString().slice(0, 16).replace("T", " at ")}.`, "");

  const evidence = str(msg.evidence);
  if (evidence) lines.push("### What was measured", "", evidence, "");

  lines.push("### What was decided", "");
  for (const block of fields) {
    const field = block.field as FormField;
    const id = str(field.id);
    const label = str(field.label) || id || "Question without a label";
    // An unanswered question is still written, saying so: the next session knows it may ask again.
    const answered = id in answers ? chosenLabel(field, answers[id]) : "";
    lines.push(`**${label}**`, "", answered ? `→ ${answered}` : "→ _no answer_", "");
    // `hint` is what the agent recommended and why, the only trace of the reasoning.
    const hint = str(field.hint);
    if (hint) lines.push(`_Recommendation put with the question: ${hint}_`, "");
  }

  const impact = str(msg.impact);
  if (impact) lines.push("### What this commits to", "", impact, "");

  return lines.join("\n");
}

/** The file header, written once at the first logged round. It says where the file comes from:
 *  an unrequested artifact not written by the agent is the kind of thing one deletes out of
 *  suspicion. */
export const ROUND_LOG_HEADER = `# Interview — what was settled, round by round

Written by the control plane as each answer arrives, not by the agent: otherwise an interrupted
interview lost everything already decided. This is a RECORD, not a spec — the synthesis is still
the \`spec.md\` the interview produces at the end.
`;

/** Next to the agent's `spec.md`, never replacing it. The French name predates the English move
 *  and is kept so existing tasks keep appending to the same file. */
export const ROUND_LOG_FILE = "entretien.md";
