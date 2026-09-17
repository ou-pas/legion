// The questionnaire (07/09, direction A): one question per screen, a rail, a recap. Pinned: navigation
// (buttons, rail, ⌘↵), focus following the screen, preselected recommendations, sending blocked while a
// required answer is missing (naming the question), and the round comment sent under `__comment`.
// Plain Enter never sends.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FORM_COMMENT_KEY, type FormSpec } from "../api/inbox.js";
import { ENTER, MOD } from "../ui/platform.js";
import { InboxQuestionnaire } from "./inbox-questionnaire.js";
import { INBOX_TEXT } from "./text.js";

/** The shortcut hint (ui/submit-shortcut.tsx) reads in `.ui-btn-shortcut`, one pill per key (D2), not a
 *  string: its text concatenates both keys without separator. */
const shortcutOf = (button: HTMLElement) => button.querySelector(".ui-btn-shortcut")?.textContent;

const T = INBOX_TEXT.questionnaire;

const SPEC: FormSpec = {
  blocks: [
    { kind: "markdown", text: "## 1. The shape\n\nLook at the right panel." },
    {
      kind: "field",
      field: {
        id: "shape",
        label: "Subtitle shape",
        type: "radio",
        required: true,
        default: "b",
        hint: "B keeps the other cards' shape.",
        options: [
          { id: "a", label: "A — valeurs seules" },
          { id: "b", label: "B — label + values" },
        ],
      },
    },
    { kind: "markdown", text: "Real example: tag_names." },
    {
      kind: "field",
      field: {
        id: "branch",
        label: "Branch name",
        type: "text",
        required: true,
        placeholder: "feat/…",
      },
    },
    { kind: "field", field: { id: "e2e", label: "E2E lifted", type: "checkbox", default: true } },
  ],
};

afterEach(cleanup);

function mount(spec: FormSpec = SPEC) {
  const onSubmit = vi.fn();
  render(<InboxQuestionnaire spec={spec} pending={false} onSubmit={onSubmit} />);
  return { onSubmit };
}
const next = () => fireEvent.click(screen.getByRole("button", { name: T.next }));
const heading = (name: string) => screen.getByRole("heading", { name });

