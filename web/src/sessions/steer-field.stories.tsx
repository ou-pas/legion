// Talking to a RUNNING session without stopping it (v23). Pure presentation: the field holds
// the typing, the caller talks to the server, the refusal rule lives in the control plane. The
// last three specimens are real: click Send to see the state. The refusal shown is the exact
// body of the 409, written for a human.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { SteerField } from "./steer-field.js";

import { Stack } from "../ui/flex.js";
import { CHANNELS_TEXT } from "../channels/text.js";
// The "secondary" modifier belongs to the page that places this field (channels), which knows a
// question is waiting elsewhere on screen. The story imports it from there rather than copying
// two rules into the sessions domain.
import "../channels/channels-page.css";

const meta = { title: "sessions / SteerField" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** The three outcomes of a steering send, as the control plane really returns them. The refusal
 *  is the exact body of the 409 from `POST /api/sessions/:id/steer`
 *  (server/src/sessions/steering.ts): that sentence is what the operator must read. */
const steerAccepted = () => Promise.resolve({ ok: true as const });

const steerRefused = () =>
  Promise.reject(
    new Error(
      "the session is paused on its question: its runtime is destroyed. Answer the inbox question — it's the same path",
    ),
  );

const steerPending = () => new Promise<void>(() => {}); // never resolves: the "sending" state

export const AtRestButtonNeverSendsEmpty: Story = {
  name: "at rest — the button doesn't send empty",
  render: () => (
    <Stack gap={10}>
      <SteerField onSend={steerAccepted} agentName="senior-dev" />
    </Stack>
  ),
};

export const ReadyToSend: Story = {
  name: "ready to send — text typed, the button activates",
  render: () => (
    <Stack gap={10}>
      <SteerField
        onSend={steerAccepted}
        agentName="senior-dev"
        defaultText="change course: go with option B"
      />
    </Stack>
  ),
};

export const SendAccepted: Story = {
  name: "send accepted (real — click Send): the field clears, the confirmation quotes the message",
  render: () => (
    <Stack gap={10}>
      <SteerField
        onSend={steerAccepted}
        agentName="senior-dev"
        defaultText="forget the cache, go with the simplest approach"
      />
    </Stack>
  ),
};

export const ServerRefusal: Story = {
  name: "server refusal (real — click Send): the 409's reason, spelled out",
  render: () => (
    <Stack gap={10}>
      <SteerField
        onSend={steerRefused}
        agentName="spec"
        defaultText="too late, the session is paused"
      />
    </Stack>
  ),
};

export const Sending: Story = {
  name: "sending (real — click Send): field locked, button waiting",
  render: () => (
    <Stack gap={10}>
      <SteerField
        onSend={steerPending}
        agentName="senior-dev"
        defaultText="continue but start with the tests"
      />
    </Stack>
  ),
};

export const SecondaryQuestionOpen: Story = {
  name: "secondary — a question is waiting elsewhere, this field isn't the answer",
  render: () => (
    <Stack gap={10}>
      <SteerField
        onSend={steerAccepted}
        agentName="back-pest-tdd"
        className="ch-composer-secondary"
        placeholder={CHANNELS_TEXT.composer.asidePlaceholder}
      />
    </Stack>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "The field loses its solid background and border in favor of an underline; its placeholder says it isn't the answer to the open question. On focus it becomes an ordinary field again: a control being used doesn't fade away.",
      },
    },
  },
};

export const NoAgentNamed: Story = {
  name: 'no named agent — "to the agent" rather than a made-up name',
  render: () => (
    <Stack gap={10}>
      <SteerField onSend={steerAccepted} defaultText="reread the brief before continuing" />
    </Stack>
  ),
};
