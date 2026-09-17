// The interface TEXT infrastructure: one typed identity function, on purpose. The need is "one place
// per domain to read all the copy", not a translation engine: no locale detection, no React context,
// no dependency. English is the only shipped catalog.
//
// The key is the ACCESS PATH (`TASK_TEXT.board.archiveAll`), so TypeScript checks keys at compile
// time, with no `t("unknown.key")` that only breaks at runtime, and no lookup cost in the bundle.
//
// Where a catalog lives: `web/src/<domain>/text.ts`, same arbitration rule as the rest (CLAUDE.md):
// nothing domain-specific → `ui/vocabulary.ts`; ONE domain → its folder; a screen composing several
// → `app/`. A domain too big splits per screen (`tasks/text/board.ts`), never one giant file.

/** A sentence, or a sentence WITH HOLES: interpolated values go through a function, never through
 *  concatenation at the call site, or word order becomes impossible to change. */
export type TextEntry = string | ((...args: never[]) => string);

/** Entries, possibly grouped per screen. */
export type TextCatalog = { readonly [key: string]: TextEntry | TextCatalog };

/** `const` freezes literal types: a missing key is a compile error at the call site, and
 *  autocompletion lists the available sentences. */
export function defineText<const T extends TextCatalog>(catalog: T): T {
  return catalog;
}
