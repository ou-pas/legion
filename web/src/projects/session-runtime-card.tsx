// The project's Sessions tab: its session image and the Dockerfile layered on top.
//
// The Dockerfile is pasted here, not read from a repository (v67): a first version required cloning
// the project repository on the docker host to read `.legion/Dockerfile`, the costliest gesture of
// a whole batch for a layer of a few lines. Pasting the text into the project config removes that
// clone.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Container, Hammer, TriangleAlert } from "lucide-react";
import { projectsApi, type Project } from "../api/projects.js";
import { qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Code } from "../ui/code.js";
import { Stack } from "../ui/flex.js";
import { Field, FormError } from "../ui/form.js";
import { Input, Textarea } from "../ui/input.js";
import { PanelNote } from "../ui/panel.js";
import { SESSION_RUNTIME_TEXT as T } from "./text/session-runtime.js";

/** The missing visibility (Kopee.me outage, 09/09): is the image this project declares actually
 *  built on every runner, not just written in the field above. One note per failing runner, with the
 *  gesture next to it (`server/src/infra/project-image.ts`, `POST .../session-image/rebuild`), same
 *  shape as `RunnerImageNotes` on the Infra card. */
function ProjectImageNotes({ project }: { project: Project }) {
  const qc = useQueryClient();
  const enabled = Boolean(project.sessionImage?.trim());
  const { data } = useQuery({
    queryKey: qk.projectImage(project.id),
    queryFn: () => projectsApi.sessionImageState(project.id),
    enabled,
    refetchInterval: 60_000,
  });
  const rebuild = useMutation({
    mutationFn: (runnerId: string) => projectsApi.rebuildSessionImage(project.id, runnerId),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.projectImage(project.id) }),
  });
  if (!enabled || !data?.runners) return null;

  const trouble = data.runners.filter(
    (r) =>
      !r.image.present ||
      r.image.stale ||
      (r.image.dockerfile.present && !r.image.dockerfile.valid),
  );
  if (trouble.length === 0) return null;

  return (
    <Stack gap={4}>
      {trouble.map((r) => {
        const building =
          r.image.rebuilding || (rebuild.isPending && rebuild.variables === r.runnerId);
        const gesture = building ? (
          T.runnerImage.building
        ) : (
          <Button
            size="sm"
            leading={<Hammer size={13} />}
            onClick={() => rebuild.mutate(r.runnerId)}
          >
            {T.runnerImage.build}
          </Button>
        );
        const reason =
          r.image.dockerfile.present && !r.image.dockerfile.valid
            ? T.runnerImage.invalidDockerfile(r.image.dockerfile.error ?? "")
            : !r.image.present
              ? T.runnerImage.absent(r.runnerName)
              : T.runnerImage.stale(r.runnerName);
        return (
          <PanelNote key={r.runnerId} tone="wait" icon={<TriangleAlert size={14} />}>
            <Code>{r.image.tag}</Code> {reason} {gesture}
          </PanelNote>
        );
      })}
      {rebuild.isSuccess && <PanelNote>{T.runnerImage.started}</PanelNote>}
      {rebuild.isError && (
        <PanelNote tone="bad" icon={<TriangleAlert size={14} />}>
          {T.runnerImage.failed(String((rebuild.error as Error)?.message ?? rebuild.error))}
        </PanelNote>
      )}
    </Stack>
  );
}

export function SessionRuntimeCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  // `null` = "untouched", distinct from "emptied by hand". Without it, clearing a field would
  // refill it from the project on the next render, and you could never return to the default,
  // which is exactly what the empty string means here.
  const [image, setImage] = useState<string | null>(null);
  const [dockerfile, setDockerfile] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const imageValue = image ?? project.sessionImage ?? "";
  const dockerfileValue = dockerfile ?? project.sessionDockerfile ?? "";
  const dirty =
    imageValue !== (project.sessionImage ?? "") ||
    dockerfileValue !== (project.sessionDockerfile ?? "");

  const save = () =>
    projectsApi
      .patchProject(project.id, { sessionImage: imageValue, sessionDockerfile: dockerfileValue })
      .then(() => {
        setSaved(true);
        setErr("");
        setImage(null);
        setDockerfile(null);
        setTimeout(() => setSaved(false), 1500);
        void qc.invalidateQueries({ queryKey: qk.bootstrap });
      })
      .catch((e: Error) => setErr(e.message));

  return (
    <Card
      icon={<Container size={16} />}
      title={T.image.title}
      desc={T.image.why}
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
      <Stack gap={12}>
        {err && <FormError>{err}</FormError>}
        <Field label={T.image.label} hint={T.image.hint}>
          <Input
            placeholder={T.image.placeholder}
            value={imageValue}
            onChange={(e) => setImage(e.target.value)}
          />
        </Field>
        <Field label={T.dockerfile.label} hint={T.dockerfile.hint}>
          <Textarea
            rows={6}
            placeholder={T.dockerfile.placeholder}
            value={dockerfileValue}
            onChange={(e) => setDockerfile(e.target.value)}
          />
        </Field>
        <ProjectImageNotes project={project} />
      </Stack>
    </Card>
  );
}
