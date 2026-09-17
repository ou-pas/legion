// The project's SSH key, moved out of the Execution tab in nav batch 2a. It answers "how does this
// project touch git", like repositories and their commit identity, not "what do its sessions run
// with".
//
// The card verifies nothing about the key file, on purpose: the key lives on the docker host, which
// the browser cannot see. The preflight verifies it at run time, with the disk at hand, and names
// what it finds (missing, public, passphrase-protected).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, KeySquare } from "lucide-react";
import { projectsApi, type Project } from "../api/projects.js";
import { qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Stack } from "../ui/flex.js";
import { Field, FormError } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Caption } from "../ui/text.js";
import { PROJECT_TEXT } from "./text/vocabulary.js";
import { SSH_KEY_TEXT as T } from "./text/ssh-key.js";

export function SshKeyCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  // `null` = "untouched", distinct from "emptied by hand", same convention as the other settings
  // cards: without it, clearing the field would refill it from the project.
  const [keyPath, setKeyPath] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const keyValue = keyPath ?? project.sshKeyPath ?? "";
  const dirty = keyValue !== (project.sshKeyPath ?? "");

  const save = () =>
    projectsApi
      .patchProject(project.id, { sshKeyPath: keyValue })
      .then(() => {
        setSaved(true);
        setErr("");
        setKeyPath(null);
        setTimeout(() => setSaved(false), 1500);
        void qc.invalidateQueries({ queryKey: qk.bootstrap });
      })
      .catch((e: Error) => setErr(e.message));

  return (
    <Card
      icon={<KeySquare size={16} />}
      title={T.title}
      desc={T.why}
      actions={
        <Button
          variant="primary"
          disabled={!dirty}
          leading={saved ? <Check size={12} /> : undefined}
          onClick={save}
        >
          {saved ? PROJECT_TEXT.saved : PROJECT_TEXT.save}
        </Button>
      }
    >
      <Stack gap={8}>
        {err && <FormError>{err}</FormError>}
        <Field label={T.label} hint={T.hint}>
          <Input
            placeholder={T.placeholder}
            value={keyValue}
            onChange={(e) => setKeyPath(e.target.value)}
          />
        </Field>
        {/* The three traps read before pasting a path, not after a dead session. */}
        <Stack gap={4}>
          <Caption>{T.passphrase}</Caption>
          <Caption>{T.deployKey}</Caption>
          <Caption>{T.hostKeys}</Caption>
          <Caption>{T.knownHosts}</Caption>
        </Stack>
      </Stack>
    </Card>
  );
}
