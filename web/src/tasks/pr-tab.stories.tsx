// The PR tab: a change request is not created without reading it.
//
// The gestures moved out (15/09) to the card's header bar, so their states show in
// `review/pr-actions.stories.tsx`. What stays here is READ: the draft, the branch, and the
// sentence saying what a repair will cost.
import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "@tanstack/react-query";
import type { PrMergeState } from "../api/review.js";
import type { Task } from "../api/tasks.js";
import { PrTab } from "./pr-tab.js";
import { TASK_STATUS } from "../api/tasks.js";
import { COMPLEXITY } from "../api/tasks.js";
import { PRIORITY } from "../api/tasks.js";

/** The workshop does not call the forge: it SEEDS the cache key `prMergeStatesQuery` reads, to
 *  show a chosen state rather than "not known yet" every time. */
function SeedMergeStates({
  taskId,
  states,
  children,
}: {
  taskId: string;
  states: PrMergeState[];
  children: ReactNode;
}) {
  const qc = useQueryClient();
  useEffect(() => {
    qc.setQueryData(["pr-merge-state", taskId], states);
  }, [qc, taskId, states]);
  return <>{children}</>;
}

const meta = { title: "tasks / PrTab" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const AT = "2026-08-28T09:00:00.000Z";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t-1",
  projectId: "p-1",
  name: "Environments screen",
  description: "",
  status: TASK_STATUS.review,
  settledOutcome: null,
  assigneeAgentId: "a-1",
  modelOverride: null,
  approvalGate: false,
  readOnly: false,
  templateId: null,
  templateRunId: null,
  stepIndex: null,
  blockedBy: [],
  criteria: null,
  goalId: null,
  archived: false,
  complexity: COMPLEXITY.med,
  priority: PRIORITY.med,
  queued: false,
  prUrls: "",
  externalRef: null,
  expectedArtifacts: "",
  scheduledAt: null,
  branch: "feature/environments-screen-3f9a1c2b",
  createdAt: AT,
  updatedAt: AT,
  boardOrder: 1,
  editable: false,
  briefEditable: false,
  waitingFor: null,
  imageWait: null,
  runnerWait: null,
  chosenRunnerId: null,
  ...over,
});

const DRAFT = `# feat(environments): the screen finally has a server behind it

The screen called four routes nobody was serving. This batch writes them.

- \`GET /api/environments\` — the list, project by project
- \`POST /api/environments\` — creation, with name validation
- the API contract goes green, and \`api-pending.json\` loses its entry

Verified with \`make gates\`.`;

export const NoDraft: Story = {
  name: "no draft — it's not a failure",
  render: () => <PrTab task={task()} prUrls={[]} />,
};

// Slice nav/15: the branch is SET on first run and stored on the task, so a never-run task has
// none. The screen says so instead of showing `legion/<id>`, a guess, and a wrong one since the
// name comes from the title.
export const NoBranchYet: Story = {
  name: "never launched — the branch isn't named yet",
  render: () => <PrTab task={task({ branch: null })} prUrls={[]} />,
};

export const DraftToRead: Story = {
  name: "a draft to read before deciding",
  render: () => <PrTab task={task()} prUrls={[]} initialDraft={DRAFT} />,
};

export const NamedBranch: Story = {
  name: "an external reference names the branch — the draft picks it up",
  render: () => (
    <PrTab
      task={task({
        externalRef:
          '{"identifier":"AOS-12","url":"https://x/AOS-12","branch":"feat/aos-12-environments"}',
      })}
      prUrls={[]}
      initialDraft={DRAFT}
    />
  ),
};

// The repair sentence does live here: the button it explains is in the header bar, and the draft
// reader must know a click runs a session again.
const FRONT_MR_URL = "https://framagit.org/3idprint/front/-/merge_requests/15";
const API_MR_URL = "https://framagit.org/3idprint/api/-/merge_requests/22";

export const TwoReposOneConflict: Story = {
  name: "two repos, one request in conflict — only that one is explained",
  render: () => {
    const prUrls = [
      { repo: "front", url: FRONT_MR_URL },
      { repo: "api", url: API_MR_URL },
    ];
    const t = task({ prUrls: JSON.stringify(prUrls) });
    return (
      <SeedMergeStates
        taskId={t.id}
        states={[
          {
            repo: "front",
            url: FRONT_MR_URL,
            number: 15,
            mergeState: "mergeable",
            prState: "merged",
          },
          { repo: "api", url: API_MR_URL, number: 22, mergeState: "conflict", prState: "open" },
        ]}
      >
        <PrTab task={t} prUrls={prUrls} initialDraft={DRAFT} />
      </SeedMergeStates>
    );
  },
};

// "Red CI" batch: `checkState` joins `pr-merge-state`, on a probe independent of `mergeState`. A
// PR can conflict AND have a red job; both sentences coexist.
const MOCK_FRONT_URL = "https://github.com/x/mock-front/pull/7";

export const OneRedJob: Story = {
  name: "a conflict and a red job — two sentences, two actions in the bar",
  render: () => {
    const prUrls = [{ repo: "mock/front", url: MOCK_FRONT_URL }];
    const t = task({ prUrls: JSON.stringify(prUrls) });
    return (
      <SeedMergeStates
        taskId={t.id}
        states={[
          {
            repo: "mock/front",
            url: MOCK_FRONT_URL,
            number: 7,
            mergeState: "conflict",
            prState: "open",
            checkState: "failing",
          },
        ]}
      >
        <PrTab task={t} prUrls={prUrls} initialDraft={DRAFT} />
      </SeedMergeStates>
    );
  },
};
