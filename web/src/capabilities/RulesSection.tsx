// The project's rule registry: permanent instructions injected into the system prompt. A dropped
// .md file is a rule; memory suggestions wait for a decision.
import { useRef, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, Scale } from "lucide-react";
import { capabilitiesApi } from "../api/capabilities.js";
import { qk, rulesQuery } from "../queries.js";
import { formatBytes } from "../ui/bytes.js";
import { Banner } from "../ui/banner.js";
import { Card } from "../ui/card.js";
import { StatusChip } from "../ui/chip.js";
import { Divider } from "../ui/divider.js";
import { Dropzone, FileChip } from "../ui/dropzone.js";
import { Empty } from "../ui/empty.js";
import { Row, Stack } from "../ui/flex.js";
import { FormError, FormOk } from "../ui/form.js";
import { List } from "../ui/list.js";
import { baseName, readEntry, type DroppedFile } from "./drop.js";
import { bytesOf, toB64 } from "../api/base64.js";
import { ManualRuleForm } from "./ManualRuleForm.js";
import { RuleRow } from "./RuleRow.js";
import { SuggestedRule } from "./SuggestedRule.js";
import { RULE_BYTES_WARN, totalRuleBytes } from "./rule-weight.js";
import { RULES_TEXT } from "./text/rules.js";
import { RULE_STATUS } from "../api/agents.js";

