// The state that matters cannot be seen in production without breaking something: a PINNED id
// the SDK list no longer knows. The setting must stay displayed; hiding it would erase the
// operator's choice on the next save, without anyone asking.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ModelChoice } from "../api/models.js";
import { ModelRoutingCard } from "./model-routing-card.js";
import { demoProject } from "./project-fixture.js";

const meta = { title: "projects / ModelRoutingCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const model = (id: string, displayName: string): ModelChoice => ({
  id,
  resolves: null,
  displayName,
  description: "",
  supportsEffort: false,
  effortLevels: [],
  supportsAdaptiveThinking: false,
});

const MODELS = [model("haiku", "Haiku"), model("sonnet", "Sonnet"), model("opus", "Opus")];

/** The workshop seeds the `modelsQuery` key instead of calling `/api/models`: the component's
 *  real path, and the chosen list decides what the story shows. */
function withModels(children: ReactNode, models = MODELS) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(["models"], { models, source: "sdk", fetchedAt: Date.now() });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

export const AtDefaults: Story = {
  name: "no level set — all three fall back to the project default",
  render: () => withModels(<ModelRoutingCard project={demoProject({})} />),
};

export const ThreeLevelsSet: Story = {
  name: "all three levels set — the case the card exists for",
  render: () =>
    withModels(
      <ModelRoutingCard
        project={demoProject({
          modelRouting: JSON.stringify({ low: "haiku", med: "sonnet", high: "opus" }),
        })}
      />,
    ),
};

export const SingleLevel: Story = {
  name: "one level overridden — the other two stay on default",
  render: () =>
    withModels(
      <ModelRoutingCard
        project={demoProject({ modelRouting: JSON.stringify({ high: "opus" }) })}
      />,
    ),
};

export const PinnedId: Story = {
  name: "a dated identifier the SDK doesn't list — it stays displayed",
  render: () =>
    withModels(
      <ModelRoutingCard
        project={demoProject({
          modelRouting: JSON.stringify({ high: "claude-opus-4-8-20260901" }),
        })}
      />,
    ),
};

export const EmptyList: Story = {
  name: "the SDK returned nothing — the selectors are there, with no choice to offer",
  render: () => withModels(<ModelRoutingCard project={demoProject({})} />, []),
};

export const BrokenSetting: Story = {
  name: "`modelRouting` unreadable — the card falls back to defaults without a blank page",
  render: () => withModels(<ModelRoutingCard project={demoProject({ modelRouting: "{}" })} />),
};

// The project default (batch nav/2a): named as fallback in the three selects above without ever
// having had a field to set it.
export const PinnedDefault: Story = {
  name: "the default is a dated identifier the SDK doesn't list — it stays displayed",
  render: () =>
    withModels(
      <ModelRoutingCard project={demoProject({ defaultModel: "claude-opus-4-8-20260901" })} />,
    ),
};

export const EmptyDefault: Story = {
  name: "the default emptied — refused, Save stays disabled rather than accepting a project with no fallback",
  render: () => withModels(<ModelRoutingCard project={demoProject({ defaultModel: "" })} />),
};
