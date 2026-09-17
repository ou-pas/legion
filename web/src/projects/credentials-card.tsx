// The Claude credentials card: the ordered list of a project's subscription tokens, what is
// exhausted and until when, and the account serving now.
//
// It replaces the old `GET /api/projects/:id/credential` (singular, removed 08/09) as the only place
// answering "why does my session run on this account". `SecretsCard` keeps a narrower question
// (which of its rows serves) and reads the same server response (`projectCredentialsQuery`) so the
// two never disagree.
//
// All accounts exhausted is the most frequent case (the server never falls back to a paid key when
// the list is closed): the verdict line turns `bad` then, before listing accounts one by one.
//
// Order is the list's only degree of freedom: the first usable account serves, alone. Rank is set
// with two arrows rather than drag and drop: a few rows at most, and a pair of buttons tests and
// announces itself on the keyboard with no extra library.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ListOrdered, Plus, Trash2 } from "lucide-react";
import {
  projectsApi,
  type ActiveCredential,
  type Project,
  type RankedCredential,
} from "../api/projects.js";
import { projectCredentialsQuery, qk } from "../queries.js";
import { Button, IconBtn } from "../ui/button.js";
import { Card, CardBody, CardDescription, CardHeader } from "../ui/card.js";
import { Code } from "../ui/code.js";
import { ConfirmAction } from "../ui/confirm-action.js";
import { Divider } from "../ui/divider.js";
import { Row, Stack } from "../ui/flex.js";
import { Field, FormError, FormRow } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { List, ListRow } from "../ui/list.js";
import { LOCALE } from "../ui/locale.js";
import { isSubmitKey, type SubmitKeyEvent } from "../ui/submit-key.js";
import { SubmitShortcut } from "../ui/submit-shortcut.js";
import { Caption, Text } from "../ui/text.js";
import { CREDENTIALS_CARD_TEXT as T } from "./text/credentials.js";

/** How long the drop acknowledgement stays next to the button, same as `SecretsCard`. */
const SAVED_MS = 2500;

/** "Sun 23:13", same format as the out-of-quota pause elsewhere (task-verdict.tsx, inbox-item.tsx):
 *  an account closed for the week can reopen on another day. */
const UNTIL_AT = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function CredentialsCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { data } = useQuery(projectCredentialsQuery(project.id));
  const [err, setErr] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: qk.projectCredentials(project.id) });

  const credentials = data?.credentials ?? [];
  const active = data?.active;

  return (
    <Card pad={false}>
      <CardBody>
        <CardHeader icon={<ListOrdered size={16} />} title={T.title} />
        <CardDescription>{T.desc}</CardDescription>
        {/* The verdict, in one sentence: what no list says on its own. */}
        {active && (
          <Text tone={active.available ? "muted" : "bad"} size="sm" as="p">
            {verdict(active)}
          </Text>
        )}
      </CardBody>
      <Divider space="none" />
      {credentials.length === 0 ? (
        <CardBody>
          <Text tone="muted" size="sm" as="p">
            {T.emptyBefore}
            <Code variant="bare">server/.env</Code>
            {T.emptyAfter}
          </Text>
        </CardBody>
      ) : (
        <List label={T.listLabel}>
          {credentials.map((c, i) => (
            <ListRow
              key={c.id}
              leading={
                <Row gap={2}>
                  <IconBtn
                    title={T.rankUp}
                    small
                    disabled={i === 0}
                    onClick={() =>
                      projectsApi
                        .patchCredential(c.id, { rank: c.rank - 1 })
                        .then(refresh)
                        .catch((e: Error) => setErr(e.message))
                    }
                  >
                    <ChevronUp size={13} />
                  </IconBtn>
                  <IconBtn
                    title={T.rankDown}
                    small
                    disabled={i === credentials.length - 1}
                    onClick={() =>
                      projectsApi
                        .patchCredential(c.id, { rank: c.rank + 1 })
                        .then(refresh)
                        .catch((e: Error) => setErr(e.message))
                    }
                  >
                    <ChevronDown size={13} />
                  </IconBtn>
                </Row>
              }
              meta={<RowStatus credential={c} active={active} />}
              actions={
                <ConfirmAction
                  leading={<Trash2 size={13} />}
                  label={T.remove}
                  confirmLabel={T.removeConfirm}
                  onConfirm={() =>
                    projectsApi
                      .deleteCredential(c.id)
                      .then(refresh)
                      .catch((e: Error) => setErr(e.message))
                  }
                />
              }
            >
              <Row gap={8} wrap>
                <Text tone="subtle" size="sm">
                  {c.rank}.
                </Text>
                <Code variant="bare">{c.name}</Code>
                <CredentialLabelInput credential={c} onSaved={refresh} onError={setErr} />
              </Row>
            </ListRow>
          ))}
        </List>
      )}
      <Divider space="none" />
      <NewCredentialForm projectId={project.id} error={err} onError={setErr} onSaved={refresh} />
    </Card>
  );
}

