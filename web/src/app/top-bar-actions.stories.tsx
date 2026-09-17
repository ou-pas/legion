// Two of the three gestures are toggles, so what matters is seeing both positions side by
// side: the only place where the pressed icon is checked against the resting one.
//
// `NotifToggle` renders `null` until its query answers, and the workshop has no API, so each
// state gets a preloaded query client.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Row } from "../ui/flex.js";
import { NotifToggle, SearchButton, ThemeToggle } from "./top-bar-actions.js";

/** Infinite `staleTime`: without it the component would refetch on mount and fall back to
 *  `null`. */
function clientWith(enabled: boolean) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
  });
  qc.setQueryData(["notifications"], { enabled, webhooks: [], events: [] });
  return qc;
}

const notificationsOn = clientWith(true);
const notificationsOff = clientWith(false);

const meta = { title: "app / TopBarActions" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Search: Story = {
  name: "search — one icon, not a 30 rem field",
  render: () => <SearchButton />,
};

export const Theme: Story = {
  name: "theme — the position follows the workshop toolbar",
  render: () => <ThemeToggle />,
};

export const NotificationsOn: Story = {
  name: "notifications on — the bell is full, button pressed",
  render: () => (
    <QueryClientProvider client={notificationsOn}>
      <NotifToggle />
    </QueryClientProvider>
  ),
};

export const NotificationsOff: Story = {
  name: "notifications off — the kill switch pulled",
  render: () => (
    <QueryClientProvider client={notificationsOff}>
      <NotifToggle />
    </QueryClientProvider>
  ),
};

// The "before the server answers" state has no story: the component renders `null` there.

export const TheRow: Story = {
  name: "the three in a row, like in the bar",
  render: () => (
    <QueryClientProvider client={notificationsOn}>
      <Row gap={4}>
        <SearchButton />
        <ThemeToggle />
        <NotifToggle />
      </Row>
    </QueryClientProvider>
  ),
};
