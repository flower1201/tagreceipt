import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = path.join(root, "examples", "out-demo", "index.html");
const outDir = path.join(root, "docs", "assets");
await mkdir(outDir, { recursive: true });
const out = path.join(outDir, "demo-report.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto(pathToFileURL(html).href);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`wrote ${out}`);
