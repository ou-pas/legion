// The BRIEF: the channel's first message, and it is yours. A brief is not a settings field, it is what
// the operator told the agent before it started. Pinned, because one comes back to it: sixty lines of
// instructions are not reread by scrolling up a thread.
import { Pin } from "lucide-react";
import { Disclosure } from "../ui/disclosure.js";
import { Markdownish } from "../ui/markdownish.js";
import { Label, Text } from "../ui/text.js";
import { CHANNELS_TEXT } from "./text.js";
import "./channel-brief.css";

/** Beyond this, the instructions eat the screen before the conversation starts. */
const EXCERPT = 3;

export function ChannelBrief({ text }: { text: string }) {
  const lines = text.split("\n");
  const long = lines.length > EXCERPT + 2;
  return (
    <div className="ch-brief">
      <Label as="div" className="ch-brief-label">
        <Pin aria-hidden="true" />
        {CHANNELS_TEXT.stream.brief}
      </Label>
      {text.trim() === "" ? (
        <Text size="sm" tone="muted" as="p">
          {CHANNELS_TEXT.stream.briefEmpty}
        </Text>
      ) : long ? (
        <>
          <Markdownish text={lines.slice(0, EXCERPT).join("\n")} />
          <Disclosure flush summary={CHANNELS_TEXT.stream.briefMore(lines.length)}>
            <Markdownish text={lines.slice(EXCERPT).join("\n")} />
          </Disclosure>
        </>
      ) : (
        <Markdownish text={text} />
      )}
    </div>
  );
}
