// The states that matter are not "empty / filled / error" but: the project declaring nothing
// (every project today, which must read fine without justifying itself), the one needing another
// image, and the one adding a layer on top (Dockerfile). The SSH key has its own card and stories
// (`ssh-key-card.stories.tsx`, batch nav/2a).
import type { Meta, StoryObj } from "@storybook/react-vite";
import { demoProject } from "./project-fixture.js";
import { SessionRuntimeCard } from "./session-runtime-card.js";

const meta = { title: "projects / SessionRuntimeCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Defaults: Story = {
  name: "no setting — the case for every existing project",
  render: () => <SessionRuntimeCard project={demoProject({})} />,
};

export const OwnImage: Story = {
  name: "an image of its own — a PHP project doesn't run inside node",
  render: () => (
    <SessionRuntimeCard project={demoProject({ sessionImage: "acme-session:latest" })} />
  ),
};

export const WithDockerfile: Story = {
  name: "a thin layer — Kopee.me's image: FROM, then an apt-get",
  render: () => (
    <SessionRuntimeCard
      project={demoProject({
        sessionImage: "kopee-session:latest",
        sessionDockerfile:
          "FROM legion-session:latest\nRUN apt-get update && apt-get install -y php8.2-cli\n",
      })}
    />
  ),
};
