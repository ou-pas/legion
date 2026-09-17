// An error names the problem AND the way out. The technical message is mono, one line, expandable:
// data to copy, not prose.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MessageSquare, Play, RotateCcw } from "lucide-react";
import { Button } from "./button.js";
import { ErrorState } from "./error-state.js";
import { Stack } from "./flex.js";

const meta = { title: "ui / ErrorState" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const RUN_ERROR = "Timeout after 600s — heap out of memory at 512 invoices";

export const SessionFailureCollapsible: Story = {
  name: "session failure (collapsed / expandable)",
  render: () => {
    return (
      <Stack gap={10}>
        <ErrorState
          title="The session stopped before finishing"
          detail={RUN_ERROR}
          actions={
            <>
              <Button variant="primary" leading={<RotateCcw size={13} />}>
                Retry with diagnostics
              </Button>
              <Button leading={<MessageSquare size={13} />}>Leave in review</Button>
            </>
          }
        >
          "Bulk-generate PDF invoices" spent $0.35 then ran out of memory on the 512th document. No
          artifact was filed, the legion/invoices branch is untouched.
        </ErrorState>
      </Stack>
    );
  },
};

export const LongTechnicalMessageTruncated: Story = {
  name: "long technical message (truncation)",
  render: () => {
    return (
      <Stack gap={10}>
        <ErrorState
          title="The Docker runner refused to start"
          detail="Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: error mounting /var/lib/legion/repos/front to rootfs at /repos/front: mount /var/lib/legion/repos/front:/repos/front (via /proc/self/fd/7), flags: 0x5000: not a directory"
          actions={<Button leading={<Play size={13} />}>Retry on home-server</Button>}
        >
          The granted folder no longer exists on the host. The container was cleaned up, no cost was
          incurred.
        </ErrorState>
      </Stack>
    );
  },
};

export const WithoutTechnicalMessage: Story = {
  name: "without technical message",
  render: () => {
    return (
      <Stack gap={10}>
        <ErrorState
          title="The Discord webhook stopped responding"
          actions={<Button>Resend the test</Button>}
        >
          The last 3 notifications weren't delivered. Discord replies are suspended until the next
          successful test.
        </ErrorState>
      </Stack>
    );
  },
};
