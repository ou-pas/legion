// A row of the agents registry. Pure presentation: it talks to neither server nor router; the
// caller wraps it in its <Link> to /agents/:agentId, like TaskCard. The registry is for scanning:
// no control on the row, every setting lives on the dedicated page.
import { Bot } from "lucide-react";
import { type Agent } from "../api/agents.js";
import { StatusChip, Tag } from "../ui/chip.js";
import { ListItem } from "../ui/list.js";
import { Caption } from "../ui/text.js";
import { ModelChip } from "../sessions/model-chip.js";
import "./agent-row.css";
import { REPO_ACCESS } from "../api/agents.js";
import { AGENT_TEXT } from "./text.js";

/** A counter that does not bring the page down. Grants arrive as JSON in a text column: a malformed
 *  row must cost a "0", not the whole screen. */
function count(json: string): number {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.length : 0;
  } catch {
    return 0;
  }
}

/** "1 repo (write) · 6 skills · 2 rules · 1 secret": an agent's grants in one sentence. Zeros are
 *  silent: a registry row listing five zeros is no longer scannable. */
export function agentCapabilities(agent: Agent): string {
  const t = AGENT_TEXT.capabilities;
  const repos = count(agent.repoNames);
  const parts = [
    agent.repoAccess === REPO_ACCESS.none
      ? t.noRepoAccess
      : repos === 0
        ? t.noRepoGranted
        : t.repos(repos, agent.repoAccess),
  ];
  const skills = count(agent.skillNames);
  if (skills > 0) parts.push(t.skills(skills));
  const rules = count(agent.ruleIds);
  if (rules > 0) parts.push(t.rules(rules));
  const mcp = count(agent.mcpServerIds);
  if (mcp > 0) parts.push(t.mcp(mcp));
  const secrets = count(agent.envSecretNames);
  if (secrets > 0) parts.push(t.secrets(secrets));
  return parts.join(" · ");
}

export function AgentRow({
  agent,
  live = false,
  className,
}: {
  agent: Agent;
  /** An agent session is alive (same ACTIVE_STATES as the server): its settings have already left,
   *  and the dedicated page will say so when editing. */
  live?: boolean;
  className?: string;
}) {
  return (
    <ListItem
      className={["dm-agent-row", className].filter(Boolean).join(" ")}
      interactive
      leading={<Bot />}
      title={agent.name}
      sub={agent.title}
      meta={
        <>
          <Caption className="dm-agent-caps">{agentCapabilities(agent)}</Caption>
          {agent.model ? (
            <ModelChip model={agent.model} />
          ) : (
            <Tag title={AGENT_TEXT.chip.projectModelWhy}>{AGENT_TEXT.chip.projectModel}</Tag>
          )}
          {!agent.inboxAccess && (
            <StatusChip state="wait" dot={false} size="sm">
              {AGENT_TEXT.chip.noInbox}
            </StatusChip>
          )}
          {live && (
            <StatusChip state="run" size="sm">
              {AGENT_TEXT.chip.inSession}
            </StatusChip>
          )}
        </>
      }
    />
  );
}
