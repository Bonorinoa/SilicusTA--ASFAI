"""G2V: derive the browser probe from the repo's own studio-smoke (same build, server, mock worker, helpers) and add the
checks the smoke does not make: real keyboard on the stage cards and the neighbourhood, focus-visible styles, a
suggestion activated by keyboard with the log compared, overflow offenders at 390 px, the credit inside the plan's
'Suggested alignment', and a 19-22 course scanned for any Marble surface.
usage: python3 make-studio-probe.py <export-root>   -> writes <export-root>/frontend/scripts/zz-studio-probe.mjs"""
import sys, pathlib
root = pathlib.Path(sys.argv[1]); src = (root / "frontend/scripts/studio-smoke.mjs").read_text()

def once(text, anchor, add, before=False):
    assert text.count(anchor) == 1, (text.count(anchor), anchor[:70])
    return text.replace(anchor, add + anchor if before else anchor + add)

helpers = r'''
const ovf = async (label) => {
  await page.setViewport({ width: 390, height: 844 }); await sleep(450);
  const r = await page.evaluate(() => { const vw = document.documentElement.clientWidth;
    const off = [...document.querySelectorAll("body *")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > vw + 1 && getComputedStyle(e).position !== "fixed"; }).slice(0, 4).map((e) => `${e.tagName}.${String(e.className).slice(0, 30)}@${Math.round(e.getBoundingClientRect().right)}`);
    return { sw: document.documentElement.scrollWidth, vw, off }; });
  check(`PROBE 390px no horizontal overflow: ${label}`, r.sw <= r.vw + 1, JSON.stringify(r));
  await page.setViewport({ width: 1440, height: 900 }); await sleep(300);
};
const focusInfo = () => page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const cs = getComputedStyle(a); const kid = a.querySelector?.("rect,path,circle"); const kcs = kid ? getComputedStyle(kid) : null;
  return { tag: a.tagName, role: a.getAttribute("role"), id: a.getAttribute("data-node-id"), label: (a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 50), fv: a.matches(":focus-visible"), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, boxShadow: cs.boxShadow !== "none", kidStroke: kcs ? `${kcs.stroke} ${kcs.strokeWidth}` : null }; });
const tabTo = async (pred, max = 60) => { for (let i = 0; i < max; i++) { await page.keyboard.press("Tab"); const f = await focusInfo(); if (f && pred(f)) return { f, steps: i + 1 }; } return null; };
'''
src = once(src, '\ntry {\n  // ---- the landing', helpers, before=True)

# I3 wizard keyboard (after Begin -> step 1 shown)
i3 = r'''
  { const radios = 'form[aria-label="Course and learners"] fieldset input[type="radio"]';
    const idx = () => page.evaluate((s) => [...document.querySelectorAll(s)].findIndex((r) => r.checked), radios);
    await page.focus(radios); await sleep(100);
    const f0 = await focusInfo(); const a0 = await idx();
    await page.keyboard.press("ArrowDown"); await sleep(150); const a1 = await idx();
    await page.keyboard.press("ArrowRight"); await sleep(150); const a2 = await idx();
    const f1 = await focusInfo();
    check("PROBE KEYBOARD stage cards: a radio takes focus and the arrow keys move the selection", f0?.tag === "INPUT" && a1 !== a0 && a2 !== a1, JSON.stringify({ a0, a1, a2 }));
    const lab = await page.evaluate(() => { const r = document.activeElement; const l = r.closest("label") ?? r.parentElement; const cs = getComputedStyle(l); const rs = getComputedStyle(r);
      const win = (l.matches(":focus-within")); return { focusVisible: r.matches(":focus-visible"), labelOutline: `${cs.outlineStyle} ${cs.outlineWidth}`, labelShadow: cs.boxShadow !== "none", labelBorder: cs.borderColor, radioOutline: `${rs.outlineStyle} ${rs.outlineWidth}`, radioOpacity: rs.opacity, radioClip: rs.clip + "|" + rs.position + "|" + rs.width, focusWithin: win }; });
    console.log("PROBE stage-card focus style", JSON.stringify(lab));
    await page.keyboard.press("Tab"); await sleep(100); const f2 = await focusInfo();
    check("PROBE KEYBOARD Tab leaves the radio group for the next control (roving tabindex, one stop)", !!f2 && !(f2.tag === "INPUT" && f2.role === null && (await page.evaluate(() => document.activeElement.type)) === "radio"), JSON.stringify(f2));
    const sh = await page.$('form[aria-label="Course and learners"]'); await sh.screenshot({ path: process.env.G2V_SHOTS + "/wizard-focus-desktop.png" });
    check("PROBE focus is visible on the stage card (outline, ring or shadow resolves on the focused control or its label)", lab.focusVisible && (!/none/.test(lab.labelOutline) || lab.labelShadow || !/none/.test(lab.radioOutline)), JSON.stringify(lab)); }
'''
src = once(src, '  await page.type(\'form[aria-label="Course and learners"] input[placeholder="How plants eat"]\', "Leaves and light");', i3, before=True)

