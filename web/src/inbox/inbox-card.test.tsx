// A question card (07/09).
//
// The boundary: a `form` of at least two fields renders NO field on the card, only a link to its page
// (decision of 07/09). That is what would be lost silently: one day the questionnaire gets plugged back
// "just for a three-question round" and the channel column gets its two scrollbars back.
//
// The gesture says which: Answer on a blank question, Resume on a draft, See answers on an answered
// one, so nobody reads the gauge to know what waits.
//
// What awaits nothing offers nothing: a task wait has neither field nor button; an out-of-quota pause
// keeps a field, because answering wakes it early.
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INBOX_KIND, type InboxItem } from "../api/inbox.js";
import { tasksApi } from "../api/tasks.js";
import { InboxCard, InboxCardRow } from "./inbox-card.js";
import { answerRows } from "./inbox-round-answers.js";
import { AI_2219_ROUND_2 } from "./inbox-round-fixture.js";
import { formFieldsOf } from "./round-shape.js";
import { INBOX_TEXT } from "./text.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = Date.parse("2026-09-07T17:00:00Z");
const MIN = 60_000;
const T = INBOX_TEXT.card;

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: "q1",
  kind: INBOX_KIND.form,
  body: "Round 1 — 6 questions",
  evidence: null,
  impact: null,
  choices: null,
  form: AI_2219_ROUND_2,
  taskId: "t1",
  taskName: "AI-2200",
  agentName: "interviewer",
  sessionId: "s1",
  projectId: "p1",
  createdAt: NOW - 112 * MIN,
  wakeAt: null,
  waitForTaskId: null,
  waitForTaskName: null,
  waitForTaskStatus: null,
  reason: "question",
  answered: 0,
  total: 6,
  draft: null,
  draftAt: null,
  roundIndex: 1,
  ...over,
});

/** The gesture rendered as a real link: the only way to check WHERE it leads. */
const link = (props: { className: string; children: React.ReactNode; "aria-label": string }) => (
  <a href="/p/p1/inbox/q1" {...props} />
);

