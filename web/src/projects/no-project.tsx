// The no-project screen (nav project, behaviour 8): a preflight, a field, a side door.
//
// The order is the screen's thesis. It does not ask for a project name first: it says whether the
// ground holds. A missing Claude credential, a stopped Docker or a missing session image otherwise
// only show when the first session starts and dies silently, once the operator did everything else
// and thinks they are done.
//
// Two components on purpose: `NoProjectScreen` is the pure form stories and tests mount without
// network; `NoProject` is the same wired to two routes the server already serves
// (`/api/auth/identity` and `/api/infra` say exactly these three things).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, CircleAlert } from "lucide-react";
import { authApi, type AuthIdentity } from "../api/auth.js";
import { projectsApi } from "../api/projects.js";
import type { Infra } from "../api/infra.js";
import { infraQuery, qk } from "../queries.js";
import { Button } from "../ui/button.js";
import { Code } from "../ui/code.js";
import { FormError } from "../ui/form.js";
import { Heading } from "../ui/heading.js";
import { Input } from "../ui/input.js";
import { forgeText, guessForge } from "./forge.js";
import { projectNameFromUrl } from "./repo-url.js";
import { NO_PROJECT_TEXT as T } from "./text/no-project.js";
import "./no-project.css";

/** The three conditions, in the order they must fall: without a credential, Docker health interests
 *  nobody. `id` serves the test and the sentence saying what the button waits for. */
export type PreflightId = "identity" | "docker" | "image";
export type PreflightCheck = {
  id: PreflightId;
  met: boolean;
  title: string;
  /** What reads when held; the fixing gesture when not. */
  detail: string;
  /** The command to type, when the gesture is one (`make image-session` and nothing else). Separate
   *  from the text to render as `<Code>`: a command rebuilt from a sentence gets mistyped. */
  command?: string;
  /** The observed value, on the right. `null` = nothing to show. */
  value: string | null;
};

/** The pure form. It neither queries the server nor navigates: everything comes through props,
 *  which makes its three states mountable in stories. */
export function NoProjectScreen({
  checks,
  creating,
  opening,
  error,
  onCreate,
  onOpenDemo,
}: {
  /** `null` = ground not read yet (first render, slow network). */
  checks: PreflightCheck[] | null;
  creating?: boolean;
  opening?: boolean;
  error?: string;
  onCreate: (repoUrl: string) => void;
  onOpenDemo: () => void;
}) {
  const [repoUrl, setRepoUrl] = useState("");
  const name = projectNameFromUrl(repoUrl);
  const forge = guessForge(repoUrl);
  const unmet = (checks ?? []).filter((c) => !c.met);
  // Unread ground is not "held": while unknown, the button waits.
  const ready = checks !== null && unmet.length === 0;
  const busy = Boolean(creating || opening);

  return (
    <div className="noproject">
      <div>
        <Heading level={1}>{T.title}</Heading>
        <p className="noproject-lede">{T.lede}</p>
      </div>

      <section className="noproject-preflight" aria-label={T.preflight.label}>
        <div className="noproject-preflight-head">
          <span>{T.preflight.label}</span>
          <span>
            {checks === null
              ? T.preflight.checking
              : T.preflight.score(checks.length - unmet.length, checks.length)}
          </span>
        </div>
        {(checks ?? []).map((check) => (
          <div key={check.id} className="noproject-check" data-check={check.id}>
            <span
              className="noproject-check-state"
              data-met={String(check.met)}
              aria-label={check.met ? T.preflight.met : T.preflight.unmet}
            >
              {check.met ? <Check size={16} /> : <CircleAlert size={16} />}
            </span>
            <span>
              <b className="noproject-check-title">{check.title}</b>
              <p className="noproject-check-detail">
                {check.detail}
                {check.command && (
                  <>
                    {" "}
                    <Code>{check.command}</Code>
                  </>
                )}
              </p>
            </span>
            {check.value && <span className="noproject-check-value">{check.value}</span>}
          </div>
        ))}
      </section>

      {/* One field. Project name and forge are not asked: they are inferred and shown before
          saving (derived line), because a silent inference is a decision made for someone. */}
      <form
        className="noproject-field"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && name && !busy) onCreate(repoUrl.trim());
        }}
      >
        <label className="noproject-field-label" htmlFor="noproject-repo">
          {T.field.label}
        </label>
        <div className="noproject-row">
          <Input
            id="noproject-repo"
            data-autofocus
            spellCheck={false}
            placeholder={T.field.placeholder}
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={!ready || !name || busy}>
            {creating ? T.field.creating : T.field.create}
          </Button>
        </div>
        <span className="noproject-derived">
          {name === null
            ? T.field.derivedNothing
            : forge === null
              ? T.field.derivedUnknownForge(name)
              : T.field.derived(name, forgeText(forge).label)}
        </span>
        {/* Why the button waits. A disabled button without a reason is a closed door without a
            sign: the operator rereads their URL instead of building the image. */}
        {unmet.length > 0 && (
          <span className="noproject-blocked">
            {T.field.blocked(unmet.map((c) => T.field.blockedWhat[c.id]).join(", "))}
          </span>
        )}
        {error && <FormError>{error}</FormError>}
      </form>

      <div className="noproject-door">
        <div>
          <b className="noproject-door-title">{T.demo.title}</b>
          <p>{T.demo.body}</p>
        </div>
        {/* The side door does not depend on the preflight: looking at a demo board starts no
            session, so nothing needs to hold. */}
        <Button variant="quiet" disabled={busy} onClick={onOpenDemo}>
          {opening ? T.demo.opening : T.demo.open}
        </Button>
      </div>
    </div>
  );
}

