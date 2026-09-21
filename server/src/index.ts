// The assembler, and nothing else (DDD refactor, lot 40). Each domain owns its routes
// (src/<domain>/routes.ts), registered here. Boot (seed, recoveries, schedulers) stays here: it is
// composition, not domain.
import "./shared/env.js"; // load server/.env before anything reads process.env (review #1)
import { serve } from "@hono/node-server";
import { logControlEvent } from "./shared/db.js";
import { seed } from "./projects/seed/index.js";
import { app } from "./http/app.js";

import {
  pumpQueue,
  reapDeadSessions,
  recoverOrphanSessions,
  resumeSession,
  runTask,
} from "./sessions/runner/manager.js";
import { registerImageRebuilder, registerSessionResumer } from "./inbox/ports.js";
import { answerImageRebuild, sweepImageWaits } from "./sessions/runner/image-watch.js";
import { registerRunnerProvider } from "./sessions/runner/ports.js";
import { dockerRunnerProvider } from "./sessions/runner/provider.js";
import { onSessionEnded } from "./sessions/session-terminal.js";
import { openPrAfterSession } from "./review/open-pr.js";
import { sweepStalledStarts } from "./sessions/stalled-start.js";
import { sweepUnavailableRunners } from "./infra/runner/unavailability-sweep.js";
import { startScheduler } from "./chains/templates.js";
import { recoverGoals } from "./goals/goals.js";
import { startDiscord } from "./notifications/discord.js";
import { startStandupScheduler } from "./notifications/standup.js";
import { startOrphanSweep } from "./infra/orphan-sweep.js";
import { registerTaskRoutes } from "./tasks/routes/index.js";
import { registerGoalRoutes } from "./goals/routes.js";
import { registerInboxRoutes } from "./inbox/routes.js";
import { registerCapabilityRoutes } from "./capabilities/routes.js";
import { registerEnvironmentRoutes } from "./environments/routes.js";
import { registerNotificationRoutes } from "./notifications/routes.js";
import { registerSessionRoutes } from "./sessions/routes.js";
import { registerEventRoutes } from "./events/routes.js";
import { registerModelRoutes } from "./models/routes.js";
import { registerChainRoutes } from "./chains/routes.js";
import { registerReviewRoutes } from "./review/routes.js";
import { registerInboundWebhookRoutes } from "./review/inbound-webhook-routes.js";
import { registerIntegrationRoutes } from "./integrations/routes.js";
import { registerConnectionRoutes } from "./connections/routes.js";
import { registerProjectRoutes } from "./projects/routes.js";
import { registerInfraRoutes } from "./infra/routes.js";
import { registerWikiRoutes } from "./wiki/routes.js";
import { registerInternalRoutes } from "./sessions/internal-routes.js";
import { registerRequestRepoRoute } from "./sessions/request-repo.js";
import { registerTurnRelaunchRoute } from "./sessions/turn-relaunch.js";
import { registerStaticRoutes, spaIsBuilt } from "./http/static.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerOperatorRoutes } from "./operator/routes.js";
import { ensureOperatorToken } from "./operator/operator.js";
import { registerPortabilityRoutes } from "./portability/routes.js";
import { registerUpdateRoutes } from "./updates/routes.js";
import { reportFinishedLogs } from "./updates/fleet-report.js";
import { closeInboxOfDeadSessions, closeSessionInbox } from "./inbox/session-close.js";
import { registerConciergeRoutes } from "./concierge/routes.js";
import { registerScheduleRoutes } from "./schedules/routes.js";
import { startScheduleTicker } from "./schedules/schedules.js";
import { installBuiltinSkills } from "./capabilities/builtin-skills.js";
import { createLogger } from "./shared/log.js";

// Boot writes to two channels: what will be read back (skills written, workspaces released, failed
// recovery) goes to `control_events`; the listen address and periodic sweeps go here, read at boot
// or never.
const log = createLogger("boot");
import { startRunnerProbe } from "./infra/probe.js";
import { sweepOrphanVolumes, sweepOrphanWorkspaces } from "./sessions/runner/workspace.js";

