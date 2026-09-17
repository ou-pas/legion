import { describe, expect, it } from "vitest";
import { pushAvailability, suggestDeviceLabel, type PushEnvironment } from "./push-support.js";

/** A modern desktop browser: everything is there, nothing is Apple. */
const CAPABLE: PushEnvironment = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  standalone: false,
  isApple: false,
};

describe("pushAvailability", () => {
  it("says ready when the three APIs are there", () => {
    expect(pushAvailability(CAPABLE)).toEqual({ state: "ready" });
  });

  // The case that matters, and the one a desktop cannot reproduce: a capable iPhone with the screen
  // open in a Safari tab. "Unsupported" there would be a lie sending you after a missing fault.
  it("asks for installation on an iPhone outside the home screen", () => {
    expect(pushAvailability({ ...CAPABLE, isApple: true })).toEqual({ state: "needs-home-screen" });
  });

  it("says ready on an iPhone once the app is installed", () => {
    expect(pushAvailability({ ...CAPABLE, isApple: true, standalone: true })).toEqual({
      state: "ready",
    });
  });

  // Any one of the three missing APIs is enough, and a missing `serviceWorker` is also what a
  // browser does on an insecure origin: hence the sentence naming both causes.
  it("refuses as soon as one of the three APIs is missing", () => {
    for (const missing of ["hasServiceWorker", "hasPushManager", "hasNotification"] as const) {
      const found = pushAvailability({ ...CAPABLE, [missing]: false });
      expect(found.state).toBe("unsupported");
    }
  });
});

describe("suggestDeviceLabel", () => {
  it("names the common platforms", () => {
    expect(suggestDeviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)")).toBe(
      "iPhone",
    );
    expect(suggestDeviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
    expect(suggestDeviceLabel("Mozilla/5.0 (Linux; Android 14)")).toBe("Android");
  });

  it("returns a generic name rather than nothing", () => {
    expect(suggestDeviceLabel("an unknown agent")).toBe("Browser");
  });
});
