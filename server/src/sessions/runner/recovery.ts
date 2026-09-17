// What remains of dead sessions: at server boot, then on every clock tick.
//
// Split out of `manager.ts` (lot 11). Both sweeps ask the same question, "does this container
// still exist?", and ask it of DOCKER, never of the database alone. That is the point of this
// file, and why the two live side by side.
import { containerProbe, probeVerdict, type ContainerProbe } from "../../shared/docker-exec.js";
import { publish } from "../../shared/events.js";
import { settleTaskAfterSession } from "../../tasks/lifecycle.js";
import { markSessionTerminal, SESSION_STATUS } from "../session-terminal.js";
import { RUNNER_KIND } from "../../shared/enums.js";
import { OCCUPYING_STATUSES } from "../../infra/runner/limits.js";
import { DockerRunner } from "./docker.js";
import { pumpQueue } from "./queue.js";
import { logControlEvent } from "../../events/control-log-store.js";
import {
  isDemoProject,
  lastResultEvent,
  runnerRow as runnerRowOf,
  type SessionRow,
  sessionStatusOf,
  sessionsInStatus,
  taskRow,
} from "./manager-store.js";

/** One docker probe per session the database believes active.
 *
 *  `pending` is NOT `survivors` (25/08): a `starting` without a handle has no living container, it
 *  has none at all. Counting them together made the log say "2 kept (container alive)" for two
 *  sessions whose container never existed, the opposite of the failure being investigated. */
async function sortOrphans(candidates: readonly SessionRow[]): Promise<{
  dead: Array<SessionRow & { probe?: ContainerProbe }>;
  survivors: number;
  pending: number;
  unresolved: Array<{ sessionId: string; probe: ContainerProbe }>;
}> {
  let survivors = 0;
  let pending = 0;
  const unresolved: Array<{ sessionId: string; probe: ContainerProbe }> = [];
  const dead: Array<SessionRow & { probe?: ContainerProbe }> = [];
  for (const s of candidates) {
    const runner = runnerRowOf(s.runnerId);
    if (runner?.kind !== RUNNER_KIND.docker) {
      dead.push(s);
      continue;
    }
    // `starting` without a recorded runtime: the container does not exist yet, nothing to ask.
    // Let it live; the launch in progress writes its handle in a moment and the next pass
    // decides. Killing here would be losing a race against ourselves.
    if (s.status === SESSION_STATUS.starting && !s.runtimeHandle) {
      pending++;
      continue;
    }
    const target = s.runtimeHandle || `legion-session-${s.id}`;
    const probe = await containerProbe(target, runner.dockerHost);
    if (probe.verdict === "alive") {
      survivors++;
      continue;
    }
    // Same rule as the sweep (08/09): kill only on PROOF, and `unknown` is none. Counted apart
    // from survivors: writing "container alive" for a container we know nothing about would be
    // the lie `pending` above already describes.
    if (probe.verdict === "unknown") {
      unresolved.push({ sessionId: s.id, probe });
      continue;
    }
    dead.push({ ...s, probe });
  }
  return { dead, survivors, pending, unresolved };
}

function buryOrphan(s: SessionRow & { probe?: ContainerProbe }): void {
  const reason = `orphan session at server boot: ${probeVerdict(s.probe)}`;
  publish(s.id, "run_error", { message: reason });
  markSessionTerminal(s.id, SESSION_STATUS.failed, reason, { probe: s.probe });
  const runner = runnerRowOf(s.runnerId);
  if (runner?.kind === RUNNER_KIND.docker)
    void new DockerRunner(runner.dockerHost)
      .destroy({ id: s.id, runtime: s.runtimeHandle ?? "" })
      .catch(() => {});
}

/** At boot: settle the sessions the database believes active.
 *
 *  Asks DOCKER before concluding (20/08). Before, "active in the database" meant "dead container"
 *  without checking, so a mere server restart (a `tsx watch` reloading after a file change) failed
 *  living sessions AND destroyed their containers. A `docker rm -f` does not let the payload's
 *  `finally` run: the work was not even pushed. An hour-long session vanished because a file was
 *  saved.
 *
 *  A server restart is not a crash: the container keeps running and its callbacks resume on their
 *  own (the callback token is in the database, not in memory). Only the absence of its runtime
 *  justifies concluding a session is dead. */
export async function recoverOrphanSessions(): Promise<void> {
  // Demo project sessions are SCENERY: no container behind them, nothing to recover. Without this
  // filter every server restart would fail them and empty the demo.
  const candidates = sessionsInStatus(OCCUPYING_STATUSES).filter((s) => {
    const t = taskRow(s.taskId);
    return !t || !isDemoProject(t.projectId);
  });
  const { dead, survivors, pending, unresolved } = await sortOrphans(candidates);
  for (const s of dead) buryOrphan(s);
  if (dead.length || survivors || pending || unresolved.length) {
    const message =
      `${dead.length} orphan session(s) marked failed, ${survivors} kept ` +
      `(container alive), ${pending} still starting (no container yet), ` +
      `${unresolved.length} kept on a probe without a verdict`;
    logControlEvent(dead.length || unresolved.length ? "warn" : "info", "recover", message, {
      dead: dead.map((s) => s.id),
      survivors,
      pending,
      unresolved,
    });
  }
}

