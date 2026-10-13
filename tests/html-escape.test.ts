import { describe, expect, it } from "vitest";
import { renderHtml } from "../src/report/html.js";
import type { ReleaseReceipt } from "../src/types.js";

describe("html escape", () => {
  it("escapes XSS in check fields", () => {
    const receipt: ReleaseReceipt = {
      schemaVersion: "1.0",
      tool: "tagreceipt",
      toolVersion: "0.1.0-rc.1",
      generatedAt: "2026-01-01T00:00:00.000Z",
      mode: "audit",
      repository: "acme/demo",
      tag: `<script>alert(1)</script>`,
      checks: [
        {
          id: "x",
          verdict: "FAIL",
          explanation: `<img src=x onerror=alert(1)>`,
          actual: `<script>x</script>`,
        },
      ],
      overallVerdict: "FAIL",
      notes: [`<script>bad</script>`],
    };
    const html = renderHtml(receipt);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toMatch(/<img[^>]*onerror=/i);
    expect(html).toContain("&lt;script&gt;");
  });
});
