import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WikiMarkdown } from "./wiki-markdown.js";

// No [[wikilink]] on purpose: those render through the router's <Link>, which needs a
// RouterProvider. This test watches the external link, which does not.
describe("WikiMarkdown — external links", () => {
  afterEach(cleanup);

  it("renders an https link with its target", () => {
    render(<WikiMarkdown content="See [the docs](https://example.com/doc)." links={[]} />);
    expect(screen.getByRole("link", { name: "the docs" }).getAttribute("href")).toBe(
      "https://example.com/doc",
    );
  });

  it("leaves a link with a refused scheme as visible text, without an anchor", () => {
    render(<WikiMarkdown content="A [trap](javascript:alert(1)) in the page." links={[]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/\[trap\]\(javascript:alert\(1\)\)/)).toBeTruthy();
  });
});
