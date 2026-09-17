// The preview of an opened crate: what would be created, before deciding.
//
// Nothing is written yet when this block shows. It is the last moment to back out, so it says two
// things: the counts, and the notes on what the import will not do (skills that travel by name
// only, paths from the original machine).
import { Banner } from "../ui/banner.js";
import { Stack } from "../ui/flex.js";
import { Field } from "../ui/form.js";
import { KeyValue, KeyValueList } from "../ui/key-value.js";
import { Num } from "../ui/num.js";
import { Caption } from "../ui/text.js";
import type { CrateSummary } from "../api/portability.js";
import { CRATE_TEXT } from "./text.js";

type CountKey = keyof CrateSummary["counts"];
/** Agents first: that is what people come for. Secrets last: that is what they check. */
const ORDER: CountKey[] = [
  "agents",
  "environments",
  "repos",
  "rules",
  "mcpServers",
  "templates",
  "secrets",
];

export function CrateSummaryView({ summary }: { summary: CrateSummary }) {
  const t = CRATE_TEXT.import;
  const shown = ORDER.filter((k) => summary.counts[k] > 0);
  return (
    <Stack gap={12}>
      <Banner tone="ok" title={t.opened(summary.project)} />
      <Field label={t.willCreate}>
        <KeyValueList density="compact" label={t.willCreate}>
          {shown.map((k) => (
            <KeyValue key={k} label={t.counts[k]}>
              <Num value={summary.counts[k]} />
            </KeyValue>
          ))}
        </KeyValueList>
      </Field>
      <Stack gap={2}>
        {summary.notes.map((n) => (
          <Caption key={n}>{n}</Caption>
        ))}
      </Stack>
    </Stack>
  );
}
