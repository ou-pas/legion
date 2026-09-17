// The project's secrets, encrypted in the database (AES-256-GCM, master key outside the database).
// The API returns names only: no value ever reaches the browser, not even for the secret's author.
// A secret is replaced, never reread.
//
// Project-specific Claude credentials are set here: a secret named `CLAUDE_CODE_OAUTH_TOKEN` or
// `ANTHROPIC_API_KEY` overrides the control plane environment for all this project's sessions
// (see server/src/auth.ts).
//
// The resolution verdict (which key serves) moved to `CredentialsCard`, next to it (08/09). This
// card keeps a narrower mention, on its own list, which row serves and which is masked, because an
// API key set, valid and still ignored cannot be guessed. Both cards read the same server response
// (`projectCredentialsQuery`), so never two verdicts.
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { CONNECTION_SECRET_NAMES } from "../api/connections.js";
import {
  projectsApi,
  AUTH_SECRET_NAMES,
  type ActiveCredential,
  type Project,
  type Secret,
} from "../api/projects.js";
import { projectCredentialsQuery, qk, secretsQuery } from "../queries.js";
import { Button } from "../ui/button.js";
import { Card, CardBody, CardDescription, CardHeader } from "../ui/card.js";
import { Code } from "../ui/code.js";
import { ConfirmAction } from "../ui/confirm-action.js";
import { Divider } from "../ui/divider.js";
import { Row, Stack } from "../ui/flex.js";
import { Field, FormError, FormRow } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { List, ListRow } from "../ui/list.js";
import { isSubmitKey, type SubmitKeyEvent } from "../ui/submit-key.js";
import { SubmitShortcut } from "../ui/submit-shortcut.js";
import { Caption, Text } from "../ui/text.js";
import { CREDENTIALS_CARD_TEXT } from "./text/credentials.js";
import { SECRETS_CARD_TEXT as T } from "./text/secrets.js";

/** How long the drop acknowledgement stays next to the button. Longer than other cards' "Saved":
 *  it is the only confirmation ever that a value arrived. */
const SAVED_MS = 2500;

/** What a row has to say about itself, and nothing decided elsewhere.
 *
 *  Two mentions, two kinds. For an auth key: which one serves, because a key set, valid and still
 *  ignored cannot be guessed. For a provider token: where it should have come from, because that
 *  gesture moved to Integrations, where it is probed, stored under the canonical name, and
 *  sometimes renewable.
 *
 *  Neither removes anything: a secret no longer set here is not destroyed; the row exists, serves,
 *  and stays. */
function secretMention(secret: Secret, credential: ActiveCredential | undefined): ReactNode {
  if (AUTH_SECRET_NAMES.includes(secret.name))
    return credential?.from === "project" && credential.name === secret.name ? (
      <Caption tone="ok">{CREDENTIALS_CARD_TEXT.serving}</Caption>
    ) : (
      <Caption tone="wait">{CREDENTIALS_CARD_TEXT.masked}</Caption>
    );
  if (CONNECTION_SECRET_NAMES.includes(secret.name)) return <Caption>{T.fromIntegrations}</Caption>;
  return undefined;
}

export function SecretsCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { data: all = [] } = useQuery(secretsQuery);
  const { data: credentials } = useQuery(projectCredentialsQuery(project.id));
  const credential = credentials?.active;
  const [err, setErr] = useState("");

  const mine = all.filter((s) => s.projectId === project.id);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.secrets });

  return (
    <Card pad={false}>
      <CardBody>
        <CardHeader icon={<KeyRound size={16} />} title={T.title} />
        <CardDescription>
          {T.descBefore}
          <Code variant="bare">CLAUDE_CODE_OAUTH_TOKEN</Code>
          {T.descBetween}
          <Code variant="bare">ANTHROPIC_API_KEY</Code>
          {T.descAfter}
          <strong>{T.descForThisProject}</strong>
          {T.descTail}
        </CardDescription>
      </CardBody>
      <Divider space="none" />
      {mine.length === 0 ? (
        <CardBody>
          <Text tone="muted" size="sm" as="p">
            {T.emptyBefore}
            <Code variant="bare">server/.env</Code>
            {T.emptyAfter}
          </Text>
        </CardBody>
      ) : (
        <List label={T.listLabel}>
          {mine.map((s) => (
            // Two auth keys can coexist, only one serves: the subscription token wins alone. Saying
            // it per row is the only way to see that a set, valid key is ignored.
            <ListRow
              key={s.id}
              leading={<KeyRound size={15} />}
              meta={secretMention(s, credential)}
              actions={
                <ConfirmAction
                  leading={<Trash2 size={13} />}
                  label={T.remove}
                  confirmLabel={T.removeConfirm}
                  onConfirm={() =>
                    projectsApi
                      .deleteSecret(s.id)
                      .then(refresh)
                      .catch((e: Error) => setErr(e.message))
                  }
                />
              }
            >
              {/* The variable name always stays written: it is what has an effect, and what you
                    read when no label is set. The label sits next to it, never replacing it. */}
              <Row gap={8} wrap>
                <Code variant="bare">{s.name}</Code>
                <SecretLabelInput secret={s} onSaved={refresh} onError={setErr} />
              </Row>
            </ListRow>
          ))}
        </List>
      )}
      <Divider space="none" />
      <NewSecretForm projectId={project.id} error={err} onError={setErr} onSaved={refresh} />
    </Card>
  );
}

