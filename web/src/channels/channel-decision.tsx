// The decision, in the thread. Operator finding on 26/08: tasks were waiting and nothing in the thread
// let him act. An inbox question was answered IN the conversation, but the other way of waiting, the
// approval gate, only had a banner describing the wait with no way out.
//
// Three moments, three texts:
//  · the task still RUNS and declares a gate → announce what will come. Nothing to do.
//  · the task is IN REVIEW after a SUCCESSFUL session → the work is deposited, approve it.
//  · the task is IN REVIEW after a DEAD session → not a deliverable but a crash: relaunch, not approve.
//
// The third case arrived an hour after the second (26/08): two tasks asked for approval while their
// session had ended on "container vanished without reported result". `review` parks BOTH outcomes;
// read from status alone, the screen presented a crash as delivered work.
//
// Not here: creating the PR. Opening a PR is irreversible and publishes work, so the link goes to the
// task page PR tab, which shows `pr.md` first. Approving is what the gate exists to ask, taken where
// the work was read. The three-moment RULE lives in `decision.ts`.
import type { ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import type { Task } from "../api/tasks.js";
import { Banner } from "../ui/banner.js";
import { Button } from "../ui/button.js";
import { Row } from "../ui/flex.js";
import { CHANNEL_DECISION, channelDecision } from "./decision.js";
import { CHANNELS_TEXT } from "./text.js";
import { TASK_STATUS } from "../api/tasks.js";
import "./channel-decision.css";

const T = CHANNELS_TEXT.decision;

export function ChannelDecision({
  status,
  approvalGate,
  failure,
  onApprove,
  onRetry,
  busy = false,
  prLink,
  taskLink,
}: {
  status: Task["status"];
  /** The task declares a gate: it will not move to `done` by itself. */
  approvalGate: boolean;
  /** The last session's end reason if it FAILED, otherwise `null`: it tells deposited work from a dead
   *  session, which the status confuses. */
  failure?: string | null;
  onApprove: () => void;
  onRetry?: () => void;
  /** True during the call: the button disarms, or a double click sends twice. */
  busy?: boolean;
  /** Link to the PR draft when the agent deposited one. A slot: this component does not know the
   *  router. */
  prLink?: ReactNode;
  /** Link to the task page, to read the trace of what broke. */
  taskLink?: ReactNode;
}) {
  const moment = channelDecision({ status, approvalGate, failure });

  // The session died: SAY so, and relaunching comes first. Approving stays offered (the operator
  // decides), under its real name and not as primary.
  if (moment === CHANNEL_DECISION.failed) {
    return (
      <Banner
        tone="bad"
        className="channel-decision"
        title={T.failed}
        actions={
          <Row gap={6} wrap>
            {onRetry && (
              <Button variant="primary" onClick={onRetry} disabled={busy}>
                {T.retry}
              </Button>
            )}
            {status === TASK_STATUS.review && (
              <Button onClick={onApprove} disabled={busy}>
                {T.approveAnyway}
              </Button>
            )}
            {taskLink}
          </Row>
        }
      >
        {T.failedWhy(failure ?? "")}
      </Banner>
    );
  }
  if (moment === CHANNEL_DECISION.now) {
    return (
      <Banner
        tone="gate"
        className="channel-decision"
        title={T.now}
        actions={
          <Row gap={6} wrap>
            <Button
              variant="primary"
              leading={<CircleCheck size={13} />}
              onClick={onApprove}
              disabled={busy}
            >
              {T.approve}
            </Button>
            {prLink}
          </Row>
        }
      >
        {T.nowWhy}
      </Banner>
    );
  }
  // Not deposited yet: announce the gate, do not simulate it. A greyed button would say "soon" without
  // saying when, and a disabled control does not explain itself.
  if (moment === CHANNEL_DECISION.later)
    return (
      <Banner tone="gate" title={T.later}>
        {T.laterWhy}
      </Banner>
    );
  return null;
}
