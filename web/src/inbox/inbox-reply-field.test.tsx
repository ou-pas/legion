// The free answer field no longer sends on Enter (07/09): the operator pressed it by mistake and the
// answer went to the agent. Only the button and ⌘/Ctrl+Enter send, and the button says so in its
// tooltip.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxReplyField } from "./inbox-reply-field.js";
import { INBOX_TEXT } from "./text.js";

const sendButton = () => screen.getByRole("button");

// `globals: false` in the config: without this cleanup the previous test's DOM stays.
afterEach(cleanup);

function mount(over: Partial<Parameters<typeof InboxReplyField>[0]> = {}) {
  const onSend = vi.fn();
  render(
    <InboxReplyField
      item={{ agentName: "senior-dev", choices: null }}
      pending={false}
      onSend={onSend}
      {...over}
    />,
  );
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "yes, go ahead" } });
  return { onSend, input };
}

describe("the free answer field", () => {
  it("plain Enter does not send", () => {
    const { onSend, input } = mount();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("⌘+Enter sends the typed text", () => {
    const { onSend, input } = mount();
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledWith("yes, go ahead");
  });

  it("Ctrl+Enter sends too", () => {
    const { onSend, input } = mount();
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith("yes, go ahead");
  });

  it("the button sends", () => {
    const { onSend } = mount();
    fireEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledWith("yes, go ahead");
  });

  it("nothing leaves while the field is empty or a send is in flight", () => {
    const onSend = vi.fn();
    render(
      <InboxReplyField
        item={{ agentName: "senior-dev", choices: null }}
        pending={false}
        onSend={onSend}
      />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", metaKey: true });
    expect(onSend).not.toHaveBeenCalled();
    cleanup();
    const { onSend: busy, input } = mount({ pending: true });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(busy).not.toHaveBeenCalled();
  });

  // A screenshot alone is an answer (16/09): without this rule the gesture stopped on a greyed button.
  it("an attached screenshot is enough to send, with an empty field", () => {
    const onSend = vi.fn();
    render(
      <InboxReplyField
        item={{ agentName: "senior-dev", choices: null }}
        pending={false}
        onSend={onSend}
        attachments={{
          picked: [{ name: "screenshot.png", size: 12, contentBase64: "AAA=" }],
          refusal: null,
          busy: false,
          add: () => {},
          paste: () => {},
          remove: () => {},
          clear: () => {},
          upload: () => Promise.resolve(),
          uploadThen: (_id, send) => (send(), Promise.resolve()),
        }}
      />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledWith("");
  });

  it("states the shortcut in the button tooltip, and stays silent when the form already does", () => {
    mount();
    expect(sendButton().getAttribute("aria-label")).toContain(INBOX_TEXT.sendShortcut);
    cleanup();
    mount({ hint: false });
    expect(sendButton().getAttribute("aria-label")).not.toContain(INBOX_TEXT.sendShortcut);
  });
});
