import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist", "cli", "index.js");
const out = path.join(root, "examples", "out-demo");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Real public audit — TaskFootprint has a known Pre-release
try {
  execFileSync(
    process.execPath,
    [
      cli,
      "audit",
      "flower1201/taskfootprint",
      "--tag",
      "v0.1.0-rc.1",
      "--expect-prerelease",
      "--out",
      out,
    ],
    { stdio: "inherit" },
  );
} catch (err) {
  // Non-zero exit is OK (WARN/FAIL still produce reports)
  if (err && typeof err === "object" && "status" in err) {
    const st = err.status;
    if (st !== 0 && st !== 2 && st !== 3 && st !== 1) throw err;
  } else {
    throw err;
  }
}

console.log(`\nDemo report: ${path.join(out, "index.html")}`);
console.log("Open via file:// — real TaskFootprint v0.1.0-rc.1 audit");
