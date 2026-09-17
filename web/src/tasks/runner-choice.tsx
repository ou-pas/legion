// The task's machine, next to "Run again" (v66, 09/09).
//
// Born from an outage: the `local` runner had lost its session image, two tasks died, and other
// machines of the fleet had it. The missing gesture belongs here, where the operator is at that
// moment, having just read that the session stopped, and nowhere else.
//
// The default is an option, not a blank. "Any free machine" is the long-standing behaviour (the
// control plane weighs health, capacity, disk, load); spelling it out lets it be CHOSEN again.
//
// The machine's state reads in the option, and an unreachable machine stays SELECTABLE: the server
// will refuse the run and name it, and the operator decides to bring it back. Disabling it here
// would hide the reason behind a dead control (`disabled` + `title` does not show).
import { useState } from "react";
import { type RunnerSummary } from "../api/infra.js";
import { tasksApi, type Task } from "../api/tasks.js";
import { Row } from "../ui/flex.js";
import { Select } from "../ui/select.js";
import { Caption } from "../ui/text.js";
import { useToast } from "../ui/toast.js";
import { TASK_RUN_TEXT } from "./text/task-run.js";

/** The "no machine chosen" value. Empty string because `Select` compares strings and no runner id
 *  is empty. */
const ANY = "";

/** A machine's state as appended to its name in the list. `null`: nothing to report. */
function stateOf(runner: RunnerSummary): string | null {
  const t = TASK_RUN_TEXT.verdict.runner;
  if (!runner.enabled) return t.off;
  if (!runner.reachable) return t.asleep;
  return null;
}

export function RunnerChoice({
  task,
  runners,
  onChosen,
}: {
  task: Task;
  /** The fleet as `GET /api/runners` returns it (`runnersQuery`). When empty the caller does not
   *  render this component: a single-option select chooses nothing. */
  runners: RunnerSummary[];
  /** The task changed machine: refetch it. A refusal is toasted from here. */
  onChosen: () => void;
}) {
  const t = TASK_RUN_TEXT.verdict.runner;
  const { push } = useToast();
  const [saving, setSaving] = useState(false);
  const chosen = runners.find((r) => r.id === task.chosenRunnerId) ?? null;
  const state = chosen ? stateOf(chosen) : null;

  const choose = (value: string) => {
    setSaving(true);
    tasksApi
      .updateTask(task.id, { chosenRunnerId: value === ANY ? null : value })
      .then(onChosen)
      // The server refuses in one sentence (live session, unknown machine): show it as is rather
      // than rewriting a less accurate one.
      .catch((e: Error) => push({ tone: "bad", title: t.refused, body: e.message }))
      .finally(() => setSaving(false));
  };

  return (
    <Row gap={8} wrap>
      <Select
        aria-label={t.label}
        value={task.chosenRunnerId ?? ANY}
        disabled={saving}
        placeholder={t.gone}
        onChange={(e) => choose(e.target.value)}
      >
        <option value={ANY}>{t.any}</option>
        {runners.map((r) => {
          const s = stateOf(r);
          return (
            <option key={r.id} value={r.id}>
              {s === null ? r.name : `${r.name} — ${s}`}
            </option>
          );
        })}
      </Select>
      {/* The reason is VISIBLE TEXT next to the control, never a tooltip on a disabled control. It
          only shows when the chosen machine cannot take the task. */}
      {chosen && state !== null && (
        <Caption tone="wait">
          {chosen.enabled ? t.warn(chosen.name) : t.warnOff(chosen.name)}
        </Caption>
      )}
    </Row>
  );
}
