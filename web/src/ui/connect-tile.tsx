// A provider tile: its mark, name, state and the matching gesture.
//
// It knows neither providers nor flows: it receives a mark for its slot, sentences and two
// gestures (`ui-knows-no-domain`). The state enumeration therefore lives here, not in `api/`,
// which this folder may not import; the domain card reads it.
//
// Four states, not a boolean: waiting for a code and waiting for a browser redirect ask for
// different gestures, and a `loading` flag would make the caller guess which one it is.
//
// The mark is a slot: the tile only imposes its box. Color belongs to the drawing since round 3;
// tinting a logo by connection state made a connected GitLab green.
import { useState, type ReactNode } from "react";
import { Button } from "./button.js";
import { Divider } from "./divider.js";
import { StatusChip, Tag, type ChipState } from "./chip.js";
import { Row, Stack } from "./flex.js";
import { Input } from "./input.js";
import { safeHref } from "./safe-href.js";
import { isSubmitKey } from "./submit-key.js";
import { SubmitShortcut } from "./submit-shortcut.js";
import { Caption, Label, Text } from "./text.js";
import "./connect-tile.css";

/** Follows the server's union instead of flattening it. `awaitingCode`: the operator types a code
 *  elsewhere (device flow). `awaitingRedirect`: they follow a link and come back on their own. Two
 *  gestures, two texts; a single `awaiting` would force guessing from the presence of a field. */
export const CONNECT_STATE = {
  ready: "ready",
  awaitingCode: "awaiting-code",
  awaitingRedirect: "awaiting-redirect",
  connected: "connected",
} as const;
export const CONNECT_STATES = [
  CONNECT_STATE.ready,
  CONNECT_STATE.awaitingCode,
  CONNECT_STATE.awaitingRedirect,
  CONNECT_STATE.connected,
] as const;
export type ConnectState = (typeof CONNECT_STATES)[number];

/** Rendered only when the URL has an allowed scheme. `safeHref` because `verification_uri` comes
 *  from the provider's response. A refused URL removes the link; the code stays shown, and it is
 *  enough to finish. */
function OpenLink({ href, label }: { href?: string; label: string }) {
  const safe = href ? safeHref(href) : undefined;
  if (!safe) return null;
  return (
    <a
      className="ui-btn ui-connect-open"
      data-variant="primary"
      data-size="md"
      href={safe}
      target="_blank"
      rel="noreferrer"
    >
      {label}
    </a>
  );
}

/** Design system vocabulary: `ChipState` is shared by every chip in the product, a connection
 *  tile needs no third state language. */
const CHIP_OF_STATE: Record<ConnectState, ChipState> = {
  [CONNECT_STATE.ready]: "idle",
  [CONNECT_STATE.awaitingCode]: "wait",
  [CONNECT_STATE.awaitingRedirect]: "wait",
  [CONNECT_STATE.connected]: "ok",
};

/** The tile's second gesture: paste a value instead of fetching it. This folder knows no PAT or
 *  OAuth app, only the shape: a masked field and a submit.
 *
 *  Always visible since round 3: behind a toggle it was a gesture to discover before reaching
 *  the real one. The `placeholder` shows the expected token shape (`ghp_…`) faster than any
 *  sentence. */
type PasteGesture = {
  fieldLabel: string;
  placeholder: string;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (value: string) => void;
};

function PasteValue({
  fieldLabel,
  placeholder,
  submitLabel,
  busy = false,
  onSubmit,
  named,
}: PasteGesture & { named: boolean }) {
  const [value, setValue] = useState("");
  const ready = value.trim().length > 0;
  const submit = () => {
    if (ready) onSubmit(value.trim());
  };
  return (
    <Stack gap={6}>
      {/* The token name is written once (round 5): when a titled divider carries it, repeating it
          here wrote it twice two lines apart. The field always keeps its `aria-label`. Without a
          divider the label comes back: the caller chooses where the name is written, not
          whether. */}
      {named && <Label>{fieldLabel}</Label>}
      {/* type=password: a secret must not stay readable on screen or end up in a screenshot. The
          value is not cleared on submit, otherwise a server refusal leaves nothing to retry; it
          goes away with the component when the tile changes state. */}
      <Input
        type="password"
        aria-label={fieldLabel}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitKey(e)) submit();
        }}
      />
      {/* Same shortcut as everywhere a secret is entered (`ui/submit-key.ts`): Enter alone does
          not send. `default`, not `primary`: the tile's accent belongs to the recommended
          "Connect". */}
      <Button loading={busy} disabled={!ready} onClick={submit} shortcut={<SubmitShortcut />}>
        {submitLabel}
      </Button>
    </Stack>
  );
}

