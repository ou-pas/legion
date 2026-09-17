// A machine's images, and the gesture that catches them up (07/09).
//
// Everything the card says about images lives here: the stale or missing session image (09/09),
// shared images that drifted (03/09) or are missing, the rebuild started or refused. Finding and
// gesture stay in the same sentence, which the old global banner did not do.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { Hammer, TriangleAlert } from "lucide-react";
import {
  infraApi,
  type ImageTarget,
  type InfraRunner,
  type RunnerProjectImage,
} from "../api/infra.js";
import { qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Code } from "../ui/code.js";
import { Link } from "../ui/link.js";
import { PanelNote } from "../ui/panel.js";
import { INFRA_TEXT } from "./text.js";

/** The gesture lives on the project page (`SessionRuntimeCard`), not here: this note points there. */
function ProjectImageLink({ projectId }: { projectId: string }) {
  return (
    <Link
      variant="plain"
      render={(p) => (
        <RouterLink to="/p/$projectId/project/runtime" params={{ projectId }} {...p} />
      )}
    >
      {INFRA_TEXT.projectImage.link}
    </Link>
  );
}

/** A note's reason, by severity: a refused Dockerfile will never build, an absence blocks every run,
 *  staleness still runs but with old code. Same hierarchy as `ProjectImageNotes` on the project page. */
function projectImageReason(p: RunnerProjectImage, runnerName: string): string | null {
  if (p.image.dockerfile.present && !p.image.dockerfile.valid)
    return INFRA_TEXT.projectImage.invalidDockerfile(p.projectName, p.image.dockerfile.error ?? "");
  if (!p.image.present) return INFRA_TEXT.projectImage.absent(p.projectName, runnerName);
  if (p.image.stale) return INFRA_TEXT.projectImage.stale(p.projectName, runnerName);
  return null;
}

export function RunnerImageNotes({ runner }: { runner: InfraRunner }) {
  const qc = useQueryClient();
  // The server returns at once; `image.rebuilding` takes over on the next `/api/infra`, then `stale`
  // drops when the label matches the repository.
  const rebuild = useMutation({
    mutationFn: (target: ImageTarget) => infraApi.rebuildImage(runner.runnerId, target),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.infra }),
  });
  const rebuilding = runner.image.rebuilding || rebuild.isPending;
  const gesture = (target: ImageTarget) =>
    rebuilding ? (
      INFRA_TEXT.rebuild.running
    ) : (
      <Button
        size="sm"
        leading={<Hammer size={13} />}
        loading={rebuild.isPending}
        onClick={() => rebuild.mutate(target)}
      >
        {INFRA_TEXT.rebuild.button}
      </Button>
    );
  if (!runner.available) return null;

  // A missing image rebuilds with the same click as a stale one (09/09). The gesture does not depend
  // on the reason: `make image-*` builds in both cases. Splitting them left the missing case with a
  // sentence and no button, and it is the case where nothing starts.
  const sessionNote = !runner.image.present
    ? INFRA_TEXT.rebuild.sessionAbsent(runner.runnerName)
    : runner.image.stale
      ? INFRA_TEXT.rebuild.sessionStale(runner.runnerName)
      : null;

  return (
    <>
      {sessionNote && (
        <PanelNote tone="wait" icon={<TriangleAlert size={14} />}>
          {sessionNote} {gesture("session")}
        </PanelNote>
      )}
      {/* One note per shared image: they do not break the same thing. */}
      {runner.sharedImages
        .filter((img) => img.stale || !img.present)
        .map((img) => (
          <PanelNote key={img.key} tone="wait" icon={<TriangleAlert size={14} />}>
            {img.present
              ? INFRA_TEXT.sharedImages.stale(INFRA_TEXT.sharedImages.name(img.key))
              : INFRA_TEXT.sharedImages.absent(INFRA_TEXT.sharedImages.name(img.key))}
            {img.builtVersion && img.currentVersion && (
              <> {INFRA_TEXT.sharedImages.drift(img.builtVersion, img.currentVersion)}</>
            )}{" "}
            {INFRA_TEXT.sharedImages.fix} <Code>make {img.makeTarget}</Code> {gesture(img.key)}
          </PanelNote>
        ))}
      {/* Project images declared on this runner (11/09): `runner.image` above only probes the
          default tag, never the one a project names. No button: the project page already carries
          the gesture, and the note points there rather than build a second one. */}
      {runner.projectImages.map((p) => {
        const reason = projectImageReason(p, runner.runnerName);
        if (!reason) return null;
        return (
          <PanelNote key={p.projectId} tone="wait" icon={<TriangleAlert size={14} />}>
            {reason}{" "}
            {p.image.rebuilding ? (
              INFRA_TEXT.projectImage.rebuilding
            ) : (
              <ProjectImageLink projectId={p.projectId} />
            )}
          </PanelNote>
        );
      })}
      {rebuild.isSuccess && (
        <PanelNote>{INFRA_TEXT.rebuild.started(rebuild.data.logPath)}</PanelNote>
      )}
      {rebuild.isError && (
        <PanelNote tone="bad" icon={<TriangleAlert size={14} />}>
          {INFRA_TEXT.rebuild.failed(String((rebuild.error as Error)?.message ?? rebuild.error))}
        </PanelNote>
      )}
    </>
  );
}
