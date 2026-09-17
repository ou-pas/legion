// The Markdown subset agents actually write (reports, end-of-session notes): headings, lists,
// inline and block code, bold, links, tables. Same philosophy as Markish one step up: not a full
// parser, no injected HTML. Everything goes through our components in Prose's rhythm, and what is
// not recognised stays visible text.
import { Fragment, type ReactNode } from "react";
import { CodeBlock } from "./code.js";
import { Link } from "./link.js";
import { toBlocks, type BlockRule } from "./markdown-blocks.js";
import { Prose } from "./prose.js";
import { safeHref } from "./safe-href.js";
import { Table, Tbody, Td, Th, Thead, Tr, type CellAlign } from "./table.js";

/** Bold, inline code and links within a line. Recursive under bold for `**see \`api.ts\`**`; one
 *  level is enough for what agents produce. */
function inline(text: string): ReactNode {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <b key={i}>{inline(part.slice(2, -2))}</b>;
    const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
    // A refused scheme (`javascript:`, `data:`…) does not become a link: the text stays as written,
    // brackets included. This text comes from an agent, not the operator (05/09).
    const href = link && safeHref(link[2] ?? "");
    if (link && href)
      return (
        <Link key={i} href={href} target="_blank" rel="noreferrer">
          {link[1]}
        </Link>
      );
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
// The GFM separator row turns a run of piped lines into a table; without it they stay visible text.
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

interface TableBlock {
  kind: "table";
  head: string[];
  align: CellAlign[];
  rows: string[][];
}

// ponytail: naive split on `|`, a pipe inside `code` breaks the cell. Enough for what agents
// produce; isolate backticks first if it shows.
function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** This renderer's only extension to the shared splitting (`ui/markdown-blocks.ts`, 06/09): the GFM
 *  table. It is recognised by two lines, hence the cursor: without the following separator a
 *  piped line stays visible text. */
const tableRule: BlockRule<TableBlock> = {
  test: (line, { lines, i }) => TABLE_ROW.test(line) && TABLE_SEP.test(lines[i + 1] ?? ""),
  consume(lines, i) {
    const head = cells(lines[i] ?? "");
    const align = cells(lines[i + 1] ?? "").map((c): CellAlign =>
      c.endsWith(":") && !c.startsWith(":") ? "num" : "start",
    );
    const rows: string[][] = [];
    let n = i + 2;
    while (n < lines.length && TABLE_ROW.test(lines[n] ?? "")) {
      rows.push(cells(lines[n] ?? ""));
      n += 1;
    }
    return { block: { kind: "table", head, align, rows }, next: n };
  },
};

export function Markdownish({
  text,
  size = "sm",
  width = "full",
}: {
  text: string;
  /** `md`: one step up, for an agent's job description where the role is the page content, not a
   *  passing note. */
  size?: "sm" | "md";
  /** Follows `Prose`: `full` by default since 26/08. `measure` for long continuous reading (the
   *  wiki). */
  width?: "measure" | "full";
}) {
  return (
    <Prose size={size} width={width}>
      {toBlocks<TableBlock>(text.split("\n"), [tableRule]).map((b, i) => {
        if (b.kind === "code")
          return (
            <CodeBlock key={i} label={b.lang || "code"}>
              {b.lines.join("\n")}
            </CodeBlock>
          );
        // Prose does not style h1-h6: a heading becomes a bold lead line, the weight of a
        // `**title**`, without unpredictable browser margins or a jump in the scale.
        if (b.kind === "h")
          return (
            <p key={i}>
              <b>{inline(b.text)}</b>
            </p>
          );
        if (b.kind === "table")
          return (
            <Table key={i}>
              <Thead>
                <tr>
                  {b.head.map((c, j) => (
                    <Th key={j} align={b.align[j]}>
                      {inline(c)}
                    </Th>
                  ))}
                </tr>
              </Thead>
              <Tbody>
                {b.rows.map((row, r) => (
                  <Tr key={r}>
                    {b.head.map((_, j) => (
                      <Td key={j} align={b.align[j]}>
                        {inline(row[j] ?? "")}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </Tbody>
            </Table>
          );
        if (b.kind === "p")
          return (
            <p key={i}>
              {b.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(line)}
                </Fragment>
              ))}
            </p>
          );
        const items = b.items.map((item, j) => <li key={j}>{inline(item)}</li>);
        return b.kind === "ul" ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>;
      })}
    </Prose>
  );
}
