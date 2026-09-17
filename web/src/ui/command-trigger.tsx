// Command palette trigger in the topbar. It used to be a <Button> stretched by `flex: 1`: a button
// centers its content, so the label and shortcut floated in the middle of a thousand pixels
// (operator, 20/08). It is a field affordance instead (the surface, line and height of an
// <input>, prompt on the left, shortcut on the right) on a <button>, since it opens a surface.
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Kbd } from "./kbd.js";
import "./command-trigger.css";

/** Key glyphs → `aria-keyshortcuts` names (WAI-ARIA 1.2). Without it the shortcut exists only
 *  for the eye: "⌘" is not a valid key name. */
const KEY_NAME: Record<string, string> = {
  "⌘": "Meta",
  // The modifier is written per platform (ui/platform.ts), so the word arrives here too, and
  // "CTRL" is not a valid key name either.
  Ctrl: "Control",
  "⌥": "Alt",
  "⇧": "Shift",
  "⌃": "Control",
  "⏎": "Enter",
  "⎋": "Escape",
};

export function CommandTrigger({
  label,
  keys,
  onOpen,
  icon = <Search />,
  className,
}: {
  /** Reads like a placeholder. */
  label: string;
  /** Shown on the right and announced through `aria-keyshortcuts`. */
  keys?: readonly string[];
  onOpen: () => void;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={["ui-cmd-trigger", className].filter(Boolean).join(" ")}
      onClick={onOpen}
      aria-keyshortcuts={keys?.map((k) => KEY_NAME[k] ?? k.toUpperCase()).join("+")}
    >
      <span className="ui-cmd-trigger-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="ui-cmd-trigger-label">{label}</span>
      {/* aria-hidden: aria-keyshortcuts already carries it. Otherwise the accessible name ends
          with "⌘ K", read letter by letter. */}
      {keys && (
        <span className="ui-cmd-trigger-keys" aria-hidden="true">
          <Kbd keys={keys} />
        </span>
      )}
    </button>
  );
}
