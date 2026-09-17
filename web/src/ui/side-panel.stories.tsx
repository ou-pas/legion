// The full-height support column on the right edge: a task's settings/runtime panel and the wiki
// sections list.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tag } from "./chip.js";
import { Row, Spacer, Stack } from "./flex.js";
import { Heading } from "./heading.js";
import { Inset } from "./inset.js";
import { KeyValue, KeyValueList } from "./key-value.js";
import { SidePanel } from "./side-panel.js";
import { Caption, Text } from "./text.js";

const meta = { title: "ui / SidePanel" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const HeadBodyFoot: Story = {
  name: "head, body, foot",
  render: () => (
    <Row align="stretch" gap={16}>
      <Text tone="muted">The page's content, on the left.</Text>
      <Spacer />
      <SidePanel
        label="Runtime & context"
        head={
          <Stack gap={2}>
            <Heading level={3}>Runtime & context</Heading>
            <Caption>What the session knows about itself.</Caption>
          </Stack>
        }
        foot={
          <Row gap={8}>
            <Caption>Session ID</Caption>
            <Spacer />
            <Tag>5ykSQkc9sX7Q</Tag>
          </Row>
        }
      >
        <Stack gap={12}>
          <Inset label="Runner & container">
            <KeyValueList density="compact">
              <KeyValue label="Runner">mini-workshop</KeyValue>
              <KeyValue label="Agent">front</KeyValue>
            </KeyValueList>
          </Inset>
          <Inset label="Model & cost">
            <KeyValueList density="compact">
              <KeyValue label="Model">
                <Tag>opus</Tag>
              </KeyValue>
              <KeyValue label="Turns">147</KeyValue>
            </KeyValueList>
          </Inset>
        </Stack>
      </SidePanel>
    </Row>
  ),
};

export const BodyOnly: Story = {
  name: "body alone (section list)",
  render: () => (
    <Row align="stretch" gap={16}>
      <Spacer />
      <SidePanel label="On this page">
        <Stack gap={4}>
          <Caption>ON THIS PAGE</Caption>
          <Text>Home</Text>
          <Text tone="muted">Two corpora, two questions</Text>
          <Text tone="muted">Where to start</Text>
        </Stack>
      </SidePanel>
    </Row>
  ),
};
