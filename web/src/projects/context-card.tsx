// The project's living context (v11): injected into every session's system prompt and
// auto-enriched after real tasks. It is the operator's document, editable and erasable here;
// otherwise "auto-enriched" would mean "written by the machine, endured by the human".
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check } from "lucide-react";
import { projectsApi, type Project } from "../api/projects.js";
import { qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Code } from "../ui/code.js";
import { Stack } from "../ui/flex.js";
import { Field, FormError } from "../ui/form.js";
import { Textarea } from "../ui/input.js";
import { Prose } from "../ui/prose.js";
import { CONTEXT_CARD_TEXT as T } from "./text/context.js";

/** How long "Saved" stays on the button before it turns back into "Save". */
const SAVED_MS = 1500;

export function ContextCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  // `null`, not the project value: until something is typed, the card follows the server, so an
  // automatic enrichment arriving meanwhile shows instead of being hidden by a non-existent draft.
  const value = text ?? project.context ?? "";
  const dirty = value !== (project.context ?? "");

  const save = () =>
    projectsApi
      .patchProject(project.id, { context: value })
      .then(() => {
        setSaved(true);
        setErr("");
        setText(null);
        setTimeout(() => setSaved(false), SAVED_MS);
        void qc.invalidateQueries({ queryKey: qk.bootstrap });
      })
      .catch((e: Error) => setErr(e.message));

  return (
    <Card
      icon={<BookOpen size={16} />}
      title={T.title}
      desc={T.why}
      actions={
        <Button
          variant="primary"
          disabled={!dirty}
          leading={saved ? <Check size={12} /> : undefined}
          onClick={save}
        >
          {saved ? T.saved : T.save}
        </Button>
      }
    >
      <Stack gap={8}>
        {err && <FormError>{err}</FormError>}
        {/* Prose bounds the editor to the reading measure: 8000 characters across a 27" screen
            cannot be reread. */}
        <Prose width="measure">
          <Field
            label={T.fieldLabel}
            hint={
              <>
                <Code variant="bare">{value.length}</Code> {T.limit}
              </>
            }
          >
            <Textarea
              rows={10}
              value={value}
              onChange={(e) => setText(e.target.value)}
              placeholder={T.placeholder}
            />
          </Field>
        </Prose>
      </Stack>
    </Card>
  );
}
