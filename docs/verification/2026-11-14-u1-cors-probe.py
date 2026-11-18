#!/usr/bin/env python3
"""U1V probe: compare asfai-education upstream dac19d3 (BASE) with the CORS branch (HEAD).

Usage: python3 2026-11-14-u1-cors-probe.py BASE_PORT HEAD_UNSET_PORT HEAD_SET_PORT
  BASE_PORT       next start of dac19d3
  HEAD_UNSET_PORT next start of 77abe82 with ASFAI_CORS_ORIGINS unset
  HEAD_SET_PORT   next start of 77abe82 with ASFAI_CORS_ORIGINS="https://silicus-ta.vercel.app, https://app.example.com"

Part A  byte-identical: for every request in the matrix, BASE vs HEAD_UNSET must match on
        status line, ordered header list (minus Date) and body bytes.
Part B  security: against HEAD_SET, exercise exact-match / null / substring / regex-ish origins.
Exit 0 only if Part A has 0 diffs and Part B has 0 failed expectations.
"""
import http.client
import sys

base, unset, setp = (int(x) for x in sys.argv[1:4])
LISTED = "https://silicus-ta.vercel.app"
ENDPOINTS = ["/education/oauth/register", "/education/oauth/token",
             "/education/oauth/revoke", "/education/api/mcp"]
VOLATILE = {"date", "etag", "keep-alive", "connection"}


