// What Docker really has, compared with what we promise it (26/08).
//
// That ceiling comes before ours, and nobody read it. On Docker Desktop the VM has its own
// allocation: three sessions at 4 GB in an 8 GB VM do not make 12 GB, they bring the VM down. Making
// session RAM adjustable without showing this number would have moved the silence one step: "why
// does my agent die" replaced by "why does Docker die".
//
// The computation is deliberately the worst case: session cap × RAM per session, what the queue can
// reserve at once, so what must be available.
import { Banner } from "../ui/banner.js";
import { Caption } from "../ui/text.js";
import { INFRA_TEXT } from "./text.js";

export function RunnerCapacity({
  maxConcurrentSessions,
  memoryMb,
  hostMemoryMb,
}: {
  maxConcurrentSessions: number;
  memoryMb: number;
  hostMemoryMb: number | null;
}) {
  const need = maxConcurrentSessions * memoryMb;
  // Unknown: say so, rather than suggest the check was made. Silence here would read as a green light.
  if (hostMemoryMb === null) return <Caption>{INFRA_TEXT.capacity.unknown}</Caption>;
  if (need > hostMemoryMb)
    return (
      <Banner tone="bad" title={INFRA_TEXT.capacity.over(need, hostMemoryMb)}>
        {INFRA_TEXT.capacity.overWhy}
      </Banner>
    );
  return <Caption>{INFRA_TEXT.capacity.fits(need, hostMemoryMb)}</Caption>;
}
