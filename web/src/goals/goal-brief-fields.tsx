// A goal's BRIEF (name and request) as form fields, shared by the composer (creation) and the
// `draft` goal editor. Creating and editing show THE SAME THING: two drifting forms would suggest
// they write different fields. `rows` is the caller's only freedom: rereading a long request to fix
// it needs more room than typing it the first time.
import { Field } from "../ui/form.js";
import { Input, Textarea } from "../ui/input.js";
import { GOAL_TEXT } from "./text.js";

export function GoalBriefFields({
  name,
  request,
  onName,
  onRequest,
  rows = 4,
  autoFocus = false,
}: {
  name: string;
  request: string;
  onName: (value: string) => void;
  onRequest: (value: string) => void;
  /** Request field height in rows: 4 at creation, more when rereading. */
  rows?: number;
  autoFocus?: boolean;
}) {
  return (
    <>
      <Field label={GOAL_TEXT.composer.name} required>
        <Input
          autoFocus={autoFocus}
          placeholder={GOAL_TEXT.composer.namePlaceholder}
          value={name}
          onChange={(e) => onName(e.target.value)}
        />
      </Field>
      <Field label={GOAL_TEXT.composer.request} required hint={GOAL_TEXT.composer.requestHint}>
        <Textarea
          rows={rows}
          placeholder={GOAL_TEXT.composer.requestPlaceholder}
          value={request}
          onChange={(e) => onRequest(e.target.value)}
        />
      </Field>
    </>
  );
}
