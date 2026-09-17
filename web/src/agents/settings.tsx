// An agent's engine settings: which model, with what effort and thinking, and how far it sees
// repos. Job description layout (23/08): this card lives in the margin (~300px), so in a column,
// and only model and repo access stay visible; effort and thinking are rare exceptions, folded under
// a `Disclosure`.
import { type Agent } from "../api/agents.js";
import { type Environment } from "../api/environments.js";
import { type RunnerSummary } from "../api/infra.js";
import { type ModelChoice } from "../api/models.js";
import { Checkbox } from "../ui/choice.js";
import { Disclosure } from "../ui/disclosure.js";
import { Stack } from "../ui/flex.js";
import { Field } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { ModelPicker } from "../models/model-picker.js";
import type { AgentDraft } from "./draft.js";
import { NETWORKING } from "../api/environments.js";
import { AGENT_THINKING } from "../api/agents.js";
import { AGENT_TEXT } from "./text.js";

const T = AGENT_TEXT.settings;

/** The "no preference" option value, same convention as `RunnerChoice` (tasks/runner-choice.tsx):
 *  an empty string, because no runner name is empty. */
const ANY_RUNNER = "";

export function AgentSettings({
  agent,
  models,
  environments,
  runners,
  defaultModel,
  draft,
  set,
}: {
  agent: Agent;
  models: ModelChoice[];
  /** The environments of the agent's project: the network allowlist applied to its sessions. */
  environments: Environment[];
  /** The fleet, for the runner preference. Soft, unlike a task's chosen machine: a name that no
   *  longer answers falls back to the least loaded one (chosen-runner.ts). */
  runners: RunnerSummary[];
  defaultModel: string;
  draft: AgentDraft;
  set: (patch: Partial<AgentDraft>) => void;
}) {
  // The effective model decides which settings are offered: an agent without its own model runs on
  // the project's, and its capabilities are the ones that count.
  const chosen = models.find((m) => m.id === (draft.model || defaultModel));
  return (
    <Stack gap={10}>
      {/* The list comes from the SDK (`/api/models`), no longer three hand-written <option>s that
          offered `claude-opus-4-5` and `claude-sonnet-4-5`, two ids that no longer existed. A model
          missing from the list (pinned by hand, or retired since caching) stays shown: the current
          setting does not vanish under the operator's eyes. */}
      <Field label={T.model}>
        <ModelPicker
          value={draft.model}
          models={models}
          projectId={agent.projectId}
          ariaLabel={T.modelLabel(agent.name)}
          emptyLabel={T.modelEmpty(defaultModel)}
          onChange={(id) => set({ model: id })}
        />
      </Field>
      <Field label={T.repoAccess}>
        <Select
          value={draft.repoAccess}
          aria-label={T.repoAccessLabel(agent.name)}
          onChange={(e) => set({ repoAccess: e.target.value as Agent["repoAccess"] })}
        >
          <option value="none">{T.repoNone}</option>
          <option value="read">{T.repoRead}</option>
          <option value="write">{T.repoWrite}</option>
        </Select>
      </Field>
      {/* The preferred machine (v2c, nav): a column since the start (`runner_preference`), with no
          screen until then. Soft: it sorts first in the fleet and falls back to the least loaded
          one if it does not answer, unlike a task's chosen machine (`RunnerChoice`,
          tasks/runner-choice.tsx), which refuses instead. A runner missing from the fleet stays
          selectable: hiding it would conceal an existing setting rather than let the operator fix it. */}
      <Field label={T.machine} hint={T.machineHint}>
        <Select
          value={draft.runnerPreference ?? ANY_RUNNER}
          aria-label={T.machineLabel(agent.name)}
          onChange={(e) => set({ runnerPreference: e.target.value || null })}
        >
          <option value={ANY_RUNNER}>{T.machineAny}</option>
          {runners.map((r) => (
            <option key={r.id} value={r.name}>
              {r.name}
              {!r.enabled ? T.machineDisabled : !r.reachable ? T.machineAsleep : ""}
            </option>
          ))}
        </Select>
      </Field>
      {/* Inbox access (v2c, nav): only a pill showed it until then, with no setting. Removing access
          while `allowedTools` keeps both inbox tools is accepted; removing those too lifts the
          requirement (tool-grants.ts). */}
      <Field label={T.inbox} hint={T.inboxHint}>
        <Checkbox checked={draft.inboxAccess} onChange={(next) => set({ inboxAccess: next })}>
          {T.inboxCheckbox}
        </Checkbox>
      </Field>
      {/* The environment: the network wall of its sessions (egress proxy with allowlist). The table
          existed since schema v2, but only seed scripts wrote it, so the Environments screen could
          be attached to no agent. */}
      <Field label={T.network} hint={T.networkHint}>
        <Select
          value={draft.environmentId ?? ""}
          aria-label={T.networkLabel(agent.name)}
          onChange={(e) => set({ environmentId: e.target.value || null })}
        >
          {/* The label says what "none" does. It changed twice on 25/08, in both directions,
              which proves it has to be written here: an empty option hiding its effect leaves the
              operator guessing, badly. */}
          <option value="">{T.networkNone}</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
              {env.networking === NETWORKING.open
                ? T.networkOpen
                : T.networkHosts(env.allowedHosts.length)}
            </option>
          ))}
        </Select>
      </Field>
      {/* Shared browser (v30): a grant, so unchecked by default. The agent checking UI ticks it; the
          others do not even have the endpoint in their session. */}
      <Field label={T.browser} hint={T.browserHint}>
        <Checkbox checked={draft.browserAccess} onChange={(next) => set({ browserAccess: next })}>
          {T.browserCheckbox}
        </Checkbox>
      </Field>

      {/* Effort and thinking: two axes of the same model, set once then forgotten, so folded.
          Hidden when the chosen model does not support them: offering a setting the API ignores
          pretends you are steering. `flush`: in the 280px margin, the fold's indentation misaligned
          them with the Model/Access fields above. */}
      <Disclosure summary={T.reasoning} flush>
        <Stack gap={10}>
          {chosen?.supportsEffort && (
            <Field label={T.effort}>
              <Select
                value={draft.effort ?? ""}
                aria-label={T.effortLabel(agent.name)}
                onChange={(e) => set({ effort: (e.target.value || null) as Agent["effort"] })}
              >
                <option value="">{T.modelDefault}</option>
                {chosen.effortLevels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={T.thinking}>
            <Select
              value={draft.thinking ?? ""}
              aria-label={T.thinkingLabel(agent.name)}
              onChange={(e) => set({ thinking: (e.target.value || null) as Agent["thinking"] })}
            >
              <option value="">{T.modelDefault}</option>
              {chosen?.supportsAdaptiveThinking !== false && (
                <option value="adaptive">{T.thinkingAdaptive}</option>
              )}
              <option value="enabled">{T.thinkingFixed}</option>
              <option value="disabled">{T.thinkingOff}</option>
            </Select>
          </Field>
          {/* The budget only exists with "fixed budget": elsewhere it is a dead field. */}
          {draft.thinking === AGENT_THINKING.enabled && (
            <Field label={T.budget} hint={T.budgetHint}>
              <Input
                type="number"
                min={1024}
                step={1024}
                value={draft.thinkingBudget ?? ""}
                aria-label={T.budgetLabel(agent.name)}
                onChange={(e) =>
                  set({ thinkingBudget: e.target.value ? Number(e.target.value) : null })
                }
              />
            </Field>
          )}
        </Stack>
      </Disclosure>
    </Stack>
  );
}
