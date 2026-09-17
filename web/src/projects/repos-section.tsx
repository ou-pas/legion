// The project's repositories: the card of repositories every session clones, with each one's test
// command. Exported rather than wrapped in its own `<SettingsPage>`, because the Repositories screen
// (`ProjectPage.tsx`, `ReposScreen`) composes it with the git commit identity and the SSH key (nav
// batch 2a): three settings answering "how does this project touch git".
//
// v11: per-repo test command, run by the agent before writing pr.md.
// v29: the repo's forge, shown and correctable. It decides the credential presented to git and the
// review API queried; leaving it invisible leaves invisible the cause of a refused clone.
//
// One list (16/09). The card used to carry two differently drawn lists showing the same thing:
// declared repositories, then reachable ones. Now one, with no group heading: the right-hand button
// tells them apart ("Remove" = in the project, "Add" = reachable), and a declared row also carries
// its test command.
//
// So order is the only signal, an invariant `repos-section.test.tsx` holds: declared first,
// reachable next. Without it, three project repositories would scatter among twelve.
//
// The other invariant, the costliest: a declared repository comes from the database, a reachable
// one from the network. Declared ones show whatever happens to discovery (failed, empty or in
// flight). A forge answering 401 must not erase the project's repositories.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FolderGit2, Plus, Trash2, Webhook } from "lucide-react";
import {
  projectsApi,
  type AvailableRepo,
  type CreatedRepo,
  type ForgeKind,
  type Repo,
} from "../api/projects.js";
import { integrationsApi } from "../api/integrations.js";
import { inboundWebhooksKey } from "../integrations/InboundWebhooksPanel.js";
import { INBOUND_WEBHOOKS_TEXT } from "../integrations/webhooks-text.js";
import { StatusChip } from "../ui/chip.js";
import { availableReposQuery, connectionsQuery, qk, reposQuery } from "../queries.js";
import { Banner } from "../ui/banner.js";
import { Button, IconBtn } from "../ui/button.js";
import { Card, CardBody, CardDescription, CardHeader } from "../ui/card.js";
import { Tag } from "../ui/chip.js";
import { Divider } from "../ui/divider.js";
import { Row, Stack } from "../ui/flex.js";
import { Field, FormError, FormRow } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Link as UiLink } from "../ui/link.js";
import { List, ListItem, ListRow } from "../ui/list.js";
import { Select } from "../ui/select.js";
import { Caption, Text } from "../ui/text.js";
import {
  declaredInstances,
  FORGE_KINDS,
  forgeText,
  guessForge,
  type DeclaredInstance,
} from "./forge.js";
import { offeredRepos, RepoPicker, shortNameOf } from "./repo-picker.js";
import { PROJECT_PAGE_TEXT as T } from "./text/project-page.js";

const P = T.repoPicker;

