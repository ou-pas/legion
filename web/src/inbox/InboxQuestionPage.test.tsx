// A question's page (07/09).
//
// The switch: open, the page renders the questionnaire; answered, the read view. Same URL, same
// component, which makes history free: an answer from elsewhere (another tab) freezes the page through
// cache invalidation alone. Local state would need another mechanism and be wrong on reload.
//
// The draft is LOADED, not forgotten: a resumed round must show what was decided, or it gets answered
// twice. That is what justifies v62's two columns.
//
// The route tree is the REAL one: a copied tree would only prove its own consistency, and the page
// builds four links (channel, task, rounds, back), exactly what a fake router would let through.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { InboxQuestionDetail } from "../api/inbox.js";
import { INBOX_STATUS } from "../api/inbox.js";
import { routeTree } from "../router.js";
import { qk } from "../queries.js";
import { TASK_STATUS } from "../api/tasks.js";
import { AI_2219_ROUND_2 } from "./inbox-round-fixture.js";
import { INBOX_TEXT } from "./text.js";

afterEach(cleanup);

const PROJECT = "p1";
const TASK = "t1";
const INBOX = "i1";
const T = INBOX_TEXT.question;

const question = (over: Partial<InboxQuestionDetail> = {}): InboxQuestionDetail => ({
  id: INBOX,
  kind: "form",
  status: INBOX_STATUS.open,
  body: "Round 2 — 6 questions",
  evidence: null,
  impact: null,
  choices: null,
  form: AI_2219_ROUND_2,
  reason: "question",
  sessionId: "s1",
  createdAt: Date.parse("2026-09-07T15:00:00Z"),
  draft: null,
  draftAt: null,
  answer: null,
  task: {
    id: TASK,
    name: "AI-2219 — Add tags to tickets",
    projectId: PROJECT,
    status: TASK_STATUS.doing,
  },
  agent: { name: "interviewer" },
  rounds: [
    {
      id: "i0",
      body: "Round 1",
      status: INBOX_STATUS.answered,
      createdAt: 1,
      answeredAt: 2,
      fieldCount: 4,
      answeredCount: 4,
    },
    {
      id: INBOX,
      body: "Round 2",
      status: INBOX_STATUS.open,
      createdAt: 3,
      answeredAt: null,
      fieldCount: 6,
      answeredCount: 0,
    },
  ],
  ...over,
});

/** The cache is SEEDED, never served: the page must not hit the network in a test. The bootstrap is
 *  seeded as in `router.test.ts`, since `projectRoute` refuses an unknown project id, which keeps the
 *  mount realistic. */
async function mount(q: InboxQuestionDetail) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(qk.bootstrap, {
    projects: [{ id: PROJECT, name: "Acme", slug: "acme" }],
    agents: [],
    templates: [],
  });
  queryClient.setQueryData(qk.tasks, { tasks: [], sessions: [] });
  queryClient.setQueryData(qk.inboxQuestion(q.id), q);
  queryClient.setQueryData(qk.taskLinks(TASK), { parent: null, children: [] });
  const history = createMemoryHistory({ initialEntries: [`/p/${PROJECT}/inbox/${q.id}`] });
  const router = createRouter({ routeTree, history, context: { queryClient } });
  await router.load();
  // The provider, as in `main.tsx`: the router carries the client in its CONTEXT (for loaders),
  // components read it through React context. Both are needed; the second was missing and the page
  // hit "No QueryClient set".
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  // The screen is a deferred chunk (`app/screens.ts`): it arrives after a loop tick.
  await waitFor(() => expect(screen.getByText(q.body)).toBeDefined());
  return { router, queryClient };
}

describe("an item that is NOT a round has no page (07/09, evening)", () => {
  // Seen in production: AI-2200's out-of-quota notice, opened from a list, showed "Round 1 of 3" and an
  // empty read view. The server excludes notices from `rounds`; the page must read that absence, not
  // number it.
  const notice = question({
    id: "i-quota",
    kind: "text",
    body: "Out of quota: the 5 h window is used up. I resume by myself Mon 17:03.",
    form: null,
    reason: "quota-pause",
    rounds: [
      {
        id: "i0",
        body: "Round 1",
        status: INBOX_STATUS.answered,
        createdAt: 1,
        answeredAt: 2,
        fieldCount: 4,
        answeredCount: 4,
      },
      {
        id: "i3",
        body: "Round 3",
        status: INBOX_STATUS.open,
        createdAt: 5,
        answeredAt: null,
        fieldCount: 6,
        answeredCount: 0,
      },
    ],
  });

  it("says the item is answered on its card, and points to the channel", async () => {
    await mount(notice);
    expect(screen.getByText(T.notRound)).toBeDefined();
    // One exit to the channel, the bar's: the empty state adds no second one.
    expect(screen.getAllByRole("link", { name: T.openChannel })).toHaveLength(1);
  });

  it("does not number it nor show the rounds bar", async () => {
    await mount(notice);
    expect(screen.queryByText(T.roundCrumb(1))).toBeNull();
    expect(screen.queryByText(T.roundsLabel)).toBeNull();
    // And never the empty read view of a form that does not exist.
    expect(screen.queryByText(T.readLead)).toBeNull();
  });
});

