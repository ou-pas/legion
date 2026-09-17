// Adding a rule by hand, title and free text, besides the dropzone. Collapsed until needed: a
// permanent instruction is rarely written.
import { useState } from "react";
import { Plus } from "lucide-react";
import { capabilitiesApi } from "../api/capabilities.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/choice.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Field, FormError } from "../ui/form.js";
import { Input, Textarea } from "../ui/input.js";
import { Inset } from "../ui/inset.js";
import { splitGlobs } from "./rule-weight.js";
import { RULES_TEXT } from "./text/rules.js";

export function ManualRuleForm({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [paths, setPaths] = useState("");
  const [allAgents, setAllAgents] = useState(true);
  const [error, setError] = useState("");

  if (!open)
    return (
      <Row gap={8} wrap>
        <Button leading={<Plus size={12} />} onClick={() => setOpen(true)}>
          {RULES_TEXT.form.open}
        </Button>
      </Row>
    );

  const add = () =>
    capabilitiesApi
      .createRule({ projectId, name, content, allAgents, summary, paths: splitGlobs(paths) })
      .then(() => {
        setName("");
        setSummary("");
        setContent("");
        setPaths("");
        setError("");
        setOpen(false);
        onAdded();
      })
      .catch((e: Error) => setError(e.message));

  return (
    <Inset label={RULES_TEXT.form.label}>
      <Stack gap={10}>
        <Field label={RULES_TEXT.form.nameLabel} required>
          <Input
            autoFocus
            placeholder={RULES_TEXT.form.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {/* The summary comes before the body on purpose: it is what goes into the prompt. After the
            body it would pass for an addition when it is the part that applies. */}
        <Field label={RULES_TEXT.form.summaryLabel} hint={RULES_TEXT.form.summaryHint}>
          <Input
            placeholder={RULES_TEXT.form.summaryPlaceholder}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Field>
        <Field label={RULES_TEXT.form.contentLabel} required hint={RULES_TEXT.form.contentHint}>
          <Textarea
            rows={5}
            placeholder={RULES_TEXT.form.contentPlaceholder}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
        {/* Patterns come after the body: you know what a rule says before when it applies. The
            reverse would have you fill a field whose object you do not have yet. */}
        <Field label={RULES_TEXT.form.pathsLabel} hint={RULES_TEXT.form.pathsHint}>
          <Textarea
            rows={2}
            placeholder={RULES_TEXT.form.pathsPlaceholder}
            value={paths}
            onChange={(e) => setPaths(e.target.value)}
          />
        </Field>
        <Row gap={10} wrap>
          <Checkbox checked={allAgents} onChange={setAllAgents}>
            {RULES_TEXT.form.allAgents}
          </Checkbox>
          <Spacer />
          <Button onClick={() => setOpen(false)}>{RULES_TEXT.form.cancel}</Button>
          <Button
            variant="primary"
            leading={<Plus size={12} />}
            onClick={add}
            disabled={!name.trim() || !content.trim()}
          >
            {RULES_TEXT.form.submit}
          </Button>
        </Row>
        {error && <FormError>{error}</FormError>}
      </Stack>
    </Inset>
  );
}
