// What goes into the crate: the checklist, with the project's counts.
//
// The counts come from the server (`crate/manifest`) and show before a passphrase is asked for:
// nobody types a secret to find out afterwards what they are taking.
import { Checkbox } from "../ui/choice.js";
import { Num } from "../ui/num.js";
import { Caption, Text } from "../ui/text.js";
import { CRATE_PARTS, type CrateInclude, type CratePart } from "../api/portability.js";
import { CRATE_PART_LABEL, CRATE_TEXT } from "./text.js";
import "./crate-contents.css";

export function CrateContents({
  counts,
  include,
  onChange,
}: {
  counts: Record<CratePart, number>;
  include: CrateInclude;
  onChange: (next: CrateInclude) => void;
}) {
  const t = CRATE_TEXT.export;
  const chosen = CRATE_PARTS.filter((p) => include[p]);
  const total = chosen.reduce((n, p) => n + counts[p], 0);
  return (
    <div className="cr-list">
      {CRATE_PARTS.map((part) => (
        // A div, not a `label`: `Checkbox` already carries one, and nested labels toggle the box
        // twice per click, so the row would check then uncheck.
        <div key={part} className="cr-row" data-tone={part === "secrets" ? "gate" : undefined}>
          <Checkbox
            className="cr-label"
            checked={include[part]}
            onChange={(next) => onChange({ ...include, [part]: next })}
          >
            {CRATE_PART_LABEL[part]}
          </Checkbox>
          {/* `align="end"` + tabular figures: the column does not dance from row to row. */}
          <Num value={counts[part]} align="end" tone={counts[part] === 0 ? "subtle" : "muted"} />
        </div>
      ))}
      <div className="cr-foot">
        <Caption>{t.total(total)}</Caption>
        {include.secrets && counts.secrets > 0 ? (
          <Text size="xs" tone="wait" weight="semi">
            {t.withSecrets(counts.secrets)}
          </Text>
        ) : (
          <Caption>{t.withoutSecrets}</Caption>
        )}
      </div>
    </div>
  );
}
