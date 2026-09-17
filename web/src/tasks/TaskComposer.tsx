// TaskComposer, a COMPOUND component (Vercel composition patterns): a provider holds state and
// actions, subcomponents read them through context (React 19 `use()`), and each variant (dashboard
// bar / ⌘K modal) explicitly composes the pieces it needs. Single source of "how a task is run";
// these fields used to be copied in the Launcher, the Issues modal and the Reviews modal.
//
// A composer that PROPOSES (operator decision, 23/08): the human writes TITLE + BRIEF and only picks
// run / later. Agent or chain, complexity and gate are PROPOSED by /api/tasks/classify (haiku control
// call, ~1 s, guaranteed fallback) and shown as chips under the field. The selectors are folded under
// "Settings", PREFILLED by the proposal: touching one takes over (proposals stop). Inform without
// forbidding. Never an inbox in this flow.
//
// This module ASSEMBLES (06/09): the contract is in `task-composer-context.ts`, the proposal in
// `use-classify-proposal.ts`, the three exits in `use-task-submit.ts`, the controls in
// `task-composer-parts.tsx`. The provider only keeps what none of them owns: current project, input
// and attachments.
import { useId, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { bootstrapQuery, qk } from "../queries.js";
import { readLastProjectId, useProject } from "../projects/project.js";
import { usePickedAttachments } from "./use-picked-attachments.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Field, FormRow } from "../ui/form.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "../ui/modal.js";
import {
  ComposerCtx,
  useComposer,
  type ComposerValue,
  type Level,
} from "./task-composer-context.js";
import { useClassifyProposal } from "./use-classify-proposal.js";
import { useTaskSubmit } from "./use-task-submit.js";
import * as Parts from "./task-composer-parts.js";
import { COMPOSER_TEXT } from "./text/composer.js";
import { TASK_SETTINGS_TEXT } from "./text/settings.js";
import { UI_TEXT } from "../ui/vocabulary.js";

/** What belongs to the open project. While no project is chosen (global dashboard, ⌘K on first run),
 *  everything is offered: filtering on nothing would yield nothing. */
function ofProject<T extends { projectId: string }>(
  list: T[] | undefined,
  project: { id: string } | null,
): T[] {
  return (list ?? []).filter((x) => !project || x.projectId === project.id);
}

function Provider({ onLaunched, children }: { onLaunched?: () => void; children: ReactNode }) {
  const { data: boot } = useQuery(bootstrapQuery);
  const { project: routeProject } = useProject();
  const qc = useQueryClient();
  const projects = boot?.projects ?? [];
  // The whole fleet, read once: the composer takes the open project's agents from it, and running
  // needs the others to find a chain's agent.
  const allAgents = boot?.agents ?? [];
  // On a project page the project comes from the URL and is fixed. Otherwise (dashboard, ⌘K) it is picked.
  const [pickedId, setPickedId] = useState<string | null>(() => readLastProjectId());
  const project = routeProject ?? projects.find((p) => p.id === pickedId) ?? projects[0] ?? null;
  const scoped = Boolean(routeProject);
  const [text, setText] = useState("");
  const [detail, setDetail] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [priority, setPriority] = useState<Level>("med");
  const [readOnly, setReadOnly] = useState(false);
  // Picked files live in `use-picked-attachments.ts` since 16/09: an inbox answer now attaches its
  // captures the same way.
  const files = usePickedAttachments();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const detailId = useId();
  const settingsId = useId();

  const agents = ofProject(allAgents, project);
  const templates = ofProject(boot?.templates, project);
  // `demo` and not `readOnly`: the demo project's read-only mode (nothing runs) is not a TASK's (v53,
  // repos cloned read-only). Two concepts, two names.
  const demo = Boolean(project?.demo);

  const proposal = useClassifyProposal({ project, demo, text, detail, agents, templates });
  const canLaunch = Boolean(text.trim() && project && proposal.effectiveMode) && !demo;
  const canDiscuss = Boolean(text.trim() && project) && !demo;

  const reset = () => {
    setText("");
    setDetail("");
    setDetailOpen(false);
    setSettingsOpen(false);
    setReadOnly(false);
    setPriority("med");
    files.clear();
    proposal.reset();
    void qc.invalidateQueries({ queryKey: qk.tasks });
  };

  const run = useTaskSubmit({
    project,
    allAgents,
    text,
    detail,
    effectiveMode: proposal.effectiveMode,
    isTemplate: proposal.isTemplate,
    gate: proposal.gate,
    readOnly,
    complexity: proposal.complexity,
    priority,
    proposal: proposal.value,
    attachments: files.picked,
    canLaunch,
    canDiscuss,
    reset,
    onLaunched,
  });

  const value: ComposerValue = {
    state: {
      text,
      mode: proposal.mode,
      gate: proposal.gate,
      complexity: proposal.complexity,
      priority,
      readOnly,
      effectiveMode: proposal.effectiveMode,
      isTemplate: proposal.isTemplate,
      detail,
      detailOpen,
      detailId,
      settingsOpen,
      settingsId,
      attachments: files.picked,
      attachmentRefusal: files.refusal,
      attachmentsBusy: files.busy,
    },
    proposal: { value: proposal.value, pending: proposal.pending, pinned: proposal.pinned },
    actions: {
      setText,
      setMode: proposal.setMode,
      setGate: proposal.setGate,
      setReadOnly,
      setComplexity: proposal.setComplexity,
      setPriority,
      setDetail,
      addAttachments: files.add,
      removeAttachment: files.remove,
      toggleDetail: () => setDetailOpen((v) => !v),
      toggleSettings: () => setSettingsOpen((v) => !v),
      launch: run.launch,
      defer: run.defer,
      discuss: run.discuss,
    },
    meta: {
      agents,
      templates,
      pending: run.pending,
      canLaunch,
      project,
      projects,
      scoped,
      canDiscuss,
      discussing: run.discussing,
      // Changing project invalidates pins: they pointed at the old project's agents.
      setPicked: (id: string) => {
        setPickedId(id);
        proposal.resetForProject();
      },
      demo,
    },
  };
  return <ComposerCtx value={value}>{children}</ComposerCtx>;
}

export const TaskComposer = {
  Provider,
  Name: Parts.Name,
  Detail: Parts.Detail,
  Attachments: Parts.Attachments,
  DetailToggle: Parts.DetailToggle,
  SettingsToggle: Parts.SettingsToggle,
  Settings: Parts.Settings,
  Proposal: Parts.Proposal,
  ProjectSelect: Parts.ProjectSelect,
  AgentSelect: Parts.AgentSelect,
  Complexity: Parts.Complexity,
  Priority: Parts.Priority,
  Gate: Parts.Gate,
  ReadOnly: Parts.ReadOnly,
  Defer: Parts.Defer,
  Discuss: Parts.Discuss,
  Submit: Parts.Submit,
};

/** Inline bar of the dashboard / board. */
export function LauncherBar() {
  return (
    <TaskComposer.Provider>
      <Card>
        <LauncherBody />
      </Card>
    </TaskComposer.Provider>
  );
}

/** Split from `LauncherBar` only because one must be INSIDE the provider to know what is expanded:
 *  brief and settings take their own lines under the controls <Row>. */
function LauncherBody() {
  const { state } = useComposer();
  return (
    <Stack gap={8}>
      {/* `wrap` since 13/09, a no-op above the phone breakpoint. At 375px the seven controls were
        730px wide in a 340px card, and "Later", "Discuss first" and "Run" fell off screen with no
        scrolling container, so a task could not be run from a phone. */}
      <Row gap={9} wrap>
        {/* Only the free field grows: selectors keep their natural width. */}
        <Row flex={1} minWidth={180}>
          <TaskComposer.Name />
        </Row>
        <TaskComposer.ProjectSelect />
        <TaskComposer.DetailToggle />
        <TaskComposer.SettingsToggle />
        <TaskComposer.Defer />
        <TaskComposer.Discuss />
        <TaskComposer.Submit />
      </Row>
      {state.detailOpen && (
        <Stack gap={8}>
          <TaskComposer.Detail />
          <TaskComposer.Attachments />
        </Stack>
      )}
      <TaskComposer.Proposal />
      <TaskComposer.Settings />
    </Stack>
  );
}

/** ⌘K "Create a task" modal: same fields, stacked with labels. The modal keeps its selectors visible
 *  (one comes here to SET UP a task, not to type on the fly); they show the proposal and touching
 *  one takes over, exactly as in the bar. */
export function TaskComposerModal({ onClose }: { onClose: () => void }) {
  return (
    <TaskComposer.Provider onLaunched={onClose}>
      <ComposerModal onClose={onClose} />
    </TaskComposer.Provider>
  );
}

function ComposerModal({ onClose }: { onClose: () => void }) {
  const { state, meta } = useComposer();
  return (
    <Modal onClose={onClose}>
      <ModalHeader icon={<Play size={15} />}>{COMPOSER_TEXT.modal.title}</ModalHeader>
      <ModalBody>
        <Stack gap={13}>
          {/* Project field only outside a project; otherwise the URL fixes it. */}
          {!meta.scoped && (
            <Field label={COMPOSER_TEXT.project} required>
              <TaskComposer.ProjectSelect />
            </Field>
          )}
          <Field label={COMPOSER_TEXT.modal.task} required>
            <TaskComposer.Name focus />
          </Field>
          {/* Always visible in the modal; folding only makes sense in the board bar. */}
          <Field label={COMPOSER_TEXT.modal.brief}>
            <TaskComposer.Detail />
          </Field>
          <TaskComposer.Attachments />
          <TaskComposer.Proposal />
          {/* FormRow: three equal columns stacking under 700px. A <Row wrap> pushed priority to a
              new line as soon as the agent list grew. */}
          <FormRow>
            <Field label={COMPOSER_TEXT.modal.agent} required>
              <TaskComposer.AgentSelect />
            </Field>
            {/* A chain has neither complexity nor priority: labels go with the fields. */}
            {!state.isTemplate && (
              <>
                <Field label={TASK_SETTINGS_TEXT.fields.complexity}>
                  <TaskComposer.Complexity />
                </Field>
                <Field label={TASK_SETTINGS_TEXT.fields.priority}>
                  <TaskComposer.Priority />
                </Field>
              </>
            )}
          </FormRow>
          <Row gap={13} wrap>
            <TaskComposer.Gate />
            <TaskComposer.ReadOnly />
          </Row>
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button variant="quiet" onClick={onClose}>
          {UI_TEXT.cancel}
        </Button>
        <Spacer />
        <TaskComposer.Defer />
        <TaskComposer.Discuss />
        <TaskComposer.Submit />
      </ModalFooter>
    </Modal>
  );
}
