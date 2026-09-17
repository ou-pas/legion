// Reads a task's `criteria` column, screen side. The server sends it as raw JSON, like `prUrls` and
// `externalRef`; the screen decodes it here and nowhere else.
//
// Same reading as the server (`server/src/tasks/criteria.ts`): `null` on anything malformed rather
// than throwing. A task page must not go blank because an agent wrote an unreadable column; it
// shows the task without the block, exactly what a task without criteria looks like. Written twice
// because server and screen share no package: a ten-line duplicate, to remove once one exists.

/** The five modes say which EVIDENCE counts. They are identifiers, read as is by the agent and the
 *  operator, not labels to translate. */
export const CRITERION_MODES = ["test", "property", "check", "human", "waived"] as const;
export type CriterionMode = (typeof CRITERION_MODES)[number];

export type Criterion = { text: string; mode: CriterionMode; edge?: string };
export type Criteria = { validatedBy: string; items: Criterion[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isMode = (v: unknown): v is CriterionMode =>
  typeof v === "string" && (CRITERION_MODES as readonly string[]).includes(v);

export function parseCriteria(raw: string | null | undefined): Criteria | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.validatedBy !== "string" || !Array.isArray(value.items))
    return null;
  const items: Criterion[] = [];
  for (const raw of value.items) {
    if (!isRecord(raw) || typeof raw.text !== "string" || !isMode(raw.mode)) return null;
    items.push(
      raw.mode === "property" && typeof raw.edge === "string"
        ? { text: raw.text, mode: raw.mode, edge: raw.edge }
        : { text: raw.text, mode: raw.mode },
    );
  }
  return { validatedBy: value.validatedBy, items };
}
