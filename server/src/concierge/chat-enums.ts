// Who speaks in a concierge conversation turn. The two roles are the model API's, stored as-is so
// a conversation replays without translation.
import type { schema } from "../shared/db.js";

export type ChatRole = (typeof schema.conciergeTurns.$inferSelect)["role"];
export const CHAT_ROLE = {
  user: "user",
  assistant: "assistant",
} as const satisfies Record<string, ChatRole>;
export const CHAT_ROLES = [CHAT_ROLE.user, CHAT_ROLE.assistant] as const;
