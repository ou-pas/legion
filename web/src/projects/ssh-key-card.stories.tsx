// No key (every project today), a key set, and a path longer than the field showing it.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { demoProject } from "./project-fixture.js";
import { SshKeyCard } from "./ssh-key-card.js";

const meta = { title: "projects / SshKeyCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const None: Story = {
  name: "no key — the case for every existing project",
  render: () => <SshKeyCard project={demoProject({})} />,
};

export const KeySet: Story = {
  name: "a key set — the path on the docker host, never the key",
  render: () => (
    <SshKeyCard project={demoProject({ sshKeyPath: "/Users/operator/.ssh/id_acme_deploy" })} />
  ),
};

export const LongPath: Story = {
  name: "a path longer than its field",
  render: () => (
    <SshKeyCard
      project={demoProject({
        sshKeyPath:
          "/Users/operator/Library/Application Support/legion/keys/acme-backend-deploy-key",
      })}
    />
  ),
};
