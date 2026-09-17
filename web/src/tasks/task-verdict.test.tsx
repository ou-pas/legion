// The one task page behaviour no pure function covers: a control's ABSENCE is a decision, not an
// oversight.
//
// The steering field only exists during `running`, the only state where a runtime listens
// (server/src/sessions/steering.ts). In the other live states a mute field is not greyed out: it is
// removed, with the reason written just above. A disabled control with a native `title` says nothing
// (Chrome, Safari). A regression here would be invisible: the field would come back, render fine,
// and sending would fail with a 409 on the operator's side.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type InboxItem } from "../api/inbox.js";
import { type Session } from "../api/sessions.js";
import { type Task } from "../api/tasks.js";
import { TaskVerdict } from "./task-verdict.js";
import { SESSION_STATUS } from "../api/sessions.js";
import { TASK_STATUS } from "../api/tasks.js";
import { COMPLEXITY } from "../api/tasks.js";
import { PRIORITY } from "../api/tasks.js";

afterEach(cleanup);

const task = (over: Partial<Task> = {}): Task => ({
  id: "t-1",
  projectId: "p-1",
  name: "Environments screen",
  description: "",
  status: TASK_STATUS.doing,
  assigneeAgentId: "a-1",
  modelOverride: null,
  approvalGate: false,
  readOnly: false,
  settledOutcome: null,
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
  branch: "feature/ecran-environnements-3f9a1c2b",
  createdAt: "2026-08-28T09:00:00.000Z",
  updatedAt: "2026-08-28T09:00:00.000Z",
  boardOrder: 1,
  editable: false,
  briefEditable: false,
  waitingFor: null,
  imageWait: null,
  runnerWait: null,
  chosenRunnerId: null,
  ...over,
});

const session = (over: Partial<Session> = {}): Session => ({
  id: "s-1",
  taskId: "t-1",
  agentId: "a-1",
  runnerId: "r-1",
  model: "opus",
  status: "running",
  costUsd: 0.42,
  resumeCount: 0,
  startedAt: "2026-08-28T09:00:00.000Z",
  endedAt: null,
  endReason: null,
  ...over,
});

// The verdict carries a `useQuery` since it shows the merge state (#71): without a provider ten cases
// hit "No QueryClient set". `retry: false`: a test does not retry.
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** An inbox entry with non-null `wakeAt`: out of quota or inertia pause depending on `reason`
 *  (10/09). That field is what `TaskVerdict` must read, never the mere presence of `wakeAt`. */
const wakeEntry = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: "i-1",
  kind: "text",
  body: "",
  evidence: null,
  impact: null,
  choices: null,
  form: null,
  taskId: "t-1",
  taskName: "Environments screen",
  agentName: "builder",
  sessionId: "s-1",
  createdAt: Date.parse("2026-08-28T09:00:00.000Z"),
  wakeAt: Date.now() + 3_600_000,
  waitForTaskId: null,
  waitForTaskName: null,
  waitForTaskStatus: null,
  reason: "quota-pause",
  answered: 0,
  total: 0,
  draft: null,
  draftAt: null,
  roundIndex: null,
  projectId: "p-1",
  ...over,
});

const verdict = (
  over: {
    task?: Task;
    session?: Session;
    events?: { type: string; data: Record<string, unknown> }[];
    steerable?: boolean;
    quotaPause?: InboxItem | null;
  } = {},
) =>
  render(
    <QueryClientProvider client={qc}>
      <TaskVerdict
        task={over.task ?? task()}
        session={over.session ?? session()}
        events={over.events ?? []}
        pendingPr={false}
        prUrls={[]}
        quotaPause={over.quotaPause ?? null}
        agentName="builder"
        onSteer={over.steerable === false ? undefined : () => Promise.resolve()}
        onOpenPr={() => {}}
        onOpenArtifacts={() => {}}
        onRelaunch={() => {}}
      />
    </QueryClientProvider>,
  );

