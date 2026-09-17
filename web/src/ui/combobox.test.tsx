// The keyboard, because that is what gets lost unnoticed. This replaces a native `<select>`: the
// mouse will always work (you test it by looking), arrows and Enter will not. A regression on that
// path does not show on screen, only when trying.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Combobox, type ComboboxOption } from "./combobox.js";
import { UI_TEXT } from "./vocabulary.js";

// An open option wraps its label in `<Ellipsis>`, whose `use-truncated.ts` needs `ResizeObserver`,
// which jsdom lacks. Same stub as `channel-thread.test.tsx`: this file tests the keyboard, not
// truncation.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const MEMBRES: ComboboxOption[] = [
  { id: "", label: "all" },
  { id: "u-1", label: "Alice Martin" },
  { id: "u-2", label: "Bruno Petit" },
  { id: "u-3", label: "Chloé Dubois" },
];

const mount = (over: Partial<Parameters<typeof Combobox>[0]> = {}) => {
  const onChange = vi.fn();
  render(<Combobox label="Assignee" options={MEMBRES} value="" onChange={onChange} {...over} />);
  return { onChange, input: screen.getByRole("combobox", { name: "Assignee" }) };
};

describe("Combobox — keyboard", () => {
  it("Arrow down opens the list", () => {
    const { input } = mount();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox", { name: "Assignee" })).toBeTruthy();
  });

  it("arrows then Enter choose, without touching the mouse", () => {
    const { input, onChange } = mount();
    fireEvent.keyDown(input, { key: "ArrowDown" }); // opens on "all"
    fireEvent.keyDown(input, { key: "ArrowDown" }); // Alice
    fireEvent.keyDown(input, { key: "ArrowDown" }); // Bruno
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("u-2");
  });

  it("End goes to the last option, Home back to the first", () => {
    const { input, onChange } = mount();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "End" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("u-3");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Home" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("Escape closes without choosing", () => {
    const { input, onChange } = mount();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Tab closes the list instead of leaving it orphaned behind the focus", () => {
    const { input } = mount();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Combobox — search", () => {
  // "Chloé" is non-ASCII on purpose: it exercises accent folding.
  it('three letters are enough, and accents are folded ("chloe" finds "Chloé")', () => {
    const { input, onChange } = mount();
    fireEvent.change(input, { target: { value: "chloe" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Chloé Dubois"]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("u-3");
  });

  it("a search with no result says so instead of rendering a silent surface", () => {
    const { input } = mount();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(UI_TEXT.combobox.noMatch)).toBeTruthy();
  });

  it('"nothing to offer" and "nothing matches" are worded differently', () => {
    const { input } = mount({ options: [] });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByText(UI_TEXT.combobox.empty)).toBeTruthy();
  });

  it("while loading, the list waits instead of declaring itself empty", () => {
    const { input } = mount({ options: [], loading: true });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.queryByText(UI_TEXT.combobox.empty)).toBeNull();
    expect(screen.getAllByText(UI_TEXT.loading).length).toBeGreaterThan(0);
  });
});

describe("Combobox — what the field shows", () => {
  it("closed, it holds the chosen value's label", () => {
    const { input } = mount({ value: "u-1" });
    expect((input as HTMLInputElement).value).toBe("Alice Martin");
  });

  it("open, it clears for search and keeps the choice as placeholder", () => {
    const { input } = mount({ value: "u-1" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect((input as HTMLInputElement).value).toBe("");
    expect(input.getAttribute("placeholder")).toBe("Alice Martin");
  });

  it("a value missing from the options leaves the placeholder (the ghost filter, seen from here)", () => {
    const { input } = mount({ value: "u-gone", placeholder: "all" });
    expect((input as HTMLInputElement).value).toBe("");
    expect(input.getAttribute("placeholder")).toBe("all");
  });
});
