// The project's skill registry: dropping a folder (or a lone SKILL.md), and the list. Per-agent
// assignment happens on the Agents page; here the library is managed.
import { useMemo, useRef, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Puzzle, Sparkles, Trash2 } from "lucide-react";
import { capabilitiesApi } from "../api/capabilities.js";
import { projectsApi, type Project } from "../api/projects.js";
import { SkillViewer } from "./SkillViewer.js";
import { qk, skillsQuery } from "../queries.js";
import { IconBtn } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Checkbox } from "../ui/choice.js";
import { Code } from "../ui/code.js";
import { Dropzone, FileChip } from "../ui/dropzone.js";
import { Empty } from "../ui/empty.js";
import { Row, Stack } from "../ui/flex.js";
import { FormError, FormOk } from "../ui/form.js";
import { List, ListRow } from "../ui/list.js";
import { Text } from "../ui/text.js";
import { baseName, readEntry, type DroppedFile } from "./drop.js";
import { bytesOf, toB64 } from "../api/base64.js";
import { SKILLS_TEXT } from "./text/skills.js";

export function SkillsSection({ project }: { project: Project | null }) {
  const { data: skills = [] } = useQuery(skillsQuery);
  const qc = useQueryClient();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<DroppedFile[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // One skill open at a time: reading is a verification gesture, not a dashboard.
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: qk.skills });

  // v35, the project default. The skill library is global (a folder on disk), but "on for all
  // agents" is not: it belongs to the project, like a rule's box. Without a project in the URL the
  // box has nowhere to be written, so it is hidden rather than shown dead.
  const defaults = useMemo(() => {
    try {
      return new Set(JSON.parse(project?.defaultSkillNames ?? "[]") as string[]);
    } catch {
      return new Set<string>();
    }
  }, [project?.defaultSkillNames]);

  const toggleDefault = (name: string, on: boolean) => {
    if (!project) return;
    const next = on ? [...defaults, name] : [...defaults].filter((n) => n !== name);
    projectsApi
      .patchProject(project.id, { defaultSkillNames: next })
      .then(() => void qc.invalidateQueries({ queryKey: qk.bootstrap }))
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  };

  const upload = async (name: string, files: DroppedFile[]) => {
    setBusy(true);
    setPending(files);
    setMsg(null);
    try {
      await capabilitiesApi.uploadSkill({ name, files });
      setMsg({ ok: true, text: SKILLS_TEXT.uploaded(name, files.length) });
      invalidate();
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message) });
    } finally {
      setBusy(false);
      setPending([]);
    }
  };

  // Dropped folder → name = folder name, paths relative to its root.
  // Lone SKILL.md → name = frontmatter `name:` (else an explicit refusal).
  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const items = [...e.dataTransfer.items];
    const dirs = items
      .map((i) => i.webkitGetAsEntry?.())
      .filter((x): x is FileSystemEntry => Boolean(x));
    if (dirs.length === 0) return;
    const root = dirs[0]!;
    if (root.isDirectory) {
      const out: DroppedFile[] = [];
      const reader = (root as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
          reader.readEntries(res, rej),
        );
        if (batch.length === 0) break;
        for (const child of batch) await readEntry(child, "", out);
      }
      await upload(root.name, out);
    } else if (root.name === "SKILL.md") {
      const out: DroppedFile[] = [];
      await readEntry(root, "", out);
      const text = atob(out[0]!.b64);
      const name = /^name:\s*([\w][\w.-]*)\s*$/m.exec(text)?.[1];
      if (!name) {
        setMsg({ ok: false, text: SKILLS_TEXT.noFrontmatterName });
        return;
      }
      await upload(name, out);
    } else {
      setMsg({ ok: false, text: SKILLS_TEXT.notASkill });
    }
  };

  const handlePick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    // webkitdirectory input: paths arrive as <folder>/<relative>
    const files: DroppedFile[] = [];
    let root = "";
    for (const f of list) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const [first, ...rest] = rel.split("/");
      root = first ?? "";
      if (rest.length === 0 || rest.some((p) => p.startsWith("."))) continue;
      const buf = await f.arrayBuffer();
      files.push({ path: rest.join("/"), b64: toB64(buf) });
    }
    if (root && files.length) await upload(root, files);
  };

  return (
    <Card
      icon={<Sparkles size={16} />}
      title={SKILLS_TEXT.title}
      desc={
        <>
          {SKILLS_TEXT.descBeforeFile} <code>SKILL.md</code> {SKILLS_TEXT.descAfterFile}
        </>
      }
    >
      <Stack gap={10}>
        <Dropzone
          over={over}
          busy={busy}
          rejected={msg?.ok === false}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInput.current?.click()}
          label={msg?.ok === false ? msg.text : SKILLS_TEXT.dropLabel}
          hint={
            <>
              {SKILLS_TEXT.dropHintBeforeFile} <Code variant="bare">SKILL.md</Code>{" "}
              {SKILLS_TEXT.dropHintBeforeKey} <Code variant="bare">name:</Code>
              {SKILLS_TEXT.dropHintEnd}
            </>
          }
        />
        <input
          ref={fileInput}
          type="file"
          hidden
          // @ts-expect-error webkitdirectory is non-standard but supported by modern browsers
          webkitdirectory=""
          onChange={(e) => void handlePick(e.target.files)}
        />
        {pending.length > 0 && (
          <Row gap={6} wrap>
            {pending.slice(0, 8).map((f) => (
              <FileChip key={f.path} name={baseName(f.path)} bytes={bytesOf(f.b64)} />
            ))}
            {pending.length > 8 && (
              <Text tone="muted" size="xs">
                {SKILLS_TEXT.morePending(pending.length - 8)}
              </Text>
            )}
          </Row>
        )}
        {msg && (msg.ok ? <FormOk>{msg.text}</FormOk> : <FormError>{msg.text}</FormError>)}
        {skills.length === 0 ? (
          <Empty variant="inline" title={SKILLS_TEXT.emptyTitle}>
            {SKILLS_TEXT.emptyBody}
          </Empty>
        ) : (
          <List density="compact" label={SKILLS_TEXT.listLabel}>
            {skills.map((s) => (
              <ListRow
                key={s.name}
                leading={<Puzzle size={14} />}
                meta={
                  project && (
                    <Checkbox
                      checked={defaults.has(s.name)}
                      onChange={(v) => toggleDefault(s.name, v)}
                    >
                      {SKILLS_TEXT.allAgents}
                    </Checkbox>
                  )
                }
                actions={
                  <>
                    {/* Read before granting: a skill is a folder of instructions entering an
                      agent's prompt, and judging it on two lines of description was signing blind
                      (24/08). */}
                    <IconBtn
                      title={openSkill === s.name ? SKILLS_TEXT.collapse : SKILLS_TEXT.read}
                      onClick={() => setOpenSkill(openSkill === s.name ? null : s.name)}
                    >
                      {openSkill === s.name ? (
                        <ChevronDown size={13} />
                      ) : (
                        <ChevronRight size={13} />
                      )}
                    </IconBtn>
                    <IconBtn
                      title={SKILLS_TEXT.delete}
                      danger
                      onClick={() =>
                        capabilitiesApi
                          .deleteSkill(s.name)
                          .then(() => {
                            invalidate();
                            void qc.invalidateQueries({ queryKey: qk.bootstrap });
                          })
                          .catch((e: Error) => setMsg({ ok: false, text: e.message }))
                      }
                    >
                      <Trash2 size={13} />
                    </IconBtn>
                  </>
                }
              >
                <Code variant="bare">{s.name}</Code>
                <Text tone="muted" size="sm">
                  {s.description}
                </Text>
                {openSkill === s.name && <SkillViewer name={s.name} />}
              </ListRow>
            ))}
          </List>
        )}
      </Stack>
    </Card>
  );
}
