// What this pane will become, drawn as outlines (15/09, operator request: an empty pane looked odd).
// Without a channel the page wrote the same empty state TWICE, in the list and in this pane, the
// second adding nothing above a thousand empty pixels.
//
// The shapes are INERT, unlike `ui/skeleton.tsx`: a skeleton BREATHES because something is loading.
// Nothing loads here, and a pulsing shape would promise an imminent arrival.
//
// They carry NO text, not even fake: a greyed task name in a preview reads as a real task one tries to
// open. The shape says the layout: a header, alternating turns, a footer.
import { Caption } from "../ui/text.js";
import { CHANNELS_TEXT } from "./text.js";
import "./channel-preview.css";

const T = CHANNELS_TEXT.list.preview;

/** `side` says who speaks; width varies so the pile does not read as a table. */
function Turn({ side, size }: { side: "agent" | "you"; size: "sm" | "md" | "lg" }) {
  return <div className="ch-demo-turn" data-side={side} data-size={size} aria-hidden="true" />;
}

export function ChannelPreview() {
  return (
    <div className="ch-demo">
      {/* `aria-hidden` on the shapes, never on the caption: a screen reader hears the sentence, not
          the decor. */}
      <div className="ch-demo-head" aria-hidden="true">
        <div className="ch-demo-title" />
        <div className="ch-demo-chips">
          <span />
          <span />
        </div>
      </div>
      {/* The thread takes the full height and fades out downwards: four turns at the top of a
          thousand-pixel pane left exactly the emptiness being removed; the fade says it continues. */}
      <div className="ch-demo-thread">
        <Turn side="agent" size="lg" />
        <Turn side="you" size="sm" />
        <Turn side="agent" size="md" />
        <Turn side="agent" size="sm" />
        <Turn side="you" size="md" />
        <Turn side="agent" size="lg" />
        <Turn side="agent" size="md" />
        <Turn side="you" size="sm" />
      </div>
      <div className="ch-demo-foot" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <Caption className="ch-demo-caption">{T.caption}</Caption>
    </div>
  );
}
