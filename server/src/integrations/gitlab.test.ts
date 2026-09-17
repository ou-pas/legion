// The GitLab adapter, exercised against a fake API.
//
// It never touched a real instance: endpoints and field names come from the v4 API docs (checked
// 26/08). These tests do not prove GitLab answers as hoped; they prove that if GitLab answers as its
// docs say, the adapter gets what it needs. The half that can be held without a GitLab account.
//
// `globalThis.fetch` is replaced: the module's only entry point from outside, precisely because it is
// humble (no database, no secret, token as argument).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { checkStateOfPipelineStatus, gitlabForge } from "./gitlab.js";
import type { ForgeRepo } from "./forge.js";

const REPO: ForgeRepo = {
  name: "api",
  url: "https://gitlab.com/kopee/back/api.git",
  forge: "gitlab",
};
const SELF_HOSTED: ForgeRepo = {
  name: "infra",
  url: "https://git.kopee.me/ops/ansible.git",
  forge: "gitlab",
};

type Reply = { status?: number; json?: unknown };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Sets a fake API and records the called URLs: the URL, not the response, often carries the defect
 *  (badly encoded path, wrong API root). */
function fakeApi(routes: (url: string, init?: RequestInit) => Reply): {
  calls: string[];
  headers: HeadersInit[];
} {
  const calls: string[] = [];
  const headers: HeadersInit[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (init?.headers) headers.push(init.headers);
    const { status = 200, json = {} } = routes(url, init);
    return {
      status,
      json: async () => json,
      headers: { get: () => null },
    } as unknown as Response;
  }) as typeof fetch;
  return { calls, headers };
}

describe("projectPath: nested groups, which GitHub does not have", () => {
  it("keeps the whole path, subgroups included", () => {
    assert.equal(
      gitlabForge.projectPath("https://gitlab.com/kopee/back/api.git"),
      "kopee/back/api",
    );
  });

  it("accepts any host: a self-hosted instance is a GitLab like any other", () => {
    assert.equal(gitlabForge.projectPath("https://git.kopee.me/ops/ansible.git"), "ops/ansible");
  });

  it("refuses a single-segment path: not a project", () => {
    assert.equal(gitlabForge.projectPath("https://gitlab.com/kopee"), null);
  });

  // v40: SSH is no longer refused, it is the same project reached differently. Refusing it did not
  // prevent the clone; it prevented opening the merge request after the push.
  it("reads an SSH URL like its https form", () => {
    assert.equal(gitlabForge.projectPath("git@gitlab.com:kopee/api.git"), "kopee/api");
    assert.equal(gitlabForge.projectPath("git@gitlab.com:kopee/back/api.git"), "kopee/back/api");
  });
});

