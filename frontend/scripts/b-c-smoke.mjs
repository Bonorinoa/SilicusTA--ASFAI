// B/C browser smoke: drive the BUILT app through the real publish flow and
// verify the audit trail + print artifact. System Chrome via puppeteer-core.
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) throw new Error("no system chrome found");

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: "new",
  args: ["--no-sandbox"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
const results = [];
const check = (name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};

// ---- Publish tab: preview + real seal flow through the gate ----
await page.goto("http://localhost:5173/#/publish", { waitUntil: "networkidle0" });
await page.waitForSelector("button:not([aria-disabled='true'])"); // app booted
await new Promise((r) => setTimeout(r, 400));

check("publish tab: preview renders the plan sheet", await page.evaluate(() =>
  document.body.innerText.includes("Seeing the claim: how AI answers are built")
));
check("publish tab: objectives referenced present", await page.evaluate(() =>
  document.body.innerText.toLowerCase().includes("objectives referenced")
));
check("publish tab: ready to seal (armed)", await page.evaluate(() =>
  document.body.innerText.toLowerCase().includes("ready to seal")
));

await page.screenshot({ path: "/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/b-publish-preview.png", fullPage: true });

// Review -> confirm step (A1: never one tap; keep editing focused by default)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().startsWith("Review & publish"));
  if (btn) btn.click();
});
await page.waitForFunction(() => document.body.innerText.includes("Seal first version?"));
const keepFocused = await page.evaluate(() => document.activeElement?.textContent?.trim());
check("seal confirm: keep-editing focused by default", keepFocused === "Keep editing", `focused=${keepFocused}`);

// Publish (real teacher turn -> gate.publish seals version 1)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.trim() === "Publish version 1");
  if (btn) btn.click();
});
await page.waitForFunction(() => document.body.innerText.includes("Published — version 1"), { timeout: 8000 });
check("seal flow: version 1 sealed after review+confirm", true);

await page.screenshot({ path: "/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/b-publish-sealed.png", fullPage: true });

// Export button present on the sealed panel
check("seal flow: export button present", await page.evaluate(() =>
  document.body.innerText.includes("Export the published version (JSON)")
));
check("seal flow: immutable contract stated", await page.evaluate(() =>
  document.body.innerText.includes("later change ships as a new version")
));

// ---- Audit tab: the timeline ----
await page.goto("http://localhost:5173/#/audit", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 400));
const auditText = await page.evaluate(() => document.body.innerText);
check("audit: spine renders decisions + seals", auditText.includes("Decision history")
  && auditText.includes("Published version 1")
  && auditText.includes("Published version 2")
  && auditText.includes("Checkpoint confirmed — files"));
check("audit: before→after rename present", auditText.includes("as proposed:"));
check("audit: turn refs demoted to mono line", auditText.includes("urn:turn:"));
await page.screenshot({ path: "/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/c-audit-trail.png", fullPage: true });

// ---- D: invalidated-plan review flow on the Plan tab ----
await page.goto("http://localhost:5173/#/plan", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 400));
check("D: plan resting confirmed, no invalidation notice", await page.evaluate(() =>
  !document.body.innerText.toLowerCase().includes("why this plan is invalidated")
));

// Drop a cited objective via the demo select (option 1 = first cited).
const demoValue = await page.evaluate(() => {
  const select = document.querySelector("select[aria-label*='Demonstrate invalidation']");
  return select && select.options[1] ? select.options[1].value : null;
});
check("D: demo select present with a cited objective", typeof demoValue === "string" && demoValue.length > 0);
if (demoValue) await page.select("select[aria-label*='Demonstrate invalidation']", demoValue);
await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("why this plan is invalidated"), { timeout: 8000 });
check("D: invalidated notice names the dropped citation", await page.evaluate(() =>
  document.body.innerText.toLowerCase().includes("was dropped, but this plan still cites it")
));
check("D: publish-legal reminder shown", await page.evaluate(() =>
  document.body.innerText.toLowerCase().includes("cannot be published until every cited objective is confirmed again")
));
await page.screenshot({ path: "/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/d-invalidated.png", fullPage: true });

// Re-confirm — A1 confirm step (Not yet focused), then the acting control.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Re-confirm plan");
  if (btn) btn.click();
});
await page.waitForFunction(() => document.body.innerText.includes("Re-confirm this plan exactly as it reads?"), { timeout: 8000 });
const notYetFocused = await page.evaluate(() => document.activeElement?.textContent?.trim());
check("D: re-confirm defaults to Not yet", notYetFocused === "Not yet", `focused=${notYetFocused}`);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Re-confirm plan");
  if (btn) btn.click();
});
await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("confirmed by r. okonkwo"), { timeout: 8000 });
check("D: plan re-confirmed, notice gone", await page.evaluate(() =>
  !document.body.innerText.toLowerCase().includes("why this plan is invalidated")
));
await page.screenshot({ path: "/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/d-reconfirmed.png", fullPage: true });

// ---- Print artifact check on the publish tab (A3: verify at PDF level) ----
await page.goto("http://localhost:5173/#/publish", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 300));
await page.emulateMediaType("print");
await page.pdf({ path: "/Users/bonorinoa/.hermes/profiles/silicus-ta/cache/scratch/b-publish-print.pdf", format: "A4", printBackground: true });
const printText = await page.evaluate(() => document.body.innerText.toLowerCase());
check("print: plan markers survive (objectives referenced + honesty)", 
  printText.includes("objectives referenced") && printText.includes("asking the assistant a question is not evidence"));
check("print: publish chrome hidden", 
  !printText.includes("review & publish") && !printText.includes("published — version 1"));

await browser.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} artifact checks passed`);
process.exit(failed ? 1 : 0);