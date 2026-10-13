import { describe, expect, it } from "vitest";
import { runAudit, runPreflight } from "../src/audit.js";
import { happyPathFixture, mockClient } from "./fixtures.js";
import { GitHubApiError } from "../src/github/client.js";

describe("audit fixtures", () => {
  it("passes a complete normal release", async () => {
    const receipt = await runAudit({
      repository: "acme/demo",
      tag: "v0.1.0-rc.1",
      expectPrerelease: true,
      client: happyPathFixture(),
    });
    expect(receipt.overallVerdict).toBe("PASS");
    expect(receipt.tagTargetSha).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(receipt.checks.find((c) => c.id === "tag-exists")?.verdict).toBe(
      "PASS",
    );
    expect(receipt.checks.find((c) => c.id === "ci-head-sha")?.verdict).toBe(
      "PASS",
    );
  });

  it("handles lightweight tags", async () => {
    const receipt = await runAudit({
      repository: "acme/demo",
      tag: "v0.1.0-rc.1",
      client: happyPathFixture({ annotated: false }),
    });
    expect(receipt.checks.find((c) => c.id === "tag-target")?.explanation).toMatch(
      /Lightweight/,
    );
  });

  it("fails when release is missing", async () => {
    const receipt = await runAudit({
      repository: "acme/demo",
      tag: "v0.1.0-rc.1",
      client: happyPathFixture({ noRelease: true }),
    });
    expect(receipt.checks.find((c) => c.id === "release-exists")?.verdict).toBe(
      "FAIL",
    );
    expect(receipt.overallVerdict).toBe("FAIL");
  });

  it("fails when CI head sha mismatches tag target", async () => {
    const receipt = await runAudit({
      repository: "acme/demo",
      tag: "v0.1.0-rc.1",
      client: happyPathFixture({ wrongCiSha: true }),
    });
    expect(receipt.checks.find((c) => c.id === "ci-head-sha")?.verdict).toBe(
      "FAIL",
    );
  });

  it("fails when a required job fails", async () => {
    const receipt = await runAudit({
      repository: "acme/demo",
      tag: "v0.1.0-rc.1",
      requiredJobs: ["test"],
      client: happyPathFixture({ jobFail: true }),
    });
    expect(receipt.checks.find((c) => c.id === "ci-job-test")?.verdict).toBe(
      "FAIL",
    );
  });

  it("fails package.json version mismatch", async () => {
    const receipt = await runAudit({
      repository: "acme/demo",
      tag: "v0.1.0-rc.1",
      client: happyPathFixture({ version: "9.9.9" }),
    });
    expect(
      receipt.checks.find((c) => c.id === "package-version")?.verdict,
    ).toBe("FAIL");
  });

  it("warns when assets missing", async () => {
    const receipt = await runAudit({
      repository: "acme/demo",
      tag: "v0.1.0-rc.1",
      client: happyPathFixture({ noAssets: true }),
    });
    expect(receipt.checks.find((c) => c.id === "release-assets")?.verdict).toBe(
      "WARN",
    );
  });

  it("marks UNKNOWN on rate limit for tag resolve", async () => {
    const client = mockClient({
      "/repos/acme/demo/git/ref/tags/v0.1.0-rc.1": () => {
        throw new GitHubApiError("rate limited", 403, true);
      },
    });
    const receipt = await runAudit({
      repository: "acme/demo",
      tag: "v0.1.0-rc.1",
      client,
    });
    expect(receipt.checks.find((c) => c.id === "tag-exists")?.verdict).toBe(
      "UNKNOWN",
    );
    expect(receipt.overallVerdict).toBe("UNKNOWN");
  });

  it("fails when no Actions run exists for the tag SHA", async () => {
    const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { mockClient } = await import("./fixtures.js");
    const { GitHubApiError } = await import("../src/github/client.js");
    const client = mockClient({
      "/repos/acme/demo/git/ref/tags/v0.1.0-rc.1": {
        ref: "refs/tags/v0.1.0-rc.1",
        object: { sha, type: "commit" },
      },
      "/repos/acme/demo/releases/tags/v0.1.0-rc.1": {
        id: 1,
        tag_name: "v0.1.0-rc.1",
        name: "x",
        draft: false,
        prerelease: true,
        target_commitish: "main",
        html_url: "https://github.com/acme/demo/releases/tag/v0.1.0-rc.1",
        assets: [],
      },
      [`/repos/acme/demo/actions/runs?head_sha=${sha}&per_page=20`]: {
        workflow_runs: [],
      },
      [`/repos/acme/demo/contents/package.json?ref=${sha}`]: () => {
        throw new GitHubApiError("Not found", 404);
      },
    });
    const receipt = await runAudit({
      repository: "acme/demo",
      tag: "v0.1.0-rc.1",
      client,
    });
    expect(receipt.checks.find((c) => c.id === "ci-run")?.verdict).toBe("FAIL");
  });

  it("fails missing tag", async () => {
    const client = mockClient({});
    const receipt = await runAudit({
      repository: "acme/demo",
      tag: "v9.9.9",
      client,
    });
    expect(receipt.checks.find((c) => c.id === "tag-exists")?.verdict).toBe(
      "FAIL",
    );
  });
});

describe("preflight", () => {
  it("does not require a release", async () => {
    const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const client = mockClient({
      [`/repos/acme/demo/commits/${sha}`]: {
        sha,
        html_url: "https://github.com/acme/demo/commit/" + sha,
      },
      [`/repos/acme/demo/actions/runs?head_sha=${sha}&per_page=20`]: {
        workflow_runs: [
          {
            id: 1,
            name: "CI",
            head_sha: sha,
            status: "completed",
            conclusion: "success",
            html_url: "https://github.com/acme/demo/actions/runs/1",
            event: "push",
          },
        ],
      },
      "/repos/acme/demo/actions/runs/1/jobs?per_page=100": {
        jobs: [
          {
            id: 1,
            name: "test",
            conclusion: "success",
            status: "completed",
            html_url: "https://github.com/acme/demo/job/1",
          },
        ],
      },
    });
    const receipt = await runPreflight({
      repository: "acme/demo",
      sha,
      client,
    });
    expect(receipt.mode).toBe("preflight");
    expect(
      receipt.checks.find((c) => c.id === "release-not-required")?.verdict,
    ).toBe("PASS");
    expect(receipt.overallVerdict).toBe("PASS");
  });
});
