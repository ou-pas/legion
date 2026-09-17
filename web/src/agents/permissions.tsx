// An agent's grants in detail: mounted folders, repos, MCP servers, skills, secrets, rules. Least
// privilege: everything unchecked by default, every grant explicit.
//
// Job description layout (23/08): this card lives in the margin (~300px), below actions and engine.
// Two families read differently: what you come to tick (repos, secrets, agent-specific rules, MCP
// and skills when there are some) stays visible as dense rows; what is read-only or empty (folders
// mounted by the server, rules applying to all agents, MCP/skills with an empty registry) collapses
// to a count behind a `Disclosure`, since the margin has no room to explain every empty state.
import { Folder, Puzzle, Server, Wrench } from "lucide-react";
import { type Agent } from "../api/agents.js";
import {
  type McpServer,
  type Rule,
  type SkillInfo,
  type ToolCatalog,
} from "../api/capabilities.js";
import { type Repo, type Secret, AUTH_SECRET_NAMES } from "../api/projects.js";
import { Badge } from "../ui/chip.js";
import { Checkbox } from "../ui/choice.js";
import { Disclosure } from "../ui/disclosure.js";
import {
  Permission,
  PermissionGroup,
  PermissionList,
  type PermissionLevel,
} from "../ui/permission-list.js";
import { Ellipsis } from "../ui/ellipsis.js";
import { SkeletonText } from "../ui/skeleton.js";
import { Text } from "../ui/text.js";
import { Tooltip } from "../ui/tooltip.js";
import { Button } from "../ui/button.js";
import { type AgentDraft, toggled } from "./draft.js";
import { CapabilitiesLink, ProjectLink } from "./links.js";
import { REPO_ACCESS } from "../api/agents.js";
import { AGENT_TEXT } from "./text.js";
import {
  catalogTools,
  effectiveTools,
  isKnownTool,
  pruneToolsForServers,
  toggleTool,
  toolLevel,
} from "./tool-grants.js";

/** Folder mounted in the container: deletion is a write right, not a fourth level. */
type FsGrant = { folderPath: string; canRead?: boolean; canWrite?: boolean; canDelete?: boolean };

const T = AGENT_TEXT.permissions;

