// Memory-to-rule gate (04/09).
//
// `suggestRuleFromCorrection` (capabilities.ts) asks a model whether a human answer holds a
// durable instruction. It stays conservative on free text, not on a FormSpec grid: a list of
// product decisions reads like standing orders. On 03/09 five suggestions saturated the quota at
// once, each copying field ids (`goal_case`, `erase_if_hard`…).
//
// The discriminant sits above the model, in the answer's shape: `formData` (not overridden by
// free text) is a decision grid, and a bare `choiceId` wrote nothing. Only free text a human
// wrote can become a rule.
export type RuleSuggestionInput = {
  choiceId?: string;
  text?: string;
  formData?: unknown;
};

/** True only for free text written by the human: never a click (`choiceId`, which always wins
 *  over `answerText` in `answerInbox`) nor a form submission without text. Length and origin are
 *  separate guards, set by the caller. */
export function isFreeTextAnswer(input: RuleSuggestionInput): boolean {
  if (input.choiceId) return false;
  if (input.formData !== undefined && !input.text) return false;
  return true;
}
