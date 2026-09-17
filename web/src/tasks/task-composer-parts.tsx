// The composer's PIECES, bare controls: each variant decides whether to dress them (Field, Row…).
// They read only the context, never data props, which lets the board bar and the ⌘K modal place
// them in two geometries without duplicating them.
//
// <Select>s sit in a <Row>: a design system select is 100% wide, so it fills its <Field> in the
// modal and keeps its natural width in the bar, without the variant knowing the control geometry.
import {
  ChevronDown,
  ChevronRight,
  Clock,
  MessagesSquare,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import { INTERVIEW_TEXT } from "../interviews/text.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/choice.js";
import { Row } from "../ui/flex.js";
import { Input, Textarea } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { isSubmitKey } from "../ui/submit-key.js";
import { SubmitShortcut } from "../ui/submit-shortcut.js";
import { Tooltip } from "../ui/tooltip.js";
import { BriefAttachments } from "./brief-attachments.js";
import { TaskProposal } from "./task-proposal.js";
import { useComposer, type Level } from "./task-composer-context.js";
import { nothingLeftToPropose } from "./use-classify-proposal.js";
import { COMPOSER_TEXT as T } from "./text/composer.js";
import { TASK_SETTINGS_TEXT } from "./text/settings.js";
import { TASK_TEXT } from "./text/vocabulary.js";

/** `focus` marks the field as a modal's initial focus target (see useDialogA11y): the dashboard bar
 *  does not steal focus on page load, the modal sets it here.
 *
 *  Plain Enter no longer runs (07/09): running means an agent, a container and cost, and a title
 *  typed on the fly ended up launched by a stray line break. ⌘/Ctrl+Enter runs, as the inbox sends
 *  (ui/submit-key.ts); the hint sits on the button, in <Submit>. */
export function Name({ focus = false }: { focus?: boolean }) {
  const { state, actions } = useComposer();
  return (
    <Input
      type="text"
      value={state.text}
      aria-label={T.name}
      placeholder={T.namePlaceholder}
      data-autofocus={focus ? "true" : undefined}
      onChange={(e) => actions.setText(e.target.value)}
      onKeyDown={(e) => {
        if (isSubmitKey(e)) actions.launch();
      }}
    />
  );
}

/** The brief, in plain words. The title names the task; THIS is the instruction. An agent does not
 *  read between the lines of a title: what is not written here is not asked for.
 *
 *  ⌘/Ctrl+Enter runs, like the title (D1, 15/09): both fields write the same data
 *  (`task.description`), and the brief is written last. `actions.launch` already carries its own
 *  guard (`input.canLaunch && !submit.isPending`, use-task-submit.ts). */
export function Detail() {
  const { state, actions } = useComposer();
  return (
    <Textarea
      id={state.detailId}
      rows={6}
      value={state.detail}
      aria-label={T.brief}
      placeholder={T.briefPlaceholder}
      onChange={(e) => actions.setDetail(e.target.value)}
      onKeyDown={(e) => {
        if (isSubmitKey(e)) actions.launch();
      }}
    />
  );
}

/** Brief attachments BEFORE the task exists: they stay in memory and only upload after creation (see
 *  `useTaskSubmit`). Same component as a posted task's Brief view, without `urlOf` since they are
 *  nowhere yet and have no preview. */
export function Attachments() {
  const { state, actions } = useComposer();
  return (
    <BriefAttachments
      attachments={state.attachments}
      onAdd={actions.addAttachments}
      onRemove={actions.removeAttachment}
      busy={state.attachmentsBusy}
      refusal={state.attachmentRefusal}
    />
  );
}

/** The button expanding the brief in the board bar. Counts characters while folded: a brief written
 *  then hidden must not look absent, and attachments in the same fold count with it. */
export function DetailToggle() {
  const { state, actions } = useComposer();
  const written = state.detail.trim().length;
  const joined = state.attachments.length;
  const label = [
    written > 0 ? T.briefChars(written) : null,
    joined > 0 ? T.briefFiles(joined) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Button
      variant="quiet"
      onClick={actions.toggleDetail}
      aria-expanded={state.detailOpen}
      aria-controls={state.detailId}
      leading={state.detailOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    >
      {label ? `${T.briefToggle} · ${label}` : T.briefToggle}
    </Button>
  );
}

/** Settings, folded by default: the proposal prefills them, touching one takes over. */
export function SettingsToggle() {
  const { state, proposal, actions } = useComposer();
  const pins =
    Number(proposal.pinned.target) +
    Number(proposal.pinned.complexity) +
    Number(proposal.pinned.gate);
  return (
    <Button
      variant="quiet"
      onClick={actions.toggleSettings}
      aria-expanded={state.settingsOpen}
      aria-controls={state.settingsId}
      leading={<SlidersHorizontal size={13} />}
    >
      {pins > 0 ? T.settingsPinned(pins) : T.settingsToggle}
    </Button>
  );
}

/** The proposal line: what WILL BE SENT on launch, and where it comes from. Only rendered with a
 *  title: proposing on nothing would be noise. */
export function Proposal() {
  const { state, proposal, meta } = useComposer();
  if (!state.text.trim() || meta.demo) return null;
  const agentName = meta.agents.find((a) => a.id === state.effectiveMode)?.name;
  const chainName = state.isTemplate
    ? meta.templates.find((t) => `tpl:${t.id}` === state.effectiveMode)?.name
    : undefined;
  const name = chainName ?? agentName ?? "—";
  const allPinned = nothingLeftToPropose(proposal.pinned, state.isTemplate);
  return (
    <TaskProposal
      pending={proposal.pending && !allPinned}
      manual={allPinned}
      pinned={proposal.pinned}
      kind={state.isTemplate ? "chain" : "agent"}
      name={name}
      complexity={state.complexity}
      gate={state.gate}
      reason={allPinned ? null : (proposal.value?.reason ?? null)}
    />
  );
}

/** Project picker, visible ONLY outside a project (global dashboard, ⌘K). On a project page the
 *  project comes from the URL. */
export function ProjectSelect() {
  const { meta } = useComposer();
  if (meta.scoped) return null;
  return (
    <Row>
      <Select
        value={meta.project?.id ?? ""}
        aria-label={T.project}
        title={T.project}
        onChange={(e) => meta.setPicked(e.target.value)}
      >
        {meta.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </Row>
  );
}

export function AgentSelect() {
  const { state, actions, meta } = useComposer();
  return (
    <Row>
      <Select
        value={state.effectiveMode}
        aria-label={T.agent}
        onChange={(e) => actions.setMode(e.target.value)}
      >
        <optgroup label={T.agentGroup}>
          {meta.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </optgroup>
        {meta.templates.length > 0 && (
          <optgroup label={T.chainGroup}>
            {meta.templates.map((t) => (
              <option key={t.id} value={`tpl:${t.id}`}>
                {T.chainSteps(t.name, t.steps.length)}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
    </Row>
  );
}

// Complexity/Priority/Gate mean nothing for a chain, so they hide themselves.
export function Complexity() {
  const { state, actions } = useComposer();
  if (state.isTemplate) return null;
  return (
    <Row>
      <Select
        value={state.complexity}
        aria-label={TASK_SETTINGS_TEXT.fields.complexity}
        title={T.complexityWhy}
        onChange={(e) => actions.setComplexity(e.target.value as Level)}
      >
        <option value="low">{TASK_TEXT.complexity.low}</option>
        <option value="med">{TASK_TEXT.complexity.med}</option>
        <option value="high">{TASK_TEXT.complexity.high}</option>
      </Select>
    </Row>
  );
}

export function Priority() {
  const { state, actions } = useComposer();
  if (state.isTemplate) return null;
  return (
    <Row>
      <Select
        value={state.priority}
        aria-label={TASK_SETTINGS_TEXT.fields.priority}
        title={T.priorityWhy}
        onChange={(e) => actions.setPriority(e.target.value as Level)}
      >
        {/* `priority` and not `priorityShort` (16/09): the priority select sits NEXT TO the
            complexity one, neither with a visible label, and both showed "normal". The catalog
            naming priority mid-sentence lifts the ambiguity. `TaskSettings` keeps the short words:
            its three buttons sit under a "Priority" heading that already says it. */}
        <option value="high">{TASK_TEXT.priority.high}</option>
        <option value="med">{TASK_TEXT.priority.med}</option>
        <option value="low">{TASK_TEXT.priority.low}</option>
      </Select>
    </Row>
  );
}

export function Gate() {
  const { state, actions } = useComposer();
  if (state.isTemplate) return null;
  return (
    <Checkbox checked={state.gate} onChange={actions.setGate}>
      {TASK_SETTINGS_TEXT.fields.gate}
    </Checkbox>
  );
}

/** v53, read-only task: audit, validation, survey. The agent reads and reports in artifacts; repos
 *  are cloned read-only, nothing is pushed, no PR opens. */
export function ReadOnly() {
  const { state, actions } = useComposer();
  if (state.isTemplate) return null;
  return (
    <Tooltip label={T.readOnlyWhy}>
      <Checkbox checked={state.readOnly} onChange={actions.setReadOnly}>
        {TASK_SETTINGS_TEXT.fields.readOnly}
      </Checkbox>
    </Tooltip>
  );
}

/** The settings row, expanded: the same controls as before the proposal. Nothing was removed, they
 *  just stopped being a toll on every task's path. */
export function Settings() {
  const { state } = useComposer();
  if (!state.settingsOpen) return null;
  // Bare <div id>: Row carries no id, and this is the aria-controls TARGET, not styling.
  return (
    <div id={state.settingsId}>
      <Row gap={9} wrap>
        <AgentSelect />
        <Complexity />
        <Priority />
        <Gate />
        <ReadOnly />
      </Row>
    </div>
  );
}

/** "Run", with the shortcut hint on the button itself (12/09). It used to sit beside it as a separate
 *  caption, read as a second ghost button. */
export function Submit() {
  const { actions, meta } = useComposer();
  // A demo project runs nothing: announcing a shortcut with no effect would be a lie.
  const button = (
    <Button
      variant="primary"
      leading={<Play size={13} />}
      // `loading` keeps the button width while running: the label does not jump.
      loading={meta.pending}
      disabled={!meta.canLaunch}
      onClick={actions.launch}
      shortcut={meta.demo ? undefined : <SubmitShortcut />}
    >
      {T.run}
    </Button>
  );
  if (meta.demo) return <Tooltip label={T.demoWhy}>{button}</Tooltip>;
  return button;
}

/** Save without running. Absent for a chain: instantiating a template runs its step 1, so a chain
 *  "on hold" means nothing while its steps do not exist. */
export function Defer() {
  const { state, actions, meta } = useComposer();
  if (state.isTemplate) return null;
  return (
    <Tooltip label={T.laterWhy}>
      <Button
        leading={<Clock size={13} />}
        disabled={!meta.canLaunch || meta.pending}
        onClick={actions.defer}
      >
        {T.later}
      </Button>
    </Tooltip>
  );
}

/** DISCUSS FIRST, next to "Run" because it is the same moment of decision: does this brief go as is,
 *  or should it be tested? Absent for a chain (one discusses the request before it, not the chain)
 *  and on a demo project. */
export function Discuss() {
  const { state, actions, meta } = useComposer();
  if (state.isTemplate || meta.demo) return null;
  return (
    <Tooltip label={INTERVIEW_TEXT.start.why}>
      <Button
        leading={<MessagesSquare size={13} />}
        loading={meta.discussing}
        disabled={!meta.canDiscuss}
        onClick={actions.discuss}
      >
        {INTERVIEW_TEXT.start.label}
      </Button>
    </Tooltip>
  );
}