export function AgentPermissions({
  agent,
  skills,
  mcpServers,
  rules,
  repos,
  secrets,
  toolCatalog,
  draft,
  set,
  defaultSkillNames,
}: {
  agent: Agent;
  skills: SkillInfo[];
  mcpServers: McpServer[];
  rules: Rule[];
  repos: Repo[];
  secrets: Secret[];
  /** The server tool catalogue (GET /api/tool-catalog). `undefined` = not loaded yet: the tools
   *  group waits, it does not guess a list. */
  toolCatalog: ToolCatalog | undefined;
  draft: AgentDraft;
  set: (patch: Partial<AgentDraft>) => void;
  defaultSkillNames?: string[];
}) {
  let grants: FsGrant[] = [];
  try {
    grants = JSON.parse(agent.fsGrants) as FsGrant[];
  } catch {
    grants = [];
  }
  // Two families: rules ticked per agent, and rules applying to all. The latter are not an
  // implementation detail: they are active grants and must be read.
  const agentRules = rules.filter((r) => r.status === "active" && !r.allAgents);
  const allAgentRules = rules.filter((r) => r.status === "active" && r.allAgents);
  // A ticked repo is only worth the agent's global access level.
  const repoLevel = (name: string): PermissionLevel =>
    draft.repoAccess === REPO_ACCESS.none || !draft.repoNames.includes(name)
      ? "none"
      : draft.repoAccess === REPO_ACCESS.write
        ? "rw"
        : "r";

  return (
    <PermissionList label={T.label(agent.name)}>
      <PermissionGroup scope="repos" density="compact">
        {repos.length === 0 ? (
          <Text as="li" size="sm" tone="muted">
            {T.noRepo}{" "}
            <ProjectLink projectId={agent.projectId} tab="repos">
              {T.projectLink}
            </ProjectLink>
            .
          </Text>
        ) : (
          <>
            {/* A disabled checkbox without explanation reads as a dead click. The reason is written
                  here in the open rather than in a `title` a disabled control never shows. */}
            {draft.repoAccess === REPO_ACCESS.none && (
              <Text as="li" size="sm" tone="muted">
                {T.repoAccessFirst}
              </Text>
            )}
            {repos.map((r) => (
              <Permission
                key={r.id}
                level={repoLevel(r.name)}
                name={
                  <Checkbox
                    checked={draft.repoNames.includes(r.name)}
                    disabled={draft.repoAccess === REPO_ACCESS.none}
                    onChange={() => set({ repoNames: toggled(draft.repoNames, r.name) })}
                  >
                    {r.name}
                  </Checkbox>
                }
              />
            ))}
          </>
        )}
      </PermissionGroup>

      {/* A secret only reaches a container if it is ticked here. */}
      <PermissionGroup scope="secrets" density="compact">
        {secrets.length === 0 ? (
          <Text as="li" size="sm" tone="muted">
            {T.noSecret}{" "}
            <ProjectLink projectId={agent.projectId} tab="secrets">
              {T.projectLink}
            </ProjectLink>
            .
          </Text>
        ) : (
          secrets.map((s) => (
            <Permission
              key={s.id}
              level={draft.envSecretNames.includes(s.name) ? "r" : "none"}
              detail={AUTH_SECRET_NAMES.includes(s.name) ? T.authSecret : undefined}
              name={
                <Checkbox
                  checked={draft.envSecretNames.includes(s.name)}
                  onChange={() => set({ envSecretNames: toggled(draft.envSecretNames, s.name) })}
                >
                  {s.name}
                </Checkbox>
              }
            />
          ))
        )}
      </PermissionGroup>

      {/* Rules specific to this agent, checkable. Those applying to all are further down, read-only. */}
      {agentRules.length > 0 && (
        <PermissionGroup scope="rules" density="compact">
          {agentRules.map((r) => (
            <Permission
              key={r.id}
              level={draft.ruleIds.includes(r.id) ? "r" : "none"}
              name={
                <Checkbox
                  checked={draft.ruleIds.includes(r.id)}
                  onChange={() => set({ ruleIds: toggled(draft.ruleIds, r.id) })}
                >
                  {/* A rule has no description: the tooltip only makes sense if the name is really
                      truncated. `Ellipsis` measures it instead of assuming. */}
                  <Ellipsis>{r.name}</Ellipsis>
                </Checkbox>
              }
            />
          ))}
        </PermissionGroup>
      )}

      {/* MCP and skills: checkable and dense while there is a registry to tick. Empty, the prompt
          message (two full-card lines) has no room in 300px and folds behind its count. */}
      {mcpServers.length > 0 ? (
        <PermissionGroup scope="mcp" density="compact">
          {mcpServers.map((s) => (
            <Permission
              key={s.id}
              level={draft.mcpIds.includes(s.id) ? "rw" : "none"}
              detail={s.type}
              name={
                <Checkbox
                  checked={draft.mcpIds.includes(s.id)}
                  onChange={() => {
                    // Unticking a server removes its tools from the draft in the same `set`,
                    // otherwise the next save answers 400 for an orphaned `allowedTools` array,
                    // over a gesture made elsewhere in the card (R2).
                    const nextIds = toggled(draft.mcpIds, s.id);
                    const names = mcpServers
                      .filter((m) => nextIds.includes(m.id))
                      .map((m) => m.name);
                    // Without a loaded catalogue, no normalisation: removing orphan tools stays
                    // right, but "is this array the default set?" cannot be answered without
                    // knowing that default.
                    set({
                      mcpIds: nextIds,
                      allowedTools: toolCatalog
                        ? pruneToolsForServers(draft.allowedTools, names, toolCatalog)
                        : draft.allowedTools,
                    });
                  }}
                >
                  {s.name}
                </Checkbox>
              }
            />
          ))}
        </PermissionGroup>
      ) : (
        <Disclosure
          summary={
            <>
              <Server size={13} aria-hidden="true" />
              {T.mcpTitle}
              <Badge count={0} label={T.mcpEmptyBadge} />
            </>
          }
        >
          <Text as="p" size="sm" tone="muted">
            {T.noMcp}{" "}
            <CapabilitiesLink projectId={agent.projectId} tab="mcp">
              {T.libraryLink}
            </CapabilitiesLink>
            .
          </Text>
        </Disclosure>
      )}

      {/* Tools follow from the granted MCP server: this group reads after "MCP servers", before
          "Skills". Rare (unlike repos and secrets, daily gestures): collapsed while the agent stays
          on the default set, expanded once an own list exists to review. */}
      {toolCatalog === undefined ? (
        /* The catalogue comes from the server: until it is there, the list is not guessed. A
             guessed list is exactly the defect that was just removed. */
        <Disclosure
          flush
          summary={
            <>
              <Wrench size={13} aria-hidden="true" />
              {T.toolsTitle}
            </>
          }
        >
          <SkeletonText lines={3} />
        </Disclosure>
      ) : (
        (() => {
          const grantedServerNames = mcpServers
            .filter((s) => draft.mcpIds.includes(s.id))
            .map((s) => s.name);
          const effective = effectiveTools(draft.allowedTools, toolCatalog);
          const catalogSize = catalogTools(toolCatalog).length + grantedServerNames.length;
          const unknown =
            draft.allowedTools === null
              ? []
              : draft.allowedTools.filter((t) => !isKnownTool(t, grantedServerNames, toolCatalog));
          const toggle = (t: string) =>
            set({
              allowedTools: toggleTool(draft.allowedTools, t, {
                inboxAccess: agent.inboxAccess,
                catalog: toolCatalog,
              }),
            });
          return (
            <Disclosure
              flush
              defaultOpen={draft.allowedTools !== null}
              summary={
                <>
                  <Wrench size={13} aria-hidden="true" />
                  {T.toolsTitle}
                  <Badge
                    count={draft.allowedTools === null ? catalogSize : effective.length}
                    label={
                      draft.allowedTools === null
                        ? T.toolsDefaultBadge(catalogSize)
                        : T.toolsCountBadge(effective.length, catalogSize)
                    }
                  />
                </>
              }
            >
              <PermissionGroup scope="tools" density="compact" hideHeading>
                {/* A disabled checkbox without explanation reads as a dead click (same rule as for
                  repos above): the reason is written in the open, never in a `title`. */}
                {agent.inboxAccess && (
                  <>
                    <Text as="li" size="sm" tone="muted">
                      {T.inboxToolsLocked}
                    </Text>
                    {toolCatalog.requiredInboxTools.map((t) => (
                      <Permission
                        key={t}
                        level={toolLevel(t)}
                        name={
                          <Checkbox checked disabled onChange={() => toggle(t)}>
                            {t}
                          </Checkbox>
                        }
                      />
                    ))}
                  </>
                )}
                {catalogTools(toolCatalog)
                  .filter((t) => !(agent.inboxAccess && toolCatalog.requiredInboxTools.includes(t)))
                  .map((t) => {
                    const checked = effective.includes(t);
                    return (
                      <Permission
                        key={t}
                        level={checked ? toolLevel(t) : "none"}
                        name={
                          <Checkbox checked={checked} onChange={() => toggle(t)}>
                            {t}
                          </Checkbox>
                        }
                      />
                    );
                  })}
                {grantedServerNames.map((name) => {
                  const tool = `mcp__${name}`;
                  const checked = effective.includes(tool);
                  return (
                    <Permission
                      key={tool}
                      level={checked ? toolLevel(tool) : "none"}
                      detail={T.wholeServer}
                      name={
                        <Checkbox checked={checked} onChange={() => toggle(tool)}>
                          {tool}
                        </Checkbox>
                      }
                    />
                  );
                })}
                {/* Outside the catalogue: inherited, server deleted, or server catalogue moved.
                  Checked and uncheckable: hiding it would make invisible an entry that fails every
                  save, even on an unrelated gesture (R1). */}
                {unknown.map((t) => (
                  <Permission
                    key={t}
                    level={toolLevel(t)}
                    detail={T.unknownTool}
                    name={
                      <Checkbox checked onChange={() => toggle(t)}>
                        {t}
                      </Checkbox>
                    }
                  />
                ))}
              </PermissionGroup>
              {draft.allowedTools === null ? (
                <Text as="p" size="sm" tone="muted">
                  {T.defaultSet}
                </Text>
              ) : (
                <Button size="sm" onClick={() => set({ allowedTools: null })}>
                  {T.backToDefaultSet}
                </Button>
              )}
            </Disclosure>
          );
        })()
      )}

      {(() => {
        const inheritedSkillNames = new Set(defaultSkillNames ?? []);
        const inheritedOnly = Array.from(inheritedSkillNames).filter((name) =>
          skills.some((s) => s.name === name),
        );
        const agentEditableOnly = skills.filter((s) => !inheritedSkillNames.has(s.name));

        if (skills.length === 0) {
          return (
            <Disclosure
              summary={
                <>
                  <Puzzle size={13} aria-hidden="true" />
                  {T.skillsTitle}
                  <Badge count={0} label={T.skillsEmptyBadge} />
                </>
              }
            >
              <Text as="p" size="sm" tone="muted">
                {T.noSkill}{" "}
                <CapabilitiesLink projectId={agent.projectId} tab="skills">
                  {T.libraryLink}
                </CapabilitiesLink>
                .
              </Text>
            </Disclosure>
          );
        }

        return (
          <>
            {agentEditableOnly.length > 0 && (
              <PermissionGroup scope="skills" density="compact">
                {agentEditableOnly.map((s) => (
                  <Permission
                    key={s.name}
                    level={draft.skillNames.includes(s.name) ? "r" : "none"}
                    name={
                      <Tooltip label={s.description ? `${s.name} — ${s.description}` : s.name}>
                        <Checkbox
                          checked={draft.skillNames.includes(s.name)}
                          onChange={() => set({ skillNames: toggled(draft.skillNames, s.name) })}
                        >
                          <span className="ui-perm-clip">{s.name}</span>
                        </Checkbox>
                      </Tooltip>
                    }
                  />
                ))}
              </PermissionGroup>
            )}

            {inheritedOnly.length > 0 && (
              <Disclosure
                summary={
                  <>
                    {T.inheritedSkills}
                    <Badge
                      count={inheritedOnly.length}
                      label={T.inheritedSkillsBadge(inheritedOnly.length)}
                    />
                  </>
                }
              >
                <PermissionGroup scope="skills" density="compact" hideHeading>
                  {inheritedOnly.map((name) => {
                    const skill = skills.find((s) => s.name === name);
                    return (
                      <Permission
                        key={name}
                        level="r"
                        name={skill?.name || name}
                        detail={T.projectDefault}
                      />
                    );
                  })}
                </PermissionGroup>
              </Disclosure>
            )}
          </>
        );
      })()}

      {/* Read-only: what the server mounted, never what is ticked here. */}
      <Disclosure
        summary={
          <>
            <Folder size={13} aria-hidden="true" />
            {T.folders}
            <Badge count={grants.length} label={T.foldersBadge(grants.length)} />
          </>
        }
      >
        {grants.length === 0 ? (
          <Text as="p" size="sm" tone="muted">
            {T.noFolder}
          </Text>
        ) : (
          <PermissionGroup scope="folders" density="compact" hideHeading>
            {grants.map((g) => (
              <Permission
                key={g.folderPath}
                name={g.folderPath}
                level={g.canWrite ? "rw" : g.canRead === false ? "none" : "r"}
                detail={g.canDelete ? T.canDelete : undefined}
              />
            ))}
          </PermissionGroup>
        )}
      </Disclosure>

      {/* The project's default rules apply without being ticked: hiding them made the card read
          "this agent has one rule, switched off" when it had four. They are not unticked here (that
          happens in Library), just a count, expandable. */}
      {allAgentRules.length > 0 && (
        <Disclosure
          summary={
            <>
              {T.projectRules}
              <Badge
                count={allAgentRules.length}
                label={T.projectRulesBadge(allAgentRules.length)}
              />
            </>
          }
        >
          <PermissionGroup scope="rules" density="compact" hideHeading>
            {allAgentRules.map((r) => (
              <Permission key={r.id} level="r" name={r.name} detail={T.projectRuleDetail} />
            ))}
          </PermissionGroup>
        </Disclosure>
      )}

      {rules.length === 0 && (
        <Text as="p" size="sm" tone="muted">
          {T.noRule}{" "}
          <CapabilitiesLink projectId={agent.projectId} tab="regles">
            {T.libraryLink}
          </CapabilitiesLink>
          .
        </Text>
      )}
    </PermissionList>
  );
}
