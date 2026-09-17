// The list keyboard, tested once for both components using it (06/09). `Select` and `Combobox`
// each have end-to-end tests; this one targets what neither reaches: the list edge that must not
// wrap, the disabled option that is skipped, the key the list does not take and must hand back.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useListbox, type Listbox } from "./use-listbox.js";

interface Item {
  label: string;
  off?: boolean;
}
const ITEMS: Item[] = [
  { label: "alpha" },
  { label: "beta", off: true },
  { label: "gamma" },
  { label: "delta" },
];

const mount = (items: readonly Item[] = ITEMS) =>
  renderHook(() =>
    useListbox({
      items,
      view: null,
      labelOf: (i) => i.label,
      disabledOf: (i) => i.off === true,
    }),
  );

/** A key press: what the list did with it, and whether it took it from the browser. */
function press(list: Listbox, key: string) {
  let prevented = false;
  let consumed = false;
  act(() => {
    consumed = list.navigate({
      key,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as Parameters<Listbox["navigate"]>[0]);
  });
  return { consumed, prevented };
}

describe("useListbox — arrows", () => {
  it("moves down skipping the disabled option", () => {
    const { result } = mount();
    expect(result.current.active).toBe(0);
    expect(press(result.current, "ArrowDown")).toEqual({ consumed: true, prevented: true });
    expect(result.current.active).toBe(2); // "beta" is disabled
  });

  it("stops at the edge instead of wrapping", () => {
    const { result } = mount();
    press(result.current, "ArrowUp");
    expect(result.current.active).toBe(0);
    for (const _ of ITEMS) press(result.current, "ArrowDown");
    expect(result.current.active).toBe(ITEMS.length - 1);
  });

  it("End goes to the last option, Home back to the first", () => {
    const { result } = mount();
    press(result.current, "End");
    expect(result.current.active).toBe(3);
    press(result.current, "Home");
    expect(result.current.active).toBe(0);
  });

  it("hands back to the browser a key it does not take", () => {
    const { result } = mount();
    // This lets `Combobox` keep left/right for its text field caret, where `Select` uses them to
    // navigate.
    expect(press(result.current, "ArrowRight")).toEqual({ consumed: false, prevented: false });
    expect(result.current.active).toBe(0);
  });

  it("an empty list does not move and does not throw", () => {
    const { result } = mount([]);
    press(result.current, "ArrowDown");
    press(result.current, "End");
    expect(result.current.active).toBeLessThanOrEqual(0);
  });
});

describe("useListbox — jumps and typeahead", () => {
  it("jumps several steps without crossing the edge (Page down)", () => {
    const { result } = mount();
    act(() => result.current.move(1, 10));
    expect(result.current.active).toBe(3);
  });

  it("targets the first label starting with what is typed, accumulating keystrokes", () => {
    const { result } = mount();
    act(() => result.current.typeahead("g"));
    expect(result.current.active).toBe(2);
    act(() => result.current.typeahead("a")); // "ga", still gamma
    expect(result.current.active).toBe(2);
  });

  it("never targets a disabled option", () => {
    const { result } = mount();
    act(() => result.current.typeahead("b"));
    expect(result.current.active).toBe(0); // "beta" is disabled: nothing moves
  });
});
