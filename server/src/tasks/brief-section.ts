/** The brief as it was before the first appended section.
 *
 *  A section the server appends (operator review, CI fix, retry diagnostic) is REPLACED on the
 *  next pass, found by its heading. A heading that has ever been renamed keeps its old spellings
 *  in `headings`: a task written under the old name still carries it, and missing it would stack
 *  a second section instead of replacing the first. */
export function briefBefore(description: string, headings: readonly string[]): string {
  const cuts = headings.map((h) => description.indexOf(h)).filter((i) => i >= 0);
  return cuts.length ? description.slice(0, Math.min(...cuts)) : description;
}
