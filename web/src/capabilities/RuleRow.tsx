// An active registry rule: its title, its weight in the prompt, its scope, and its collapsible body.
//
// The row answers "what goes into every session". Title and the "all agents" box did not: a 27 KB
// rule and a 300-byte one looked identical. So the weight is shown, measured on the text actually
// injected, not the body length, which differs since a rule can have a summary.
import { useState } from "react";
import {
  BookMarked,
  ChevronDown,
  ChevronRight,
  FileCode,
  FolderGit2,
  Lock,
  LockOpen,
  Trash2,
} from "lucide-react";
import { capabilitiesApi, type Rule } from "../api/capabilities.js";
import { IconBtn } from "../ui/button.js";
import { formatBytes } from "../ui/bytes.js";
import { Tag } from "../ui/chip.js";
import { Checkbox } from "../ui/choice.js";
import { Row } from "../ui/flex.js";
import { ListItem } from "../ui/list.js";
import { Markdownish } from "../ui/markdownish.js";
import { hasBody, ruleBytes, rulePaths, ruleRepos } from "./rule-weight.js";
import { RULES_TEXT } from "./text/rules.js";

export function RuleRow({
  rule,
  onChange,
  onError,
}: {
  rule: Rule;
  onChange: () => void;
  /** A refusal (400/409) must be readable: without it the box reverted to server state on refetch
   *  without a word (toast audit 24/08; same contract as InstalledChainRow). */
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const repos = ruleRepos(rule);
  const globs = rulePaths(rule);
  const bytes = ruleBytes(rule);
  return (
    <ListItem
      leading={<BookMarked size={15} />}
      title={rule.name}
      meta={
        <Row gap={8} wrap>
          <Checkbox
            checked={rule.allAgents}
            onChange={(v) =>
              void capabilitiesApi
                .patchRule(rule.id, { allAgents: v })
                .then(onChange)
                .catch((e: Error) => onError(e.message))
            }
          >
            {RULES_TEXT.row.allAgents}
          </Checkbox>
          {/* Per-repository scope is only worth showing when it restricts: "everywhere" is the
              default, and a chip repeating it on every row teaches nothing. */}
          {repos.map((r) => (
            <Tag key={r} title={RULES_TEXT.row.scopeWhy}>
              <FolderGit2 size={11} /> {r}
            </Tag>
          ))}
          {rule.locked && (
            <Tag title={RULES_TEXT.row.lockedWhy}>
              <Lock size={11} /> {RULES_TEXT.row.locked}
            </Tag>
          )}
          {/* Same display rule as per-repository scope: only what restricts is shown. "any time"
              is the default. */}
          {globs.length > 0 && (
            <Tag title={RULES_TEXT.row.pathsWhy(globs)}>
              <FileCode size={11} /> {RULES_TEXT.row.paths(globs.length)}
            </Tag>
          )}
          {/* Three possible weights, one per rule fate (see `rule-weight.ts`). A scoped rule's is
              the most surprising (a few dozen bytes for a 2 KB rule), so it most needs to say why. */}
          <Tag
            title={
              globs.length > 0
                ? RULES_TEXT.row.scopedWhy
                : hasBody(rule)
                  ? RULES_TEXT.row.summaryWhy
                  : RULES_TEXT.row.wholeWhy
            }
          >
            {globs.length > 0
              ? RULES_TEXT.row.scopedWeight(formatBytes(bytes))
              : hasBody(rule)
                ? RULES_TEXT.row.summaryWeight(formatBytes(bytes))
                : formatBytes(bytes)}
          </Tag>
        </Row>
      }
      actions={
        <>
          {/* The lock is an action, not one box among others. It does not decide who receives the
            rule (that is "project default") but what a repository file can do to it. Two
            questions, two gestures. */}
          <IconBtn
            title={rule.locked ? RULES_TEXT.row.unlock : RULES_TEXT.row.lock}
            onClick={() =>
              capabilitiesApi
                .patchRule(rule.id, { locked: !rule.locked })
                .then(onChange)
                .catch((e: Error) => onError(e.message))
            }
          >
            {rule.locked ? <Lock size={13} /> : <LockOpen size={13} />}
          </IconBtn>
          <IconBtn
            title={open ? RULES_TEXT.row.collapse : RULES_TEXT.row.expand}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </IconBtn>
          <IconBtn
            title={RULES_TEXT.row.delete}
            danger
            onClick={() =>
              capabilitiesApi
                .deleteRule(rule.id)
                .then(onChange)
                .catch((e: Error) => onError(e.message))
            }
          >
            <Trash2 size={13} />
          </IconBtn>
        </>
      }
    >
      {/* Markdownish, not <p>s split on double newlines (24/08): a rule is markdown, and imported
          OBEY rules have headings and lists that read as raw asterisks and hashes. Same rendering
          as an agent's report. */}
      {open && <Markdownish text={rule.content} />}
    </ListItem>
  );
}
