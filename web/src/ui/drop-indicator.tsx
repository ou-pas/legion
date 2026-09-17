// Drag and drop placeholder: covers, `position: absolute`, the card being moved, which the caller
// keeps in the DOM with `visibility: hidden`. It thus inherits the card's exact variable height
// without measuring it. A dashed `--accent` frame, never a solid line: in a stack of cards of
// different heights, a 2px line gets lost between two-line titles and does not say how much room
// the object will take when it lands.
import "./drop-indicator.css";

export function DropIndicator() {
  return <div className="ui-drop-indicator" role="presentation" />;
}
