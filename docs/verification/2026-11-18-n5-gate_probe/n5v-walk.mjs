/**
 * N5V item 4: the teacher's walk over the plan's shape in REAL Chrome (puppeteer-core), identical on both hosts.
 * It uses only the page: clicks on the real buttons and the real Add form. No API call, no store write of mine.
 * Injected by n5v-make-probes.py into a copy of studio-smoke (browser host) and live-host-smoke (Node host)
 * just before the plan is confirmed. Returns a list of snapshots; the caller writes them to $N5V_OUT.
 */
export async function walk(page, label, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const snap = (step) => page.evaluate((step) => {
    const text = document.body.innerText;
    return {
      step, hash: location.hash, stepLine: (text.match(/STEP \d OF \d/) ?? [null])[0],
      titles: [...document.querySelectorAll("li h2")].map((h) => h.textContent),
      header: (text.match(/\d+ min lesson · activities \d+ min/i) ?? [null])[0],
      lengthNote: (text.match(/Activities add up to[^.]*\./) ?? [null])[0],
      trace: [...document.querySelectorAll("[data-plan-edit-line]")].map((e) => e.textContent),
    };
  }, step);
  const waitFor = (fn, arg, ms = 10000) => page.waitForFunction(fn, { timeout: ms }, arg).then(() => true, () => false);
  const setField = (form, lbl, value) => page.evaluate((form, lbl, value) => {
    const f = document.querySelector(`form[data-plan-edit-form="${form}"]`);
    const l = f && [...f.querySelectorAll("label")].find((x) => x.textContent === lbl);
    const el = l && document.getElementById(l.htmlFor);
    if (!el) return false;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    return true;
  }, form, lbl, value);
  // A real mouse click, after centring the control: a sticky header can otherwise sit over it and take the click.
  const pressLog = [];
  const press = async (sel) => {
    await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "center" }), sel); await sleep(150);
    pressLog.push(await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return { sel, found: false };
      const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { sel, found: true, disabled: el.disabled, hit: top === el || el.contains(top) ? "self" : (top?.tagName + ":" + (top?.textContent ?? "").slice(0, 40)) }; }, sel));
    await page.click(sel);
  };
  const out = [];
  try {
  out.push(await snap("0 start"));
  const n0 = out[0].titles.length;

  // 1. Add an activity of 40 minutes (the lesson is 45): the K2 length note must appear.
  await press("[data-plan-add] button");
  await page.waitForSelector('form[data-plan-edit-form="a new activity"]', { timeout: 5000 });
  const filled = [await setField("a new activity", "Title", "N5V extra check"), await setField("a new activity", "Minutes", "40"),
    await setField("a new activity", "Learners", "Pairs compare two drawings."), await setField("a new activity", "Teacher", "Asks what changed.")];
  await page.evaluate(() => document.querySelector('form[data-plan-edit-form="a new activity"] button[type="submit"]')?.click());
  const added = await waitFor(() => document.body.innerText.includes("N5V extra check") && /Activities add up to/.test(document.body.innerText));
  out.push({ ...(await snap("1 add 40-minute activity")), filled, ok: added });

  // 2. Move it up one place (it was last).
  await press(`button[aria-label="Move activity ${n0 + 1} up"]`);
  const moved = await waitFor((n) => document.body.innerText.includes(`moved activity ${n} to position ${n - 1}`), n0 + 1);
  out.push({ ...(await snap("2 move the new one up")), ok: moved });
  // and back down, so it is last again
  await page.waitForSelector(`button[aria-label="Move activity ${n0} down"]:not([disabled])`, { timeout: 5000 }).catch(() => {});
  await press(`button[aria-label="Move activity ${n0} down"]`);
  const moved2 = await waitFor((n) => document.body.innerText.includes(`moved activity ${n} to position ${n + 1}`), n0);
  out.push({ ...(await snap("3 move it back down")), ok: moved2 });

  // 3. Remove it (Remove, then confirm Remove): the length note must clear.
  await press(`button[aria-label="Remove activity ${n0 + 1}"]`);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Remove" && !b.getAttribute("aria-label"))?.click());
  const removed = await waitFor((h0) => ![...document.querySelectorAll("li h2")].some((h) => h.textContent === "N5V extra check") && (document.body.innerText.match(/\d+ min lesson · activities \d+ min/i) ?? [null])[0] === h0, out[0].header);
  out.push({ ...(await snap("4 remove it again")), ok: removed });

  // 4. Remove an ORIGINAL activity (the first): the activities now add up to less than 45; the note must say so. Then Keep-path: ask to remove, press Keep.
  await press('button[aria-label="Remove activity 1"]');
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Keep")?.click());
  await sleep(400);
  out.push({ ...(await snap("5 remove then Keep: nothing changes")), ok: true });
  await press('button[aria-label="Remove activity 1"]');
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Remove" && !b.getAttribute("aria-label"))?.click());
  const gone = await waitFor((n) => [...document.querySelectorAll("li h2")].length === n - 1, n0);
  out.push({ ...(await snap("6 remove original activity 1")), ok: gone });

  // 5. Re-order what is left (needs two activities; the Node fixture has only two, so after step 6 it has one and the app must keep it).
  const titlesNow = () => page.evaluate(() => [...document.querySelectorAll("li h2")].map((h) => h.textContent));
  const t6 = await titlesNow();
  if (t6.length >= 2) {
    await press('button[aria-label="Move activity 1 down"]');
    const m1 = await page.waitForFunction((t) => [...document.querySelectorAll("li h2")][0]?.textContent !== t, { timeout: 10000 }, t6[0]).then(() => true, () => false);
    out.push({ ...(await snap("7 move 1 down")), ok: m1 });
    await page.waitForSelector('button[aria-label="Move activity 2 up"]:not([disabled])', { timeout: 5000 }).catch(() => {});
    await press('button[aria-label="Move activity 2 up"]');
    const m2 = await page.waitForFunction((t) => [...document.querySelectorAll("li h2")][0]?.textContent === t, { timeout: 10000 }, t6[0]).then(() => true, () => false);
    out.push({ ...(await snap("8 move 2 up (back to the order of step 6)")), ok: m2 });
  } else {
    out.push({ ...(await snap("7-8 skipped: one activity left")), ok: true, moveDisabled: await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Move activity"]')].map((b) => b.getAttribute("aria-label") + (b.disabled ? " (disabled)" : ""))) });
  }

  // 6. The last activity cannot be removed when it is the only one: check the Remove button state at n=1 is not reached here; record disabled flags.
  out.push({ step: "9 button state", removeDisabled: await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Remove activity"]')].map((b) => b.disabled)) });
  } catch (e) {
    out.push({ step: "ERROR", pressLog, message: String(e).slice(0, 200), ...(await page.evaluate(() => ({ buttons: [...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label") + (b.disabled ? " (disabled)" : "")), titles: [...document.querySelectorAll("li h2")].map((h) => h.textContent), body: document.body.innerText.slice(0, 600), hash: location.hash }))) });
  }
  out.push({ step: "press log", pressLog });
  return out;
}
