export { VERSION } from "./version.js";
export { runAudit, runPreflight } from "./audit.js";
export { writeReceipt } from "./report/write.js";
export { renderHtml } from "./report/html.js";
export type { ReleaseReceipt, EvidenceCheck, Verdict } from "./types.js";
export { overallFromChecks, exitCodeFor } from "./types.js";
