/**
 * prod-narrow.mjs — verify the DEPLOYED site at narrow widths, in real Chrome.
 *
 * The browser harness in this profile ignores viewport resizing, so production was never checked in a narrow
 * window (docs/verification/2026-10-15-checkpoint.md, gap 3). This drives the real deployment with puppeteer,
 * which sets the viewport properly, and asserts the same two things the local narrow harness asserts:
 * no sideways page scroll, and no element whose right edge passes the viewport or whose box clips its content.
 *
 * Read-only: it opens the public page and walks the onboarding (no AI step, so no passcode and nothing sent).
 * Usage: node prod-narrow.mjs            # 320, 380, 480
 *        node prod-narrow.mjs 380        # one width
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const APP = process.env.SILICUS_PROD ?? "https://silicus-ta.vercel.app";
const WIDTHS = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [320, 380, 480];
const HEIGHT = 900;
const exe = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
if (!exe) throw new Error("no system chrome found");

let fails = 0;
const say = (ok, label, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/** Everything the local narrow harness measures, run against whatever the deployed page shows. */
const snapshot = (page) =>
  page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    const ch = document.documentElement.clientHeight;
    const past = [];
    const clipped = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > cw + 1 || r.left < -1) {
        past.push({ tag: el.tagName, cls: String(el.className || "").slice(0, 40), text: (el.textContent || "").trim().slice(0, 50), left: Math.round(r.left), right: Math.round(r.right) });
      }
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "hidden") {
        clipped.push({ tag: el.tagName, cls: String(el.className || "").slice(0, 40), text: (el.textContent || "").trim().slice(0, 50), content: el.scrollWidth, box: el.clientWidth });
      }
      // vertical clipping of text blocks only
      if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflowY === "hidden" && el.clientHeight < ch) {
        clipped.push({ tag: el.tagName, cls: String(el.className || "").slice(0, 40), text: (el.textContent || "").trim().slice(0, 50), content: `h${el.scrollHeight}`, box: `h${el.clientHeight}` });
      }
    }
    const cta = [...document.querySelectorAll("button")].find((b) => /build the plan|Record /.test(b.textContent || ""));
    return {
      cw, sw: document.documentElement.scrollWidth, past: past.slice(0, 6), clipped: clipped.slice(0, 6),
      cta: cta ? { label: cta.textContent.trim().slice(0, 46), sw: cta.scrollWidth, cw: cta.clientWidth } : null,
      h1: (document.querySelector("h1") || {}).textContent ?? null,
    };
  });

const browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox"] });
try {
  for (const width of WIDTHS) {
    // A fresh context per width: otherwise the course recorded at the first width is still in IndexedDB
    // and the app opens the course view instead of the onboarding the next width is meant to measure.
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width, height: HEIGHT, deviceScaleFactor: 1 });
    console.log(`\n== ${APP} at ${width}px (deployed build)`);
    await page.goto(`${APP}/#/live`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.querySelector("h1") !== null);

    const stages = [];
    const measure = async (name) => {
      const m = await snapshot(page);
      stages.push([name, m]);
      say(m.sw <= m.cw + 1, `${name}: the page does not scroll sideways`, `scrollWidth ${m.sw} vs clientWidth ${m.cw}`);
      say(m.past.length === 0, `${name}: no element's edge passes the viewport`, m.past.map((o) => `${o.tag}.${o.cls} ${o.left}→${o.right} "${o.text}"`).join(" | "));
      say(m.clipped.length === 0, `${name}: nothing clips its own content`, m.clipped.map((o) => `${o.tag}.${o.cls} ${o.content}>${o.box} "${o.text}"`).join(" | "));
    };
    await measure("landing");
    // C1.5: the stage page opens a first-run tour on a first visit (an older deployed build has none). Measure it, then
    // close it the way a teacher does, so the onboarding below is what is measured.
    if (await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-modal="true"]'))) {
      await measure("first-run tour");
      await page.evaluate(() => document.querySelector('button[aria-label="Close the tour"]').click());
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    }

    // The onboarding the product owner was looking at when they reported the layout.
    const reply = async (text) => {
      await page.waitForSelector("#onboarding-reply");
      await page.evaluate((t) => {
        const el = document.querySelector("#onboarding-reply");
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
        setter.call(el, t);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, text);
      await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.type === "submit").click());
    };
    await reply("How plants eat");
    await page.waitForFunction(() => document.body.innerText.includes("What name should this course show for you"));
    await measure("onboarding step 2: name your copy");
    await reply("Ada Lovelace");
    await page.waitForFunction(() => document.body.innerText.includes("Name the materials"));
    await measure("onboarding step 3: materials");
    await reply("Lesson notes");
    await page.waitForFunction(() => document.body.innerText.includes("Confirm the material list"));
    await measure("confirm the material list");
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Confirm the material list/.test(b.innerText)).click());
    await page.waitForFunction(() => document.body.innerText.includes("What topic should this lesson cover?"));
    await measure("intake question");
    await context.close();
    const worst = stages.map(([n, m]) => `${n} ${m.sw}/${m.cw}`).join(" · ");
    console.log(`   widths: ${worst}`);
  }
} finally {
  await browser.close();
}
console.log(fails === 0 ? `\nprod-narrow: OK (${WIDTHS.join(", ")}px on the deployed build)` : `\nprod-narrow: ${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
