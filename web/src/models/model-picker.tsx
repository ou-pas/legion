// Pick a model: from the list, or by typing an id the list does not know.
//
// The probe warns, it does not refuse, and that is the server's decision: `claude-opus-4-8` was
// pinned on 23/08 and ran, although no `supportedModels()` announced it. The SDK list cannot
// arbitrate; the only refusal that counts is session init, which names its error.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { modelsApi, type ModelChoice } from "../api/models.js";
import { IconBtn } from "../ui/button.js";
import { Row, Stack } from "../ui/flex.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { ModelVerdict } from "./model-verdict.js";
import { MODEL_TEXT } from "./text.js";

export function ModelPicker({
  value,
  onChange,
  models,
  emptyLabel,
  ariaLabel,
  projectId,
}: {
  value: string;
  onChange: (id: string) => void;
  models: readonly ModelChoice[];
  /** What "nothing chosen" means here: the project default, or the project model. */
  emptyLabel: string;
  ariaLabel: string;
  /** The project whose API key is used to probe. Absent = control-plane credential. */
  projectId?: string;
}) {
  const t = MODEL_TEXT;
  const unlisted = Boolean(value) && !models.some((m) => m.id === value);
  // An already pinned id opens the field right away: hidden behind a "+" it would look gone.
  const [pinning, setPinning] = useState(unlisted);

  const probe = useQuery({
    queryKey: ["model-probe", value, projectId ?? ""] as const,
    queryFn: () => modelsApi.probe(value, projectId),
    enabled: pinning && value.trim().length > 2,
    staleTime: 6 * 60 * 60_000,
    retry: false,
  });

  if (!pinning) {
    return (
      <Row gap={6} align="center">
        <Select value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
          <option value="">{emptyLabel}</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
              {m.resolves ? ` → ${m.resolves}` : ""}
            </option>
          ))}
        </Select>
        <IconBtn variant="quiet" small title={t.pinOpen} onClick={() => setPinning(true)}>
          <Plus size={14} />
        </IconBtn>
      </Row>
    );
  }

  const verdict = probe.data?.verdict;
  return (
    <Stack gap={4}>
      <Row gap={6} align="center">
        <Input
          value={value}
          aria-label={`${ariaLabel} — ${t.pinLabel}`}
          placeholder={t.pinPlaceholder}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(e) => onChange(e.target.value)}
        />
        {/* Closing hands back to the list and clears the field: keeping a typed id while showing
            a `<Select>` that does not contain it would make the screen lie. */}
        <IconBtn
          variant="quiet"
          small
          title={t.pinClose}
          onClick={() => {
            onChange("");
            setPinning(false);
          }}
        >
          <X size={14} />
        </IconBtn>
      </Row>
      <ModelVerdict
        verdict={probe.isFetching ? undefined : verdict}
        detail={probe.data?.detail}
        checking={probe.isFetching}
      />
    </Stack>
  );
}
