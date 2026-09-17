// Declare a machine (01/09, multi-machine work; a panel since 04/09, operator's request: the form
// permanently took a runner card's place for a gesture made once every six months). It opens from
// the header `+`.
//
// The probe verdict comes back with the creation, and that is the point of this form. A mistyped
// `ssh://` accepted silently only shows at the first session, as an unreadable clone error deep in
// a container. Here the answer says at once whether the daemon replied, and if not, that the machine
// is declared but will receive nothing.
//
// The panel closes on success (machine declared, whatever the probe verdict) and refreshes the list;
// a "silent" verdict goes out as a toast since the panel that would have shown it just closed. A
// refusal (name taken, invalid request) keeps the panel open, fields filled, and the error reads
// right above the button that caused it.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { infraApi, type DeclaredRunner } from "../api/infra.js";
import { qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Spacer, Stack } from "../ui/flex.js";
import { Field, FormError } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Modal } from "../ui/modal.js";
import { Text } from "../ui/text.js";
import { useToast } from "../ui/toast.js";
import { UI_TEXT } from "../ui/vocabulary.js";
import { INFRA_TEXT } from "./text.js";

export function RunnerDeclarePanel({ onClose }: { onClose: () => void }) {
  const t = INFRA_TEXT.declare;
  const qc = useQueryClient();
  const { push } = useToast();
  const [name, setName] = useState("");
  const [dockerHost, setDockerHost] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [concurrency, setConcurrency] = useState("3");
  const declare = useMutation({
    mutationFn: (): Promise<DeclaredRunner> =>
      infraApi.declareRunner({
        name: name.trim(),
        ...(dockerHost.trim() ? { dockerHost: dockerHost.trim() } : {}),
        ...(callbackUrl.trim() ? { callbackUrl: callbackUrl.trim() } : {}),
        maxConcurrentSessions: Number(concurrency),
      }),
    onSuccess: (runner) => {
      void qc.invalidateQueries({ queryKey: qk.infra });
      onClose();
      // The "silent" verdict is the point of the form (see header): it must survive the panel
      // closing, so it goes out as a toast.
      if (!runner.reachable)
        push({ tone: "wait", title: t.silent(runner.name, runner.error ?? "") });
    },
  });

  return (
    <Modal
      title={t.title}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>{UI_TEXT.cancel}</Button>
          <Spacer />
          <Button
            variant="primary"
            disabled={!name.trim() || declare.isPending}
            loading={declare.isPending}
            onClick={() => declare.mutate()}
          >
            {declare.isPending ? t.submitting : t.submit}
          </Button>
        </>
      }
    >
      <Stack gap={13}>
        <Text size="sm" tone="muted">
          {t.desc}
        </Text>
        <Field label={t.name} required hint={t.nameHint}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mac-mini"
            data-autofocus="true"
          />
        </Field>
        <Field label={t.host} hint={t.hostHint}>
          <Input
            value={dockerHost}
            onChange={(e) => setDockerHost(e.target.value)}
            placeholder="ssh://operator@192.168.1.20"
          />
        </Field>
        <Field label={t.callback} hint={t.callbackHint}>
          <Input
            value={callbackUrl}
            onChange={(e) => setCallbackUrl(e.target.value)}
            placeholder="http://100.64.0.1:8790"
          />
        </Field>
        <Field label={t.concurrency}>
          <Input
            type="number"
            min={1}
            max={16}
            inputMode="numeric"
            value={concurrency}
            onChange={(e) => setConcurrency(e.target.value)}
          />
        </Field>
        {/* The refusal (name taken, invalid request) reads here, right above the button that
            caused it, never behind a panel that closed on the failure. */}
        {declare.isError && <FormError>{(declare.error as Error).message}</FormError>}
      </Stack>
    </Modal>
  );
}
