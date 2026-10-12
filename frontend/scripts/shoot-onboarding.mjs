/** Shoot the onboarding correspondence for the chat. Not a test. */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { startMockAsfai } from "../../host/test/mock-asfai.mjs";

const OUT = "/Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff/frontend/shots";
const APP = "http://127.0.0.1:5173/#/live";
const HOST_PORT = 8787;
mkdirSync(OUT, { recursive: true });

const mock = await startMockAsfai();
const data = mkdtempSync(join(tmpdir(), "silicus-shots-"));
const host = spawn(process.execPath, ["server.mjs"], {
  cwd: join(import.meta.dirname, "../../host"),
  env: {
    ...process.env,
    SILICUS_HOST_DATA: data,
    SILICUS_HOST_PORT: String(HOST_PORT),
    SILICUS_ASFAI_MCP_URL: mock.mcpUrl,
    SILICUS_ASFAI_PRM_URL: mock.prmUrl,
    SILICUS_ASFAI_ALLOW_INSECURE: "1",
  },
  stdio: "ignore",
});
const wait = async (url) => {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("not up: " + url);
};
await wait(`http://127.0.0.1:${HOST_PORT}/api/health`);
await wait("http://127.0.0.1:5173/");

const exe = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
const shot = async (name) => {
  await page.screenshot({ path: join(OUT, name), fullPage: false });
  console.log(join(OUT, name));
};
const setVal = async (text) => {
  await page.waitForSelector("#onboarding-reply");
  await page.evaluate((text) => {
    const el = document.querySelector("#onboarding-reply");
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
};
const click = async (label) => page.evaluate((t) => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim().startsWith(t));
  if (!b) throw new Error("no button " + t);
  b.click();
}, label);

await page.goto(APP, { waitUntil: "networkidle0" });
await page.waitForFunction(() => document.body.innerText.includes("What should we call this course"));
await shot("01-opening.png");

await setVal("Seeing the claim");
await click("Record the course title");
await page.waitForFunction(() => document.body.innerText.includes("What label should your copy"));
await shot("02-label.png");

await setVal("Ada Lovelace");
await click("Record the label");
await page.waitForFunction(() => document.body.innerText.includes("Name the materials"));
await shot("03-materials.png");

await click("No materials");
await page.waitForFunction(() => document.body.innerText.includes("Confirm this material list"));
await shot("04-confirm-list.png");

await click("Confirm the material list");
const courseId = await (async () => {
  for (let i = 0; i < 30; i++) {
    const courses = (await (await fetch(`http://127.0.0.1:${HOST_PORT}/api/courses`)).json()).courses;
    if (courses[0]) return courses[0].courseId;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("no course");
})();
const conn = await (await fetch(`http://127.0.0.1:${HOST_PORT}/api/asfai/connect`, {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}",
})).json();
const consent = mock.consent(conn.authorizeUrl);
await fetch(`http://127.0.0.1:${HOST_PORT}/api/asfai/callback?code=${consent.code}&state=${consent.state}`);
await page.reload({ waitUntil: "networkidle0" });
await page.waitForFunction(() => document.body.innerText.includes("Ask ASFAI for the questions"));
await click("Ask ASFAI for the questions");
await page.waitForFunction(() => document.body.innerText.includes("What topic should this lesson cover"));
const box = await page.$("section[aria-label='Course onboarding']");
await box.screenshot({ path: "/Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff/frontend/shots/05-asfai-question.png" });
console.log("05 element");

await browser.close();
host.kill("SIGTERM");
mock.close();
console.log("course", courseId);
