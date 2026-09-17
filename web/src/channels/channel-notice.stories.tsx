// A dated fact that is nobody's speech. Every code of the vocabulary goes through: the only way
// to see an incident and a session end do not share a tone, and that no code was left wordless.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChannelNotice } from "./channel-notice.js";
import { Stack } from "../ui/flex.js";
import { TASK_STATUS } from "../api/tasks.js";

const meta = { title: "channels / ChannelNotice" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const CONTAINER =
  'proxy run failed: the container name "legion-proxy-0WpRyW8bF9d1" is already in use';

export const Incident: Story = {
  name: "bad — the session was dead on wake",
  render: () => (
    <div className="dsc-conv">
      <Stack gap={10}>
        <ChannelNotice tone="bad" code="run_error" detail={CONTAINER} />
        <ChannelNotice tone="bad" code="repo_push_failed" detail="protected branch" />
        <ChannelNotice tone="bad" code="fs_denied" detail="write /etc/hosts" />
      </Stack>
    </div>
  ),
};

export const Waiting: Story = {
  name: "wait — quota, dependency, warning",
  render: () => (
    <div className="dsc-conv">
      <Stack gap={10}>
        <ChannelNotice tone="wait" code="throttle" detail="allowed_warning" />
        <ChannelNotice tone="wait" code="dependency_wait" detail="Backend relay: API routes" />
        <ChannelNotice
          tone="wait"
          code="run_warning"
          detail="the brief is over 20,000 characters"
        />
      </Stack>
    </div>
  ),
};

export const NormalCourse: Story = {
  name: "neutral and ok — push, status, end of session",
  render: () => (
    <div className="dsc-conv">
      <Stack gap={10}>
        <ChannelNotice tone="neutral" code="repo_push" detail="legion · 6 · 89876f6" />
        <ChannelNotice tone="neutral" code="task_status" detail={TASK_STATUS.review} />
        <ChannelNotice tone="neutral" code="dependency_resolved" detail={TASK_STATUS.done} />
        <ChannelNotice tone="ok" code="result_ok" detail="" />
        <ChannelNotice tone="neutral" code="result_end" detail="error_max_turns" />
      </Stack>
    </div>
  ),
};

export const WithoutDetail: Story = {
  name: "no detail — the fact holds without its precision",
  render: () => (
    <div className="dsc-conv">
      <Stack gap={10}>
        <ChannelNotice tone="wait" code="dependency_wait" detail="" />
        <ChannelNotice tone="bad" code="run_error" detail="" />
      </Stack>
    </div>
  ),
};
