// Infra: the Docker machine fleet linked to tasks and goals (Phase 5a). Only the fleet since 02/09:
// version, identity, standup and webhooks live in System › General.
//
// Dense card since 02/09 (`docs/directions/direction-runners.html`, variant A, operator's call): a
// runner took ~40 lines (key-value list, three captioned fields, three measure sections, full-width
// volume inventory). The card takes nine: a head, four vitals aligned in a grid (places, VM,
// machine, disk; columns compare across machines), and the rest on demand behind two disclosures.
// Warnings never fold: an impossible reservation or a silent daemon shows without a gesture.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import {
  Box,
  Ghost,
  HardDrive,
  Network,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Server,
  Target,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import { infraQuery, qk } from "../queries.js";
import { infraApi, type InfraRunner } from "../api/infra.js";
import { RunnerConcurrency } from "./RunnerConcurrency.js";
import { CpusField, MemoryField } from "./RunnerResources.js";
import { RunnerCapacity } from "./runner-capacity.js";
import { RunnerDeclarePanel } from "./runner-declare.js";
import { RunnerHealthChip } from "./runner-health.js";
import { RunnerImageNotes } from "./runner-image-notes.js";
import { RunnerMetricsCells } from "./runner-metrics.js";
import { PlacesVital, Vitals, type Occupant } from "./runner-vitals.js";
import { sessionsApi } from "../api/sessions.js";
import { Banner } from "../ui/banner.js";
import { Button, IconBtn } from "../ui/button.js";
import { Chip, StatusChip, Tag } from "../ui/chip.js";
import { INFRA_TEXT } from "./text.js";
import { Code } from "../ui/code.js";
import { ConfirmAction } from "../ui/confirm-action.js";
import { Card } from "../ui/card.js";
import { Disclosure } from "../ui/disclosure.js";
import { Empty } from "../ui/empty.js";
import { ErrorState } from "../ui/error-state.js";
import { Row, Spacer } from "../ui/flex.js";
import { Link } from "../ui/link.js";
import { Page } from "../ui/page.js";
import { Panel, PanelHeader, PanelNote, PanelRow } from "../ui/panel.js";
import { SkeletonText } from "../ui/skeleton.js";
import { Text } from "../ui/text.js";
import "./infra-page.css";

