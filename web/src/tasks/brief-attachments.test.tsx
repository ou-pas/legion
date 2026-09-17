// What this file protects, on screen:
//  1. removal EXISTS and names its file (a chip that cannot be undone is a file attached forever);
//  2. while a session runs, the drop zone DISAPPEARS and the reason is spelled out, never a greyed
//     button with a `title` Chrome does not show on `disabled`;
//  3. without an address (composer: the task does not exist yet), a chip does not look like a
//     preview button that would do nothing.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BriefAttachments } from "./brief-attachments.js";
import { TASK_PAGE_TEXT as T } from "./text/task-page.js";

afterEach(cleanup);

const files = [
  { name: "capture.png", size: 812_000, kind: "image" as const },
  { name: "notes.md", size: 4_200, kind: "text" as const },
];

describe("BriefAttachments", () => {
  it("lists attached files and offers a NAMED removal for each", () => {
    const onRemove = vi.fn();
    render(<BriefAttachments attachments={files} onAdd={() => {}} onRemove={onRemove} />);
    expect(screen.getByText("capture.png")).toBeTruthy();
    expect(screen.getByText("notes.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: T.attachments.remove("notes.md") }));
    expect(onRemove).toHaveBeenCalledWith("notes.md");
  });

  it("without add rights, no drop zone, and the lock is READABLE, not inferred", () => {
    render(<BriefAttachments attachments={files} locked={T.attachments.locked} />);
    expect(screen.queryByText(T.attachments.dropLabel)).toBeNull();
    expect(screen.getByText(T.attachments.locked)).toBeTruthy();
    expect(document.querySelector("input[type=file]")).toBeNull();
  });

  it("during a session: attaching still works, removal does not, and the removal lock reads", () => {
    render(<BriefAttachments attachments={files} onAdd={() => {}} locked={T.attachments.locked} />);
    expect(screen.getByText(T.attachments.dropLabel)).toBeTruthy();
    expect(screen.queryByRole("button", { name: T.attachments.remove("notes.md") })).toBeNull();
    expect(screen.getByText(T.attachments.locked)).toBeTruthy();
  });

  it("after a drop during a session, the file's fate is WRITTEN: forwarded, or for the next one", () => {
    const { unmount } = render(
      <BriefAttachments attachments={files} onAdd={() => {}} notice={T.attachments.steered} />,
    );
    expect(screen.getByText(T.attachments.steered)).toBeTruthy();
    unmount();
    render(<BriefAttachments attachments={files} onAdd={() => {}} notice={T.attachments.queued} />);
    expect(screen.getByText(T.attachments.queued)).toBeTruthy();
  });

  it("a refusal shows ON the drop zone, in place of its label", () => {
    const refusal = T.attachments.tooLarge("enorme.psd");
    render(<BriefAttachments attachments={[]} onAdd={() => {}} refusal={refusal} />);
    expect(screen.getByText(refusal)).toBeTruthy();
    expect(screen.queryByText(T.attachments.dropLabel)).toBeNull();
  });

  it("picking a file passes REAL Files up to the caller", () => {
    const onAdd = vi.fn();
    render(<BriefAttachments attachments={[]} onAdd={onAdd} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "capture.png")] } });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]?.[0]?.[0]?.name).toBe("capture.png");
  });

  it("with an address a chip opens the preview; without one it promises none", () => {
    const { unmount } = render(
      <BriefAttachments attachments={files} urlOf={(n) => `/api/tasks/t1/attachments/${n}`} />,
    );
    fireEvent.click(screen.getByText("capture.png"));
    expect((screen.getByAltText("capture.png") as HTMLImageElement).src).toContain(
      "/api/tasks/t1/attachments/capture.png",
    );
    unmount();

    render(<BriefAttachments attachments={files} onAdd={() => {}} />);
    fireEvent.click(screen.getByText("capture.png"));
    expect(document.querySelector("img")).toBeNull();
  });

  it("nothing to show and nothing to do: no orphan heading is left", () => {
    const { container } = render(<BriefAttachments attachments={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
