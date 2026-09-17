// What surrounded a past question (26/08). The thread replayed an answered round from
// `inbox_ask`/`inbox_answer` events alone, two texts: rereading "the agent asked X, you answered Y"
// weeks later does not say what you RULED OUT or relied on, which is what one scrolls back for.
//
// The inbox archive (`GET /api/tasks/:id/inbox-history`, PR #40) keeps it: offered choices, evidence,
// announced impact.
//
// Discarded choices are shown, not only the one taken: a decision rereads by what it refused, and
// showing only the choice made would make a ruling look obvious.
import type { InboxHistoryEntry } from "../api/inbox.js";
import { Chip } from "../ui/chip.js";
import { Row, Stack } from "../ui/flex.js";
import { KeyValue, KeyValueList } from "../ui/key-value.js";
import { Caption } from "../ui/text.js";
import { CHANNELS_TEXT } from "./text.js";

export function ChannelRoundArchive({ entry }: { entry: InboxHistoryEntry }) {
  const t = CHANNELS_TEXT.round.archive;
  const chosen = entry.answer?.selectedChoiceId ?? null;
  const hasChoices = (entry.choices?.length ?? 0) > 0;
  if (!hasChoices && !entry.evidence && !entry.impact && entry.onAnswer !== "retry-task")
    return null;
  return (
    <Stack gap={8}>
      {entry.onAnswer === "retry-task" && <Caption tone="wait">{t.diagnostic}</Caption>}
      {hasChoices && (
        <Stack gap={3}>
          <Caption tone="subtle">{t.choices}</Caption>
          <Row gap={6} wrap>
            {entry.choices!.map((c) => (
              // The kept one is selected, the others stay READABLE and unstruck: they were not
              // wrong, just not taken.
              <Chip
                key={c.id}
                selected={c.id === chosen}
                kind={c.id === chosen ? "st-ok" : "st-neutral"}
              >
                {c.label}
              </Chip>
            ))}
          </Row>
        </Stack>
      )}
      {(entry.evidence || entry.impact) && (
        <KeyValueList variant="stacked" density="compact" label={t.receipt}>
          {entry.evidence && <KeyValue label={t.evidence}>{entry.evidence}</KeyValue>}
          {entry.impact && <KeyValue label={t.impact}>{entry.impact}</KeyValue>}
        </KeyValueList>
      )}
    </Stack>
  );
}
