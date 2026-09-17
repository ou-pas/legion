// Danger zone: deleting the project.
//
// There was no way to do it, through the API or the UI: a trial project stayed in the rail forever
// (operator's finding, 20/08).
//
// Two principles: announce what gets destroyed ("delete this project" and "delete 23 tasks and 23
// sessions" are not decided the same way), and refuse while a session works, since its container
// still runs and would lose its callback target mid-flight.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Trash2, TriangleAlert } from "lucide-react";
import { projectsApi, type Project, type ProjectFootprint } from "../api/projects.js";
import { qk } from "../queries.js";
import { Card } from "../ui/card.js";
import { Code } from "../ui/code.js";
import { ConfirmAction } from "../ui/confirm-action.js";
import { Row, Stack } from "../ui/flex.js";
import { FormError } from "../ui/form.js";
import { Text } from "../ui/text.js";
import { DANGER_CARD_TEXT as T, FOOTPRINT_WORDS } from "./text/danger.js";
import { plural } from "../ui/plural.js";

/** The footprint in words: "23 tasks, 4 agents, 1 secret". Zero lines are skipped: they would drown
 *  what matters for the decision.
 *
 *  Spreading (`{ ...footprint }`) rather than `as unknown as Record<string, number>`: every field of
 *  `ProjectFootprint` is a number, so the spread types itself, and a field that stopped being one
 *  would fail compilation where the cast would have swallowed it. */
export function footprintParts(footprint: ProjectFootprint | undefined): string[] {
  if (!footprint) return [];
  const counts: Record<string, number> = { ...footprint };
  return FOOTPRINT_WORDS.map(([key, one, many]) => ({ n: counts[key] ?? 0, one, many }))
    .filter(({ n }) => n > 0)
    .map(({ n, one, many }) => `${n} ${plural(n, one, many)}`);
}

export function DangerCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [err, setErr] = useState("");
  const { data } = useQuery({
    queryKey: ["project-footprint", project.id],
    queryFn: () => projectsApi.projectFootprint(project.id),
  });

  const live = data?.live ?? [];
  const parts = footprintParts(data?.footprint);

  const remove = () =>
    projectsApi
      .deleteProject(project.id)
      .then(() =>
        Promise.all([
          qc.invalidateQueries({ queryKey: qk.bootstrap }),
          qc.invalidateQueries({ queryKey: qk.tasks }),
          navigate({ to: "/" }),
        ]),
      )
      .catch((e: Error) => setErr(e.message));

  return (
    <Card
      icon={<TriangleAlert size={16} />}
      title={T.title}
      desc={
        <>
          {T.descBefore} <Code variant="bare">server/legion.db</Code> {T.descAfter}
        </>
      }
    >
      <Stack gap={8}>
        {err && <FormError>{err}</FormError>}
        <Text as="p" size="sm">
          {parts.length === 0 ? (
            T.empty
          ) : (
            <>
              {T.willDestroyBefore}
              <b>{project.name}</b>
              {T.willDestroyAfter(parts.join(", "))}
            </>
          )}
        </Text>
        {live.length > 0 ? (
          <Text as="p" size="sm" tone="wait">
            {T.live(live.length, live.map((s) => T.liveEntry(s.taskName, s.status)).join(" · "))}
          </Text>
        ) : (
          <Row>
            <ConfirmAction
              leading={<Trash2 size={13} />}
              label={T.remove(project.name)}
              confirmLabel={T.removeConfirm}
              announce={T.announce(project.name, parts.join(", ") || T.announceAlone)}
              onConfirm={remove}
            />
          </Row>
        )}
      </Stack>
    </Card>
  );
}