describe("TaskVerdict: the steering field", () => {
  it("exists during `running`", () => {
    verdict({ session: session({ status: "running" }) });
    expect(screen.getByRole("textbox")).toBeDefined();
  });

  it("is ABSENT during `starting`, not greyed, and the reason is written", () => {
    verdict({ session: session({ status: "starting" }) });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/its runtime is not listening yet/)).toBeDefined();
  });

  it("is ABSENT during `committing`, not greyed, and the reason is written", () => {
    verdict({ session: session({ status: "committing" }) });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/it no longer listens/)).toBeDefined();
  });

  it("disappears when nobody listens on the page side (no session to talk to)", () => {
    verdict({ session: session({ status: "running" }), steerable: false });
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("TaskVerdict: the four faces", () => {
  it('renders nothing at all without a session: "Run" is already offered elsewhere', () => {
    const { container } = render(
      <QueryClientProvider client={qc}>
        <TaskVerdict
          task={task({ status: TASK_STATUS.todo })}
          events={[]}
          pendingPr={false}
          prUrls={[]}
          quotaPause={null}
          onOpenPr={() => {}}
          onOpenArtifacts={() => {}}
          onRelaunch={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("during `running` without a tool, the line still exists, otherwise the field jumped 17px", () => {
    verdict({ session: session({ status: "running" }), events: [] });
    expect(screen.getByText(/no tool running/)).toBeDefined();
  });

  it("on an ordinary inbox pause, it says the agent waits for an answer", () => {
    verdict({ session: session({ status: SESSION_STATUS.waiting }) });
    expect(screen.getByText(/The agent is waiting for your answer/)).toBeDefined();
  });

  it("on a failure, it offers to run again, unless the task is blocked by another", () => {
    verdict({ session: session({ status: "failed", endedAt: "2026-08-28T09:10:00.000Z" }) });
    expect(screen.getByText("Run the task again")).toBeDefined();
    cleanup();
    verdict({
      task: task({ blockedBy: [{ id: "t-0", name: "Relais backend", status: TASK_STATUS.later }] }),
      session: session({ status: "failed", endedAt: "2026-08-28T09:10:00.000Z" }),
    });
    expect(screen.queryByText("Run the task again")).toBeNull();
  });

  it("on a successful end, it states what was pushed", () => {
    verdict({
      session: session({ status: "destroyed", endedAt: "2026-08-28T09:10:00.000Z" }),
      events: [
        { type: "result", data: { subtype: "success" } },
        { type: "repo_push", data: { repo: "legion", changes: 4, commit: "a1b2c3" } },
      ],
    });
    expect(screen.getByText("Finished successfully")).toBeDefined();
    // The SHA stays in the runtime panel: here the branch is enough to say "pushed".
    expect(screen.queryByText("a1b2c3")).toBeNull();
  });
});

// Change request solidarity: the server only completes the task once ALL are merged, never said on
// screen before. Real case on 03/09: two repos, two requests.
const SOLIDARITY_FRONT_URL = "https://framagit.org/3idprint/front/-/merge_requests/15";
const SOLIDARITY_API_URL = "https://framagit.org/3idprint/api/-/merge_requests/22";

describe("TaskVerdict: change request solidarity", () => {
  const front = { repo: "front", url: SOLIDARITY_FRONT_URL };
  const api = { repo: "api", url: SOLIDARITY_API_URL };
  const prUrls = [front, api];
  const done = () => session({ status: "destroyed", endedAt: "2026-08-28T09:10:00.000Z" });
  const results = [{ type: "result", data: { subtype: "success" } }];

  it("a single request: no solidarity mention, no noise in the common case", () => {
    render(
      <QueryClientProvider client={qc}>
        <TaskVerdict
          task={task()}
          session={done()}
          events={results}
          pendingPr={false}
          prUrls={[front]}
          quotaPause={null}
          onOpenPr={() => {}}
          onOpenArtifacts={() => {}}
          onRelaunch={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/merged/)).toBeNull();
  });

  it("two requests, one merged: shows the count and names the waiting repo", () => {
    qc.setQueryData(
      ["pr-merge-state", "t-2"],
      [
        {
          repo: "front",
          url: SOLIDARITY_FRONT_URL,
          number: 15,
          mergeState: "mergeable",
          prState: "merged",
        },
        {
          repo: "api",
          url: SOLIDARITY_API_URL,
          number: 22,
          mergeState: "mergeable",
          prState: "open",
        },
      ],
    );
    render(
      <QueryClientProvider client={qc}>
        <TaskVerdict
          task={task({ id: "t-2" })}
          session={done()}
          events={results}
          pendingPr={false}
          prUrls={prUrls}
          quotaPause={null}
          onOpenPr={() => {}}
          onOpenArtifacts={() => {}}
          onRelaunch={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/1 of 2 merged/)).toBeDefined();
    expect(screen.getByText(/api is waiting/)).toBeDefined();
  });

  it('an unknown state is never rendered as "not merged yet"', () => {
    qc.setQueryData(
      ["pr-merge-state", "t-3"],
      [
        {
          repo: "front",
          url: SOLIDARITY_FRONT_URL,
          number: 15,
          mergeState: "mergeable",
          prState: "merged",
        },
        { repo: "api", url: SOLIDARITY_API_URL, number: null, mergeState: "unknown" }, // no prState
      ],
    );
    render(
      <QueryClientProvider client={qc}>
        <TaskVerdict
          task={task({ id: "t-3" })}
          session={done()}
          events={results}
          pendingPr={false}
          prUrls={prUrls}
          quotaPause={null}
          onOpenPr={() => {}}
          onOpenArtifacts={() => {}}
          onRelaunch={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/api is waiting/)).toBeNull();
    expect(screen.getByText(/state of api not known yet/)).toBeDefined();
  });
});

// The verdict used to READ `task.externalRef` (the branch): an unreadable JSON column threw DURING
// render and blanked the whole page, without a message. What matters is not the value shown but that
// the component renders.
//
// It no longer reads it since 14/09 (the branch joined "Runtime & context"). The value assertion
// left, and the guard lives where the read lives now: `task-branch.test.ts`. This test keeps the half
// that caused the bug: this component renders whatever the column holds.
describe("TaskVerdict: an unreadable JSON column does not blank the page", () => {
  it('renders with `externalRef: "not json"`', () => {
    verdict({
      task: task({ externalRef: "not json" }),
      session: session({ status: "destroyed", endedAt: "2026-08-28T09:10:00.000Z" }),
      events: [
        { type: "result", data: { subtype: "success" } },
        { type: "repo_push", data: { repo: "legion", changes: 4, commit: "a1b2c3" } },
      ],
    });
    expect(screen.getByText("Finished successfully")).toBeDefined();
  });
});

// Inertia pause criterion 8 (10/09): a chain of resumes must read without opening the trace, and a
// turns relaunch must never read as a quota incident.
describe("TaskVerdict: resumes", () => {
  it("keeps quiet about the resume count on a session never relaunched", () => {
    verdict({ session: session({ resumeCount: 0 }) });
    expect(screen.queryByText(/resume/)).toBeNull();
  });

  it("shows the resume count without opening the trace", () => {
    verdict({ session: session({ resumeCount: 3 }) });
    expect(screen.getByText(/3.*resume/)).toBeDefined();
  });

  it("tells the inertia pause from the out-of-quota pause: same wakeAt, different cause", () => {
    verdict({
      session: session({ status: SESSION_STATUS.waiting }),
      quotaPause: wakeEntry({ reason: "turn-relaunch" }),
    });
    expect(screen.getByText(/Turn budget spent/)).toBeDefined();
    expect(screen.queryByText(/Out of quota/)).toBeNull();
  });

  it('keeps the "Out of quota" verdict on a real quota pause', () => {
    verdict({
      session: session({ status: SESSION_STATUS.waiting }),
      quotaPause: wakeEntry({ reason: "quota-pause" }),
    });
    expect(screen.getByText(/Out of quota/)).toBeDefined();
  });
});
