// A brief's attachments on screen. One component for both moments of attaching, the composer of a
// task that does not exist yet and the Brief view of an existing one, because it is the same gesture
// and must look the same. It receives a LIST and three callbacks; the caller decides whether the list
// lives in memory (composer) or on the server (Brief view).
//
// No home-made drop zone: `ui/dropzone.tsx` has its four states (rest, hover, dropping, refused).
// The `<input type="file">` stays with the Dropzone's caller, as everywhere else in this code: the
// primitive deliberately does not carry it.
import { useRef, useState, type DragEvent } from "react";
import { X } from "lucide-react";
import { Dropzone } from "../ui/dropzone.js";
import { IconBtn } from "../ui/button.js";
import { Row, Stack } from "../ui/flex.js";
import { Label, Text } from "../ui/text.js";
import { ArtifactChip, ArtifactPreview } from "./artifact-chip.js";
import { TASK_PAGE_TEXT as T } from "./text/task-page.js";
import type { Artifact } from "../api/tasks.js";

/** What an attachment needs in order to be SHOWN. Deliberately poorer than the API type: a picked,
 *  unsent file has neither MIME type nor path, and requiring them would force the composer to invent
 *  some. */
export type ShownAttachment = { name: string; size: number; kind?: Artifact["kind"] };

/** The attachments ALREADY attached. Exported since 16/09: an inbox answer shows the same list, with
 *  the same removal, in a row far too narrow for the drop zone that goes with it here.
 *
 *  Clicking only opens a preview when there is something to open: `onOpen` is absent when they have
 *  no address (the composer, whose files are nowhere until the task exists). A chip that looks like
 *  a button and does nothing is worse than an inert chip. */
export function AttachedList({
  attachments,
  openName,
  onOpen,
  onRemove,
}: {
  attachments: ShownAttachment[];
  openName: string | null;
  onOpen?: (name: string | null) => void;
  onRemove?: (name: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <Row gap={6} wrap>
      {attachments.map((a) => (
        <Row key={a.name} gap={2}>
          <ArtifactChip
            name={a.name}
            sizeBytes={a.size}
            kind={a.kind}
            selected={openName === a.name}
            onSelect={onOpen ? () => onOpen(openName === a.name ? null : a.name) : undefined}
          />
          {onRemove && (
            <IconBtn
              title={T.attachments.remove(a.name)}
              variant="quiet"
              small
              onClick={() => {
                onOpen?.(null);
                onRemove(a.name);
              }}
            >
              <X size={12} />
            </IconBtn>
          )}
        </Row>
      ))}
    </Row>
  );
}

/** The drop zone and its `<input type="file">`. The input lives here, not in the primitive: that is
 *  `ui/dropzone.tsx`'s contract, and it lets each caller choose `multiple`, `accept`,
 *  `webkitdirectory`. Hover only concerns the zone, so its state stays here. */
function DropSlot({
  busy,
  refusal,
  onFiles,
}: {
  busy: boolean;
  /** The last refusal, SPELLED OUT, in place of the drop label. */
  refusal: string | null;
  onFiles: (files: File[]) => void;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const take = (list: FileList | null) => {
    setOver(false);
    const files = Array.from(list ?? []);
    if (files.length > 0) onFiles(files);
  };
  return (
    <>
      <Dropzone
        over={over}
        busy={busy}
        rejected={Boolean(refusal)}
        label={refusal ?? T.attachments.dropLabel}
        hint={T.attachments.dropHint}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          take(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
      />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          take(e.target.files);
          // Clear the input, otherwise picking THE SAME file again no longer fires "change".
          // oxlint-disable-next-line no-param-reassign -- DOM API, not a model object
          e.target.value = "";
        }}
      />
    </>
  );
}

export function BriefAttachments({
  attachments,
  onAdd,
  onRemove,
  urlOf,
  busy = false,
  refusal = null,
  locked = null,
  notice = null,
  label = T.attachments.label,
}: {
  attachments: ShownAttachment[];
  /** The list heading changes with its NEIGHBOURS: "Attachments" in the brief, where they stand
   *  alone; "Attached by the operator" on the Artifacts view, next to the agent's artifacts, where
   *  the question is "who dropped this?". */
  label?: string;
  /** Absent: read-only (a session runs, or the screen may not attach). */
  onAdd?: (files: File[]) => void;
  onRemove?: (name: string) => void;
  /** Present: the attachments have an address, hence a preview. The composer has none yet: its
   *  files are nowhere until the task exists. */
  urlOf?: (name: string) => string;
  busy?: boolean;
  /** The last refusal, SPELLED OUT. A chip that does not appear explains nothing. */
  refusal?: string | null;
  /** Why a gesture is closed (since 07/09: removal during a session), shown next to the list. Never
   *  a disabled button with a `title`: on a `disabled` element the native tooltip does not show. */
  locked?: string | null;
  /** The FATE of the last drop made during a session: forwarded to the agent, or kept for the next
   *  one. A file sent without knowing whether it was seen is not a drop. */
  notice?: string | null;
}) {
  const [openName, setOpenName] = useState<string | null>(null);

  if (attachments.length === 0 && !onAdd && !locked) return null;
  const open = attachments.find((a) => a.name === openName);

  return (
    <Stack gap={6}>
      <Label>{label}</Label>
      <AttachedList
        attachments={attachments}
        openName={openName}
        onOpen={urlOf ? setOpenName : undefined}
        onRemove={onRemove}
      />
      {onAdd && <DropSlot busy={busy} refusal={refusal} onFiles={onAdd} />}
      {notice && <Text size="sm">{notice}</Text>}
      {/* The lock is READ, not guessed from a missing button. */}
      {locked && (
        <Text size="sm" tone="muted">
          {locked}
        </Text>
      )}
      {open && urlOf && (
        <ArtifactPreview
          name={open.name}
          src={urlOf(open.name)}
          kind={open.kind}
          onClose={() => setOpenName(null)}
        />
      )}
    </Stack>
  );
}
