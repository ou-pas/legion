// The states nobody guesses: a file refused BEFORE the network (too big), and a failed send, the
// only moment the answer does not go out, when one must know which file held it back.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "../ui/flex.js";
import type { PickedAttachmentsWiring } from "../tasks/use-picked-attachments.js";
import { ReplyAttachments } from "./reply-attachments.js";

const meta = { title: "inbox / ReplyAttachments" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** An inert hook-up: the stories show STATES, not a clipboard. */
const wiring = (over: Partial<PickedAttachmentsWiring> = {}): PickedAttachmentsWiring => ({
  picked: [],
  refusal: null,
  busy: false,
  add: () => {},
  paste: () => {},
  remove: () => {},
  clear: () => {},
  upload: () => Promise.resolve(),
  uploadThen: (_id, send) => (send(), Promise.resolve()),
  ...over,
});

const capture = (name: string, size: number) => ({ name, size, contentBase64: "AAA=" });

export const Empty: Story = {
  name: "nothing attached — the paperclip, that's it",
  render: () => (
    <Stack gap={10}>
      <ReplyAttachments files={wiring()} />
    </Stack>
  ),
};

export const TwoCaptures: Story = {
  name: "two pasted screenshots — timestamped, so they don't overwrite each other",
  render: () => (
    <Stack gap={10}>
      <ReplyAttachments
        files={wiring({
          picked: [
            capture("screenshot-2026-09-16-19-41-05.png", 182_400),
            capture("screenshot-2026-09-16-19-41-22.png", 96_100),
          ],
        })}
      />
    </Stack>
  ),
};

export const Refused: Story = {
  name: "refused before the network — the file is named, the others stay",
  render: () => (
    <Stack gap={10}>
      <ReplyAttachments
        files={wiring({
          picked: [capture("screenshot-2026-09-16-19-41-05.png", 182_400)],
          refusal: "Refused: maquette.psd — 8 MB maximum, or empty file.",
        })}
      />
    </Stack>
  ),
};

export const SendFailed: Story = {
  name: "send refused — the reply didn't go out, and we know which file caused it",
  render: () => (
    <Stack gap={10}>
      <ReplyAttachments
        files={wiring({
          picked: [capture("screenshot-2026-09-16-19-41-05.png", 182_400)],
          refusal: "screenshot-2026-09-16-19-41-05.png couldn't be attached: task not found",
        })}
      />
    </Stack>
  ),
};

export const Uploading: Story = {
  name: "uploading — the paperclip spins, the rest waits",
  render: () => (
    <Stack gap={10}>
      <ReplyAttachments
        files={wiring({
          busy: true,
          picked: [capture("screenshot-2026-09-16-19-41-05.png", 182_400)],
        })}
      />
    </Stack>
  ),
};
