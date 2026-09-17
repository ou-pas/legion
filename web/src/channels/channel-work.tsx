// What the agent DID between two turns, folded into a one-line band. The decision that makes the
// view bearable: 333 events cannot become 333 messages. The band reads without expanding ("worked
// 4 min, 61 tools, 18 reads, 0 writes") and expands to a sample. The full count stays in the task
// page trace: this summarises, it does not replace.
import { Disclosure } from "../ui/disclosure.js";
import { shortDuration } from "../ui/duration.js";
import { Caption } from "../ui/text.js";
import { CHANNELS_TEXT } from "./text.js";
import type { WorkBand } from "./work-band.js";
import "./channel-work.css";

export function ChannelWork({ band }: { band: WorkBand }) {
  const summary = (
    <Caption as="span">
      <b>{CHANNELS_TEXT.work.worked(shortDuration(band.durationMs))}</b>
      {" — "}
      {CHANNELS_TEXT.work.counts(band.tools, band.reads, band.writes)}
    </Caption>
  );
  return (
    <Disclosure className="ch-work" flush summary={summary}>
      <ul className="ch-work-list" aria-label={CHANNELS_TEXT.work.label}>
        {band.lines.map((l, i) => (
          <li key={i} className="ch-work-line">
            <b className="ch-work-verb">{l.verb}</b>
            <span className="ch-work-target">{l.target}</span>
          </li>
        ))}
        {band.more > 0 && (
          <li className="ch-work-line" data-more="">
            <span className="ch-work-target">{CHANNELS_TEXT.work.more(band.more)}</span>
          </li>
        )}
      </ul>
    </Disclosure>
  );
}
