// The gate (13/09): what mounts before the application, and what mounts instead of it.
//
// It sits above the router, in `main.tsx`, not inside a route. A screen's requests start from its
// hooks, and hooks run before the first `return`: a gate inside the shell would have let through
// the calls it claims to block, and produced forty 401s in the console instead of a sign-in screen.
//
// It keeps nothing in memory: the truth is the `httpOnly` cookie, which this code cannot read, so
// the only way to know is to ask the server.
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { operatorApi } from "../api/operator.js";
import { Text } from "../ui/text.js";
import { SignIn } from "./sign-in.js";
import { TokenSetup } from "./token-setup.js";
import { OPERATOR_TEXT } from "./text.js";

/** The "do I have a session" key. Kept apart so that signing out can invalidate it without
 *  knowing the rest of the cache. */
export const OPERATOR_SESSION_KEY = ["operator", "session"] as const;

/** The "has any session ever opened" key, asked once the gate is confirmed shut. Separate from
 *  `OPERATOR_SESSION_KEY`: this one decides which screen explains the token, not whether one is
 *  held right now. */
export const OPERATOR_SETUP_KEY = ["operator", "setup"] as const;

export function OperatorGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  // A session opened elsewhere (another tab) cannot be guessed: ask again on every window focus
  // rather than trust a cache.
  const session = useQuery({
    queryKey: OPERATOR_SESSION_KEY,
    queryFn: operatorApi.whoAmI,
    retry: false,
    staleTime: 0,
  });
  const [entered, setEntered] = useState(false);
  // `entered` covers the gap between the server's answer and the cache refresh: without it, the
  // sign-in screen flashes once more after a successful entry.
  const gateShut = !entered && !session.data?.authenticated;
  // Asked only once the gate is confirmed shut: a signed-in operator never needs the answer, and
  // asking earlier would race the session check for nothing. A failed or absent answer (the route
  // is not always deployed yet, see scripts/api-pending.json) falls back to the plain SignIn.
  const setup = useQuery({
    queryKey: OPERATOR_SETUP_KEY,
    queryFn: operatorApi.setupStatus,
    enabled: !session.isPending && gateShut,
    retry: false,
    staleTime: 0,
  });

  async function signIn(token: string) {
    await operatorApi.signIn(token);
    setEntered(true);
    // The whole cache is cleared, not just the session key: everything requested before entering
    // got a 401, and those refusals must not stay cached behind the gate.
    await client.invalidateQueries();
  }

  if (session.isPending || (gateShut && setup.isPending)) {
    return (
      <div className="op-signin">
        <Text tone="muted">{OPERATOR_TEXT.checking}</Text>
      </div>
    );
  }

  if (gateShut)
    return setup.data?.required ? <TokenSetup onSignIn={signIn} /> : <SignIn onSignIn={signIn} />;

  return <>{children}</>;
}
