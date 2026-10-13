import { z } from "zod";

export const VerdictSchema = z.enum(["PASS", "FAIL", "WARN", "UNKNOWN"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const EvidenceCheckSchema = z.object({
  id: z.string(),
  verdict: VerdictSchema,
  explanation: z.string(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  sourceUrl: z.string().optional(),
});
export type EvidenceCheck = z.infer<typeof EvidenceCheckSchema>;

export const ReleaseReceiptSchema = z.object({
  schemaVersion: z.literal("1.0"),
  tool: z.literal("tagreceipt"),
  toolVersion: z.string(),
  generatedAt: z.string(),
  mode: z.enum(["audit", "preflight"]),
  repository: z.string(),
  tag: z.string().optional(),
  tagTargetSha: z.string().optional(),
  releaseId: z.number().optional(),
  checks: z.array(EvidenceCheckSchema),
  overallVerdict: VerdictSchema,
  notes: z.array(z.string()),
});
export type ReleaseReceipt = z.infer<typeof ReleaseReceiptSchema>;

export function overallFromChecks(checks: EvidenceCheck[]): Verdict {
  if (checks.some((c) => c.verdict === "FAIL")) return "FAIL";
  if (checks.some((c) => c.verdict === "UNKNOWN")) return "UNKNOWN";
  if (checks.some((c) => c.verdict === "WARN")) return "WARN";
  return "PASS";
}

export function exitCodeFor(verdict: Verdict): number {
  switch (verdict) {
    case "PASS":
      return 0;
    case "WARN":
      return 3;
    case "UNKNOWN":
      return 1;
    case "FAIL":
      return 2;
  }
}
