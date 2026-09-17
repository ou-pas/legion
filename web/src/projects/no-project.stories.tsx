// Visible once in an installation's life, exactly the kind of screen never seen again after
// writing it: its states only exist if they are here.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { NoProjectScreen, type PreflightCheck } from "./no-project.js";
import { NO_PROJECT_TEXT as T } from "./text/no-project.js";

const meta = { title: "projects / NoProjectScreen" } satisfies Meta;
export default meta;
type Story = StoryObj;

const IDENTITY_OK: PreflightCheck = {
  id: "identity",
  met: true,
  title: T.identity.title,
  detail: T.identity.ok,
  value: `sk-ant-oat-a… (72 chars) · ${T.identity.kind.oauth}`,
};
const DOCKER_OK: PreflightCheck = {
  id: "docker",
  met: true,
  title: T.docker.title,
  detail: T.docker.ok(2),
  value: "local · home-server",
};
const IMAGE_OK: PreflightCheck = {
  id: "image",
  met: true,
  title: T.image.okTitle,
  detail: T.image.ok,
  value: T.image.name,
};

const noop = () => {};

export const Satisfied: Story = {
  name: "ground held — the button only waits for a URL",
  render: () => (
    <NoProjectScreen
      checks={[IDENTITY_OK, DOCKER_OK, IMAGE_OK]}
      onCreate={noop}
      onOpenDemo={noop}
    />
  ),
};

export const MissingImage: Story = {
  name: "not held — the session image is missing, and the action is named",
  render: () => (
    <NoProjectScreen
      checks={[
        IDENTITY_OK,
        DOCKER_OK,
        {
          id: "image",
          met: false,
          title: T.image.title,
          detail: T.image.fix,
          command: T.image.fixCommand,
          value: T.image.name,
        },
      ]}
      onCreate={noop}
      onOpenDemo={noop}
    />
  ),
};

export const NothingSatisfied: Story = {
  name: "not held — three conditions, three actions",
  render: () => (
    <NoProjectScreen
      checks={[
        {
          id: "identity",
          met: false,
          title: T.identity.title,
          detail: T.identity.fix,
          command: T.identity.fixCommand,
          value: null,
        },
        {
          id: "docker",
          met: false,
          title: T.docker.title,
          detail: T.docker.fix,
          command: T.docker.fixCommand,
          value: null,
        },
        {
          id: "image",
          met: false,
          title: T.image.title,
          detail: T.image.fix,
          command: T.image.fixCommand,
          value: T.image.name,
        },
      ]}
      onCreate={noop}
      onOpenDemo={noop}
    />
  ),
};

export const GroundNotRead: Story = {
  name: "in progress — the ground hasn't been read yet",
  render: () => <NoProjectScreen checks={null} onCreate={noop} onOpenDemo={noop} />,
};

export const Creating: Story = {
  name: "in progress — creating the project",
  render: () => (
    <NoProjectScreen
      checks={[IDENTITY_OK, DOCKER_OK, IMAGE_OK]}
      creating
      onCreate={noop}
      onOpenDemo={noop}
    />
  ),
};

export const OpeningDemo: Story = {
  name: "in progress — opening the demo",
  render: () => (
    <NoProjectScreen
      checks={[IDENTITY_OK, DOCKER_OK, IMAGE_OK]}
      opening
      onCreate={noop}
      onOpenDemo={noop}
    />
  ),
};

export const Refusal: Story = {
  name: "the server refuses — the message reads in the form",
  render: () => (
    <NoProjectScreen
      checks={[IDENTITY_OK, DOCKER_OK, IMAGE_OK]}
      error="https repo URL required (the token goes through the credential store)"
      onCreate={noop}
      onOpenDemo={noop}
    />
  ),
};
