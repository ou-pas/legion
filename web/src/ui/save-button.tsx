// A button that tells the story of its save (operator request, 02/09).
//
//   hidden    nothing changed: an always-visible button invites pointless clicks (RunnerConcurrency,
//             26/08);
//   ready     the value changed: save icon, accent tint;
//   saving    spinner, with a duration floor: on a LAN a save takes 50 ms and a one-frame spinner
//             does not exist (operator, 02/09). The floor slows the story, not the save;
//   done      an --ok check that fades on its own: a permanent success would lie after the next edit;
//   failed    a --bad triangle that stays, message beside it: an error that fades was not read.
//
// State is announced (polite aria-live): a silent spinner does not exist for a screen reader.
import { useEffect, useRef, useState } from "react";
import { Check, Save, TriangleAlert } from "lucide-react";
import { Spinner } from "./spinner.js";
import { Text } from "./text.js";
import { UI_TEXT } from "./vocabulary.js";
import "./save-button.css";

/** Long enough to be seen, short enough not to feel sluggish. */
const MIN_SPIN_MS = 450;
const SHOWN_MS = 1800;

export function SaveButton({
  dirty,
  saving,
  error,
  label,
  onSave,
}: {
  /** The value differs from the server's; without it the button does not exist. */
  dirty: boolean;
  saving: boolean;
  /** The last attempt's failure, shown until resolved. */
  error?: string | null;
  /** What the save records: "Save the mini-workshop cap". */
  label: string;
  onSave: () => void;
}) {
  // The displayed face, decoupled from `saving`: the request may finish in 50 ms, the spinner →
  // check story keeps its own duration.
  const [face, setFace] = useState<"idle" | "spin" | "check">("idle");
  const spinStartRef = useRef(0);

  // Our click triggers the save, so the story starts in the handler: no ref or clock during
  // render, no setState in an effect.
  const save = () => {
    spinStartRef.current = Date.now();
    setFace("spin");
    onSave();
  };

  // The effect only keeps what is truly external: the story's timers. When the save ends, the
  // spinner holds its floor, then the check (success) or rest (failure; the error stays shown).
  useEffect(() => {
    if (saving || spinStartRef.current === 0) return undefined;
    const rest = Math.max(0, MIN_SPIN_MS - (Date.now() - spinStartRef.current));
    spinStartRef.current = 0;
    const failed = Boolean(error);
    const toOutcome = setTimeout(() => setFace(failed ? "idle" : "check"), rest);
    const toRest = failed ? undefined : setTimeout(() => setFace("idle"), rest + SHOWN_MS);
    return () => {
      clearTimeout(toOutcome);
      if (toRest) clearTimeout(toRest);
    };
  }, [saving, error]);

  if (!dirty && !saving && face === "idle" && !error) return null;

  return (
    <span className="ui-save" aria-live="polite">
      {saving || face === "spin" ? (
        <span className="ui-save-state" role="status">
          <Spinner size="sm" label={UI_TEXT.saveButton.saving(label)} />
        </span>
      ) : face === "check" && !dirty ? (
        <span
          className="ui-save-state ui-save-ok"
          role="status"
          aria-label={UI_TEXT.saveButton.saved(label)}
        >
          <Check size={14} />
        </span>
      ) : (
        <button
          type="button"
          className="ui-save-btn"
          aria-label={label}
          title={label}
          disabled={!dirty}
          onClick={save}
        >
          <Save size={14} />
        </button>
      )}
      {error && !saving && face !== "spin" && (
        <span className="ui-save-error">
          <TriangleAlert size={12} />
          <Text size="xs" tone="bad">
            {error}
          </Text>
        </span>
      )}
    </span>
  );
}