/** What is missing for the main gesture to exist. Three parts because they read differently:
 *  `code` is what to set (a variable name, a setting), mono and ready to copy; `detail` says what
 *  it unlocks; `configure` leads where to set it, when such a place exists.
 *
 *  The link stays optional: a "Configure →" to a page that does not mention the setting is worse
 *  than no link, same rule as the revoke link next to it. */
type StartBlocked = {
  code: string;
  detail?: string;
  configure?: { label: string; href: string };
};

function BlockedNotice({ code, detail, configure }: StartBlocked) {
  return (
    <div className="ui-connect-blocked" role="note">
      <div className="ui-connect-blocked-body">
        <code className="ui-connect-blocked-code">{code}</code>
        {detail !== undefined && <Caption>{detail}</Caption>}
      </div>
      {configure !== undefined && (
        <a
          className="ui-connect-blocked-link"
          href={safeHref(configure.href) ?? undefined}
          target="_blank"
          rel="noreferrer"
        >
          {configure.label}
        </a>
      )}
    </div>
  );
}

/** A value the provider requires on top of the token, used by both gestures. `dividerLabel` is
 *  the divider announcing it ("Another instance?"), from the domain like `label`. `label` is no
 *  longer shown: it names the field for assistive tech, while the divider carries the visible
 *  name. */
type ExtraField = {
  label: string;
  dividerLabel: string;
  value: string;
  onChange: (value: string) => void;
};

/** A separate component because it has its own ordering rules, and keeping it in `ConnectTile`
 *  pushed that one over the linter's complexity ceiling. */
function ReadyGestures({
  connectLabel,
  onStart,
  startBlocked,
  extra,
  paste,
  pasteDividerLabel,
}: {
  connectLabel: string;
  onStart: () => void;
  startBlocked?: StartBlocked;
  extra?: ExtraField;
  paste?: PasteGesture;
  pasteDividerLabel?: string;
}) {
  return (
    <>
      <Button onClick={onStart} disabled={startBlocked !== undefined}>
        {connectLabel}
      </Button>
      {/* The required field is announced by a divider (round 8), the same shape as the second
            path below. It replaces a disclosure that took a click to show an already-filled
            field. */}
      {extra !== undefined && (
        <Stack gap={6}>
          <Divider label={extra.dividerLabel} labelCase="sentence" space="none" />
          <Input
            type="text"
            aria-label={extra.label}
            value={extra.value}
            onChange={(e) => extra.onChange(e.target.value)}
          />
        </Stack>
      )}
      <div className="ui-connect-foot">
        <Stack gap={10}>
          {paste && pasteDividerLabel === undefined && <PasteValue {...paste} named />}
          {paste && pasteDividerLabel !== undefined && (
            <>
              {/* The divider says "or", not "then" (round 5): without it the field read as a next
                    step after the button. */}
              <Divider label={pasteDividerLabel} labelCase="sentence" space="none" />
              <PasteValue {...paste} named={false} />
            </>
          )}
          {/* Moved to the foot in round 5. The button stays disabled: only its reason moves. */}
          {startBlocked !== undefined && <BlockedNotice {...startBlocked} />}
        </Stack>
      </div>
    </>
  );
}

