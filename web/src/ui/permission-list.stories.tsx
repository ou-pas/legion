// Security information: the level is an acronym (RW / R / -) doubled by an icon of distinct shape,
// and a refusal is struck through. The list stays correct printed in black and white.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./chip.js";
import { Disclosure } from "./disclosure.js";
import { Stack } from "./flex.js";
import { Permission, PermissionGroup, PermissionList } from "./permission-list.js";

const meta = { title: "ui / PermissionList · PermissionGroup · Permission" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SeniorDevAgentGrants: Story = {
  name: "senior-dev agent's permissions",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsd-sheet dsd-pad">
          <PermissionList label="Permissions granted to senior-dev">
            <PermissionGroup scope="repos">
              <Permission name="front" level="rw" detail="legion/checkout" />
              <Permission name="api" level="r" detail="main" />
              <Permission name="infra" level="none" detail="never mounted" />
            </PermissionGroup>
            <PermissionGroup scope="folders">
              <Permission name="/Users/operator/legion/out" level="rw" />
              <Permission name="/repos/front/src" level="r" />
              <Permission name="~/.ssh" level="none" detail="refused" />
            </PermissionGroup>
            <PermissionGroup scope="mcp">
              <Permission name="linear" level="r" detail="issues, projects" />
              <Permission name="github" level="none" detail="not granted" />
            </PermissionGroup>
            <PermissionGroup scope="network">
              <Permission name="api.stripe.com" level="r" />
              <Permission name="registry.npmjs.org" level="r" />
              <Permission name="everything else" level="none" detail="proxy egress" />
            </PermissionGroup>
            <PermissionGroup scope="skills">
              <Permission name="pdf-export" level="rw" detail="v2" />
            </PermissionGroup>
            <PermissionGroup scope="tools">
              <Permission name="Bash" level="rw" />
              <Permission name="Read" level="r" />
              <Permission name="WebFetch" level="none" detail="outside the allowlist" />
            </PermissionGroup>
            <PermissionGroup scope="secrets">
              <Permission name="GITHUB_TOKEN" level="r" />
              <Permission name="STRIPE_SECRET_KEY" level="none" detail="not granted" />
              <Permission
                name="CLAUDE_CODE_OAUTH_TOKEN"
                level="r"
                detail="Claude identity — injected without a grant"
              />
            </PermissionGroup>
            {/* Two families of rules in the same group: those applying by default ("all agents",
        no checkbox) and those ticked for this agent. Hiding the first read as "one rule, off"
        while four applied. */}
            <PermissionGroup scope="rules">
              <Permission name="secrets-never-plaintext" level="r" detail="all agents" />
              <Permission name="verify-before-delivery" level="r" detail="all agents" />
              <Permission name="design-system-non-negotiable" level="r" />
              <Permission name="measure-dont-assume" level="none" />
            </PermissionGroup>
          </PermissionList>
        </div>
      </Stack>
    );
  },
};

export const WriterAgentNetworkFullyRefused: Story = {
  name: "writer agent — network entirely refused",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsd-narrow dsd-sheet dsd-pad">
          <PermissionList label="Permissions granted to writer">
            <PermissionGroup scope="network">
              <Permission name="the whole network" level="none" detail="isolated agent" />
            </PermissionGroup>
          </PermissionList>
        </div>
      </Stack>
    );
  },
};

export const CompactDensityJobSheetMargin: Story = {
  name: "compact density + collapse — job description margin (300px)",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsd-narrow dsd-sheet dsd-pad">
          <PermissionList label="Permissions granted to senior-dev, support column">
            <PermissionGroup scope="repos" density="compact">
              <Permission name="front" level="rw" />
              <Permission name="api" level="r" />
            </PermissionGroup>
            <PermissionGroup scope="secrets" density="compact">
              <Permission name="GITHUB_TOKEN" level="r" />
            </PermissionGroup>
          </PermissionList>
          {/* Read-only: the count replaces the group title (`hideHeading`), the Disclosure summary
        already carries it. */}
          <Disclosure
            summary={
              <>
                Mounted folders
                <Badge count={2} label="2 mounted folders" />
              </>
            }
          >
            <PermissionGroup scope="folders" density="compact" hideHeading>
              <Permission name="/Users/operator/legion/out" level="rw" />
              <Permission name="/repos/front/src" level="r" />
            </PermissionGroup>
          </Disclosure>
        </div>
      </Stack>
    );
  },
};

// The 26/08 defect and its fix. At 300px a name longer than the column did not shrink: IT wrapped,
// leaving the level mark alone above, which then read as an entry of its own. It now stays on its
// line, truncated, and the tooltip gives the full name, but ONLY if it was really truncated
// (`Ellipsis` measures).
export const NamesLongerThanColumn: Story = {
  name: "names longer than the column — truncated, never wrapped",
  render: () => (
    <div className="dsd-narrow dsd-sheet dsd-pad">
      <PermissionList label="Permissions granted, narrow support column">
        <PermissionGroup scope="skills" density="compact">
          <Permission name="a-philosophy-of-software-design" level="none" />
          <Permission name="clean-architecture" level="r" />
          <Permission name="domain-driven-design" level="none" />
        </PermissionGroup>
        <PermissionGroup scope="rules" density="compact">
          <Permission name="design-system-non-negotiable" level="r" />
          <Permission name="atomic-commits-and-conventional-messages" level="r" />
        </PermissionGroup>
        <PermissionGroup scope="folders" density="compact">
          <Permission
            name="/Users/operator/Sites/labs/legion/server/data/artifacts"
            level="rw"
            detail="mounted read-write"
          />
        </PermissionGroup>
      </PermissionList>
    </div>
  ),
};
