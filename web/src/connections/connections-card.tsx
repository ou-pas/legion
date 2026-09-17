// A project's connections: one tile per provider, and the code to type while a flow is open.
//
// Polling is paced by the provider, not by us: `intervalMs` comes from its answer, and `slow_down`
// means "back off". Hammering would get the flow banned before it completes.
//
// One flow at a time: opening a second tile while a code is shown would leave two codes on screen,
// only one of them valid.
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plug, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import {
  connectionsApi,
  FLOW_KIND,
  FLOW_STATUS,
  PROVIDER,
  PROVIDERS,
  TOKEN_ORIGIN,
  type Connection,
  type FlowStart,
  type ProviderKind,
  type TokenOrigin,
} from "../api/connections.js";
import type { Project } from "../api/projects.js";
import { qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Card, CardBody, CardDescription, CardHeader } from "../ui/card.js";
import { ConfirmAction } from "../ui/confirm-action.js";
import { CONNECT_STATE, ConnectTile, type ConnectState } from "../ui/connect-tile.js";
import { ErrorState } from "../ui/error-state.js";
import { Row, Stack } from "../ui/flex.js";
import { Link } from "../ui/link.js";
import { Caption } from "../ui/text.js";
import { useToast } from "../ui/toast.js";
import { CONNECTIONS_TEXT as T } from "./text.js";
import "./connections-card.css";

const NAMES: Record<ProviderKind, string> = {
  [PROVIDER.github]: "GitHub",
  [PROVIDER.gitlab]: "GitLab",
  [PROVIDER.linear]: "Linear",
};

/** The drawings we ship, `web/public/providers/<kind>.svg`, one per `PROVIDERS` value. A provider
 *  registered by the server without a logo here falls back to the generic icon, not an empty square. */
const DRAWN: readonly string[] = PROVIDERS;

/** The display name, falling back to the raw key. `NAMES` claims to cover every `ProviderKind`, but
 *  the real list comes from the network (`GET /api/connections`) and the type does not bind it. A
 *  provider unknown to this client would otherwise read "Connect undefined". */
function providerName(provider: ProviderKind): string {
  return NAMES[provider] ?? provider;
}

/** The brand, in its colours (round 3): an `<img>`, no longer a mask.
 *
 *  `mask-image` tints with `currentColor`, so it can render only one colour, never a brand. The cost
 *  is one pre-coloured file per provider (`web/public/providers/`).
 *
 *  All three take the same path since round 4. GitHub had stayed an ink mask because `#181717`
 *  vanishes on a dark background, true while the square followed the theme. It now sits on a
 *  constant plate (`--brand-plate`), so the premise and the asymmetry are gone.
 *
 *  A provider without a drawing falls back to a plug: no empty square, and the name next to it
 *  suffices. */
function providerMark(provider: ProviderKind, name: string) {
  if (!DRAWN.includes(provider)) return <Plug />;
  // `alt=""`: the tile already writes the name next to it and the slot is `aria-hidden`. Alt text
  // here would make a screen reader say "GitLab GitLab".
  return <img src={`/providers/${provider}.svg`} alt="" title={name} />;
}

/** What each `slow_down` costs. Five seconds, as RFC 8628 prescribes (§3.5): not a comfort setting,
 *  it is what the provider expects. */
const SLOW_DOWN_STEP_MS = 5_000;

/** The provider list only changes on deploy: keep it fresh for half a minute rather than refetch it
 *  on every tab mount. */
const LIST_STALE_MS = 30_000;

type OpenFlow = FlowStart & { provider: ProviderKind };

/** An OAuth scope put into words. The translation lives here, not in `ui/`: GitHub's `repo` and
 *  GitLab's `api` are provider vocabulary the design system does not need to know.
 *
 *  The raw value survives as `title`: it is what you look for when comparing with the provider's
 *  consent screen. A scope missing from the table renders as is: ugly but true, where a catch-all
 *  label would hide what was just granted. */
function describeScopes(scopes: readonly string[]): { label: string; title: string }[] {
  return scopes.map((scope) => ({ label: T.scopeLabels[scope] ?? scope, title: scope }));
}

