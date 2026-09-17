// pause-guards: the reasons to stop along the way, and the question they ask.
//
// Split from `runReal` on 06/09. Detection already lived in its modules (stuck knows what running in
// place is, turn-budget counts), but the reaction stayed in the runner, in thirty-line blocks alike
// to the line and never compared.
//
// There were three until 08/09, when the token budget left: it had never triggered, its counter was
// not even called before 03/09, and it took two fixes on 04/09 for design false positives. What it
// meant to measure, a session spending without progressing, stuck measures more reliably on
// identical repetition, and stuck supplied the reset without which that cap was unusable anyway.
//
// Three again since 10/09, but the new one asks nothing: a session reaching its turn budget while
// progressing restarts on its own (`requestRelaunch`).
//
// They all make the same move: a session is never killed, it hands back control. The container is
// destroyed during the wait (nothing costs any more), the work is pushed to the branch before the
// pause, and whatever wakes it (the human's answer, or the control plane) relaunches the session
// with its instruction. One pause path, `inbox_ask`'s, is what guarantees the push is never forgotten.
//
// The case that matters is an unreachable inbox. They say so (`run_warning`) rather than carry on
// silently: a session that should stop and does not is bad, one that does so without a trace cannot
// be debugged. The return value is whether it stopped; the caller draws the consequences.

import type { CallInternal, Report } from "./runner-io.mjs";
import type { InertiaVerdict } from "./inertia.mjs";
import type { StuckHit } from "./stuck.mjs";
import type { TurnBudgetEvent } from "./turn-budget.mjs";

/** What these guardrails receive from the runner.
 *
 *  `pause` hands back control then pauses the session. `lastActivity` says what the session was
 *  doing, read when the question is asked (hence a function: the value moves with every message, and
 *  a capture at startup would always say "(nothing yet)"). */
export type GuardIO = {
  callInternal: CallInternal;
  report: Report;
  pause: () => void;
  lastActivity: () => string;
};

/** An inbox question as these guardrails ask it: `kind` is added by `askThenPause`, the rest is what
 *  the human reads. */
type GuardQuestion = {
  body: string;
  choices: { id: string; label: string }[];
  evidence: string;
  impact: string;
};

/** The warning text when the control plane did not hear. */
type WarningFor = (status: number) => string;

/** The common move: ask the control plane to stop, pause if it heard, admit it otherwise. What the
 *  control plane does with the request depends on the route: an inbox question for the first two,
 *  an immediate relaunch for the third.
 *  @returns {Promise<boolean>} true if the session stops */
async function postThenPause(
  { callInternal, report, pause }: GuardIO,
  pathname: string,
  body: Record<string, unknown>,
  warning: WarningFor,
): Promise<boolean> {
  const res = await callInternal(pathname, body);
  if (res.ok) {
    pause();
    return true;
  }
  await report("run_warning", { message: warning(res.status) });
  return false;
}

/** Ask the question, pause if it left, admit it otherwise.
 *  @returns {Promise<boolean>} true if the session stops */
async function askThenPause(
  io: GuardIO,
  question: GuardQuestion,
  warning: WarningFor,
): Promise<boolean> {
  return postThenPause(io, "/inbox", { kind: "choice", ...question }, warning);
}

/** Running in place: the same call made identically with nothing changed between attempts. The turn
 *  cap punished a task for being big (it killed a session that had just got lint, typecheck, tests
 *  and build passing); this one only reacts to running in place.
 *  @param {GuardIO} io */
export async function askStuck(io: GuardIO, hit: StuckHit): Promise<boolean> {
  return askThenPause(
    io,
    {
      body: `I am going in circles (${hit.reason}). How do I carry on?`,
      choices: [
        { id: "fixed", label: "I fixed the cause, try again" },
        { id: "other", label: "Change approach, do not touch it again" },
        { id: "stop", label: "Drop this lead and finish" },
      ],
      evidence:
        `Identical call repeated, with no file changed between attempts:\n` +
        `  tool  : ${hit.tool}\n  input : ${hit.input}\n` +
        `  ${hit.total} call(s), ${hit.fails} of them failed.`,
      impact:
        `The session is treading water: it does the same thing again without changing anything. ` +
        `Your answer will be passed as is to the agent when it restarts. Nothing is lost: the work ` +
        `already done is pushed to the branch before the pause.`,
      // The turn cap remains the last resort if the inbox does not answer.
    },
    (status) => `treading water detected (${hit.reason}) but inbox unreachable (${status})`,
  );
}

