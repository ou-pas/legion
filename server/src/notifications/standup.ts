// Daily standup (lot 3): a summary of the last 24 h pushed to Discord and webhooks.
// The send hour lives in settings (`standup_hour`, local HH; empty = disabled).
import { getSetting, setSetting } from "../shared/settings.js";
import { addNotice, broadcastText, hasTextNotifier } from "../inbox/inbox.js";
import { NOTIF_EVENT, notifyOut } from "./notify.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";
import { allGoals, allTasks, openInboxMessages, sessionsSince } from "./standup-store.js";

export function getStandupHour(): number | null {
  const v = getSetting("standup_hour");
  return v && /^\d{1,2}$/.test(v) ? Number(v) : null;
}
export function setStandupHour(hour: number | null): void {
  setSetting("standup_hour", hour === null ? "" : String(Math.max(0, Math.min(23, hour))));
}

/** Summary of the last 24 h: structured (webhooks) and text (Discord). */
export function buildStandup(): { text: string; payload: Record<string, unknown> } {
  const since = new Date(Date.now() - 24 * 3600_000);
  const goals = allGoals();
  const goalsDone = goals.filter(
    (g) => g.endedAt && g.endedAt >= since && g.status === "completed",
  );
  const goalsStopped = goals.filter(
    (g) => g.endedAt && g.endedAt >= since && g.status !== "completed" && g.status !== "active",
  );
  const goalsActive = goals.filter((g) => g.status === "active");

  const tasks = allTasks();
  const prs = tasks
    .flatMap((t) =>
      (JSON.parse(t.prUrls) as { repo: string; url: string }[]).map((p) => ({
        ...p,
        task: t.name,
        updatedAt: t.updatedAt,
      })),
    )
    .filter((p) => p.updatedAt >= since);
  const gatesWaiting = tasks.filter(
    (t) => t.status === TASK_STATUS.review && t.approvalGate && !t.archived,
  );

  const inboxOpen = openInboxMessages();
  const sessions = sessionsSince(since);
  const cost = sessions.reduce((s, x) => s + (x.costUsd ?? 0), 0);
  const failed = sessions.filter((s) => s.status === "failed").length;

  const lines = [
    `☀️ **Legion standup** — last 24 h`,
    `• Goals: ${goalsDone.length} done, ${goalsStopped.length} stopped, ${goalsActive.length} running`,
    `• PRs: ${prs.length}${
      prs.length
        ? " — " +
          prs
            .slice(0, 5)
            .map((p) => p.url)
            .join(", ")
        : ""
    }`,
    `• Sessions: ${sessions.length} (${failed} failed) · cost ~$${cost.toFixed(2)}`,
    gatesWaiting.length
      ? `• ⏳ ${gatesWaiting.length} gate${gatesWaiting.length === 1 ? "" : "s"} to approve: ${gatesWaiting
          .slice(0, 5)
          .map((t) => t.name.slice(0, 40))
          .join(" · ")}`
      : `• No gate waiting`,
    inboxOpen.length
      ? `• ❓ ${inboxOpen.length} inbox question${inboxOpen.length === 1 ? "" : "s"} waiting`
      : `• No question waiting`,
  ];
  return {
    text: lines.join("\n"),
    payload: {
      goalsCompleted: goalsDone.length,
      goalsStopped: goalsStopped.length,
      goalsActive: goalsActive.length,
      prs: prs.map((p) => ({ repo: p.repo, url: p.url })),
      sessions: sessions.length,
      failed,
      costUsd: Number(cost.toFixed(4)),
      gatesWaiting: gatesWaiting.length,
      inboxOpen: inboxOpen.length,
    },
  };
}

export function sendStandup(): void {
  const { text, payload } = buildStandup();
  broadcastText(text);
  notifyOut(NOTIF_EVENT.standup, payload);
  // Without a text notifier, the standup lands in the in-app inbox (operator's request).
  if (!hasTextNotifier()) addNotice(text, "standup");
}

/** In-process scheduler: at the configured hour, at most once a day. */
export function startStandupScheduler(): void {
  setInterval(() => {
    const hour = getStandupHour();
    if (hour === null) return;
    const now = new Date();
    if (now.getHours() !== hour) return;
    // Dedup key in local date, matching local getHours: an ISO/UTC key would resend on a
    // fractional offset straddling UTC midnight (review lot3 #1).
    const today = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (getSetting("standup_last") === today) return;
    setSetting("standup_last", today);
    sendStandup();
  }, 60_000).unref?.();
}
