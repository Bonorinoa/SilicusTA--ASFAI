// Diagnose: did the plan tab actually switch before print? Assert, don't assume.
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const exe = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find((p) => existsSync(p));

const browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 600));

const clickables = await page.evaluate(() =>
  [...document.querySelectorAll("button,[role=tab],a")].map((el, i) => `${i}: [${el.tagName}] ${JSON.stringify((el.textContent || "").trim().slice(0, 40))}`)
);
console.log("CLICKABLES:\n" + clickables.join("\n"));

const bodyBefore = await page.evaluate(() => document.body.innerText.slice(0, 120));
console.log("BODY_BEFORE:", JSON.stringify(bodyBefore));

const clicked = await page.evaluate(() => {
  const el = [...document.querySelectorAll("button,[role=tab],a")].find((e) => /plan/i.test(e.textContent || ""));
  if (!el) return null;
  el.click();
  return (el.textContent || "").trim();
});
await new Promise((r) => setTimeout(r, 700));
console.log("CLICKED_TAB:", JSON.stringify(clicked));

const bodyAfter = await page.evaluate(() => document.body.innerText.slice(0, 200));
console.log("BODY_AFTER:", JSON.stringify(bodyAfter));
const hasPlan = await page.evaluate(() => /Objectives referenced/i.test(document.body.innerText));
console.log("PLAN_VISIBLE_ON_SCREEN:", hasPlan);

await page.pdf({ path: "shots/04b-plan-card.pdf", format: "A4", printBackground: true });
const printView = await page.evaluate(() => {
  const vis = (el) => el.offsetParent !== null || getComputedStyle(el).display !== "none";
  return [...document.querySelectorAll("h1,h2,h3,p")].filter(vis).slice(0, 12).map((el) => el.textContent.trim().slice(0, 60));
});
console.log("VISIBLE_HEADINGS:", JSON.stringify(printView, null, 1));
await browser.close();
console.log("WROTE: shots/04b-plan-card.pdf");
