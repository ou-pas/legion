// An inbox item's free answer field. Always offered, even with choices ("no, do X instead" bypasses
// the buttons), and always visible, even collapsed: it decides whether to open.
//
// Enter used to send, and the operator sent a half-written answer to an agent (07/09). Only the button
// and ⌘/Ctrl+Enter send now, the Slack/Linear/GitHub convention (ui/submit-key.ts). The shortcut hint
// (12/09) lives in the button tooltip: the button is icon-only, so `Button` `shortcut` has no text to
// follow.
import { useState } from "react";
import { Send } from "lucide-react";
import { type InboxItem as InboxQuestion } from "../api/inbox.js";
import type { PickedAttachmentsWiring } from "../tasks/use-picked-attachments.js";
import { IconBtn } from "../ui/button.js";
import { Row, Stack } from "../ui/flex.js";
import { Input } from "../ui/input.js";
import { isSubmitKey } from "../ui/submit-key.js";
import { ReplyAttachments } from "./reply-attachments.js";
import { INBOX_TEXT } from "./text.js";

export function InboxReplyField({
  item,
  pending,
  onSend,
  hint = true,
  placeholder,
  sendLabel,
  attachments,
}: {
  item: Pick<InboxQuestion, "agentName" | "choices">;
  pending: boolean;
  onSend: (text: string) => void;
  /** Adds the shortcut to the send button tooltip. A form question already carries it on its submit
   *  button: repeating it would be read twice. */
  hint?: boolean;
  /** What the field asks when it is NOT an answer (07/09): on an out-of-quota pause, sending answers
   *  nothing, it wakes the session early. The answer placeholder lied about the button there. */
  placeholder?: string;
  sendLabel?: string;
  /** Screenshot attaching (16/09): paperclip button, chips, and ⌘V paste on the field. Absent = no
   *  attachment possible, as on an out-of-quota pause where sending only wakes the session.
   *
   *  Uploading is not here but in `onSend`: the caller knows the task and holds the ORDER, upload the
   *  files THEN answer. The session reads its attachments while building its resume prompt; a file
   *  arriving after the answer would be announced to nobody. */
  attachments?: PickedAttachmentsWiring;
}) {
  const [text, setText] = useState("");
  // A screenshot alone is an answer (16/09): "look, the dot is off here" does not always come with a
  // sentence. Otherwise the gesture stopped on a greyed send button.
  const joined = attachments ? attachments.picked.length > 0 : false;
  const answerable = !pending && (text.trim().length > 0 || joined);
  const send = () => {
    if (answerable) onSend(text);
  };
  // `title` does all the icon button's work: accessible name AND tooltip text (see `ui/button.tsx`).
  // Disabled, it says WHY rather than repeating the action.
  const sendTitle = !answerable
    ? INBOX_TEXT.item.reply.nothingToSend
    : hint
      ? `${sendLabel ?? INBOX_TEXT.item.reply.sendTo(item.agentName)} — ${INBOX_TEXT.sendShortcut}`
      : (sendLabel ?? INBOX_TEXT.item.reply.sendTo(item.agentName));

  return (
    <Stack gap={4} flex={1} minWidth={260}>
      <Row gap={6}>
        <Input
          size="md"
          value={text}
          aria-label={INBOX_TEXT.item.reply.label(item.agentName)}
          placeholder={
            placeholder ??
            (item.choices
              ? INBOX_TEXT.item.reply.placeholderWithChoices
              : INBOX_TEXT.item.reply.placeholder)
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (isSubmitKey(e)) send();
          }}
          // ⌘V ON THE FIELD, where the cursor is right after taking a screenshot.
          onPaste={attachments?.paste}
        />
        <IconBtn title={sendTitle} disabled={!answerable} loading={pending} onClick={send}>
          <Send size={14} />
        </IconBtn>
      </Row>
      {attachments && <ReplyAttachments files={attachments} />}
    </Stack>
  );
}
