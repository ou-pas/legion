// An inbox form SVG diagram (v31): THE ONLY injection point of agent markup into the app DOM.
// Everything goes through sanitizeSvg (the boundary, documented there); unrecoverable markup gives a
// STATED "diagram removed" state, never a silent hole.
import { useMemo } from "react";
import { ShieldAlert } from "lucide-react";
import { Row } from "../ui/flex.js";
import { Caption } from "../ui/text.js";
import { sanitizeSvg } from "./svg-sanitize.js";
import { INBOX_TEXT } from "./text.js";
import "./inbox-form.css";

export function InboxFormSvg({ svg, caption }: { svg: string; caption?: string }) {
  // Sanitising depends on the markup alone: redoing it every render ran DOMPurify on each keystroke in
  // the questionnaire, phones included.
  const clean = useMemo(() => sanitizeSvg(svg), [svg]);
  if (!clean)
    return (
      <Row gap={6}>
        <ShieldAlert size={14} aria-hidden="true" />
        <Caption>{INBOX_TEXT.form.svgRemoved}</Caption>
      </Row>
    );
  return (
    <figure className="inbox-form-svg">
      {/* oxlint-disable-next-line react/no-danger -- the one sanctioned injection point: markup
          comes from sanitizeSvg (DOMPurify SVG profile, foreignObject/style/href forbidden). */}
      <div className="inbox-form-svg-canvas" dangerouslySetInnerHTML={{ __html: clean }} />
      {caption && (
        <figcaption>
          <Caption>{caption}</Caption>
        </figcaption>
      )}
    </figure>
  );
}
