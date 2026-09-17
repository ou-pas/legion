// Comparing two versions (26/08). Pure and separate: it decides whether the update button shows.
//
// No dependency: `semver` is 40 KB of ranges and exotic pre-releases. We compare tags we write
// ourselves, with a `make release` that refuses anything else.

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** `beta.1` in `v1.2.0-beta.1`; empty for a final release. */
  pre: string;
  /** The tag as written, `v` included: displayed and checked out. */
  tag: string;
}

/** `v1.2.3` or `1.2.3`, with or without pre-release. Anything else is not a version. */
export function parseVersion(tag: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(tag.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ?? "",
    tag: tag.trim(),
  };
}

/** Negative if `a` precedes `b`. A pre-release always precedes its final: `v1.2.0-beta.1` < `v1.2.0`. */
export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1; // final > pre-release
  if (!b.pre) return -1;
  return a.pre < b.pre ? -1 : 1;
}

/** `null` when no tag is a version (a repo never tagged). */
export function latestVersion(tags: string[]): Version | null {
  const parsed = tags.map(parseVersion).filter((v): v is Version => v !== null);
  if (parsed.length === 0) return null;
  return parsed.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}

/** `null` when up to date or unknown. */
export function newerThan(current: string | null, tags: string[]): Version | null {
  const latest = latestVersion(tags);
  if (!latest) return null;
  const mine = current ? parseVersion(current) : null;
  // No local version (no tag on HEAD) but tags exist upstream: an update is possible.
  if (!mine) return latest;
  return compareVersions(latest, mine) > 0 ? latest : null;
}
