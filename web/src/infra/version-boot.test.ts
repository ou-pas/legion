// The version known at load: not the last one seen, the first call after boot.
import { afterEach, describe, expect, it } from "vitest";
import { isNewerThanBoot, noteBootVersion, resetBootVersionForTest } from "./version-boot.js";

afterEach(() => resetBootVersionForTest());

describe("the reference version is set only once", () => {
  it("the first call sets the reference", () => {
    noteBootVersion("v0.5.0");
    expect(isNewerThanBoot("v0.5.0")).toBe(false); // same version: not a return
  });

  it("a later call no longer moves the reference, even with a different version", () => {
    noteBootVersion("v0.5.0");
    noteBootVersion("v0.6.0"); // ignored: the reference is already set
    expect(isNewerThanBoot("v0.6.0")).toBe(true); // v0.6.0 still differs from v0.5.0
  });

  it("a version different from the reference is a return", () => {
    noteBootVersion("v0.5.0");
    expect(isNewerThanBoot("v0.6.0")).toBe(true);
  });

  it("until a boot is noted, nothing is a return", () => {
    expect(isNewerThanBoot("v0.6.0")).toBe(false);
  });

  it("a repository never tagged on both sides (`null`) compares nothing", () => {
    noteBootVersion(null);
    expect(isNewerThanBoot(null)).toBe(false);
    expect(isNewerThanBoot("v0.1.0")).toBe(false); // null reference: nothing to compare honestly
  });
});
