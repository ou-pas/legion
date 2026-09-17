// Files waiting to be sent: what this test holds, and it is not decoration.
//
//  · A paste is renamed. The clipboard returns `image.png` for every capture and the server replaces
//    a taken name: without renaming, pasting two captures in a row would keep one, and the FIRST
//    would silently vanish.
//  · A text paste is not ours. The handler sits on the answer field: reacting to everything, pasting
//    a URL would make an empty file.
//  · A failing upload names its file and rejects. That keeps the answer from going out announcing a
//    capture that is nowhere.
import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tasksApi } from "../api/tasks.js";
import { usePickedAttachments, type PickedAttachmentsWiring } from "./use-picked-attachments.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A minimal host. Lifting goes through an EFFECT: writing to an outside variable during render is a
 *  side effect, and `react(globals)` rightly refuses it. */
function mount(): () => PickedAttachmentsWiring {
  let last: PickedAttachmentsWiring | null = null;
  function Porteur() {
    const files = usePickedAttachments();
    useEffect(() => {
      last = files;
    });
    return null;
  }
  render(<Porteur />);
  return () => {
    if (!last) throw new Error("the hook did not render");
    return last;
  };
}

const png = (bytes = 12) =>
  new File([new Uint8Array(bytes).fill(1)], "image.png", { type: "image/png" });

/** The event as the answer field receives it: only `clipboardData.files` matters. */
const pasteOf = (...files: File[]) =>
  ({ clipboardData: { files } }) as unknown as Parameters<PickedAttachmentsWiring["paste"]>[0];

describe("usePickedAttachments", () => {
  it('a paste enters the list under a timestamped name, not "image.png"', async () => {
    const files = mount();
    await act(async () => files().paste(pasteOf(png())));
    expect(files().picked).toHaveLength(1);
    expect(files().picked[0]?.name).toMatch(
      /^screenshot-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.png$/,
    );
  });

  it("two pastes in a row make TWO files: the second does not overwrite the first", async () => {
    const files = mount();
    await act(async () => files().paste(pasteOf(png())));
    await act(async () => files().paste(pasteOf(png(24))));
    expect(new Set(files().picked.map((p) => p.name)).size).toBe(2);
  });

  // A text paste is a NON-EVENT, not merely "zero files added": the handler sits on the answer field
  // and sees EVERY paste. If it went through anyway, it would clear the refusal just read and relight
  // the send button spinner (450ms floor) on every ⌘V of a URL.
  it("a text paste adds nothing and does not clear the shown refusal", async () => {
    const files = mount();
    await act(async () => files().add([new File([new Uint8Array(0)], "vide.png")]));
    const refus = files().refusal;
    expect(refus).toContain("vide.png");
    await act(async () => files().paste(pasteOf()));
    expect(files().picked).toEqual([]);
    expect(files().refusal).toBe(refus);
    expect(files().busy).toBe(false);
  });

  it("removing a file that never left calls nobody", async () => {
    const del = vi.spyOn(tasksApi, "deleteAttachment");
    const files = mount();
    await act(async () => files().paste(pasteOf()));
    await act(async () => files().add([png()]));
    await act(async () => files().remove("image.png"));
    expect(files().picked).toEqual([]);
    expect(del).not.toHaveBeenCalled();
  });

  it("upload sends everything, then clears the list", async () => {
    const up = vi.spyOn(tasksApi, "uploadAttachment").mockResolvedValue({} as never);
    const files = mount();
    await act(async () => files().add([png(), new File([new Uint8Array(3)], "notes.md")]));
    await act(async () => files().upload("t-1"));
    expect(up.mock.calls.map((c) => c[1].name)).toEqual(["image.png", "notes.md"]);
    expect(files().picked).toEqual([]);
  });

  // What STOPS the answer from going: the rejection. What makes the refusal usable: the name.
  it("a refused upload rejects, names its file, and keeps the list to retry", async () => {
    vi.spyOn(tasksApi, "uploadAttachment").mockRejectedValue(new Error("task not found"));
    const files = mount();
    await act(async () => files().add([png()]));
    await act(async () => {
      await expect(files().upload("t-1")).rejects.toThrow("task not found");
    });
    expect(files().refusal).toContain("image.png");
    expect(files().picked).toHaveLength(1);
  });

  // The order, held once for every caller (16/09). It lived copied at each call site
  // (`upload(id).then(send)`), exactly the defect that opened this work: "discuss" copied the "run"
  // sequence and forgot the half uploading the files.
  it("`uploadThen` uploads BEFORE sending, never after", async () => {
    const appels: string[] = [];
    vi.spyOn(tasksApi, "uploadAttachment").mockImplementation(
      async () => (appels.push("upload"), {}) as never,
    );
    const files = mount();
    await act(async () => files().add([png()]));
    await act(async () => files().uploadThen("t-1", () => void appels.push("send")));
    expect(appels).toEqual(["upload", "send"]);
  });

  it("and sends NOTHING when a file failed to upload", async () => {
    vi.spyOn(tasksApi, "uploadAttachment").mockRejectedValue(new Error("task not found"));
    const envoyer = vi.fn();
    const files = mount();
    await act(async () => files().add([png()]));
    await act(async () => files().uploadThen("t-1", envoyer));
    expect(envoyer).not.toHaveBeenCalled();
    expect(files().refusal).toContain("image.png");
  });

  // Without files `uploadThen` stays everyone's send path: it must hand over without uploading, or a
  // round answered without a capture would no longer go out.
  it("without files, it still sends", async () => {
    const up = vi.spyOn(tasksApi, "uploadAttachment");
    const envoyer = vi.fn();
    const files = mount();
    await act(async () => files().uploadThen("t-1", envoyer));
    expect(envoyer).toHaveBeenCalledOnce();
    expect(up).not.toHaveBeenCalled();
  });
});
