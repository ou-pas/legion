// A dated FACT that is nobody's speech: a push, an incident, a session end, a wait. It has its place
// in time, which is the point of reading it here rather than in a status column: you see WHAT
// interrupted the conversation, and where. No drawing of its own: a design system banner; this
// module only translates runner vocabulary into tone and sentence.
import { Banner, type BannerTone } from "../ui/banner.js";
import { CHANNELS_TEXT } from "./text.js";
import type { NoticeCode, NoticeTone } from "./transcript.js";

/** `neutral` is not a semantic tone: an ordinary fact stays on the sheet. */
const TONE: Record<NoticeTone, BannerTone> = {
  neutral: "info",
  wait: "wait",
  bad: "bad",
  ok: "ok",
};

export function ChannelNotice({
  tone,
  code,
  detail,
}: {
  tone: NoticeTone;
  code: NoticeCode;
  detail: string;
}) {
  return <Banner tone={TONE[tone]} title={CHANNELS_TEXT.notice[code](detail)} />;
}
