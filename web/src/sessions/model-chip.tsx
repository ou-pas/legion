// A session's model: literal data, so a <Tag> (mono, rectangular), not a state. The `claude-` prefix
// is the same on every model and steals room from the part that differs (`sonnet-4-5` / `opus-4-5`);
// the full name stays on hover.
import { Tag } from "../ui/chip.js";

export function ModelChip({ model }: { model: string }) {
  if (!model) return null;
  return <Tag title={model}>{model.replace(/^claude-/, "")}</Tag>;
}
