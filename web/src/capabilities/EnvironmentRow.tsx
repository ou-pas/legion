// A registry environment: its name, allowed hosts, the agents referencing it (read-only here,
// assignment happens per agent on the Agents page), and its two gestures, edit the allowlist and
// delete. Same pattern as RuleRow/InstalledChainRow: a refusal (409, named by the server) goes up
// to the parent block, never swallowed.
import { useState } from "react";
import { Globe, Pencil, Trash2, X } from "lucide-react";
import { environmentsApi, type Environment } from "../api/environments.js";
import { Button, IconBtn } from "../ui/button.js";
import { Chip } from "../ui/chip.js";
import { Row, Stack } from "../ui/flex.js";
import { Field, FormRow } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { ListItem } from "../ui/list.js";
import { Caption } from "../ui/text.js";
import { ENVIRONMENTS_TEXT } from "./text/environments.js";
import { NETWORKING } from "../api/environments.js";

export function EnvironmentRow({
  env,
  agentNames,
  onChange,
  onError,
}: {
  env: Environment;
  agentNames: string[];
  onChange: () => void;
  /** A refusal (400/409) must be readable, same contract as RuleRow/InstalledChainRow. */
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(env.name);
  const [hosts, setHosts] = useState(env.allowedHosts.join(", "));
  const [busy, setBusy] = useState(false);
  const t = ENVIRONMENTS_TEXT.row;

  const startEdit = () => {
    setName(env.name);
    setHosts(env.allowedHosts.join(", "));
    setEditing(true);
  };

  const save = () => {
    setBusy(true);
    environmentsApi
      .patchEnvironment(env.id, {
        name: name.trim(),
        ...(env.networking === NETWORKING.limited
          ? {
              allowedHosts: hosts
                .split(",")
                .map((h) => h.trim())
                .filter(Boolean),
            }
          : {}),
      })
      .then(() => {
        setEditing(false);
        onChange();
      })
      .catch((e: Error) => onError(e.message))
      .finally(() => setBusy(false));
  };

  const remove = () =>
    environmentsApi
      .deleteEnvironment(env.id)
      .then(onChange)
      .catch((e: Error) => onError(e.message));

  return (
    <ListItem
      leading={<Globe size={15} />}
      title={env.name}
      meta={
        <>
          {env.networking === NETWORKING.open ? (
            <Chip size="sm" title={t.openHint}>
              {t.openLabel}
            </Chip>
          ) : (
            <Chip
              size="sm"
              mono
              title={env.allowedHosts.length ? env.allowedHosts.join(", ") : t.noHosts}
            >
              {t.hostCount(env.allowedHosts.length)}
            </Chip>
          )}
          <Chip size="sm" title={agentNames.length ? agentNames.join(", ") : t.noAgents}>
            {t.agentCount(agentNames.length)}
          </Chip>
        </>
      }
      actions={
        <>
          <IconBtn
            title={editing ? t.cancel : t.edit}
            onClick={() => (editing ? setEditing(false) : startEdit())}
          >
            {editing ? <X size={13} /> : <Pencil size={13} />}
          </IconBtn>
          <IconBtn
            title={agentNames.length > 0 ? t.deleteBlocked(agentNames.length) : t.delete}
            danger
            onClick={remove}
          >
            <Trash2 size={13} />
          </IconBtn>
        </>
      }
    >
      {editing && (
        <Stack gap={8}>
          <FormRow>
            <Field label={ENVIRONMENTS_TEXT.form.nameLabel} required>
              <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
            </Field>
            {env.networking === NETWORKING.limited && (
              <Field
                label={ENVIRONMENTS_TEXT.form.hostsLabel}
                hint={ENVIRONMENTS_TEXT.form.hostsHint}
              >
                <Input value={hosts} onChange={(e) => setHosts(e.target.value)} />
              </Field>
            )}
          </FormRow>
          {env.networking === NETWORKING.open && (
            <Caption>{ENVIRONMENTS_TEXT.form.openNetworkingHint}</Caption>
          )}
          <Row gap={6}>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!name.trim()}
              onClick={save}
            >
              {ENVIRONMENTS_TEXT.form.save}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setEditing(false)}>
              {ENVIRONMENTS_TEXT.form.cancel}
            </Button>
          </Row>
        </Stack>
      )}
    </ListItem>
  );
}
