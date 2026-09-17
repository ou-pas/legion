// Structural settings of a task not started yet: title, agent, approval gate, complexity, priority,
// exactly the fields `TaskComposer` sets at creation (server side: `task-edit.ts`). Before this
// module only the brief could be amended: a task noted with a typo in its title, or sent to the wrong
// agent, had one way out, deleting and recreating it.
//
// `task.editable` comes FROM THE SERVER (`task-serialize.ts`): this module never re-derives the rule.
// Do not extend the precedent of `allowedMove()` (`task-moves.ts`), which already copies a server
// transition rule; the two copies will drift one day.
//
// "Dirty form" pattern from `git-identity-card.tsx`: one `useState<T | null>(null)` per field, the
// server value shows through while nothing is typed. Required here because `tasksQuery` refetches
// the task periodically: a `useEffect` copying `task.*` into state would overwrite typing on every
// cycle (and oxlint forbids it: react/set-state-in-effect).
//
// It lives in the page's right panel since 04/09 (`task-inspector.tsx`, 340px): fields are STACKED,
// and a three-value choice is a button group, three words read at once, rather than a select that
// must be opened to see what it hides.
import { useState } from "react";
import { Check } from "lucide-react";
import { type Agent } from "../api/agents.js";
import { type ModelChoice } from "../api/models.js";
import { type Project } from "../api/projects.js";
import { type Session } from "../api/sessions.js";
import { tasksApi, type Task } from "../api/tasks.js";
import { ModelPicker } from "../models/model-picker.js";
import { Button, ButtonGroup, ToggleButton } from "../ui/button.js";
import { CardDescription } from "../ui/card.js";
import { Checkbox } from "../ui/choice.js";
import { Stack } from "../ui/flex.js";
import { Field, FormError } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { KeyValue, KeyValueList } from "../ui/key-value.js";
import { Select } from "../ui/select.js";
import { Caption } from "../ui/text.js";
import { TASK_SETTINGS_TEXT as T } from "./text/settings.js";
import { TASK_TEXT } from "./text/vocabulary.js";
import "./task-settings.css";

type Level = "low" | "med" | "high";
/** Exported (05/09): the runtime panel reads the settings back with the SAME words. */
export const COMPLEXITY_LABEL: Record<Level, string> = TASK_TEXT.complexity;
/** Deliberately not `TASK_TEXT.priority` ("high / normal / low priority"): here the three words are
 *  joined BUTTONS under a heading already saying "Priority", so prefixing them would repeat it.
 *  `TASK_TEXT.priorityShort` carries them, and the composer reads it too. */
export const PRIORITY_LABEL: Record<Level, string> = TASK_TEXT.priorityShort;
/** Button order: lightest to heaviest for complexity, lowest to highest for priority, the same
 *  reading direction in both groups. */
const COMPLEXITY_ORDER: readonly Level[] = ["low", "med", "high"];
const PRIORITY_ORDER: readonly Level[] = ["low", "med", "high"];

/** "Empty" says what it DOES (T.modelEmpty) rather than staying silent. A separate function to keep
 *  one more branch out of `TaskSettings`' complexity. */
function modelOverrideLabel(task: Task): string {
  return task.modelOverride ?? T.modelEmpty;
}

/** Why the settings are frozen, with the wording of `task-edit.ts`, so that the screen and the server
 *  refusal (were the screen to lie) tell the same story. */
function editReason(
  task: Task,
  demoProject: boolean,
  active: boolean,
  sessionStatus?: string,
): string {
  if (demoProject) return T.locked.demo;
  if (active) return T.locked.running(sessionStatus ?? "");
  return T.locked.started(task.status);
}

/** A three-value choice as joined buttons: the pressed state is the value. */
function LevelGroup({
  label,
  order,
  labels,
  value,
  onChange,
}: {
  label: string;
  order: readonly Level[];
  labels: Record<Level, string>;
  value: Level;
  onChange: (next: Level) => void;
}) {
  return (
    <ButtonGroup label={label} className="tsk-settings-levels">
      {order.map((level) => (
        <ToggleButton
          key={level}
          size="sm"
          pressed={value === level}
          onPressedChange={() => onChange(level)}
        >
          {labels[level]}
        </ToggleButton>
      ))}
    </ButtonGroup>
  );
}

/** The six editable fields of a task, as sent to the server. */
type EditableFields = {
  name: string;
  agentId: string;
  gate: boolean;
  readOnly: boolean;
  complexity: Level;
  priority: Level;
  /** "": no override, complexity routing picks the model. */
  model: string;
};

/** What the screen SHOWS: the draft where the operator touched, the task everywhere else. `null`
 *  means "untouched": the field then follows the task if it changes elsewhere. */
function shownFields(
  task: Task,
  draft: { [K in keyof EditableFields]: EditableFields[K] | null },
): EditableFields {
  return {
    name: draft.name ?? task.name,
    agentId: draft.agentId ?? task.assigneeAgentId ?? "",
    gate: draft.gate ?? task.approvalGate,
    readOnly: draft.readOnly ?? task.readOnly,
    complexity: draft.complexity ?? task.complexity,
    priority: draft.priority ?? task.priority,
    model: draft.model ?? task.modelOverride ?? "",
  };
}

/** Is there anything to save? Field by field, against the task as it is. */
function differsFromTask(task: Task, v: EditableFields): boolean {
  return (
    v.name !== task.name ||
    v.agentId !== (task.assigneeAgentId ?? "") ||
    v.gate !== task.approvalGate ||
    v.readOnly !== task.readOnly ||
    v.complexity !== task.complexity ||
    v.priority !== task.priority ||
    v.model !== (task.modelOverride ?? "")
  );
}

