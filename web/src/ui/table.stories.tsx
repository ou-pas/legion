// Sorting is displayed here (arrow + aria-sort); the logic stays in the page. A "num" cell aligns
// right in tabular digits; <Num> renders the measure.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Tag } from "./chip.js";
import { Stack } from "./flex.js";
import { Num } from "./num.js";
import { Table, Tbody, Td, Th, Thead, Tr } from "./table.js";

const MODELS = [
  { model: "claude-sonnet-5", runs: 5, cost: 4.99, avgMin: 12 },
  { model: "claude-opus-5", runs: 2, cost: 1.74, avgMin: 27 },
  { model: "claude-haiku-4-5", runs: 1, cost: 0.04, avgMin: 3 },
];

const meta = { title: "ui / Table" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SortedByCostClickable: Story = {
  name: "sorted by cost (clickable)",
  render: function Render() {
    const [sort, setSort] = useState<{ key: "runs" | "cost"; dir: "asc" | "desc" }>({
      key: "cost",
      dir: "desc",
    });
    const dir = (key: "runs" | "cost") => (sort.key === key ? sort.dir : null);
    const rows = [...MODELS].sort((a, b) =>
      sort.dir === "desc" ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key],
    );
    return (
      <Stack gap={10}>
        <div className="dsd-sheet">
          <Table label="Cost per model">
            <Thead>
              <Tr>
                <Th>Model</Th>
                <Th
                  align="num"
                  sortable
                  sortDirection={dir("runs")}
                  onSort={() =>
                    setSort({ key: "runs", dir: dir("runs") === "desc" ? "asc" : "desc" })
                  }
                >
                  Sessions
                </Th>
                <Th
                  align="num"
                  sortable
                  sortDirection={dir("cost")}
                  onSort={() =>
                    setSort({ key: "cost", dir: dir("cost") === "desc" ? "asc" : "desc" })
                  }
                >
                  Cost
                </Th>
                <Th align="num">Avg duration</Th>
              </Tr>
            </Thead>
            <Tbody cols={4}>
              {rows.map((r) => (
                <Tr key={r.model}>
                  <Td>
                    <Tag>{r.model}</Tag>
                  </Td>
                  <Td align="num">
                    <Num value={r.runs} />
                  </Td>
                  <Td align="num">
                    <Num value={r.cost.toFixed(2)} prefix="$" />
                  </Td>
                  <Td align="num">
                    <Num value={r.avgMin} suffix="min" tone="muted" />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </Stack>
    );
  },
};

export const EmptyState: Story = {
  name: "empty state",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsd-sheet">
          <Table label="Cost per model, empty period">
            <Thead>
              <Tr>
                <Th>Model</Th>
                <Th align="num">Sessions</Th>
                <Th align="num">Cost</Th>
              </Tr>
            </Thead>
            <Tbody cols={3} empty="No session in this period — the Demo project is read-only.">
              {[]}
            </Tbody>
          </Table>
        </div>
      </Stack>
    );
  },
};