export function ReposCard({ projectId }: { projectId: string }) {
  const { data: repos = [] } = useQuery(reposQuery(projectId));
  const available = useQuery(availableReposQuery(projectId));
  // The instances the project's connections name. A repository on `framagit.org` no longer needs
  // "which forge" answered once a GitLab connection talks to `framagit.org`.
  const { data: connections } = useQuery(connectionsQuery(projectId));
  const declared = declaredInstances(connections?.connections ?? []);
  const qc = useQueryClient();
  const [error, setError] = useState("");
  // The URL being added from the picker: the row says so, and does not send twice.
  const [adding, setAdding] = useState<string | null>(null);
  // What adding set without being asked. A value appearing on its own on another screen with
  // nothing announcing it is a surprise, not a service.
  const [adopted, setAdopted] = useState<{ name: string; email: string } | null>(null);
  // The URL form, opened from the list footer. Closed by default: no longer the common case since
  // repositories are ticked rather than typed.
  const [manual, setManual] = useState(false);
  // The id of the repository whose webhook is being connected: the row says so, and does not send
  // twice. Held here, not by the row, like `adding` for the picker: a row holding its own busy
  // state has no way to show it in stories.
  const [connecting, setConnecting] = useState<string | null>(null);
  // One query for the whole card, not one per row: it only serves to say "reconnect" when the public
  // URL changed since connecting. It shares `inboundWebhooksKey` with the System panel; react-query
  // dedupes.
  const { data: inbound } = useQuery({
    queryKey: inboundWebhooksKey,
    queryFn: integrationsApi.inboundWebhooks,
  });
  // The empty sentence only asserts what is known. It renders only if the whole list is empty: no
  // declared repository, and a discovery that answered with nothing more to offer. Failed or in
  // flight, the list is empty but nobody knows whether reachable repositories exist; the error box
  // already explains, and "no repository" would add an unsupported fact. Without a connection, the
  // picker's empty state already says everything, with its exit.
  const answer = available.isSuccess ? available.data : undefined;
  const listIsEmpty =
    repos.length === 0 &&
    answer !== undefined &&
    answer.connected.length > 0 &&
    offeredRepos(answer).length === 0;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.repos(projectId) });
    void qc.invalidateQueries({ queryKey: qk.bootstrap });
    // Adding may have set the git identity: the neighbouring card reads the same data.
    void qc.invalidateQueries({ queryKey: qk.gitIdentityCheck(projectId) });
  };
  /** Both doors lead to the same place: the repository enters, and the git identity may have been
   *  set on the way. That conclusion is what is shared, not how the repository is designated. */
  const created = (repo: CreatedRepo) => {
    setError("");
    setAdopted(repo.gitIdentityAdopted);
    invalidate();
  };

  /** Connecting the webhook at the forge: creates a hook with the token already stored. */
  const connectWebhook = (repo: Repo) => {
    setConnecting(repo.id);
    integrationsApi
      .connectRepoWebhook(repo.id)
      .then(invalidate)
      .catch((e: Error) => setError(`${INBOUND_WEBHOOKS_TEXT.repo.failed}: ${e.message}`))
      .finally(() => setConnecting(null));
  };

  /** One click adds the repository, and that is all: URL and short name are facts the forge already
   *  gave. The declared forge comes from the list, not from inference. */
  const pick = (repo: AvailableRepo) => {
    setAdding(repo.url);
    void projectsApi
      .createRepo({
        projectId,
        name: shortNameOf(repo.fullName),
        url: repo.url,
        forge: repo.forge,
      })
      .then(created)
      .catch((e: Error) => setError(e.message))
      .finally(() => setAdding(null));
  };

  return (
    // pad={false}: the repo list runs edge to edge, the text stays in a padded CardBody.
    <Card pad={false}>
      <CardBody>
        <CardHeader icon={<FolderGit2 size={16} />} title={T.repos.title} />
        <CardDescription>
          {T.repos.descClone}
          <code>./repos/&lt;name&gt;</code>
          {T.repos.descBranch}
          <code>legion/&lt;run&gt;</code>
          {T.repos.descCross}
          <code>pr.md</code>
          {T.repos.descEnd}
        </CardDescription>
      </CardBody>
      <Divider space="none" />
      {adopted && (
        <CardBody>
          <Banner
            tone="ok"
            title={P.adopted(adopted.name, adopted.email)}
            onClose={() => setAdopted(null)}
          />
        </CardBody>
      )}
      <List label={T.repos.listLabel}>
        {/* Declared first, unconditionally: they come from the database, not the network.
            Nothing below can make them disappear. */}
        {listIsEmpty && (
          <ListRow>
            <Text tone="muted" size="sm" as="p">
              {T.repos.none}
            </Text>
          </ListRow>
        )}
        {repos.map((r) => (
          <RepoRow
            key={r.id}
            repo={r}
            declared={declared}
            publicBaseUrl={inbound?.baseUrl ?? null}
            connecting={connecting === r.id}
            onConnect={() => connectWebhook(r)}
            onChange={invalidate}
            onError={setError}
          />
        ))}
        <RepoPicker
          data={available.data}
          loading={available.isPending}
          error={available.error ? available.error.message : null}
          projectId={projectId}
          declaredCount={repos.length}
          adding={adding}
          onAdd={pick}
          onRetry={() => void available.refetch()}
        />
        {/* The footer. The URL form did not disappear, it moved behind: a mirror, a private
            instance or a repository of an unconnected account will never be in the list. The
            doctrine removes typing a fact the API knows, not declaring what it does not. */}
        <ListRow
          actions={
            <Button
              leading={<Plus size={12} />}
              aria-expanded={manual}
              onClick={() => setManual(!manual)}
            >
              {P.manualToggle}
            </Button>
          }
        >
          <Caption>{P.manualFooter}</Caption>
        </ListRow>
      </List>
      {manual && (
        <>
          <Divider space="none" />
          <CardBody>
            <ManualRepoForm
              projectId={projectId}
              declared={declared}
              onCreated={(repo) => {
                setManual(false);
                created(repo);
              }}
              onError={setError}
            />
          </CardBody>
        </>
      )}
      {error && (
        <CardBody>
          <FormError>{error}</FormError>
        </CardBody>
      )}
    </Card>
  );
}

/** The way out: a URL typed by hand.
 *
 *  Not a comfort fallback. A mirror, a private instance, a repository of an unconnected account
 *  will never be in the list. Opened from the list footer (16/09), no longer a `Disclosure` at the
 *  bottom of the card: the list admits it is not exhaustive.
 *
 *  A separate component: its state (three fields) has no reader in the card, and keeping it up there
 *  pushed `ReposCard` over the linter's complexity cap. */
