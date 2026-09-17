// A repository and its branch: the pair recurring in the timeline (repo_ready, repo_push,
// repo_push_failed), a PR header and the draft footer. The repo name is text; branch and folder are
// literal data (Tag).
import { GitBranch } from "lucide-react";
import { Tag } from "../ui/chip.js";
import { PROJECT_TEXT } from "./text/vocabulary.js";
import "./repo-chip.css";

export function RepoChip({
  repo,
  branch,
  dir,
  className,
}: {
  repo: string;
  /** The agent's working branch, e.g. `feature/add-the-button-1a2b3c4d`. `null` is accepted like
   *  absent: a task whose branch is not fixed yet (nav slice 15) returns `null`, and forcing the
   *  caller to turn it into `undefined` would buy nothing. */
  branch?: string | null;
  /** Mount point in the container, e.g. `./repos/front`. */
  dir?: string;
  className?: string;
}) {
  return (
    <span className={["dm-repo", className].filter(Boolean).join(" ")}>
      <GitBranch size={12} aria-hidden="true" className="dm-repo-icon" />
      <span className="dm-repo-name">{repo}</span>
      {dir != null && <Tag title={dir}>{dir}</Tag>}
      {branch != null && <Tag title={PROJECT_TEXT.branch(branch)}>{branch}</Tag>}
    </span>
  );
}
