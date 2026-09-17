// The available models, the system "Models" tab.
//
// Read-only on purpose: the default model is chosen per project and per agent, never globally.
//
// The quota gauge used to live here and was removed on 30/08: the plan percentage is only readable
// with a credential from a normal sign-in, and the control plane's comes from
// `claude setup-token`, refused on every path. A gauge that only measures some accounts has to be
// interpreted before it can be believed.
import { useQuery } from "@tanstack/react-query";
import { modelsApi } from "../api/models.js";
import { Chip } from "../ui/chip.js";
import { Empty } from "../ui/empty.js";
import { List, ListItem } from "../ui/list.js";
import { Panel, PanelNote } from "../ui/panel.js";
import { Section } from "../ui/page.js";
import { MODELS_PANEL_TEXT as T } from "./text-panel.js";

export function ModelsPanel() {
  const { data } = useQuery({
    queryKey: ["models"] as const,
    queryFn: () => modelsApi.models(),
    staleTime: 5 * 60_000,
  });
  return (
    <>
      <Section title={T.title} count={data?.models.length} />
      <Panel>
        <PanelNote>{T.routingNote}</PanelNote>
        {/* A fallback list looks exactly like the real one: if the SDK did not answer, say so,
            or the operator picks from a stale catalogue without knowing. */}
        {data?.source === "fallback" && <PanelNote>{T.fallback}</PanelNote>}
        {data && data.models.length === 0 ? (
          <Empty variant="panel" title={T.emptyTitle}>
            {T.emptyWhy}
          </Empty>
        ) : (
          <List label={T.title}>
            {(data?.models ?? []).map((m) => (
              <ListItem
                key={m.id}
                title={m.displayName}
                sub={m.description}
                meta={m.supportsEffort ? <Chip>{T.effort(m.effortLevels.length)}</Chip> : undefined}
              />
            ))}
          </List>
        )}
      </Panel>
    </>
  );
}
