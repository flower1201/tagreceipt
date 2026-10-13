import type { GhClient } from "../src/github/client.js";

type Route = (path: string) => unknown;

export function mockClient(routes: Record<string, unknown | Route>): GhClient {
  return {
    async getJson<T>(apiPath: string): Promise<T> {
      const exact = routes[apiPath];
      if (typeof exact === "function") {
        return (exact as Route)(apiPath) as T;
      }
      if (exact !== undefined) return exact as T;
      for (const [key, val] of Object.entries(routes)) {
        if (key.endsWith("*") && apiPath.startsWith(key.slice(0, -1))) {
          if (typeof val === "function") return (val as Route)(apiPath) as T;
          return val as T;
        }
      }
      const err = new Error(`Not found: ${apiPath}`) as Error & {
        status?: number;
      };
      // Re-throw as GitHubApiError-compatible via dynamic import pattern in audit
      const { GitHubApiError } = await import("../src/github/client.js");
      throw new GitHubApiError(`Not found: ${apiPath}`, 404);
    },
  };
}

export function happyPathFixture(opts?: {
  tag?: string;
  sha?: string;
  version?: string;
  prerelease?: boolean;
  annotated?: boolean;
  jobFail?: boolean;
  wrongCiSha?: boolean;
  noRelease?: boolean;
  noAssets?: boolean;
  rateLimit?: boolean;
}) {
  const tag = opts?.tag ?? "v0.1.0-rc.1";
  const sha =
    opts?.sha ?? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const ciSha = opts?.wrongCiSha
    ? "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    : sha;
  const version = opts?.version ?? "0.1.0-rc.1";
  const annotated = opts?.annotated ?? true;
  const tagObjSha = "cccccccccccccccccccccccccccccccccccccccc";

  const routes: Record<string, unknown> = {};

  if (annotated) {
    routes[`/repos/acme/demo/git/ref/tags/${tag}`] = {
      ref: `refs/tags/${tag}`,
      object: { sha: tagObjSha, type: "tag" },
    };
    routes[`/repos/acme/demo/git/tags/${tagObjSha}`] = {
      sha: tagObjSha,
      object: { sha, type: "commit" },
      tag,
      message: "release",
    };
  } else {
    routes[`/repos/acme/demo/git/ref/tags/${tag}`] = {
      ref: `refs/tags/${tag}`,
      object: { sha, type: "commit" },
    };
  }

  if (!opts?.noRelease) {
    routes[`/repos/acme/demo/releases/tags/${tag}`] = {
      id: 101,
      tag_name: tag,
      name: `Demo ${tag}`,
      draft: false,
      prerelease: opts?.prerelease ?? true,
      target_commitish: "main",
      html_url: `https://github.com/acme/demo/releases/tag/${tag}`,
      assets: opts?.noAssets
        ? []
        : [{ name: "demo.tgz", size: 12, browser_download_url: "https://example.com/demo.tgz" }],
    };
  }

  routes[`/repos/acme/demo/actions/runs?head_sha=${sha}&per_page=20`] = {
    workflow_runs: [
      {
        id: 9,
        name: "CI",
        head_sha: ciSha,
        status: "completed",
        conclusion: opts?.jobFail ? "failure" : "success",
        html_url: "https://github.com/acme/demo/actions/runs/9",
        event: "push",
      },
    ],
  };
  // also when querying wrong sha path for wrongCiSha case on tag sha
  routes[`/repos/acme/demo/actions/runs?head_sha=${ciSha}&per_page=20`] = {
    workflow_runs: [
      {
        id: 9,
        name: "CI",
        head_sha: ciSha,
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/acme/demo/actions/runs/9",
        event: "push",
      },
    ],
  };

  routes[`/repos/acme/demo/actions/runs/9/jobs?per_page=100`] = {
    jobs: [
      {
        id: 1,
        name: "test",
        conclusion: opts?.jobFail ? "failure" : "success",
        status: "completed",
        html_url: "https://github.com/acme/demo/actions/runs/9/job/1",
      },
    ],
  };

  const pkgB64 = Buffer.from(
    JSON.stringify({ name: "demo", version }),
  ).toString("base64");
  routes[`/repos/acme/demo/contents/package.json?ref=${sha}`] = {
    content: pkgB64,
    encoding: "base64",
  };

  return mockClient(routes);
}
