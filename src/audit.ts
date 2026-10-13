import { execFileSync } from "node:child_process";
import path from "node:path";
import { VERSION } from "./version.js";
import {
  overallFromChecks,
  type EvidenceCheck,
  type ReleaseReceipt,
  type Verdict,
} from "./types.js";
import {
  createGhClient,
  GitHubApiError,
  resolveTagCommit,
  type GhClient,
  type ReleaseInfo,
  type WorkflowJob,
  type WorkflowRun,
} from "./github/client.js";

export interface AuditOptions {
  repository: string; // owner/repo
  tag: string;
  requiredJobs?: string[];
  localRepo?: string;
  expectPrerelease?: boolean;
  client?: GhClient;
}

export interface PreflightOptions {
  repository: string;
  sha: string;
  requiredJobs?: string[];
  localRepo?: string;
  client?: GhClient;
}

function parseRepo(repository: string): { owner: string; repo: string } {
  const parts = repository.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`repository must be owner/repo, got: ${repository}`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function check(
  id: string,
  verdict: Verdict,
  explanation: string,
  extra?: Partial<EvidenceCheck>,
): EvidenceCheck {
  return { id, verdict, explanation, ...extra };
}

async function findCiForSha(
  client: GhClient,
  owner: string,
  repo: string,
  sha: string,
): Promise<{ run?: WorkflowRun; jobs: WorkflowJob[]; error?: string }> {
  try {
    const page = await client.getJson<{
      workflow_runs: WorkflowRun[];
    }>(
      `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`,
    );
    const runs = page.workflow_runs ?? [];
    const completed = runs.filter((r) => r.status === "completed");
    const preferred =
      completed.find((r) => r.conclusion === "success") ??
      completed[0] ??
      runs[0];
    if (!preferred) {
      return { jobs: [], error: "no Actions runs for this SHA" };
    }
    const jobsPage = await client.getJson<{ jobs: WorkflowJob[] }>(
      `/repos/${owner}/${repo}/actions/runs/${preferred.id}/jobs?per_page=100`,
    );
    return { run: preferred, jobs: jobsPage.jobs ?? [] };
  } catch (err) {
    if (err instanceof GitHubApiError) {
      return {
        jobs: [],
        error: err.rateLimited
          ? "rate limited while fetching Actions"
          : err.message,
      };
    }
    return { jobs: [], error: String(err) };
  }
}

function localGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function addLocalChecks(
  checks: EvidenceCheck[],
  localRepo: string | undefined,
  targetSha: string | undefined,
): void {
  if (!localRepo || !targetSha) return;
  const root = path.resolve(localRepo);
  const head = localGit(root, ["rev-parse", "HEAD"]);
  const tree = localGit(root, ["rev-parse", "HEAD^{tree}"]);
  if (!head) {
    checks.push(
      check(
        "local-head",
        "UNKNOWN",
        "Could not read local HEAD (not a git repo or git missing)",
      ),
    );
    return;
  }
  if (head === targetSha) {
    checks.push(
      check(
        "local-head",
        "PASS",
        "Local HEAD matches release target commit",
        { expected: targetSha, actual: head },
      ),
    );
  } else {
    // Compare trees if possible
    let remoteTree: string | null = null;
    try {
      // best-effort via cat-file if object exists locally
      remoteTree = localGit(root, ["rev-parse", `${targetSha}^{tree}`]);
    } catch {
      remoteTree = null;
    }
    if (remoteTree && tree && remoteTree === tree) {
      checks.push(
        check(
          "local-head",
          "WARN",
          "Local HEAD SHA differs from target, but trees are identical (content match, commit identity differs)",
          { expected: targetSha, actual: head },
        ),
      );
      checks.push(
        check("local-tree", "PASS", "Local tree SHA matches target commit tree", {
          expected: remoteTree,
          actual: tree,
        }),
      );
    } else {
      checks.push(
        check(
          "local-head",
          "FAIL",
          "Local HEAD does not match release target commit",
          { expected: targetSha, actual: head },
        ),
      );
    }
  }
}

export async function runAudit(opts: AuditOptions): Promise<ReleaseReceipt> {
  const client = opts.client ?? createGhClient();
  const { owner, repo } = parseRepo(opts.repository);
  const checks: EvidenceCheck[] = [];
  const notes: string[] = [
    "CI success does not prove the Release asset was built by that CI run.",
    "Identical file hashes do not imply identical Git commits.",
    "Asset presence is not a cryptographic provenance proof (NOT VERIFIED).",
    "Absence of findings is not a security guarantee.",
  ];
  let tagTargetSha: string | undefined;
  let releaseId: number | undefined;

  // Tag exists + resolve
  try {
    const resolved = await resolveTagCommit(
      client,
      owner,
      repo,
      opts.tag,
    );
    tagTargetSha = resolved.commitSha;
    checks.push(
      check("tag-exists", "PASS", `Tag ${opts.tag} exists`, {
        actual: opts.tag,
        sourceUrl: `https://github.com/${owner}/${repo}/releases/tag/${opts.tag}`,
      }),
    );
    checks.push(
      check(
        "tag-target",
        "PASS",
        resolved.annotated
          ? "Annotated tag dereferences to commit"
          : "Lightweight tag points to commit",
        {
          actual: resolved.commitSha,
          sourceUrl: `https://github.com/${owner}/${repo}/commit/${resolved.commitSha}`,
        },
      ),
    );
  } catch (err) {
    const msg =
      err instanceof GitHubApiError
        ? err.rateLimited
          ? "Rate limited resolving tag"
          : err.message
        : String(err);
    checks.push(
      check("tag-exists", err instanceof GitHubApiError && err.status === 404 ? "FAIL" : "UNKNOWN", msg, {
        expected: opts.tag,
      }),
    );
  }

  const tagResolved = Boolean(tagTargetSha);

  // Release
  let release: ReleaseInfo | undefined;
  if (!tagResolved) {
    checks.push(
      check(
        "release-exists",
        "UNKNOWN",
        "Skipped Release lookup because the tag could not be resolved",
        { expected: opts.tag },
      ),
    );
  } else try {
    release = await client.getJson<ReleaseInfo>(
      `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(opts.tag)}`,
    );
    releaseId = release.id;
    checks.push(
      check("release-exists", "PASS", "Release exists for tag", {
        actual: String(release.id),
        sourceUrl: release.html_url,
      }),
    );
    checks.push(
      check(
        "release-tag",
        release.tag_name === opts.tag ? "PASS" : "FAIL",
        "Release tag_name matches requested tag",
        { expected: opts.tag, actual: release.tag_name, sourceUrl: release.html_url },
      ),
    );
    if (opts.expectPrerelease !== undefined) {
      checks.push(
        check(
          "release-prerelease",
          release.prerelease === opts.expectPrerelease ? "PASS" : "FAIL",
          "Pre-release flag matches expectation",
          {
            expected: String(opts.expectPrerelease),
            actual: String(release.prerelease),
          },
        ),
      );
    } else {
      checks.push(
        check(
          "release-prerelease",
          "WARN",
          release.prerelease
            ? "Release is marked Pre-release"
            : "Release is marked as a full release",
          { actual: String(release.prerelease), sourceUrl: release.html_url },
        ),
      );
    }
    // Do NOT treat target_commitish as authoritative vs git tag
    if (tagTargetSha && release.target_commitish) {
      const tc = release.target_commitish;
      const isFullSha = /^[0-9a-f]{40}$/i.test(tc);
      const shaConflict = isFullSha && tc.toLowerCase() !== tagTargetSha.toLowerCase();
      checks.push(
        check(
          "release-target-commitish",
          shaConflict ? "WARN" : "PASS",
          shaConflict
            ? "Release.target_commitish is a different SHA than the dereferenced tag; tag dereference remains authoritative"
            : "Tag dereference is the source of truth; Release.target_commitish was not used as the commit identity",
          {
            expected: tagTargetSha,
            actual: tc,
            sourceUrl: release.html_url,
          },
        ),
      );
    }
    if (!release.assets?.length) {
      checks.push(
        check("release-assets", "WARN", "Release has no assets uploaded", {
          sourceUrl: release.html_url,
        }),
      );
    } else {
      checks.push(
        check(
          "release-assets",
          "PASS",
          `Release lists ${release.assets.length} asset(s)`,
          {
            actual: release.assets.map((a) => a.name).join(", "),
            sourceUrl: release.html_url,
          },
        ),
      );
    }
  } catch (err) {
    const missing = err instanceof GitHubApiError && err.status === 404;
    checks.push(
      check(
        "release-exists",
        missing ? "FAIL" : "UNKNOWN",
        missing
          ? "No GitHub Release for this tag"
          : err instanceof GitHubApiError
            ? err.message
            : String(err),
        { expected: opts.tag },
      ),
    );
  }

  // CI on tag target
  if (tagTargetSha) {
    const { run, jobs, error } = await findCiForSha(
      client,
      owner,
      repo,
      tagTargetSha,
    );
    if (!run) {
      checks.push(
        check("ci-run", "FAIL", error ?? "No completed Actions run for tag target SHA", {
          expected: tagTargetSha,
        }),
      );
    } else {
      const shaMatch = run.head_sha === tagTargetSha;
      checks.push(
        check(
          "ci-head-sha",
          shaMatch ? "PASS" : "FAIL",
          "Actions run head_sha equals tag target commit",
          {
            expected: tagTargetSha,
            actual: run.head_sha,
            sourceUrl: run.html_url,
          },
        ),
      );
      checks.push(
        check(
          "ci-conclusion",
          run.conclusion === "success"
            ? "PASS"
            : run.conclusion
              ? "FAIL"
              : "UNKNOWN",
          `Actions run conclusion: ${run.conclusion ?? run.status}`,
          { actual: run.conclusion ?? run.status, sourceUrl: run.html_url },
        ),
      );
      const required = opts.requiredJobs ?? [];
      if (required.length === 0) {
        const failed = jobs.filter((j) => j.conclusion && j.conclusion !== "success" && j.conclusion !== "skipped");
        checks.push(
          check(
            "ci-jobs",
            failed.length === 0 ? "PASS" : "FAIL",
            failed.length === 0
              ? `All ${jobs.length} job(s) succeeded or skipped`
              : `Failed jobs: ${failed.map((j) => j.name).join(", ")}`,
            { sourceUrl: run.html_url },
          ),
        );
      } else {
        for (const name of required) {
          const job = jobs.find((j) => j.name === name);
          if (!job) {
            checks.push(
              check("ci-job-" + name, "FAIL", `Required job not found: ${name}`, {
                expected: name,
                sourceUrl: run.html_url,
              }),
            );
          } else {
            checks.push(
              check(
                "ci-job-" + name,
                job.conclusion === "success" ? "PASS" : "FAIL",
                `Required job "${name}": ${job.conclusion ?? job.status}`,
                {
                  expected: "success",
                  actual: job.conclusion ?? job.status,
                  sourceUrl: job.html_url,
                },
              ),
            );
          }
        }
      }
    }

    // package.json version vs tag (JS/TS)
    try {
      const content = await client.getJson<{
        content?: string;
        encoding?: string;
      }>(
        `/repos/${owner}/${repo}/contents/package.json?ref=${encodeURIComponent(tagTargetSha)}`,
      );
      if (content.content && content.encoding === "base64") {
        const raw = Buffer.from(content.content.replace(/\n/g, ""), "base64").toString(
          "utf8",
        );
        const pkg = JSON.parse(raw) as { version?: string };
        const tagVer = opts.tag.replace(/^v/, "");
        if (pkg.version) {
          checks.push(
            check(
              "package-version",
              pkg.version === tagVer ? "PASS" : "FAIL",
              "package.json version matches tag (without leading v)",
              {
                expected: tagVer,
                actual: pkg.version,
                sourceUrl: `https://github.com/${owner}/${repo}/blob/${tagTargetSha}/package.json`,
              },
            ),
          );
        } else {
          checks.push(
            check("package-version", "UNKNOWN", "package.json has no version field"),
          );
        }
      }
    } catch (err) {
      if (err instanceof GitHubApiError && err.status === 404) {
        checks.push(
          check(
            "package-version",
            "WARN",
            "No package.json at tag target (non-JS project or path differs)",
          ),
        );
      } else {
        checks.push(
          check(
            "package-version",
            "UNKNOWN",
            err instanceof Error ? err.message : String(err),
          ),
        );
      }
    }
  }

  addLocalChecks(checks, opts.localRepo, tagTargetSha);

  const overallVerdict = overallFromChecks(checks);
  return {
    schemaVersion: "1.0",
    tool: "tagreceipt",
    toolVersion: VERSION,
    generatedAt: new Date().toISOString(),
    mode: "audit",
    repository: `${owner}/${repo}`,
    tag: opts.tag,
    tagTargetSha,
    releaseId,
    checks,
    overallVerdict,
    notes,
  };
}

export async function runPreflight(
  opts: PreflightOptions,
): Promise<ReleaseReceipt> {
  const client = opts.client ?? createGhClient();
  const { owner, repo } = parseRepo(opts.repository);
  const checks: EvidenceCheck[] = [];
  const notes: string[] = [
    "Preflight does not require a Release or Tag to exist.",
    "This is a commit/CI readiness check only.",
  ];
  const sha = opts.sha.trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    checks.push(
      check("sha-format", "FAIL", "SHA must be a full 40-character commit hash", {
        actual: sha,
      }),
    );
  } else {
    checks.push(
      check("sha-format", "PASS", "SHA format looks like a full commit hash", {
        actual: sha,
      }),
    );
    try {
      const commit = await client.getJson<{ sha: string; html_url: string }>(
        `/repos/${owner}/${repo}/commits/${sha}`,
      );
      checks.push(
        check("commit-exists", "PASS", "Commit exists on GitHub", {
          actual: commit.sha,
          sourceUrl: commit.html_url,
        }),
      );
    } catch (err) {
      checks.push(
        check(
          "commit-exists",
          err instanceof GitHubApiError && err.status === 404 ? "FAIL" : "UNKNOWN",
          err instanceof Error ? err.message : String(err),
          { expected: sha },
        ),
      );
    }

    const { run, jobs, error } = await findCiForSha(client, owner, repo, sha);
    if (!run) {
      checks.push(
        check("ci-run", "FAIL", error ?? "No Actions run for this SHA", {
          expected: sha,
        }),
      );
    } else {
      checks.push(
        check(
          "ci-head-sha",
          run.head_sha === sha ? "PASS" : "FAIL",
          "Actions run head_sha equals requested SHA",
          {
            expected: sha,
            actual: run.head_sha,
            sourceUrl: run.html_url,
          },
        ),
      );
      checks.push(
        check(
          "ci-conclusion",
          run.conclusion === "success"
            ? "PASS"
            : run.conclusion
              ? "FAIL"
              : "UNKNOWN",
          `Actions run conclusion: ${run.conclusion ?? run.status}`,
          { actual: run.conclusion ?? run.status, sourceUrl: run.html_url },
        ),
      );
      const required = opts.requiredJobs ?? [];
      if (required.length) {
        for (const name of required) {
          const job = jobs.find((j) => j.name === name);
          checks.push(
            check(
              "ci-job-" + name,
              !job
                ? "FAIL"
                : job.conclusion === "success"
                  ? "PASS"
                  : "FAIL",
              !job
                ? `Required job not found: ${name}`
                : `Required job "${name}": ${job.conclusion ?? job.status}`,
              {
                expected: "success",
                actual: job?.conclusion ?? "missing",
                sourceUrl: job?.html_url ?? run.html_url,
              },
            ),
          );
        }
      }
    }
  }

  // Explicitly note release not required
  checks.push(
    check(
      "release-not-required",
      "PASS",
      "Preflight mode: Release/Tag presence is not required",
    ),
  );

  addLocalChecks(checks, opts.localRepo, sha);

  return {
    schemaVersion: "1.0",
    tool: "tagreceipt",
    toolVersion: VERSION,
    generatedAt: new Date().toISOString(),
    mode: "preflight",
    repository: `${owner}/${repo}`,
    tagTargetSha: sha,
    checks,
    overallVerdict: overallFromChecks(checks),
    notes,
  };
}