# I4 overflow at wizard (after consequence strip check)
src = once(src, '  // Topic from the skill map: search, pick the anchor, then edit the pre-filled topic.', '  await ovf("wizard step 1, ages 5-12");\n', before=True)

# I2 objectives keyboard + overflow, before the mouse click on the suggestion
i2 = r'''
  const formsNow = () => page.evaluate(() => ({ forms: [...document.querySelectorAll("form")].map((f) => f.getAttribute("aria-label")), own: !!document.querySelector('input[placeholder="Students can…"]'), vw: innerWidth, hash: location.hash }));
  console.log("PROBE forms BEFORE resize", JSON.stringify(await formsNow()));
  await ovf("objectives step with the neighbourhood open");
  console.log("PROBE forms AFTER resize", JSON.stringify(await formsNow()));
  { const ev0 = (await stored()).events.length;
    await page.evaluate(() => document.querySelector("summary")?.focus());
    await page.evaluate(() => { const d = document.querySelector("[data-neighbourhood] summary"); d?.focus(); });
    const hit = await tabTo((f) => f.role === "button" && !!f.id);
    const fi = hit?.f;
    check("PROBE KEYBOARD neighbourhood: Tab reaches a node box (role=button, tabindex 0)", !!fi, JSON.stringify(hit));
    const ev = await page.evaluate(() => document.querySelector("[data-neighbourhood] [data-evidence-for]")?.getAttribute("data-evidence-for") ?? null);
    check("PROBE KEYBOARD neighbourhood: the focused node shows its evidence with no hover", !!fi && ev === fi.id, `focused=${fi?.id} evidence-for=${ev}`);
    check("PROBE focus is visible on a neighbourhood node", !!fi && fi.fv && (!/none/.test(fi.outline) || !!fi.kidStroke), JSON.stringify(fi));
    const seen = new Set(); let walked = 0; for (let i = 0; i < 14; i++) { await page.keyboard.press("Tab"); const f = await focusInfo(); if (f?.id) seen.add(f.id); walked++; }
    check("PROBE KEYBOARD neighbourhood: several nodes are tab stops", seen.size >= 2, [...seen].join(","));
    await page.keyboard.press("Enter"); await page.keyboard.press("Space"); await sleep(200);
    check("PROBE keyboard Enter/Space on a node writes nothing to the course record", (await stored()).events.length === ev0, `${ev0}->${(await stored()).events.length}`);
    await page.focus('form[aria-label="Write your own objective"] input');
    let sb = await tabTo((f) => f.tag === "BUTTON" && /Use as my objective/.test(f.label), 40);
    if (!sb) { await page.focus('form[aria-label="Write your own objective"] input'); for (let i = 0; i < 40 && !sb; i++) { await page.keyboard.down("Shift"); await page.keyboard.press("Tab"); await page.keyboard.up("Shift"); const f = await focusInfo(); if (f && f.tag === "BUTTON" && /Use as my objective/.test(f.label)) sb = { f, steps: -(i + 1) }; } }
    check("PROBE KEYBOARD 'Use as my objective' is a tab stop with a visible focus", !!sb && sb.f.fv && (!/none/.test(sb.f.outline) || sb.f.boxShadow), JSON.stringify(sb?.f));
    const e1 = (await stored()).events.length;
    await page.keyboard.press("Enter"); await sleep(300);
    const val = await page.evaluate(() => document.querySelector('form[aria-label="Write your own objective"] input')?.value ?? "");
    const e2 = (await stored()).events.length;
    check("PROBE keyboard Enter on a suggestion pre-fills the field and the log does not move (events before == after)", /^Students can/.test(val) && e1 === e2, `events ${e1}->${e2} field=${JSON.stringify(val.slice(0, 60))}`);
    await page.keyboard.press("Space"); await sleep(200);
    check("PROBE a second key activation still writes nothing", (await stored()).events.length === e1);
    const logTxt = JSON.stringify((await stored()).events.map((e) => e.line));
    check("PROBE the course log so far holds no mt_ objective id (anchor only on course.created)", !(/"id":"mt_/.test(logTxt.replace(/\\"/g, '"'))) , "");
    await setVal('form[aria-label="Write your own objective"] input', ""); await sleep(200); }
'''
src = once(src, '  const before = (await stored()).events.length;\n  await clickReal("Use as my objective");', i2, before=True)