export function TaskSettings({
  task,
  agents,
  project,
  models = [],
  active,
  session,
  onSaved,
}: {
  task: Task;
  agents: Agent[];
  project?: Project;
  /** For the model override selector: empty until `GET /api/models` answers, as elsewhere
   *  (ModelPicker). */
  models?: ModelChoice[];
  active: boolean;
  session?: Session;
  onSaved: () => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [gate, setGate] = useState<boolean | null>(null);
  const [readOnly, setReadOnly] = useState<boolean | null>(null);
  const [complexity, setComplexity] = useState<Level | null>(null);
  const [priority, setPriority] = useState<Level | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const v = shownFields(task, { name, agentId, gate, readOnly, complexity, priority, model });
  const dirty = differsFromTask(task, v);
  // Mirror of the server guard (task-edit.ts, R2): only offer agents of the SAME project, otherwise
  // the screen would offer a choice the API refuses.
  const projectAgents = agents.filter((a) => a.projectId === task.projectId);

  const save = () => {
    const trimmed = v.name.trim();
    if (!trimmed || !v.agentId) return;
    setSaving(true);
    tasksApi
      .updateTask(task.id, {
        name: trimmed,
        agentId: v.agentId,
        approvalGate: v.gate,
        readOnly: v.readOnly,
        complexity: v.complexity,
        priority: v.priority,
        modelOverride: v.model || null,
      })
      .then(() => {
        setSaved(true);
        setErr("");
        setName(null);
        setAgentId(null);
        setGate(null);
        setReadOnly(null);
        setComplexity(null);
        setPriority(null);
        setModel(null);
        setTimeout(() => setSaved(false), 1500);
        onSaved();
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setSaving(false));
  };

  if (!task.editable) {
    // Absent + reason as visible text, never a greyed-out button with a native `title`, which does
    // not show on a disabled element (Chrome, Safari).
    return (
      <Stack gap={8}>
        <KeyValueList label={T.listLabel} density="compact">
          <KeyValue label={T.fields.name}>{task.name}</KeyValue>
          <KeyValue label={T.fields.agent}>
            {agents.find((a) => a.id === task.assigneeAgentId)?.name ?? T.noAgent}
          </KeyValue>
          <KeyValue label={T.fields.complexity}>{COMPLEXITY_LABEL[task.complexity]}</KeyValue>
          <KeyValue label={T.fields.priority}>{PRIORITY_LABEL[task.priority]}</KeyValue>
          <KeyValue label={T.fields.model}>{modelOverrideLabel(task)}</KeyValue>
          <KeyValue label={T.fields.gate}>{task.approvalGate ? T.yes : T.no}</KeyValue>
          <KeyValue label={T.fields.readOnly}>{task.readOnly ? T.yes : T.no}</KeyValue>
        </KeyValueList>
        <Caption tone="muted">
          {editReason(task, Boolean(project?.demo), active, session?.status)}
        </Caption>
      </Stack>
    );
  }

  const origin = task.templateRunId ? T.fromTemplate : task.goalId ? T.fromGoal : undefined;

  return (
    <Stack gap={12} className="tsk-settings">
      {origin && <CardDescription>{origin}</CardDescription>}
      {err && <FormError>{err}</FormError>}
      <Field label={T.fields.name} required>
        <Input value={v.name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={T.fields.agent} required>
        <Select value={v.agentId} onChange={(e) => setAgentId(e.target.value)}>
          {projectAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={T.fields.complexity}>
        <LevelGroup
          label={T.fields.complexity}
          order={COMPLEXITY_ORDER}
          labels={COMPLEXITY_LABEL}
          value={v.complexity}
          onChange={setComplexity}
        />
      </Field>
      <Field label={T.fields.priority}>
        <LevelGroup
          label={T.fields.priority}
          order={PRIORITY_ORDER}
          labels={PRIORITY_LABEL}
          value={v.priority}
          onChange={setPriority}
        />
      </Field>
      {/* The model OVERRIDE (v2c, nav), above complexity routing: a database column without a screen
          until then. Empty says what it does: routing takes over again. */}
      <Field label={T.fields.model}>
        <ModelPicker
          value={v.model}
          models={models}
          projectId={task.projectId}
          ariaLabel={T.fields.model}
          emptyLabel={T.modelEmpty}
          onChange={(id) => setModel(id)}
        />
      </Field>
      {/* Guardrails say what they do: a setting name alone ("Read-only") does not say what changes
          for the session; the line below says it, once. */}
      <Stack gap={4} className="tsk-settings-guards">
        <Checkbox checked={v.gate} onChange={setGate}>
          {T.fields.gate}
          <Caption className="tsk-settings-why">{T.guards.gateWhy}</Caption>
        </Checkbox>
        {/* v53, read-only: repositories cloned read-only, nothing pushed, no PR. */}
        <Checkbox checked={v.readOnly} onChange={setReadOnly}>
          {T.fields.readOnly}
          <Caption className="tsk-settings-why">{T.guards.readOnlyWhy}</Caption>
        </Checkbox>
      </Stack>
      <Button
        variant="primary"
        disabled={!dirty}
        loading={saving}
        className="tsk-settings-save"
        leading={saved ? <Check size={12} /> : undefined}
        onClick={save}
      >
        {saved ? T.saved : T.save}
      </Button>
    </Stack>
  );
}
