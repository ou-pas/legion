// A demo project for the settings card stories. Its own module because five story files need it
// word for word: copying a seventeen-field literal five times is how a field added to `Project`
// breaks five files instead of one.
import type { Project } from "../api/projects.js";

export const demoProject = (over: Partial<Project> = {}): Project => ({
  id: "p1",
  name: "Acme",
  slug: "acme",
  defaultModel: "sonnet",
  repoUrl: null,
  fsRoot: null,
  context: "",
  demo: false,
  gitAuthorName: null,
  gitAuthorEmail: null,
  defaultSkillNames: "[]",
  modelRouting: "{}",
  chainBindings: "{}",
  sessionImage: null,
  sessionDockerfile: null,
  sshKeyPath: null,
  hue: null,
  ...over,
});