describe("the inbox questionnaire", () => {
  it("shows ONE question and its argument, without the agent heading line: the title is the label", () => {
    mount();
    expect(heading("Subtitle shape")).toBeDefined();
    expect(screen.getByText("Look at the right panel.")).toBeDefined();
    expect(screen.queryByText(/1\. La forme/)).toBeNull();
    expect(screen.queryByText("Real example: tag_names.")).toBeNull();
  });

  it("the agent's recommendation is preselected, labelled, with its reason under it", () => {
    mount();
    expect(screen.getByRole("radio", { name: /B — label/ })).toHaveProperty("checked", true);
    expect(screen.getByText("B keeps the other cards' shape.")).toBeDefined();
    expect(screen.getAllByText(T.recommended).length).toBeGreaterThan(0);
  });

  it("the shortcut reads on Next and on send, as pills not a caption (D1, D2)", () => {
    mount();
    expect(shortcutOf(screen.getByRole("button", { name: T.next }))).toBe(MOD + ENTER);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(T.recap.nav) }));
    expect(shortcutOf(screen.getByRole("button", { name: T.send(3) }))).toBe(MOD + ENTER);
  });

  it("Next / Previous / rail change screen, and focus goes to the title", () => {
    mount();
    next();
    expect(screen.getByText("Real example: tag_names.")).toBeDefined();
    expect(document.activeElement).toBe(heading("Branch name"));
    fireEvent.click(screen.getByRole("button", { name: T.prev }));
    expect(document.activeElement).toBe(heading("Subtitle shape"));
    fireEvent.click(screen.getByRole("button", { name: /E2E lifted/ }));
    expect(heading("E2E lifted")).toBeDefined();
  });

  it('the rail carries the chosen answer under each question, or the recommendation, or "to decide"', () => {
    mount();
    const rail = screen.getByRole("navigation", { name: T.railLabel });
    expect(rail.textContent).toContain(T.recommendedValue("B — label + values"));
    expect(rail.textContent).toContain(T.toDecide);
    next();
    expect(rail.textContent).toContain("B — label + values");
    expect(rail.textContent).not.toContain(T.recommendedValue("B — label + values"));
  });

  it("Enter does nothing; ⌘↵ moves to the next, then sends from the recap", () => {
    const { onSubmit } = mount();
    next();
    const branch = screen.getByPlaceholderText("feat/…");
    fireEvent.change(branch, { target: { value: "feat/inbox" } });
    fireEvent.keyDown(branch, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(branch, { key: "Enter", metaKey: true });
    fireEvent.keyDown(heading("E2E lifted"), { key: "Enter", ctrlKey: true });
    expect(heading(T.recap.title)).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(heading(T.recap.title), { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith({ shape: "b", branch: "feat/inbox", e2e: true });
  });

  it("⌘↵ ALSO works when nothing inside has focus: the page just opened (07/09, evening)", () => {
    mount();
    // Focus is on the document, as after a navigation: the announced shortcut must still advance.
    // Once, not twice (the inner handler does not get the event, only the window answers).
    fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
    expect(
      heading(SPEC.blocks.flatMap((b) => (b.kind === "field" ? [b.field.label] : []))[1]!),
    ).toBeDefined();
  });

  it("⌘↵ in an input OUTSIDE the questionnaire does not move the screen", () => {
    mount();
    const outside = document.createElement("textarea");
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.keyDown(outside, { key: "Enter", metaKey: true });
    expect(
      heading(SPEC.blocks.flatMap((b) => (b.kind === "field" ? [b.field.label] : []))[0]!),
    ).toBeDefined();
    outside.remove();
  });

  it("sending is blocked while a required answer is missing, naming the question; edit leads back to it", () => {
    const { onSubmit } = mount();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(T.recap.nav) }));
    expect(screen.getByText(T.missing([2]))).toBeDefined();
    const send = screen.getByRole("button", { name: T.send(3) });
    expect(send).toHaveProperty("disabled", true);
    fireEvent.keyDown(heading(T.recap.title), { key: "Enter", metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: T.recap.editLabel("Branch name") }));
    expect(document.activeElement).toBe(heading("Branch name"));
  });

  it("the round comment goes under `__comment`, only if it says something", () => {
    const { onSubmit } = mount();
    next();
    fireEvent.change(screen.getByPlaceholderText("feat/…"), { target: { value: "feat/inbox" } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(T.recap.nav) }));
    fireEvent.change(screen.getByLabelText(T.comment), {
      target: { value: "  object case first " },
    });
    fireEvent.click(screen.getByRole("button", { name: T.send(3) }));
    expect(onSubmit).toHaveBeenCalledWith({
      shape: "b",
      branch: "feat/inbox",
      e2e: true,
      [FORM_COMMENT_KEY]: "object case first",
    });
  });

  it("each question has its note (08/09): sent under `<id>__note`, reread at the recap, and an empty note is not sent", () => {
    const { onSubmit } = mount();
    fireEvent.change(screen.getByLabelText(T.note), {
      target: { value: " only if q2 follows " },
    });
    next();
    fireEvent.change(screen.getByPlaceholderText("feat/…"), { target: { value: "feat/inbox" } });
    fireEvent.change(screen.getByLabelText(T.note), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(T.recap.nav) }));
    expect(screen.getByText(T.noteRead("only if q2 follows"))).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: T.send(3) }));
    expect(onSubmit).toHaveBeenCalledWith({
      shape: "b",
      branch: "feat/inbox",
      e2e: true,
      shape__note: " only if q2 follows ",
    });
  });

  it("a single field: no rail, comment and send under the options", () => {
    const { onSubmit } = mount({ blocks: [SPEC.blocks[1]!] });
    expect(screen.queryByRole("navigation")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /A — valeurs/ }));
    fireEvent.change(screen.getByLabelText(T.comment), { target: { value: "vu" } });
    fireEvent.keyDown(screen.getByLabelText(T.comment), { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith({ shape: "a", [FORM_COMMENT_KEY]: "vu" });
  });
});
