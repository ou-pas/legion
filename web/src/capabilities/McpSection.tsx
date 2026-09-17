// The project's external MCP server registry. Secrets never cross the UI in clear: a header cites
// `${SECRET:NAME}`, and the control plane resolves the reference when the session starts.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, Plus, Server, Trash2 } from "lucide-react";
import { capabilitiesApi } from "../api/capabilities.js";
import { mcpServersQuery, qk } from "../queries.js";
import { Button, IconBtn } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Chip, Tag } from "../ui/chip.js";
import { Checkbox } from "../ui/choice.js";
import { Code } from "../ui/code.js";
import { Ellipsis } from "../ui/ellipsis.js";
import { Empty } from "../ui/empty.js";
import { Row, Stack } from "../ui/flex.js";
import { Field, FormError, FormRow } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Inset } from "../ui/inset.js";
import { List, ListRow } from "../ui/list.js";
import { MCP_TEXT } from "./text/mcp.js";

const SECRET_REF = "${SECRET:NAME}";
// The example the operator copies, so it composes no prefix (round 1, 15/09).
//
// It used to carry `Bearer ${SECRET:LINEAR_TOKEN}`, assuming that name holds an OAuth token: a guess
// about what the operator stored, the exact reasoning `AUTH_FORMAT`
// (`server/src/connections/providers.ts`) removed that day. And it became reachable: pasted-token
// adoption (`connections/adopt-pasted.ts`) now writes a personal key under `LINEAR_TOKEN`, sent raw,
// which `Bearer` breaks.
//
// `${SECRET:…}` only sees a name, with no access to `metadata.authFormat`, so nobody can compose the
// prefix correctly today. The example shows the substitution and leaves the operator to write the
// format the provider asks for.
const HEADERS_EXAMPLE = '{"authorization":"${SECRET:LINEAR_TOKEN}"}';

export function McpSection({ projectId }: { projectId: string }) {
  const { data: mcpServers = [] } = useQuery(mcpServersQuery(projectId));
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<"http" | "sse" | "stdio">("http");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [headers, setHeaders] = useState("");
  const [hosts, setHosts] = useState("");
  const [error, setError] = useState("");
  const invalidate = () => void qc.invalidateQueries({ queryKey: qk.mcpServers(projectId) });

  const add = async () => {
    setError("");
    let parsedHeaders: Record<string, string> | undefined;
    if (headers.trim()) {
      try {
        parsedHeaders = JSON.parse(headers) as Record<string, string>;
      } catch {
        setError(MCP_TEXT.invalidHeaders);
        return;
      }
    }
    const config: Record<string, unknown> =
      type === "stdio"
        ? {
            type,
            command: command.trim().split(/\s+/)[0],
            args: command.trim().split(/\s+/).slice(1),
          }
        : { type, url: url.trim(), ...(parsedHeaders ? { headers: parsedHeaders } : {}) };
    try {
      await capabilitiesApi.createMcpServer({
        projectId,
        name: name.trim(),
        config,
        allowedHosts: hosts
          .split(",")
          .map((h) => h.trim())
          .filter(Boolean),
      });
      setName("");
      setUrl("");
      setCommand("");
      setHeaders("");
      setHosts("");
      invalidate();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };

  return (
    <Card
      icon={<Plug size={16} />}
      title={MCP_TEXT.title}
      desc={
        <>
          {MCP_TEXT.descBeforeRef} <code>{SECRET_REF}</code> {MCP_TEXT.descAfterRef}
        </>
      }
    >
      <Stack gap={10}>
        {mcpServers.length === 0 ? (
          <Empty variant="inline" title={MCP_TEXT.emptyTitle}>
            {MCP_TEXT.emptyBody}
          </Empty>
        ) : (
          <List density="compact" label={MCP_TEXT.listLabel}>
            {mcpServers.map((s) => (
              <ListRow
                key={s.id}
                leading={<Server size={14} />}
                meta={
                  <Row gap={8} align="center">
                    {s.allowedHosts.length > 0 && (
                      <Chip size="sm" mono title={s.allowedHosts.join(", ")}>
                        {MCP_TEXT.hostCount(s.allowedHosts.length)}
                      </Chip>
                    )}
                    {/* v35: the same checkbox as on a rule. An MCP server adds tools but opens no
                      project data by itself, which allows a default here and will always forbid one
                      for a secret or a repository. */}
                    <Checkbox
                      checked={s.allAgents}
                      onChange={(v) =>
                        void capabilitiesApi
                          .patchMcpServer(s.id, { allAgents: v })
                          .then(
                            () => void qc.invalidateQueries({ queryKey: qk.mcpServers(projectId) }),
                          )
                          .catch((e: Error) => setError(e.message))
                      }
                    >
                      {MCP_TEXT.allAgents}
                    </Checkbox>
                  </Row>
                }
                actions={
                  <IconBtn
                    title={MCP_TEXT.delete}
                    danger
                    onClick={() =>
                      capabilitiesApi
                        .deleteMcpServer(s.id)
                        .then(() => {
                          invalidate();
                          void qc.invalidateQueries({ queryKey: qk.bootstrap });
                        })
                        .catch((e: Error) => setError(e.message))
                    }
                  >
                    <Trash2 size={13} />
                  </IconBtn>
                }
              >
                <Code variant="bare">{s.name}</Code>
                <Tag>{s.type}</Tag>
                <Ellipsis>{s.url ?? s.command ?? ""}</Ellipsis>
              </ListRow>
            ))}
          </List>
        )}

        <Inset label={MCP_TEXT.form.label}>
          <Stack gap={10}>
            <FormRow>
              <Field label={MCP_TEXT.form.nameLabel} required>
                <Input
                  placeholder={MCP_TEXT.form.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label={MCP_TEXT.form.transportLabel}>
                <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                  <option value="http">http</option>
                  <option value="sse">sse</option>
                  <option value="stdio">stdio</option>
                </Select>
              </Field>
              <Field label={MCP_TEXT.form.hostsLabel} hint={MCP_TEXT.form.hostsHint}>
                <Input
                  placeholder={MCP_TEXT.form.hostsPlaceholder}
                  value={hosts}
                  onChange={(e) => setHosts(e.target.value)}
                />
              </Field>
            </FormRow>
            {type === "stdio" ? (
              <Field label={MCP_TEXT.form.commandLabel} required hint={MCP_TEXT.form.commandHint}>
                <Input
                  placeholder={MCP_TEXT.form.commandPlaceholder}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                />
              </Field>
            ) : (
              <>
                <Field label={MCP_TEXT.form.urlLabel} required>
                  <Input
                    placeholder={MCP_TEXT.form.urlPlaceholder}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </Field>
                <Field
                  label={MCP_TEXT.form.headersLabel}
                  hint={
                    <>
                      {MCP_TEXT.form.headersHintBeforeRef} <Code variant="bare">{SECRET_REF}</Code>{" "}
                      {MCP_TEXT.form.headersHintAfterRef}
                    </>
                  }
                >
                  <Input
                    placeholder={HEADERS_EXAMPLE}
                    value={headers}
                    onChange={(e) => setHeaders(e.target.value)}
                  />
                </Field>
              </>
            )}
            <Row gap={8} wrap>
              <Button
                variant="primary"
                leading={<Plus size={12} />}
                onClick={add}
                disabled={!name.trim() || (type === "stdio" ? !command.trim() : !url.trim())}
              >
                {MCP_TEXT.form.submit}
              </Button>
            </Row>
            {error && <FormError>{error}</FormError>}
          </Stack>
        </Inset>
      </Stack>
    </Card>
  );
}
