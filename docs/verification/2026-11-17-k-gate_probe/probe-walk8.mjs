const anchors = () => page.evaluate(() => [...document.querySelectorAll("a")].filter((a) => a.getBoundingClientRect().width > 0).map((a) => `${(a.textContent ?? "").trim().slice(0, 22)}→${a.getAttribute("href")}`).join(" ; "));
const btns = (sel = "body") => page.evaluate((s) => [...document.querySelectorAll(s + " button")].map((b) => b.textContent.trim()).filter(Boolean).join(" | "), sel);
const sec = () => page.evaluate(() => document.querySelector("main")?.innerText?.replace(/\n+/g, " / ").slice(0, 700));
try {
  await page.goto(`${APP}/#/studio/new`, { waitUntil: "networkidle0" });
  await waitText("Let’s set up your course", 8000); await clickBy("Begin"); await waitText("Your course and learners", 5000);
  const step1 = 'form[aria-label="Course and learners"] input';
  await page.type(`${step1}[placeholder="How plants eat"]`, "How plants eat");
  await page.type(`${step1}[placeholder="Ms. Lovelace"]`, "Ada Lovelace");
  await page.type(`${step1}[placeholder="Why leaves stay green, and what that tells us about light"]`, "How plants make food from sunlight");
  await clickLabel("Early primary"); await clickLabel("Oldest age: one year older");
  await clickBy("Continue"); await waitText("On the skill map", 6000);
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] input[type="password"]'), { timeout: 8000 }).catch(() => null);
  await clickBy("Not now");
  await page.waitForFunction(() => !!document.querySelector("#map-search"), { timeout: 15000 });
  await clickBy("Skip the map"); await waitText("Drop files here", 5000);
  const setPaste = (v) => page.evaluate((v) => { const el = document.querySelector('textarea[placeholder^="Paste lesson notes"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); }, v);
  for (const u of ["https://blocked.example/page", "https://gone.example/page", "https://slow.example/page", "https://ok.example/leaf"]) { await setPaste(u); await sleep(250); await clickReal("Add web page"); await sleep(400); }
  console.log("rows after adds:", (await sec()).slice(-300));
  await clickBy("Continue"); await waitText("Write a few", 6000);
  await setVal('section[aria-label="Your objectives"] textarea', "Explain how a plant makes its food\nName what a plant needs to make sugar");
  await sleep(200); await clickBy("Continue"); await sleep(1500);
  await clickReal("Enter the passcode"); await sleep(700); if (await dialogOpen()) await enterPasscode(); await sleep(1500);
  await clickPrimary("Continue"); await waitText("Review and confirm", 6000);
  await clickPrimary("Confirm and propose objectives"); await sleep(1200); if (await dialogOpen()) await enterPasscode();
  await page.waitForFunction(() => /^#\/studio\/(?!new$)./.test(location.hash), { timeout: 25000 });
  await waitText("From your answers", 10000);
  const courseHash = await page.evaluate(() => location.hash); console.log("COURSE", courseHash);
  await sleep(1500);
  const proposeBtn = () => page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Propose objectives from sources"); return b ? (b.disabled ? "disabled" : "enabled") : "absent"; });
  const props = () => page.evaluate(() => [...new Set([...document.querySelectorAll("li, p")].map((e) => e.textContent.trim()).filter((t) => /^Students can/.test(t)))]);
  const f0 = globalThis.__fetches;
  console.log("propose button, 3 model proposals waiting, before adding:", await proposeBtn());
  await clickReal("+ Add a source"); await sleep(400);
  const setP = (v) => page.evaluate((v) => { const el = document.querySelector('textarea[placeholder^="Paste lesson notes"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); }, v);
  await setP("https://ok2.example/roots"); await sleep(250); await clickReal("Add web page"); await sleep(1000);
  console.log("propose button after adding a source, proposals still waiting:", await proposeBtn());
  // accept two, drop one
  for (let i = 0; i < 4; i++) { if (!(await clickReal("Accept", 900))) break; await sleep(500); }
  console.log("propose button after deciding all 3 (not confirmed):", await proposeBtn(), "| hint:", (await body()).match(/\d+ new sources? since[^\n]*/)?.[0]);
  console.log("STATE:", (await body()).replace(/\n+/g," / ").match(/STEP 2 OF 4[\s\S]{0,900}/)?.[0]); console.log("BTNS:", await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).join(" | ")));
  const before = await props();
  if ((await proposeBtn()) === "enabled") { await clickReal("Propose objectives from sources"); await sleep(1200); if (await dialogOpen()) await enterPasscode(); await sleep(3500); }
  const after = await props();
  console.log("fetches during add+propose:", globalThis.__fetches - f0, "(1 expected: only the new ok2 URL)");
  console.log("proposals before:", JSON.stringify(before)); console.log("proposals after:", JSON.stringify(after));
  console.log("propose button now:", await proposeBtn());
} catch (e) { console.log("PROBE ERROR", e.message.slice(0,200)); console.log("BODY AT FAIL:", (await body()).replace(/\n+/g," / ").slice(0,900)); }
await browser.close(); server.close();
