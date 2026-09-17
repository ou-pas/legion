// The project's environment registry: the network allowlist applied by the egress proxy. It had no
// screen until task 08: an agent referenced environmentId without anyone seeing what it could
// reach. "Agents using it" comes from bootstrap (already loaded for the whole app) rather than a
// dedicated route.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Plus } from "lucide-react";
import { environmentsApi } from "../api/environments.js";
import { bootstrapQuery, environmentsQuery, qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Empty } from "../ui/empty.js";
import { Row, Stack } from "../ui/flex.js";
import { Field, FormError, FormRow } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Inset } from "../ui/inset.js";
import { List } from "../ui/list.js";
import { Caption } from "../ui/text.js";
import { EnvironmentRow } from "./EnvironmentRow.js";
import { ENVIRONMENTS_TEXT } from "./text/environments.js";

export function EnvironmentsSection({ projectId }: { projectId: string }) {
  const { data: environments = [] } = useQuery(environmentsQuery(projectId));
  const { data: boot } = useQuery(bootstrapQuery);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [hosts, setHosts] = useState("");
  const [error, setError] = useState("");
  const invalidate = () => void qc.invalidateQueries({ queryKey: qk.environments(projectId) });

  const projectAgents = (boot?.agents ?? []).filter((a) => a.projectId === projectId);
  const agentNamesFor = (environmentId: string) =>
    projectAgents.filter((a) => a.environmentId === environmentId).map((a) => a.name);
  const withoutEnvironment = projectAgents.filter((a) => !a.environmentId);

  const add = async () => {
    setError("");
    try {
      await environmentsApi.createEnvironment({
        projectId,
        name: name.trim(),
        allowedHosts: hosts
          .split(",")
          .map((h) => h.trim())
          .filter(Boolean),
      });
      setName("");
      setHosts("");
      invalidate();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };

  return (
    <Card icon={<Globe size={16} />} title={ENVIRONMENTS_TEXT.title} desc={ENVIRONMENTS_TEXT.desc}>
      <Stack gap={10}>
        {environments.length === 0 ? (
          <Empty variant="inline" title={ENVIRONMENTS_TEXT.emptyTitle}>
            {ENVIRONMENTS_TEXT.emptyBody}
          </Empty>
        ) : (
          <List label={ENVIRONMENTS_TEXT.listLabel}>
            {environments.map((env) => (
              <EnvironmentRow
                key={env.id}
                env={env}
                agentNames={agentNamesFor(env.id)}
                onChange={invalidate}
                onError={setError}
              />
            ))}
          </List>
        )}

        {/* "No environment" is not an error, so no bad/wait tone: a plain Caption where a list meta
            would sit. It is a scope fact: the screen shows it, it does not judge it. */}
        {withoutEnvironment.length > 0 && (
          <Inset tone="recess" label={ENVIRONMENTS_TEXT.noEnvironmentLabel}>
            <Caption title={withoutEnvironment.map((a) => a.name).join(", ")}>
              {ENVIRONMENTS_TEXT.noEnvironmentBody(withoutEnvironment.length)}
            </Caption>
          </Inset>
        )}

        <Inset label={ENVIRONMENTS_TEXT.form.addLabel}>
          <Stack gap={10}>
            <FormRow>
              <Field label={ENVIRONMENTS_TEXT.form.nameLabel} required>
                <Input
                  placeholder={ENVIRONMENTS_TEXT.form.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field
                label={ENVIRONMENTS_TEXT.form.hostsLabel}
                hint={ENVIRONMENTS_TEXT.form.hostsHint}
              >
                <Input
                  placeholder={ENVIRONMENTS_TEXT.form.hostsPlaceholder}
                  value={hosts}
                  onChange={(e) => setHosts(e.target.value)}
                />
              </Field>
            </FormRow>
            <Row gap={8} wrap>
              <Button
                variant="primary"
                leading={<Plus size={12} />}
                onClick={add}
                disabled={!name.trim()}
              >
                {ENVIRONMENTS_TEXT.form.submit}
              </Button>
            </Row>
            {error && <FormError>{error}</FormError>}
          </Stack>
        </Inset>
      </Stack>
    </Card>
  );
}
