// The three states that matter are the id's, not the field's: it will follow, it will not, or
// the question does not arise because the new name yields the same id. A screen showing only the
// input shows nothing of the subject.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Project } from "../api/projects.js";
import { ProjectNameCard } from "./project-name-card.js";

const meta = { title: "projects / ProjectNameCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const project = (over: Partial<Project>): Project => ({
  id: "p1",
  name: "Acme",
  slug: "acme",
  defaultModel: "sonnet",
  repoUrl: null,
  fsRoot: null,
  context: "",
  demo: false,
  gitAuthorName: null,
  gitAuthorEmail: null,
  defaultSkillNames: "[]",
  modelRouting: "{}",
  chainBindings: "{}",
  sessionImage: null,
  sessionDockerfile: null,
  sshKeyPath: null,
  hue: null,
  ...over,
});

export const AtRest: Story = {
  name: "at rest — the name and its identifier",
  render: () => <ProjectNameCard project={project({})} />,
};

export const LongName: Story = {
  name: "a long name, whose identifier still reads",
  render: () => (
    <ProjectNameCard
      project={project({
        name: "Acme — front end, API, and resolution engines",
        slug: "acme-front-api-and-resolution-engines",
      })}
    />
  ),
};

export const ExplicitFolder: Story = {
  name: "with a chosen output folder — the identifier names no path",
  render: () => (
    <ProjectNameCard project={project({ fsRoot: "/Users/operator/Sites/artifacts" })} />
  ),
};

export const ProjectLegion: Story = {
  name: "the Legion project — its identifier will never change",
  render: () => <ProjectNameCard project={project({ name: "Legion", slug: "legion" })} />,
};