describe("compareBranch", () => {
  it("queries the API of the repository's host and encodes the project path", async () => {
    const { calls, headers } = fakeApi((url) =>
      url.includes("/repository/compare")
        ? { json: { diffs: [] } }
        : { json: { default_branch: "develop" } },
    );

    await gitlabForge.compareBranch("tok", SELF_HOSTED, "legion/t1");

    // The API root follows the repository: what makes self-hosted work with no extra configuration.
    assert.ok(calls[0]!.startsWith("https://git.kopee.me/api/v4/"), calls[0]);
    assert.ok(calls[0]!.includes("/projects/ops%2Fansible"), "the path must be URL-encoded whole");
    // `from` must be the default branch read from the project, not an assumed main.
    assert.ok(calls[1]!.includes("from=develop"), calls[1]);
    assert.ok(calls[1]!.includes("to=legion%2Ft1"), calls[1]);
    // PRIVATE-TOKEN: the only form accepting PAT, project token and group token alike; the group token
    // makes a multi-repository project viable with one secret.
    assert.ok(JSON.stringify(headers[0]).includes("private-token"), JSON.stringify(headers[0]));
  });

  it("computes the line counts GitLab does not provide", async () => {
    fakeApi((url) =>
      url.includes("/repository/compare")
        ? {
            json: {
              diffs: [
                {
                  new_path: "src/a.ts",
                  old_path: "src/a.ts",
                  diff: "@@ -1,2 +1,3 @@\n kept\n-old\n+new\n+added",
                },
              ],
            },
          }
        : { json: { default_branch: "main" } },
    );

    const out = await gitlabForge.compareBranch("tok", REPO, "legion/t1");
    assert.equal(out.error, null);
    const file = out.files![0]!;
    assert.equal(file.path, "src/a.ts");
    assert.equal(file.status, "modified");
    assert.equal(file.additions, 2, "GitLab sends no count: it is derived from the diff");
    assert.equal(file.deletions, 1);
  });

  it("translates flags into the shared status vocabulary", async () => {
    fakeApi((url) =>
      url.includes("/repository/compare")
        ? {
            json: {
              diffs: [
                { new_path: "n.ts", diff: "@@\n+a", new_file: true },
                { new_path: "d.ts", old_path: "d.ts", diff: "@@\n-a", deleted_file: true },
                { new_path: "r.ts", old_path: "o.ts", diff: "@@", renamed_file: true },
              ],
            },
          }
        : { json: { default_branch: "main" } },
    );

    const out = await gitlabForge.compareBranch("tok", REPO, "legion/t1");
    assert.deepEqual(
      out.files!.map((f) => f.status),
      ["added", "removed", "renamed"],
    );
  });

  it("a collapsed or too large diff returns `patch: null`, not an empty string", async () => {
    // Same meaning as GitHub's omitted `patch`: the UI must be able to say it does not know rather than
    // show a file "without changes".
    fakeApi((url) =>
      url.includes("/repository/compare")
        ? { json: { diffs: [{ new_path: "big.bin", diff: "", too_large: true }] } }
        : { json: { default_branch: "main" } },
    );

    const out = await gitlabForge.compareBranch("tok", REPO, "legion/t1");
    assert.equal(out.files![0]!.patch, null);
  });

  it("missing branch (404) is information, not an error", async () => {
    fakeApi((url) =>
      url.includes("/repository/compare")
        ? { status: 404, json: { message: "404 Ref Not Found" } }
        : { json: { default_branch: "main" } },
    );

    const out = await gitlabForge.compareBranch("tok", REPO, "legion/never-pushed");
    assert.equal(out.files, null);
    assert.equal(out.error, null, "nothing was pushed here: not a failure");
  });

  it("an unreachable project is named, without throwing", async () => {
    fakeApi(() => ({ status: 403, json: { message: "403 Forbidden" } }));
    const out = await gitlabForge.compareBranch("tok", REPO, "legion/t1");
    assert.equal(out.files, null);
    assert.match(out.error!, /403/);
  });
});

describe("listOpen", () => {
  it("keeps only legion/* branches and drops system notes", async () => {
    fakeApi((url) => {
      if (
        url.includes("/merge_requests?") ||
        url.includes("/merge_requests&") ||
        /merge_requests\?state=opened/.test(url)
      )
        return {
          json: [
            {
              iid: 7,
              title: "feat: export",
              web_url: "https://gitlab.com/kopee/back/api/-/merge_requests/7",
              source_branch: "legion/t1",
              merge_status: "cannot_be_merged",
            },
            {
              iid: 8,
              title: "chore: humain",
              web_url: "https://x/8",
              source_branch: "hotfix/manuel",
            },
          ],
        };
      if (url.includes("/notes"))
        return {
          json: [
            {
              id: 1,
              body: "assigned to @operator",
              system: true,
              author: { username: "operator" },
              created_at: "2026-08-26T10:00:00Z",
            },
            {
              id: 2,
              body: "A test is missing.",
              system: false,
              author: { username: "operator" },
              created_at: "2026-08-26T11:00:00Z",
              position: { new_path: "src/a.ts" },
            },
          ],
        };
      return { json: {} };
    });

    const out = await gitlabForge.listOpen("tok", REPO);
    assert.equal(out.length, 1, "the human MR outside legion/* is ignored");
    assert.equal(out[0]!.number, 7);
    assert.equal(out[0]!.comments.length, 1, "system notes are not human comments");
    assert.equal(out[0]!.comments[0]!.body, "A test is missing.");
    assert.equal(out[0]!.comments[0]!.path, "src/a.ts");
    // GitLab returns no URL per note: it is built from the MR's.
    assert.ok(out[0]!.comments[0]!.url.endsWith("#note_2"), out[0]!.comments[0]!.url);
    // `merge_status` is already on the list object (unlike GitHub, detail only): no extra call to read it.
    assert.equal(out[0]!.mergeState, "conflict");
  });
});

