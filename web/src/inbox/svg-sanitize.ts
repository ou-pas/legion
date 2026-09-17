// THE security boundary for agent SVG (v31), a single choke point like resolveAgentPath for fs. An
// inbox diagram comes from an agent possibly contaminated by what it read (repo, issue): rendered as
// is, a prompt injection would become XSS on the app origin, with the operator's rights on the whole
// API. So:
//
//  - DOMPurify SVG profile: scripts, on* handlers, active data URIs already removed;
//  - `foreignObject` forbidden (it reopens arbitrary HTML INSIDE the svg);
//  - `style` forbidden (an @import would make an external request);
//  - `href`/`xlink:href` forbidden, even internal: diagrams do not need them, and an
//    "internal only" allowlist would be one more rule never to break.
//
// The server refuses the obvious at creation (inbox-form.ts, belt); the guarantee is HERE.
import DOMPurify from "dompurify";

export function sanitizeSvg(raw: string): string {
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "style", "animate", "animateTransform", "set"],
    FORBID_ATTR: ["href", "xlink:href"],
  });
  // DOMPurify can return an empty string (unrecoverable markup): the caller then shows a "diagram
  // removed" state rather than a silent hole.
  return clean.trim();
}
