// A session's verdict: what happened, what is left to decide (proposal C, 23/08). Same tone
// grammar as Banner (wash + line, icon set by the tone). neutral stays on the sheet: an ending
// without a clear verdict does not shout.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileDown, GitBranch, GitMerge, MessageSquare, RotateCcw } from "lucide-react";
import { SessionVerdict, VerdictFact } from "./session-verdict.js";
import { SteerField } from "./steer-field.js";
import { Button } from "../ui/button.js";
import { Tag } from "../ui/chip.js";
import { Code } from "../ui/code.js";
import { Stack } from "../ui/flex.js";
import { Num } from "../ui/num.js";

const meta = { title: "sessions / SessionVerdict · VerdictFact" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const RUN_ERROR = "Timeout after 600s — heap out of memory at 512 invoices";

/** The three outcomes of a steering send, as the control plane really returns them. The refusal
 *  is the exact body of the 409 from `POST /api/sessions/:id/steer`
 *  (server/src/sessions/steering.ts): that sentence is what the operator must read. */
const steerAccepted = () => Promise.resolve({ ok: true as const });

export const OkSuccessFactsAndPendingDraft: Story = {
  name: "ok — success, facts and a draft waiting",
  render: () => {
    return (
      <Stack gap={10}>
        <SessionVerdict
          tone="ok"
          title="Finished successfully"
          meta={
            <>
              <Num value="$9.84" />
              <Num value="185 turns" tone="muted" />
              <Num value="1 h 12" tone="muted" />
              <Tag>sonnet</Tag>
            </>
          }
        >
          <VerdictFact icon={<GitBranch />}>
            <Tag>legion/oh7nZnZIFq</Tag> pushed · <Num value={6} suffix="file(s)" tone="muted" /> ·{" "}
            <Tag>89876f6</Tag>
          </VerdictFact>
          <VerdictFact icon={<GitMerge />} end={<Button size="sm">Open the draft</Button>}>
            a PR draft is waiting for your decision
          </VerdictFact>
        </SessionVerdict>
      </Stack>
    );
  },
};

export const BadFailureWithReasonAndOutputs: Story = {
  name: "bad — failure with reason and outputs",
  render: () => {
    return (
      <Stack gap={10}>
        <SessionVerdict
          tone="bad"
          title="Stopped before the end"
          meta={
            <>
              <Num value="$0.35" />
              <Num value="12 min" tone="muted" />
              <Tag>opus</Tag>
            </>
          }
          actions={
            <>
              <Button variant="primary" size="sm" leading={<RotateCcw size={13} />}>
                Retry the task
              </Button>
              <Button size="sm" leading={<FileDown size={13} />}>
                View the artifacts
              </Button>
            </>
          }
        >
          <VerdictFact>session closed: {RUN_ERROR}</VerdictFact>
          <VerdictFact>
            the task stays in "doing" — what was filed in the artifacts is kept
          </VerdictFact>
        </SessionVerdict>
      </Stack>
    );
  },
};

export const RunLiveSessionSpinningIcon: Story = {
  name: "run — live session, the icon spins",
  render: () => {
    return (
      <Stack gap={10}>
        <SessionVerdict tone="run" title="in progress" meta={<Num value="24 min" />}>
          <VerdictFact>
            currently <Code variant="bare">Edit web/src/routes/CapabilitiesPage.tsx</Code>
          </VerdictFact>
        </SessionVerdict>
      </Stack>
    );
  },
};

export const RunSteeringFieldInActionsSlot: Story = {
  name: "run + steering — the field lives in the actions slot, only if running",
  render: () => {
    return (
      <Stack gap={10}>
        <SessionVerdict
          tone="run"
          title="in progress"
          meta={<Num value="6 min" />}
          actions={<SteerField onSend={steerAccepted} agentName="senior-dev" />}
        >
          <VerdictFact>
            currently <Code variant="bare">Bash pnpm test</Code>
          </VerdictFact>
        </SessionVerdict>
      </Stack>
    );
  },
};

export const RunStartingNoFieldReasonWritten: Story = {
  name: "run + starting — no field, and the reason is WRITTEN (never a greyed-out control)",
  render: () => {
    return (
      <Stack gap={10}>
        <SessionVerdict tone="run" title="starting" meta={<Num value="3 s" />}>
          <VerdictFact icon={<MessageSquare />}>
            you'll be able to talk to it once it's running — its runtime isn't listening yet
          </VerdictFact>
        </SessionVerdict>
      </Stack>
    );
  },
};

/** D7 (15/09): nothing to add to the title; the panel answering the question (the task page
 *  inbox) sits right below, outside this component. */
export const WaitQuestionAsked: Story = {
  name: "wait — question asked, nothing more than the title",
  render: () => {
    return (
      <Stack gap={10}>
        <SessionVerdict
          tone="wait"
          title="The agent is waiting for your answer"
          meta={
            <>
              <Num value="$1.20" />
              <Tag>sonnet</Tag>
            </>
          }
        />
      </Stack>
    );
  },
};

export const NeutralCloseWithoutClearVerdict: Story = {
  name: "neutral — closed with no clear verdict",
  render: () => {
    return (
      <Stack gap={10}>
        <SessionVerdict
          tone="neutral"
          title="Session ended"
          meta={<Num value="4 min" tone="muted" />}
        >
          <VerdictFact>session closed: stop requested by the operator</VerdictFact>
        </SessionVerdict>
      </Stack>
    );
  },
};