/** An environment variable name as our own messages write it: capitals and digits, and at least
 *  one underscore.
 *
 *  The underscore is the whole rule. Without it, a message starting with "URL" got split into "URL"
 *  and the rest, exactly the guesswork this function exists to avoid. All our variables carry a `_`
 *  (`LEGION_PUBLIC_URL`); no English word does. */
const ENV_VAR = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/** What is missing, split in two: what to set, and what it unlocks.
 *
 *  The server returns one sentence, and rightly so: it also goes out in a 400, where there is no
 *  layout. So it is split here, for the screen: the first word when it is a variable name (in mono,
 *  ready to copy), the rest below.
 *
 *  A sentence that does not start with a variable survives whole and becomes the `code` alone,
 *  without detail. Splitting by guess would be worse than not splitting. */
function blockedOf(unconfigured: string | null): { code: string; detail?: string } | undefined {
  if (!unconfigured) return undefined;
  const [first, ...rest] = unconfigured.trim().split(" ");
  if (!first || !ENV_VAR.test(first) || rest.length === 0) return { code: unconfigured.trim() };
  return { code: first, detail: rest.join(" ") };
}

/** The tile state, and the mode when connected: "Connected · OAuth", "Connected · token".
 *
 *  Both on one line because they answer the same question. Without an origin (unreadable
 *  `metadata`) the state stays plain "Connected": staying silent about the origin is not inventing
 *  it. The other three states have no mode, nothing is set yet. */
function stateLabelOf(state: ConnectState, origin: TokenOrigin | null): string {
  if (state !== CONNECT_STATE.connected || !origin) return T.state[state];
  return T.connectedWith(T.origin[origin]);
}

/** The acquisition mode icon: a key for a token set by hand, a shield for a grant obtained by
 *  Legion. It doubles the word, it does not replace it: the text is what is read. */
const ACQUIRED_ICON: Record<TokenOrigin, ReactNode> = {
  [TOKEN_ORIGIN.granted]: <ShieldCheck size={13} aria-hidden="true" />,
  [TOKEN_ORIGIN.pasted]: <KeyRound size={13} aria-hidden="true" />,
};

/** This provider's token label and shape, with a fallback for a provider this client does not know
 *  yet: the server registers the list, not the type. */
function pasteText(provider: ProviderKind): { field: string; placeholder: string } {
  return T.paste[provider] ?? T.paste[PROVIDER.github];
}

/** What the tile says about a token already set: how it arrived, what the provider answered about
 *  its access, whether Legion can renew it, which account, and since when.
 *
 *  Independent sentences, not one with holes: they answer different questions. "Set by hand" cannot
 *  mean "not renewable": a GitHub connection is granted without being renewable. */
function connectionNote(connection: Connection): ReactNode {
  if (!connection.connected) return undefined;
  // Secondary lines, in order of importance. The account comes late (round 3): the operator rarely
  // looks for it, and a long one pushes the rest down.
  const lines = [
    // "We do not know" has no sentence (round 2): the missing list shows it. This one stays because
    // it says the opposite: the provider answered "no access", and nothing else in the tile says so.
    connection.scopes?.length === 0 ? T.scopesNone : null,
    connection.renewable ? T.renewable : null,
    connection.account ? T.account(connection.account) : null,
    // The date comes from the `secrets` row, so it is the current connection's: reconnecting
    // replaces the token, and the date with it.
    connection.connectedAt !== null ? T.since(connection.connectedAt) : null,
  ].filter((line): line is string => line !== null);
  return (
    <Stack gap={4}>
      {/* The acquisition mode first, with its icon: the first thing you want to know about a
          connected tile, and the top badge only says "Connected". Absent when the origin is
          unknown: unreadable `metadata` is not made up. */}
      {connection.origin && (
        <Row gap={6}>
          {ACQUIRED_ICON[connection.origin]}
          <Caption>{T.acquired[connection.origin]}</Caption>
        </Row>
      )}
      {lines.map((line) => (
        <Caption key={line}>{line}</Caption>
      ))}
    </Stack>
  );
}

