// The key that sends, decided once for every input that talks to someone (07/09).
//
// Enter alone never sends. The operator sent a half-written inbox reply by pressing Enter: on input
// addressed to an agent, sending restarts a session and cannot be undone. The convention is Slack's,
// Linear's and GitHub's: ⌘+Enter on macOS, Ctrl+Enter elsewhere, or the button. In a textarea Enter
// and Shift+Enter insert a newline as native does; in a single-line field Enter does nothing.
//
// IME composition (kana, pinyin) confirms a word with Enter: not a send, and the browser only says so
// through `nativeEvent.isComposing`, which React does not surface.
//
// Structural type rather than `React.KeyboardEvent` so a test can build one as a plain object.
// `shiftKey` is named to say it is ignored.
export type SubmitKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey?: boolean;
  nativeEvent: { isComposing: boolean };
};

/** ⌘/Ctrl+Enter outside IME composition. Everything else, Enter alone included, is `false`. */
export const isSubmitKey = (e: SubmitKeyEvent): boolean =>
  e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing;
