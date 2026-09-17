// The operator session, seen from the screen (13/09).
//
// `whoAmI` must answer even without a session, since it is the question asked BEFORE having one.
// The server returns 200 with `authenticated: false` rather than a 401: a 401 here would read as a
// failure to display, when it is an answer to read.
import { json, post } from "./client.js";

export type OperatorMethod = "token" | "passkey";

export type OperatorSession = {
  authenticated: boolean;
  /** How the session was obtained. `passkey` comes with WebAuthn. */
  method: OperatorMethod | null;
};

export const operatorApi = {
  whoAmI: (): Promise<OperatorSession> => fetch("/api/operator/session").then(json),

  /** The server sets the cookie; nothing is kept on the screen side, since a token in
   *  `localStorage` would be readable by any injected script. */
  signIn: (token: string): Promise<OperatorSession> => post("/api/operator/session", { token }),

  signOut: (): Promise<null> => fetch("/api/operator/session", { method: "DELETE" }).then(json),
};