/** The third, and it asks nothing (10/09). A session that reached its turn budget while progressing
 *  has no question to ask: the task is simply bigger than one container. The expected move is that
 *  of the quota pause (push, die, restart alone), not a click every 375 turns, which would rule out
 *  unattended overnight work.
 *
 *  Operator's decision in round 3 of the 10/09 interview, knowing the hole it closes: the inertia
 *  pause alone left a progressing session with nobody to relaunch it, so dead at the 400 wall.
 *
 *  What the control plane does with it lives there (`sessions/turn-relaunch.ts`): trace, control
 *  event, inbox entry with immediate wake-up. Here only one thing is known: if the request left,
 *  hand back control so the work is pushed and the container destroyed.
 *
 *  If it does not leave, carry on: the least bad choice. The session keeps its turns up to the wall,
 *  its checkpoints already secured the code, and the control plane traces the wall as `warn`: a case
 *  that should no longer exist must be visible.
 *  @param {GuardIO} io
 *  @param {object} hit the turn budget's pause event
 *  @param {object} verdict the inertia measure (`inertia.mts`)
 *  @param {string} notice the text the next session will read (`prompt.mts`) */
export async function requestRelaunch(
  io: GuardIO,
  hit: TurnBudgetEvent,
  verdict: InertiaVerdict,
  notice: string,
): Promise<boolean> {
  return postThenPause(
    io,
    "/relaunch",
    {
      used: hit.used,
      pauseAt: hit.pauseAt,
      cap: hit.cap,
      notice,
      measure: {
        idleTurns: verdict.idleTurns,
        sinceTurn: verdict.sinceTurn,
        commits: verdict.commits,
        writes: verdict.writes,
        lastCommitTurn: verdict.lastCommitTurn,
        writable: verdict.writable,
      },
    },
    (status) =>
      `automatic relaunch refused (${status}) at turn ${hit.used}: the session carries on up to the hard wall of ${hit.cap}`,
  );
}

/** Turn budget. The SDK's `maxTurns: 400` is a wall: at turn 400 the session is cut dead with
 *  `error_max_turns`, and everything unpushed dies with the container. Seen on 25/08 on the Channels
 *  view, under the old cap of 200: 201 turns, $32.08, cut the second the agent was writing its final
 *  commit.
 *
 *  This question is the second stage. The first, the warning from `prompt.mts`, leaves the decision
 *  to the agent; this one asks it nothing, it is the net.
 *  @param {GuardIO} io */
export async function askTurnBudget(io: GuardIO, hit: TurnBudgetEvent): Promise<boolean> {
  const { lastActivity } = io;
  return askThenPause(
    io,
    {
      body: `Turn budget reached (${hit.used} / ${hit.pauseAt}, hard wall ${hit.cap}). Do I carry on?`,
      choices: [
        { id: "continue", label: "Carry on, the task justifies it" },
        { id: "wrap_up", label: "Finish what is in progress, then stop" },
        { id: "split", label: "Stop: this task is too big, it must be split again" },
      ],
      evidence:
        `${hit.used} turns used in this session (pause at ${hit.pauseAt}, SDK hard wall at ${hit.cap}).\n` +
        `Last activity: ${lastActivity()}`,
      impact:
        `An exhausted turn budget is not an anomaly: it is a task bigger than one run. ` +
        `Your answer will be passed as is to the agent when it restarts. Nothing is lost: the ` +
        `work is pushed to the branch at every checkpoint, and one last time before the pause.`,
      // If the inbox does not answer the session goes to the hard wall, but checkpoints have already
      // secured the code, which was the whole problem.
    },
    (status) =>
      `turn budget reached (${hit.used}/${hit.pauseAt}) but inbox unreachable (${status})`,
  );
}
