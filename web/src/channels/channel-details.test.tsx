// The case behind the 14/09 interview: an interview task that only produced an implementation plan
// and pushed nothing showed an open-PR button in the channel deliverables, and clicking could not
// succeed ("No commits between main and legion/…"). Stories show the screen; this test MEASURES it
// with two DOM assertions.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT, channel } from "./fixtures.js";
import { ChannelDetails } from "./channel-details.js";

afterEach(cleanup);

const renderDetails = (pushedCode: boolean) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ChannelDetails
        channel={channel()}
        agent={AGENT}
        artifacts={[{ name: "plan.md", size: 4_200, mimeType: "text/plain", kind: "text" }]}
        links={{ parent: null, children: [] }}
        rounds={2}
        pushedCode={pushedCode}
        diffLink={pushedCode ? <a href="#">Diff and PR draft</a> : undefined}
      />
    </QueryClientProvider>,
  );

describe("ChannelDetails: button and link follow the push, not `pr.md`", () => {
  it("without push: no open button, no diff link", () => {
    renderDetails(false);
    expect(screen.queryByRole("button", { name: /open the pr/i })).toBeNull();
    expect(screen.queryByText("Diff and PR draft")).toBeNull();
  });

  it("with push: the open button and the diff link appear", () => {
    renderDetails(true);
    expect(screen.getByRole("button", { name: /open the pr/i })).toBeDefined();
    expect(screen.getByText("Diff and PR draft")).toBeDefined();
  });
});
