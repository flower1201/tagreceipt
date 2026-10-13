import path from "node:path";
import { Command } from "commander";
import { VERSION } from "../version.js";
import { runAudit, runPreflight } from "../audit.js";
import { writeReceipt } from "../report/write.js";
import { exitCodeFor } from "../types.js";

const program = new Command();

program
  .name("tagreceipt")
  .description(
    "Audit GitHub releases against the exact commits and CI jobs that tested them.",
  )
  .version(VERSION);

program
  .command("audit")
  .description("Audit an existing Tag + Release evidence chain")
  .argument("<repository>", "owner/repo")
  .requiredOption("--tag <tag>", "release tag (e.g. v0.1.0-rc.1)")
  .option("-o, --out <dir>", "report output directory", "./release-report")
  .option(
    "--require-job <name>",
    "required CI job name (repeatable)",
    collect,
    [] as string[],
  )
  .option("--local <path>", "optional local clone for HEAD/tree check")
  .option("--expect-prerelease", "require release.prerelease === true", false)
  .option("--expect-full-release", "require release.prerelease === false", false)
  .option("--json", "print receipt JSON to stdout", false)
  .action(
    async (
      repository: string,
      opts: {
        tag: string;
        out: string;
        requireJob: string[];
        local?: string;
        expectPrerelease: boolean;
        expectFullRelease: boolean;
        json: boolean;
      },
    ) => {
      try {
        let expectPrerelease: boolean | undefined;
        if (opts.expectPrerelease) expectPrerelease = true;
        if (opts.expectFullRelease) expectPrerelease = false;
        const receipt = await runAudit({
          repository,
          tag: opts.tag,
          requiredJobs: opts.requireJob,
          localRepo: opts.local,
          expectPrerelease,
        });
        const paths = await writeReceipt(receipt, path.resolve(opts.out));
        if (opts.json) {
          console.log(JSON.stringify(receipt, null, 2));
        } else {
          console.log(`TagReceipt ${VERSION}`);
          console.log(
            `verdict: ${receipt.overallVerdict} (exit ${exitCodeFor(receipt.overallVerdict)})`,
          );
          console.log(
            `${receipt.repository} @ ${receipt.tag} → ${receipt.tagTargetSha ?? "—"}`,
          );
          console.log(`wrote ${paths.htmlPath}`);
          console.log(`wrote ${paths.jsonPath}`);
          console.log(`wrote ${paths.summaryPath}`);
        }
        process.exitCode = exitCodeFor(receipt.overallVerdict);
      } catch (err) {
        console.error(`error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    },
  );

program
  .command("preflight")
  .description("Check commit/CI readiness without requiring a Release")
  .argument("<repository>", "owner/repo")
  .requiredOption("--sha <sha>", "full 40-char commit SHA")
  .option("-o, --out <dir>", "report output directory", "./release-report")
  .option(
    "--require-job <name>",
    "required CI job name (repeatable)",
    collect,
    [] as string[],
  )
  .option("--local <path>", "optional local clone for HEAD/tree check")
  .option("--json", "print receipt JSON to stdout", false)
  .action(
    async (
      repository: string,
      opts: {
        sha: string;
        out: string;
        requireJob: string[];
        local?: string;
        json: boolean;
      },
    ) => {
      try {
        const receipt = await runPreflight({
          repository,
          sha: opts.sha,
          requiredJobs: opts.requireJob,
          localRepo: opts.local,
        });
        const paths = await writeReceipt(receipt, path.resolve(opts.out));
        if (opts.json) {
          console.log(JSON.stringify(receipt, null, 2));
        } else {
          console.log(`TagReceipt ${VERSION}`);
          console.log(
            `verdict: ${receipt.overallVerdict} (exit ${exitCodeFor(receipt.overallVerdict)})`,
          );
          console.log(`wrote ${paths.htmlPath}`);
        }
        process.exitCode = exitCodeFor(receipt.overallVerdict);
      } catch (err) {
        console.error(`error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    },
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`error: ${(err as Error).message}`);
  process.exitCode = 1;
});

function collect(value: string, acc: string[]): string[] {
  acc.push(value);
  return acc;
}
