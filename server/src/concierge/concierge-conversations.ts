// Concierge history and conversations: the context budget replayed to the model (turn count,
// characters per turn, visible truncation), a conversation's title, and the
// `ConciergeConversation` aggregate. Queries live in `concierge-store.ts`.
//
// The bounds from `concierge-input.ts` apply here, to what the server reads back: a month-long
// conversation would otherwise replay a thousand turns.
import { HISTORY_LENGTH_MAX, HISTORY_TURN_MAX } from "./concierge-input.js";
import type { ConciergeTurn } from "./concierge-prompt.js";
import { CHAT_ROLE } from "./chat-enums.js";
import {
  allTurnRowsInOrder,
  recentTurnRows,
  turnRowsInOrder,
  type TurnRow,
} from "./concierge-store.js";

export interface ConciergeConversation {
  id: string;
  /** The operator's first turn, truncated. Nobody named the conversation, and inventing a name
   *  would cost a model call for a label. */
  title: string;
  startedAt: number;
  updatedAt: number;
  turnCount: number;
}

const TITLE_MAX = 120;

/** Visible truncation: context cut silently makes the model answer beside the point. */
function truncate(content: string, max: number): string {
  return content.length > max ? `${content.slice(0, max)}…` : content;
}

/** The history replayed in the prompt: the last `HISTORY_LENGTH_MAX` turns in order, each cut to
 *  `HISTORY_TURN_MAX`. The oldest go first: the end of a conversation carries its subject. */
export function readHistory(conversationId: string): ConciergeTurn[] {
  return recentTurnRows(conversationId, HISTORY_LENGTH_MAX)
    .reverse()
    .map((r) => ({ role: r.role, content: truncate(r.content, HISTORY_TURN_MAX) }));
}

/** A conversation's turns, whole and in order, for the page on reload. No bound: bounds protect a
 *  model's prompt, not a human reading the conversation they asked for. */
export function readConversation(conversationId: string): ConciergeTurn[] {
  return turnRowsInOrder(conversationId).map((r) => ({ role: r.role, content: r.content }));
}

/** The title is the operator's first turn, not just the first turn: a conversation opened from
 *  the situation report starts with a concierge turn, which would name every conversation alike. */
function title(role: TurnRow["role"], content: string): string {
  if (role !== CHAT_ROLE.user) return "";
  return truncate(content.replace(/\s+/g, " ").trim(), TITLE_MAX);
}

/** Conversations, most recently fed first. */
export function listConversations(): ConciergeConversation[] {
  const rows = allTurnRowsInOrder();
  const byId = new Map<string, ConciergeConversation>();
  /** Rank of the last turn seen per conversation, the final sort's tie-breaker (03/09).
   *
   *  Sorting on `updatedAt` alone let insertion order decide within a millisecond: JavaScript's
   *  sort is stable and the Map fills in ascending order, so two conversations opened in the same
   *  millisecond came out reversed (a test failing two runs out of six). The scan is ordered by
   *  `rowid`, so the rank says who came last. */
  const lastRank = new Map<string, number>();
  for (const [rank, r] of rows.entries()) {
    lastRank.set(r.conversationId, rank);
    const at = r.createdAt.getTime();
    const seen = byId.get(r.conversationId);
    if (!seen) {
      byId.set(r.conversationId, {
        id: r.conversationId,
        title: title(r.role, r.content),
        startedAt: at,
        updatedAt: at,
        turnCount: 1,
      });
      continue;
    }
    seen.updatedAt = at;
    seen.turnCount += 1;
    if (seen.title === "" && r.role === CHAT_ROLE.user) seen.title = title(r.role, r.content);
  }
  return [...byId.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || (lastRank.get(b.id) ?? 0) - (lastRank.get(a.id) ?? 0),
  );
}
