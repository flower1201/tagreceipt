/**
 * Fast-forward current git tree onto GitHub when git HTTPS is blocked.
 * Seeds an empty repo, then creates a child commit of remote HEAD (no force).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const OWNER = "flower1201";
const REPO = "tagreceipt";
const BRANCH = "main";

function ghApi(method, apiPath, body) {
  const args = ["api", "-X", method, apiPath, "--input", "-"];
  const out = execFileSync("gh", args, {
    input: JSON.stringify(body),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function ghGet(apiPath) {
  const out = execFileSync("gh", ["api", apiPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function listFiles() {
  const raw = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return raw.split("\0").filter(Boolean);
}

let headSha = null;
try {
  const ref = ghGet(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  headSha = ref.object.sha;
  console.log(`existing ${BRANCH}: ${headSha}`);
} catch {
  console.log("repo empty — seeding README via Contents API…");
  const readme = readFileSync("README.md");
  const seeded = ghApi("PUT", `/repos/${OWNER}/${REPO}/contents/README.md`, {
    message: "seed: enable Git Data API on empty repository",
    content: readme.toString("base64"),
    branch: BRANCH,
  });
  headSha = seeded.commit.sha;
  console.log(`seeded commit ${headSha}`);
}

const files = listFiles();
console.log(`uploading ${files.length} blobs…`);
const tree = [];
for (const rel of files) {
  const content = readFileSync(rel);
  const blob = ghApi("POST", `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: content.toString("base64"),
    encoding: "base64",
  });
  tree.push({
    path: rel.replace(/\\/g, "/"),
    mode: "100644",
    type: "blob",
    sha: blob.sha,
  });
  console.log(`  ${rel}`);
}

const treeRes = ghApi("POST", `/repos/${OWNER}/${REPO}/git/trees`, { tree });
const msg = execFileSync("git", ["log", "-1", "--format=%B"], {
  encoding: "utf8",
}).trim();

const commit = ghApi("POST", `/repos/${OWNER}/${REPO}/git/commits`, {
  message: msg,
  tree: treeRes.sha,
  parents: [headSha],
});

ghApi("PATCH", `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
  sha: commit.sha,
  force: false,
});

console.log(`pushed ${commit.sha} → ${OWNER}/${REPO}@${BRANCH}`);
console.log(`https://github.com/${OWNER}/${REPO}`);