// Session runtime, wired before anything that can ask for one (06/09): a route, the queue, a
// resume. `manager.ts` asks the port; this is where it becomes Docker.
registerRunnerProvider(dockerRunnerProvider);
// The only place that knows inbox and runner exist together (06/09): answering an entry resumes
// the session or reruns the task. Wired before anything that can answer (a route, Discord, a
// dependency wake-up).
registerSessionResumer({ resume: resumeSession, run: runTask });
// The inbox's second port (12/09): answering a missing-image question rebuilds or shelves, and the
// runner knows which rebuild to launch. Wired here for the same reason.
registerImageRebuilder({ answer: answerImageRebuild });
// After a session ends (06/09): `session-terminal.ts` announces it, `review/open-pr.ts` decides
// whether to open a PR; a direct call closed a cycle. `openPrAfterSession` never throws, but the
// `.catch` stays: a forge outage must not surface as an unhandled rejection.
onSessionEnded((sessionId) => void openPrAfterSession(sessionId).catch(() => {}));
// Every session end closes its open questions (08/09). Only `stopSession` used to: a session
// reaped by the sweep or failed left its question open, with a wake button answering "session is
// destroyed, not waiting".
onSessionEnded((sessionId) => closeSessionInbox(sessionId));

seed();
// Skills shipped with Legion, written if absent and never rewritten (D16). Synchronous and first:
// a built-in agent citing a missing skill would arrive broken, better known at boot.
try {
  const skills = installBuiltinSkills();
  if (skills.written.length)
    logControlEvent("info", "boot", `built-in skill(s) written: ${skills.written.join(", ")}`);
  if (skills.upgraded.length)
    logControlEvent(
      "info",
      "boot",
      `unedited built-in skill(s) upgraded: ${skills.upgraded.join(", ")}`,
    );
  if (skills.edited.length)
    log.info("edited built-in skill(s) left as they are", { skills: skills.edited });
} catch (e: unknown) {
  const message = `writing the built-in skills failed: ${String((e as Error)?.message ?? e)}`;
  logControlEvent("error", "boot", message);
}
// Async (it queries Docker): an inspection failure must not stop the server from answering.
void recoverOrphanSessions()
  .then(() => {
    // AFTER recovery, never before (D13): recovery decides which "active" sessions still have a
    // live container; sweeping first would erase the `/workspace` of a session a server restart did
    // not kill. If recovery FAILS the sweep does not run (`.then`, not `finally`): not knowing who
    // is alive, keeping disk is the safe side.
    const swept = sweepOrphanWorkspaces();
    if (swept.released)
      logControlEvent(
        "info",
        "boot",
        `${swept.released} session workspace(s) released at boot`,
        swept,
      );
    // v52: the same sweep for remote machines, where session files are docker volumes. Async (it
    // queries each machine): a sleeping daemon must not hold up boot, and it erases nothing when
    // it does not know.
    return sweepOrphanVolumes().then((v) => {
      if (v.released)
        logControlEvent("info", "boot", `${v.released} session volume(s) released at boot`, v);
    });
  })
  .catch((e: unknown) => {
    logControlEvent(
      "error",
      "recover",
      `recovering the orphan sessions failed at boot: ${String((e as Error)?.message ?? e)}`,
    );
  });
startDiscord();
startScheduler();
startScheduleTicker();

