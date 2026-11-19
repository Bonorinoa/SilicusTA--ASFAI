/** N5V item 5, C3: the Details sentence for literal-IP and DNS refusals. usage: node n5v-c3-probe.mjs <realpath tree> */
import path from "node:path"; import { pathToFileURL } from "node:url";
const root = path.resolve(process.argv[2]);
const m = await import(pathToFileURL(path.join(root, "host/materials.mjs")).href);
const urls = ["https://169.254.169.254/latest/meta-data", "http://127.0.0.1:8787/", "https://[::1]/", "https://[::ffff:127.0.0.1]/", "http://10.0.0.5/x", "https://192.168.1.1/", "https://[fd00::1]/", "https://100.64.0.1/", "https://192.0.2.1/", "https://192.0.66.161/", "http://2130706433/", "https://localhost/", "https://meta.example/"];
const dns = async (host) => host === "meta.example" ? [{ address: "169.254.169.254", family: 4 }] : [{ address: "93.184.216.34", family: 4 }];
for (const u of urls) {
  try { const r = await m.assertPublicUrl(u, { lookup: dns, resolve: dns }); console.log(`ALLOWED  ${u}`); }
  catch (e) { console.log(`REFUSED  ${u} -> code=${e.code} message=${JSON.stringify(e.message)} details=${JSON.stringify(e.details ?? null)}`); }
}
