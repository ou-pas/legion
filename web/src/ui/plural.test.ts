import { describe, expect, it } from "vitest";
import { plural } from "./plural.js";

describe("plural", () => {
  it("says the plural at zero — the recopied `n > 1` said “0 task”", () => {
    expect(plural(0, "task")).toBe("tasks");
  });

  it("says the singular at exactly one", () => {
    expect(plural(1, "task")).toBe("task");
  });

  it("says the plural above one", () => {
    expect(plural(2, "task")).toBe("tasks");
    expect(plural(17, "task")).toBe("tasks");
  });

  it("takes an irregular plural when the word does not end in a plain “s”", () => {
    expect(plural(1, "infrastructure anomaly", "infrastructure anomalies")).toBe(
      "infrastructure anomaly",
    );
    expect(plural(3, "infrastructure anomaly", "infrastructure anomalies")).toBe(
      "infrastructure anomalies",
    );
  });

  it("agrees a whole phrase, not only a noun", () => {
    expect(plural(1, "session is", "sessions are")).toBe("session is");
    expect(plural(4, "session is", "sessions are")).toBe("sessions are");
    // A verb after a singular subject carries the "s" on the ONE side: the two arguments are the
    // form for exactly one and the form for any other count, never "singular" and "plural".
    expect(plural(1, "agent references", "agents reference")).toBe("agent references");
    expect(plural(2, "agent references", "agents reference")).toBe("agents reference");
  });
});
