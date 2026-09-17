import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Stack } from "./flex.js";
import { Pagination } from "./pagination.js";

const meta = { title: "ui / Pagination" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const TwelvePagesPageSize: Story = {
  name: "12 pages, page size",
  render: function Render() {
    const [page, setPage] = useState(3);
    const [perPage, setPerPage] = useState(25);
    return (
      <Stack gap={10}>
        <Pagination
          page={page}
          pageCount={12}
          onPageChange={setPage}
          pageSize={perPage}
          onPageSizeChange={setPerPage}
          label="Issue pages"
        />
      </Stack>
    );
  },
};

export const FirstPageWithoutSize: Story = {
  name: "first page, no size",
  render: () => {
    return (
      <Stack gap={10}>
        <Pagination page={1} pageCount={4} onPageChange={() => {}} label="PR pages" />
      </Stack>
    );
  },
};

export const SinglePage: Story = {
  name: "a single page",
  render: () => {
    return (
      <Stack gap={10}>
        <Pagination page={1} pageCount={1} onPageChange={() => {}} label="Review pages" />
      </Stack>
    );
  },
};
