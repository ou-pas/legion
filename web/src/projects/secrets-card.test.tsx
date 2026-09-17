// The secrets card carries two rules no type defends, and they decide what an operator believes
// about their project.
//
// First: a project key is not necessarily the one that serves. Two auth keys can coexist, and the
// subscription token wins alone. An API key set, valid and still ignored cannot be guessed; the
// per-row mention is all that breaks that silence. A regression here is invisible: the list
// renders, the key is there, and sessions run on another account than the one you think.
//
// Second: another project's secrets must not appear. `secretsQuery` returns everything in the
// database; this card's filter sorts it, and nothing else reminds you.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { projectsApi, type ActiveCredential, type Secret } from "../api/projects.js";
import { qk } from "../queries.js";
import { ENTER, MOD } from "../ui/platform.js";
import { demoProject } from "./project-fixture.js";
import { SecretsCard } from "./secrets-card.js";
import { CREDENTIALS_CARD_TEXT } from "./text/credentials.js";
import { SECRETS_CARD_TEXT } from "./text/secrets.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project = demoProject({});

const secret = (
  id: string,
  name: string,
  projectId = "p1",
  label: string | null = null,
): Secret => ({ id, projectId, name, label });

function mount(secrets: Secret[], active: ActiveCredential | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.secrets, secrets);
  if (active) qc.setQueryData(qk.projectCredentials("p1"), { credentials: [], active });
  render(
    <QueryClientProvider client={qc}>
      <SecretsCard project={project} />
    </QueryClientProvider>,
  );
  return qc;
}

describe("SecretsCard — which key really serves", () => {
  it("marks the key that serves, and says the other is masked", () => {
    mount([secret("s1", "CLAUDE_CODE_OAUTH_TOKEN"), secret("s2", "ANTHROPIC_API_KEY")], {
      credentialId: null,
      from: "project",
      name: "CLAUDE_CODE_OAUTH_TOKEN",
      label: null,
      available: true,
      retryAt: null,
    });

    expect(screen.getByText(CREDENTIALS_CARD_TEXT.serving)).toBeDefined();
    expect(screen.getByText(CREDENTIALS_CARD_TEXT.masked)).toBeDefined();
  });

  it("puts no mention on a secret that is not a Claude credential", () => {
    mount([secret("s1", "LINEAR_API_KEY")], {
      credentialId: null,
      from: "control-plane",
      name: null,
      label: null,
      available: true,
      retryAt: null,
    });

    expect(screen.queryByText(CREDENTIALS_CARD_TEXT.serving)).toBeNull();
    expect(screen.queryByText(CREDENTIALS_CARD_TEXT.masked)).toBeNull();
  });

  it("lists only this project's secrets", () => {
    mount([secret("s1", "LINEAR_API_KEY"), secret("s2", "SLACK_TOKEN", "p2")], null);

    expect(screen.getByText("LINEAR_API_KEY")).toBeDefined();
    expect(screen.queryByText("SLACK_TOKEN")).toBeNull();
  });
});

describe("SecretsCard — adding a secret", () => {
  const fill = (name: string, value: string) => {
    fireEvent.change(screen.getByPlaceholderText(SECRETS_CARD_TEXT.namePlaceholder), {
      target: { value: name },
    });
    fireEvent.change(screen.getByPlaceholderText(SECRETS_CARD_TEXT.valuePlaceholder), {
      target: { value },
    });
  };

  it("the button stays disarmed while the name or the value is missing", () => {
    mount([], null);
    const button = () =>
      screen.getByRole("button", { name: SECRETS_CARD_TEXT.save }) as HTMLButtonElement;

    expect(button().disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(SECRETS_CARD_TEXT.namePlaceholder), {
      target: { value: "ANTHROPIC_API_KEY" },
    });
    expect(button().disabled).toBe(true);
  });

  it("sends the name without its spaces, and acknowledges the drop", async () => {
    const save = vi
      .spyOn(projectsApi, "saveSecret")
      .mockResolvedValue({ ok: true, replaced: false });
    mount([], null);

    fill("  ANTHROPIC_API_KEY  ", "sk-secret");
    fireEvent.click(screen.getByRole("button", { name: SECRETS_CARD_TEXT.save }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      projectId: "p1",
      name: "ANTHROPIC_API_KEY",
      value: "sk-secret",
    });
    expect(await screen.findByText(SECRETS_CARD_TEXT.stored("ANTHROPIC_API_KEY"))).toBeDefined();
  });

  // The saving key (07/09): Enter in the value or label used to post the secret. Same convention as
  // the inbox and the composer (ui/submit-key.ts): Enter alone does nothing, Cmd/Ctrl+Enter saves,
  // and the form says so next to the button.
  it("Enter alone does not save; Cmd/Ctrl+Enter saves, once", () => {
    const save = vi
      .spyOn(projectsApi, "saveSecret")
      .mockResolvedValue({ ok: true, replaced: false });
    mount([], null);
    fill("ANTHROPIC_API_KEY", "sk-secret");

    const value = screen.getByPlaceholderText(SECRETS_CARD_TEXT.valuePlaceholder);
    fireEvent.keyDown(value, { key: "Enter" });
    fireEvent.keyDown(screen.getByPlaceholderText(SECRETS_CARD_TEXT.aliasPlaceholder), {
      key: "Enter",
    });
    expect(save).not.toHaveBeenCalled();

    fireEvent.keyDown(value, { key: "Enter", ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("shows the shortcut on the button, even disarmed (D5): a hint appearing on typing would make the bar flicker", () => {
    mount([], null);
    const button = screen.getByRole("button", { name: SECRETS_CARD_TEXT.save });
    expect(button.querySelector(".ui-btn-shortcut")?.textContent).toBe(MOD + ENTER);
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("tells a replaced secret from a new one, or you think you created a second", async () => {
    vi.spyOn(projectsApi, "saveSecret").mockResolvedValue({ ok: true, replaced: true });
    mount([secret("s1", "ANTHROPIC_API_KEY")], null);

    fill("ANTHROPIC_API_KEY", "sk-nouvelle");
    fireEvent.click(screen.getByRole("button", { name: SECRETS_CARD_TEXT.save }));

    expect(await screen.findByText(SECRETS_CARD_TEXT.replaced("ANTHROPIC_API_KEY"))).toBeDefined();
  });
});

describe("SecretsCard — a key's label", () => {
  it("writes nothing when the field did not change: fixing a label does not re-paste a token", () => {
    const setLabel = vi.spyOn(projectsApi, "setSecretLabel").mockResolvedValue({ ok: true });
    mount([secret("s1", "ANTHROPIC_API_KEY", "p1", "Compte perso")], null);

    fireEvent.blur(screen.getByLabelText(SECRETS_CARD_TEXT.labelOf("ANTHROPIC_API_KEY")));

    expect(setLabel).not.toHaveBeenCalled();
  });

  it("saves on blur, without the secret value", async () => {
    const setLabel = vi.spyOn(projectsApi, "setSecretLabel").mockResolvedValue({ ok: true });
    mount([secret("s1", "ANTHROPIC_API_KEY")], null);

    const input = screen.getByLabelText(SECRETS_CARD_TEXT.labelOf("ANTHROPIC_API_KEY"));
    fireEvent.change(input, { target: { value: "Compte perso" } });
    fireEvent.blur(input);

    await waitFor(() => expect(setLabel).toHaveBeenCalledWith("s1", "Compte perso"));
  });
});
