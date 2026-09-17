// The submit key hint, composed once for the eight buttons that trigger it (`ui/submit-key.ts`:
// ⌘/Ctrl+Enter submits, Enter alone never does). Decision D6, 14/09/2026: a text catalogue can only
// return one string, not two key caps, so the output is a component the eight sites call instead of
// each recomposing `Kbd` + `MOD` + `ENTER`.
//
// Only for `Button`'s `shortcut` prop, never rendered alone: `Button` already sets `aria-hidden` on
// the wrapper and the fade (`.ui-btn-shortcut`).
//
// The inbox's icon-only button (`inbox/inbox-reply-field.tsx`) is out of scope: with no text to
// follow, it has nowhere to put a key cap and says it in words in its Tooltip and `aria-label`
// (`UI_TEXT.submitShortcut`, `ui/vocabulary.ts`).
import { Kbd } from "./kbd.js";
import { ENTER, MOD } from "./platform.js";

export function SubmitShortcut() {
  return <Kbd keys={[MOD, ENTER]} />;
}
