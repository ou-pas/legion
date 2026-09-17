// Inbox form (v31): N questions in ONE pause. The agent declares blocks (markdown, SVG, typed
// fields), the human answers, the session resumes with a JSON whose keys the agent knows. Rendered as
// the QUESTIONNAIRE since 07/09 (direction A, inbox-decoupes.html mockup): one question per screen, a
// rail, a recap to send.
//
// Only the entry point: it decides nothing (`InboxQuestionnaire` reduces itself to one screen for a
// one-question round). Required-field gating is an input comfort; the validation that counts is the
// server's (inbox-form.ts), whose refusal comes back as a toast.
import type { FormSpec } from "../api/inbox.js";
import { InboxQuestionnaire } from "./inbox-questionnaire.js";

export function InboxForm({
  spec,
  pending,
  onSubmit,
}: {
  spec: FormSpec;
  pending: boolean;
  onSubmit: (formData: Record<string, unknown>) => void;
}) {
  return <InboxQuestionnaire spec={spec} pending={pending} onSubmit={onSubmit} />;
}
