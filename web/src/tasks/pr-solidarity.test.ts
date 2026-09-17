// Solidarity of change requests: the server only completes the task once ALL are merged
// (`server/src/review/merge-events.ts`), and nothing said so on screen. Three behaviours:
//  - a single request = silence (no noise in the common case);
//  - two requests, one merged = the count, AND the waiting repo, named;
//  - an unknown state (`prState` missing) is never rendered as "not merged yet".
import { describe, expect, it } from "vitest";
import { type PrMergeState } from "../api/review.js";
import { prSolidarity, solidarityMessage } from "./pr-solidarity.js";

const state = (over: Partial<PrMergeState> = {}): PrMergeState => ({
  repo: "api",
  url: "https://framagit.org/x/api/-/merge_requests/22",
  number: 22,
  mergeState: "mergeable",
  ...over,
});

describe("prSolidarity: a single request (or none), nothing to say", () => {
  it("returns null on a single-request task, whatever its state", () => {
    expect(prSolidarity([{ repo: "api", url: "u" }], [])).toBeNull();
    expect(
      prSolidarity([{ repo: "api", url: "u" }], [state({ url: "u", prState: "merged" })]),
    ).toBeNull();
  });

  it("returns null on a task without any request", () => {
    expect(prSolidarity([], undefined)).toBeNull();
  });

  it("solidarityMessage(null) renders nothing", () => {
    expect(solidarityMessage(null)).toBeNull();
  });
});

const FRONT_URL = "https://framagit.org/x/front/-/merge_requests/15";
const API_URL = "https://framagit.org/x/api/-/merge_requests/22";

describe("prSolidarity: two requests, one merged, the count AND the waiting repo", () => {
  const prUrls = [
    { repo: "front", url: FRONT_URL },
    { repo: "api", url: API_URL },
  ];
  const states = [
    state({ repo: "front", url: FRONT_URL, number: 15, prState: "merged" }),
    state({ repo: "api", url: API_URL, number: 22, prState: "open" }),
  ];

  it("counts 1 merged out of 2, and classifies each line", () => {
    const s = prSolidarity(prUrls, states);
    expect(s).toEqual({
      total: 2,
      mergedCount: 1,
      lines: [
        { repo: "front", state: "merged" },
        { repo: "api", state: "pending" },
      ],
    });
  });

  it("the message names the waiting repo by name, not by number", () => {
    const msg = solidarityMessage(prSolidarity(prUrls, states));
    expect(msg?.title).toContain("1 of 2 merged");
    expect(msg?.title).toContain("all of them are");
    expect(msg?.body).toBe("api is waiting");
    expect(msg?.body).not.toMatch(/#?22/); // the number is not the message
  });

  it('never says "PR" nor "pull request": prUrls carries GitLab too', () => {
    const msg = solidarityMessage(prSolidarity(prUrls, states));
    const text = `${msg?.title} ${msg?.body}`;
    expect(text).not.toMatch(/\bPR\b/);
    expect(text.toLowerCase()).not.toContain("pull request");
  });
});

const WORKER_URL = "https://framagit.org/x/worker/-/merge_requests/3";

describe('prSolidarity: an unknown state is never "not merged yet"', () => {
  const prUrls = [
    { repo: "front", url: FRONT_URL },
    { repo: "worker", url: WORKER_URL },
  ];

  it("missing prState (unreadable number, unresolved repo) becomes `unknown`, not `pending`", () => {
    const states: PrMergeState[] = [
      { repo: "front", url: FRONT_URL, number: 15, mergeState: "mergeable", prState: "open" },
      { repo: "worker", url: WORKER_URL, number: null, mergeState: "unknown" }, // no prState
    ];
    const s = prSolidarity(prUrls, states);
    expect(s?.lines).toEqual([
      { repo: "front", state: "pending" },
      { repo: "worker", state: "unknown" },
    ]);
  });

  it('the message separates "waiting" from "state unknown", never mixed in one sentence', () => {
    const states: PrMergeState[] = [
      { repo: "front", url: FRONT_URL, number: 15, mergeState: "mergeable", prState: "open" },
      { repo: "worker", url: WORKER_URL, number: null, mergeState: "unknown" },
    ];
    const msg = solidarityMessage(prSolidarity(prUrls, states));
    expect(msg?.body).toContain("front is waiting");
    expect(msg?.body).toContain("state of worker not known yet");
  });

  it("before the first answer (`states` undefined), everything falls back on `unknown`, never `pending`", () => {
    const s = prSolidarity(prUrls, undefined);
    expect(s?.lines.every((l) => l.state === "unknown")).toBe(true);
  });
});
