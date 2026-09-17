// The new states of the "the brief carries attachments" slice. The first matters most: a task
// without attachments, only the invitation to add one left. It is the default of the composer
// and of every Brief view, so the most seen.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BriefAttachments } from "./brief-attachments.js";
import { Row, Stack } from "../ui/flex.js";
import { Label } from "../ui/text.js";
import { ArtifactChip } from "./artifact-chip.js";
import { TASK_PAGE_TEXT as T } from "./text/task-page.js";

const meta = { title: "tasks / BriefAttachments" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const joints = [
  { name: "screenshot-board.png", size: 812_000, kind: "image" as const },
  { name: "interview-notes.md", size: 4_200, kind: "text" as const },
  { name: "accounts-export.zip", size: 1_340_000, kind: "binary" as const },
];

export const Empty: Story = {
  name: "nothing attached — the invitation alone (composer and Brief view at rest)",
  render: () => <BriefAttachments attachments={[]} onAdd={() => {}} onRemove={() => {}} />,
};

export const Chosen: Story = {
  name: "chosen, not sent yet — the composer: no address, so no preview promised",
  render: () => (
    <BriefAttachments
      attachments={[
        { name: "screenshot-board.png", size: 812_000 },
        { name: "notes.md", size: 4_200 },
      ]}
      onAdd={() => {}}
      onRemove={() => {}}
    />
  ),
};

export const Dropped: Story = {
  name: "attached to the task — each pill opens its preview",
  render: () => (
    <BriefAttachments
      attachments={joints}
      onAdd={() => {}}
      onRemove={() => {}}
      urlOf={() => PNG_1X1}
    />
  ),
};

export const Dropping: Story = {
  name: "uploading — the zone says it's working",
  render: () => (
    <BriefAttachments
      attachments={[{ name: "screenshot-board.png", size: 812_000 }]}
      onAdd={() => {}}
      busy
    />
  ),
};

export const Refusal: Story = {
  name: 'refusal named — the faulty file is named, not "file refused"',
  render: () => (
    <BriefAttachments
      attachments={[]}
      onAdd={() => {}}
      refusal={T.attachments.tooLarge("mockup-v3.psd")}
    />
  ),
};

export const Locked: Story = {
  name: "session in progress — you can still attach, but not remove, and the reason is CLEARLY under the list",
  render: () => (
    <BriefAttachments
      attachments={joints}
      onAdd={() => {}}
      urlOf={() => PNG_1X1}
      locked={T.attachments.locked}
    />
  ),
};

export const Transmitted: Story = {
  name: "filed during the session — passed to the running agent (the steer went out)",
  render: () => (
    <BriefAttachments
      attachments={joints}
      onAdd={() => {}}
      urlOf={() => PNG_1X1}
      notice={T.attachments.steered}
      locked={T.attachments.locked}
    />
  ),
};

export const ForNextRun: Story = {
  name: "filed during the session — the session isn't listening, the agent will see it next time",
  render: () => (
    <BriefAttachments
      attachments={joints}
      onAdd={() => {}}
      urlOf={() => PNG_1X1}
      notice={T.attachments.queued}
      locked={T.attachments.locked}
    />
  ),
};

export const ReadOnly: Story = {
  name: "read-only — no action, just the lock under the list",
  render: () => (
    <BriefAttachments attachments={joints} urlOf={() => PNG_1X1} locked={T.attachments.locked} />
  ),
};

export const OnArtifactsView: Story = {
  name: 'Artifacts view — "attached by the operator" above "filed by the agent"',
  render: () => (
    <Stack gap={12}>
      <BriefAttachments
        label={T.attachments.fromOperator}
        attachments={joints}
        urlOf={() => PNG_1X1}
      />
      <Stack gap={6}>
        <Label>{T.attachments.fromAgent}</Label>
        <Row gap={8} wrap>
          <ArtifactChip name="implementation.md" sizeBytes={9_100} kind="text" />
          <ArtifactChip name="pr.md" sizeBytes={2_400} kind="text" />
        </Row>
      </Stack>
    </Stack>
  ),
};
