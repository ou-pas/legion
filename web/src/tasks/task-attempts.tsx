// A task's previous attempts (13/09).
//
// The page renders the verdict of the LAST session only, which is right: it is the current attempt
// and says where things stand. But earlier ones vanished: a task that failed twice before succeeding
// told it nowhere, although that is what one wants to know when rereading it.
//
// An attempt is not a resume, and the database already tells them apart. A resume (turns exhausted,
// inbox answer, quota wake-up, update) UPDATEs the SAME row with `resumeCount + 1`, same
// `sdkSessionId`, same conversation, and its session verdict already shows the count (since 10/09).
// A new attempt writes a NEW row. Only those are shown here.
//
// No aggregated task verdict, and that decision shapes the rest: "two failures then a success" has
// no sentence. The last attempt says WHERE things stand, the previous ones HOW they got there.
//
// `destroyed` does not mean "succeeded" (`api/sessions.ts`): an operator stop and a zero exit both
// land there. So we say "ended", and `endReason`, the server's words never rephrased here, says
// which.
import { SESSION_STATUS, type Session } from "../api/sessions.js";
import { CostValue } from "../sessions/cost.js";
import { SessionVerdict, VerdictFact } from "../sessions/session-verdict.js";
import { SESSION_TEXT } from "../sessions/text.js";
import { Disclosure } from "../ui/disclosure.js";
import { Row } from "../ui/flex.js";
import { Num } from "../ui/num.js";
import { LOCALE } from "../ui/locale.js";
import { Caption } from "../ui/text.js";
import { elapsed } from "./session-facts.js";
import { TASK_ATTEMPTS_TEXT as T } from "./text/attempts.js";

/** When the attempt started. The day matters: two attempts of a task can be a week apart, and
 *  "6 d ago" cross-checks with nothing. */
const STARTED_AT = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** A finished attempt on ONE line, the `compact` mode of `SessionVerdict`. No gesture: a past
 *  attempt is not rerun, the task is, and that button lives elsewhere. */
function Attempt({ session }: { session: Session }) {
  const failed = session.status === SESSION_STATUS.failed;
  const ended = session.endedAt ? Date.parse(session.endedAt) : null;
  return (
    <SessionVerdict
      compact
      tone={failed ? "bad" : "neutral"}
      title={SESSION_TEXT.status[session.status]}
      meta={
        <>
          {typeof session.costUsd === "number" && <CostValue usd={session.costUsd} />}
          {ended !== null && (
            <Num value={elapsed(ended - Date.parse(session.startedAt))} tone="muted" />
          )}
          <Caption>{STARTED_AT.format(new Date(session.startedAt))}</Caption>
        </>
      }
    >
      {/* The end reason is the one the SERVER wrote. A session without one does not make one up:
          the status already said it all. */}
      {session.endReason && <VerdictFact shrink>{session.endReason}</VerdictFact>}
    </SessionVerdict>
  );
}

/**
 * The past attempts disclosure, under the verdict of the current attempt.
 *
 * Its summary reads while closed: the count, how many failed, and what they cost. That is what
 * decides whether to open it.
 *
 * The cost covers PAST attempts only. The task total lives in the right panel, which sums all
 * sessions since 10/09; repeating it here would make two numbers to keep in agreement.
 *
 * Most RECENT first: the attempt just before the one being read, whose reason is sought most often.
 */
export function TaskAttempts({ sessions }: { sessions: readonly Session[] }) {
  if (sessions.length === 0) return null;
  const failed = sessions.filter((s) => s.status === SESSION_STATUS.failed).length;
  const spent = sessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  return (
    <Disclosure
      flush
      summary={
        <Row gap={8} wrap>
          <Caption>{T.count(sessions.length)}</Caption>
          {failed > 0 && <Caption tone="bad">{T.failed(failed)}</Caption>}
          {spent > 0 && <CostValue usd={spent} tone="muted" />}
        </Row>
      }
    >
      {[...sessions].reverse().map((s) => (
        <Attempt key={s.id} session={s} />
      ))}
    </Disclosure>
  );
}