function ManualRepoForm({
  projectId,
  declared,
  onCreated,
  onError,
}: {
  projectId: string;
  declared: readonly DeclaredInstance[];
  onCreated: (repo: CreatedRepo) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  // `null` = let the host decide. The field is not one more choice in the common case; it only
  // becomes required on a host nothing names (neither the public host list nor an instance a
  // project connection names).
  const [forge, setForge] = useState<ForgeKind | null>(null);
  const deduced = guessForge(url, declared);
  const chosenForge = forge ?? deduced;
  const add = () =>
    projectsApi
      .createRepo({
        projectId,
        name: name.trim(),
        url: url.trim(),
        ...(chosenForge ? { forge: chosenForge } : {}),
      })
      .then((repo) => {
        setName("");
        setUrl("");
        setForge(null);
        onCreated(repo);
      })
      .catch((e: Error) => onError(e.message));

  return (
    <Stack gap={10}>
      <Caption>{P.manualHint}</Caption>
      <FormRow>
        <Field label={T.repos.nameLabel} required hint={T.repos.nameHint}>
          <Input
            placeholder={T.repos.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label={T.repos.urlLabel}
          required
          hint={T.repos.urlHint(forgeText(chosenForge).secretName)}
        >
          <Input
            placeholder={forgeText(chosenForge).urlExample}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
      </FormRow>
      {/* The field only appears when nothing answers in its place (16/09). The forge reads from
            the host when public, and from the project's connections when not: `framagit.org` is
            GitLab once a GitLab connection talks to it. Asking then would re-enter a fact set two
            screens earlier.

            It stays for a host no connection covers, where the choice is real: guessing would
            present the wrong credential, and the failure would come at clone time, in the
            container, blaming the wrong secret. */}
      {deduced === null && (
        <FormRow>
          <Field label={T.repos.forgeLabel} hint={T.repos.forgeHint}>
            <Select
              value={forge ?? ""}
              onChange={(e) => setForge((e.target.value || null) as ForgeKind | null)}
              placeholder={T.repos.forgePlaceholder}
            >
              {FORGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {forgeText(k).label}
                </option>
              ))}
            </Select>
          </Field>
        </FormRow>
      )}
      <Row gap={8} wrap>
        <Button
          variant="primary"
          leading={<Plus size={12} />}
          onClick={add}
          disabled={!name.trim() || !url.trim() || !chosenForge}
        >
          {T.repos.add}
        </Button>
        {/* Project convention: never a `disabled` button without saying why next to it. */}
        {name.trim() && url.trim() && !chosenForge && <Caption>{T.repos.forgeUnknownHost}</Caption>}
      </Row>
    </Stack>
  );
}

/** A row's forge, correctable only when it can be corrected (16/09).
 *
 *  The repository host answers by itself when public or when a project connection talks to it, and
 *  the row's `Tag` already shows that answer. The select only remains where nobody answers, and
 *  then it carries a real decision: guessing would present the wrong credential, and the failure
 *  would come at clone time, in the container, blaming the wrong secret.
 *
 *  A separate component because `RepoRow` crossed the linter's complexity cap with this condition. */
function RepoForgeField({
  repo,
  declared,
  onChange,
  onError,
}: {
  repo: Repo;
  declared: readonly DeclaredInstance[];
  onChange: () => void;
  onError: (m: string) => void;
}) {
  if (guessForge(repo.url, declared) !== null) return null;
  return (
    <Row minWidth={160}>
      <Field label="Forge" hint={`Secret attendu : ${forgeText(repo.forge).secretName}`}>
        <Select
          value={repo.forge ?? "github"}
          aria-label={`Forge of repo ${repo.name}`}
          onChange={(e) =>
            projectsApi
              .patchRepo(repo.id, { forge: e.target.value as ForgeKind })
              .then(onChange)
              .catch((err: Error) => onError(err.message))
          }
        >
          {FORGE_KINDS.map((k) => (
            <option key={k} value={k}>
              {forgeText(k).label}
            </option>
          ))}
        </Select>
      </Field>
    </Row>
  );
}

/** A row's test command, and its absence, the most frequent state.
 *
 *  Variant B: a repository without a command shows no extra empty field. An empty field per row
 *  reads as expected input, while most repositories expect none. The gesture expands the field,
 *  focused: `autoFocus` only applies to that mount, never to the card's first render, where it
 *  would steal the cursor.
 *
 *  A separate component because `RepoRow` crossed the linter's complexity cap with the variant. */