/** The same screen, wired. */
export function NoProject() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: identity } = useQuery({
    queryKey: ["auth", "identity"] as const,
    queryFn: () => authApi.identity(),
  });
  const { data: infra } = useQuery(infraQuery);
  const [error, setError] = useState("");

  const goTo = async (projectId: string) => {
    await qc.invalidateQueries({ queryKey: qk.bootstrap });
    await navigate({ to: "/p/$projectId/board", params: { projectId } });
  };
  const create = useMutation({
    mutationFn: (repoUrl: string) =>
      projectsApi.createProject({ name: projectNameFromUrl(repoUrl) ?? repoUrl, repoUrl }),
    onSuccess: (p) => void goTo(p.id),
    onError: (e: Error) => setError(e.message),
  });
  const demo = useMutation({
    mutationFn: () => projectsApi.openDemoProject(),
    onSuccess: (p) => void goTo(p.id),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <NoProjectScreen
      checks={identity && infra ? preflight(identity, infra) : null}
      creating={create.isPending}
      opening={demo.isPending}
      error={error}
      onCreate={(url) => {
        setError("");
        create.mutate(url);
      }}
      onOpenDemo={() => {
        setError("");
        demo.mutate();
      }}
    />
  );
}

/** Reading the ground, a pure function, so checkable without mounting the screen.
 *
 *  It redefines nothing: `kind` comes from `/api/auth/identity`, runner health and image presence
 *  from `/api/infra`, which already computes them for the bar and the infra page. A fourth "can it
 *  start" computation would end up contradicting the other three. */
export function preflight(identity: AuthIdentity, infra: Infra): PreflightCheck[] {
  const runners = infra.runners;
  const healthy = runners.filter((r) => r.available);
  const withImage = healthy.filter((r) => r.image.present);
  // The image is judged on runners that answer: a stopped daemon can say nothing about its images,
  // and counting its silence as "image missing" would name two gestures where only one is possible.
  const imageMet = healthy.length > 0 && withImage.length === healthy.length;
  return [
    {
      id: "identity",
      met: identity.kind !== "none",
      title: T.identity.title,
      detail: identity.kind === "none" ? T.identity.fix : T.identity.ok,
      command: identity.kind === "none" ? T.identity.fixCommand : undefined,
      value: identity.masked ? `${identity.masked} · ${T.identity.kind[identity.kind]}` : null,
    },
    {
      id: "docker",
      met: healthy.length > 0,
      title: T.docker.title,
      detail:
        healthy.length > 0
          ? T.docker.ok(healthy.length)
          : runners.length === 0
            ? T.docker.none
            : T.docker.fix,
      command: healthy.length > 0 ? undefined : T.docker.fixCommand,
      value: healthy.map((r) => r.runnerName).join(" · ") || null,
    },
    {
      id: "image",
      met: imageMet,
      title: imageMet ? T.image.okTitle : T.image.title,
      detail: imageMet ? T.image.ok : T.image.fix,
      command: imageMet ? undefined : T.image.fixCommand,
      value: T.image.name,
    },
  ];
}
