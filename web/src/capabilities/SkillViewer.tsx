// Reading a skill inside the app (24/08). A dropped skill used to be a name and two lines of
// description: no way to check what you grant an agent without digging on disk. Renders its
// SKILL.md (the entry point the model reads first) and an inventory of the other files, so the
// real weight shows without serving them all.
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { capabilitiesApi } from "../api/capabilities.js";
import { Chip } from "../ui/chip.js";
import { Row, Stack } from "../ui/flex.js";
import { FormError } from "../ui/form.js";
import { Markdownish } from "../ui/markdownish.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Caption } from "../ui/text.js";
import { SKILLS_TEXT } from "./text/skills.js";

export function SkillViewer({ name }: { name: string }) {
  const q = useQuery({
    queryKey: ["skill", name],
    queryFn: () => capabilitiesApi.skill(name),
    staleTime: 60_000,
  });

  if (q.isLoading) return <Caption>{SKILLS_TEXT.viewer.loading}</Caption>;
  if (q.isError) return <FormError>{String((q.error as Error).message)}</FormError>;
  const skill = q.data;
  if (!skill) return null;
  const others = skill.files.filter((f) => f.path !== "SKILL.md");

  return (
    <Stack gap={8}>
      {skill.content ? (
        // A skill can be long: bound its height rather than push the rest of the page off screen
        // (same choice as the inbox evidence excerpt).
        <ScrollArea size="md" label={SKILLS_TEXT.viewer.label(name)}>
          <Markdownish text={skill.content} />
        </ScrollArea>
      ) : (
        <Caption>{SKILLS_TEXT.viewer.noEntryPoint}</Caption>
      )}
      {skill.truncated && <Caption>{SKILLS_TEXT.viewer.truncated}</Caption>}
      {others.length > 0 && (
        <Stack gap={4}>
          <Row gap={6}>
            <FileText size={12} aria-hidden="true" />
            <Caption>{SKILLS_TEXT.viewer.others(others.length)}</Caption>
          </Row>
          <Row gap={6} wrap>
            {others.slice(0, 12).map((f) => (
              <Chip key={f.path} size="sm">
                {f.path} · {SKILLS_TEXT.viewer.size(f.bytes)}
              </Chip>
            ))}
            {others.length > 12 && <Caption>{SKILLS_TEXT.viewer.more(others.length - 12)}</Caption>}
          </Row>
        </Stack>
      )}
    </Stack>
  );
}
