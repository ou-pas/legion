// Attaching a screenshot to a question's answer (16/09): an interview where the operator wants to SHOW
// the defect, not describe it. Attaching only existed in a task's Brief view; the operator thought he
// attached from the inbox and nothing happened.
//
// Why not `BriefAttachments` as is: its three-line drop zone is about the brief, while a channel column
// is 240 px and an answer fits one line. What is SHARED is the chip list and its removal
// (`tasks/brief-attachments.tsx`).
//
// Pasting is not here but on the input, where the cursor is on ⌘V (`usePickedAttachments().paste`).
import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { AttachedList } from "../tasks/brief-attachments.js";
import type { PickedAttachmentsWiring } from "../tasks/use-picked-attachments.js";
import { IconBtn } from "../ui/button.js";
import { Row, Stack } from "../ui/flex.js";
import { Caption } from "../ui/text.js";
import { INBOX_TEXT } from "./text.js";

export function ReplyAttachments({ files }: { files: PickedAttachmentsWiring }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Stack gap={4}>
      <Row gap={6} wrap>
        <IconBtn
          title={INBOX_TEXT.attach.add}
          variant="quiet"
          small
          loading={files.busy}
          onClick={() => input.current?.click()}
        >
          <Paperclip size={13} />
        </IconBtn>
        <AttachedList attachments={files.picked} openName={null} onRemove={files.remove} />
      </Row>
      {/* The refusal is READABLE: a file that does not appear explains nothing. It carries local
          refusals (too big, empty) as well as an upload failure naming its file. */}
      {files.refusal && <Caption tone="bad">{files.refusal}</Caption>}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const chosen = Array.from(e.target.files ?? []);
          if (chosen.length > 0) files.add(chosen);
          // Clear the input, or picking THE SAME file again no longer fires "change".
          // oxlint-disable-next-line no-param-reassign -- DOM API, not a model object
          e.target.value = "";
        }}
      />
    </Stack>
  );
}
