// Open a crate into this database (26/08).
//
// Two steps, and that is the whole gesture. "Decrypt and preview" creates nothing: it opens the
// file and says what would be created. "Create the project" writes, in one transaction. Nobody is
// asked to confirm an import they know nothing about.
//
// The file content is read here, in the browser, and posted to the server. It touches no disk: a
// crate stored in `server/data` would end up in a backup one day.
//
// It lives in the new project modal (nav batch 2a), not in an existing project's settings:
// importing a crate creates a project. `onImported` closes that modal; `NewProjectModal` is the
// only caller passing it.
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PackageOpen } from "lucide-react";
import { portabilityApi, type CrateSummary } from "../api/portability.js";
import { qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Dropzone, FileChip } from "../ui/dropzone.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Field, FormError } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { CrateSummaryView } from "./crate-summary.js";
import { CRATE_TEXT } from "./text.js";

export function CrateImport({ onImported }: { onImported?: () => void } = {}) {
  const t = CRATE_TEXT.import;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState<CrateSummary | null>(null);

  const reset = () => {
    setSummary(null);
    setName("");
  };

  const preview = useMutation({
    mutationFn: () => portabilityApi.preview({ content: file?.content ?? "", passphrase: pass }),
    onSuccess: (s) => {
      setSummary(s);
      setName(`${s.project} (copie)`);
    },
  });
  const apply = useMutation({
    mutationFn: () =>
      portabilityApi.importCrate({ content: file?.content ?? "", passphrase: pass, name }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.bootstrap });
      setFile(null);
      setPass("");
      reset();
      onImported?.();
      void navigate({ to: "/p/$projectId/board", params: { projectId: r.projectId } });
    },
  });

  const take = async (f: File | undefined) => {
    if (!f) return;
    setFile({ name: f.name, content: await f.text() });
    reset();
    preview.reset();
  };

  return (
    <Card icon={<PackageOpen size={16} />} title={t.title} desc={t.desc}>
      <Stack gap={12}>
        <Dropzone
          over={over}
          rejected={preview.isError}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void take(e.dataTransfer.files[0]);
          }}
          onClick={() => fileInput.current?.click()}
          label={t.pick}
          hint={t.dropHint}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".aos"
          hidden
          onChange={(e) => void take(e.target.files?.[0])}
        />
        {file && (
          <Row>
            <FileChip
              name={file.name}
              bytes={file.content.length}
              onRemove={() => {
                setFile(null);
                reset();
              }}
            />
          </Row>
        )}

        <Field label={t.passphrase} hint={t.passphraseHint}>
          <Input
            type="password"
            autoComplete="off"
            value={pass}
            onChange={(e) => {
              setPass(e.target.value);
              reset();
            }}
          />
        </Field>

        {preview.error && <FormError>{(preview.error as Error).message}</FormError>}
        {apply.error && <FormError>{(apply.error as Error).message}</FormError>}

        {!summary ? (
          <Row>
            <Button
              disabled={!file || pass.length === 0 || preview.isPending}
              onClick={() => preview.mutate()}
            >
              {preview.isPending ? t.working : t.preview}
            </Button>
          </Row>
        ) : (
          <Stack gap={12}>
            <CrateSummaryView summary={summary} />
            <Field label={t.nameLabel} hint={t.nameHint}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Row gap={8}>
              <Button variant="primary" disabled={apply.isPending} onClick={() => apply.mutate()}>
                {apply.isPending ? t.applying : t.apply}
              </Button>
              <Button onClick={reset}>{t.cancel}</Button>
              <Spacer />
            </Row>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
