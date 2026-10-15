/**
 * plural.ts — the one way this app counts things in words.
 *
 * "1 objective", "3 objectives" — and never "1 objectives". The count is grouped with the same
 * locale rules the receipts use, so a four-digit count still reads as a number (1,200 objectives).
 *
 * `many` defaults to `one + "s"`, which is right for the regular cases; pass it explicitly for the
 * irregular ones ("activity" → "activities", "minute" → "minutes" is regular but "1 min" is not).
 */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export default plural;
