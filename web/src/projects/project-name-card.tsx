// The project name, and what becomes of its id.
//
// Two fields for one thing, and the card must make that readable: you type a name, and the id below
// is computed, never typed. It follows the name when it can (a new project, or one with an explicit
// output folder) and stays when it cannot, because it is the folder where produced artifacts live.
//
// The screen announces the verdict before saving and recalls it after. Before, because finding out
// an id did not follow by rereading an export URL is a bad way to learn it; after, because the
// server sees the disk and the screen does not.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Tag as TagIcon } from "lucide-react";
import { projectsApi, type Project } from "../api/projects.js";
import { qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Tag } from "../ui/chip.js";
import { Code } from "../ui/code.js";
import { Row, Stack } from "../ui/flex.js";
import { Field, FormError } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Caption } from "../ui/text.js";
import { slugOf } from "./slug.js";
import { PROJECT_NAME_TEXT as T } from "./text/project-name.js";

/** The server's verdict, which saw the disk: the id followed the name, or it stayed and we say why.
 *  Nothing until something is saved. */
function SlugVerdict({
  done,
}: {
  done: { slug: string; moved: boolean; reason: string | null } | null;
}) {
  if (!done) return null;
  if (done.moved) return <Caption>{T.moved(done.slug)}</Caption>;
  return done.reason ? <Caption>{T.frozen(done.reason)}</Caption> : null;
}

export function ProjectNameCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ slug: string; moved: boolean; reason: string | null } | null>(
    null,
  );

  const value = draft ?? project.name;
  const wanted = slugOf(value);
  const dirty = value.trim() !== project.name && value.trim().length > 0;
  const willChange = dirty && wanted !== project.slug && wanted.length > 0;

  const save = () =>
    projectsApi
      .patchProject(project.id, { name: value.trim() })
      .then((r) => {
        setErr("");
        setDraft(null);
        setDone({
          slug: r.slug ?? project.slug,
          moved: r.slugMoved === true,
          reason: r.slugReason ?? null,
        });
        void qc.invalidateQueries({ queryKey: qk.bootstrap });
      })
      .catch((e: Error) => setErr(e.message));

  return (
    <Card
      icon={<TagIcon size={16} />}
      title={T.title}
      desc={T.why}
      actions={
        <Button
          variant="primary"
          disabled={!dirty}
          leading={done ? <Check size={12} /> : undefined}
          onClick={save}
        >
          {done ? T.saved : T.save}
        </Button>
      }
    >
      <Stack gap={10}>
        {err && <FormError>{err}</FormError>}
        <Field label={T.nameLabel}>
          <Input
            value={value}
            onChange={(e) => {
              setDraft(e.target.value);
              setDone(null);
            }}
          />
        </Field>

        <Row gap={8} wrap>
          <Caption>{T.slugLabel}</Caption>
          <Tag title={T.slugWhy}>
            <Code variant="bare">{project.slug}</Code>
          </Tag>
          {/* The arrow only appears when the name would produce another id: otherwise it would
              suggest a change that will not happen. */}
          {willChange && <Caption>{T.arrow}</Caption>}
          {willChange && (
            <Tag title={T.candidateWhy}>
              <Code variant="bare">{wanted}</Code>
            </Tag>
          )}
        </Row>

        {willChange && <Caption>{T.maybe}</Caption>}

        <SlugVerdict done={done} />
      </Stack>
    </Card>
  );
}
