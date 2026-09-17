// One key or a sequence: `keys={["⌘", "K"]}` renders two adjacent keys, not a pill with a glyph
// glued to the text.
import "./kbd.css";

export function Kbd({ keys, className }: { keys: string | readonly string[]; className?: string }) {
  const seq = typeof keys === "string" ? [keys] : keys;
  if (seq.length < 2) {
    return <kbd className={["ui-kbd", className].filter(Boolean).join(" ")}>{seq[0]}</kbd>;
  }
  return (
    <span className={["ui-kbd-seq", className].filter(Boolean).join(" ")}>
      {seq.map((k, i) => (
        <kbd key={`${k}-${i}`} className="ui-kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}
