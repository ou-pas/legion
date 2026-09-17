// A runner's concurrent session cap, adjustable (26/08; stepper since the 02/09 dense card: a value
// from 1 to 16 moves by one step, not by keyboard).
//
// Save only appears when the value changed, and it tells what it does: spinner during, brief check
// after, an error that stays (ui/save-button).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { infraApi } from "../api/infra.js";
import { qk } from "../queries.js";
import { Row, Stack } from "../ui/flex.js";
import { SaveButton } from "../ui/save-button.js";
import { Stepper } from "../ui/stepper.js";
import { Caption, Text } from "../ui/text.js";
import { INFRA_TEXT } from "./text.js";
import "./runner-concurrency.css";

const MIN = 1;
const MAX = 16;

export function RunnerConcurrency({
  runnerId,
  runnerName,
  value,
  running,
}: {
  runnerId: string;
  runnerName: string;
  value: number;
  running: number;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(value);
  const save = useMutation({
    mutationFn: (n: number) => infraApi.setConcurrency(runnerId, n),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.infra }),
  });

  // The server stays the authority: the field is refilled from the snapshot on every refresh, so
  // compare with the server, not with a local state believed current.
  const dirty = draft !== value;
  const t = INFRA_TEXT.concurrency;

  return (
    <Stack gap={4}>
      <span className="ir-field-label">{t.label}</span>
      <Row gap={8} align="center">
        <Stepper
          value={draft}
          min={MIN}
          max={MAX}
          label={t.field(runnerName)}
          onChange={setDraft}
        />
        <SaveButton
          dirty={dirty}
          saving={save.isPending}
          error={save.error ? (save.error as Error).message : null}
          label={t.field(runnerName)}
          onSave={() => save.mutate(draft)}
        />
      </Row>
      <Caption>{t.load(running, value)}</Caption>
      {!dirty && running > value && (
        <Text size="xs" tone="wait">
          {t.belowLoad(running)}
        </Text>
      )}
    </Stack>
  );
}
