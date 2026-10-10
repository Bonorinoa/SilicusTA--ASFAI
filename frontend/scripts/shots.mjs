// Capture workbench states for design review (headless Chrome via puppeteer-core).
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) throw new Error("no system chromium found");

const OUT = resolve("shots");
const browser = await puppeteer.launch({ executablePath, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 2 });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 800));

// NOTE: the workbench tabs are <a> links, not buttons/role=tab — include "a"
// or every tab click silently no-ops (this bit us once; the PDF printed the
// wrong document because of it).
const clickText = async (re, tag = "button,[role=tab],a") => {
  const handle = await page.evaluateHandle((reSource, sel) => {
    const rx = new RegExp(reSource, "i");
    return [...document.querySelectorAll(sel)].find((el) => rx.test(el.textContent || ""));
  }, re.source, tag);
  const el = handle.asElement();
  if (!el) return null;
  await el.click();
  await new Promise((r) => setTimeout(r, 600));
  return true;
};

// 1 — Decision card, default resting state
await page.screenshot({ path: `${OUT}/01-decision-default.png`, fullPage: true });

// 2 — Decision card, inline rename open on the first row
await clickText(/rename/);
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/02-decision-rename.png`, fullPage: true });
await page.keyboard.press("Escape");
await new Promise((r) => setTimeout(r, 300));

// 2b — the drop-confirm step: the terminal verb asks first (A1 safety fix)
await clickText(/^drop$/i);
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/02b-drop-confirm.png`, fullPage: true });
await clickText(/^keep it$/i);
await new Promise((r) => setTimeout(r, 300));

// 3 — Plan card (the printable syllabus page)
await clickText(/plan card/);
await page.screenshot({ path: `${OUT}/03-plan-card.png`, fullPage: true });

// 4 — Plan card as it prints
await page.pdf({ path: `${OUT}/04-plan-card.pdf`, format: "A4", printBackground: true }).catch(() => {});

// 4b — PRINT REGRESSION GATE. The printed document must be the LESSON PLAN.
// (This exact check would have caught the wrong-document print: the capture
// script had silently clicked nothing because the tabs are <a> links.)
await page.emulateMediaType("print");
const printText = await page.evaluate(() => document.body.innerText);
await page.emulateMediaType(null);
// Case-insensitive: micro-labels are rendered uppercase by CSS, and innerText
// reflects the rendered text.
const printTextLower = printText.toLowerCase();
const mustHave = ["Objectives referenced", "Asking the assistant a question is not evidence."];
const missing = mustHave.filter((s) => !printTextLower.includes(s.toLowerCase()));
if (missing.length) {
  console.error(`PRINT GATE FAILED — the printed document is missing: ${missing.join(" | ")}`);
  process.exitCode = 1;
} else {
  console.log("PRINT GATE: ok — the printed document is the lesson plan.");
}

// 5 — Tokens tab (type scale / palette reference for reviewers)
await clickText(/tokens/);
await page.screenshot({ path: `${OUT}/05-tokens.png`, fullPage: true });

await browser.close();
console.log("SHOTS_DIR:", OUT);
for (const f of ["01-decision-default.png", "02-decision-rename.png", "03-plan-card.png", "04-plan-card.pdf", "05-tokens.png"]) {
  console.log(resolve(OUT, f));
}
