// The rail head carries a second segment, and only when given one.
//
// The head is shared by project, system and wiki. Only the project needs the segment: its rail is
// replaced when entering a section (slice nav/09), so it alone needs to restate where you are. Both
// halves matter: the segment is written, and it changes nothing for the other two.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RailHead } from "./rail-head.js";

afterEach(cleanup);

describe("rail head", () => {
  it('writes "project · section" inside a section', () => {
    render(<RailHead mark={<span />} name="Legion" sub="Settings" />);
    // One piece of accessible text: the middle dot is not CSS decoration, it is read and copied as
    // part of the phrase saying where you are.
    expect(screen.getByTitle("Legion · Settings").textContent).toBe("Legion · Settings");
  });

  it("writes only the name outside a section", () => {
    render(<RailHead mark={<span />} name="System" />);
    expect(screen.getByTitle("System").textContent).toBe("System");
  });
});
