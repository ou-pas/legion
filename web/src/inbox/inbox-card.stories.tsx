// The eight states of the "The question has its page" mock-up, "Cards" section.
//
// The main gesture comes through `render`: an inert `<a>` here, because a story mounts no
// router. Same contract as `pending-panel.stories.tsx`.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { INBOX_KIND, type InboxItem } from "../api/inbox.js";
import { TASK_STATUS } from "../api/tasks.js";
import { Stack } from "../ui/flex.js";
import { InboxCard, InboxCardRow } from "./inbox-card.js";
import { answerRows } from "./inbox-round-answers.js";
import { AI_2219_IMPACT, AI_2219_ROUND_2 } from "./inbox-round-fixture.js";
import { formFieldsOf } from "./round-shape.js";

const meta = { title: "inbox / InboxCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Frozen `now`: without it "waiting for 1 h 52" would drift from one capture to the next. */
const NOW = Date.UTC(2026, 8, 7, 17, 0);
const MIN = 60_000;

const base: InboxItem = {
  id: "q-2200",
  kind: INBOX_KIND.form,
  body: "Round 1 — 6 questions (AI-2200, language switcher)",
  evidence: null,
  impact: AI_2219_IMPACT,
  choices: null,
  form: AI_2219_ROUND_2,
  taskId: "t-2200",
  taskName: "AI-2200 — Add language switching to the Home page",
  agentName: "interviewer",
  sessionId: "s-2200",
  createdAt: NOW - 112 * MIN,
  wakeAt: null,
  waitForTaskId: null,
  waitForTaskName: null,
  waitForTaskStatus: null,
  reason: "question",
  answered: 0,
  total: formFieldsOf(AI_2219_ROUND_2).length,
  draft: null,
  draftAt: null,
  roundIndex: 1,
  projectId: "p-acme",
};

const item = (over: Partial<InboxItem> = {}): InboxItem => ({ ...base, ...over });

/** The real draft from the mock-up: two decisions made out of six. */
const DRAFT = { panel_state: "filled", line_format: "b" };

/** The gesture's link, inert: a story mounts no router. */
const link: Parameters<typeof InboxCard>[0]["render"] = (p) => <a href="#carte" {...p} />;
const noop = () => {};

export const Blank: Story = {
  name: "Form · open · nothing answered",
  render: () => <InboxCard item={item()} now={NOW} render={link} onReply={noop} />,
};

export const Draft: Story = {
  name: "Form · draft 2 / 6",
  render: () => (
    <InboxCard
      now={NOW}
      render={link}
      onReply={noop}
      item={item({ draft: DRAFT, answered: 2, draftAt: NOW - 12 * MIN })}
    />
  ),
};

export const Answered: Story = {
  name: "Form · answered",
  render: () => (
    <InboxCard
      now={NOW}
      render={link}
      item={item()}
      answer={{
        rows: answerRows(formFieldsOf(AI_2219_ROUND_2), {
          panel_state: "filled",
          line_format: "b",
          many_params: "keep",
          objects: "same",
          form_labels: "same-task",
          proof: true,
        }),
        comment: "For 5, fix both screens at once but keep two commits.",
        answeredAt: NOW - 8 * MIN,
      }}
    />
  ),
};

export const TextQuestion: Story = {
  name: "Text question · inline reply",
  render: () => (
    <InboxCard
      now={NOW}
      onReply={noop}
      item={item({
        kind: INBOX_KIND.text,
        form: null,
        total: 0,
        impact: null,
        roundIndex: null,
        body: "I can merge the two migrations into one, or keep them separate so we can roll back step by step. Which do you want?",
        createdAt: NOW - 4 * MIN,
      })}
    />
  ),
};

export const ChoiceQuestion: Story = {
  name: "Choice question · one click",
  render: () => (
    <InboxCard
      now={NOW}
      onReply={noop}
      item={item({
        kind: INBOX_KIND.choice,
        form: null,
        total: 0,
        impact: null,
        agentName: "server",
        roundIndex: null,
        body: "The target repo has no PHP environment in this session. How do you want to proceed?",
        choices: [
          { id: "php", label: "Provide PHP" },
          { id: "unverified", label: "Write unverified" },
          { id: "split", label: "Break down" },
        ],
        createdAt: NOW - 40_000,
      })}
    />
  ),
};

export const SingleField: Story = {
  name: "Single-field form · inline too",
  render: () => (
    <InboxCard
      now={NOW}
      onReply={noop}
      item={item({
        body: "Are we agreed on the spec?",
        impact: null,
        createdAt: NOW - 2 * MIN,
        total: 1,
        roundIndex: 3,
        form: {
          blocks: [
            {
              kind: "markdown",
              text: 'You haven\'t settled the options from the two previous rounds, so I went with my recommendations. An "agreed" closes the interview.',
            },
            {
              kind: "field",
              field: {
                id: "agree",
                label: "Are we agreed on the spec?",
                type: "radio",
                required: true,
                default: "yes",
                options: [
                  { id: "yes", label: "Yes, file the implementation task" },
                  { id: "no", label: "No, one more round" },
                ],
              },
            },
          ],
        },
      })}
    />
  ),
};

export const Waiting: Story = {
  name: "Waiting on another task · informational",
  render: () => (
    <InboxCard
      now={NOW}
      item={item({
        kind: INBOX_KIND.text,
        form: null,
        total: 0,
        agentName: "front",
        impact: null,
        roundIndex: null,
        body: 'Its session is sleeping on "Expose the tool catalog" and will wake on its own when it\'s done.',
        reason: "dependency",
        waitForTaskId: "t-catalog",
        waitForTaskName: "Expose the tool catalog",
        waitForTaskStatus: TASK_STATUS.doing,
        createdAt: NOW - 18 * MIN,
      })}
    />
  ),
};

export const OutOfQuota: Story = {
  name: "Out-of-quota pause · informational",
  render: () => (
    <InboxCard
      now={NOW}
      onReply={noop}
      item={item({
        kind: INBOX_KIND.text,
        form: null,
        total: 0,
        agentName: "senior-dev",
        impact: null,
        roundIndex: null,
        body: "Out of quota: the session will resume on its own at 19:00. You can answer now to wake it earlier.",
        reason: "quota-pause",
        wakeAt: Date.UTC(2026, 8, 7, 19, 0),
        createdAt: NOW - 30 * MIN,
      })}
    />
  ),
};

export const Rows: Story = {
  name: "The dense frame: the Inbox page's rows",
  render: () => (
    <Stack gap={0}>
      <InboxCardRow
        now={NOW}
        render={link}
        item={item({ draft: DRAFT, answered: 2, draftAt: NOW - 12 * MIN })}
      />
      <InboxCardRow
        now={NOW}
        render={link}
        item={item({
          id: "q-php",
          kind: INBOX_KIND.choice,
          form: null,
          total: 0,
          agentName: "server",
          taskName: "Put the warning icon on the tool card",
          body: "No PHP environment: how to proceed?",
          choices: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
            { id: "c", label: "C" },
          ],
          createdAt: NOW - 40_000,
        })}
      />
      <InboxCardRow
        now={NOW}
        item={item({
          id: "q-wait",
          kind: INBOX_KIND.text,
          form: null,
          total: 0,
          agentName: "front",
          taskName: "Relais front",
          body: 'Sleeping on "Expose the tool catalog"',
          reason: "dependency",
          waitForTaskId: "t-catalog",
          waitForTaskName: "Expose the tool catalog",
          waitForTaskStatus: TASK_STATUS.doing,
          createdAt: NOW - 18 * MIN,
        })}
      />
    </Stack>
  ),
};