/** The gesture of a connected tile, and the admission that goes with it.
 *
 *  Legion does not revoke, and the screen says so. Revoking at a provider requires application
 *  authentication, so a `client_secret` Legion does not ship (which is what makes its `client_id`
 *  public and lets anyone run their own instance). Disconnecting forgets the token here; it stays
 *  valid there. The link to the real revocation page makes the admission usable.
 *
 *  The sentence is permanent, not reserved to `ConfirmAction`'s armed state: it must weigh on the
 *  decision to start the gesture, so it comes before. `ConfirmAction` keeps its role of making the
 *  irreversible deliberate.
 *
 *  The link depends on the origin, as the server decided: GitHub and GitLab revoke an OAuth grant
 *  and a personal token on different pages. `null` when the origin is unknown: no link rather than
 *  a link to a page where the token is not listed.
 *
 *  The anchor skips `safeHref`: the URL comes from our server, built by the provider descriptor,
 *  not from a third-party response field like `verification_uri`. `rel="noreferrer"` anyway: the
 *  instance address has no business in the provider's `Referer`. */
function DisconnectGesture({
  revokeUrl,
  name,
  busy,
  onConfirm,
}: {
  /** Where this token is revoked, as the provider gives it. `null` when its origin is unknown. */
  revokeUrl: string | null;
  name: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <Stack gap={6}>
      <Caption>{T.disconnectMeans}</Caption>
      {/* Footer in two (round 3): the exit to the provider on the left, the local gesture on the
          right. They do different things (one really revokes, the other forgets), and side by side
          the choice reads. `wrap`: when narrow, each takes its own line rather than truncating. */}
      <Row gap={8} wrap justify="space-between">
        {revokeUrl !== null ? (
          <Link href={revokeUrl} target="_blank" rel="noreferrer">
            {T.disconnectRevoke(name)}
          </Link>
        ) : (
          <span />
        )}
        <ConfirmAction
          label={T.disconnect}
          confirmLabel={T.disconnectConfirm}
          // What confirming does, not the sentence shown just above: a screen reader would hear it
          // twice and learn nothing about the arming.
          announce={T.disconnectArmed(name)}
          leading={<Unplug size={13} />}
          size="sm"
          loading={busy}
          onConfirm={onConfirm}
        />
      </Row>
    </Stack>
  );
}

/** Is this flow this tile's? Written once: the same condition copied in three places is how two
 *  of them end up diverging. */
function mine(connection: Connection, flow: OpenFlow | null): flow is OpenFlow {
  return flow !== null && flow.provider === connection.provider;
}

/** The tile state. The switch on `kind` lives here, not in `ui/`: the design-system component
 *  receives a state and does not need to know OAuth families. */
function connectState(connection: Connection, flow: OpenFlow | null): ConnectState {
  if (connection.connected) return CONNECT_STATE.connected;
  if (!mine(connection, flow)) return CONNECT_STATE.ready;
  return flow.kind === FLOW_KIND.device
    ? CONNECT_STATE.awaitingCode
    : CONNECT_STATE.awaitingRedirect;
}

/** Where the operator is sent, whatever the family: the verification page for a device grant, the
 *  consent page for a redirect. */
function openUri(flow: OpenFlow): string {
  return flow.kind === FLOW_KIND.device ? flow.verificationUri : flow.authorizeUrl;
}

