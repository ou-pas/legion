// The no-project screen has one field: everything it shows (project name, forge) derives from this
// URL. A silent derivation lets the operator create "repo" at an unknown forge without knowing.
import { describe, expect, it } from "vitest";
import { declaredInstances, guessForge } from "./forge.js";
import { hostOfRepoUrl, projectNameFromUrl } from "./repo-url.js";

describe("projectNameFromUrl", () => {
  it("takes the last segment, without .git", () => {
    expect(projectNameFromUrl("https://github.com/ou-pas/legion.git")).toBe("legion");
    expect(projectNameFromUrl("https://github.com/ou-pas/legion")).toBe("legion");
  });

  it("reads the scp form, the one behind the forges' clone button", () => {
    expect(projectNameFromUrl("git@github.com:ou-pas/legion.git")).toBe("legion");
  });

  it("goes down to the project in a nested GitLab group", () => {
    expect(projectNameFromUrl("https://gitlab.com/kopee/api/backend.git")).toBe("backend");
  });

  it("returns null on what is not a URL, rather than a made-up name", () => {
    expect(projectNameFromUrl("not a url")).toBe(null);
    expect(projectNameFromUrl("")).toBe(null);
    expect(projectNameFromUrl("https://github.com")).toBe(null);
  });
});

describe("hostOfRepoUrl, and the forge that follows", () => {
  it("reads the host of both forms", () => {
    expect(hostOfRepoUrl("https://github.com/o/r.git")).toBe("github.com");
    expect(hostOfRepoUrl("git@gitlab.com:o/r.git")).toBe("gitlab.com");
  });

  // The regression this slice fixes: `guessForge` only knew `new URL()`, so the most common clone
  // URL named no forge.
  it("guesses the forge on the scp form too", () => {
    expect(guessForge("git@github.com:ou-pas/legion.git")).toBe("github");
    expect(guessForge("git@gitlab.com:kopee/api.git")).toBe("gitlab");
  });

  it("stays cautious: an unknown host returns nothing, a self-hosted instance does not reveal itself by name", () => {
    expect(guessForge("https://git.kopee.me/infra/ansible.git")).toBe(null);
    // The suffix trap: `github.com.evil.example` is not GitHub.
    expect(guessForge("https://github.com.evil.example/x/y")).toBe(null);
  });
});

describe("instances declared by connections", () => {
  const gitlabOn = (host: string) => ({
    provider: "gitlab",
    connected: true,
    field: { suggestion: host },
  });

  it("returns the host of a connected connection that names one", () => {
    expect(declaredInstances([gitlabOn("https://framagit.org")])).toEqual([
      { host: "framagit.org", forge: "gitlab" },
    ]);
  });

  // A suggestion is not a fact: on an unconnected connection the field holds the provider's
  // default, which nobody confirmed. Inferring a forge from it would be guessing.
  it("ignores an unconnected connection", () => {
    expect(declaredInstances([{ ...gitlabOn("https://framagit.org"), connected: false }])).toEqual(
      [],
    );
  });

  it("ignores a provider that is not a forge", () => {
    expect(
      declaredInstances([
        { provider: "linear", connected: true, field: { suggestion: "https://linear.app" } },
      ]),
    ).toEqual([]);
  });

  it("ignores a connection without an instance field", () => {
    expect(declaredInstances([{ provider: "github", connected: true, field: null }])).toEqual([]);
  });

  it("infers the forge from a host a connection names, and nothing without it", () => {
    const url = "https://framagit.org/rjeanjean/legion.git";
    expect(guessForge(url)).toBe(null);
    expect(guessForge(url, declaredInstances([gitlabOn("https://framagit.org")]))).toBe("gitlab");
  });

  // A connection to another instance does not answer for this one.
  it("only answers for the declared host", () => {
    const declared = declaredInstances([gitlabOn("https://framagit.org")]);
    expect(guessForge("https://git.kopee.me/infra/ansible.git", declared)).toBe(null);
  });
});
