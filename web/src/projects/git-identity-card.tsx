// The git commit identity, and since 05/09 its attribution verdict.
//
// The card accepted "Acme Agent <agents@acme.test>" without a word, and six commits went out
// anonymous on a PR opened in the operator's name. A well-formed address is not an attributed one,
// and that is all the human wants to know when setting this field. Full reasoning, including why it
// warns without blocking, in server/src/projects/git-identity-check.ts.
//
// The verdict is a call to the forge: it arrives after the card, may never arrive, and its third
// state ("I do not know") shows as is rather than being rounded up to an alarm.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, UserRound } from "lucide-react";
import { projectsApi, type GitIdentityCheck, type Project } from "../api/projects.js";
import { gitIdentityCheckQuery, qk } from "../queries.js";
import { Banner } from "../ui/banner.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Code } from "../ui/code.js";
import { Stack } from "../ui/flex.js";
import { Field, FormError, FormRow } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Caption } from "../ui/text.js";
import { GIT_IDENTITY_TEXT as T } from "./text/git-identity.js";
import { PROJECT_TEXT } from "./text/vocabulary.js";

// Duplicated here (no cross-package import): keep in sync with server/src/projects/git-identity.ts
// (DEFAULT_GIT_AUTHOR_NAME / DEFAULT_GIT_AUTHOR_EMAIL).
const DEFAULT_GIT_AUTHOR_NAME = "Legion";
const DEFAULT_GIT_AUTHOR_EMAIL = "legion@local";

/** The verdict made readable. Separate from the form because it has its own life: it arrives later,
 *  may be missing, and says nothing when all is well; a green banner on every visit would be noise
 *  that teaches people to stop looking at banners. */
function Verdict({
  check,
  onUseSuggestion,
}: {
  check: GitIdentityCheck | undefined;
  onUseSuggestion: (email: string) => void;
}) {
  if (!check) return null;
  if (check.status === "attributed") {
    return (
      <Caption>
        {T.verdict.attachedBefore}
        {check.login ? (
          <>
            {" "}
            {T.verdict.attachedTo} <Code variant="bare">{check.login}</Code>
          </>
        ) : null}{" "}
        {T.verdict.attachedAfter}
      </Caption>
    );
  }
  const tone = check.status === "unlinked" ? "bad" : "info";
  const title = check.status === "unlinked" ? T.verdict.unlinkedTitle : T.verdict.unknownTitle;
  return (
    <Banner
      tone={tone}
      title={title}
      actions={
        check.suggestion ? (
          <Button onClick={() => onUseSuggestion(check.suggestion!)}>
            {T.verdict.useSuggestion(check.suggestion)}
          </Button>
        ) : undefined
      }
    >
      {check.reason}
    </Banner>
  );
}

export function GitIdentityCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const check = useQuery(gitIdentityCheckQuery(project.id));

  const nameValue = name ?? project.gitAuthorName ?? "";
  const emailValue = email ?? project.gitAuthorEmail ?? "";
  const dirty =
    nameValue !== (project.gitAuthorName ?? "") || emailValue !== (project.gitAuthorEmail ?? "");
  const save = (nextName: string, nextEmail: string) =>
    projectsApi
      .patchProject(project.id, { gitAuthorName: nextName, gitAuthorEmail: nextEmail })
      .then(() => {
        setSaved(true);
        setErr("");
        setName(null);
        setEmail(null);
        setTimeout(() => setSaved(false), 1500);
        void qc.invalidateQueries({ queryKey: qk.bootstrap });
        // The verdict is about the saved address: it becomes wrong the second the address changes.
        void qc.invalidateQueries({ queryKey: qk.gitIdentityCheck(project.id) });
      })
      .catch((e: Error) => setErr(e.message));

  return (
    <Card
      icon={<UserRound size={16} />}
      title={T.title}
      actions={
        <Button
          variant="primary"
          disabled={!dirty}
          leading={saved ? <Check size={12} /> : undefined}
          onClick={() => save(nameValue, emailValue)}
        >
          {saved ? PROJECT_TEXT.saved : PROJECT_TEXT.save}
        </Button>
      }
      desc={
        <>
          {T.descBefore}
          <Code variant="bare">git config user.name / user.email</Code>
          {T.descAfterConfig} <Code variant="bare">{DEFAULT_GIT_AUTHOR_NAME}</Code> /{" "}
          <Code variant="bare">{DEFAULT_GIT_AUTHOR_EMAIL}</Code> {T.descAfterDefaults}
        </>
      }
    >
      <Stack gap={8}>
        {err && <FormError>{err}</FormError>}
        <Verdict
          check={check.data}
          onUseSuggestion={(next) => {
            setEmail(next);
            void save(nameValue, next);
          }}
        />
        <FormRow>
          <Field label={T.nameLabel} hint={T.defaultHint(DEFAULT_GIT_AUTHOR_NAME)}>
            <Input
              placeholder={DEFAULT_GIT_AUTHOR_NAME}
              value={nameValue}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={T.emailLabel} hint={T.defaultHint(DEFAULT_GIT_AUTHOR_EMAIL)}>
            <Input
              placeholder={DEFAULT_GIT_AUTHOR_EMAIL}
              value={emailValue}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </FormRow>
      </Stack>
    </Card>
  );
}