/** The only two statuses this sweep judges, named ONCE because the reread before writing (below)
 *  must ask exactly the same question as the selection. */
const SWEEPABLE = [SESSION_STATUS.running, SESSION_STATUS.committing] as const;

/** Reread from the database: see its use, it is the point of the fix. */
const statusOf = (id: string): string | null => sessionStatusOf(id);

/** The death certificate written at sweep time, for a session whose container disappeared.
 *
 *  The verdict is READ from the trace rather than guessed: if the payload reported a successful
 *  `result`, the session did its work and only the certificate is missing. Without `result`, it
 *  died on the way.
 *
 *  Always an event: a session must never become terminal without saying why. That silence made
 *  the first diagnosis painful; `markSessionTerminal` is now the only place allowed to set this
 *  status, precisely so this holds. */
function reapSession(
  s: SessionRow,
  dockerHost: string | null,
  probe: ContainerProbe | undefined,
): void {
  const last = lastResultEvent(s.id);
  const succeeded = last
    ? (JSON.parse(last.payload) as { subtype?: string }).subtype === "success"
    : false;
  markSessionTerminal(
    s.id,
    succeeded ? SESSION_STATUS.destroyed : SESSION_STATUS.failed,
    succeeded
      ? `container finished after a successful result — death certificate written at sweep time (${probeVerdict(probe)})`
      : `container gone with no result reported (${probeVerdict(probe)})`,
    { reaped: true, probe },
  );
  // No success condition (26/08). It was `if (!succeeded)`, assuming a successful agent settles
  // itself with `update_task`. When it did not, the task stayed `doing` forever with no living
  // session behind it; see settleTaskAfterSession.
  settleTaskAfterSession(s.taskId);
  void new DockerRunner(dockerHost)
    .destroy({ id: s.id, runtime: s.runtimeHandle ?? "" })
    .catch(() => {});
}

/** Ends sessions whose container died without anyone noticing.
 *
 *  The missing half of `recoverOrphanSessions` (20/08), which KEEPS at boot the sessions whose
 *  container still lives. But a kept session has no watcher anymore: `runLifecycle`'s
 *  `await runner.wait(handle)` lived in the replaced process. The container exits and nobody
 *  learns it. Seen for real: a session with its `result` (success, $9.84, 185 turns) and its
 *  `repo_push` in the database, left `running` forever, holding a runner slot for nothing.
 *
 *  Reattaching at boot would not be enough: a callback can be lost for other reasons (badly timed
 *  restart, network). This periodic sweep assumes NOTHING about who watches what: it asks Docker,
 *  and concludes.
 *
 *  Deliberately excluded: `waiting`, where a missing container is normal (the pause destroys the
 *  runtime by design), and `starting`, where it does not exist yet. */
export async function reapDeadSessions(): Promise<number> {
  const candidates = sessionsInStatus(SWEEPABLE).filter((s) => {
    const t = taskRow(s.taskId);
    return !t || !isDemoProject(t.projectId);
  });

  let reaped = 0;
  let unresolved = 0;
  const reapedIds: Array<{ sessionId: string; handle: string | null; probe?: ContainerProbe }> = [];
  for (const s of candidates) {
    const runner = runnerRowOf(s.runnerId);
    if (runner?.kind !== RUNNER_KIND.docker) continue; // a ProcessRunner has no container to ask
    const probe = s.runtimeHandle
      ? await containerProbe(s.runtimeHandle, runner.dockerHost)
      : undefined;
    // A probe that did not answer is not a death certificate (08/09). Anything not `alive` used to
    // mean dead, `unknown` included, but that means "I could not tell", and a `docker inspect`
    // over five seconds is common over `ssh://`. Session YPOdg3sGWKnA was killed mid fan-out on a
    // code 124 while it had written a file forty seconds earlier. So kill only on PROOF: `gone`,
    // or no handle (nothing to ask). The price (a silent daemon leaves sessions `running`) is
    // REVERSIBLE; killed work is not. The log counts verdict-less probes separately.
    if (probe && probe.verdict !== "gone") {
      if (probe.verdict === "unknown") unresolved += 1;
      continue;
    }
    // Reread the status right before writing (08/09), the rule `session-guard.ts` states.
    // Candidates are taken in one batch, and each probe is a round trip of several seconds: a
    // session pausing meanwhile destroys its container, which IS a pause, and the sweep buried it.
    // Session oo6ED67UqBb_: `waiting` and `failed` in the same second, and `resumeSession` requires
    // `waiting`, so it could no longer be resumed at all.
    if (!(SWEEPABLE as readonly string[]).includes(statusOf(s.id) ?? "")) continue;
    reapSession(s, runner.dockerHost, probe);
    reaped += 1;
    reapedIds.push({ sessionId: s.id, handle: s.runtimeHandle, probe });
  }
  if (reaped || unresolved) {
    logControlEvent(
      "warn",
      "recover",
      `${reaped} session(s) without a container finished at sweep time, ${unresolved} kept on a probe without a verdict`,
      {
        sessionIds: reapedIds.map((r) => r.sessionId),
        probes: reapedIds,
        unresolved,
      },
    );
    if (reaped) pumpQueue(); // slots just freed up
  }
  return reaped;
}