# plan strip overflow
src = once(src, '  await clickBy("Objectives");\n  await waitText("Objectives confirmed", 6000);', '  await ovf("plan step with the prerequisite strip");\n', before=True)

# A1 credit in Suggested alignment
a1 = r'''
  { const r = await page.evaluate(() => { const sec = document.querySelector('section[aria-label="Suggested alignment"]'); const det = sec?.querySelector("details");
      const credits = [...document.querySelectorAll("[data-marble-credit]")].map((c) => ({ inSec: !!sec?.contains(c), text: (c.textContent ?? "").slice(0, 36) }));
      return { hasSec: !!sec, marbleRows: ((sec?.textContent ?? "").match(/from Marble/g) ?? []).length, printAttr: sec?.getAttribute("data-print"), credits, detailsOpen: det?.open }; });
    console.log("PROBE A1 section", JSON.stringify(r));
    check("PROBE ATTRIBUTION plan step: the 'Suggested alignment' section that lists Marble topics carries the credit line (G1bV A1)", r.hasSec && r.marbleRows > 0 && r.credits.some((c) => c.inSec), JSON.stringify(r)); }
  await ovf("plan step with a drafted plan and its alignment");
'''
src = once(src, '  // ---- P2ui: a v1 plan shows none of the learning design;', a1, before=True)

# I5 19-22 scan at the end
i5 = r'''
  { const r = await page.evaluate(() => ({ credit: document.querySelectorAll("[data-marble-credit]").length, sugg: document.querySelectorAll("[data-evidence-suggestions]").length, nb: document.querySelectorAll("[data-neighbourhood]").length, strip: document.querySelectorAll("[data-prereq-strip]").length,
      marbleWords: (document.body.innerText.match(/marble|skill.map|aligns to|Suggested alignment/gi) ?? []), text: document.body.innerText.slice(0, 700) }));
    console.log("PROBE 19-22 objectives page", JSON.stringify(r));
    check("PROBE 19-22 course (no anchor): the objectives step shows no skill-map suggestions, neighbourhood, strip, alignment or credit", r.credit + r.sugg + r.nb + r.strip === 0 && r.marbleWords.length === 0, JSON.stringify({ ...r, text: undefined }));
    const sayWhy = /no suggestions|skill.map|your own objectives/i.test(r.text);
    console.log("PROBE OBS 19-22 objectives step explains the absence in words:", sayWhy); }
'''
src = once(src, '  // ---- F1 (verifier): a long unbroken source name', i5, before=True)
(root / "frontend/scripts/zz-studio-probe.mjs").write_text(src)
print("wrote", root / "frontend/scripts/zz-studio-probe.mjs")
