/**
 * tokens.ts — the TypeScript mirror of ./tokens.css.
 *
 * Components consume CSS custom properties at runtime; this mirror exists for
 * JS consumers (workbench token sheets, tests that verify WCAG contrast and
 * tokens.css/ts parity). Keep both files in lockstep — src/design/tokens.test.ts
 * fails the build if they drift.
 */

export const colorTokens = {
  "color-canvas": "#efe9dc",
  "color-paper": "#fbf8f1",
  "color-paper-raised": "#fffdf8",
  "color-sunken": "#eae3d3",
  "color-ink": "#221f1a",
  "color-ink-soft": "#4e4941",
  "color-ink-muted": "#6b6459",
  "color-rule": "#cfc3a8",
  "color-rule-strong": "#b3a586",
  "color-border-card": "#d5cab3",
  "color-border-control": "#8a8170",
  "color-accent": "#2c4a66",
  "color-accent-strong": "#223b53",
  "color-accent-soft": "#e6ebf0",
  "color-accent-line": "#a9bacb",
  "color-accepted": "#4a6642",
  "color-accepted-bg": "#e9efe3",
  "color-renamed": "#7a5c22",
  "color-renamed-bg": "#f2ebd9",
  "color-dropped": "#87473c",
  "color-dropped-bg": "#f3e6e1",
  "color-added": "#6a4a63",
  "color-added-bg": "#efe6ed",
  "color-proposed": "#6b6459",
  "color-proposed-bg": "#eae3d3",
} as const;

export const fontTokens = {
  "font-display":
    '"Source Serif 4", "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, ui-serif, serif',
  "font-ui":
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  "font-mono": 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
} as const;

/** Type scale on a 4px grid; pair each step with its leading token. */
export const typeScale = {
  "text-2xs": "0.625rem",
  "text-xs": "0.75rem",
  "text-sm": "0.8125rem",
  "text-base": "0.9375rem",
  "text-md": "1.0625rem",
  "text-lg": "1.3125rem",
  "text-xl": "2.125rem",
  "text-2xl": "2.5rem",
} as const;

export const leadingTokens = {
  "leading-2xs": "0.875rem",
  "leading-xs": "1.125rem",
  "leading-sm": "1.25rem",
  "leading-base": "1.5rem",
  "leading-md": "1.75rem",
  "leading-lg": "2rem",
  "leading-xl": "2.5rem",
  "leading-2xl": "3rem",
  "leading-tight": "1.12",
  "leading-snug": "1.3",
  "leading-normal": "1.55",
  "leading-relaxed": "1.7",
} as const;

export const trackingTokens = {
  "tracking-label": "0.14em",
  "tracking-micro": "0.06em",
  "tracking-display": "-0.01em",
} as const;

export const spacingScale = {
  "space-1": "0.25rem",
  "space-2": "0.5rem",
  "space-3": "0.75rem",
  "space-4": "1rem",
  "space-5": "1.25rem",
  "space-6": "1.5rem",
  "space-8": "2rem",
  "space-10": "2.5rem",
  "space-12": "3rem",
  "space-16": "4rem",
  "space-20": "5rem",
} as const;

export const radiusTokens = {
  "radius-xs": "2px",
  "radius-sm": "3px",
  "radius-md": "5px",
  "radius-lg": "8px",
  "radius-pill": "999px",
} as const;

export const motionTokens = {
  "duration-quick": "120ms",
  "duration-base": "180ms",
  "duration-slow": "240ms",
  "ease-settle": "cubic-bezier(0.22, 1, 0.36, 1)",
  "ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
} as const;

/** All custom properties, for parity checking and token sheets. */
export const tokens: Record<string, string> = {
  ...colorTokens,
  ...fontTokens,
  ...typeScale,
  ...leadingTokens,
  ...trackingTokens,
  ...spacingScale,
  ...radiusTokens,
  ...motionTokens,
};

/** Semantic state tokens: [ink, wash] per teacher decision state. */
export const stateTokens = {
  proposed: { ink: colorTokens["color-proposed"], wash: colorTokens["color-proposed-bg"] },
  accepted: { ink: colorTokens["color-accepted"], wash: colorTokens["color-accepted-bg"] },
  renamed: { ink: colorTokens["color-renamed"], wash: colorTokens["color-renamed-bg"] },
  dropped: { ink: colorTokens["color-dropped"], wash: colorTokens["color-dropped-bg"] },
  added: { ink: colorTokens["color-added"], wash: colorTokens["color-added-bg"] },
} as const;

