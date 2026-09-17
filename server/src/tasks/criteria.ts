// A slice's criteria: the contract a task carries written in advance ("decoupe" spec, behaviours 6,
// 7, 9 and 10).
//
// A breakdown slice is born with a validation command and one to three typed criteria. Nothing runs
// them at tier 1: they are written, shown to the agent in its brief and to the operator on the task
// page, and they close the "done" door to the agent. The judge is the human, on the evidence each
// mode requires.
//
// This module carries the four things done with a criterion: the type, the tolerant read of the
// `tasks.criteria` column, validating a slice, and the block's text, the same for the brief and the
// page, because an agent and an operator not reading the same list do not judge the same work.
//
// Batch faults (zero slices, blocker cycles) are not here: they are decided reading the whole
// artifact at approval (`chains/slices.ts`).

/** The vocabulary's five modes, nothing else. Each says which evidence counts: `test` a named test
 *  and its output, `property` a property test run, `check` a command and its full output, `human`
 *  what was looked at, `waived` the written reason. */
export const CRITERION_MODES = ["test", "property", "check", "human", "waived"] as const;
export type CriterionMode = (typeof CRITERION_MODES)[number];

export type Criterion = {
  text: string;
  mode: CriterionMode;
  /** The covered edge's id, `B<number>/<category>`. Only meaningful on a `property` criterion;
   *  carried by another mode, it is ignored (behaviour 6). */
  edge?: string;
};

/** What the `tasks.criteria` column holds: the validation command first, then criteria in batch
 *  order. One object because command and criteria are one; tier 3 will run the command without
 *  moving anything. */
export type Criteria = { validatedBy: string; items: Criterion[] };

/** A slice as an agent writes it, before we know whether it holds: everything is `unknown`, because
 *  it comes from a JSON artifact or a request body. */
export type SliceDraft = {
  label?: unknown;
  outcome?: unknown;
  validatedBy?: unknown;
  items?: unknown;
  blockedBy?: unknown;
};

export const CRITERIA_MAX = 3;

/** The probe's eight categories, and an edge's exact form: integer from 1, no leading zero
 *  (Vocabulary). So `B0/empty` and `B04/empty` are not edges. */
const EDGE_FORM =
  /^B[1-9]\d*\/(empty|boundary|precision|ordering|encoding|idempotency|concurrency|permission)$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isMode = (v: unknown): v is CriterionMode =>
  typeof v === "string" && (CRITERION_MODES as readonly string[]).includes(v);

/** "Empty" is read after trimming both ends, non-breaking spaces included (Vocabulary):
 *  `String.trim()` already strips all Unicode whitespace, U+00A0 included, so no character class to
 *  maintain here.
 *
 *  A non-string counts as empty rather than breaking validation: "wrong type" is an artifact fault,
 *  named alone when the batch is read (behaviour 6); here we name what we can, all at once. */
const isBlank = (v: unknown): boolean => typeof v !== "string" || v.trim() === "";

/** How a faulty value reads in a message: a rank as is, everything else in quotes, so an empty
 *  string or a `null` shows. */
const show = (v: unknown): string => (typeof v === "number" ? String(v) : `“${String(v)}”`);

/** Reads an already decoded value (an agent filing's JSON body). Returns `null` on anything without
 *  the expected shape: the tolerance asked for, we do not throw, we say "unreadable". */
export function readCriteria(value: unknown): Criteria | null {
  if (!isRecord(value)) return null;
  const { validatedBy, items } = value;
  if (typeof validatedBy !== "string" || !Array.isArray(items)) return null;
  const read: Criterion[] = [];
  for (const raw of items) {
    if (!isRecord(raw) || typeof raw.text !== "string" || !isMode(raw.mode)) return null;
    // The `edge` of a non-`property` criterion does not survive the read: validation ignores it, and
    // keeping it in the database would make it reappear on screen.
    read.push(
      raw.mode === "property" && typeof raw.edge === "string"
        ? { text: raw.text, mode: raw.mode, edge: raw.edge }
        : { text: raw.text, mode: raw.mode },
    );
  }
  return { validatedBy, items: read };
}

