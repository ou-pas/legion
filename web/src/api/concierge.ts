// Concierge: natural-language chat about the control plane, and the brief read before asking
// anything.
//
// Read-only by server construction: the ephemeral session that answers gets no tools (three
// belts, tested in `server/src/concierge/concierge.test.ts`). So brief links do NOT come from the
// agent: the server returns a task id it verified itself, and this screen builds the URL.
//
// History no longer travels (slice nav/10). Sending `{ message, history }` on each call survived no
// reload and let the browser decide what had been said. The conversation id is sent instead; without
// it the server opens a new one and returns its id.
import { json, post } from "./client.js";

/** Who speaks in a turn: the model API roles, stored as is. */
export const CHAT_ROLE = { user: "user", assistant: "assistant" } as const;
export const CHAT_ROLES = [CHAT_ROLE.user, CHAT_ROLE.assistant] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

/** A conversation turn, in Claude message format. */
export type ConciergeTurn = { role: "user" | "assistant"; content: string };

/** `now`: what follows depends on it now · `soon`: it will get stuck · `fyi`: worth knowing. */
export type BriefSeverity = "now" | "soon" | "fyi";

export interface BriefItem {
  severity: BriefSeverity;
  text: string;
  /** The cited task, VERIFIED by the server against the compiled context. `null` = no link. */
  taskId: string | null;
  /** The task's project (nav/B): without it the screen can only build the short redirecting URL.
   *  `null` when `taskId` is. */
  projectId: string | null;
}

/** See `server/src/concierge/concierge-brief.ts`. "nothing-to-tell" is the very first launch, the
 *  only state where the page has no brief to show. */
export type BriefReason = "computed" | "nothing-to-tell" | "error";

export interface ConciergeBrief {
  reason: BriefReason;
  prose: string[];
  items: BriefItem[];
  projectCount: number;
  /** Shown on screen: a brief without its age gets believed. */
  generatedAt: number;
  error: string | null;
}

export interface ConciergeConversation {
  id: string;
  title: string;
  startedAt: number;
  updatedAt: number;
  turnCount: number;
}

export const conciergeApi = {
  /** A `null` `conversationId` opens a conversation; the response always returns its id, including
   *  a just-created one. Rejects with the server's sentence verbatim. */
  ask: (
    message: string,
    conversationId: string | null,
  ): Promise<{ conversationId: string; reply: string }> =>
    post("/api/concierge", { message, conversationId }),

  /** On demand only. Without `refresh` the server serves its cache, on purpose: each computation is
   *  a model call. No `refetchInterval` on this query. */
  brief: (refresh = false): Promise<ConciergeBrief> =>
    fetch(`/api/concierge/brief${refresh ? "?refresh=1" : ""}`).then(json),

  conversations: (): Promise<{ conversations: ConciergeConversation[]; latest: string | null }> =>
    fetch("/api/concierge/conversations").then(json),

  conversation: (id: string): Promise<{ id: string; turns: ConciergeTurn[] }> =>
    fetch(`/api/concierge/conversations/${id}`).then(json),
};
