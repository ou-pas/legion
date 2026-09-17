import { useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Skull, Trash2, TriangleAlert } from "lucide-react";
import { goalsApi, type DodItem, type GoalFootprint } from "../api/goals.js";
import { goalFootprintQuery, goalQuery, qk } from "../queries.js";
import { useToast } from "../ui/toast.js";
import { Banner } from "../ui/banner.js";
import { Button } from "../ui/button.js";
import { Chip, StatusChip, Tag } from "../ui/chip.js";
import { ConfirmAction } from "../ui/confirm-action.js";
import { Empty } from "../ui/empty.js";
import { Row, Stack } from "../ui/flex.js";
import { Link } from "../ui/link.js";
import { List, ListItem, ListRow } from "../ui/list.js";
import { Num } from "../ui/num.js";
import { Page } from "../ui/page.js";
import { Panel, PanelHeader, PanelNote } from "../ui/panel.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Spinner } from "../ui/spinner.js";
import { SplitPane } from "../ui/split.js";
import { LOCALE } from "../ui/locale.js";
import { Caption, Text } from "../ui/text.js";
import { TASK_CHIP } from "../tasks/task-status.js";
import { ApproveGoalButton } from "./approve-goal-button.js";
import { GoalAside } from "./goal-aside.js";
import { GoalDodCard } from "./goal-dod-card.js";
import { GOAL_CHIP } from "./goal-status.js";
import { GOAL_TEXT, goalFootprintParts } from "./text.js";
import { GOAL_STATUS, LIVE_GOAL_STATUSES } from "../api/goals.js";

/** The orchestrator log does not speak a session's vocabulary: these are its own decisions. The
 *  payload's most telling field is rendered. */
function logLine(payload: Record<string, unknown>): string {
  const p = payload as {
    reason?: string;
    instruction?: string;
    why?: string;
    rail?: string;
    status?: string;
  };
  return String(
    p.reason ??
      p.instruction ??
      p.why ??
      p.rail ??
      p.status ??
      JSON.stringify(payload).slice(0, 160),
  );
}

/** A goal that takes nothing with it: no task, session, trace or artifacts folder. Deletion stays hard
 *  and recorded, but "0 tasks, 0 sessions" over seven lines is a form, not an announcement. */
function nothingToDelete(f: GoalFootprint): boolean {
  return (
    f.tasks === 0 &&
    f.sessions === 0 &&
    f.sessionEvents === 0 &&
    f.inbox === 0 &&
    f.reviewComments === 0 &&
    f.activity === 0 &&
    f.goalEvents === 0 &&
    !f.artifactsDir
  );
}

