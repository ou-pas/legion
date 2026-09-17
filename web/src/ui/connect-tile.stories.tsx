// The connection tile's four states, plus those nobody guesses: a code wait whose opening URL is
// missing or was refused by `safeHref` (the code shows alone and is enough to finish), a connected
// tile with unknown scopes, and BOTH PATHS of one tile, the button and the paste field (both
// visible since round 3), then the button off with the notice saying what is missing.
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plug, Unplug } from "lucide-react";
import { ConfirmAction } from "./confirm-action.js";
import { CONNECT_STATE, ConnectTile } from "./connect-tile.js";
import { Stack } from "./flex.js";
import { Caption } from "./text.js";

const meta = { title: "ui / ConnectTile" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** The brand slot as the domain fills it: the fallback icon here, so no design system story
 *  depends on a logo file owned by the domain. */
const mark = <Plug />;

export const Ready: Story = {
  name: "ready to connect",
  render: () => (
    <ConnectTile
      mark={mark}
      name="GitHub"
      state={CONNECT_STATE.ready}
      stateLabel="Not yet connected"
      openLabel="Open GitHub"
      connectLabel="Connect GitHub"
      scopesLabel="Access requested"
      onStart={() => {}}
    />
  ),
};

export const WaitingForCode: Story = {
  name: "waiting — the code to type",
  render: () => (
    <ConnectTile
      mark={mark}
      name="GitHub"
      state={CONNECT_STATE.awaitingCode}
      stateLabel="Waiting — type the code"
      userCode="WXYZ-1234"
      openHref="https://github.com/login/device"
      openLabel="Open GitHub"
      hint="Type this code on GitHub, then come back here — the page updates on its own."
      connectLabel="Connect GitHub"
      scopesLabel="Access requested"
      onStart={() => {}}
    />
  ),
};

export const WaitingForRedirect: Story = {
  name: "waiting — the redirect",
  render: () => (
    <ConnectTile
      mark={mark}
      name="Linear"
      state={CONNECT_STATE.awaitingRedirect}
      stateLabel="Waiting — authorize with the provider"
      openHref="https://linear.app/oauth/authorize?client_id=demo"
      openLabel="Authorize on Linear"
      hint="Authorize Legion on Linear, you'll come back here on your own."
      connectLabel="Connect Linear"
      scopesLabel="Access requested"
      onStart={() => {}}
    />
  ),
};

export const WaitingForCodeWithoutLink: Story = {
  name: "waiting — a code, with no open link",
  render: () => (
    <ConnectTile
      mark={mark}
      name="GitHub"
      state={CONNECT_STATE.awaitingCode}
      stateLabel="Waiting — type the code"
      userCode="WXYZ-1234"
      openLabel="Open GitHub"
      hint="Type this code on GitHub."
      connectLabel="Connect GitHub"
      scopesLabel="Access requested"
      onStart={() => {}}
    />
  ),
};

export const WaitingForRedirectWithoutLink: Story = {
  name: "waiting on a redirect — with no open link (missing or refused by safeHref)",
  render: () => (
    <ConnectTile
      mark={mark}
      name="Linear"
      state={CONNECT_STATE.awaitingRedirect}
      stateLabel="Waiting — authorize with the provider"
      openLabel="Authorize on Linear"
      hint="Authorize Legion on Linear, you'll come back here on your own."
      connectLabel="Connect Linear"
      scopesLabel="Access requested"
      onStart={() => {}}
    />
  ),
};

export const Connected: Story = {
  name: "connected — the mark turns green, the scopes are readable",
  render: () => (
    <ConnectTile
      mark={mark}
      name="GitHub"
      state={CONNECT_STATE.connected}
      stateLabel="Connected"
      openLabel=""
      connectLabel="Connect GitHub"
      scopes={[
        { label: "Repos: read and write", title: "repo" },
        { label: "Organizations: read", title: "read:org" },
        { label: "Email addresses: read", title: "user:email" },
      ]}
      scopesLabel="Access requested"
      onStart={() => {}}
    />
  ),
};

export const ConnectedWithoutScopes: Story = {
  name: "connected, unknown scopes — a token pasted in by hand",
  render: () => (
    <ConnectTile
      mark={mark}
      name="GitHub"
      state={CONNECT_STATE.connected}
      stateLabel="Connected"
      openLabel=""
      connectLabel="Connect GitHub"
      scopesLabel="Access requested"
      note="Pasted in by hand — Legion won't be able to renew it."
      onStart={() => {}}
    />
  ),
};

export const ReadyWithPaste: Story = {
  name: "ready — both paths visible, the button leads",
  render: () => (
    <ConnectTile
      mark={mark}
      name="GitHub"
      state={CONNECT_STATE.ready}
      stateLabel="Not yet connected"
      openLabel="Open GitHub"
      connectLabel="Connect GitHub"
      scopesLabel="Access requested"
      pasteDividerLabel="or via Personal Access Token"
      paste={{
        fieldLabel: "Personal Access Token",
        placeholder: "ghp_…",
        submitLabel: "Connect this token",
        onSubmit: () => {},
      }}
      onStart={() => {}}
    />
  ),
};

/** The field the provider requires besides the token, used by BOTH gestures: a GitLab device flow
 *  opens ON an instance, and the paste presents the token to the same one. Hence it sits above
 *  both, not in the paste collapsible.
 *
 *  `render: function Render()` because the story has state: an anonymous arrow is not a component
 *  for `react-hooks`. */
export const ReadyWithRequiredField: Story = {
  name: "ready — a field the provider requires, above both gestures",
  render: function Render() {
    const [host, setHost] = useState("https://gitlab.com");
    return (
      <ConnectTile
        mark={mark}
        name="GitLab"
        state={CONNECT_STATE.ready}
        stateLabel="Not yet connected"
        openLabel="Open GitLab"
        connectLabel="Connect GitLab"
        scopesLabel="Access requested"
        extra={{
          label: "GitLab instance URL",
          dividerLabel: "A different instance?",
          value: host,
          onChange: setHost,
        }}
        pasteDividerLabel="or via Personal Access Token"
        paste={{
          fieldLabel: "Personal Access Token",
          placeholder: "glpat_…",
          submitLabel: "Connect this token",
          onSubmit: () => {},
        }}
        onStart={() => {}}
      />
    );
  },
};

/** The field stays live when the button is dead: the app is not declared so the button is off,
 *  but the paste needs the instance as much, since it presents the token to a server, not an app. */
export const RequiredFieldWithButtonOff: Story = {
  name: "the required field survives the disabled button — paste needs it too",
  render: function Render() {
    const [host, setHost] = useState("https://framagit.org");
    return (
      <ConnectTile
        mark={mark}
        name="GitLab"
        state={CONNECT_STATE.ready}
        stateLabel="Not yet connected"
        openLabel="Open GitLab"
        connectLabel="Connect GitLab"
        scopesLabel="Access requested"
        startBlocked={{
          code: "LEGION_GITLAB_CLIENT_ID",
          detail: "required, and the instance still needs declaring below",
        }}
        extra={{
          label: "GitLab instance URL",
          dividerLabel: "A different instance?",
          value: host,
          onChange: setHost,
        }}
        pasteDividerLabel="or via Personal Access Token"
        paste={{
          fieldLabel: "Personal Access Token",
          placeholder: "glpat_…",
          submitLabel: "Connect this token",
          onSubmit: () => {},
        }}
        onStart={() => {}}
      />
    );
  },
};

export const MainGestureOff: Story = {
  name: "the main gesture is disabled — the note says what's missing, paste stays open",
  render: () => (
    <ConnectTile
      mark={mark}
      name="Linear"
      state={CONNECT_STATE.ready}
      stateLabel="Not yet connected"
      openLabel="Open Linear"
      connectLabel="Connect Linear"
      scopesLabel="Access requested"
      startBlocked={{
        code: "LEGION_LINEAR_CLIENT_ID",
        detail: "required — redirect URL: https://legion.exemple.test/api/connections/callback",
      }}
      pasteDividerLabel="or via Personal API Key"
      paste={{
        fieldLabel: "Personal API Key",
        placeholder: "lin_api_…",
        submitLabel: "Connect this token",
        onSubmit: () => {},
      }}
      onStart={() => {}}
    />
  ),
};

export const PasteInProgress: Story = {
  name: "the pasted token is being probed — the button waits on the provider",
  render: () => (
    <ConnectTile
      mark={mark}
      name="Linear"
      state={CONNECT_STATE.ready}
      stateLabel="Not yet connected"
      openLabel="Open Linear"
      connectLabel="Connect Linear"
      scopesLabel="Access requested"
      startBlocked={{ code: "LEGION_PUBLIC_URL", detail: "required for OAuth" }}
      pasteDividerLabel="or via Personal API Key"
      paste={{
        fieldLabel: "Personal API Key",
        placeholder: "lin_api_…",
        submitLabel: "Connect this token",
        busy: true,
        onSubmit: () => {},
      }}
      onStart={() => {}}
    />
  ),
};

export const ConnectedWithNote: Story = {
  name: "connected — the note says where the token came from and what's unknown about it",
  render: () => (
    <ConnectTile
      mark={mark}
      name="GitHub"
      state={CONNECT_STATE.connected}
      stateLabel="Connected"
      openLabel=""
      connectLabel="Connect GitHub"
      scopesLabel="Access observed"
      note="Pasted token — the provider doesn't know Legion exists."
      onStart={() => {}}
    />
  ),
};

export const ConnectedWithGesture: Story = {
  name: "connected — the bottom gesture, and the admission that goes with it",
  render: () => (
    <ConnectTile
      mark={mark}
      name="GitHub"
      state={CONNECT_STATE.connected}
      stateLabel="Connected"
      openLabel=""
      connectLabel="Connect GitHub"
      scopesLabel="Access observed"
      note="Account: mona · This token since September 15, 2026"
      actions={
        <Stack gap={6}>
          <ConfirmAction
            label="Disconnect"
            confirmLabel="Forget this token?"
            leading={<Unplug size={13} />}
            size="sm"
            onConfirm={() => {}}
          />
          {/* The admission is permanent, not reserved to the armed state: a truth arriving only
              after starting a security gesture arrives too late. Six words (round 4): the
              revocation link says the rest by being there. */}
          <Caption>Disconnecting doesn't revoke the token.</Caption>
        </Stack>
      }
      onStart={() => {}}
    />
  ),
};

/** The subtitle (round 3): what the provider brings the project, under its name. The tile said
 *  "GitHub" and nothing else; a product name does not say what one gains. */
export const WithSubtitle: Story = {
  name: "with its subtitle — what the provider brings",
  render: () => (
    <ConnectTile
      mark={mark}
      name="GitHub"
      subtitle="Repos, pull requests & webhooks"
      state={CONNECT_STATE.ready}
      stateLabel="Not yet connected"
      openLabel="Open GitHub"
      connectLabel="Connect GitHub"
      scopesLabel="Access requested"
      pasteDividerLabel="or via Personal Access Token"
      paste={{
        fieldLabel: "Personal Access Token",
        placeholder: "ghp_…",
        submitLabel: "Connect this token",
        onSubmit: () => {},
      }}
      onStart={() => {}}
    />
  ),
};

/** The notice without detail: what is missing is not always a variable followed by an
 *  explanation. "GitLab instance URL required" reads as one block, and splitting it would have put
 *  "URL" in mono and the rest below. */
export const RefusalWithoutDetail: Story = {
  name: "what's missing fits on one line — nothing to put below",
  render: () => (
    <ConnectTile
      mark={mark}
      name="GitLab"
      subtitle="GitLab Cloud & self-hosted"
      state={CONNECT_STATE.ready}
      stateLabel="Not yet connected"
      openLabel="Open GitLab"
      connectLabel="Connect GitLab"
      scopesLabel="Access requested"
      startBlocked={{ code: "GitLab instance URL required" }}
      pasteDividerLabel="or via Personal Access Token"
      paste={{
        fieldLabel: "Personal Access Token",
        placeholder: "glpat_…",
        submitLabel: "Connect this token",
        onSubmit: () => {},
      }}
      onStart={() => {}}
    />
  ),
};

/** The notice's "Configure" link: the slot exists and the design system must show it. No provider
 *  fills it today: these settings live in `server/.env` and no product page describes them. A
 *  link to a page that does not talk about the setting is worth less than no link, same rule as
 *  the revocation link, which disappears when the page is unknown. */
export const RefusalWithConfigureLink: Story = {
  name: "the note with its exit — when the domain knows where the setting leads",
  render: () => (
    <ConnectTile
      mark={mark}
      name="Linear"
      subtitle="Tickets, cycles & roadmap"
      state={CONNECT_STATE.ready}
      stateLabel="Not yet connected"
      openLabel="Open Linear"
      connectLabel="Connect Linear"
      scopesLabel="Access requested"
      startBlocked={{
        code: "LEGION_PUBLIC_URL",
        detail: "required for OAuth",
        configure: { label: "Configure →", href: "https://legion.exemple.test/wiki" },
      }}
      pasteDividerLabel="or via Personal API Key"
      paste={{
        fieldLabel: "Personal API Key",
        placeholder: "lin_api_…",
        submitLabel: "Connect this token",
        onSubmit: () => {},
      }}
      onStart={() => {}}
    />
  ),
};

/** The connected tile as the domain composes it (round 3): the acquisition mode with its icon, the
 *  date, then in the footer the exit to the provider and the local gesture. */
export const ConnectedFull: Story = {
  name: "connected — the mode, the date, and both exits in the footer",
  render: () => (
    <ConnectTile
      mark={mark}
      name="GitLab"
      subtitle="GitLab Cloud & self-hosted"
      state={CONNECT_STATE.connected}
      stateLabel="Connected token"
      openLabel="Open GitLab"
      connectLabel="Connect GitLab"
      scopesLabel="Access observed"
      scopes={[{ label: "API: read and write", title: "api" }]}
      note={
        <Stack gap={4}>
          <Caption>Connected via Personal Access Token</Caption>
          <Caption>rjeanjean</Caption>
          <Caption>since Sep 16, 2026</Caption>
        </Stack>
      }
      actions={
        <Stack gap={6}>
          <Caption>Disconnecting doesn't revoke the token.</Caption>
          <ConfirmAction
            label="Disconnect"
            confirmLabel="Forget this token"
            announce="Confirming removes the GitLab token from this project."
            leading={<Unplug size={13} />}
            size="sm"
            onConfirm={() => {}}
          />
        </Stack>
      }
      onStart={() => {}}
    />
  ),
};

/** Paste without a divider: the other half of the "never a field without a visible name" rule.
 *
 *  When a titled divider carries the token name, the field label disappears: writing it twice two
 *  lines apart is what round 5 fixed. Without a divider it comes BACK. The caller chooses WHERE
 *  the name is written, never whether. */
export const PasteWithoutDivider: Story = {
  name: "paste with no divider — the field label comes back",
  render: () => (
    <ConnectTile
      mark={mark}
      name="GitHub"
      subtitle="Repos, pull requests & webhooks"
      state={CONNECT_STATE.ready}
      stateLabel="Not yet connected"
      openLabel="Open GitHub"
      connectLabel="Connect GitHub"
      scopesLabel="Access requested"
      paste={{
        fieldLabel: "Personal Access Token",
        placeholder: "ghp_…",
        submitLabel: "Connect this token",
        onSubmit: () => {},
      }}
      onStart={() => {}}
    />
  ),
};
