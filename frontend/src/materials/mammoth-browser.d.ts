/** The prebuilt browser bundle of mammoth ships no types of its own; this is the one call extract.ts makes. */
declare module "mammoth/mammoth.browser.min.js" {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
}
