// Goal creation in two steps (generate the DoD → edit → approve → launch), in a modal shared by the ⌘K
// palette AND the Goals page. Same project scoping as TaskComposer: fixed by the URL on a project
// page, chosen on a global surface (⌘K).
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ListChecks } from "lucide-react";
import { goalsApi, type DodItem } from "../api/goals.js";
import { type Project } from "../api/projects.js";
import { bootstrapQuery, qk } from "../queries.js";
import { readLastProjectId, useProject } from "../projects/project.js";
import { Banner } from "../ui/banner.js";
import { Button } from "../ui/button.js";
import { Spacer, Stack } from "../ui/flex.js";
import { Field, FormError } from "../ui/form.js";
import { Select } from "../ui/select.js";
import { Modal } from "../ui/modal.js";
import { Text } from "../ui/text.js";
import { Tooltip } from "../ui/tooltip.js";
import { UI_TEXT } from "../ui/vocabulary.js";
import { ApproveGoalButton } from "./approve-goal-button.js";
import { DodEditor } from "./dod-editor.js";
import { GoalBriefFields } from "./goal-brief-fields.js";
import { GoalRailFields } from "./goal-rail-fields.js";
import { GOAL_TEXT } from "./text.js";

/** Project choice, only OUTSIDE a project (⌘K): under `/p/…` it comes from the URL, and a selector
 *  with one forced value chooses nothing. */
function ProjectField({
  scoped,
  projects,
  project,
  onPick,
}: {
  scoped: boolean;
  projects: Project[];
  project: Project | null;
  onPick: (id: string) => void;
}) {
  if (scoped) return null;
  return (
    <Field label={GOAL_TEXT.composer.project} required>
      <Select
        value={project?.id ?? ""}
        aria-label={GOAL_TEXT.composer.project}
        onChange={(e) => onPick(e.target.value)}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Second step: the goal exists (201), its DoD is edited before launch. The warning banner covers the
 *  server creating the goal without generating its DoD; without it an empty criteria form read as a
 *  screen bug. */
function DodStep({
  draft,
  onDod,
  error,
}: {
  draft: { id: string; dod: DodItem[]; warning?: string };
  onDod: (dod: DodItem[]) => void;
  error: Error | null;
}) {
  return (
    <Stack gap={10}>
      {draft.warning && (
        <Banner tone="bad" title={GOAL_TEXT.composer.dodFailed}>
          {draft.warning}
        </Banner>
      )}
      <Text size="sm" tone="muted">
        <ListChecks size={13} aria-hidden="true" /> {GOAL_TEXT.composer.dodIntro}
      </Text>
      <DodEditor items={draft.dod} onChange={onDod} />
      {error && <FormError>{GOAL_TEXT.composer.approveFailed(error.message)}</FormError>}
    </Stack>
  );
}

export function GoalComposerModal({ onClose }: { onClose: () => void }) {
  const { data: boot } = useQuery(bootstrapQuery);
  const { project: routeProject } = useProject();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const projects = boot?.projects ?? [];
  const [pickedId, setPickedId] = useState<string | null>(() => readLastProjectId());
  const project = routeProject ?? projects.find((p) => p.id === pickedId) ?? projects[0] ?? null;
  const scoped = Boolean(routeProject);

  const [name, setName] = useState("");
  const [request, setRequest] = useState("");
  const [budget, setBudget] = useState("");
  const [hours, setHours] = useState("");
  // `warning`: the goal was created but its DoD could not be generated (201 + `warning`). It lives
  // with the draft, since it is what explains an empty DoD on screen.
  const [draft, setDraft] = useState<{
    id: string;
    dod: DodItem[];
    projectId: string;
    warning?: string;
  } | null>(null);

  // 1) generate a provisional DoD from the request.
  const gen = useMutation({
    mutationFn: async () => {
      if (!project || !name.trim() || !request.trim())
        throw new Error(GOAL_TEXT.composer.missingFields);
      const res = await goalsApi.createGoal({
        projectId: project.id,
        name: name.trim(),
        request: request.trim(),
        budgetUsd: budget ? Number(budget) : undefined,
        maxHours: hours ? Number(hours) : undefined,
      });
      return { ...res, projectId: project.id };
    },
    onSuccess: (res) =>
      setDraft({
        id: res.id,
        dod: res.dod,
        projectId: res.projectId,
        ...(res.warning ? { warning: res.warning } : {}),
      }),
  });

  // 2) approve the (edited) DoD → launch the goal, then open its page.
  const approve = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error(GOAL_TEXT.composer.noDod);
      await goalsApi.approveGoal(
        draft.id,
        draft.dod.map((d) => ({ id: d.id, text: d.text })),
      );
      return { goalId: draft.id, projectId: draft.projectId };
    },
    onSuccess: ({ goalId, projectId }) => {
      void qc.invalidateQueries({ queryKey: qk.goals(projectId) });
      onClose();
      // The project is always known here: captured in `draft.projectId` at generation, already
      // checked by `gen.mutationFn` before creating the goal.
      void navigate({ to: "/p/$projectId/goals/$goalId", params: { projectId, goalId } });
    },
  });

  // Demo project = read-only: the orchestrator does not run, so no invitation to generate a DoD.
  const readOnly = Boolean(project?.demo);
  const canGen = Boolean(project && name.trim() && request.trim()) && !readOnly;

  const generate = (
    <Button
      variant="primary"
      trailing={<ArrowRight size={12} />}
      loading={gen.isPending}
      disabled={!canGen}
      onClick={() => {
        if (canGen && !gen.isPending) gen.mutate();
      }}
    >
      {gen.isPending ? GOAL_TEXT.composer.generating : GOAL_TEXT.composer.generate}
    </Button>
  );

  return (
    <Modal
      title={GOAL_TEXT.composer.title}
      onClose={onClose}
      width={560}
      footer={
        !draft ? (
          <>
            <Spacer />
            <Button onClick={onClose}>{UI_TEXT.cancel}</Button>
            {readOnly ? (
              <Tooltip label={GOAL_TEXT.composer.readOnly}>{generate}</Tooltip>
            ) : (
              generate
            )}
          </>
        ) : (
          <>
            <Spacer />
            <Button leading={<ArrowLeft size={12} />} onClick={() => setDraft(null)}>
              {GOAL_TEXT.composer.back}
            </Button>
            <ApproveGoalButton
              pending={approve.isPending}
              onApprove={() => {
                if (!approve.isPending) approve.mutate();
              }}
            />
          </>
        )
      }
    >
      {!draft ? (
        <Stack gap={12}>
          <ProjectField
            scoped={scoped}
            projects={projects}
            project={project}
            onPick={setPickedId}
          />
          {/* The SAME fields as the `draft` goal editor: creating and editing show one form. */}
          <GoalBriefFields
            autoFocus
            name={name}
            request={request}
            onName={setName}
            onRequest={setRequest}
          />
          <GoalRailFields budget={budget} hours={hours} onBudget={setBudget} onHours={setHours} />
          {gen.error && (
            <FormError>{GOAL_TEXT.composer.generateFailed(gen.error.message)}</FormError>
          )}
        </Stack>
      ) : (
        <DodStep draft={draft} onDod={(dod) => setDraft({ ...draft, dod })} error={approve.error} />
      )}
    </Modal>
  );
}
