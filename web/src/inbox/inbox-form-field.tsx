// ONE inbox form field (v31): the SCHEMA comes from the agent, the RENDERING from here, design system
// components only, never an agent-drawn control. Real validation is the server's (inbox-form.ts).
import { useId } from "react";
import { type FormField } from "../api/inbox.js";
import { Checkbox, Radio, RadioGroup } from "../ui/choice.js";
import { Field } from "../ui/form.js";
import { Input, Textarea } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Caption } from "../ui/text.js";
import { Stack } from "../ui/flex.js";
import { INBOX_KIND } from "../api/inbox.js";

export function InboxFormField({
  field: f,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  // Two open forms can declare the same field id: the radio group name is prefixed with a render
  // identity so groups do not steal each other's selection.
  const uid = useId();

  // A checkbox does not go into <Field>: both set a <label>, and a label inside a label is not HTML.
  // It carries its own label, the hint as a caption below.
  if (f.type === "checkbox")
    return (
      <div>
        <Checkbox checked={value === true} onChange={onChange}>
          {f.label}
        </Checkbox>
        {f.hint && <Caption>{f.hint}</Caption>}
      </div>
    );

  // A radio `hint` used to be SWALLOWED: `RadioGroup` takes none and this branch rendered it nowhere.
  // The agent writes its recommendation there, and the screen silently ate it. On 25/08, on a
  // seven-question round: "I don't know what to answer, every choice is potentially valid".
  if (f.type === "radio")
    return (
      <Stack gap={4}>
        <RadioGroup
          label={f.label}
          name={`${uid}-${f.id}`}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        >
          {f.options?.map((o) => (
            <Radio key={o.id} value={o.id}>
              {o.label}
            </Radio>
          ))}
        </RadioGroup>
        {f.hint && <Caption>{f.hint}</Caption>}
      </Stack>
    );

  return (
    <Field label={f.label} hint={f.hint} required={f.required ?? false}>
      <ScalarInput field={f} value={value} onChange={onChange} />
    </Field>
  );
}

/** Fields that go into a `<Field>`: select, textarea, or single line. Checkbox and radio group set
 *  their own label. */
function ScalarInput({
  field: f,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const text = typeof value === "string" ? value : "";
  if (f.type === "select")
    return (
      <Select value={text} aria-label={f.label} onChange={(e) => onChange(e.target.value)}>
        {f.options?.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  if (f.type === "textarea")
    return (
      <Textarea
        value={text}
        placeholder={f.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <Input
      type={f.type === "number" ? "number" : INBOX_KIND.text}
      size="md"
      value={typeof value === "string" || typeof value === "number" ? value : ""}
      placeholder={f.placeholder}
      min={f.min}
      max={f.max}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
