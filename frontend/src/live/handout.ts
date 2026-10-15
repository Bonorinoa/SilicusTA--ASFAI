/**
 * handout.ts — the student handout: one standalone page built from the SEALED version.
 *
 * Non-AI and hosting-free: a teacher downloads it and shares the file (print it, email it, put it on a
 * class site). It carries only what a student needs (the confirmed objectives and what learners do in
 * each activity). It leaves out the teacher's notes and anything unconfirmed, contains no script, and
 * every string is escaped, because titles and statements are the teacher's (or a model's) words.
 */
import type { PackageVersionView } from "../gate/types";

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function handoutFilename(version: PackageVersionView): string {
  const slug = version.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "course";
  return `silicus-handout-${slug}-v${version.version}.html`;
}

export function buildHandoutHtml(version: PackageVersionView): string {
  const objectives = version.objectiveRefs.map((o) => `<li>${esc(o.statement ?? o.publicId ?? "")}</li>`).join("\n");
  const activities = (version.lessonPlan?.activities ?? [])
    .map((a) => `<li><h3>${esc(a.title)} <span class="min">${esc(a.minutes)} min</span></h3><p>${esc(a.learnerDoes)}</p></li>`)
    .join("\n");
  const published = new Date(version.publishedAt).toISOString().slice(0, 10);
  const audience = version.lessonPlan?.audience;
  const ages = audience?.ageRangeStart !== undefined
    ? `<p class="meta">Ages ${esc(audience.ageRangeStart)}${audience.ageRangeEnd !== undefined ? `–${esc(audience.ageRangeEnd)}` : "+"}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(version.title)}</title>
<style>
  /* A light page, declared: with no background of its own, a browser in dark mode paints dark grey behind
     this dark ink and the handout is unreadable. color-scheme: light makes it a light page everywhere. */
  :root { color-scheme: light; }
  html { background: #fbf8f1; }
  body { font: 18px/1.55 Georgia, 'Times New Roman', serif; color: #1c1b19; background: #fbf8f1; max-width: 40rem; margin: 0 auto; padding: 3rem 1.25rem; }
  h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 .25rem; }
  h2 { font: 600 .8rem/1 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #6b675f; margin: 2.25rem 0 .75rem; }
  h3 { font-size: 1.1rem; margin: 0 0 .15rem; }
  .min, .meta, footer { font: .9rem/1.4 system-ui, sans-serif; color: #6b675f; }
  ol { padding-left: 1.4rem; } li { margin: 0 0 .9rem; } li p { margin: 0; }
  footer { border-top: 1px solid #d9d5cc; margin-top: 3rem; padding-top: 1rem; }
  @media print { html, body { background: #fff; } body { padding: 1.5cm 1.25rem; } }
</style>
</head>
<body>
<h1>${esc(version.title)}</h1>
${ages}
<h2>What you will be able to do</h2>
<ol>
${objectives}
</ol>
<h2>What we will do</h2>
<ol>
${activities || "<li><p>Your teacher will share the activities.</p></li>"}
</ol>
<footer>Asking an assistant a question is not evidence of learning. Prepared with Silicus TA from the version your teacher published on ${esc(published)}.</footer>
</body>
</html>
`;
}