// Sessions without a container: one that exits while the server restarts has nobody to notice,
// and would stay `running` forever holding a runner slot. Every 30 s, a safety net.
void reapDeadSessions().catch((e: unknown) =>
  log.warn("dead session sweep failed at boot", {
    error: String((e as Error)?.message ?? e),
  }),
);
// Its counterpart before the container (25/08): `reapDeadSessions` skips `starting` and
// `recoverOrphanSessions` spares it at boot, so a session never getting its container was caught
// by nobody.
void sweepStalledStarts().catch((e: unknown) =>
  log.warn("stalled start sweep failed at boot", {
    error: String((e as Error)?.message ?? e),
  }),
);
// And a task that never reached `doing` because its machine refused (Docker off, disk full, 12/09):
// `pumpQueue` skips it forever, this net moves it to Later after fifteen minutes. Synchronous (no
// network), hence `try`, not `.catch`.
try {
  sweepUnavailableRunners();
} catch (e: unknown) {
  log.warn("unavailable runner sweep failed at boot", {
    error: String((e as Error)?.message ?? e),
  });
}
// Fleet image updates (07/09): the ephemeral updater container has no database, so the control
// plane reads its finished logs and records the result.
const reportFleet = () => {
  try {
    reportFinishedLogs();
  } catch (e: unknown) {
    log.warn("reading the update logs failed", {
      error: String((e as Error)?.message ?? e),
    });
  }
};
reportFleet();
// Questions still open on already-ended sessions (08/09): the `onSessionEnded` hook covers the
// future, this catch-up covers what the database already holds.
const closeDeadInbox = () => {
  try {
    const n = closeInboxOfDeadSessions();
    if (n)
      logControlEvent("info", "recover", `${n} inbox question(s) closed: their session was over`, {
        count: n,
      });
  } catch (e: unknown) {
    log.warn("closing orphaned questions failed", {
      error: String((e as Error)?.message ?? e),
    });
  }
};
closeDeadInbox();
setInterval(() => {
  void reapDeadSessions().catch((e: unknown) =>
    log.warn("dead session sweep failed", { error: String((e as Error)?.message ?? e) }),
  );
  void sweepStalledStarts().catch((e: unknown) =>
    log.warn("stalled start sweep failed", { error: String((e as Error)?.message ?? e) }),
  );
  // Lifts image waits (12/09): the image also comes back without an inbox answer (rebuild from the
  // Infra card, machine back on, fleet update). One probe per machine and image, only when tasks
  // wait on it. The pump is called here because the sweep cannot without closing a cycle.
  void sweepImageWaits()
    .then((freed) => {
      if (freed > 0) pumpQueue();
    })
    .catch((e: unknown) =>
      log.warn("missing image sweep failed", {
        error: String((e as Error)?.message ?? e),
      }),
    );
  // Its neighbour, for outages no Legion action repairs (#184): both move tasks to the same place,
  // on different facts (missing image there, unresponsive machine here).
  try {
    sweepUnavailableRunners();
  } catch (e: unknown) {
    log.warn("unavailable runner sweep failed", {
      error: String((e as Error)?.message ?? e),
    });
  }
  reportFleet();
  closeDeadInbox();
}, 30_000).unref();
startStandupScheduler();
startOrphanSweep();
// Fleet health probe (v51), before `pumpQueue`: `last_seen_at` dates from the previous process, so
// every runner counts as unreachable until the first pass answers. It probes immediately without
// waiting; a queue starting meanwhile stops on "no reachable runner" and resumes at the next pump.
// Blocking boot on Docker would be worse.
startRunnerProbe();
recoverGoals();
pumpQueue(); // resume the queue left by a previous process (v13)

// Paths are disjoint; the order is the old monolith's, kept to avoid a gratuitous matching change.
registerAuthRoutes(app);
registerOperatorRoutes(app);
registerProjectRoutes(app);
registerChainRoutes(app);
registerTaskRoutes(app);
registerGoalRoutes(app);
registerInboxRoutes(app);
registerCapabilityRoutes(app);
registerEnvironmentRoutes(app);
registerNotificationRoutes(app);
registerSessionRoutes(app);
registerEventRoutes(app);
registerModelRoutes(app);
registerReviewRoutes(app);
// Forge webhooks: public routes outside /api, guarded by signature.
registerInboundWebhookRoutes(app);
registerIntegrationRoutes(app);
registerConnectionRoutes(app);
registerInfraRoutes(app);
registerWikiRoutes(app);
registerPortabilityRoutes(app);
registerUpdateRoutes(app);
registerConciergeRoutes(app);
registerScheduleRoutes(app);
registerInternalRoutes(app);
registerRequestRepoRoute(app); // also on the /internal port: its route lives with its service (09/09)
registerTurnRelaunchRoute(app); // same: automatic relaunch of a long run (10/09)
// ALWAYS LAST: its SPA fallback catches everything left, so registered earlier it would swallow
// the domain routes after it. Without a build it only mounts the service card at the root.
registerStaticRoutes(app);

const port = Number(process.env.PORT ?? 8790);
// The socket listens on all interfaces: containers call `/internal` through the Docker bridge
// gateway IP, never 127.0.0.1. Limiting who reaches the port is the firewall's job.
// The operator token exists before the port listens: created on first request, it would leave a
// window with nothing to compare, exactly at boot when everything reconnects at once.
ensureOperatorToken();
serve({ fetch: app.fetch, port });
log.info(`Legion control plane → http://localhost:${port} — API protected by operator session`);
// Without this line, a blank page leaves two indistinguishable causes: missing build, or something
// else broken.
log.info(
  spaIsBuilt()
    ? "built screen served on the same port (SPA fallback active)"
    : "no web/dist: only the API is served (the screen lives on Vite, or run `make build`)",
);
