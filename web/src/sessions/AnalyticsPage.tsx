// Cost / duration / failure rate per agent and model, to decide routing: which agent deserves a big
// model, where a small one is enough.
import { useQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { sessionsApi } from "../api/sessions.js";
import { Card } from "../ui/card.js";
import { Tag } from "../ui/chip.js";
import { Stack } from "../ui/flex.js";
import { Num, type NumTone } from "../ui/num.js";
import { Page } from "../ui/page.js";
import { Panel } from "../ui/panel.js";
import { Prose } from "../ui/prose.js";
import { SkeletonText } from "../ui/skeleton.js";
import { Stat, StatGroup } from "../ui/stat.js";
import { Table, Tbody, Td, Th, Thead, Tr } from "../ui/table.js";
import { Text } from "../ui/text.js";
import { SESSION_TEXT } from "./text.js";
import { SYSTEM_TEXT } from "../system/text.js";

const analyticsQuery = queryOptions({
  queryKey: ["analytics"] as const,
  queryFn: () => sessionsApi.analytics(),
  refetchInterval: 15_000,
});

/** An average duration reads in the unit of its magnitude: 161 ms is not "0 s". */
function duration(ms: number): { value: number; unit: string } {
  if (ms >= 60_000) return { value: Math.round(ms / 60_000), unit: "min" };
  if (ms >= 1_000) return { value: Math.round(ms / 1_000), unit: "s" };
  return { value: Math.round(ms), unit: "ms" };
}

/** A failure rate above a third alarms; an isolated failure warns; zero stays quiet. */
function failTone(failRate: number, failed: number): NumTone {
  if (failRate > 0.3) return "bad";
  return failed > 0 ? "wait" : "muted";
}

const modelShort = (m: string) => m.replace("claude-", "").replace(/-\d+$/, "");

export function AnalyticsPage() {
  const { data: rows = [], isLoading } = useQuery(analyticsQuery);
  const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);
  const totalRuns = rows.reduce((s, r) => s + r.runs, 0);
  const totalFailed = rows.reduce((s, r) => s + r.failed, 0);

  return (
    <Page title={SESSION_TEXT.analytics.title} sub={SYSTEM_TEXT.analyticsSub}>
      <Stack gap={14}>
        <StatGroup label={SESSION_TEXT.analytics.totals}>
          <Stat
            label={SESSION_TEXT.analytics.runs}
            value={totalRuns}
            hint={SESSION_TEXT.analytics.pairs(rows.length)}
          />
          <Stat
            label={SESSION_TEXT.analytics.failed}
            value={totalFailed}
            tone={totalFailed > 0 ? "wait" : "muted"}
            hint={
              totalRuns > 0
                ? SESSION_TEXT.analytics.failedShare(Math.round((totalFailed / totalRuns) * 100))
                : SESSION_TEXT.analytics.noSession
            }
          />
          <Stat label={SESSION_TEXT.analytics.cost} value={totalCost.toFixed(2)} prefix="$" />
        </StatGroup>

        {isLoading ? (
          <Card>
            <SkeletonText lines={5} label={SESSION_TEXT.analytics.loading} />
          </Card>
        ) : (
          // Panel, not Card: it clips its corners, so the table header does not overflow the radius.
          <Panel>
            <Table label={SESSION_TEXT.analytics.tableLabel}>
              <Thead>
                <Tr>
                  <Th>{SESSION_TEXT.analytics.columns.agent}</Th>
                  <Th>{SESSION_TEXT.analytics.columns.model}</Th>
                  <Th align="num">{SESSION_TEXT.analytics.columns.runs}</Th>
                  <Th align="num">{SESSION_TEXT.analytics.columns.failed}</Th>
                  <Th align="num">{SESSION_TEXT.analytics.columns.failRate}</Th>
                  <Th align="num">{SESSION_TEXT.analytics.columns.duration}</Th>
                  <Th align="num">{SESSION_TEXT.analytics.columns.cost}</Th>
                </Tr>
              </Thead>
              <Tbody cols={7} empty={SESSION_TEXT.analytics.empty}>
                {rows.map((r) => {
                  const dur = duration(r.avgDurationMs);
                  const tone = failTone(r.failRate, r.failed);
                  return (
                    <Tr key={`${r.agent}:${r.model}`}>
                      <Td>
                        <Text weight="semi">{r.agent}</Text>
                      </Td>
                      <Td>
                        <Tag title={r.model}>{modelShort(r.model)}</Tag>
                      </Td>
                      <Td align="num">
                        <Num value={r.runs} align="end" />
                      </Td>
                      <Td align="num">
                        <Num value={r.failed} tone={tone} align="end" />
                      </Td>
                      <Td align="num">
                        {r.runs > 0 ? (
                          <Num
                            value={Math.round(r.failRate * 100)}
                            suffix="%"
                            tone={tone}
                            align="end"
                          />
                        ) : (
                          <Text tone="subtle">—</Text>
                        )}
                      </Td>
                      <Td align="num">
                        <Num value={dur.value} suffix={dur.unit} tone="muted" align="end" />
                      </Td>
                      <Td align="num">
                        <Num value={r.costUsd.toFixed(3)} prefix="$" align="end" />
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </Panel>
        )}

        <Prose size="sm" tone="muted">
          <p>{SESSION_TEXT.analytics.reading}</p>
        </Prose>
      </Stack>
    </Page>
  );
}
