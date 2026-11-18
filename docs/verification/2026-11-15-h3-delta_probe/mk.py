import os
src = open(os.path.expandvars("$TMPDIR/h3v/tree/frontend/scripts/narrow-shell.mjs")).read().split("\n")
L = lambda a,b: "\n".join(src[a-1:b])
head = L(1,107)
head = head.replace('import { modelReply, scriptedPlanV2 } from "../../host/test/scripted-course.mjs";',
 'import { modelReply, scriptedPlanV2 } from "../../host/test/scripted-course.mjs";\n'
 'const MODE = process.env.H3V_MODE ?? "stage3";\n'
 'const planFor = (p) => {\n'
 '  const plan = scriptedPlanV2(p);\n'
 '  if (MODE === "stage3") return plan;\n'
 '  if (MODE === "unclamped") return { ...plan, activities: plan.activities.map((a, i) => i === 2 ? { ...a, learnerFirst: "Each learner first predicts the count alone on paper.", aiStatus: "permitted" } : a) };\n'
 '  if (MODE === "v1") return { title: plan.title, activities: plan.activities.map((a) => ({ title: a.title, minutes: a.minutes, objectiveIds: a.objectiveIds, learnerDoes: a.learnerDoes, teacherDoes: a.teacherDoes, evidenceIfAny: a.evidenceIfAny })) };\n'
 '  throw new Error("bad mode");\n'
 '};')
head = head.replace("scriptedPlanV2(p) : modelReply(p)", "planFor(p) : modelReply(p)")
assert "planFor(p) : modelReply" in head
helpers = L(224,224) + "\n" + L(232,238) + "\n"
g2 = L(398,398) + "\n" + L(439,451) + "\n"
walk = L(562,600)  # starts after setViewport line 560? verify below
body = r'''
const OUTDIR = process.env.H3V_SHOTS;
try {
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
''' + walk.replace("  const s3 = await","  const s3 = await") + r'''
  const info = async () => page.evaluate(() => {
    const vis = (e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { display: cs.display, visibility: cs.visibility, h: Math.round(r.height), w: Math.round(r.width) }; };
    const marks = [...document.querySelectorAll("[data-clamped]")];
    const items = [...document.querySelectorAll("li")].filter((li) => li.querySelector("[data-design-row]"));
    return {
      markerCount: marks.length,
      markers: marks.map((m) => ({ text: m.textContent, vis: vis(m), inItemIndex: items.findIndex((li) => li.contains(m)), itemTitle: (items.find((li) => li.contains(m))?.innerText ?? "").split("\n")[0].slice(0, 80) })),
      activityCount: items.length,
      notes: [...document.querySelectorAll("[data-adjusted] li")].map((e) => e.textContent),
      bodyHasMarkerText: /AI removed by Silicus/.test(document.body.innerText),
    };
  });
  const screen = await info();
  console.log("MODE", MODE, "SCREEN", JSON.stringify(screen));
  if (OUTDIR) { const m = await page.$("[data-clamped]"); await (m ?? await page.$('article[aria-label^="Lesson plan"]')).evaluate((e) => e.scrollIntoView({ block: "center" })); await g2cTall(1440, 1, `h3v-${MODE}-screen.png`); }
  await page.emulateMediaType("print");
  await sleep(300);
  const print = await info();
  console.log("MODE", MODE, "PRINT", JSON.stringify(print));
  if (OUTDIR) { await page.setViewport({ width: 794, height: 1200, deviceScaleFactor: 2 }); await sleep(300); await page.setViewport({ width: 794, height: await page.evaluate(() => document.documentElement.scrollHeight), deviceScaleFactor: 2 }); await sleep(400); const sheet = await page.$('article[aria-label^="Lesson plan"]'); if (sheet) await sheet.screenshot({ path: join(OUTDIR, `h3v-${MODE}-print.png`) }); }
  await page.emulateMediaType(null);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  // reload: does the flag survive persistence?
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(1500);
  const after = await info();
  console.log("MODE", MODE, "RELOAD", JSON.stringify({ hash: await page.evaluate(() => location.hash), markerCount: after.markerCount, bodyHasMarkerText: after.bodyHasMarkerText, activityCount: after.activityCount }));
  console.log("CONSOLE_ERRORS", JSON.stringify(consoleErrors.slice(0, 5)));
} catch (e) { console.log("DRIVER_ERROR", e.stack?.split("\n").slice(0, 4).join(" | ")); }
finally { await browser.close(); server.close(); }
'''
out = head + "\n" + helpers + g2 + "\n" + body
# g2cTall is defined at line 478-486 (inside a block); inline it
out = out.replace("const OUTDIR", L(478,486).replace("  const g2cTall","const g2cTall") + "\nconst OUTDIR",1)
open(os.path.expandvars("$TMPDIR/h3v/tree/frontend/scripts/h3v-clamp.mjs"),"w").write(out)
print(L(556,562)[:600])
