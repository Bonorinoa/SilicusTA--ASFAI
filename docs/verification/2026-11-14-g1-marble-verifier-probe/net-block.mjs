// Preload: record and refuse any non-loopback network use (fetch, sockets, dns). Writes attempts to ATTEMPTS file at exit.
import net from "node:net";
import dns from "node:dns";
import { writeFileSync } from "node:fs";
const attempts = [];
const isLoop = (h) => ["127.0.0.1", "localhost", "::1", "[::1]", undefined, null, ""].includes(h);
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (!isLoop(u.hostname)) { attempts.push(`fetch ${u.href}`); throw new TypeError("blocked by verifier: network off"); }
  return realFetch(input, init);
};
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  const o = a[0];
  const host = typeof o === "object" && o ? o.host : typeof a[1] === "string" ? a[1] : undefined;
  if (!isLoop(host)) { attempts.push(`socket ${host}`); const e = new Error("blocked by verifier: network off"); process.nextTick(() => this.destroy(e)); return this; }
  return realConnect.apply(this, a);
};
const realLookup = dns.lookup;
dns.lookup = function (h, ...r) { if (!isLoop(h)) attempts.push(`dns ${h}`); return realLookup.call(this, h, ...r); };
process.on("exit", () => writeFileSync(process.env.ATTEMPTS ?? "/dev/null", JSON.stringify(attempts)));
globalThis.__attempts = attempts;
