// A tool call, readable on one line.
//
// The timeline used to show `JSON.stringify(input)` truncated to 300 characters by the server, in a
// <Tag> with a native `title`. Three stacked defects: CSS cut the text WITHOUT an ellipsis (a
// command looked wrong rather than incomplete), the native `title` is slow and unstyleable, and
// nobody wants to read `{"replace_all":false,"file_path":"/workspace/repos/legion/web/src/api.ts",…}`:
// one wants WHICH FILE.
//
// This module extracts the meaningful field per tool. The full payload stays available: timeline
// rows expand into a <CodeBlock>. A tooltip is not a code block, so it gets one line, and only when
// the text was actually truncated.
import { Tag } from "../ui/chip.js";
import { Tooltip } from "../ui/tooltip.js";
import { SESSION_TEXT } from "./text.js";

/** Enough for a short command or a full path; below a timeline row's width, so the ellipsis comes
 *  from US and not from CSS. */
const MAX = 88;

/** The container work prefix says nothing, every path starts with it.
 *  `/workspace/repos/legion/web/src/api.ts` → `web/src/api.ts`. */
function shortPath(p: string): string {
  return p.replace(/^\/workspace\/repos\/[^/]+\//, "").replace(/^\/workspace\//, "");
}

/** The meaningful field, per tool. An unknown tool falls back to raw JSON: readable noise beats an
 *  empty line hiding the information. */
// oxlint-disable-next-line complexity -- lookup table: one tool per case, each naming its payload's meaningful field
export function describeToolInput(tool: string, raw: string): string {
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw;
  } // truncated by the server mid-string: unreadable, but honest
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);

  switch (tool) {
    case "Bash":
      return str("command") ?? raw;
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": {
      const p = str("file_path") ?? str("path");
      return p ? shortPath(p) : raw;
    }
    case "Glob":
    case "Grep": {
      const pattern = str("pattern");
      const where = str("path");
      if (!pattern) return raw;
      return where ? SESSION_TEXT.toolCall.patternIn(pattern, shortPath(where)) : pattern;
    }
    case "Task":
    case "Agent":
      return str("description") ?? str("prompt") ?? raw;
    case "ToolSearch":
      return str("query") ?? raw;
    case "WebFetch":
    case "WebSearch":
      return str("url") ?? str("query") ?? raw;
    default: {
      // Legion tools (mcp__legion__*) almost all carry a `path` or a `name`.
      const p = str("path");
      if (p) return shortPath(p);
      return str("name") ?? str("status") ?? raw;
    }
  }
}

/** The tool name, then its argument that matters, truncated by US with a real ellipsis, the whole
 *  on hover only if truncation happened. */
export function ToolCall({ tool, input }: { tool: string; input?: string }) {
  if (!input) return <>{tool}</>;
  const full = describeToolInput(tool, input);
  if (full.length <= MAX)
    return (
      <>
        {tool} <Tag>{full}</Tag>
      </>
    );
  // `…` is a real character, not three dots: it tells "truncated" from "the command ends with dots".
  return (
    <>
      {tool}{" "}
      {/* side="right": the timeline is a dense list (~30px rows), and top/bottom would cover the
          adjacent row. */}
      <Tooltip label={full} side="right">
        <Tag>{`${full.slice(0, MAX)}…`}</Tag>
      </Tooltip>
    </>
  );
}
