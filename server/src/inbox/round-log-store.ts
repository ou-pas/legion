// Writing the interview round log to disk; the rule is in `round-log.ts`.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createLogger } from "../shared/log.js";
import { taskArtifactsDir } from "../tasks/artifacts/dir.js";
import { ROUND_LOG_FILE, ROUND_LOG_HEADER } from "./round-log.js";

const log = createLogger("inbox");

/**
 * Appends a round to the task's log. Returns `true` if written.
 *
 * Appends, never rewrites: each round is a dated fact, and a file rewritten each time is one a
 * crash leaves half-written.
 *
 * Never throws: it runs on the path that answers the operator and resumes the session, so a full
 * disk or a moved project folder must cost a log line, never an agent's resume.
 */
export function appendRoundLog(taskId: string, markdown: string): boolean {
  try {
    const found = taskArtifactsDir(taskId);
    if (!found) return false;
    mkdirSync(found.dir, { recursive: true });
    const file = path.join(found.dir, ROUND_LOG_FILE);
    const head = existsSync(file) ? "" : ROUND_LOG_HEADER;
    appendFileSync(file, `${head}\n${markdown}\n`, "utf8");
    return true;
  } catch (err) {
    log.warn("interview round log not written", { taskId, error: String((err as Error)?.message) });
    return false;
  }
}