export function ConnectTile({
  mark,
  name,
  subtitle,
  state,
  stateLabel,
  userCode,
  openHref,
  openLabel,
  hint,
  connectLabel,
  scopes,
  scopesLabel,
  note,
  actions,
  onStart,
  startBlocked,
  extra,
  paste,
  pasteDividerLabel,
}: {
  /** The tile gives it a box; color belongs to the drawing (round 3). */
  mark: ReactNode;
  name: string;
  /** What this provider brings, in a few words under its name: a product name alone does not say
   *  what you gain. */
  subtitle?: string;
  state: ConnectState;
  /** The state in words: the dot tells nothing to someone who cannot see color. */
  stateLabel: string;
  /** Only in `awaitingCode`. */
  userCode?: string;
  /** Verification page in `device`, consent page in `redirect`. Named by what it does here, not
   *  after the device-flow field (`verification_uri`). */
  openHref?: string;
  openLabel: string;
  hint?: string;
  connectLabel: string;
  /** Already worded by the domain. `label` is read; `title` carries the provider's raw value as a
   *  tooltip, the one you look for when comparing with the consent screen. Empty when unknown. */
  scopes?: readonly { label: string; title: string }[];
  scopesLabel: string;
  note?: ReactNode;
  /** A slot rather than labels: what goes here is destructive, so a caller-composed
   *  `ConfirmAction` plus the sentence saying what it really does. Anchored at the bottom like the
   *  paste (`ui-connect-foot`) so tiles align when notes differ in length. */
  actions?: ReactNode;
  onStart: () => void;
  /** Present = the button is disabled and the notice shows. A dead button without a reason is a
   *  dead end; with it, the other path visibly stays open. */
  startBlocked?: StartBlocked;
  /** Above both gestures, not in the paste fallback: the button needs it too (a GitLab device
   *  flow targets an instance, and paste presents the token to the same one).
   *
   *  One field, not a list: `paste` and `actions` are already this tile's two slots and its
   *  ceiling; N declared fields would make it a form layout. When a second provider needs two,
   *  discuss this sentence rather than work around it.
   *
   *  Plain, not masked unlike `paste`: an instance URL or public id is not a secret, and masking
   *  it would suggest otherwise. */
  extra?: ExtraField;
  paste?: PasteGesture;
  /** E.g. "or via Personal Access Token". Names the provider's token, so it comes from the domain.
   *  Absent = no divider. */
  pasteDividerLabel?: string;
}) {
  const awaiting = state === CONNECT_STATE.awaitingCode || state === CONNECT_STATE.awaitingRedirect;
  return (
    <div className="ui-connect-tile" data-state={state}>
      {/* The badge replaced a dot plus sentence (round 3): the product's usual state shape, read at
          a glance in the same place in all three tiles. */}
      <Row gap={10} align="flex-start">
        <span className="ui-connect-mark" aria-hidden="true">
          {mark}
        </span>
        <Stack gap={2} flex={1} minWidth={0}>
          <Text weight="medium">{name}</Text>
          {subtitle !== undefined && <Caption>{subtitle}</Caption>}
        </Stack>
        <StatusChip state={CHIP_OF_STATE[state]} size="sm">
          {stateLabel}
        </StatusChip>
      </Row>
      {state === CONNECT_STATE.awaitingCode && userCode !== undefined && (
        <span className="ui-connect-code">{userCode}</span>
      )}
      {awaiting && (
        <Stack gap={8}>
          <OpenLink href={openHref} label={openLabel} />
          {hint !== undefined && <Caption>{hint}</Caption>}
        </Stack>
      )}
      {state === CONNECT_STATE.ready && (
        <ReadyGestures
          connectLabel={connectLabel}
          onStart={onStart}
          startBlocked={startBlocked}
          extra={extra}
          paste={paste}
          pasteDividerLabel={pasteDividerLabel}
        />
      )}
      {state === CONNECT_STATE.connected && scopes !== undefined && scopes.length > 0 && (
        <Stack gap={6}>
          <Label>{scopesLabel}</Label>
          <Row gap={4} wrap>
            {scopes.map((scope) => (
              <Tag key={scope.title} title={scope.title}>
                {scope.label}
              </Tag>
            ))}
          </Row>
        </Stack>
      )}
      {note}
      {actions !== undefined && <div className="ui-connect-foot">{actions}</div>}
    </div>
  );
}
