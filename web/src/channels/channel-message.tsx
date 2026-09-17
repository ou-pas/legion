// A turn: the only channel object with an AUTHOR (the agent speaking, the operator steering).
// Everything else (work, a push, an incident) is nobody's speech. An initial rather than an image:
// one operator and named agents, a letter tells them apart and nothing goes over the network.
import type { ReactNode } from "react";
import { Text } from "../ui/text.js";
import "./channel-message.css";

export type Speaker = "human" | "agent";

export function ChannelMessage({
  who,
  name,
  time,
  meta,
  children,
}: {
  who: Speaker;
  /** Who speaks: the agent's name, or the operator's. */
  name: string;
  /** Already formatted by the caller (a time format is a screen decision). */
  time?: string;
  /** Next to the name, e.g. a "waiting for you" chip. */
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="ch-msg" data-who={who}>
      <span className="ch-msg-av" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div className="ch-msg-body">
        <header className="ch-msg-who">
          <Text size="sm" weight="semi">
            {name}
          </Text>
          {time != null && <time className="ch-msg-time">{time}</time>}
          {meta}
        </header>
        {children}
      </div>
    </article>
  );
}

/** A message body: prose bounded to the reading measure. Separate from the message because the pinned
 *  brief and a round put SOMETHING ELSE in that place. */
export function ChannelSaid({ children }: { children: ReactNode }) {
  return <div className="ch-msg-said">{children}</div>;
}
