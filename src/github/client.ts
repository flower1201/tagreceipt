import { execFileSync } from "node:child_process";

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly rateLimited = false,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export interface GhClient {
  getJson<T>(path: string): Promise<T>;
}

/** Prefer authenticated `gh api` (never prints token). Fallback: public fetch. */
export function createGhClient(opts?: {
  token?: string;
  fetchImpl?: typeof fetch;
}): GhClient {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const token = opts?.token; // only for tests; never log

  return {
    async getJson<T>(apiPath: string): Promise<T> {
      // Try gh CLI first (uses OS credential helper; stdout is JSON only)
      try {
        const out = execFileSync("gh", ["api", apiPath], {
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        return JSON.parse(out) as T;
      } catch (err) {
        const stderr =
          err && typeof err === "object" && "stderr" in err
            ? String((err as { stderr?: unknown }).stderr ?? "")
            : "";
        const statusMatch = /HTTP (\d{3})/.exec(stderr);
        const status = statusMatch
          ? Number.parseInt(statusMatch[1], 10)
          : undefined;
        if (status === 404) {
          throw new GitHubApiError(`Not found: ${apiPath}`, 404);
        }
        if (status === 403 && /rate limit/i.test(stderr)) {
          throw new GitHubApiError(`Rate limited: ${apiPath}`, 403, true);
        }
        // Fall through to public fetch for public repos / when gh missing
      }

      const url = `https://api.github.com${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "tagreceipt",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetchImpl(url, { headers });
      if (res.status === 404) {
        throw new GitHubApiError(`Not found: ${apiPath}`, 404);
      }
      if (res.status === 403) {
        const remaining = res.headers.get("x-ratelimit-remaining");
        const limited = remaining === "0" || /rate limit/i.test(await res.text());
        throw new GitHubApiError(
          `Forbidden or rate limited: ${apiPath}`,
          403,
          limited,
        );
      }
      if (!res.ok) {
        throw new GitHubApiError(
          `GitHub API ${res.status} for ${apiPath}`,
          res.status,
        );
      }
      return (await res.json()) as T;
    },
  };
}

export interface TagRef {
  ref: string;
  object: { sha: string; type: string };
}

export interface GitObject {
  sha: string;
  type?: string;
  object?: { sha: string; type: string };
  tag?: string;
  message?: string;
}

export interface ReleaseInfo {
  id: number;
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  target_commitish: string;
  html_url: string;
  assets: Array<{ name: string; size: number; browser_download_url: string }>;
}

export interface WorkflowRun {
  id: number;
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  event: string;
}

export interface WorkflowJob {
  id: number;
  name: string;
  conclusion: string | null;
  status: string;
  html_url: string;
}

export async function resolveTagCommit(
  client: GhClient,
  owner: string,
  repo: string,
  tag: string,
): Promise<{ tagSha: string; commitSha: string; annotated: boolean }> {
  const clean = tag.replace(/^refs\/tags\//, "");
  const ref = await client.getJson<TagRef>(
    `/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(clean)}`,
  );
  if (ref.object.type === "commit") {
    return {
      tagSha: ref.object.sha,
      commitSha: ref.object.sha,
      annotated: false,
    };
  }
  // annotated tag object
  const tagObj = await client.getJson<GitObject>(
    `/repos/${owner}/${repo}/git/tags/${ref.object.sha}`,
  );
  const commitSha = tagObj.object?.sha;
  if (!commitSha) {
    throw new GitHubApiError(`Annotated tag has no target commit: ${clean}`);
  }
  return {
    tagSha: ref.object.sha,
    commitSha,
    annotated: true,
  };
}
