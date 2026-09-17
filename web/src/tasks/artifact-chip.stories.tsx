// The THREE kinds an artifact can carry (slice "artifacts accept binary", 02/09): text (existing
// iframe rendering), image (direct `<img>`) and non-image binary (download, no preview). The
// first case that matters is the ROW of chips, what the Artifacts screen shows first; the next
// ones show each preview open.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArtifactChip, ArtifactPreview } from "./artifact-chip.js";
import { Row, Stack } from "../ui/flex.js";
import { Label } from "../ui/text.js";

const meta = { title: "tasks / ArtifactChip" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

// A real 1x1 PNG as a data URI: no network, and a real binary, not text posing as an image.
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export const Chips: Story = {
  name: "pills — text, image, binary, expected absent",
  render: () => (
    <Row gap={8} wrap>
      <ArtifactChip name="implementation.md" sizeBytes={4_200} kind="text" />
      <ArtifactChip name="report.html" sizeBytes={18_400} kind="text" />
      <ArtifactChip name="capture.png" sizeBytes={812_000} kind="image" />
      <ArtifactChip name="export.zip" sizeBytes={1_340_000} kind="binary" />
      <ArtifactChip name="review.md" present={false} />
    </Row>
  ),
};

export const TextPreview: Story = {
  name: "preview — text (iframe sandbox, unchanged)",
  render: () => (
    <Stack gap={6}>
      <Label>Established render — no behavior change</Label>
      <ArtifactPreview
        name="implementation.md"
        src="data:text/plain,# Implementation%0A%0Adetails…"
        kind="text"
        onClose={() => {}}
      />
    </Stack>
  ),
};

// The case the preview exists for: an HTML report dropped by an agent, with the hostile script one
// must assume. It tries `fetch('/api/secrets')` and WRITES on screen what it got, so the story
// shows its own verdict. Served as `data:` so the workshop needs no server; containment measured
// against the REAL endpoint (same origin as the app, server headers) is in the task's
// verification artifact.
const RAPPORT_HTML = `<!doctype html><html lang="en"><meta charset="utf-8">
<body style="font: 14px system-ui; padding: 16px">
<h1 style="font-size: 18px">Measurement report — task page</h1>
<p>Control heights measured across 8 screens: <b>32px</b> everywhere.</p>
<p id="verdict">calling the API…</p>
<script>
  fetch('/api/secrets')
    .then((r) => r.text())
    .then((t) => { document.getElementById('verdict').textContent = 'API REACHED: ' + t; })
    .catch(() => { document.getElementById('verdict').textContent = 'fetch(/api/secrets) refused — sandboxed'; });
</script>
</body></html>`;

export const HtmlPreview: Story = {
  name: "preview — HTML report (rendered sandboxed)",
  render: () => (
    <Stack gap={6}>
      <Label>The document renders; its script doesn't reach the API</Label>
      <ArtifactPreview
        name="report.html"
        kind="text"
        onClose={() => {}}
        src={`data:text/html;charset=utf-8,${encodeURIComponent(RAPPORT_HTML)}`}
      />
    </Stack>
  ),
};

export const ImagePreview: Story = {
  name: "preview — image (new)",
  render: () => (
    <Stack gap={6}>
      <Label>An image shows directly, never inside the iframe</Label>
      <ArtifactPreview name="capture.png" src={PNG_1X1} kind="image" onClose={() => {}} />
    </Stack>
  ),
};

export const BinaryPreview: Story = {
  name: "preview — non-image binary (download)",
  render: () => (
    <Stack gap={6}>
      <Label>No preview attempted — a download link instead</Label>
      <ArtifactPreview
        name="export.zip"
        src="/api/tasks/t1/artifacts/export.zip"
        kind="binary"
        onClose={() => {}}
      />
    </Stack>
  ),
};
