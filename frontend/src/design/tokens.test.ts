/**
 * tokens.test.ts — the tokens' own acceptance tests:
 *  1. tokens.ts mirrors tokens.css (they must not drift), and
 *  2. every documented text pair clears WCAG AA.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { colorTokens, contrastRatio, contrastPairs, tokens } from "./tokens";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "tokens.css"), "utf8");

function cssCustomProperties(): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of css.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    // First definition wins: the reduced-motion media query intentionally
    // redefines the duration tokens and is not the canonical value.
    if (!out.has(match[1])) out.set(match[1], match[2].trim());
  }
  return out;
}

describe("design tokens", () => {
  it("tokens.ts mirrors every custom property in tokens.css", () => {
    const props = cssCustomProperties();
    for (const [name, value] of Object.entries(tokens)) {
      expect(props.has(name), `tokens.css is missing --${name}`).toBe(true);
      expect(
        props.get(name)?.replace(/\s+/g, " ").toLowerCase(),
        `--${name} differs between tokens.css and tokens.ts`,
      ).toBe(value.replace(/\s+/g, " ").toLowerCase());
    }
  });

  it("tokens.css defines at least every color token", () => {
    const props = cssCustomProperties();
    for (const name of Object.keys(colorTokens)) {
      expect(props.has(name), `tokens.css is missing --${name}`).toBe(true);
    }
  });

  it("colors live only in tokens.css and tokens.ts (never in component styles)", async () => {
    const { readdirSync } = await import("node:fs");
    const colorRe = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(css|tsx?|jsx?)$/.test(entry.name)) continue;
        for (const [i, line] of readFileSync(full, "utf8").split("\n").entries()) {
          if (colorRe.test(line)) offenders.push(`${full}:${i + 1}: ${line.trim()}`);
        }
      }
    };
    walk(path.join(here, "..", "components"));
    walk(path.join(here, "..", "workbench"));
    expect(offenders.join("\n"), `hard-coded colors found:\n${offenders.join("\n")}`).toBe("");
  });

  it("every documented text pair clears WCAG AA", () => {
    for (const pair of contrastPairs) {
      const ratio = contrastRatio(colorTokens[pair.fg], colorTokens[pair.bg]);
      expect(
        ratio,
        `${pair.fg} on ${pair.bg} (${pair.where}) = ${ratio.toFixed(2)}:1, needs ${pair.min}:1`,
      ).toBeGreaterThanOrEqual(pair.min);
    }
  });
});
