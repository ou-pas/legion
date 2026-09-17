// How a shortcut is written, depending on the machine reading the screen.
//
// Behaviour was already agnostic (`submit-key.ts`, `use-rail.ts` and the palette all test
// `metaKey || ctrlKey`). The display lied: three hardcoded labels, "⌘B" promising a key Windows and
// Linux lack, and twice "⌘/Ctrl+↵" listing both cases. Legion is driven over the tailnet, not only
// from its host machine.
//
// Detected once, at load: an OS does not change mid-session, and a value recomputed each render
// would invite treating it as reactive.

/** The rule, isolated from how it is fed, so it is testable without a browser. iPhone and iPad
 *  count: a keyboard attached to an iPad has the Command key, and `userAgentData.platform` says
 *  "iOS" there, not "macOS". */
export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** `userAgentData.platform` is the modern way but Chromium-only; the deprecated
 *  `navigator.platform` still answers everywhere. First one that answers, else the empty string:
 *  outside a browser, "not a Mac" is the default that shows the most explicit label. */
function readPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const modern = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return modern?.platform ?? navigator.platform ?? "";
}

export const IS_MAC: boolean = isMacPlatform(readPlatform());

/** The modifier alone: the glyph on macOS, the word elsewhere. */
export const MOD: string = IS_MAC ? "⌘" : "Ctrl";

/** A sign on both platforms (operator decision, 13/09): a shortcut is shown, not spelled out, and
 *  a button's row is short. Only the arrow differs: "↩" is what a Mac keyboard shows, "↵" the form
 *  the repo always used. `combo` still glues a glyph and separates a word ("⌘↩" / "Ctrl+↵"): the
 *  plus is there because "Ctrl" is a word. */
export const ENTER: string = IS_MAC ? "↩" : "↵";

/** Punctuation changes with the platform: a glyph sticks to its key (⌘B), a word takes a plus
 *  (Ctrl+B). Both platforms' convention: "⌘+B" reads as a typo on a Mac. */
export function combo(key: string): string {
  return IS_MAC ? `${MOD}${key}` : `${MOD}+${key}`;
}

// Buttons render one Kbd per key through `ui/submit-shortcut.tsx` (D6, 14/09);
// `UI_TEXT.submitShortcut` (`ui/vocabulary.ts`) remains the string form for text catalogues.
