import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReleaseReceipt } from "../types.js";
import { renderHtml } from "./html.js";

export async function writeReceipt(
  receipt: ReleaseReceipt,
  outDir: string,
): Promise<{ htmlPath: string; jsonPath: string; summaryPath: string }> {
  const abs = path.resolve(outDir);
  await mkdir(abs, { recursive: true });
  const jsonPath = path.join(abs, "receipt.json");
  const htmlPath = path.join(abs, "index.html");
  const summaryPath = path.join(abs, "summary.md");

  const md = [
    `# TagReceipt summary`,
    ``,
    `**Verdict:** ${receipt.overallVerdict}`,
    `**Mode:** ${receipt.mode}`,
    `**Repository:** ${receipt.repository}`,
    `**Tag:** ${receipt.tag ?? "—"}`,
    `**Target SHA:** ${receipt.tagTargetSha ?? "—"}`,
    ``,
    `| Check | Verdict | Explanation |`,
    `| --- | --- | --- |`,
    ...receipt.checks.map(
      (c) => `| \`${c.id}\` | ${c.verdict} | ${c.explanation.replace(/\|/g, "\\|")} |`,
    ),
    ``,
    `## Limits`,
    ...receipt.notes.map((n) => `- ${n}`),
    ``,
  ].join("\n");

  await writeFile(jsonPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  await writeFile(htmlPath, renderHtml(receipt), "utf8");
  await writeFile(summaryPath, md, "utf8");
  return { htmlPath, jsonPath, summaryPath };
}
