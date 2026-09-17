// Models (v24, project default added in nav batch 2a), relaying the server contract of ki-m2lNCfS.
//
// A task's complexity picks its model when neither the task nor the agent imposes one (order: task
// override → agent model → complexity → project default). Each level is set here, including a
// pinned dated id: an id unknown to the list stays shown, the current setting does not vanish
// under the operator's eyes.
//
// The project default was named as the fallback in the three selects without a field to set it;
// `PATCH /api/projects/:id` now accepts it. It cannot be empty: it is routing's last fallback.
//
// The PATCH always sends the three routing keys (`null` = back to default): the server replaces
// the whole object, and an omitted key would reset (v24 contract).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Route } from "lucide-react";
import { projectsApi, type Project } from "../api/projects.js";
import { modelsQuery, qk } from "../queries.js";
import { ModelPicker } from "../models/model-picker.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Code } from "../ui/code.js";
import { Divider } from "../ui/divider.js";
import { Stack } from "../ui/flex.js";
import { Field, FormError, FormRow } from "../ui/form.js";
import { Caption } from "../ui/text.js";
import { MODEL_ROUTING_TEXT as T } from "./text/models.js";

type Level = "low" | "med" | "high";
type Routing = Partial<Record<Level, string>>;

const LEVELS: readonly Level[] = ["low", "med", "high"];
const SAVED_MS = 1500;

export function ModelRoutingCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { data: modelList } = useQuery(modelsQuery);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Routing | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const models = modelList?.models ?? [];
  const current = JSON.parse(project.modelRouting || "{}") as Routing;
  const value = draft ?? current;
  const defaultValue = defaultModel ?? project.defaultModel;
  const defaultEmpty = defaultValue.trim().length === 0;
  const dirty =
    JSON.stringify(value) !== JSON.stringify(current) || defaultValue !== project.defaultModel;

  const save = () =>
    projectsApi
      .patchProject(project.id, {
        defaultModel: defaultValue,
        modelRouting: { low: value.low ?? null, med: value.med ?? null, high: value.high ?? null },
      })
      .then(() => {
        setSaved(true);
        setErr("");
        setDefaultModel(null);
        setDraft(null);
        setTimeout(() => setSaved(false), SAVED_MS);
        void qc.invalidateQueries({ queryKey: qk.bootstrap });
      })
      .catch((e: Error) => setErr(e.message));

  return (
    <Card
      icon={<Route size={16} />}
      title={T.title}
      actions={
        <Button
          variant="primary"
          disabled={!dirty || defaultEmpty}
          leading={saved ? <Check size={12} /> : undefined}
          onClick={save}
        >
          {saved ? T.saved : T.save}
        </Button>
      }
      desc={
        <>
          {T.descBefore}
          <Code variant="bare">opus</Code>
          {T.descAfter}
        </>
      }
    >
      <Stack gap={12}>
        {err && <FormError>{err}</FormError>}
        <Field label={T.defaultTitle} hint={T.defaultWhy}>
          <ModelPicker
            value={defaultValue}
            models={models}
            projectId={project.id}
            ariaLabel={T.defaultPickerLabel}
            emptyLabel={T.defaultEmpty}
            onChange={(id) => setDefaultModel(id)}
          />
        </Field>
        {defaultEmpty && <Caption tone="bad">{T.defaultRequired}</Caption>}

        <Divider />

        <FormRow>
          {LEVELS.map((level) => (
            <Field key={level} label={T.levels[level]}>
              <ModelPicker
                value={value[level] ?? ""}
                models={models}
                projectId={project.id}
                ariaLabel={T.pickerLabel(T.levels[level])}
                emptyLabel={T.fallback(project.defaultModel)}
                onChange={(id) => setDraft({ ...value, [level]: id || undefined })}
              />
            </Field>
          ))}
        </FormRow>
      </Stack>
    </Card>
  );
}