export type StateToken = keyof typeof stateTokens;

/**
 * Documented foreground/background pairs that must clear WCAG AA (>= 4.5:1 for
 * body text; >= 3:1 for control borders). Asserted in src/design/tokens.test.ts.
 */
export const contrastPairs: ReadonlyArray<{
  fg: keyof typeof colorTokens;
  bg: keyof typeof colorTokens;
  min: number;
  where: string;
}> = [
  { fg: "color-ink", bg: "color-paper", min: 4.5, where: "statements on cards" },
  { fg: "color-ink", bg: "color-paper-raised", min: 4.5, where: "plan page text" },
  { fg: "color-ink", bg: "color-canvas", min: 4.5, where: "workbench text" },
  { fg: "color-ink-soft", bg: "color-paper", min: 4.5, where: "body on cards" },
  { fg: "color-ink-soft", bg: "color-paper-raised", min: 4.5, where: "body on plan page" },
  { fg: "color-ink-muted", bg: "color-paper", min: 4.5, where: "provenance lines" },
  { fg: "color-ink-muted", bg: "color-paper-raised", min: 4.5, where: "provenance on plan page" },
  { fg: "color-ink-muted", bg: "color-sunken", min: 4.5, where: "micro-labels on hovers" },
  { fg: "color-ink-muted", bg: "color-proposed-bg", min: 4.5, where: "awaiting chips" },
  { fg: "color-accent", bg: "color-paper", min: 4.5, where: "links / confirm action" },
  { fg: "color-accent", bg: "color-paper-raised", min: 4.5, where: "links on plan page" },
  { fg: "color-paper-raised", bg: "color-accent", min: 4.5, where: "primary button label" },
  { fg: "color-accent", bg: "color-accent-soft", min: 4.5, where: "accent chips" },
  { fg: "color-accepted", bg: "color-accepted-bg", min: 4.5, where: "accepted state label" },
  { fg: "color-accepted", bg: "color-paper", min: 4.5, where: "accepted on card" },
  { fg: "color-renamed", bg: "color-renamed-bg", min: 4.5, where: "renamed state label" },
  { fg: "color-renamed", bg: "color-paper", min: 4.5, where: "renamed on card" },
  { fg: "color-dropped", bg: "color-dropped-bg", min: 4.5, where: "dropped state label" },
  { fg: "color-dropped", bg: "color-paper", min: 4.5, where: "dropped on card" },
  { fg: "color-added", bg: "color-added-bg", min: 4.5, where: "added state label" },
  { fg: "color-added", bg: "color-paper", min: 4.5, where: "added on card" },
  { fg: "color-ink", bg: "color-accepted-bg", min: 4.5, where: "statements on decided rows" },
  { fg: "color-ink", bg: "color-renamed-bg", min: 4.5, where: "statements on decided rows" },
  { fg: "color-ink", bg: "color-dropped-bg", min: 4.5, where: "statements on decided rows" },
  { fg: "color-ink", bg: "color-added-bg", min: 4.5, where: "statements on decided rows" },
  /* A2: decided rows now carry the single accent wash, not four hue washes. */
  { fg: "color-ink", bg: "color-accent-soft", min: 4.5, where: "statements on decided rows (accent wash)" },
  { fg: "color-ink-soft", bg: "color-accent-soft", min: 4.5, where: "decided-row meta (accent wash)" },
  { fg: "color-ink-muted", bg: "color-accent-soft", min: 4.5, where: "decided-row micro-labels (accent wash)" },
  { fg: "color-ink-soft", bg: "color-sunken", min: 4.5, where: "drop-confirm body on the sunken well" },
  { fg: "color-ink", bg: "color-sunken", min: 4.5, where: "drop-confirm title on the sunken well" },
  { fg: "color-border-control", bg: "color-paper", min: 3, where: "button borders" },
  { fg: "color-border-control", bg: "color-canvas", min: 3, where: "button borders (workbench)" },
  { fg: "color-accent", bg: "color-paper", min: 3, where: "focus ring" },
];

/* --------------------------- contrast utilities --------------------------- */

function channelLuminance(hex: string): number {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.1 contrast ratio between two #rrggbb colors. */
export function contrastRatio(fg: string, bg: string): number {
  const a = channelLuminance(fg);
  const b = channelLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
