import type { ReleaseReceipt } from "../types.js";
import { escapeHtml, shortSha } from "../util/escape.js";

export function renderHtml(receipt: ReleaseReceipt): string {
  const rows = receipt.checks
    .map((c) => {
      const cls = `v-${c.verdict.toLowerCase()}`;
      return `<tr class="${cls}">
  <td><code>${escapeHtml(c.id)}</code></td>
  <td><span class="badge ${cls}">${escapeHtml(c.verdict)}</span></td>
  <td>${escapeHtml(c.explanation)}</td>
  <td>${c.expected ? `<code>${escapeHtml(c.expected)}</code>` : "—"}</td>
  <td>${c.actual ? `<code>${escapeHtml(c.actual)}</code>` : "—"}</td>
  <td>${c.sourceUrl ? `<a href="${escapeHtml(c.sourceUrl)}">link</a>` : "—"}</td>
</tr>`;
    })
    .join("\n");

  const notes = receipt.notes
    .map((n) => `<li>${escapeHtml(n)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>TagReceipt — ${escapeHtml(receipt.repository)}</title>
<style>
  :root { --bg:#0e1116; --panel:#161b22; --text:#e7e5e4; --muted:#a8a29e; --line:#292524;
    --pass:#14b8a6; --fail:#f43f5e; --warn:#f59e0b; --unk:#94a3b8; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:"Segoe UI",ui-sans-serif,system-ui,sans-serif; color:var(--text);
    background: radial-gradient(1000px 500px at 0% -10%, #134e4a44, transparent),
                radial-gradient(800px 400px at 100% 0%, #1e293b55, transparent), var(--bg); }
  main { max-width:1080px; margin:0 auto; padding:2rem 1.25rem 4rem; }
  h1 { margin:0 0 .25rem; font-size:1.55rem; letter-spacing:-.02em; }
  .sub { color:var(--muted); margin-bottom:1.25rem; }
  .badge { display:inline-block; padding:.15rem .5rem; border-radius:.35rem; font-weight:700; font-size:.8rem; }
  .v-pass, .badge.v-pass { background:#134e4a; color:var(--pass); }
  .v-fail, .badge.v-fail { background:#4c0519; color:var(--fail); }
  .v-warn, .badge.v-warn { background:#451a03; color:var(--warn); }
  .v-unknown, .badge.v-unknown { background:#1e293b; color:var(--unk); }
  .chain { display:flex; flex-wrap:wrap; gap:.5rem; margin:1rem 0 1.5rem; }
  .chip { background:var(--panel); border:1px solid var(--line); border-radius:.5rem; padding:.55rem .75rem; }
  .chip .l { color:var(--muted); font-size:.7rem; text-transform:uppercase; letter-spacing:.06em; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border-radius:.6rem; overflow:hidden; }
  th, td { text-align:left; padding:.55rem .65rem; border-bottom:1px solid var(--line); font-size:.88rem; vertical-align:top; }
  th { color:var(--muted); font-size:.72rem; text-transform:uppercase; letter-spacing:.05em; }
  code { font-family:ui-monospace,Consolas,monospace; font-size:.82em; word-break:break-all; }
  a { color:var(--pass); }
  footer { margin-top:2rem; color:var(--muted); font-size:.8rem; }
  ul { color:var(--muted); }
</style>
</head>
<body>
<main>
  <h1>TagReceipt</h1>
  <p class="sub">Did you release the commit you actually tested?</p>
  <p>
    <span class="badge v-${escapeHtml(receipt.overallVerdict.toLowerCase())}" id="verdict">${escapeHtml(receipt.overallVerdict)}</span>
    · mode <strong id="mode">${escapeHtml(receipt.mode)}</strong>
    · <code id="repo">${escapeHtml(receipt.repository)}</code>
  </p>

  <div class="chain" id="chain">
    <div class="chip"><div class="l">Tag</div><code>${escapeHtml(receipt.tag ?? "—")}</code></div>
    <div class="chip"><div class="l">Commit</div><code>${escapeHtml(shortSha(receipt.tagTargetSha, 40))}</code></div>
    <div class="chip"><div class="l">Release</div><code>${receipt.releaseId != null ? escapeHtml(String(receipt.releaseId)) : "—"}</code></div>
    <div class="chip"><div class="l">Generated</div><code>${escapeHtml(receipt.generatedAt)}</code></div>
  </div>

  <section>
    <h2>Evidence checks</h2>
    <table>
      <thead><tr><th>Id</th><th>Verdict</th><th>Explanation</th><th>Expected</th><th>Actual</th><th>Source</th></tr></thead>
      <tbody id="checks">${rows}</tbody>
    </table>
  </section>

  <section>
    <h2>Limits</h2>
    <ul id="notes">${notes}</ul>
  </section>

  <footer>
    TagReceipt ${escapeHtml(receipt.toolVersion)} · Offline local report · No CDN ·
    Read-only GitHub audit · Not a vulnerability scanner · Attestation: NOT VERIFIED
  </footer>
</main>
</body>
</html>`;
}
