// Inline buttons or a vertical list, the rule alone. A "yes" and a 90-character sentence do not read
// side by side. Visual contract thresholds (03-systeme-visuel.md): 28 characters for one label, or a
// 28-character gap between the shortest and longest label of a group. One long choice switches the
// WHOLE group to a list, never half and half.
const THRESHOLD = 28;

export type ChoiceLayout = "inline" | "stacked";

export function choiceLayout(labels: readonly string[]): ChoiceLayout {
  if (labels.length === 0) return "inline";
  const lengths = labels.map((label) => label.length);
  const longest = Math.max(...lengths);
  const shortest = Math.min(...lengths);
  return longest > THRESHOLD || longest - shortest > THRESHOLD ? "stacked" : "inline";
}
