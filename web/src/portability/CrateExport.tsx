// Export a project's configuration to an encrypted crate (26/08).
//
// This module only wires: it reads the manifest, holds the form state and saves the file. The
// three pieces with visual states live next to it, with their stories.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import {
  DEFAULT_INCLUDE,
  downloadCrate,
  portabilityApi,
  CRATE_PARTS,
  type CrateInclude,
} from "../api/portability.js";
import { Banner } from "../ui/banner.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Row, Stack } from "../ui/flex.js";
import { Field, FormError, FormOk } from "../ui/form.js";
import { SkeletonText } from "../ui/skeleton.js";
import { CrateContents } from "./crate-contents.js";
import { CratePassphrase, passphraseReady } from "./crate-passphrase.js";
import { CRATE_TEXT } from "./text.js";
import "./crate-contents.css";

export function CrateExport({ projectId }: { projectId: string }) {
  const t = CRATE_TEXT.export;
  const { data: manifest } = useQuery({
    queryKey: ["crate-manifest", projectId] as const,
    queryFn: () => portabilityApi.manifest(projectId),
    enabled: projectId.length > 0,
  });
  const [include, setInclude] = useState<CrateInclude>(DEFAULT_INCLUDE);
  const [pass, setPass] = useState("");
  const [repeat, setRepeat] = useState("");
  const [written, setWritten] = useState("");

  const seal = useMutation({
    mutationFn: () => portabilityApi.seal(projectId, { passphrase: pass, include }),
    onSuccess: (r) => {
      downloadCrate(r.filename, r.content);
      setWritten(r.filename);
      // The passphrase does not outlive the export: once the file is saved nothing justifies
      // keeping it in memory, and a field left filled invites a second click.
      setPass("");
      setRepeat("");
    },
  });

  const chosen = CRATE_PARTS.filter((p) => include[p]);
  const ready = chosen.length > 0 && passphraseReady(pass, repeat);

  return (
    <Card icon={<Lock size={16} />} title={t.title} desc={t.desc}>
      {!manifest ? (
        <SkeletonText lines={6} label="Reading the project contents…" />
      ) : (
        <Stack gap={12}>
          {/* A plate, not a field: dashed border, width fitted to content. Stretched across the
              card, these two blocks announced an input that does not exist. */}
          <Field label={t.project}>
            <span className="cr-plaque">
              {manifest.project}
              <i>{manifest.slug}</i>
            </span>
          </Field>

          <Field label={t.contents} hint={chosen.length === 0 ? t.empty : undefined}>
            <CrateContents
              counts={manifest.counts}
              include={include}
              onChange={(next) => {
                setInclude(next);
                setWritten("");
              }}
            />
          </Field>

          {include.secrets && manifest.counts.secrets > 0 && (
            <Banner tone="wait" title={t.secretsWarn(manifest.counts.secrets)} />
          )}

          <CratePassphrase
            pass={pass}
            repeat={repeat}
            onPass={(v) => {
              setPass(v);
              setWritten("");
            }}
            onRepeat={setRepeat}
          />

          <Field label={t.filename} hint={t.keepOut}>
            <span className="cr-plaque">
              {`legion-${manifest.slug}-${stamp()}`}
              <i>.aos</i>
            </span>
          </Field>

          {seal.error && <FormError>{(seal.error as Error).message}</FormError>}
          {written && <FormOk>{t.done(written)}</FormOk>}

          <Row>
            <Button
              variant="primary"
              leading={<Lock size={13} />}
              disabled={!ready || seal.isPending}
              onClick={() => seal.mutate()}
            >
              {seal.isPending ? t.working : t.submit}
            </Button>
          </Row>
        </Stack>
      )}
    </Card>
  );
}

/** Same rule as the server (`crateFilename`): the day, not the time. Display only; the name that
 *  counts is the one in the response. */
function stamp(at = new Date()): string {
  return `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, "0")}${String(at.getDate()).padStart(2, "0")}`;
}
