// Chain registry, two blocks: chains installed on this project (copied into `task_templates`, run
// from the task composer), with the agent holding each role under each chain; and the
// cross-project library (built-in catalogue plus operator-promoted chains), in its own file like
// the agent library.
//
// The role → agent mapping merged in here on 12/09: it lived apart in "Settings › Chains"
// (`ChainBindingsCard`), which sent you here to install a chain while this page sent you there for
// the mapping. The old address redirects here; storage is unchanged (`project.chainBindings`, one
// role → agent object shared by all the project's chains), only its rendering is per chain.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Workflow } from "lucide-react";
import { type Template } from "../api/chains.js";
import { projectsApi } from "../api/projects.js";
import { useProject } from "../projects/project.js";
import { bootstrapQuery, qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Empty } from "../ui/empty.js";
import { Field, FormError, FormRow } from "../ui/form.js";
import { Stack } from "../ui/flex.js";
import { List } from "../ui/list.js";
import { Select } from "../ui/select.js";
import { ChainLibrary } from "./ChainLibrary.js";
import { ChainStepsModal } from "./ChainStepsModal.js";
import { InstalledChainRow } from "./InstalledChainRow.js";
import { CHAIN_TEXT } from "./text.js";

const SAVED_MS = 1500;

/** One role per step found in the installed chains: the catalogue fallback each row reads,
 *  computed once for all the project's chains. */
function catalogDefaultsOf(chains: Template[]): Map<string, string> {
  const defaults = new Map<string, string>();
  for (const t of chains)
    for (const s of t.steps) {
      const role = s.role ?? s.agentName;
      if (!defaults.has(role)) defaults.set(role, s.agentName);
    }
  return defaults;
}

/** Roles in the current mapping that no installed chain carries any more (chain uninstalled):
 *  nothing ties them to a row, so they are shown apart. */
function orphanRolesOf(current: Record<string, string>, catalogDefault: Map<string, string>) {
  return Object.keys(current)
    .filter((r) => !catalogDefault.has(r))
    .sort();
}

export function ChainsSection({ projectId }: { projectId: string }) {
  const { data: boot } = useQuery(bootstrapQuery);
  const { project } = useProject();
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<Template | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState(false);

  const chains = (boot?.templates ?? []).filter((t) => t.projectId === projectId);
  const agents = (boot?.agents ?? []).filter((a) => a.projectId === projectId);
  const current = JSON.parse(project?.chainBindings || "{}") as Record<string, string>;
  const value = draft ?? current;

  const catalogDefault = catalogDefaultsOf(chains);
  // A broken setting does not erase itself: orphan roles stay visible.
  const orphanRoles = orphanRolesOf(current, catalogDefault);
  const dirty = JSON.stringify(value) !== JSON.stringify(current);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.bootstrap });
    void qc.invalidateQueries({ queryKey: ["chain-templates"] });
  };

  const pick = (role: string, agentId: string) => {
    const next = { ...value };
    if (agentId) next[role] = agentId;
    else delete next[role];
    setDraft(next);
  };

  const save = () => {
    if (!project) return;
    const kept = Object.fromEntries(Object.entries(value).filter(([, id]) => id));
    projectsApi
      .patchProject(project.id, { chainBindings: kept })
      .then(() => {
        setSaved(true);
        setError("");
        setDraft(null);
        setTimeout(() => setSaved(false), SAVED_MS);
        void qc.invalidateQueries({ queryKey: qk.bootstrap });
      })
      .catch((e: Error) => setError(e.message));
  };

  return (
    <Stack gap={14}>
      <Card
        icon={<Workflow size={16} />}
        title={CHAIN_TEXT.installed.title}
        desc={CHAIN_TEXT.installed.desc}
        actions={
          <Button
            variant="primary"
            disabled={!dirty}
            leading={saved ? <Check size={12} /> : undefined}
            onClick={save}
          >
            {saved ? CHAIN_TEXT.roles.saved : CHAIN_TEXT.roles.save}
          </Button>
        }
      >
        <Stack gap={8}>
          {chains.length === 0 ? (
            <Empty variant="inline" title={CHAIN_TEXT.installed.emptyTitle}>
              {CHAIN_TEXT.installed.emptyWhy}
            </Empty>
          ) : (
            <List density="compact" label={CHAIN_TEXT.installed.listLabel}>
              {chains.map((t) => (
                <InstalledChainRow
                  key={t.id}
                  chain={t}
                  agents={agents}
                  value={value}
                  catalogDefault={catalogDefault}
                  onPick={pick}
                  onView={() => setViewing(t)}
                  onChanged={refresh}
                  onError={setError}
                />
              ))}
            </List>
          )}
          {orphanRoles.length > 0 && (
            <FormRow>
              {orphanRoles.map((role) => {
                const chosen = value[role] ?? "";
                return (
                  <Field key={role} label={role} hint={CHAIN_TEXT.roles.orphanRole}>
                    <Select
                      value={chosen}
                      aria-label={CHAIN_TEXT.roles.selectLabel(role)}
                      onChange={(e) => pick(role, e.target.value)}
                    >
                      <option value="">{CHAIN_TEXT.roles.removeMapping}</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                      {chosen && !agents.some((a) => a.id === chosen) && (
                        <option value={chosen}>{CHAIN_TEXT.roles.deletedAgent}</option>
                      )}
                    </Select>
                  </Field>
                );
              })}
            </FormRow>
          )}
          {error && <FormError>{error}</FormError>}
        </Stack>
      </Card>

      <ChainLibrary projectId={projectId} installedNames={chains.map((t) => t.name)} />

      {viewing && (
        <ChainStepsModal
          name={viewing.name}
          description={viewing.description}
          steps={viewing.steps}
          onClose={() => setViewing(null)}
        />
      )}
    </Stack>
  );
}
