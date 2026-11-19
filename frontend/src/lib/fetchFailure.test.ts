/**
 * fetchFailure.test.ts — K1 item 5: a web page Silicus could not read is named in plain words, from either host's
 * sentence, and the raw sentence (with the status) stays for Details.
 */
import { describe, expect, it } from "vitest";
import { plainFetchFailure, statusIn } from "./fetchFailure";
import { explainRefusal } from "./refusals";
import { skippedDetail, skippedLine } from "../studio/sourceUse";

const BLOCKED = "This site blocks automatic reading. Paste the text, or save the page as a PDF and add that.";
const NOT_FOUND = "That page was not found.";
const TIMEOUT = "The site took too long. Try again or paste the text.";

describe("plain words for a page that could not be read", () => {
  it("reads the status out of both hosts' sentences", () => {
    expect(statusIn("that link answered 403")).toBe(403); // Node host, and the site's /api/fetch 422
    expect(statusIn("that link could not be read (404)")).toBe(404); // browser host fallback
    expect(statusIn("that link could not be reached")).toBeNull();
  });

  it("403, 401 and 'blocked' → blocks automatic reading; 404 → not found; timeouts → took too long", () => {
    for (const m of ["that link answered 403", "that link answered 401", "that link could not be read (403)", "the site blocked the request"]) expect(plainFetchFailure(m)?.line).toBe(BLOCKED);
    for (const m of ["that link answered 404", "that link could not be read (404)"]) expect(plainFetchFailure(m)?.line).toBe(NOT_FOUND);
    for (const m of ["reading that link took too long", "reading that link took too long (504)", "that link could not be read (504)"]) expect(plainFetchFailure(m)?.line).toBe(TIMEOUT);
    expect(plainFetchFailure("that link could not be reached")).toBeNull();
    expect(plainFetchFailure("that link answered 500")).toBeNull();
  });

  it("a refusal shows the plain words and keeps the raw status in Details", () => {
    const err = Object.assign(new Error("that link answered 403"), { code: "URL_UNREACHABLE" });
    const x = explainRefusal(err, "propose");
    expect(`${x.what} ${x.next}`).toBe(BLOCKED);
    expect(x.what).not.toMatch(/403|couldn/);
    expect(x.details).toMatch(/403/);
    const other = explainRefusal(Object.assign(new Error("that link could not be reached"), { code: "URL_UNREACHABLE" }), "propose");
    expect(other.what).toBe("Silicus couldn’t read that web page.");
  });

  it("a skipped source says it in plain words under Sources, with the raw sentence for Details", () => {
    const skipped = [
      { name: "https://example.org/a", code: "URL_UNREACHABLE", reason: "that link answered 403" },
      { name: "https://example.org/b", code: "URL_UNREACHABLE", reason: "that link answered 404" },
      { name: "https://example.org/c", code: "URL_UNREACHABLE", reason: "reading that link took too long" },
    ];
    expect(skippedLine("https://example.org/a", skipped)).toBe(`Skipped: ${BLOCKED}`);
    expect(skippedLine("https://example.org/b", skipped)).toBe(`Skipped: ${NOT_FOUND}`);
    expect(skippedLine("https://example.org/c", skipped)).toBe(`Skipped: ${TIMEOUT}`);
    expect(skippedDetail("https://example.org/a", skipped)).toBe("that link answered 403");
  });

  it("N1: a refused address gets the same closed Details as other failures, with the host's sentence", () => {
    const skipped = [{ name: "https://meta.example/", code: "URL_REFUSED", reason: "meta.example resolves to 169.254.169.254, which is not a public address" }];
    expect(skippedLine("https://meta.example/", skipped)).toBe("Skipped: Silicus does not open this kind of address");
    expect(skippedDetail("https://meta.example/", skipped)).toBe("meta.example resolves to 169.254.169.254, which is not a public address");
  });
});
