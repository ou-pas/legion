// The last two states cannot be produced on a working machine, and they are exactly where the
// screen matters: a misfiled token is refused by the API WITHOUT a message, and the session
// fails blaming something else.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "../ui/flex.js";
import type { AuthIdentity } from "../api/auth.js";
import { IdentityCard } from "./identity-card.js";

const meta = { title: "infra / IdentityCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const API_KEY: AuthIdentity = {
  kind: "api-key",
  masked: "sk-ant-api0… (108 chars)",
  warnings: [],
};

const OAUTH: AuthIdentity = {
  kind: "oauth",
  masked: "sk-ant-oat0… (96 chars)",
  warnings: [],
};

export const ApiKey: Story = {
  name: "an API key",
  render: () => <IdentityCard identity={API_KEY} />,
};

export const Subscription: Story = {
  name: "a subscription (OAuth)",
  render: () => <IdentityCard identity={OAUTH} />,
};

export const None: Story = {
  name: "no credential — no session can start",
  render: () => <IdentityCard identity={{ kind: "none", masked: null, warnings: [] }} />,
};

export const MisfiledToken: Story = {
  name: "an OAuth token stored in ANTHROPIC_API_KEY — the silent failure",
  render: () => (
    <IdentityCard
      identity={{
        ...API_KEY,
        masked: "sk-ant-oat0… (96 chars)",
        warnings: [
          {
            type: "oauth-in-api-key",
            message:
              "CLAUDE_CODE_OAUTH_TOKEN looks like it's stored in ANTHROPIC_API_KEY: the API will refuse this token without saying why.",
          },
        ],
      }}
    />
  ),
};

export const AllStates: Story = {
  name: "the four in a row",
  render: () => (
    <Stack gap={12}>
      <IdentityCard identity={API_KEY} />
      <IdentityCard identity={OAUTH} />
      <IdentityCard identity={{ kind: "none", masked: null, warnings: [] }} />
      <IdentityCard
        identity={{
          ...API_KEY,
          warnings: [
            {
              type: "oauth-malformed",
              message: "The OAuth token doesn't match the expected shape.",
            },
          ],
        }}
      />
    </Stack>
  ),
};
