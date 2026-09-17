// The invariant that broke on Goals (operator screenshot, 02/09): actions slipped between title and
// subtitle because the DOM placed them there. jsdom does not measure flexbox (no pixel assertion
// here; that is for Storybook and a visual check), but it sees the structure, which is what
// guarantees placement. So the test pins what no story can: title and subtitle share a parent,
// actions excluded.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageHeader } from "./page.js";

afterEach(cleanup);

describe("PageHeader", () => {
  it("title and subtitle share one group, separate from the actions", () => {
    const { container } = render(
      <PageHeader
        title="Channels"
        sub="The project's live conversations."
        actions={<button type="button">New goal</button>}
      />,
    );
    const group = container.querySelector(".ui-page-heading-line");
    expect(group).not.toBeNull();
    // Title and subtitle are inside the group...
    expect(group?.querySelector(".ui-page-heading")?.textContent).toBe("Channels");
    expect(group?.querySelector(".ui-page-sub")?.textContent).toBe(
      "The project's live conversations.",
    );
    // ...the button is not: nothing can slip between title and subtitle any more.
    expect(group?.querySelector("button")).toBeNull();
    expect(container.querySelector(".ui-page-head")?.querySelector("button")?.textContent).toBe(
      "New goal",
    );
  });

  it("without actions, the title + subtitle group is unchanged", () => {
    const { container } = render(<PageHeader title="Infrastructure" sub="Service status." />);
    const group = container.querySelector(".ui-page-heading-line");
    expect(group?.querySelector(".ui-page-heading")?.textContent).toBe("Infrastructure");
    expect(group?.querySelector(".ui-page-sub")?.textContent).toBe("Service status.");
  });

  it("without subtitle, the group only holds the title", () => {
    const { container } = render(<PageHeader title="Infrastructure" />);
    expect(container.querySelector(".ui-page-sub")).toBeNull();
    expect(
      container.querySelector(".ui-page-heading-line")?.querySelector(".ui-page-heading")
        ?.textContent,
    ).toBe("Infrastructure");
  });
});
