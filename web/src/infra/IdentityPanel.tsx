// The Identity card, wired. Split from its presentation like `VersionPanel`: all four states render
// in stories, including those no healthy machine produces.
//
// Slow refresh: the identity comes from `server/.env` and only changes when the control plane
// restarts. One request when the page opens is enough.
import { useQuery } from "@tanstack/react-query";
import { authApi } from "../api/auth.js";
import { Card } from "../ui/card.js";
import { SkeletonText } from "../ui/skeleton.js";
import { IdentityCard } from "./identity-card.js";
import { IDENTITY_TEXT } from "./text-identity.js";

export const identityKey = ["auth", "identity"] as const;

export function IdentityPanel() {
  const { data } = useQuery({
    queryKey: identityKey,
    queryFn: () => authApi.identity(),
    staleTime: 10 * 60_000,
  });
  if (!data)
    return (
      <Card>
        <SkeletonText lines={3} label={IDENTITY_TEXT.loading} />
      </Card>
    );
  return <IdentityCard identity={data} />;
}
