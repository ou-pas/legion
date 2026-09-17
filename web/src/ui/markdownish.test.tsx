import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdownish } from "./markdownish.js";

describe("Markdownish — GFM tables", () => {
  afterEach(cleanup);

  it("renders headers, cells, inline code and numeric alignment", () => {
    render(
      <Markdownish
        text={"| Command | Result |\n|---|---:|\n| `pnpm lint` | OK |\n| `pnpm test` | OK (461) |"}
      />,
    );
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Command",
      "Result",
    ]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("pnpm lint").tagName).toBe("CODE");
    expect(screen.getByText("OK (461)").getAttribute("data-align")).toBe("num");
  });

  it("leaves a piped line without separator as visible text", () => {
    render(<Markdownish text={"| not | a table |"} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("| not | a table |")).toBeTruthy();
  });
});

describe("Markdownish — links", () => {
  afterEach(cleanup);

  it("renders an https link with its target", () => {
    render(<Markdownish text="see [the PR](https://github.com/ou-pas/legion/pull/2)" />);
    expect(screen.getByRole("link", { name: "the PR" }).getAttribute("href")).toBe(
      "https://github.com/ou-pas/legion/pull/2",
    );
  });

  it("leaves a link with a refused scheme as visible text, no anchor", () => {
    render(<Markdownish text="[click](javascript:alert(1))" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("[click](javascript:alert(1))")).toBeTruthy();
  });
});