// oxlint-disable-next-line complexity -- an object page: one gesture per goal status (approve, pause, resume, stop, delete) and a `?? default` per footprint datum, which arrives later
export function GoalPage() {
  // Mounted under TWO routes (canonical /p/…/goals/$goalId, short /goals/$goalId that redirects): the
  // param is read without pinning either.
  const { goalId } = useParams({ strict: false }) as { goalId: string };
  const { data: goal } = useQuery(goalQuery(goalId));
  // Loaded apart from the goal: what deletion would destroy, the sessions delaying it (D5), the tasks
  // it frees elsewhere (D10). `enabled` on the id alone, never blocked by the goal's loading.
  const { data: footprintData } = useQuery(goalFootprintQuery(goalId));
  const qc = useQueryClient();
  const navigate = useNavigate();
  // `now` frozen at mount: Date.now() during render is impure (oxlint react/purity). A running goal
  // refreshes through react-query.
  // All hooks BEFORE the first `return`: a hook after an early return changes the hook count between
  // renders ("Rendered more hooks than during the previous render").
  const [now] = useState(() => Date.now());
  // The DoD edited before approval, scoped to the current goal: if `goalId` changes (navigating from
  // one draft to another), the edit must not leak onto the new goal, hence the `goalId` tag.
  const [dodEdit, setDodEdit] = useState<{ goalId: string; items: DodItem[] } | null>(null);
  const { push } = useToast();
  if (!goal)
    return (
      <Page>
        <Spinner label={GOAL_TEXT.page.loading} />
      </Page>
    );

  // Returns its promise, not `void`ed (16/09): pause/resume/kill switch spin until the goal shows its
  // new status, not just until the HTTP response (D2, spec 2jan8IZn61).
  const act = async (a: "pause" | "resume" | "kill") => {
    await goalsApi
      .goalAction(goal.id, a)
      .catch((e: Error) =>
        push({ tone: "bad", title: GOAL_TEXT.page.actionRefused[a], body: e.message }),
      );
    await qc.invalidateQueries({ queryKey: qk.goal(goal.id) });
  };
  const dod = dodEdit?.goalId === goal.id ? dodEdit.items : goal.dod;
  const approveDraft = async () => {
    await goalsApi
      .approveGoal(
        goal.id,
        dod.map((d) => ({ id: d.id, text: d.text })),
      )
      .catch((e: Error) =>
        push({ tone: "bad", title: GOAL_TEXT.page.actionRefused.approve, body: e.message }),
      );
    setDodEdit(null);
    await qc.invalidateQueries({ queryKey: qk.goal(goal.id) });
  };
  const elapsedMs = goal.startedAt
    ? (goal.endedAt ? Date.parse(goal.endedAt) : now) - Date.parse(goal.startedAt)
    : 0;
  const drift = goal.plan.length > 0 && goal.iterations > goal.plan.length;

  // Deletion (D1-D12): hard, irreversible, recorded by the server. The button and its announcements
  // only appear once we KNOW what goes (a guessed footprint would lie).
  const footprint = footprintData?.footprint;
  const live = footprintData?.live ?? [];
  const unblocks = footprintData?.unblocks ?? [];
  const committing = live.filter((s) => s.status === "committing");
  const footprintEmpty = footprint !== undefined && nothingToDelete(footprint);
  const deleteParts = footprint ? goalFootprintParts(footprint) : [];
  const removeGoal = async () => {
    await goalsApi
      .deleteGoal(goal.id)
      .then((r) => {
        push({
          tone: "ok",
          title: GOAL_TEXT.page.deleted(r.deleted),
          body: GOAL_TEXT.page.deletedBody(deleteParts),
        });
        void navigate({ to: "/p/$projectId/goals", params: { projectId: goal.projectId } });
      })
      .catch((e: Error) =>
        push({ tone: "bad", title: GOAL_TEXT.page.deleteRefused, body: e.message }),
      );
  };

  return (
    <Page
      object
      title={
        <>
          {goal.name}
          <StatusChip state={GOAL_CHIP[goal.status]}>{goal.status}</StatusChip>
          {goal.mock && <Chip>{GOAL_TEXT.mock}</Chip>}
        </>
      }
      actions={
        <Row gap={6}>
          {goal.status === GOAL_STATUS.draft && <ApproveGoalButton onApprove={approveDraft} />}
          {goal.status === GOAL_STATUS.active && (
            <Button leading={<Pause size={13} />} onClick={() => act("pause")}>
              {GOAL_TEXT.page.pause}
            </Button>
          )}
          {goal.status === GOAL_STATUS.paused && (
            <Button leading={<Play size={13} />} onClick={() => act("resume")}>
              {GOAL_TEXT.page.resume}
            </Button>
          )}
          {/* Two-step kill switch in place: stopping a goal does not deserve a modal, but must not
            happen on a careless click. */}
          {LIVE_GOAL_STATUSES.includes(goal.status) && (
            <ConfirmAction
              label={GOAL_TEXT.page.kill}
              leading={<Skull size={13} />}
              confirmLabel={GOAL_TEXT.page.killConfirm}
              announce={GOAL_TEXT.page.killAnnounce(goal.name)}
              onConfirm={() => act("kill")}
            />
          )}
          {/* Delete, right of the kill switch (D8), once the footprint is known. D5: a session still
            pushing its branch removes the button rather than disabling it (a `title` does not show
            on a `disabled` element); the reason reads right next to it. */}
          {footprint &&
            (committing.length > 0 ? (
              <Text size="sm" tone="wait">
                {GOAL_TEXT.page.deleteBlocked(committing)}
              </Text>
            ) : (
              <ConfirmAction
                variant="danger"
                label={GOAL_TEXT.page.delete}
                leading={<Trash2 size={13} />}
                confirmLabel={GOAL_TEXT.page.deleteConfirm(deleteParts)}
                announce={GOAL_TEXT.page.deleteAnnounce(goal.name, deleteParts)}
                onConfirm={() => removeGoal()}
              />
            ))}
        </Row>
      }
    >
      {/* A `draft` did not say it was waiting: DoD, plan and rails showed, nothing ran, and the
          operator concluded it was broken (03/09). The `gate` tone means "awaiting a human
          decision", as everywhere else in the app. */}
      {goal.status === GOAL_STATUS.draft && (
        <Banner tone="gate" title={GOAL_TEXT.page.draftPending}>
          {GOAL_TEXT.page.draftPendingWhy}
        </Banner>
      )}
      {/* What deletion would take, announced BEFORE the click (D9, D10, D12). The common case (a
          never-approved `draft`) is one sentence; otherwise the footprint is named, and so are the
          tasks unblocked ELSEWHERE (D10). */}
      {footprint && (
        <Stack gap={4}>
          <Text size="sm" tone="muted">
            {footprintEmpty
              ? GOAL_TEXT.page.deleteEmpty
              : GOAL_TEXT.page.deleteSummary(deleteParts)}
          </Text>
          {unblocks.length > 0 && (
            <Text size="sm" tone="wait">
              {GOAL_TEXT.page.unblocksNote(unblocks)}
            </Text>
          )}
        </Stack>
      )}
      {/* Content on the left, what can stop the goal on the right. */}
      <SplitPane
        label={GOAL_TEXT.page.railsLabel}
        main={
          <Stack gap={12}>
            <GoalDodCard
              goal={goal}
              items={dod}
              onChange={(items) => setDodEdit({ goalId: goal.id, items })}
            />

            {goal.plan.length > 0 && (
              <Panel>
                <PanelHeader title={GOAL_TEXT.page.plan(goal.plan.length)}>
                  {/* Plan vs actual: more iterations than planned steps signals drift */}
                  {drift && (
                    <StatusChip state="wait" dot={false}>
                      <TriangleAlert size={11} aria-hidden="true" />
                      {GOAL_TEXT.page.drift(goal.iterations)}
                    </StatusChip>
                  )}
                </PanelHeader>
                <List as="ol" density="compact" label={GOAL_TEXT.page.planLabel}>
                  {goal.plan.map((p, i) => (
                    <ListRow
                      key={i}
                      as="li"
                      leading={<Num value={i + 1} tone="subtle" />}
                      meta={<Tag>{p.agentName}</Tag>}
                    >
                      {p.step}
                    </ListRow>
                  ))}
                </List>
                <PanelNote>{GOAL_TEXT.page.planNote}</PanelNote>
              </Panel>
            )}

            <Panel>
              <PanelHeader title={GOAL_TEXT.page.tasks(goal.tasks.length)} />
              {goal.tasks.length === 0 ? (
                <Empty variant="panel" title={GOAL_TEXT.page.noTask}>
                  {GOAL_TEXT.page.noTaskWhy}
                </Empty>
              ) : (
                <List label={GOAL_TEXT.page.tasksLabel}>
                  {goal.tasks.map((t) => (
                    <Link
                      key={t.id}
                      variant="inherit"
                      render={(p) => (
                        <RouterLink
                          to="/p/$projectId/tasks/$taskId"
                          params={{ projectId: goal.projectId, taskId: t.id }}
                          {...p}
                        />
                      )}
                    >
                      <ListItem
                        interactive
                        title={t.name}
                        meta={<StatusChip state={TASK_CHIP[t.status]}>{t.status}</StatusChip>}
                      />
                    </Link>
                  ))}
                </List>
              )}
            </Panel>

            <Panel>
              <PanelHeader title={GOAL_TEXT.page.log} />
              {goal.events.length === 0 ? (
                <Empty variant="panel" title={GOAL_TEXT.page.logEmpty}>
                  {GOAL_TEXT.page.logEmptyWhy}
                </Empty>
              ) : (
                <ScrollArea size="md" label={GOAL_TEXT.page.log}>
                  <List density="compact" label={GOAL_TEXT.page.logLabel}>
                    {[...goal.events].reverse().map((e) => (
                      <ListRow
                        key={e.id}
                        leading={<Caption>{new Date(e.ts).toLocaleTimeString(LOCALE)}</Caption>}
                      >
                        <Tag>{e.type}</Tag>
                        <Text size="xs" tone="muted">
                          {logLine(e.payload)}
                        </Text>
                      </ListRow>
                    ))}
                  </List>
                </ScrollArea>
              )}
            </Panel>
          </Stack>
        }
        aside={<GoalAside goal={goal} elapsedMs={elapsedMs} />}
      />
    </Page>
  );
}
