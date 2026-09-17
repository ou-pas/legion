// The sequence of an interview started from the composer. Without a screen, one thing is
// checkable: the order. Create, upload, then run.
//
// The 16/09 defect: `discuss` held the composer's attachments and passed none on. An interview
// opened on a screenshot left without it, with no error and nothing on disk: the agent asked its
// questions in front of a brief missing what explained it. No test looked at this path.
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentsApi } from "../api/agents.js";
import { tasksApi, type Task } from "../api/tasks.js";
import { startInterview } from "./start-interview.js";

afterEach(() => vi.restoreAllMocks());

const INTERVIEWER = {
  id: "a-int",
  projectId: "p-1",
  name: "interviewer",
} as unknown as Parameters<typeof startInterview>[0]["agents"][number];

const PIECE = { name: "capture.png", size: 120, contentBase64: "AAA=" };

/** Calls in the order they go out: the order carries the rule, not the counts. */
function trace() {
  const appels: string[] = [];
  vi.spyOn(agentsApi, "instantiateAgentTemplate").mockResolvedValue({ id: "a-int" } as never);
  const createTask = vi
    .spyOn(tasksApi, "createTask")
    .mockImplementation(async () => (appels.push("create"), { id: "t-int" } as Task));
  const uploadAttachment = vi
    .spyOn(tasksApi, "uploadAttachment")
    .mockImplementation(async () => (appels.push("upload"), undefined as never));
  const runTask = vi
    .spyOn(tasksApi, "runTask")
    .mockImplementation(async () => (appels.push("run"), { sessionId: "s-1" }));
  return { appels, createTask, uploadAttachment, runTask };
}

const lancer = (attachments?: readonly (typeof PIECE)[]) =>
  startInterview({
    agents: [INTERVIEWER],
    projectId: "p-1",
    subject: "The small misaligned dot in the header",
    brief: "Look at the screenshot.",
    ...(attachments ? { attachments } : {}),
  });

describe("startInterview", () => {
  it("uploads the composer's attachments to the interview task", async () => {
    const { uploadAttachment } = trace();
    await lancer([PIECE]);
    expect(uploadAttachment).toHaveBeenCalledWith("t-int", {
      name: "capture.png",
      contentBase64: "AAA=",
    });
  });

  // The order is the rule, the same as on `launch`: a session's spec names the files present at
  // start. Uploading after the run would start an interviewer told about a screenshot it cannot find.
  it("uploads them before running, never after", async () => {
    const { appels } = trace();
    await lancer([PIECE]);
    expect(appels).toEqual(["create", "upload", "run"]);
  });

  it("uploads nothing without an attachment", async () => {
    const { uploadAttachment, appels } = trace();
    await lancer();
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(appels).toEqual(["create", "run"]);
  });
});
