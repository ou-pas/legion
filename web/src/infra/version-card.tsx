// The Version card (26/08): what runs, what exists, and the gesture between them.
//
// Presentational: it receives state and returns the click. The wired component is `VersionPanel`,
// next to it, which lets its six states have stories, including those a real machine cannot produce
// at will.
//
// Four verdicts, none confusable. Up to date. A version exists. Ahead of the last tag (unpublished
// code runs, the normal state when developing). Unknown (GitHub did not answer, or the repository
// was never tagged). The last two were the traps: silence reads as "up to date", and being ahead
// read as "no version", which offered a downgrade.
//
// What prevents the update is a note, not a verdict. A blocker resolves on its own (the session
// ends, the commit lands); putting it in the pill overwrote the real state with a final word.
import { RefreshCw, Tag } from "lucide-react";
import type { VersionState } from "../api/version.js";
import { Button } from "../ui/button.js";
import { StatusChip } from "../ui/chip.js";
import { Code } from "../ui/code.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Panel, PanelHeader, PanelNote, PanelRow } from "../ui/panel.js";
import { Caption, Text } from "../ui/text.js";
import { VERSION_TEXT } from "./text-version.js";

export function VersionCard({
  state,
  busy = false,
  onUpdate,
  onRecheck,
}: {
  state: VersionState;
  busy?: boolean;
  /** `suspend` says which of the two gestures was clicked: the ordinary update, or the one that
   *  suspends first. One callback rather than two, so the caller need not know which form it showed. */
  onUpdate: (suspend: boolean) => void;
  onRecheck: () => void;
}) {
  const t = VERSION_TEXT;
  const canUpdate = state.blocker === null && state.target !== null;
  // The only blocker a gesture can clear (08/09). The others (dirty tree, detached HEAD, image
  // without a version) have no answer from this screen, and a button would lie.
  const canSuspend =
    state.blocker === "sessions" && state.target !== null && state.activeSessions > 0;
  const note = noteFor(state);
  return (
    <Panel>
      <PanelHeader icon={<Tag size={15} />} title={t.title}>
        {chipFor(state)}
      </PanelHeader>

      {/* One line (04/09, operator feedback: "like a task's status"): the version, its mode, the
          step to the target if any, and the gestures at the end. Three rows read as three subjects;
          it is one fact with its two buttons. */}
      <PanelRow>
        <Row gap={10} align="center" wrap>
          <Code>{t.running(state)}</Code>
          {/* The mode, next to the version and not in the pill: the pill says whether something
              better exists, this says where you are. Confusing them was the 01/09 trap: a server
              showed "detached HEAD" and sent people looking for a git clone. */}
          <Caption>{t.mode(state.mode)}</Caption>
          {state.target && (
            <>
              {/* The step reads from the last reachable tag. "→ v0.1.0" without an origin, on a HEAD
                  already past it, described a step back as a step forward. */}
              <Text size="sm">{t.step(state.current ?? state.lastTag, state.target)}</Text>
              {state.commits.length > 0 && <Caption>{t.commits(state.commits.length)}</Caption>}
            </>
          )}
          <Spacer />
          {canUpdate && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => onUpdate(false)}>
              {busy ? t.starting : t.update}
            </Button>
          )}
          {canSuspend && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => onUpdate(true)}>
              {busy ? t.starting : t.suspendAndUpdate(state.activeSessions)}
            </Button>
          )}
          <Button size="sm" leading={<RefreshCw size={13} />} onClick={onRecheck}>
            {t.recheck}
          </Button>
        </Row>
      </PanelRow>

      {/* The subjects of the commits in between: "6 commits behind" without saying of what helps
          nobody decide whether to update now. */}
      {state.commits.length > 0 && (
        <PanelRow>
          <Stack gap={2}>
            {state.commits.slice(0, 5).map((c) => (
              <Caption key={c}>{c}</Caption>
            ))}
            {state.commits.length > 5 && <Caption>{t.andMore(state.commits.length - 5)}</Caption>}
          </Stack>
        </PanelRow>
      )}

      {/* One note, chosen by `noteFor`. The first version showed two when the comparison failed
          (the refusal, then "GitHub unreachable"), the second repeating the first more vaguely. */}
      {note && <PanelNote tone={note.tone}>{note.text}</PanelNote>}
    </Panel>
  );
}

/**
 * The pill says what is, not what you can do.
 *
 * It showed "Impossible" in red whenever a blocker existed, so while a session ran, the ordinary
 * state of a working machine. It announced a failure where there was a three-minute wait, and hid
 * the useful fact that a version exists. The note below carries the obstacle and its remedy.
 */
function chipFor(state: VersionState) {
  const t = VERSION_TEXT;
  if (!state.reachable) return <StatusChip state="idle">{t.unknown}</StatusChip>;
  if (state.target) return <StatusChip state="wait">{t.available(state.target)}</StatusChip>;
  // Nothing newer out there, but unpublished code runs here. "Up to date" would be wrong.
  if (state.ahead > 0) return <StatusChip state="idle">{t.ahead}</StatusChip>;
  return <StatusChip state="ok">{t.upToDate}</StatusChip>;
}

/** One note, never two, in causal order: what the server said first, then the repository state. */
function noteFor(state: VersionState): { tone: "neutral" | "wait"; text: string } | null {
  const t = VERSION_TEXT;
  if (state.reason) return { tone: "wait", text: state.reason };
  if (!state.reachable) return null;
  if (!state.lastTag) return { tone: "neutral", text: t.noTags };
  if (state.ahead > 0 && !state.target) {
    return { tone: "neutral", text: t.aheadNote(state.ahead, state.lastTag) };
  }
  return null;
}