export function ConnectionsCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [flow, setFlow] = useState<OpenFlow | null>(null);
  /** The provider whose token is being adopted: the probe is on the network and the button must
   *  say so. `null` otherwise. */
  const [adopting, setAdopting] = useState<ProviderKind | null>(null);
  /** The provider being disconnected. Same reason as `adopting`: the button must show the pending
   *  call rather than stay inert under a second click. */
  const [forgetting, setForgetting] = useState<ProviderKind | null>(null);
  /** What the operator typed in the field the provider asks for: the GitLab instance today.
   *
   *  Per provider, because the card shows three side by side. Absent from the table = not touched
   *  yet: the tile shows the server's `suggestion`, and that is what is sent. A `""` typed by the
   *  operator is therefore distinct from "nothing typed", on purpose: a field emptied by hand must
   *  be refused by name rather than fall back to a value that was not shown. */
  const [typed, setTyped] = useState<Partial<Record<ProviderKind, string>>>({});
  const { data, isError, error, refetch } = useQuery({
    queryKey: qk.connections(project.id),
    queryFn: () => connectionsApi.list(project.id),
    staleTime: LIST_STALE_MS,
  });

  // Polling. The provider sets the pace; `slow_down` stretches it rather than giving up, the only
  // way not to get a flow rejected that was about to succeed.
  useEffect(() => {
    // Only the device family polls. A redirect flow has nothing to ask: the browser comes back and
    // the server concludes, and there is no `intervalMs` to read.
    if (!flow || flow.kind !== FLOW_KIND.device) return;
    let cancelled = false;
    let delay = flow.intervalMs;
    // Counts consecutive transport failures (those landing in `catch`, not the ones the server
    // names, `denied`, `expired`), to warn only once: a toast per retry would be unbearable, and
    // the flow stays open while retrying.
    let transportFailures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      // The real exit when the server is unreachable. Nothing else ends the flow on its own:
      // without it, a server that never answers would poll forever with an expired code, shown as
      // if still valid.
      if (Date.now() >= flow.expiresAt) {
        setFlow(null);
        push({ tone: "bad", title: T.failed, body: T.expired });
        return;
      }
      try {
        const { status } = await connectionsApi.poll(flow.provider, flow.flowId);
        if (cancelled) return;
        transportFailures = 0;
        if (status === FLOW_STATUS.connected) {
          setFlow(null);
          void qc.invalidateQueries({ queryKey: qk.connections(project.id) });
          // The token became a project secret. The Secrets card reads another key and would not
          // know it changed: without this line, the operator finds a list without `GITHUB_TOKEN`.
          void qc.invalidateQueries({ queryKey: qk.secrets });
          return;
        }
        if (status === FLOW_STATUS.denied || status === FLOW_STATUS.expired) {
          setFlow(null);
          push({
            tone: "bad",
            title: T.failed,
            body: status === FLOW_STATUS.denied ? T.denied : T.expired,
          });
          return;
        }
        if (status === FLOW_STATUS.slowDown) delay += SLOW_DOWN_STEP_MS;
        timer = setTimeout(() => void tick(), delay);
      } catch (e) {
        if (cancelled) return;
        // A transport incident is not a flow failure (operator's decision, correcting the original
        // brief that destroyed the flow here). The server returns `pending` for a provider hiccup,
        // so this path only fires when our own server is down. Destroying the flow would throw away
        // one that could succeed; the `expiresAt` check at the top of `tick` ends it if the server
        // stays unreachable. Keep polling at the same pace, and warn only on the first failure.
        transportFailures += 1;
        if (transportFailures === 1) {
          push({ tone: "bad", title: T.transportHiccup, body: (e as Error).message });
        }
        timer = setTimeout(() => void tick(), delay);
      }
    };
    timer = setTimeout(() => void tick(), delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flow, project.id, qc, push]);

  /** The value sent by both gestures: what the operator typed, or what the tile showed. Read once:
   *  the button and the paste must present the same instance. */
  const fieldOf = (connection: Connection): string | undefined =>
    connection.field ? (typed[connection.provider] ?? connection.field.suggestion) : undefined;

  const start = (provider: ProviderKind, field?: string) =>
    connectionsApi
      .start(provider, project.id, field)
      .then((started) => setFlow({ ...started, provider }))
      .catch((e: Error) => push({ tone: "bad", title: T.failed, body: e.message }));

  // Pasting a token. No flow to follow: the server probes, stores if the provider recognized it,
  // refuses otherwise. The list is refetched either way: it holds the state, not this response.
  const adopt = (provider: ProviderKind, token: string, field?: string) => {
    setAdopting(provider);
    void connectionsApi
      .adopt(provider, project.id, token, field)
      .then(() => {
        void qc.invalidateQueries({ queryKey: qk.connections(project.id) });
        // The token became a project secret; the Secrets card reads another key. Same as after a flow.
        void qc.invalidateQueries({ queryKey: qk.secrets });
        push({ tone: "ok", title: T.pasteOk(providerName(provider)) });
      })
      .catch((e: Error) => push({ tone: "bad", title: T.failed, body: e.message }))
      .finally(() => setAdopting(null));
  };

  // Disconnecting, that is, forgetting the token on Legion's side. Same invalidations as after an
  // acquisition: the row leaves `secrets`, so the Secrets card would still show a gone name.
  const forget = (provider: ProviderKind) => {
    setForgetting(provider);
    void connectionsApi
      .forget(provider, project.id)
      .then(() => {
        void qc.invalidateQueries({ queryKey: qk.connections(project.id) });
        void qc.invalidateQueries({ queryKey: qk.secrets });
        push({ tone: "ok", title: T.disconnectOk(providerName(provider)) });
      })
      .catch((e: Error) => push({ tone: "bad", title: T.failed, body: e.message }))
      .finally(() => setForgetting(null));
  };

  const connections = data?.connections ?? [];

  return (
    <Card pad={false}>
      <CardBody>
        <CardHeader icon={<Plug size={16} />} title={T.title} />
        <CardDescription>{T.description}</CardDescription>
        {isError ? (
          <ErrorState
            title={T.loadFailedTitle}
            detail={error instanceof Error ? error.message : String(error)}
            actions={
              <Button variant="primary" leading={<RefreshCw size={13} />} onClick={() => refetch()}>
                {T.retry}
              </Button>
            }
          >
            {T.loadFailedWhy}
          </ErrorState>
        ) : (
          <Stack gap={12}>
            {/* `data &&`: a list not back yet is not an empty list. Without this guard the first
                render claims no provider is declared. */}
            {data && connections.length === 0 && <Caption>{T.empty}</Caption>}
            <div className="connections-grid">
              {connections.map((connection) => {
                const name = providerName(connection.provider);
                const state = connectState(connection, flow);
                const field = fieldOf(connection);
                return (
                  <ConnectTile
                    key={connection.provider}
                    mark={providerMark(connection.provider, name)}
                    name={name}
                    subtitle={T.providerSubtitle[connection.provider]}
                    state={state}
                    stateLabel={stateLabelOf(state, connection.origin)}
                    userCode={
                      mine(connection, flow) && flow.kind === FLOW_KIND.device
                        ? flow.userCode
                        : undefined
                    }
                    openHref={mine(connection, flow) ? openUri(flow) : undefined}
                    openLabel={T.open(name)}
                    hint={
                      mine(connection, flow) && flow.kind === FLOW_KIND.redirect
                        ? T.awaitingRedirectHint
                        : T.awaitingHint
                    }
                    connectLabel={T.connect(name)}
                    // The access recorded at acquisition, `null` when nobody knows it. No longer
                    // read from `renewable`: a GitHub connection is not renewable yet its scopes
                    // are known.
                    scopes={connection.scopes ? describeScopes(connection.scopes) : undefined}
                    scopesLabel={
                      connection.origin === TOKEN_ORIGIN.pasted ? T.scopesPasted : T.scopesGranted
                    }
                    note={connectionNote(connection)}
                    // Only on a connected tile: there is nothing to forget on an idle one, and a
                    // disabled button there would promise nothing.
                    actions={
                      connection.connected ? (
                        <DisconnectGesture
                          revokeUrl={connection.revokeUrl}
                          name={name}
                          busy={forgetting === connection.provider}
                          onConfirm={() => forget(connection.provider)}
                        />
                      ) : undefined
                    }
                    onStart={() => start(connection.provider, field)}
                    // The field the provider asks for, when it asks for one. The label comes from
                    // the server: this screen does not know what a GitLab instance is, it shows
                    // what the descriptor declared, as it shows `unconfigured`.
                    extra={
                      connection.field && field !== undefined
                        ? {
                            label: connection.field.label,
                            dividerLabel: T.instanceDivider,
                            value: field,
                            onChange: (value) =>
                              setTyped((t) => ({ ...t, [connection.provider]: value })),
                          }
                        : undefined
                    }
                    // The configuration refusal reads before the click. It used to come from a
                    // failing `POST`: the button promised a gesture that did not exist.
                    startBlocked={blockedOf(connection.unconfigured)}
                    pasteDividerLabel={T.pasteDivider(connection.provider)}
                    paste={{
                      fieldLabel: pasteText(connection.provider).field,
                      placeholder: pasteText(connection.provider).placeholder,
                      submitLabel: T.pasteSubmit,
                      busy: adopting === connection.provider,
                      onSubmit: (token) => adopt(connection.provider, token, field),
                    }}
                  />
                );
              })}
            </div>
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}
