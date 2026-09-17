// The story that matters is the LAST: a band of 61 tools showing only 6 lines. Without "... 55
// more" the truncation would read as a total, which is a lie.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChannelWork } from "./channel-work.js";
import { Stack } from "../ui/flex.js";
import type { WorkBand } from "./work-band.js";

const meta = { title: "channels / ChannelWork" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const LINES = [
  { verb: "read", target: "runner-payload/session-runner.mjs:373-429" },
  { verb: "grep", target: '"validateFormSpec" server/src/inbox/' },
  { verb: "read", target: "server/src/sessions/runner/manager.ts:230-260" },
  { verb: "read", target: "web/src/api/inbox.ts" },
  { verb: "write", target: "/artifacts/lOp4YXkSTJ/implementation.md" },
  { verb: "bash", target: "pnpm lint && pnpm --filter @legion/web build" },
];

const band = (over: Partial<WorkBand> = {}): WorkBand => ({
  durationMs: 240_000,
  tools: 61,
  reads: 18,
  writes: 0,
  lines: LINES,
  more: 0,
  ...over,
});

export const Collapsed: Story = {
  name: "collapsed — what you read without opening anything",
  render: () => (
    <div className="dsc-conv">
      <ChannelWork band={band()} />
    </div>
  ),
};

export const Short: Story = {
  name: 'short — a few seconds, not "0 min"',
  render: () => (
    <div className="dsc-conv">
      <ChannelWork
        band={band({ durationMs: 18_000, tools: 3, reads: 2, writes: 1, lines: LINES.slice(0, 3) })}
      />
    </div>
  ),
};

export const Truncated: Story = {
  name: "truncated — 6 lines shown, 55 announced",
  render: () => (
    <div className="dsc-conv">
      <ChannelWork band={band({ more: 55 })} />
    </div>
  ),
};

export const Empty: Story = {
  name: "empty — a band with not one readable line",
  render: () => (
    <div className="dsc-conv">
      <Stack gap={10}>
        <ChannelWork
          band={band({ durationMs: 0, tools: 0, reads: 0, writes: 0, lines: [], more: 0 })}
        />
      </Stack>
    </div>
  ),
};
