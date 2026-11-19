/**
 * n1-address-policy.test.mjs — N1 item 2 (L1 finding 2): the public-fetch address check uses the exact IANA
 * special-purpose ranges (RFC 6890 and the registry), not whole /16s. science.nasa.gov resolved to 192.0.66.161,
 * a public address, and was refused because the old rule closed all of 192.0.0.0/16. One table, both directions.
 * The online /api/fetch imports this same function (api/_lib/fetch.mjs), so it is pinned there by api/test too.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicUrl, isPrivateAddress, MaterialError } from "../materials.mjs";

// [address, refused?, why]
const TABLE = [
  ["192.0.66.161", false, "science.nasa.gov (L1): public, inside 192.0.0.0/16 but outside every special range"],
  ["192.0.1.1", false, "192.0.1.0/24 is not special-purpose"],
  ["192.0.3.1", false, "between 192.0.2.0/24 and the rest of 192.0/16"],
  ["93.184.216.34", false, "ordinary public"],
  ["8.8.8.8", false, "ordinary public"],
  ["172.32.0.1", false, "just past 172.16.0.0/12"],
  ["100.128.0.1", false, "just past 100.64.0.0/10"],
  ["198.17.255.255", false, "just before 198.18.0.0/15"],
  ["198.20.0.1", false, "just past 198.18.0.0/15"],
  ["198.51.101.1", false, "just past 198.51.100.0/24"],
  ["203.0.114.1", false, "just past 203.0.113.0/24"],
  ["223.255.255.254", false, "last unicast /8 before multicast"],
  ["169.254.169.254", true, "link-local: the cloud metadata address"],
  ["0.0.0.0", true, "this network 0.0.0.0/8"],
  ["10.1.2.3", true, "private 10/8"],
  ["100.64.0.1", true, "CGNAT 100.64.0.0/10"],
  ["100.127.255.255", true, "CGNAT end"],
  ["127.0.0.1", true, "loopback"],
  ["172.16.0.1", true, "private 172.16/12"],
  ["172.31.255.255", true, "private 172.16/12 end"],
  ["192.0.0.8", true, "IETF protocol assignments 192.0.0.0/24"],
  ["192.0.2.7", true, "TEST-NET-1 192.0.2.0/24"],
  ["192.88.99.1", true, "deprecated 6to4 relay anycast"],
  ["192.168.1.1", true, "private 192.168/16"],
  ["198.18.0.1", true, "benchmarking 198.18.0.0/15"],
  ["198.19.255.255", true, "benchmarking end"],
  ["198.51.100.9", true, "TEST-NET-2"],
  ["203.0.113.9", true, "TEST-NET-3"],
  ["224.0.0.1", true, "multicast"],
  ["240.0.0.1", true, "reserved 240/4"],
  ["255.255.255.255", true, "limited broadcast"],
  ["2606:2800:220:1:248:1893:25c8:1946", false, "ordinary global IPv6"],
  ["2001:4860:4860::8888", false, "global IPv6 inside 2001::/16 but outside 2001::/23"],
  ["::1", true, "IPv6 loopback"],
  ["::", true, "IPv6 unspecified"],
  ["fd00::1", true, "unique local"],
  ["fe80::1", true, "IPv6 link-local"],
  ["ff02::1", true, "IPv6 multicast"],
  ["::ffff:10.0.0.1", true, "IPv4-mapped"],
  ["::ffff:192.0.66.161", true, "IPv4-mapped is never needed for a public page, even of a public v4"],
  ["64:ff9b::1", true, "NAT64"],
  ["100::1", true, "discard-only 100::/64"],
  ["2001::1", true, "Teredo 2001::/32"],
  ["2001:2::1", true, "benchmarking 2001:2::/48"],
  ["2001:10::1", true, "ORCHID, inside 2001::/23"],
  ["2001:db8::1", true, "documentation 2001:db8::/32"],
  ["2002::1", true, "6to4"],
  ["3fff::1", true, "documentation 3fff::/20 (RFC 9637)"],
  ["not-an-ip", true, "unparseable is refused"],
];

test("address table: exact special-purpose ranges, both directions", () => {
  for (const [ip, refused, why] of TABLE) assert.equal(isPrivateAddress(ip), refused, `${ip}: ${why}`);
});

test("a name resolving to 192.0.66.161 is allowed; to 169.254.169.254 it is refused, and the reason names the address", async () => {
  const to = (address) => async () => [{ address, family: 4 }];
  const u = await assertPublicUrl("https://science.nasa.gov/moon/moon-phases/", { lookupImpl: to("192.0.66.161") });
  assert.equal(u.hostname, "science.nasa.gov");
  await assert.rejects(assertPublicUrl("https://metadata.example/", { lookupImpl: to("169.254.169.254") }), (e) => {
    assert.ok(e instanceof MaterialError && e.code === "URL_REFUSED");
    assert.match(e.message, /169\.254\.169\.254/, "the Details line says which address was refused");
    return true;
  });
});
