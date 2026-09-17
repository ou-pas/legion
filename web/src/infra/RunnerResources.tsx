// A session's RAM and CPUs, adjustable per runner (26/08; slider and stepper since the 02/09 dense
// card).
//
// RAM is picked with a slider on steps (powers of two from 512 MB to 32 GB): the position shows at
// a glance where you are between floor and ceiling. A non-step value set through the API is
// inserted into the scale, never overwritten. CPUs stay on a stepper: between 0.25 and 16 by 0.25,
// precision matters more than position.
//
// The caption says when it applies, and that matters: a container's limits are frozen at creation.
// Changing RAM while a session runs does not save it; it would need a restart, losing its work.
// Without that sentence you would think you had fixed a dying session.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { infraApi } from "../api/infra.js";
import { qk } from "../queries.js";
import { Row, Stack } from "../ui/flex.js";
import { SaveButton } from "../ui/save-button.js";
import { SnapSlider } from "../ui/slider.js";
import { Stepper } from "../ui/stepper.js";
import { Caption } from "../ui/text.js";
import { INFRA_TEXT } from "./text.js";
import "./runner-concurrency.css";

const MEMORY_STOPS = [512, 1024, 2048, 4096, 8192, 16_384, 32_768] as const;
const CPUS_MIN = 0.25;
const CPUS_MAX = 16;

const fmtRam = (n: number) =>
  n >= 1024 ? `${n % 1024 === 0 ? n / 1024 : (n / 1024).toFixed(1)} GB` : `${n} MB`;

function useSaveResources(runnerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { memoryMb?: number; cpus?: number }) =>
      infraApi.setResources(runnerId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.infra }),
  });
}

export function MemoryField({
  runnerId,
  runnerName,
  value,
}: {
  runnerId: string;
  runnerName: string;
  value: number;
}) {
  const [draft, setDraft] = useState(value);
  const save = useSaveResources(runnerId);
  const dirty = draft !== value;
  const t = INFRA_TEXT.memory;
  return (
    // `ir-field-ram`: in the settings drawer grid, RAM takes the full width. The slider needs its
    // travel, the two steppers (sessions, CPU) share the row above (operator's request, 02/09).
    <Stack gap={4} className="ir-field-ram">
      <span className="ir-field-label">{t.label}</span>
      <Row gap={8} align="center">
        <SnapSlider
          value={draft}
          stops={MEMORY_STOPS}
          label={t.field(runnerName)}
          format={fmtRam}
          onChange={setDraft}
        />
        <SaveButton
          dirty={dirty}
          saving={save.isPending}
          error={save.error ? (save.error as Error).message : null}
          label={t.field(runnerName)}
          onSave={() => save.mutate({ memoryMb: draft })}
        />
      </Row>
      <Caption>{dirty ? t.later : t.hint}</Caption>
    </Stack>
  );
}

export function CpusField({
  runnerId,
  runnerName,
  value,
}: {
  runnerId: string;
  runnerName: string;
  value: number;
}) {
  const [draft, setDraft] = useState(value);
  const save = useSaveResources(runnerId);
  const dirty = draft !== value;
  const t = INFRA_TEXT.cpus;
  return (
    <Stack gap={4}>
      <span className="ir-field-label">{t.label}</span>
      <Row gap={8} align="center">
        <Stepper
          value={draft}
          min={CPUS_MIN}
          max={CPUS_MAX}
          step={0.25}
          unit="cores"
          label={t.field(runnerName)}
          onChange={setDraft}
        />
        <SaveButton
          dirty={dirty}
          saving={save.isPending}
          error={save.error ? (save.error as Error).message : null}
          label={t.field(runnerName)}
          onSave={() => save.mutate({ cpus: draft })}
        />
      </Row>
      <Caption>{dirty ? INFRA_TEXT.memory.later : t.hint}</Caption>
    </Stack>
  );
}
