// The baseline itself (05/09). A metric added to the measurer without a regenerated baseline would
// only fail its family's test with "unknown metric", blaming the wrong half. This check names the
// real cause.
import { describe, it } from "node:test";
import { sameMetricSet } from "./ratchet.js";

describe("the debt file", () => {
  it("describes exactly the metrics the measurer produces", () => {
    sameMetricSet();
  });
});
