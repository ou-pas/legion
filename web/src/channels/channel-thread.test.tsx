// Where is what waits, and how many times? Not "is it prettier" but "how many times is the same
// question on screen, and where", which can be counted. Since 07/09 the question and gate are IN the
// scrolling pane, as the last turn (a round questionnaire is two thousand pixels: outside the pane it
// crushed the thread, bounded it made a second scrollbar). Only the stream cut stays fixed above. The
// matching round no longer repeats the question, and with nothing to decide there is no action block.
//
// Later that day the last turn became a CARD linking to the question page, and these tests did not
// change: the thread receives a NODE (`pending.node`) and does not know its content.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ChannelThread } from "./channel-thread.js";
import { BRIEF, BRIEF_AT, FLUX } from "./fixtures.js";
import { CHANNELS_TEXT } from "./text.js";
import { transcript } from "./transcript.js";

// `ScrollArea` observes its size to decide whether to stick to the bottom; jsdom has no
// `ResizeObserver`. A silent one is enough: what is measured here is document ORDER.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

// `globals: false` in the config: without this cleanup the previous test's DOM stays.
afterEach(cleanup);

const segments = transcript(FLUX);
/** Body of the STILL OPEN round in `FLUX`, the one the channel raises into the band. */
const OPEN_QUESTION = "Three decisions before writing the spec.";

const thread = (props: Partial<Parameters<typeof ChannelThread>[0]> = {}) =>
  render(
    <ChannelThread
      brief={BRIEF}
      briefAuthor="Operator"
      briefAt={BRIEF_AT}
      segments={segments}
      agentName="spec"
      operatorName="Operator"
      {...props}
    />,
  );

describe("the thread and its action band", () => {
  it("sets NO band when nothing waits", () => {
    const { container } = thread();
    expect(container.querySelector(".ch-action")).toBeNull();
  });

  it("puts the question IN the scrolling pane, as the last turn, and only once", () => {
    const { container } = thread({
      pending: { inboxId: "i1", node: <div data-testid="answer">the form</div> },
    });

    const scroll = container.querySelector(".ui-scroll");
    const answer = container.querySelector("[data-testid=answer]");
    // `.ch-action` only exists for the `head` variant: `thread` renders its children as a fragment.
    expect(scroll).not.toBeNull();
    expect(answer).not.toBeNull();

    // The question asked in the thread is inside what scrolls, not in the fixed cut above.
    expect(scroll!.contains(answer)).toBe(true);
    // And LAST: after the thread, where `follow` puts the view on open.
    const stream =
      container.querySelector(".ch-stream, [data-stream]") ??
      scroll!.firstElementChild!.firstElementChild!;
    expect(stream.compareDocumentPosition(answer!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shrinks the raised round to a pointer: the question is not asked twice", () => {
    const { container } = thread({
      pending: { inboxId: "i1", node: <div data-testid="answer">the form</div> },
    });
    expect(container.textContent).toContain(CHANNELS_TEXT.round.promoted);
    expect(container.textContent).not.toContain(OPEN_QUESTION);
  });

  it("keeps the open round in place when the surface does not raise it (Interview tab)", () => {
    const { container } = thread();
    expect(container.textContent).toContain(OPEN_QUESTION);
    expect(container.textContent).not.toContain(CHANNELS_TEXT.round.promoted);
  });

  it("keeps the stream cut FIXED above the pane, and puts the decision in the thread with the question", () => {
    const { container } = thread({
      notice: <p data-testid="cut">stream cut</p>,
      footer: <p data-testid="gate">gate</p>,
    });
    const scroll = container.querySelector(".ui-scroll");
    const cut = container.querySelector("[data-testid=cut]");
    const gate = container.querySelector("[data-testid=gate]");
    // The cut must show whatever is read: outside the pane, before it.
    expect(scroll!.contains(cut)).toBe(false);
    expect(cut!.compareDocumentPosition(scroll!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The gate is one more turn in the conversation: inside, last.
    expect(scroll!.contains(gate)).toBe(true);
  });
});
