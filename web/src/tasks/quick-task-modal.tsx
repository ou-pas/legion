// The quick create popup: a Legion task from something that already exists, a Linear issue (Issues
// screen) or a review comment (Reviews screen).
//
// It used to be written twice (extracted 06/09). `CreateTaskModal` in `IssuesPage.tsx` and
// `FixTaskModal` in `ReviewsPage.tsx` had the same state, effective agent, create → run → invalidate
// → close sequence, and JSX up to four labels. They diverged exactly where it does not show: an
// unticked "Run now" set `status: later` on the Issues side (regression fixed,
// `issues-page.test.tsx`) and NOTHING on the Reviews side, so a `todo` task the pump picks up within
// 30 s. One popup can no longer miss that on one side only.
//
// What stays specific to each origin became props: title, suggested name, preview, brief, external
// reference, and the sentence saying what running will cause over there.
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { tasksApi, TASK_STATUS, type ExternalRef } from "../api/tasks.js";
import { type Project } from "../api/projects.js";
import { bootstrapQuery, qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/choice.js";
import { CodeBlock } from "../ui/code.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Field, FormError } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Modal } from "../ui/modal.js";
import { Select } from "../ui/select.js";
import { Text } from "../ui/text.js";
import { QUICK_TASK_TEXT as T } from "./text/quick-task.js";

export interface QuickTaskModalProps {
  /** The project the task will belong to, whose agents are offered. It comes from the calling screen
   *  and not an internal `useProject()`: a popup reading the URL cannot mount in a story or a test
   *  without a router, for information the caller already has. */
  project: Project | null;
  title: string;
  defaultName: string;
  /** The "approval gate" box at opening. Ticked from an issue (the work starts from a request written
   *  elsewhere, reread before closing), unticked from a review comment (the fix goes back into a PR
   *  that ALREADY is the place of review). */
  defaultGate: boolean;
  /** The origin, copied as is: what the agent will work on is not summarised. */
  preview: { label: string; body: string };
  /** The brief sent to the agent, which becomes `task.description`. */
  description: string;
  externalRef: ExternalRef;
  /** What running will cause on the origin side (the issue moves to "In Progress", the push updates
   *  the PR). A node and not a string: both sentences quote code. */
  hint: ReactNode;
  onClose: () => void;
}

export function QuickTaskModal({
  project,
  title,
  defaultName,
  defaultGate,
  preview,
  description,
  externalRef,
  hint,
  onClose,
}: QuickTaskModalProps) {
  const { data: boot } = useQuery(bootstrapQuery);
  const qc = useQueryClient();
  const agents = (boot?.agents ?? []).filter((a) => !project || a.projectId === project.id);
  const [name, setName] = useState(defaultName);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [gate, setGate] = useState(defaultGate);
  const [runNow, setRunNow] = useState(true);
  const [error, setError] = useState("");
  // The first agent while none is chosen AND while the chosen one still exists: the list arrives
  // AFTER the first render (bootstrap), so `agentId` is empty at opening.
  const effectiveAgent = agents.some((a) => a.id === agentId) ? agentId : (agents[0]?.id ?? "");

  const create = async () => {
    if (!project || !effectiveAgent) return;
    try {
      const task = await tasksApi.createTask({
        name: name.trim(),
        description,
        projectId: project.id,
        agentId: effectiveAgent,
        approvalGate: gate,
        externalRef,
        // Unticking "Run now" must perform the SAME gesture as the composer's "Save for later"
        // button, not merely skip the following `runTask`: without `status: later` the server falls
        // back on `todo` and the pump takes the task within 30 s, with no human having clicked Run.
        ...(runNow ? {} : { status: TASK_STATUS.later }),
      });
      // A refused run KEEPS the popup open. Both original versions set the message then called
      // `onClose()` right after, unconditionally: the "task created but run refused" sentence was in
      // both catalogs and never once showed. Yet that is exactly when the operator must read
      // something: their task EXISTS, only the start failed, and a closing popup suggests otherwise,
      // so they create a second one.
      const refusal = runNow
        ? await tasksApi
            .runTask(task.id)
            .then(() => null)
            .catch((e: Error) => T.launchRefused(e.message))
        : null;
      // Awaited (16/09, not `void`ed): the button spins until the board has the task, not only until
      // the HTTP answer (D2, spec 2jan8IZn61).
      await qc.invalidateQueries({ queryKey: qk.tasks });
      if (refusal) {
        setError(refusal);
        return;
      }
      onClose();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{T.cancel}</Button>
          <Spacer />
          <Button
            variant="primary"
            leading={<Plus size={12} />}
            onClick={create}
            disabled={!name.trim() || !effectiveAgent}
          >
            {T.create(runNow ? T.andRun : "")}
          </Button>
        </>
      }
    >
      <Stack gap={12}>
        {/* data-autofocus: initial focus goes to the field, not the close cross. Without it
            useDialogA11y takes the header's first focusable and its "Close" tooltip shows at opening
            (07/09). */}
        <Field label={T.taskField} required>
          <Input data-autofocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <CodeBlock variant="preview" label={preview.label}>
          {preview.body}
        </CodeBlock>
        <Row gap={12} wrap align="flex-end">
          <Field label={T.agentField} required>
            <Select value={effectiveAgent} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox checked={gate} onChange={setGate}>
            {T.gate}
          </Checkbox>
          <Checkbox checked={runNow} onChange={setRunNow}>
            {T.runNow}
          </Checkbox>
        </Row>
        <Text tone="muted" size="sm" as="p">
          {hint}
        </Text>
        {error && <FormError>{error}</FormError>}
      </Stack>
    </Modal>
  );
}