/** Why the session runs on this account, in this order: all exhausted first (the most frequent case,
 *  which must show), then the project's account, then the fallback. */
function verdict(active: ActiveCredential): string {
  if (!active.available && active.retryAt)
    return T.active.unavailable(UNTIL_AT.format(new Date(active.retryAt)));
  if (active.from === "project" && active.name)
    return T.active.fromProject(active.label, active.name);
  if (active.from === "control-plane") return T.active.fromControlPlane;
  return T.active.none;
}

/** One row's state. Exhaustion wins over "active": the account resolution points at when all are
 *  closed (the first to reopen) is still closed now, and saying otherwise would lie. */
function RowStatus({
  credential,
  active,
}: {
  credential: RankedCredential;
  active?: ActiveCredential;
}) {
  const closed = credential.exhausted[0];
  if (closed)
    return (
      <Caption tone="wait">
        {T.status.exhaustedUntil(UNTIL_AT.format(new Date(closed.until)), T.window[closed.window])}
      </Caption>
    );
  if (active?.available && credential.id === active.credentialId)
    return <Caption tone="ok">{T.status.active}</Caption>;
  return <Caption tone="muted">{T.status.waiting}</Caption>;
}

/** An account label, editable in place, same mechanics as `SecretLabelInput`: saved on blur,
 *  never re-pasting the token. */
function CredentialLabelInput({
  credential,
  onSaved,
  onError,
}: {
  credential: RankedCredential;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(credential.label ?? "");
  const commit = () => {
    if (draft.trim() === (credential.label ?? "")) return; // unchanged: no write
    projectsApi
      .patchCredential(credential.id, { label: draft })
      .then(onSaved)
      .catch((e: Error) => onError(e.message));
  };
  return (
    <Input
      size="sm"
      value={draft}
      placeholder={T.labelPlaceholder}
      aria-label={T.labelOf(credential.name)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/** Adding an account. It always arrives last: a backup account must not move spending unasked. */
function NewCredentialForm({
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
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [saved, setSaved] = useState("");
  const canSave = value.length > 0;

  const save = () => {
    if (!canSave) return;
    projectsApi
      .addCredential(projectId, { value, label: label || undefined })
      .then((r) => {
        setSaved(T.stored(r.rank));
        setValue("");
        setLabel("");
        onError("");
        onSaved();
        setTimeout(() => setSaved(""), SAVED_MS);
      })
      .catch((e: Error) => onError(e.message));
  };
  // Same convention as the inbox, the composer and SecretsCard (ui/submit-key.ts): Enter alone does
  // not save, Cmd/Ctrl+Enter does. A token sent too early can only be undone by replacing it.
  const submitOnKey = (e: SubmitKeyEvent) => {
    if (isSubmitKey(e)) save();
  };

  return (
    <CardBody>
      <Stack gap={8}>
        <FormRow>
          <Field label={T.valueLabel} required hint={T.valueHint}>
            <Input
              type="password"
              placeholder={T.valuePlaceholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={submitOnKey}
            />
          </Field>
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