function RepoTestCommand({
  repo,
  onChange,
  onError,
}: {
  repo: Repo;
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const [cmd, setCmd] = useState(repo.testCommand ?? "");
  const [editing, setEditing] = useState(false);
  const dirty = cmd.trim() !== (repo.testCommand ?? "");

  if (repo.testCommand === null && !editing)
    return (
      <Caption>
        {T.repos.noTestCommand} ·{" "}
        {/* A button dressed as a link: the gesture opens no address, it expands a field. An anchor
            without `href` is neither focusable nor keyboard-actionable. Props are destructured
            rather than spread: an anchor's do not belong on a button. */}
        <UiLink
          render={({ className, children }) => (
            <button type="button" className={className} onClick={() => setEditing(true)}>
              {children}
            </button>
          )}
        >
          {T.repos.setTestCommand}
        </UiLink>
      </Caption>
    );

  return (
    <Row gap={8} wrap align="flex-end">
      {/* No label: the placeholder already says what it is. `flex={1}`: without it the field took
          an <input>'s default width (~190px) and a chained command (`yarn install
          --frozen-lockfile && yarn build`) showed cut at "--frozen-lockfi", which reads as a wrong
          command, not a truncated one. */}
      <Row flex={1} minWidth={240}>
        <Input
          placeholder={T.repos.testCommandPlaceholder}
          aria-label={T.repos.testCommandFor(repo.name)}
          autoFocus={editing}
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
        />
      </Row>
      {dirty && (
        <Button
          variant="primary"
          leading={<Check size={12} />}
          onClick={() =>
            projectsApi
              .patchRepo(repo.id, { testCommand: cmd.trim() || null })
              .then(onChange)
              .catch((e: Error) => onError(e.message))
          }
        >
          {T.repos.saveTestCommand}
        </Button>
      )}
    </Row>
  );
}

/** A declared repository's row. It neither reads the network nor connects.
 *
 *  Everything is given (the instance public URL, the connection in progress), for the same reason
 *  `RepoPicker` receives its list and `adding`: it makes its states exercisable in stories. The
 *  stale webhook and the connection in progress are two rules that outlived their display when it
 *  moved to the right-hand markers; without stories nothing held them. */
export function RepoRow({
  repo,
  declared,
  publicBaseUrl,
  connecting,
  onConnect,
  onChange,
  onError,
}: {
  repo: Repo;
  declared: readonly DeclaredInstance[];
  /** The instance public URL, `null` if not configured. Only used to say "reconnect": the hook was
   *  set on another address, so it calls into the void. */
  publicBaseUrl: string | null;
  /** This repository's connection is under way: the button says so and does not send twice. */
  connecting: boolean;
  onConnect: () => void;
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const W = INBOUND_WEBHOOKS_TEXT.repo;
  const stale = Boolean(
    repo.webhookId &&
    repo.webhookUrl &&
    publicBaseUrl &&
    !repo.webhookUrl.startsWith(publicBaseUrl),
  );
  const text = forgeText(repo.forge);
  return (
    // `align="start"`: the right-hand markers belong to the name line. Centred on the full height,
    // they floated halfway to the command field.
    <ListItem
      align="start"
      leading={<FolderGit2 size={15} />}
      title={repo.name}
      sub={repo.url}
      meta={
        <>
          {/* What informs is flat, what clicks is framed. The forge is data, not a gesture: framed,
              it read as a button next to the webhook one. */}
          <Tag variant="flat" title={`Forge : ${text.label} · secret ${text.secretName}`}>
            {text.label}
          </Tag>
          {/* The inbound webhook (webhooks batch): merged PR → done task. Pill and button share the
              right-hand slot, one or the other depending on whether it is connected. "Reconnect" =
              the public URL changed since, the forge's hook calls a dead address. The pill stays
              framed like every state pill in the product. */}
          {repo.webhookId && (
            <StatusChip state={stale ? "wait" : "ok"} size="sm">
              {stale ? W.stale : W.connected}
            </StatusChip>
          )}
          <Divider orientation="vertical" space="none" />
        </>
      }
      actions={
        <>
          {/* Connecting a webhook keeps its words. It is neither obvious nor without effect at a
              third party: it creates a hook on the forge. This row's obvious, reversible gestures
              (remove, add) are icons; this one reads. Never `primary`: the accent does not belong
              to this row. */}
          {(!repo.webhookId || stale) && (
            <Button
              size="sm"
              leading={<Webhook size={12} />}
              loading={connecting}
              onClick={onConnect}
            >
              {repo.webhookId ? W.reconnect : W.connect}
            </Button>
          )}
          <IconBtn
            title={T.repos.remove}
            danger
            onClick={() =>
              projectsApi
                .deleteRepo(repo.id)
                .then(onChange)
                .catch((e: Error) => onError(e.message))
            }
          >
            <Trash2 size={13} />
          </IconBtn>
        </>
      }
    >
      <Stack gap={8}>
        <RepoTestCommand repo={repo} onChange={onChange} onError={onError} />
        <RepoForgeField repo={repo} declared={declared} onChange={onChange} onError={onError} />
      </Stack>
    </ListItem>
  );
}