describe("mergeState: read from `merge_status`, never `detailed_merge_status`", () => {
  it("can_be_merged → mergeable, cannot_be_merged(_recheck) → conflict", async () => {
    fakeApi((url) => ({
      json: { merge_status: url.endsWith("/1") ? "can_be_merged" : "cannot_be_merged_recheck" },
    }));
    assert.equal(await gitlabForge.mergeState("tok", REPO, 1), "mergeable");
    assert.equal(await gitlabForge.mergeState("tok", REPO, 2), "conflict");
  });

  it("a status being checked (`unchecked`, `checking`) stays unknown, never guessed", async () => {
    fakeApi(() => ({ json: { merge_status: "checking" } }));
    assert.equal(await gitlabForge.mergeState("tok", REPO, 1), "unknown");
  });

  it("an unreachable project or unreadable URL returns unknown, never an exception", async () => {
    fakeApi(() => ({ status: 404 }));
    assert.equal(await gitlabForge.mergeState("tok", REPO, 1), "unknown");
    assert.equal(
      await gitlabForge.mergeState(
        "tok",
        { name: "x", url: "http://gitlab.com/x/y", forge: "gitlab" },
        1,
      ),
      "unknown",
    );
  });
});

describe("create: idempotence without relying on the status code", () => {
  it("returns the created MR's URL", async () => {
    fakeApi((url, init) => {
      if (init?.method === "POST")
        return {
          status: 201,
          json: { web_url: "https://gitlab.com/kopee/back/api/-/merge_requests/12" },
        };
      return { json: { default_branch: "main" } };
    });
    const res = await gitlabForge.create("tok", REPO, {
      branch: "legion/t1",
      title: "T",
      body: "B",
    });
    assert.deepEqual(res, {
      ok: true,
      url: "https://gitlab.com/kopee/back/api/-/merge_requests/12",
      existing: false,
    });
  });

  it("targets the project's default branch, not an assumed main", async () => {
    let posted: Record<string, unknown> = {};
    fakeApi((url, init) => {
      if (init?.method === "POST") {
        posted = JSON.parse(String(init.body)) as Record<string, unknown>;
        return { status: 201, json: { web_url: "https://x/1" } };
      }
      return { json: { default_branch: "trunk" } };
    });
    await gitlabForge.create("tok", REPO, { branch: "legion/t1", title: "T", body: "B" });
    assert.equal(posted.target_branch, "trunk");
    assert.equal(posted.source_branch, "legion/t1");
    assert.equal(posted.description, "B", "the pr.md body goes into `description`, not `body`");
  });

  it("finds the already open MR when creation fails", async () => {
    // The conflict code is undocumented (409 in some versions, 400 with a message in others), so it is
    // not relied on: look at the world (is there an open MR on this branch?) rather than a return code.
    fakeApi((url, init) => {
      if (init?.method === "POST")
        return { status: 409, json: { message: ["Another open merge request already exists"] } };
      if (url.includes("source_branch=")) return { json: [{ iid: 3, web_url: "https://x/3" }] };
      return { json: { default_branch: "main" } };
    });
    const res = await gitlabForge.create("tok", REPO, {
      branch: "legion/t1",
      title: "T",
      body: "B",
    });
    assert.deepEqual(res, { ok: true, url: "https://x/3", existing: true });
  });

  it("fails naming the reason when there is no MR to find", async () => {
    fakeApi((url, init) => {
      if (init?.method === "POST") return { status: 400, json: { message: "unknown branch" } };
      if (url.includes("source_branch=")) return { json: [] };
      return { json: { default_branch: "main" } };
    });
    const res = await gitlabForge.create("tok", REPO, {
      branch: "legion/t1",
      title: "T",
      body: "B",
    });
    assert.equal(res.ok, false);
    assert.match(res.ok === false ? res.error : "", /unknown branch/);
  });
});