/** Adding a secret. A separate component because it holds three draft fields the card need not
 *  know, and the screen's only receipt: a sent value is never reread, so this sentence is the only
 *  proof it arrived. */
function NewSecretForm({
  projectId,
  error,
  onError,
  onSaved,
}: {
  projectId: string;
  error: string;
  onError: (message: string) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [saved, setSaved] = useState("");
  const canSave = name.trim().length > 0 && value.length > 0;

  const save = () => {
    if (!canSave) return undefined;
    const posted = name.trim();
    return projectsApi
      .saveSecret({ projectId, name: posted, value, label })
      .then((r) => {
        setSaved(r.replaced ? T.replaced(posted) : T.stored(posted));
        setName("");
        setValue("");
        setLabel("");
        onError("");
        onSaved();
        setTimeout(() => setSaved(""), SAVED_MS);
      })
      .catch((e: Error) => onError(e.message));
  };
  // Enter alone no longer saves (07/09), same key as the inbox and composer (ui/submit-key.ts). A
  // secret sent too early can only be undone by replacing it, and Enter in a one-line field is the
  // easiest gesture to make by accident.
  const submitOnKey = (e: SubmitKeyEvent) => {
    if (isSubmitKey(e)) save();
  };

  return (
    <CardBody>
      <Stack gap={8}>
        <FormRow>
          <Field label={T.nameLabel} required hint={T.nameHint}>
            <Input
              placeholder={T.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={submitOnKey}
            />
          </Field>
          <Field label={T.valueLabel} required hint={T.valueHint}>
            {/* type=password: the value must not stay readable on screen while typing, nor end up
                in a screenshot of a work session. */}
            <Input
              type="password"
              placeholder={T.valuePlaceholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={submitOnKey}
            />
          </Field>
          {/* The label is not encrypted, on purpose: encrypted, the project's keys could not be
              listed without the master key, and an unreadable key would lose its name exactly when
              you look for the broken one. */}
          <Field label={T.aliasLabel} hint={T.aliasHint}>
            <Input
              placeholder={T.aliasPlaceholder}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={submitOnKey}
            />
          </Field>
        </FormRow>
        <Row gap={8} wrap>
          <Button
            variant="primary"
            leading={<Plus size={12} />}
            disabled={!canSave}
            onClick={save}
            shortcut={<SubmitShortcut />}
          >
            {T.save}
          </Button>
          {saved && <Caption tone="ok">{saved}</Caption>}
        </Row>
        {error && <FormError>{error}</FormError>}
      </Stack>
    </CardBody>
  );
}

/** A key's label, editable in place. A separate component because it holds state: a `useState` in
 *  the parent's `.map` would be a hook in a loop.
 *
 *  Saved on blur (or on Enter, which triggers it), without the value: fixing a typo in a label must
 *  not require re-pasting a token. Emptying the field removes the label; the server stores empty as
 *  `null`, because "never named" and "named then cleared" are the same state and the screen falls
 *  back to the variable name. */
function SecretLabelInput({
  secret,
  onSaved,
  onError,
}: {
  secret: Secret;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(secret.label ?? "");
  const commit = () => {
    if (draft.trim() === (secret.label ?? "")) return; // unchanged: no write
    projectsApi
      .setSecretLabel(secret.id, draft)
      .then(onSaved)
      .catch((e: Error) => onError(e.message));
  };
  return (
    <Input
      size="sm"
      value={draft}
      placeholder={T.labelPlaceholder}
      aria-label={T.labelOf(secret.name)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
