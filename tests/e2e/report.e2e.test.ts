import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { writeReceipt } from "../../src/report/write.js";
import { renderHtml } from "../../src/report/html.js";
import type { ReleaseReceipt } from "../../src/types.js";
import { runAudit } from "../../src/audit.js";
import { happyPathFixture } from "../fixtures.js";

let tmp = "";
let htmlPath = "";

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "tr-e2e-"));
  const receipt = await runAudit({
    repository: "acme/demo",
    tag: "v0.1.0-rc.1",
    expectPrerelease: true,
    client: happyPathFixture(),
  });
  const paths = await writeReceipt(receipt, path.join(tmp, "report"));
  htmlPath = paths.htmlPath;
});

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("file:// TagReceipt report", () => {
  it("renders verdict without external requests", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const requests: string[] = [];
      const errors: string[] = [];
      page.on("request", (r) => requests.push(r.url()));
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(pathToFileURL(htmlPath).href);
      expect(await page.locator("#verdict").innerText()).toBe("PASS");
      expect(await page.locator("#repo").innerText()).toBe("acme/demo");
      const body = await page.locator("body").innerText();
      expect(body).toContain("TagReceipt");
      expect(body).toContain("tag-exists");
      expect(
        requests.filter((u) => !u.startsWith("file:") && !u.startsWith("data:")),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("does not execute XSS", async () => {
    const receipt: ReleaseReceipt = {
      schemaVersion: "1.0",
      tool: "tagreceipt",
      toolVersion: "0.1.0-rc.1",
      generatedAt: "2026-01-01T00:00:00.000Z",
      mode: "audit",
      repository: "acme/demo",
      tag: "v1",
      checks: [
        {
          id: "x",
          verdict: "FAIL",
          explanation: `<img src=x onerror="window.__xss=1">`,
        },
      ],
      overallVerdict: "FAIL",
      notes: [],
    };
    const p = path.join(tmp, "xss.html");
    await writeFile(p, renderHtml(receipt), "utf8");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(p).href);
      const flagged = await page.evaluate(
        () => (window as unknown as { __xss?: number }).__xss === 1,
      );
      expect(flagged).toBe(false);
    } finally {
      await browser.close();
    }
  });
});
