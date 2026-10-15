/**
 * digest.mjs — the sha-256 of a JSON value, defined once. Used for archive records, sealed-version
 * anchors and browser backups, on both hosts. Pure: `node:crypto` is the real one on Node and the
 * shared synchronous SHA-256 in the browser build.
 */
import { createHash } from "node:crypto";

export const digestOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
