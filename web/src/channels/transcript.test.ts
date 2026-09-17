import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../sessions/use-session-events.js";
import { transcript } from "./transcript.js";

/** Helper to create a session event */
const ev = (
  type: string,
  data: Record<string, unknown> = {},
  sessionId = "s1",
  ts = 0,
): SessionEvent => ({
  type,
  data: { ts, ...data },
  sessionId,
  dbId: Math.floor(Math.random() * 10000),
});

describe("transcript - filtering empty bands", () => {
  it("filters out empty bands with only init/status events", () => {
    const events: SessionEvent[] = [
      ev("init", { model: "opus" }),
      ev("status", { status: "running" }),
    ];
    const result = transcript(events);
    expect(result).toHaveLength(0);
  });

  it("keeps bands with tool events", () => {
    const events: SessionEvent[] = [
      ev("tool_start", { tool: "read", ts: 0 }),
      ev("tool_end", { ts: 100 }),
    ];
    const result = transcript(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "work",
      band: { tools: 1, reads: 1 },
    });
  });

  it("keeps bands with meaningful lines (activity)", () => {
    const events: SessionEvent[] = [
      ev("init", { model: "opus", ts: 0 }),
      ev("activity", { note: "processing...", ts: 50 }),
    ];
    const result = transcript(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "work",
      band: { tools: 0, reads: 0, writes: 0 },
    });
  });

  it("keeps bands with fs_op events", () => {
    const events: SessionEvent[] = [ev("fs_op", { op: "write", path: "/file.txt", ts: 0 })];
    const result = transcript(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "work",
      band: { tools: 0 },
    });
  });

  it("converts repo_push with changes to a notice (not a work band)", () => {
    const events: SessionEvent[] = [
      ev("repo_push", { repo: "myrepo", changes: 5, commit: "abc123", ts: 0 }),
    ];
    const result = transcript(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "notice",
      code: "repo_push",
    });
  });

  it("filters empty band even if it has init+status lines", () => {
    const events: SessionEvent[] = [
      ev("init", { model: "opus", ts: 0 }),
      ev("status", { status: "running", ts: 10 }),
    ];
    const result = transcript(events);
    expect(result).toHaveLength(0);
  });

  it("filters out empty band but keeps non-empty ones", () => {
    const events: SessionEvent[] = [
      // First band: empty (only init/status)
      ev("init", { model: "opus", ts: 0 }),
      ev("status", { status: "running", ts: 10 }),
      // Non-work event triggers flush
      ev("text", { text: "hello", ts: 20 }),
      // Second band: has activity
      ev("activity", { note: "working", ts: 30 }),
      ev("text", { text: "done", ts: 40 }),
    ];
    const result = transcript(events);
    // Expected: say (hello), work (activity), say (done); the empty first band is filtered.
    const workSegments = result.filter((s) => s.kind === "work");
    const saySegments = result.filter((s) => s.kind === "say");
    expect(workSegments).toHaveLength(1);
    expect(saySegments).toHaveLength(2);
  });
});

describe("transcript - filtering throttle events", () => {
  it("removes throttle events with status='allowed'", () => {
    const events: SessionEvent[] = [
      ev("throttle", { kind: "rate_limit", status: "allowed", ts: 0 }),
    ];
    const result = transcript(events);
    expect(result).toHaveLength(0);
  });

  it("keeps throttle events with status other than 'allowed'", () => {
    const events: SessionEvent[] = [
      ev("throttle", { kind: "rate_limit", status: "paused", ts: 0 }),
    ];
    const result = transcript(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "notice",
      code: "throttle",
    });
  });

  it("keeps throttle events with other statuses", () => {
    const events: SessionEvent[] = [
      ev("throttle", { kind: "rate_limit", status: "retry_after", ts: 0 }),
      ev("throttle", { kind: "rate_limit", status: "backoff", ts: 10 }),
    ];
    const result = transcript(events);
    expect(result).toHaveLength(2);
    expect(result.every((s) => s.kind === "notice" && s.code === "throttle")).toBe(true);
  });

  it("removes throttle 'allowed' but keeps other notices", () => {
    const events: SessionEvent[] = [
      ev("throttle", { kind: "rate_limit", status: "allowed", ts: 0 }),
      ev("run_error", { message: "something failed", ts: 10 }),
      ev("throttle", { kind: "rate_limit", status: "paused", ts: 20 }),
    ];
    const result = transcript(events);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      kind: "notice",
      code: "run_error",
    });
    expect(result[1]).toMatchObject({
      kind: "notice",
      code: "throttle",
    });
  });
});

describe("transcript - combined filtering", () => {
  it("filters empty bands and throttle allowed together", () => {
    const events: SessionEvent[] = [
      ev("init", { model: "opus", ts: 0 }),
      ev("throttle", { kind: "rate_limit", status: "allowed", ts: 10 }),
      ev("text", { text: "hello", ts: 20 }),
    ];
    const result = transcript(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "say", who: "agent" });
  });

  it("keeps meaningful bands and significant throttles", () => {
    const events: SessionEvent[] = [
      ev("tool_start", { tool: "read", ts: 0 }),
      ev("tool_end", { ts: 10 }),
      ev("throttle", { kind: "rate_limit", status: "paused", ts: 20 }),
      ev("text", { text: "agent message", ts: 30 }),
    ];
    const result = transcript(events);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ kind: "work" });
    expect(result[1]).toMatchObject({ kind: "notice", code: "throttle" });
    expect(result[2]).toMatchObject({ kind: "say" });
  });
});

describe("transcript - existing functionality preserved", () => {
  it("preserves rounds (questions/answers)", () => {
    const events: SessionEvent[] = [
      ev("inbox_ask", { inboxId: "q1", body: "what to do?", ts: 0 }),
      ev("text", { text: "answer", ts: 10 }),
      ev("inbox_answer", { inboxId: "q1", answer: "do this", ts: 20 }),
    ];
    const result = transcript(events);
    const round = result.find((s) => s.kind === "round");
    expect(round).toMatchObject({
      kind: "round",
      question: "what to do?",
      answer: "do this",
    });
  });

  it("preserves say events", () => {
    const events: SessionEvent[] = [
      ev("text", { text: "agent says", ts: 0 }),
      ev("steer", { text: "human responds", ts: 10 }),
    ];
    const result = transcript(events);
    const says = result.filter((s) => s.kind === "say");
    expect(says).toHaveLength(2);
    expect(says[0]).toMatchObject({ who: "agent" });
    expect(says[1]).toMatchObject({ who: "human" });
  });

  it("marks session boundaries", () => {
    const events: SessionEvent[] = [
      ev("text", { text: "message", ts: 0 }, "s1"),
      ev("text", { text: "new session", ts: 10 }, "s2"),
    ];
    const result = transcript(events);
    const session = result.find((s) => s.kind === "session");
    expect(session).toMatchObject({
      kind: "session",
      index: 2,
    });
  });
});
