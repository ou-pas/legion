// One implementation, five explicit states, so drop zones on two screens no longer diverge.
import type { DragEvent, ReactNode } from "react";
import { Ban, FileText, Loader2, Upload, X } from "lucide-react";
import { UI_TEXT } from "./vocabulary.js";
import { formatBytes } from "./bytes.js";
import "./dropzone.css";

export function Dropzone({
  over = false,
  busy = false,
  rejected = false,
  label,
  hint,
  disabled = false,
  className,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
}: {
  over?: boolean;
  busy?: boolean;
  rejected?: boolean;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
  onClick: () => void;
}) {
  // Precedence: a refusal must stay readable even while the cursor is still over the zone.
  const state = rejected ? "rejected" : busy ? "busy" : over ? "over" : "idle";
  const Icon = state === "busy" ? Loader2 : state === "rejected" ? Ban : Upload;
  return (
    <button
      type="button"
      className={["ui-dropzone", className].filter(Boolean).join(" ")}
      data-state={state}
      disabled={disabled}
      aria-busy={busy || undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
    >
      <Icon size={16} className="ui-dropzone-icon" aria-hidden="true" />
      <span className="ui-dropzone-text">
        {busy && !rejected ? UI_TEXT.dropzone.busy : label}
        {hint && <span className="ui-dropzone-hint">{hint}</span>}
      </span>
    </button>
  );
}

/** Truncated name, size in mono, explicit removal. */
export function FileChip({
  name,
  bytes,
  onRemove,
  className,
}: {
  name: string;
  bytes?: number;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span className={["ui-filechip", className].filter(Boolean).join(" ")}>
      <FileText size={13} className="ui-filechip-icon" aria-hidden="true" />
      <span className="ui-filechip-name" title={name}>
        {name}
      </span>
      {bytes !== undefined && <span className="ui-filechip-size">{formatBytes(bytes)}</span>}
      {onRemove && (
        <button
          type="button"
          className="ui-filechip-x"
          aria-label={UI_TEXT.dropzone.removeFile(name)}
          onClick={onRemove}
        >
          <X size={13} />
        </button>
      )}
    </span>
  );
}