describe("open: the questionnaire has the whole page", () => {
  it("renders the first question and the rail, never a card", async () => {
    await mount(question());
    // The page title is the TASK's; the question body is below.
    expect(screen.getByRole("heading", { name: /AI-2219/ })).toBeDefined();
    // Question 1's screen, identified by its field label (the rail already numbers it).
    expect(
      screen.getByRole("heading", { name: /In the right panel of the tags node/ }),
    ).toBeDefined();
    // The card's answer gesture has no place here: we ARE there.
    expect(screen.queryByText(INBOX_TEXT.card.answer)).toBeNull();
  });

  it("THE DRAFT COMING BACK FROM THE SERVER DOES NOT REMOUNT THE SCREEN (08/09): we stay where we were", async () => {
    // 08/09 morning: every selection sent back to question 1. Our own write returns a NEW `draftAt`,
    // and the page remounted the questionnaire on it. Local state is authoritative while typing; the
    // server is only read at mount.
    const { queryClient } = await mount(question({ draft: null, draftAt: null }));
    fireEvent.click(screen.getByRole("button", { name: INBOX_TEXT.questionnaire.next }));
    const secondQuestion = () =>
      screen.queryByRole("heading", { name: /What should the line under the tool name/ });
    expect(secondQuestion()).toBeDefined();
    queryClient.setQueryData(
      qk.inboxQuestion(INBOX),
      question({ draft: { panel_state: "filled" }, draftAt: Date.now() }),
    );
    await waitFor(() => expect(secondQuestion()).toBeDefined());
    expect(
      screen.queryByRole("heading", { name: /In the right panel of the tags node/ }),
    ).toBeNull();
  });

  it("THE DRAFT IS LOADED: what is already decided shows in the rail", async () => {
    await mount(
      question({ draft: { panel_state: "filled", line_format: "b" }, draftAt: Date.now() }),
    );
    // Question 2 is not the displayed screen: its answer label can only come from the RAIL, so the
    // draft. That is the check that counts, since question 1's answer would show anyway as the
    // current screen's checked option.
    expect(screen.getByText("B — human label + values")).toBeDefined();
    // Question 1 is the current screen: its answer is both in the rail and on the option.
    expect(
      screen.getAllByText('A "tag_names" field that does contain LaPoste_Colissimo').length,
    ).toBeGreaterThan(1);
  });

  it("the rounds bar leads to the other round, and the current round is not a link", async () => {
    await mount(question());
    const other = screen.getByRole("link", { name: T.roundPill(1, 4) });
    expect(other.getAttribute("href")).toBe(`/p/${PROJECT}/inbox/i0`);
    // Round 2 is the one being read: `aria-current` and no href.
    expect(screen.queryByRole("link", { name: /Round 2/ })).toBeNull();
  });

  it("both exits exist: the channel and the task page", async () => {
    await mount(question());
    expect(screen.getByRole("link", { name: T.openChannel }).getAttribute("href")).toBe(
      `/p/${PROJECT}/channels/${TASK}`,
    );
    expect(screen.getByRole("link", { name: T.openTask }).getAttribute("href")).toBe(
      `/p/${PROJECT}/tasks/${TASK}`,
    );
  });
});

describe("answered: the same page, frozen", () => {
  const answered = question({
    status: INBOX_STATUS.answered,
    draft: null,
    answer: {
      formData: {
        panel_state: "filled",
        line_format: "b",
        many_params: "keep",
        objects: "same",
        form_labels: "same-task",
        proof: true,
        __comment: "keep two commits",
      },
      text: "{}",
      answeredAt: Date.parse("2026-09-07T16:52:00Z"),
      answeredBy: "human",
    },
    rounds: [
      {
        id: "i0",
        body: "Round 1",
        status: INBOX_STATUS.answered,
        createdAt: 1,
        answeredAt: 2,
        fieldCount: 4,
        answeredCount: 4,
      },
      {
        id: INBOX,
        body: "Round 2",
        status: INBOX_STATUS.answered,
        createdAt: 3,
        answeredAt: 4,
        fieldCount: 6,
        answeredCount: 6,
      },
    ],
  });

  it("renders the answers and NO form", async () => {
    await mount(answered);
    expect(screen.getByText(T.readLead)).toBeDefined();
    // No control: the page is a document.
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("says who answered, and when", async () => {
    await mount(answered);
    expect(screen.getByText(/answered by you/)).toBeDefined();
  });

  it("WHAT WAS RULED OUT is said plainly: a decision rereads by what it refused", async () => {
    await mount(answered);
    // Question 5 recommended a separate task; the answer is the same task.
    expect(
      screen.getByText(T.discarded('Separate task: I\'ll file it under "Later"')),
    ).toBeDefined();
  });

  it("the round comment is a row, not an answer", async () => {
    await mount(answered);
    expect(screen.getByText(T.readComment)).toBeDefined();
    expect(screen.getByText("“keep two commits”")).toBeDefined();
  });
});