def call(port, method, path, origin=None, body=None, extra=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
    h = {}
    if origin is not None:
        h["Origin"] = origin
    if method == "OPTIONS":
        h["Access-Control-Request-Method"] = "POST"
        h["Access-Control-Request-Headers"] = "authorization, content-type"
    if body is not None:
        h["Content-Type"] = "application/json"
    h.update(extra or {})
    c.request(method, path, body=body, headers=h)
    r = c.getresponse()
    data = r.read()
    hdrs = [(k.lower(), v) for k, v in r.getheaders() if k.lower() not in VOLATILE]
    c.close()
    return r.status, hdrs, data


# ---------------- Part A: byte identity with env unset ----------------
ORIGINS_A = [None, LISTED, "https://evil.example", "null"]
matrix = []
for ep in ENDPOINTS:
    for o in ORIGINS_A:
        matrix.append(("OPTIONS", ep, o, None))
        matrix.append(("POST", ep, o, "{}"))
    matrix.append(("GET", ep, LISTED, None))
matrix.append(("DELETE", "/education/api/mcp", LISTED, None))

diffs = 0
for m, ep, o, b in matrix:
    a = call(base, m, ep, o, b)
    z = call(unset, m, ep, o, b)
    same = a == z
    acors = [k for k, _ in z[1] if k.startswith("access-control")]
    if not same or acors:
        diffs += 1
    print(f"A {m:7} {ep:28} origin={o!s:28} base={a[0]} head={z[0]} identical={same} "
          f"acao-headers-on-head={acors}")
    if not same:
        print("   BASE", a)
        print("   HEAD", z)
print(f"PART_A matrix={len(matrix)} diffs={diffs}")

# ---------------- Part B: security with env set ----------------
fails = 0


def expect(label, cond, detail=""):
    global fails
    if not cond:
        fails += 1
    print(f"B {'ok  ' if cond else 'FAIL'} {label} {detail}")


def hv(hdrs, name):
    return [v for k, v in hdrs if k == name]


for ep in ENDPOINTS:
    # listed
    s, h, _ = call(setp, "OPTIONS", ep, LISTED)
    expect(f"{ep} preflight listed echoes", hv(h, "access-control-allow-origin") == [LISTED] and s == 204,
           f"status={s} acao={hv(h, 'access-control-allow-origin')} vary={hv(h, 'vary')}")
    expect(f"{ep} preflight listed Vary: Origin", "Origin" in hv(h, "vary"), f"vary={hv(h, 'vary')}")
    expect(f"{ep} no allow-credentials", not hv(h, "access-control-allow-credentials"))
    expect(f"{ep} header set", hv(h, "access-control-allow-methods") == ["POST, OPTIONS"]
           and hv(h, "access-control-max-age") == ["600"]
           and hv(h, "access-control-expose-headers") == ["www-authenticate, mcp-session-id"]
           and hv(h, "access-control-allow-headers") ==
           ["authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id"])
    # real responses carry it
    s, h, _ = call(setp, "POST", ep, LISTED, "{}")
    expect(f"{ep} POST listed echoes (status {s})", hv(h, "access-control-allow-origin") == [LISTED]
           and "Origin" in ",".join(hv(h, "vary")), f"vary={hv(h, 'vary')}")
    if ep.endswith("/mcp"):
        expect("mcp 401 exposes www-authenticate", s == 401 and bool(hv(h, "www-authenticate")),
               f"www-authenticate={hv(h, 'www-authenticate')}")
    # unlisted shapes: none may be echoed
    for o in ["https://evil.example", "null", "https://silicus-ta.vercel.app.evil.example",
              "https://evil-silicus-ta.vercel.app", "http://silicus-ta.vercel.app",
              "https://silicus-ta.vercel.app/", "https://SILICUS-TA.vercel.app",
              "https://silicus-ta.vercel.app:443", "https://app.example.com.", "*", ""]:
        for m, b in (("OPTIONS", None), ("POST", "{}")):
            s, h, _ = call(setp, m, ep, o, b)
            leaked = [k for k, _ in h if k.startswith("access-control")]
            expect(f"{ep} {m} origin={o!r} leaks nothing", not leaked, f"status={s} leaked={leaked}")
    # no Origin header at all
    s, h, _ = call(setp, "OPTIONS", ep, None)
    expect(f"{ep} OPTIONS no-origin leaks nothing", not [k for k, _ in h if k.startswith("access-control")])
    # second listed origin and whitespace-trimmed entry
    s, h, _ = call(setp, "OPTIONS", ep, "https://app.example.com")
    expect(f"{ep} second (space-separated) entry works",
           hv(h, "access-control-allow-origin") == ["https://app.example.com"])

# unlisted preflight on HEAD_SET must equal the BASE preflight byte for byte
for ep in ENDPOINTS:
    a = call(base, "OPTIONS", ep, "https://evil.example")
    z = call(setp, "OPTIONS", ep, "https://evil.example")
    expect(f"{ep} unlisted preflight == upstream preflight", a == z)

# Part C: valid (non-error) requests. Needs ASFAI_REMOTE_DATA_DIR + a dummy token secret on all three servers.
GOOD = [("POST", "/education/oauth/register", "application/json",
         '{"client_name":"t","redirect_uris":["http://localhost:5173/cb"],"token_endpoint_auth_method":"none"}', 201),
        ("POST", "/education/oauth/revoke", "application/x-www-form-urlencoded", "token=nope", 200),
        ("POST", "/education/oauth/token", "application/x-www-form-urlencoded", "grant_type=bogus", 400)]


def good(port, path, ctype, body, origin):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
    hh = {"Content-Type": ctype}
    if origin:
        hh["Origin"] = origin
    c.request("POST", path, body=body, headers=hh)
    r = c.getresponse()
    r.read()
    hdrs = [(k.lower(), v) for k, v in r.getheaders() if k.lower() not in VOLATILE | {"content-length"}]
    c.close()
    return r.status, hdrs


for m, path, ctype, body, want in GOOD:
    a = good(base, path, ctype, body, LISTED)
    z = good(unset, path, ctype, body, LISTED)
    y = good(setp, path, ctype, body, LISTED)
    expect(f"{path} valid request status {want} on all three", a[0] == z[0] == y[0] == want, f"{a[0]}/{z[0]}/{y[0]}")
    expect(f"{path} valid request base==head-unset headers", a == z)
    expect(f"{path} valid request head-set echoes + Vary",
           hv(y[1], "access-control-allow-origin") == [LISTED] and "Origin" in hv(y[1], "vary"))
    y2 = good(setp, path, ctype, body, "https://evil.example")
    expect(f"{path} valid request unlisted origin == base headers", y2[1] == a[1] or
           [h for h in y2[1] if not h[0].startswith("access-control")] == a[1])

# Vary clobber check: does the underlying response already carry a Vary value that CORS overwrites?
for ep in ENDPOINTS:
    for m, b in (("POST", "{}"), ("GET", None)):
        s0, h0, _ = call(unset, m, ep, LISTED, b)
        s1, h1, _ = call(setp, m, ep, LISTED, b)
        v0, v1 = hv(h0, "vary"), hv(h1, "vary")
        print(f"B info {m} {ep} vary-before={v0} vary-after={v1}")
        if v0 and not all(x in ",".join(v1) for x in ",".join(v0).replace(" ", "").split(",")):
            print("B FINDING underlying Vary overwritten")
            fails += 1

print(f"PART_B failed_expectations={fails}")
sys.exit(0 if (diffs == 0 and fails == 0) else 1)
