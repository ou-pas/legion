// What the task page says when the chosen machine does not have the session image. The wording
// lives here and not in the component, like the card's: a domain label is not a drawing
// primitive.
import { defineText } from "../../i18n/catalog.js";

export const TASK_IMAGE_TEXT = defineText({
  /** THE CAUSE AND THE GESTURE IN THE SAME SENTENCE. A note saying only "image missing" would
   *  leave the operator hunting for where to fix it — which is exactly what the screen did
   *  before this batch, and what cost two dead tasks on 08/09. */
  absent: (image: string, runner: string) =>
    `Image "${image}" is not on machine "${runner}": the task waits, the queue skips it.`,
  button: "Rebuild the image",
  /** The button DISAPPEARS during the build, replaced by this sentence: a disabled button
   *  explains nothing (its `title` does not show), and a second click would only be turned down
   *  by the rebuild lock. */
  running:
    "Rebuilding (2 to 4 min) — the queue will pick the task up on its own as soon as the image is there.",
  failed: (why: string) => `Rebuild failed: ${why}`,
});