export function InfraPage() {
  // Every 10 s on this page; elsewhere the badge makes do with infraQuery's 60 s.
  const { data, dataUpdatedAt, isLoading, error, refetch, isFetching } = useQuery({
    ...infraQuery,
    refetchInterval: 10_000,
  });
  // Declaring a machine (04/09): the form left the grid for a panel opened by this `+` next to
  // refresh. A gesture made once every six months no longer takes a runner card's place.
  const [declaring, setDeclaring] = useState(false);

  const refresh = (
    <Row gap={6}>
      <IconBtn title={INFRA_TEXT.declare.title} onClick={() => setDeclaring(true)}>
        <Plus size={14} />
      </IconBtn>
      <IconBtn title={INFRA_TEXT.page.refresh} onClick={() => void refetch()} loading={isFetching}>
        <RefreshCw size={14} />
      </IconBtn>
    </Row>
  );
  const declarePanel = declaring && <RunnerDeclarePanel onClose={() => setDeclaring(false)} />;

  if (isLoading) {
    return (
      <Page title="Runners" sub={INFRA_TEXT.intro} actions={refresh}>
        <Card>
          <SkeletonText lines={5} label={INFRA_TEXT.page.loading} />
        </Card>
        {declarePanel}
      </Page>
    );
  }

  if (!data) {
    return (
      <Page title="Runners" sub={INFRA_TEXT.intro} actions={refresh}>
        <ErrorState
          title={INFRA_TEXT.page.errorTitle}
          detail={error instanceof Error ? error.message : undefined}
          actions={
            <Button variant="primary" leading={<RefreshCw size={13} />} onClick={() => refetch()}>
              {INFRA_TEXT.page.retry}
            </Button>
          }
        >
          {INFRA_TEXT.page.errorBody}
        </ErrorState>
        {declarePanel}
      </Page>
    );
  }

  // After the `!data` guard, and not a hook: a derived value set higher up would read
  // `data.disabledRunners` on `undefined` while loading.
  const disabledOrphans = data.disabledRunners.reduce((n, r) => n + orphansOf(r), 0);

  return (
    <Page title="Runners" sub={INFRA_TEXT.intro} actions={refresh}>
      {declarePanel}
      {data.runners.length === 0 && (
        <Card>
          <Empty variant="panel" title={INFRA_TEXT.empty.title}>
            {INFRA_TEXT.empty.lead} <Code>ssh://</Code> {INFRA_TEXT.empty.tail}
          </Empty>
        </Card>
      )}
      {/* The grid only carries machines (04/09). `dataUpdatedAt` is the clock for relative ages:
          the instant of the displayed measure, without an impure `Date.now()` at render. */}
      <div className="ir-grid">
        {data.runners.map((r) => (
          <RunnerPanel key={r.runnerId} runner={r} now={dataUpdatedAt} />
        ))}
      </div>

      {/* All disabled runners, with the banner only on those that leave residue (08/09). The
          section used to list only runners with residue, so a clean disabled one appeared nowhere,
          and its re-enable button lives here: the "local" runner could only be turned back on with
          a manual PATCH. The orphan count, not the list length, accuses. Same card and cleanup
          button as the active fleet: `cleanupOrphans` never looked at `enabled`. */}
      {data.disabledRunners.length > 0 && (
        <>
          <Banner
            tone={disabledOrphans > 0 ? "bad" : "info"}
            title={
              disabledOrphans > 0 ? INFRA_TEXT.disabled.residueTitle : INFRA_TEXT.disabled.idleTitle
            }
          >
            {disabledOrphans > 0
              ? INFRA_TEXT.disabled.banner(data.disabledRunners.length)
              : INFRA_TEXT.disabled.idle(data.disabledRunners.length)}
          </Banner>
          <div className="ir-grid">
            {data.disabledRunners.map((r) => (
              <RunnerPanel key={r.runnerId} runner={r} now={dataUpdatedAt} disabled />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

/** What a runner still carries that cleanup would remove.
 *
 *  Volumes count (v52): the server deletes them in `cleanupOrphans`, so a button announcing "2
 *  orphans" and deleting 4 would lie. Out of `RunnerPanel` since 08/09 because the page asks the
 *  same question: this count, not the list length, decides the disabled runners' red banner. */
export function orphansOf(runner: InfraRunner): number {
  return (
    runner.containers.filter((c) => c.orphan).length +
    runner.networks.filter((n) => n.orphan).length +
    runner.volumes.filter((v) => v.orphan).length
  );
}

/** Row link to a task: routing stays in the page, style in the DS. Tolerates a missing project: a
 *  container or zombie whose project is unknown renders plain text, never a dead link. Same pattern
 *  as `PlacesVital` (runner-vitals.tsx). */
function TaskLink({
  taskId,
  projectId,
  label,
}: {
  taskId: string;
  projectId: string | null;
  label: string;
}) {
  if (!projectId) return <>{label}</>;
  return (
    <Link
      variant="plain"
      render={(p) => (
        <RouterLink to="/p/$projectId/tasks/$taskId" params={{ projectId, taskId }} {...p} />
      )}
    >
      {label}
    </Link>
  );
}

/** Row link to a container's goal: same tolerance as `TaskLink`, and the same `projectId` field.
 *  Batch B checked that a task setting `goalId` also sets `projectId: goal.projectId` in the same
 *  place, so one field feeds both links. */
function GoalLink({ goalId, projectId }: { goalId: string; projectId: string | null }) {
  const label = (
    <Row gap={4}>
      <Target size={12} />
      goal
    </Row>
  );
  if (!projectId) return label;
  return (
    <Link
      variant="plain"
      render={(p) => (
        <RouterLink to="/p/$projectId/goals/$goalId" params={{ projectId, goalId }} {...p} />
      )}
    >
      {label}
    </Link>
  );
}

/** Who occupies the places: running session containers, linked to their task. Service roles
 *  (proxy, shared browser, disk sentinel) do not count, they take no place. The project travels
 *  with the task (batch B): `PlacesVital` needs it to know whether the occupant is a link or text. */
function occupantsOf(runner: InfraRunner): Occupant[] {
  const seen = new Set<string>();
  const out: Occupant[] = [];
  for (const c of runner.containers) {
    if (c.role === "proxy" || c.role === "browser" || c.role === "disk-sentinel") continue;
    if (c.state !== "running" || !c.taskId || seen.has(c.taskId)) continue;
    seen.add(c.taskId);
    out.push({
      taskId: c.taskId,
      label: c.taskName ?? INFRA_TEXT.inventory.task,
      projectId: c.projectId ?? undefined,
    });
  }
  return out;
}

/** A gesture's refusal, as text under the card, never a greyed button. The server message ("live
 *  session", "sessions already in its name") is already a full sentence; a disabled button says
 *  none, and its native `title` does not even show. */
function FailureNote({
  failed,
  error,
  lead = "",
}: {
  failed: boolean;
  error: unknown;
  lead?: string;
}) {
  if (!failed) return null;
  return (
    <PanelNote tone="bad" icon={<TriangleAlert size={14} />}>
      {lead}
      {String((error as Error)?.message ?? error)}
    </PanelNote>
  );
}

/** The machine's Docker inventory, folded: a reading, not a gesture. The summary carries the orphan
 *  count as a tinted pill, so folded it already says whether there is cleaning to do. */
function InventoryFold({
  runner,
  cleaning,
  onCleanup,
}: {
  runner: InfraRunner;
  cleaning: boolean;
  onCleanup: () => void;
}) {
  const t = INFRA_TEXT.card;
  const orphans = orphansOf(runner);
  const objects = runner.containers.length + runner.networks.length + runner.volumes.length;
  const hash = runner.image.builtHash ?? runner.image.currentHash;
  return (
    <Disclosure
      flush
      className="ir-fold"
      summary={
        <Row gap={8} align="center">
          <span>{t.inventory(objects)}</span>
          {orphans > 0 && (
            <StatusChip state="bad" dot={false} size="sm">
              {t.orphans(orphans)}
            </StatusChip>
          )}
        </Row>
      }
    >
      <Row gap={8} align="center" className="ir-inv-head">
        <Text size="sm" tone="muted">
          {t.image}
        </Text>
        {runner.image.present ? (
          <Tag title={hash ?? undefined}>
            {hash ? hash.slice(0, 12) : INFRA_TEXT.inventory.imagePresent}
          </Tag>
        ) : (
          <Text tone="bad">{INFRA_TEXT.inventory.imageAbsent}</Text>
        )}
        <Spacer />
        {orphans > 0 && runner.available && (
          <ConfirmAction
            leading={<Trash2 size={13} />}
            disabled={cleaning}
            loading={cleaning}
            label={INFRA_TEXT.inventory.cleanup(orphans)}
            confirmLabel={INFRA_TEXT.inventory.cleanupConfirm}
            announce={INFRA_TEXT.inventory.cleanupAnnounce(orphans, runner.runnerName)}
            onConfirm={onCleanup}
          />
        )}
      </Row>

      {runner.available && runner.containers.length === 0 && (
        <PanelNote>
          {INFRA_TEXT.inventory.noContainersLead} <Code>legion-*</Code>{" "}
          {INFRA_TEXT.inventory.noContainersTail}
        </PanelNote>
      )}
      {/* Compact rows, not a table (mock-up variant A, 02/09): a five-column table got clipped in a
        430 px card. Each object says its type (icon), its name, and one owner: the task first, the
        goal otherwise, the role when nothing owns it (the shared browser and the proxy have no
        session, yet are never orphans, and the row must say why). */}
      {runner.available &&
        runner.containers.map((c) => (
          <PanelRow key={c.name} icon={<Box size={13} />}>
            <Code variant="bare" className="ir-inv-name">
              {c.name}
            </Code>
            <Spacer />
            {c.state === "running" && (
              <StatusChip state="run" size="sm">
                {INFRA_TEXT.inventory.running}
              </StatusChip>
            )}
            {c.taskId ? (
              <TaskLink
                taskId={c.taskId}
                projectId={c.projectId}
                label={c.taskName ?? INFRA_TEXT.inventory.task}
              />
            ) : c.goalId ? (
              <GoalLink goalId={c.goalId} projectId={c.projectId} />
            ) : c.role === "proxy" ? (
              <Chip size="sm">proxy</Chip>
            ) : c.role === "browser" ? (
              /* Shared service (v30): long-lived per runner, never an orphan; no session owns it,
             it serves those passing through. */
              <Chip size="sm">{INFRA_TEXT.inventory.browser}</Chip>
            ) : c.role === "disk-sentinel" ? (
              /* Same pattern (04/09): just carries an executable `df` so disk measurement works
             even on a runner with no active session. */
              <Chip size="sm">{INFRA_TEXT.inventory.diskSentinel}</Chip>
            ) : null}
            {c.orphan && (
              <StatusChip state="bad" dot={false} size="sm">
                {INFRA_TEXT.inventory.orphan}
              </StatusChip>
            )}
          </PanelRow>
        ))}

      {runner.networks.map((n) => (
        <PanelRow key={n.name} icon={<Network size={14} />}>
          <Code variant="bare">{n.name}</Code>
          <Spacer />
          {n.orphan && (
            <StatusChip state="bad" dot={false} size="sm">
              {INFRA_TEXT.inventory.orphan}
            </StatusChip>
          )}
        </PanelRow>
      ))}
      {/* Same row as networks, same verdict: docker objects cleanup removes, their name and fate,
        nothing more. */}
      {runner.volumes.map((v) => (
        <PanelRow key={v.name} icon={<HardDrive size={14} />}>
          <Code variant="bare">{v.name}</Code>
          <Spacer />
          {v.orphan && (
            <StatusChip state="bad" dot={false} size="sm">
              {INFRA_TEXT.inventory.orphan}
            </StatusChip>
          )}
        </PanelRow>
      ))}
    </Disclosure>
  );
}

function RunnerPanel({
  runner,
  now,
  disabled = false,
}: {
  runner: InfraRunner;
  now: number;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const cleanup = useMutation({
    mutationFn: () => infraApi.infraCleanup(runner.runnerId),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.infra }),
  });
  // The sweep runs by itself every 30 s; this button only saves waiting. It also invalidates tasks:
  // the unblocked task is what matters, not the infra row disappearing.
  const reap = useMutation({
    mutationFn: () => sessionsApi.reapSessions(),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.infra });
      void qc.invalidateQueries({ queryKey: qk.tasks });
    },
  });
  // Disable/re-enable/delete (web relay, 04/09): cleanup already runs server side in the same
  // gesture, so these mutations only refresh the card (it changes list, or disappears) and let the
  // 409 refusal come up as text, never as a greyed button (the native `title` does not show on a
  // disabled button).
  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) => infraApi.setRunnerEnabled(runner.runnerId, enabled),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.infra }),
  });
  const removeRunner = useMutation({
    mutationFn: () => infraApi.deleteRunner(runner.runnerId),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.infra }),
  });
  const t = INFRA_TEXT.card;

  return (
    <Panel>
      {/* The age once, in the head: it applied to every measure and was written three times. The
          health pill and the host stay: they are the machine's identity. */}
      <PanelHeader
        icon={<Server size={15} />}
        title={runner.runnerName}
        actions={
          <Row gap={8} align="center">
            {disabled ? (
              <>
                <IconBtn
                  title={INFRA_TEXT.lifecycle.enable}
                  loading={setEnabled.isPending}
                  onClick={() => setEnabled.mutate(true)}
                >
                  <Power size={13} />
                </IconBtn>
                {/* Visible on every disabled runner, even "local", which will always refuse with
                    409 (FK constraint, sessions already in its name): nothing on screen can predict
                    it, and the refusal reads as is rather than being guessed by a missing button. */}
                <ConfirmAction
                  size="sm"
                  variant="danger"
                  iconOnly
                  leading={<Trash2 size={13} />}
                  label={INFRA_TEXT.lifecycle.delete}
                  confirmLabel={INFRA_TEXT.lifecycle.deleteConfirm}
                  announce={INFRA_TEXT.lifecycle.deleteAnnounce(runner.runnerName)}
                  loading={removeRunner.isPending}
                  onConfirm={() => removeRunner.mutate()}
                />
              </>
            ) : (
              <ConfirmAction
                size="sm"
                variant="danger"
                iconOnly
                leading={<PowerOff size={13} />}
                label={INFRA_TEXT.lifecycle.disable}
                confirmLabel={INFRA_TEXT.lifecycle.disableConfirm}
                announce={INFRA_TEXT.lifecycle.disableAnnounce(runner.runnerName)}
                loading={setEnabled.isPending}
                onConfirm={() => setEnabled.mutate(false)}
              />
            )}
          </Row>
        }
      >
        {runner.dockerHost && <Tag>{runner.dockerHost}</Tag>}
        {disabled && <Chip size="sm">{INFRA_TEXT.disabled.tag}</Chip>}
        {/* The last answer's age is inside the pill (05/09): the sentence next to it pushed the
            header onto two lines whenever the host was long. */}
        <RunnerHealthChip available={runner.available} lastSeenAt={runner.lastSeenAt} now={now} />
      </PanelHeader>

      {/* Warning for a disabled local runner (05/09): it shares the control plane's disk and can
          fill it. A remote runner (dockerHost !== null) does not carry that risk. */}
      {disabled && !runner.dockerHost && (
        <PanelNote tone="wait" icon={<TriangleAlert size={14} />}>
          {INFRA_TEXT.lifecycle.localRunnerWarning}
        </PanelNote>
      )}

      <Vitals label={INFRA_TEXT.panel.vitals(runner.runnerName)}>
        <PlacesVital
          running={runner.running}
          max={runner.maxConcurrentSessions}
          occupants={occupantsOf(runner)}
        />
        <RunnerMetricsCells metrics={runner.metrics} now={now} />
      </Vitals>

      {/* The capacity verdict (RAM reservation against what Docker has) does not fold: an
          impossible reservation must show without a gesture. */}
      {runner.available && (
        <PanelRow>
          <RunnerCapacity
            maxConcurrentSessions={runner.maxConcurrentSessions}
            memoryMb={runner.memoryMb}
            hostMemoryMb={runner.hostMemoryMb}
          />
        </PanelRow>
      )}

      {!runner.available && (
        <PanelNote tone="bad" icon={<TriangleAlert size={14} />}>
          {INFRA_TEXT.panel.unavailableLead} <Code>ssh://</Code> {INFRA_TEXT.panel.unavailableTail}
          {runner.error && (
            <>
              {" "}
              {INFRA_TEXT.panel.daemonMessage} <Code>{runner.error.trim()}</Code>
            </>
          )}
        </PanelNote>
      )}
      {/* A stale image is stated here, on the machine (07/09), no longer in a global banner that
          did not name it, and the gesture sits next to the finding. Shared images (03/09) too. The
          missing image moved here as well (09/09): it had a note without a button, pointing to a
          `make image` to type elsewhere. */}
      <RunnerImageNotes runner={runner} />
      {(cleanup.data?.errors.length ?? 0) > 0 && (
        <PanelNote tone="bad" icon={<TriangleAlert size={14} />}>
          {INFRA_TEXT.panel.cleanupPartial(cleanup.data!.errors.join(" · "))}
        </PanelNote>
      )}
      <FailureNote
        failed={cleanup.isError}
        error={cleanup.error}
        lead={INFRA_TEXT.panel.cleanupFailed}
      />
      {/* The manual sweep can fail too: without this line it failed silently and the button just
          seemed to "do nothing" (toast audit 24/08). */}
      <FailureNote failed={reap.isError} error={reap.error} lead={INFRA_TEXT.panel.reapFailed} />
      {/* The 409 refusal (live session, or "sessions already in its name" on delete) reads here, as
          text, never guessed from a greyed button that would not say why. The server message is
          already the full sentence (`client.ts` relays `body.error` as is). */}
      <FailureNote failed={setEnabled.isError} error={setEnabled.error} />
      <FailureNote failed={removeRunner.isError} error={removeRunner.error} />
      {/* Zombies do not fold either: a task blocked by a session nobody saw die is an ongoing wait,
          not an inventory. */}
      {runner.zombieSessions.length > 0 && (
        <>
          <PanelNote tone="wait" icon={<TriangleAlert size={14} />}>
            {INFRA_TEXT.panel.zombies(runner.zombieSessions.length)} {INFRA_TEXT.panel.zombiesSweep}
          </PanelNote>
          <PanelRow icon={<Ghost size={14} />}>
            {runner.zombieSessions.map((z) => (
              <span key={z.sessionId}>
                <Code variant="bare">{z.sessionId}</Code>{" "}
                <TaskLink
                  taskId={z.taskId}
                  projectId={z.projectId}
                  label={z.taskName ?? INFRA_TEXT.inventory.task}
                />
              </span>
            ))}
            <Spacer />
            <Button size="sm" loading={reap.isPending} onClick={() => reap.mutate()}>
              {INFRA_TEXT.panel.reapNow}
            </Button>
          </PanelRow>
        </>
      )}

      {/* The two disclosures: the rest of the old page, on demand. Settings first (a gesture), then
          inventory (a reading), whose summary carries the orphan count as a tinted chip. */}
      <Disclosure flush className="ir-fold" summary={t.settings}>
        {/* A grid, not a row (02/09): the two steppers (sessions, CPU) share the first row and RAM
            takes the full width below. The slider needs its travel, the steppers do not, and
            stacking wasted a screen's height. */}
        <div className="ir-settings">
          <RunnerConcurrency
            runnerId={runner.runnerId}
            runnerName={runner.runnerName}
            value={runner.maxConcurrentSessions}
            running={runner.running}
          />
          <CpusField
            runnerId={runner.runnerId}
            runnerName={runner.runnerName}
            value={runner.cpus}
          />
          <MemoryField
            runnerId={runner.runnerId}
            runnerName={runner.runnerName}
            value={runner.memoryMb}
          />
        </div>
      </Disclosure>

      <InventoryFold
        runner={runner}
        cleaning={cleanup.isPending}
        onCleanup={() => cleanup.mutate()}
      />
    </Panel>
  );
}
