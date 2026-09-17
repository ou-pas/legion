// Which account this run uses: the question, and its memory.
//
// Switching credentials is FREE: the credential is reread at EVERY container start. Nothing enters
// through `docker run -e`: the container gets a URL and a nonce, calls the control plane back, and
// the payload sets the variables in its own process environment. A resume therefore starts on the
// account available at wake-up, without a line of resume code.
//
// What had to be added is the MEMORY of that choice. Without it, an out-of-quota stop would reread
// the resolution afterwards, find the NEXT account, and mark as exhausted an account that is not,
// leaving alive the one that just died.
import { resolveProjectCredential } from "../projects/auth.js";
import { rememberSessionCredential } from "./session-credential-store.js";

/** The credential variables for THIS run, remembered on the session along the way.
 *
 *  Rewritten at every spec build, hence every resume: a session restarting after a switch runs on
 *  another account than the one that stopped, and the CURRENT one is what counts. `null` = fallback
 *  (unranked project secret, control plane environment): neither is schedulable, so neither gets
 *  exhausted. */
export function sessionCredentialEnv(sessionId: string, projectId: string): Record<string, string> {
  const resolved = resolveProjectCredential(projectId);
  rememberSessionCredential(sessionId, resolved.credentialId);
  return resolved.env;
}
