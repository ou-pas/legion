// An inbox form's entry point. It renders the questionnaire since 07/09; this pins what must not move
// whatever the rendering: A ROUND IS NOT SENT ON ENTER (seven questions, Enter in a field, and
// everything left: that trapped the operator), and a one-question round sends without rail or recap.
// The full flow is in inbox-questionnaire.test.tsx; the "at least two fields" boundary lives in
// `round-shape.ts` and is tested with the card (`inbox-card.test.tsx`).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormSpec } from "../api/inbox.js";
import { InboxForm } from "./inbox-form.js";
import { INBOX_TEXT } from "./text.js";

const NAME: FormSpec["blocks"][number] = {
  kind: "field",
  field: {
    id: "name",
    label: "Branch name",
    type: "text",
    required: true,
    placeholder: "feat/…",
  },
};
const NOTE: FormSpec["blocks"][number] = {
  kind: "field",
  field: { id: "note", label: "Remarks", type: "textarea", placeholder: "Short notes…" },
};

// `globals: false` in the config: without this cleanup the previous test's DOM stays.
afterEach(cleanup);

function mount(spec: FormSpec) {
  const onSubmit = vi.fn();
  render(<InboxForm spec={spec} pending={false} onSubmit={onSubmit} />);
  return onSubmit;
}

describe("the inbox form", () => {
  it("one field: no rail or recap, just field, comment and send", () => {
    const onSubmit = mount({ blocks: [NAME] });
    expect(screen.queryByRole("navigation")).toBeNull();
    const name = screen.getByPlaceholderText("feat/…");
    fireEvent.change(name, { target: { value: "feat/inbox" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: INBOX_TEXT.questionnaire.send(1) }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "feat/inbox" });
  });

  it("two fields: a rail, one question at a time, and Enter in a textarea stays a new line", () => {
    const onSubmit = mount({ blocks: [NAME, NOTE] });
    expect(
      screen.getByRole("navigation", { name: INBOX_TEXT.questionnaire.railLabel }),
    ).toBeDefined();
    expect(screen.queryByPlaceholderText("Short notes…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: INBOX_TEXT.questionnaire.next }));
    const note = screen.getByPlaceholderText("Short notes…");
    fireEvent.keyDown(note, { key: "Enter" });
    fireEvent.keyDown(note, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("⌘+Enter never sends while a required field is empty, and says so naming the question", () => {
    const onSubmit = mount({ blocks: [NAME, NOTE] });
    fireEvent.keyDown(screen.getByPlaceholderText("feat/…"), { key: "Enter", metaKey: true });
    fireEvent.keyDown(screen.getByPlaceholderText("Short notes…"), {
      key: "Enter",
      metaKey: true,
    });
    fireEvent.keyDown(screen.getByRole("heading", { name: INBOX_TEXT.questionnaire.recap.title }), {
      key: "Enter",
      metaKey: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(INBOX_TEXT.questionnaire.missing([1]))).toBeDefined();
  });
});
