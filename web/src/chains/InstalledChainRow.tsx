// A chain installed on this project: name, step count, its three gestures (view steps, promote to
// the library, remove from the project), and under the row the agent holding each role of this
// chain. Each call can refuse (409 named by the API: tasks in progress, name already in the
// library); the error goes up to the parent block, never lost in a swallowed promise.
import { useState } from "react";
import { Eye, Library, Trash2, Workflow } from "lucide-react";
import type { Agent } from "../api/agents.js";
import { chainsApi, type Template } from "../api/chains.js";
import { IconBtn } from "../ui/button.js";
import { Code } from "../ui/code.js";
import { Field, FormRow } from "../ui/form.js";
import { Tag } from "../ui/chip.js";
import { ListItem } from "../ui/list.js";
import { Select } from "../ui/select.js";
import { CHAIN_TEXT } from "./text.js";

export function InstalledChainRow({
  chain,
  agents,
  value,
  catalogDefault,
  onPick,
  onView,
  onChanged,
  onError,
}: {
  chain: Template;
  agents: Agent[];
  /** The current role → agent mapping, shared by all the project's chains: two chains declaring
   *  the same role name already point at the same agent before this row. */
  value: Record<string, string>;
  /** The catalogue fallback per role, computed once for all installed chains. */
  catalogDefault: Map<string, string>;
  onPick: (role: string, agentId: string) => void;
  onView: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState<"promote" | "uninstall" | null>(null);
  const roles = [...new Set(chain.steps.map((s) => s.role ?? s.agentName))];

  const promote = () => {
    setBusy("promote");
    chainsApi
      .promoteChain(chain.id)
      .then(onChanged)
      .catch((e: Error) => onError(e.message))
      .finally(() => setBusy(null));
  };
  const uninstall = () => {
    setBusy("uninstall");
    chainsApi
      .uninstallChain(chain.id)
      .then(onChanged)
      .catch((e: Error) => onError(e.message))
      .finally(() => setBusy(null));
  };

  return (
    <ListItem
      leading={<Workflow size={14} />}
      title={<Code variant="bare">{chain.name}</Code>}
      sub={chain.description}
      meta={<Tag title={CHAIN_TEXT.stepCountTitle}>{CHAIN_TEXT.stepCount(chain.steps.length)}</Tag>}
      actions={
        <>
          <IconBtn title={CHAIN_TEXT.viewSteps(chain.steps.length, chain.name)} onClick={onView}>
            <Eye size={13} />
          </IconBtn>
          {/* Icon plus tooltip, like its two neighbours; the reason is in the catalogue. */}
          <IconBtn title={CHAIN_TEXT.installed.promote} disabled={busy != null} onClick={promote}>
            <Library size={13} />
          </IconBtn>
          <IconBtn
            title={CHAIN_TEXT.installed.uninstall}
            danger
            disabled={busy != null}
            onClick={uninstall}
          >
            <Trash2 size={13} />
          </IconBtn>
        </>
      }
    >
      {roles.length > 0 && (
        <FormRow>
          {roles.map((role) => {
            const chosen = value[role] ?? "";
            const fallback = catalogDefault.get(role);
            return (
              <Field key={role} label={role}>
                <Select
                  value={chosen}
                  aria-label={CHAIN_TEXT.roles.selectLabel(role)}
                  onChange={(e) => onPick(role, e.target.value)}
                >
                  <option value="">
                    {fallback !== undefined
                      ? CHAIN_TEXT.roles.catalogDefault(fallback)
                      : CHAIN_TEXT.roles.removeMapping}
                  </option>
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
    </ListItem>
  );
}
