// D10: leaving the interview before the agent offers to.
//
// The gesture is a button that is there, next to the open round's form. Never a disabled button
// with a `title`: Chrome and Safari do not show the `title` of a `disabled` element, so the reason
// would show nowhere.
//
// What it does: it answers the open round, through the same door as any inbox answer
// (`POST /api/inbox/:id/reply`). The session resumes, writes its spec and files its task instead of
// being killed with its work inside. Leaving is not stopping.
import { Flag } from "lucide-react";
import { useReplyInbox } from "../queries.js";
import { Button } from "../ui/button.js";
import { useToast } from "../ui/toast.js";
import { INTERVIEW_TEXT } from "./text.js";

export function InterviewExit({
  questionId,
}: {
  /** The open round: answering it is how the interview concludes. */
  questionId: string;
}) {
  const reply = useReplyInbox();
  const { push } = useToast();
  const conclude = () =>
    reply.mutate(
      { id: questionId, body: { text: INTERVIEW_TEXT.exit.answer } },
      {
        onSuccess: () =>
          push({ tone: "ok", title: INTERVIEW_TEXT.exit.sent, body: INTERVIEW_TEXT.exit.sentBody }),
      },
    );

  return (
    <Button leading={<Flag size={13} />} loading={reply.isPending} onClick={conclude}>
      {INTERVIEW_TEXT.exit.label}
    </Button>
  );
}
