// What this file protects: the rule deciding what UPLOADS. A file too large or empty is refused
// BEFORE the network, by name, without dragging down the other files of the same drop: the
// difference between "refused: mockup.psd" and five files silently vanishing.
import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentNotice,
  pastedAttachmentName,
  readAttachments,
} from "./attachments.js";
import { TASK_PAGE_TEXT as T } from "./text/task-page.js";

const file = (name: string, bytes: number, byte = 65): File =>
  new File([new Uint8Array(bytes).fill(byte)], name);

describe("readAttachments", () => {
  it("encodes the content and returns the original size, not the encoded one", async () => {
    const { picked, refused } = await readAttachments([file("notes.md", 300)]);
    expect(refused).toEqual([]);
    expect(picked).toHaveLength(1);
    expect(picked[0]?.name).toBe("notes.md");
    expect(picked[0]?.size).toBe(300);
    expect(atob(picked[0]?.contentBase64 ?? "")).toHaveLength(300);
  });

  it("refuses above the cap, NAMING the file", async () => {
    const { picked, refused } = await readAttachments([
      file("enorme.bin", MAX_ATTACHMENT_BYTES + 1),
    ]);
    expect(picked).toEqual([]);
    expect(refused.map((r) => r.name)).toEqual(["enorme.bin"]);
  });

  it("refuses an empty file: it would not succeed server side", async () => {
    const { refused } = await readAttachments([file("vide.png", 0)]);
    expect(refused.map((r) => r.name)).toEqual(["vide.png"]);
  });

  it("a bad file does not drag down the good ones: the others still go", async () => {
    const { picked, refused } = await readAttachments([
      file("ok-1.png", 10),
      file("trop-gros.bin", MAX_ATTACHMENT_BYTES + 1),
      file("ok-2.md", 20),
    ]);
    expect(picked.map((p) => p.name)).toEqual(["ok-1.png", "ok-2.md"]);
    expect(refused.map((r) => r.name)).toEqual(["trop-gros.bin"]);
  });
});

// What the screen SAYS after a drop, from the server's answer, never from a guess about the session
// state: the server tried the steer, only it knows.
describe("attachmentNotice", () => {
  it("forwarded: as soon as ONE dropped file reached the running session", () => {
    expect(
      attachmentNotice([{ notified: "none" }, { notified: "steered" }], { liveSession: true }),
    ).toBe(T.attachments.steered);
  });

  it("kept for the next session: a session runs but does not listen", () => {
    expect(attachmentNotice([{ notified: "none" }], { liveSession: true })).toBe(
      T.attachments.queued,
    );
  });

  it("nothing to say outside a session: the prompt already says the agent reads before starting", () => {
    expect(attachmentNotice([{ notified: "none" }], { liveSession: false })).toBeNull();
    expect(attachmentNotice([], { liveSession: true })).toBeNull();
  });
});

// The name of a PASTED capture. The clipboard returns `image.png` for every capture and the server
// replaces a taken name: without a timestamp two pastes would make one file, and the first capture
// would vanish.
describe("pastedAttachmentName", () => {
  const AT = new Date(2026, 8, 16, 19, 41, 5);
  const img = (name = "image.png", type = "image/png") => ({ name, type });

  it("timestamps the paste to the second", () => {
    expect(pastedAttachmentName(img(), [], AT)).toBe("screenshot-2026-09-16-19-41-05.png");
  });

  it("two pastes in the same second do not overwrite each other", () => {
    const first = pastedAttachmentName(img(), [], AT);
    expect(pastedAttachmentName(img(), [first], AT)).toBe("screenshot-2026-09-16-19-41-05-2.png");
  });

  it("without a file name, the extension comes from the MIME type", () => {
    expect(pastedAttachmentName(img("", "image/jpeg"), [], AT)).toMatch(/\.jpeg$/);
  });

  // What the server accepts without rewriting (`attachmentName`): if the name changed on arrival, the
  // chip would show a file that does not exist under that name.
  it("only produces characters the server keeps as is", () => {
    expect(pastedAttachmentName(img(), [], AT)).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  });
});
