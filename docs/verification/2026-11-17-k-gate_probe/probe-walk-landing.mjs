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
  await clickBy("Continue"); await waitText("Write a few", 6000);
  await setVal('section[aria-label="Your objectives"] textarea', "Explain how a plant makes its food\nName what a plant needs to make sugar");
  await sleep(200); await clickBy("Continue"); await sleep(1500);
  await clickPrimary("Continue"); await waitText("Review and confirm", 6000);
  await clickPrimary("Confirm and create the course");
  await page.waitForFunction(() => /^#\/studio\/(?!new$)./.test(location.hash), { timeout: 8000 });
  await waitText("From your answers", 10000);
  const courseHash = await page.evaluate(() => location.hash); console.log("COURSE", courseHash);
  // landing link on each course tab
  for (const tab of ["Brief", "Objectives", "Plan", "Publish"]) {
    await clickBy(tab); await sleep(600);
    const a = await anchors();
    console.log("TAB", tab, "|", a);
    check(`landing link (#/) present on course tab ${tab}`, /→#\/(\s|;|$)/.test(a + " "), a.slice(0, 120));
  }
  await page.goto(`${APP}${courseHash.replace(/^#/, "/#")}/rehearse`, { waitUntil: "networkidle0" }); await sleep(800);
  { const a = await anchors(); console.log("REHEARSE", a); check("landing link on Rehearse", /→#\/(\s|;|$)/.test(a + " "), a.slice(0, 120)); }
  await page.goto(`${APP}/#/learn/${courseHash.split("/").pop()}`, { waitUntil: "networkidle0" }); await sleep(800);
  { const a = await anchors(); console.log("LEARN", a); check("landing link on Learn", /→#\/(\s|;|$)/.test(a + " "), a.slice(0, 120)); }
} catch (e) { console.log("PROBE ERROR", e.stack?.split("\n").slice(0,3).join(" ")); }
console.log(`${pass} pass ${fail} fail`);
await browser.close(); server.close();
