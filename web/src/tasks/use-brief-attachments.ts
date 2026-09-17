// Attachment wiring for an EXISTING task: list, add, remove, and what to show while a session runs.
// Split from the component, which only knows lists and callbacks: network, invalidation and turning
// an error into a message live here. The composer has no task yet and does not use this.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tasksApi, type Task } from "../api/tasks.js";
import { attachmentsQuery, qk } from "../queries.js";
import { useToast } from "../ui/toast.js";
import { attachmentNotice, readAttachments } from "./attachments.js";
import { type ShownAttachment } from "./brief-attachments.js";
import { TASK_PAGE_TEXT as T } from "./text/task-page.js";

export type BriefAttachmentsWiring = {
  attachments: ShownAttachment[];
  onAdd?: (files: File[]) => void;
  onRemove?: (name: string) => void;
  urlOf: (name: string) => string;
  busy: boolean;
  refusal: string | null;
  locked: string | null;
  notice: string | null;
};

/** REMOVAL follows `task.briefEditable`, the brief rule decided by the server (which answers 409
 *  anyway): a live session holds the path of what it received. ADDING stays open during a session
 *  since 07/09: the server signals the file to the session, and `notice` reports what it did. The
 *  screen recomputes nothing, it displays. */
export function useBriefAttachments(task: Task): BriefAttachmentsWiring {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data: attachments = [] } = useQuery(attachmentsQuery(task.id));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const removable = task.briefEditable;

  const invalidate = () => void qc.invalidateQueries({ queryKey: qk.attachments(task.id) });
  const failed = (e: Error) => push({ tone: "bad", title: T.attachments.failed, body: e.message });

  const add = (files: File[]) => {
    setBusy(true);
    setRefusal(null);
    setNotice(null);
    // LOCAL refusals (too large, empty) do not stop the others: dropping five files with one bad one
    // must not cancel the four good ones, and the refusal names it.
    readAttachments(files)
      .then(async ({ picked, refused }) => {
        if (refused.length > 0)
          setRefusal(T.attachments.tooLarge(refused.map((r) => r.name).join(", ")));
        const uploads = [];
        for (const file of picked)
          uploads.push(
            await tasksApi.uploadAttachment(task.id, {
              name: file.name,
              contentBase64: file.contentBase64,
            }),
          );
        setNotice(attachmentNotice(uploads, { liveSession: !task.briefEditable }));
      })
      .catch(failed)
      .finally(() => {
        setBusy(false);
        invalidate();
      });
  };

  const remove = (name: string) => {
    tasksApi.deleteAttachment(task.id, name).catch(failed).finally(invalidate);
  };

  return {
    attachments,
    onAdd: add,
    onRemove: removable ? remove : undefined,
    urlOf: (name: string) => tasksApi.attachmentUrl(task.id, name),
    busy,
    refusal,
    locked: removable ? null : T.attachments.locked,
    notice,
  };
}
