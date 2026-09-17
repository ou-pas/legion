// An artifact, expected by the step (still missing) or dropped by the agent. One shape for both: the
// same chip shows name, presence and size, inert (expected list) or clickable (opens the preview).
// ArtifactPreview lives here because it shows the SAME object; ui/ has no sandboxed viewer.
//
// `kind` picks the preview: "text" keeps the sandboxed iframe; "image" shows the image directly (an
// inert binary, nothing for the sandbox to protect); "binary" does NOT try to render content that
// cannot be previewed safely, it offers a download.
import {
  FileText,
  Image as ImageIcon,
  File,
  CircleDashed,
  X,
  Download,
  ExternalLink,
} from "lucide-react";
import type { Artifact } from "../api/tasks.js";
import { ARTIFACT_TEXT as T } from "./text/artifact.js";
import { Chip } from "../ui/chip.js";
import { IconBtn } from "../ui/button.js";
import { Link } from "../ui/link.js";
import { Num } from "../ui/num.js";
import { Text } from "../ui/text.js";
import { Toolbar } from "../ui/toolbar.js";
import "./artifact-chip.css";

const KO = 1024;

type ArtifactKind = Artifact["kind"];

function kindIcon(kind: ArtifactKind | undefined, size: number) {
  if (kind === "image") return <ImageIcon size={size} aria-hidden="true" />;
  if (kind === "binary") return <File size={size} aria-hidden="true" />;
  return <FileText size={size} aria-hidden="true" />;
}

export function ArtifactChip({
  name,
  present = true,
  sizeBytes,
  kind,
  selected,
  onSelect,
  className,
}: {
  name: string;
  /** false: expected but not dropped yet. */
  present?: boolean;
  /** File size, omitted for a missing expected artifact. */
  sizeBytes?: number;
  /** Omitted for a missing expected artifact (no type to show yet). */
  kind?: ArtifactKind;
  selected?: boolean;
  /** When set, the chip becomes a two-state button (preview open / closed). */
  onSelect?: () => void;
  className?: string;
}) {
  const state = present ? "st-ok" : "st-wait";
  const title = present
    ? onSelect
      ? selected
        ? T.close(name)
        : T.open(name)
      : name
    : T.awaited(name);
  return (
    <Chip
      kind={state}
      mono
      title={title}
      className={["dm-artifact", className].filter(Boolean).join(" ")}
      selected={selected}
      onToggle={onSelect}
    >
      {present ? kindIcon(kind, 12) : <CircleDashed size={12} aria-hidden="true" />}
      <span className="dm-artifact-name">{name}</span>
      {sizeBytes != null && (
        <Num value={(sizeBytes / KO).toFixed(1)} suffix={T.kilobytes} tone="muted" />
      )}
    </Chip>
  );
}

/** File preview. Text: sandboxed iframe (`allow-scripts` only, no access to the host page). Image:
 *  a plain `<img>`. Other binary: no preview attempted, a download link instead.
 *
 *  An HTML report is the case this preview exists for, and the only one running agent-written code.
 *  Two locks, neither for comfort:
 *  - the frame is `sandbox="allow-scripts"` WITHOUT `allow-same-origin`, so the document has an
 *    opaque origin: it reaches neither the app DOM nor its cookies, and cannot READ an API response
 *    even if it calls one (`fetch('/api/secrets')` goes out without credentials and comes back
 *    empty);
 *  - the server response carries `Content-Security-Policy: sandbox allow-scripts`
 *    (`server/src/tasks/routes/artifacts.ts`), so the same confinement applies when the document is
 *    opened in a tab, where the frame attribute no longer plays.
 *  The content NEVER enters the app DOM: no `dangerouslySetInnerHTML`, ever. */
export function ArtifactPreview({
  name,
  src,
  kind = "text",
  onClose,
  className,
}: {
  name: string;
  src: string;
  kind?: ArtifactKind;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div className={["dm-artifact-preview", className].filter(Boolean).join(" ")}>
      <Toolbar
        label={T.preview(name)}
        variant="bar"
        end={
          <>
            {/* A binary has no tab to open: it downloads (content-disposition), and that gesture is
              already in the preview body. */}
            {kind !== "binary" && (
              <IconBtn
                title={T.openTab(name)}
                variant="quiet"
                render={(p) => <a {...p} href={src} target="_blank" rel="noreferrer" />}
              >
                <ExternalLink size={13} />
              </IconBtn>
            )}
            <IconBtn title={T.closePreview} variant="quiet" onClick={onClose}>
              <X size={13} />
            </IconBtn>
          </>
        }
      >
        {kindIcon(kind, 13)}
        <Text size="sm" weight="medium">
          {name}
        </Text>
      </Toolbar>
      {kind === "image" && (
        // key: switching artifact reloads the image instead of keeping the old one on screen.
        <img key={src} src={src} alt={name} className="dm-artifact-image" />
      )}
      {kind === "text" && (
        // key: switching artifact reloads the frame instead of keeping the old document.
        <iframe
          key={src}
          title={name}
          src={src}
          sandbox="allow-scripts"
          className="dm-artifact-frame"
        />
      )}
      {kind === "binary" && (
        <div className="dm-artifact-download">
          <Text size="sm" tone="muted" as="p">
            {T.noPreview}
          </Text>
          <Link href={src} download={name}>
            <Download size={13} aria-hidden="true" /> {T.download(name)}
          </Link>
        </div>
      )}
    </div>
  );
}