describe("checks: the MR's latest pipeline and its red jobs", () => {
  it("translates the pipeline status, never passing by default", () => {
    assert.equal(checkStateOfPipelineStatus("success"), "passing");
    assert.equal(checkStateOfPipelineStatus("failed"), "failing");
    assert.equal(checkStateOfPipelineStatus("running"), "pending");
    assert.equal(checkStateOfPipelineStatus("waiting_for_resource"), "pending");
    assert.equal(checkStateOfPipelineStatus("canceled"), "unknown");
    assert.equal(checkStateOfPipelineStatus("manual"), "unknown");
    assert.equal(checkStateOfPipelineStatus(""), "unknown");
  });

  it("returns the failed pipeline's red jobs, with id and URL", async () => {
    const { calls } = fakeApi((url) =>
      url.includes("/pipelines/77/jobs")
        ? {
            json: [
              { id: 5150, name: "rspec", web_url: "https://gitlab.com/kopee/back/api/-/jobs/5150" },
            ],
          }
        : { json: [{ id: 77, status: "failed" }] },
    );
    const report = await gitlabForge.checks("tok", REPO, 12);
    assert.equal(report.state, "failing");
    assert.deepEqual(report.failing, [
      { id: "5150", name: "rspec", url: "https://gitlab.com/kopee/back/api/-/jobs/5150" },
    ]);
    assert.ok(calls[0]!.includes("/merge_requests/12/pipelines"), calls.join("\n"));
    assert.ok(calls[1]!.includes("scope[]=failed"), calls.join("\n"));
  });

  it("a green pipeline does not fetch jobs: one call, not two", async () => {
    const { calls } = fakeApi(() => ({ json: [{ id: 77, status: "success" }] }));
    assert.deepEqual(await gitlabForge.checks("tok", REPO, 12), { state: "passing", failing: [] });
    assert.equal(calls.length, 1);
  });

  it("no pipeline on the MR means unknown, never passing", async () => {
    fakeApi(() => ({ json: [] }));
    assert.deepEqual(await gitlabForge.checks("tok", REPO, 12), { state: "unknown", failing: [] });
  });
});

describe("checkLog: the job trace, as text", () => {
  it("calls /jobs/:id/trace on the encoded project", async () => {
    let asked = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      asked = String(input);
      return {
        ok: true,
        status: 200,
        text: async () => "1 example, 1 failure",
      } as unknown as Response;
    }) as typeof fetch;
    assert.equal(await gitlabForge.checkLog("tok", REPO, "5150"), "1 example, 1 failure");
    assert.equal(asked, "https://gitlab.com/api/v4/projects/kopee%2Fback%2Fapi/jobs/5150/trace");
  });

  it("a refusal returns null: the action continues with the job name and URL", async () => {
    globalThis.fetch = (async () =>
      ({ ok: false, status: 401, text: async () => "" }) as unknown as Response) as typeof fetch;
    assert.equal(await gitlabForge.checkLog("tok", REPO, "5150"), null);
  });
});

describe("listRepos: discovery starts from a token, so from an instance", () => {
  it("queries the default instance and translates what the v4 API returns", async () => {
    const { calls } = fakeApi(() => ({
      json: [
        {
          path_with_namespace: "kopee/back/api",
          http_url_to_repo: "https://gitlab.com/kopee/back/api.git",
          visibility: "private",
          default_branch: "main",
        },
      ],
    }));
    const found = await gitlabForge.listRepos("tok", "gitlab.com");
    assert.match(calls[0]!, /^https:\/\/gitlab\.com\/api\/v4\/projects\?membership=true/);
    assert.match(calls[0]!, /per_page=100/);
    assert.deepEqual(found, [
      {
        fullName: "kopee/back/api",
        url: "https://gitlab.com/kopee/back/api.git",
        private: true,
      },
    ]);
  });

  it("internal is not public: the UI has only two boxes", async () => {
    fakeApi(() => ({
      json: [
        {
          path_with_namespace: "g/p",
          http_url_to_repo: "https://gitlab.com/g/p.git",
          visibility: "internal",
        },
      ],
    }));
    assert.equal((await gitlabForge.listRepos("tok", "gitlab.com"))?.[0]?.private, true);
  });

  it("the received host moves the queried instance: a framagit token is not queried on gitlab.com", async () => {
    // The 16/09 fix. The host came from a global env variable, so an operator with a framagit token and
    // a gitlab.com token necessarily saw one refused, with a message blaming the token. It now comes
    // from the connection, and the adapter invents nothing (`forgeInstanceHost` resolves, see
    // forge.test.ts).
    const { calls } = fakeApi(() => ({ json: [] }));
    await gitlabForge.listRepos("tok", "framagit.org");
    assert.match(calls[0]!, /^https:\/\/framagit\.org\/api\/v4\/projects\?/);
  });

  it("a refusal returns `null`, never an empty list", async () => {
    fakeApi(() => ({ status: 401, json: { message: "401 Unauthorized" } }));
    assert.equal(await gitlabForge.listRepos("tok", "gitlab.com"), null);
  });

  it("an account without projects returns an empty list, which is something else", async () => {
    fakeApi(() => ({ json: [] }));
    assert.deepEqual(await gitlabForge.listRepos("tok", "gitlab.com"), []);
  });
});