// A dropped .md file is a rule. Optional frontmatter: `name:` (else the file name), `allAgents:
// true`, and since v41 `summary:` and `repos:`. Dropping the same name again updates the rule
// (server upsert).
//
// `description:` is accepted as a synonym of `summary:`, and not out of leniency: it is the key
// Claude Code rule and skill files already use. Dropping a whole `.claude/rules/` folder must work
// without rewriting it; otherwise thirty-four files arrive without a summary, so whole in the prompt.
function parseRuleMd(
  fileName: string,
  text: string,
): { name: string; content: string; allAgents?: boolean; summary?: string; repos?: string[] } {
  let name = fileName.replace(/\.mdc?$/i, "");
  let allAgents: boolean | undefined;
  let summary: string | undefined;
  let repos: string[] | undefined;
  let content = text;
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    content = text.slice(fm[0].length);
    const n = /^name:\s*(.+)$/m.exec(fm[1]!)?.[1]?.trim();
    if (n) name = n;
    const aa = /^allAgents:\s*(true|false)\s*$/m.exec(fm[1]!)?.[1];
    if (aa) allAgents = aa === "true";
    const sum = /^(?:summary|description):\s*(.+)$/m.exec(fm[1]!)?.[1]?.trim();
    if (sum) summary = sum.replace(/^["']|["']$/g, "");
    // `repos: [a, b]` or `repos: a, b`: both are written, neither is more correct.
    const rp = /^repos:\s*(.+)$/m.exec(fm[1]!)?.[1]?.trim();
    if (rp)
      repos = rp
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((x) => x.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
  }
  return { name, content: content.trim(), allAgents, summary, repos };
}

/** The weight of "all agents" rules, the only ones weighing on every session. `gate`, not `bad`,
 *  above the threshold: a heavy prompt is not a failure but something to look at, and red for what
 *  is not broken ends up ignored. */
function WeightChip({ bytes }: { bytes: number }) {
  if (bytes <= 0) return null;
  const heavy = bytes > RULE_BYTES_WARN;
  return (
    <Row gap={6} wrap>
      <StatusChip state={heavy ? "gate" : "idle"} dot={false} title={RULES_TEXT.weight.why}>
        <Scale size={11} />{" "}
        {heavy
          ? RULES_TEXT.weight.heavy(formatBytes(bytes))
          : RULES_TEXT.weight.label(formatBytes(bytes))}
      </StatusChip>
    </Row>
  );
}

export function RulesSection({ projectId }: { projectId: string }) {
  const { data: rules = [] } = useQuery(rulesQuery(projectId));
  const qc = useQueryClient();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<DroppedFile[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: qk.rules(projectId) });

  const uploadMd = async (dropped: DroppedFile[]) => {
    const mds = dropped.filter((f) => /\.mdc?$/i.test(f.path));
    if (mds.length === 0) {
      setMsg({ ok: false, text: RULES_TEXT.noMarkdown });
      return;
    }
    setBusy(true);
    setPending(mds);
    setMsg(null);
    try {
      let created = 0;
      for (const f of mds) {
        const fileName = baseName(f.path);
        const rule = parseRuleMd(
          fileName,
          new TextDecoder().decode(Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))),
        );
        if (!rule.content) continue;
        await capabilitiesApi.createRule({ projectId, ...rule });
        created++;
      }
      setMsg({ ok: true, text: RULES_TEXT.uploaded(created) });
      invalidate();
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message) });
    } finally {
      setBusy(false);
      setPending([]);
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const out: DroppedFile[] = [];
    for (const item of e.dataTransfer.items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) await readEntry(entry, "", out); // a .md file or a folder of .md files
    }
    await uploadMd(out);
  };

  const handlePick = async (list: FileList | null) => {
    if (!list) return;
    const out: DroppedFile[] = [];
    for (const f of list) out.push({ path: f.name, b64: toB64(await f.arrayBuffer()) });
    await uploadMd(out);
  };

  // Server cap (suggestRuleFromCorrection, capabilities.ts): 5 pending "suggested" per project,
  // deliberately unchanged; not exposed by the API, so duplicated here.
  const SUGGESTED_QUOTA = 5;
  const suggested = rules.filter((r) => r.status === RULE_STATUS.suggested);
  const active = rules.filter((r) => r.status === RULE_STATUS.active);
  // Only "all agents" rules weigh on every session; the others only cost the agents carrying them,
  // and a total adding them would announce a figure nobody ever pays.
  const injected = totalRuleBytes(active.filter((r) => r.allAgents));

  return (
    <Card
      icon={<BookMarked size={16} />}
      title={RULES_TEXT.title}
      desc={
        <>
          {RULES_TEXT.descBeforeKeys} <code>name:</code>
          {RULES_TEXT.descBetweenKeys} <code>allAgents: true</code>
          {RULES_TEXT.descBetweenKeys} <code>summary:</code>
          {RULES_TEXT.descBetweenKeys} <code>repos:</code>
          {RULES_TEXT.descAfterKeys} {RULES_TEXT.descRepoRules}
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
          label={msg?.ok === false ? msg.text : RULES_TEXT.dropLabel}
          hint={RULES_TEXT.dropHint}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".md,.mdc"
          multiple
          hidden
          onChange={(e) => void handlePick(e.target.files)}
        />
        {pending.length > 0 && (
          <Row gap={6} wrap>
            {pending.map((f) => (
              <FileChip key={f.path} name={baseName(f.path)} bytes={bytesOf(f.b64)} />
            ))}
          </Row>
        )}
        {msg && (msg.ok ? <FormOk>{msg.text}</FormOk> : <FormError>{msg.text}</FormError>)}

        <WeightChip bytes={injected} />

        {suggested.length > 0 && (
          <>
            <Divider
              label={RULES_TEXT.suggestions(suggested.length)}
              labelCase="sentence"
              space="sm"
            />
            {suggested.length >= SUGGESTED_QUOTA && (
              <Banner tone="wait" title={RULES_TEXT.quotaReached} />
            )}
            <Stack gap={8}>
              {suggested.map((r) => (
                <SuggestedRule
                  key={r.id}
                  rule={r}
                  onChange={invalidate}
                  onError={(text) => setMsg({ ok: false, text })}
                />
              ))}
            </Stack>
          </>
        )}

        <ManualRuleForm projectId={projectId} onAdded={invalidate} />

        {active.length === 0 ? (
          <Empty
            variant="inline"
            title={suggested.length > 0 ? RULES_TEXT.emptyActiveTitle : RULES_TEXT.emptyTitle}
          >
            {suggested.length > 0 ? RULES_TEXT.emptyActiveBody : RULES_TEXT.emptyBody}
          </Empty>
        ) : (
          <List label={RULES_TEXT.listLabel}>
            {active.map((r) => (
              <RuleRow
                key={r.id}
                rule={r}
                onChange={invalidate}
                onError={(text) => setMsg({ ok: false, text })}
              />
            ))}
          </List>
        )}
      </Stack>
    </Card>
  );
}
