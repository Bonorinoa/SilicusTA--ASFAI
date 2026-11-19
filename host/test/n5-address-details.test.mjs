/** N5 C3 (N1V): a literal-IP refusal names the kind of address, as a DNS refusal names the address it resolved to. */
import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicUrl, addressKind } from "../materials.mjs";

const refusal = async (url) => { try { await assertPublicUrl(url, { lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }] }); return null; } catch (e) { return `${e.code}: ${e.message}`; } };

test("N5 C3 1. literal addresses: the Details say which kind of address it is", async () => {
  assert.equal(await refusal("https://169.254.169.254/"), "URL_REFUSED: 169.254.169.254 is a link-local address, not a public one");
  assert.equal(await refusal("https://127.0.0.1/"), "URL_REFUSED: 127.0.0.1 is a loopback address, not a public one");
  assert.equal(await refusal("https://10.1.2.3/"), "URL_REFUSED: 10.1.2.3 is a private network address, not a public one");
  assert.equal(await refusal("https://192.168.0.1/"), "URL_REFUSED: 192.168.0.1 is a private network address, not a public one");
  assert.equal(await refusal("https://[::1]/"), "URL_REFUSED: ::1 is a loopback address, not a public one");
  assert.equal(await refusal("https://[fe80::1]/"), "URL_REFUSED: fe80::1 is a link-local address, not a public one");
  assert.equal(await refusal("https://[fd00::1]/"), "URL_REFUSED: fd00::1 is a private network (unique local) address, not a public one");
  assert.equal(addressKind("100.64.0.1"), "a shared (carrier-grade NAT) address");
  assert.equal(addressKind("::ffff:169.254.169.254"), "a link-local address");
  assert.equal(addressKind("192.0.2.1"), "a reserved address");
});

test("N5 C3 2. a public literal still passes; the DNS refusal is unchanged", async () => {
  assert.equal(await refusal("https://93.184.216.34/"), null);
  let msg = null;
  try { await assertPublicUrl("https://meta.example/", { lookupImpl: async () => [{ address: "169.254.169.254", family: 4 }] }); } catch (e) { msg = e.message; }
  assert.equal(msg, "meta.example resolves to 169.254.169.254, which is not a public address");
});
