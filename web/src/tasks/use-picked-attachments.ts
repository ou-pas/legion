// Files picked and not sent yet: the state shared by every place attaching something to a task NOT
// READY to receive it, the composer (the task does not exist) and an inbox answer (not sent yet).
// Both keep files in memory and send them at the last moment.
//
// Unlike `use-brief-attachments.ts`, where the task exists and the drop IS the upload, here the drop
// is an intention: a file removed before sending never touched the disk, so `remove` calls nobody.
//
// Third occurrence, so a module (design contract rule 4): reading, the named refusal and the merge by
// name were copied in `TaskComposer.tsx`, and the inbox answer would have made a second copy.
import { useState, type ClipboardEvent } from "react";
import { tasksApi } from "../api/tasks.js";
import { pastedAttachmentName, readAttachments, type PickedAttachment } from "./attachments.js";
import { TASK_PAGE_TEXT as T } from "./text/task-page.js";

export type PickedAttachmentsWiring = {
  picked: PickedAttachment[];
  /** What did not go, SPELLED OUT: a local refusal (too large, empty, unreadable) or the name of the
   *  file whose upload failed. One place on screen for both, the two ways a file fails to arrive. */
  refusal: string | null;
  busy: boolean;
  add: (files: File[]) => void;
  /** A keyboard paste (⌘V). Does nothing on a text paste. */
  paste: (e: ClipboardEvent<HTMLElement>) => void;
  remove: (name: string) => void;
  clear: () => void;
  /** Uploads everything to the task in order and clears the list. REJECTS on the first failure,
   *  naming the file: the caller then sends neither the task nor the answer. */
  upload: (taskId: string) => Promise<void>;
  /** UPLOAD THEN SEND, in that order, as ONE gesture, and the order must live here.
   *
   *  Each caller used to write `upload(id).then(() => send())`, three times. That is exactly the
   *  defect that opened this work: "discuss" copied the "run" sequence and forgot the half uploading
   *  the files, with nothing saying so.
   *
   *  `send` is only called once everything is uploaded: a refused file holds the answer back, the
   *  draft stays intact, and `refusal` names the culprit. */
  uploadThen: (taskId: string, send: () => void) => Promise<void>;
};

/** The same name picked twice REPLACES the first: the server does the same on arrival, and two chips
 *  for one incoming file would be a lie. */
const merge = (prev: PickedAttachment[], fresh: PickedAttachment[]): PickedAttachment[] => [
  ...prev.filter((p) => !fresh.some((f) => f.name === p.name)),
  ...fresh,
];

export function usePickedAttachments(): PickedAttachmentsWiring {
  const [picked, setPicked] = useState<PickedAttachment[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = (files: File[]) => {
    setBusy(true);
    setRefusal(null);
    // LOCAL refusals do not stop the others: dropping five files with one bad one must not cancel the
    // four good ones, and the refusal names it.
    readAttachments(files)
      .then(({ picked: fresh, refused }) => {
        if (refused.length > 0)
          setRefusal(T.attachments.tooLarge(refused.map((r) => r.name).join(", ")));
        if (fresh.length > 0) setPicked((prev) => merge(prev, fresh));
      })
      .catch((e: Error) => setRefusal(`${T.attachments.failed} : ${e.message}`))
      .finally(() => setBusy(false));
  };

  const upload = async (taskId: string): Promise<void> => {
    if (picked.length === 0) return;
    setBusy(true);
    setRefusal(null);
    try {
      for (const file of picked)
        await tasksApi
          .uploadAttachment(taskId, { name: file.name, contentBase64: file.contentBase64 })
          .catch((e: Error) => {
            setRefusal(T.attachments.uploadFailed(file.name, e.message));
            throw e;
          });
      setPicked([]);
    } finally {
      setBusy(false);
    }
  };

  return {
    picked,
    refusal,
    busy,
    add,
    // A paste is renamed BEFORE reading. `File.name` is read-only, so the file is rebuilt around the
    // same bytes: the only moment the name can still be chosen, and everything after (merge, chip,
    // upload) works on that name.
    paste: (e) => {
      const files = Array.from(e.clipboardData.files);
      if (files.length === 0) return; // a TEXT paste is none of our business
      const at = new Date();
      const named: File[] = [];
      for (const f of files) {
        const taken = [...picked.map((p) => p.name), ...named.map((n) => n.name)];
        named.push(new File([f], pastedAttachmentName(f, taken, at), { type: f.type }));
      }
      add(named);
    },
    remove: (name) => setPicked((prev) => prev.filter((p) => p.name !== name)),
    clear: () => {
      setPicked([]);
      setRefusal(null);
    },
    upload,
    // The order lives here, once. `send` is only reached if everything uploaded; a refusal leaves it
    // untouched, so the answer is not sent and the draft stays.
    uploadThen: (taskId, send) => upload(taskId).then(send, () => {}),
  };
}