/** Reads the `tasks.criteria` column. `null` = the task carries none, or the value is unreadable. */
export function parseCriteria(raw: unknown): Criteria | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    return readCriteria(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** A total, stable order on blocker values: ranks first, ascending (what "ascending values" means),
 *  then non-numbers, by their spelling. */
function compareBlockers(a: unknown, b: unknown): number {
  const na = typeof a === "number",
    nb = typeof b === "number";
  if (na && nb) return (a as number) - (b as number);
  if (na !== nb) return na ? -1 : 1;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/**
 * All of one slice's faults, every one named, never just the first (behaviour 6).
 *
 * Order follows the vocabulary's fields (label, outcome, command, criteria by position, blockers),
 * and within a field one line per faulty value, ascending; a value with several faults carries them
 * all on its line, in behaviour 6's list order. That lets the agent fix everything in one filing
 * instead of being refused three times in a row.
 *
 * `rankCount` = the batch's slice count. Absent, the slice is not in a batch (a leftover filed by
 * `propose_task`, behaviour 10): batch-only fields (label, outcome, blockers) are not required then,
 * only the command and criteria are.
 */
export function validateSlice(slice: SliceDraft, rankCount?: number): string[] {
  const faults: string[] = [];
  const inLot = rankCount !== undefined;

  if (inLot && isBlank(slice.label)) faults.push("empty label");
  if (inLot && isBlank(slice.outcome)) faults.push("empty observable outcome");
  if (isBlank(slice.validatedBy)) faults.push("empty validation command");

  const items = Array.isArray(slice.items) ? slice.items : [];
  if (items.length === 0) faults.push("no criterion");
  else if (items.length > CRITERIA_MAX) faults.push(`more than three criteria (${items.length})`);
  items.forEach((raw, i) => {
    const c = isRecord(raw) ? raw : {};
    const own: string[] = [];
    if (isBlank(c.text)) own.push("empty text");
    if (!isMode(c.mode)) own.push(`unknown mode ${show(c.mode)}`);
    else if (c.mode === "property") {
      // A `property` criterion cites the edge it covers: a text cannot be matched to an edge, and
      // that link is what tier 2's certifier will re-read.
      if (isBlank(c.edge)) own.push("property mode without an edge");
      else if (!EDGE_FORM.test((c.edge as string).trim()))
        own.push(`malformed edge ${show(c.edge)}`);
    }
    if (own.length > 0) faults.push(`criterion ${i + 1}: ${own.join(", ")}`);
  });

  if (inLot) {
    const blockers = Array.isArray(slice.blockedBy) ? slice.blockedBy : [];
    // Grouped by value before judging: a blocker cited twice is said once, and if it is also outside
    // the batch it carries both faults on one line.
    const grouped = new Map<string, { value: unknown; count: number }>();
    for (const b of blockers) {
      const key = `${typeof b}:${String(b)}`;
      const seen = grouped.get(key);
      if (seen) seen.count += 1;
      else grouped.set(key, { value: b, count: 1 });
    }
    const faulty = [...grouped.values()]
      .map(({ value, count }) => {
        const own: string[] = [];
        const isRank =
          typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= rankCount;
        if (!isRank) own.push(`points at no rank of the batch (1 to ${rankCount})`);
        if (count > 1) own.push("cited twice");
        return { value, own };
      })
      .filter((f) => f.own.length > 0)
      .sort((a, b) => compareBlockers(a.value, b.value));
    for (const f of faulty) faults.push(`blocker ${show(f.value)}: ${f.own.join(", ")}`);
  }

  return faults;
}

/** The heading of the block. The SAME wording on both sides, like everything else the operator
 *  reads: it is the same block the page shows, and two different headings would make it look
 *  like two different things. */
export const CRITERIA_HEADING = "What this task must prove";

/** The block's text: the validation command, then criteria numbered 1 to 3 with their mode, in batch
 *  order (behaviour 7). What the session brief inserts after the task description, and what the page
 *  renders for the operator. */
export function renderCriteria(criteria: Criteria): string {
  const lines = criteria.items.map(
    (c, i) =>
      `${i + 1}. [${c.mode}] ${c.text}` +
      (c.mode === "property" && c.edge ? ` (edge ${c.edge})` : ""),
  );
  return [`## ${CRITERIA_HEADING}`, `Validation command: ${criteria.validatedBy}`, ...lines].join(
    "\n",
  );
}
