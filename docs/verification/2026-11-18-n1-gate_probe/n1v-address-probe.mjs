/**
 * N1V item 2 probe. My own table of 40+ addresses, expectations written by me from the IANA registries
 * (not copied from N1's test), run against BOTH entry points:
 *   - the Node host's check:      host/materials.mjs  isPrivateAddress / assertPublicUrl
 *   - the online /api/fetch route: api/_lib/fetch.mjs createFetchHandler (stand-in DNS + fetch, no network)
 * Usage: node n1v-address-probe.mjs <tree-root>      exit 0 = every row as expected.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = path.resolve(process.argv[2] || ".");
const mat = await import(pathToFileURL(path.join(root, "host/materials.mjs")).href);
const api = await import(pathToFileURL(path.join(root, "api/_lib/fetch.mjs")).href);

// [address, refused?]
const T = [
  ["192.0.66.161", false], ["192.0.1.1", false], ["192.0.3.255", false], ["192.0.255.255", false], ["192.1.0.1", false],
  ["192.0.0.0", true], ["192.0.0.255", true], ["192.0.2.1", true], ["192.0.2.255", true],
  ["169.254.169.254", true], ["169.254.0.1", true], ["169.253.255.255", false], ["169.255.0.1", false],
  ["10.0.0.1", true], ["11.0.0.1", false], ["127.0.0.1", true], ["127.255.255.254", true], ["126.255.255.255", false],
  ["172.15.255.255", false], ["172.16.0.0", true], ["172.31.255.255", true], ["172.32.0.0", false],
  ["192.167.255.255", false], ["192.168.0.1", true], ["192.169.0.1", false],
  ["100.63.255.255", false], ["100.64.0.0", true], ["100.127.255.255", true], ["100.128.0.0", false],
  ["198.17.255.255", false], ["198.18.0.0", true], ["198.19.255.255", true], ["198.20.0.0", false],
  ["198.51.99.255", false], ["198.51.100.1", true], ["198.51.101.0", false],
  ["203.0.112.255", false], ["203.0.113.1", true], ["203.0.114.0", false],
  ["223.255.255.255", false], ["224.0.0.1", true], ["239.255.255.255", true], ["240.0.0.0", true], ["255.255.255.255", true],
  ["0.0.0.0", true], ["0.255.255.255", true], ["1.1.1.1", false], ["8.8.8.8", false], ["93.184.216.34", false],
  ["::1", true], ["::", true], ["::ffff:127.0.0.1", true], ["::ffff:7f00:1", true], ["::ffff:10.0.0.1", true],
  ["::ffff:8.8.8.8", true], // conservative: any v4-mapped is refused
  ["fd00::1", true], ["fc00::1", true], ["fe80::1", true], ["febf::1", true], ["ff02::1", true],
  ["64:ff9b::7f00:1", true], ["2001:db8::1", true], ["2002:7f00:1::1", true], ["2001::1", true],
  ["2606:4700:4700::1111", false], ["2001:4860:4860::8888", false], ["2a00:1450:4001:81b::200e", false],
  ["garbage", true], ["999.1.1.1", true], ["", true],
];

let bad = 0, n = 0;
const miss = (msg) => { bad++; console.log("MISMATCH", msg); };
for (const [ip, refused] of T) {
  n++;
  const got = mat.isPrivateAddress(ip);
  if (got !== refused) miss(`isPrivateAddress(${JSON.stringify(ip)}) = ${got}, expected ${refused}`);
}
console.log(`isPrivateAddress: ${n} rows, ${bad} mismatches`);

// Entry 1: Node host, assertPublicUrl with a stand-in resolver (a DNS NAME resolving to the address).
const to = (...addrs) => async () => addrs.map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 }));
let b1 = 0;
for (const [ip, refused] of T.filter(([ip]) => ip && /^[0-9a-f:.]+$/i.test(ip) && !/^\d+\.\d+\.\d+\.\d+$/.test("x") )) {
  if (!/\./.test(ip) && !/:/.test(ip)) continue;
  let threw = null;
  try { await mat.assertPublicUrl("https://name.example/", { lookupImpl: to(ip) }); } catch (e) { threw = e; }
  const gotRefused = !!threw;
  if (gotRefused !== refused && ip !== "999.1.1.1") { b1++; miss(`assertPublicUrl(name -> ${ip}) refused=${gotRefused}, expected ${refused}`); }
  if (threw && refused && threw.code !== "URL_REFUSED") { b1++; miss(`assertPublicUrl(${ip}) code ${threw.code}`); }
}
console.log(`assertPublicUrl via DNS name: ${b1} mismatches`);

// Mixed answer set: one public, one private -> refused (the check is "some", not "first").
for (const set of [["8.8.8.8", "10.0.0.1"], ["10.0.0.1", "8.8.8.8"], ["192.0.66.161", "169.254.169.254"], ["192.0.66.161", "fd00::1"]]) {
  let threw = false; try { await mat.assertPublicUrl("https://mixed.example/", { lookupImpl: to(...set) }); } catch { threw = true; }
  if (!threw) miss(`mixed ${set} was allowed`); else console.log("mixed refused OK:", set.join(" + "));
}
// Literal URLs (the URL parser normalises odd encodings; the check must see the normalised address).
for (const u of ["https://127.0.0.1/", "https://[::1]/", "https://[::ffff:127.0.0.1]/", "https://2130706433/", "https://0x7f.1/", "https://0177.0.0.1/", "https://169.254.169.254/latest/meta-data/", "https://[fd00::1]/", "https://192.0.2.1/", "https://localhost/"]) {
  let threw = null; try { await mat.assertPublicUrl(u); } catch (e) { threw = e; }
  if (!threw) miss(`literal ${u} was allowed`); else console.log("literal refused OK:", u, "->", threw.code, "|", threw.message);
}
// A literal public address, no DNS: allowed.
try { await mat.assertPublicUrl("https://192.0.66.161/"); console.log("literal 192.0.66.161 allowed OK"); } catch (e) { miss("literal 192.0.66.161 refused: " + e.message); }

// Entry 2: /api/fetch, stand-in DNS and stand-in fetch (records what it was asked). 12 representative addresses.
const PASS = "pw-n1v";
const env = { SILICUS_DEMO_PASSCODE: PASS };
const html = "<html><body><p>" + "The Moon is lit by the Sun and we see changing parts of it. ".repeat(10) + "</p></body></html>";
let apiN = 0;
for (const [ip, refused] of [["192.0.66.161", false], ["8.8.8.8", false], ["192.0.2.1", true], ["169.254.169.254", true], ["::ffff:127.0.0.1", true], ["fd00::1", true], ["10.1.1.1", true], ["198.18.0.5", true], ["100.64.1.1", true], ["2606:4700:4700::1111", false], ["198.51.100.4", true], ["203.0.113.4", true]]) {
  const asked = [];
  const fetchImpl = async (url) => { asked.push(String(url)); return new Response(html, { status: 200, headers: { "content-type": "text/html" } }); };
  const { POST } = api.createFetchHandler({ env, fetchImpl, lookupImpl: to(ip) });
  const res = await POST(new Request("https://app.example/api/fetch", { method: "POST", headers: { "content-type": "application/json", "x-silicus-passcode": PASS, "x-forwarded-for": "198.51.100.77" }, body: JSON.stringify({ url: "https://name.example/page" }) }));
  const txt = await res.text(); apiN++;
  const gotRefused = res.status === 422 && /URL_REFUSED/.test(txt);
  if (gotRefused !== refused || (refused && asked.length) || (!refused && res.status !== 200)) miss(`/api/fetch name->${ip}: status ${res.status} refused=${gotRefused} asked=${asked.length} body=${txt.slice(0, 120)}`);
}
console.log(`/api/fetch: ${apiN} rows, total mismatches so far ${bad}`);
console.log(bad === 0 ? `PASS total rows: ${n} table + ${apiN} api` : `FAIL ${bad} mismatches`);
process.exit(bad === 0 ? 0 : 1);
