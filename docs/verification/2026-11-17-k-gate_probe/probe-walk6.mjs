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
  console.log("OBJ STEP buttons:", await btns());
  console.log("OBJ STEP text:", (await sec()).slice(0, 900));
  const hasPropose = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Propose objectives from sources"));
  console.log("Propose button present on arrival:", hasPropose);
  if (hasPropose) { await clickReal("Propose objectives from sources"); await sleep(1200); if (await dialogOpen()) { await enterPasscode(); } await sleep(3500);
    const t = await body(); const det = await page.evaluate(() => [...document.querySelectorAll("details")].map((d) => (d.open ? "OPEN " : "closed ") + d.innerText.slice(0, 90)).join(" || "));
    for (const m of ["This site blocks automatic reading.", "That page was not found.", "The site took too long."]) console.log("MSG", m, t.includes(m));
    console.log("details:", det); console.log("raw leak:", /couldn.t read the web page|answered 40\d|\b403\b/.test(t.replace(/Details[\s\S]*/,"")) );
    console.log("AFTER text:", (await sec()).slice(0, 1200)); }
} catch (e) { console.log("PROBE ERROR", e.message.slice(0,100)); console.log("BODY AT FAIL:", (await body()).replace(/\n+/g," / ").slice(0,1500)); console.log("BUTTONS", await btns(), "| primary:", await page.evaluate(()=>[...document.querySelectorAll('button[data-primary="true"]')].map(b=>b.textContent.trim()+(b.disabled?"(disabled)":"")).join(",")));console.log("hash", await page.evaluate(()=>location.hash), "dialog", await dialogOpen()); }
await browser.close(); server.close();