describe("a multi-question round", () => {
  it("does NOT render the questionnaire: it leads to its page", () => {
    render(<InboxCard item={item()} now={NOW} render={link} onReply={vi.fn()} />);
    // No round option is on screen: the form's first label is absent.
    expect(screen.queryByText(/A "tag_names" field that does contain/)).toBeNull();
    const go = screen.getByRole("link", { name: T.answerLabel("Round 1 — 6 questions") });
    expect(go.getAttribute("href")).toBe("/p/p1/inbox/q1");
    expect(go.textContent).toBe(T.answer);
  });

  it("blank: Answer, and the gauge at zero", () => {
    render(<InboxCard item={item()} now={NOW} render={link} onReply={vi.fn()} />);
    expect(screen.getByText(T.progress(0, 6))).toBeDefined();
  });

  it("started: Resume, the answers given, and the draft age", () => {
    render(
      <InboxCard
        now={NOW}
        render={link}
        onReply={vi.fn()}
        item={item({
          answered: 2,
          draftAt: NOW - 12 * MIN,
          draft: { panel_state: "filled", line_format: "b" },
        })}
      />,
    );
    expect(screen.getByRole("link", { name: /^Resume —/ }).textContent).toBe(T.resume);
    expect(screen.getByText(T.progress(2, 6))).toBeDefined();
    expect(screen.getByText(T.draftAge("12 min"))).toBeDefined();
    // Values as option LABELS, not raw ids: what the human saw.
    expect(screen.getByText("B — human label + values")).toBeDefined();
  });

  it("answered: three answers, the rest counted, the comment, and See answers", () => {
    const rows = answerRows(formFieldsOf(AI_2219_ROUND_2), {
      panel_state: "filled",
      line_format: "b",
      many_params: "keep",
      objects: "same",
      form_labels: "same-task",
      proof: true,
    });
    render(
      <InboxCard
        now={NOW}
        render={link}
        item={item()}
        answer={{ rows, comment: "garde deux commits", answeredAt: NOW - 8 * MIN }}
      />,
    );
    expect(screen.getByRole("link", { name: /^See the answers —/ }).textContent).toBe(T.review);
    // Six answers, three shown, the rest counted.
    expect(screen.getByText(T.more(3))).toBeDefined();
    expect(screen.getByText(T.comment("garde deux commits"))).toBeDefined();
    // An answered card no longer offers the questionnaire either.
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("what is answered IN PLACE", () => {
  it("a text question: a field, no link", () => {
    const onReply = vi.fn();
    render(
      <InboxCard
        now={NOW}
        onReply={onReply}
        item={item({ kind: INBOX_KIND.text, form: null, total: 0 })}
      />,
    );
    expect(screen.getByRole("textbox")).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("a choice question: one button per option, and the click answers without leaving the screen", () => {
    const onReply = vi.fn();
    render(
      <InboxCard
        now={NOW}
        onReply={onReply}
        item={item({
          kind: INBOX_KIND.choice,
          form: null,
          total: 0,
          choices: [
            { id: "php", label: "Fournir PHP" },
            { id: "split", label: "Split" },
          ],
        })}
      />,
    );
    screen.getByRole("button", { name: "Split" }).click();
    expect(onReply).toHaveBeenCalledWith({ choiceId: "split" });
  });

  it("a ONE-field form stays inline: its options are on screen", () => {
    render(
      <InboxCard
        now={NOW}
        onReply={vi.fn()}
        item={item({
          total: 1,
          body: "Do we agree?",
          form: {
            blocks: [
              {
                kind: "field",
                field: {
                  id: "ok",
                  label: "Do we agree?",
                  type: "radio",
                  default: "yes",
                  options: [
                    { id: "yes", label: "Yes, file the task" },
                    { id: "no", label: "No, one more round" },
                  ],
                },
              },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText("Yes, file the task")).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("what awaits nothing from you", () => {
  it("a task wait SAYS so, and offers no field", () => {
    render(
      <InboxCard
        now={NOW}
        onReply={vi.fn()}
        item={item({
          kind: INBOX_KIND.text,
          form: null,
          total: 0,
          waitForTaskId: "t2",
          reason: "dependency",
        })}
      />,
    );
    expect(screen.getByText(T.nothingToAnswer)).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(T.sleeping("1 h 52"))).toBeDefined();
  });

  it("an out-of-quota pause keeps its field: answering wakes it early", () => {
    const wakeAt = Date.parse("2026-09-07T19:00:00Z");
    render(
      <InboxCard
        now={NOW}
        onReply={vi.fn()}
        item={item({ kind: INBOX_KIND.text, form: null, total: 0, wakeAt, reason: "quota-pause" })}
      />,
    );
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(T.wakePlaceholder);
  });
});

// A screenshot attached to the answer (16/09), and its only point checkable without a screen: ORDER.
// The session reads its attachments while building its resume prompt; uploading after the answer would
// restart an agent nobody told about the screenshot.
describe("the screenshot attached to the answer", () => {
  const question = () =>
    item({ kind: INBOX_KIND.text, form: null, total: 0, choices: null, taskId: "t-int" });
  // jsdom builds a real `ClipboardEvent` whose `clipboardData` is read-only and ignores init: it is set
  // afterwards on the NATIVE event, where React takes its own from.
  const coller = (file: File) => {
    const ev = createEvent.paste(screen.getByRole("textbox"));
    Object.defineProperty(ev, "clipboardData", { value: { files: [file] } });
    fireEvent(screen.getByRole("textbox"), ev);
  };
  // ⌘↵ rather than the button: the spinner floor (`useBusyFloor`, 450 ms) keeps it disabled right after
  // reading the file, a RENDERING matter, while this test is about order.
  const envoyer = () =>
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", metaKey: true });
  const capture = () => new File([new Uint8Array(8).fill(1)], "image.png", { type: "image/png" });

  it("uploads the file BEFORE the answer, never after", async () => {
    const appels: string[] = [];
    vi.spyOn(tasksApi, "uploadAttachment").mockImplementation(
      async () => (appels.push("upload"), {}) as never,
    );
    const onReply = vi.fn(() => void appels.push("reply"));
    render(<InboxCard now={NOW} onReply={onReply} item={question()} />);
    await act(async () => void coller(capture()));
    await act(async () => void envoyer());
    expect(appels).toEqual(["upload", "reply"]);
  });

  it("a refused upload holds the answer back, and names the file", async () => {
    vi.spyOn(tasksApi, "uploadAttachment").mockRejectedValue(new Error("task not found"));
    const onReply = vi.fn();
    render(<InboxCard now={NOW} onReply={onReply} item={question()} />);
    await act(async () => void coller(capture()));
    await act(async () => void envoyer());
    expect(onReply).not.toHaveBeenCalled();
    expect(screen.getByText(/screenshot-.*could not be attached/)).toBeDefined();
  });
});

describe("the row: the Inbox page's dense frame", () => {
  it("carries task, agent, gauge and gesture", () => {
    render(<InboxCardRow now={NOW} render={link} item={item({ answered: 2 })} />);
    expect(screen.getByText("AI-2200 · interviewer")).toBeDefined();
    expect(screen.getByText(T.progress(2, 6))).toBeDefined();
    expect(screen.getByRole("link", { name: /^Resume —/ })).toBeDefined();
  });

  it("a wait has no gesture: there is nothing to do", () => {
    render(
      <InboxCardRow
        now={NOW}
        render={link}
        item={item({ waitForTaskId: "t2", form: null, total: 0 })}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(T.waitState)).toBeDefined();
  });
});
