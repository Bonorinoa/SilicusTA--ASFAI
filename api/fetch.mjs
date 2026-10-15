// POST /api/fetch — the guarded public-URL fetch. Logic and tests: api/_lib/fetch.mjs, api/test/fetch.test.mjs.
import { createFetchHandler } from "./_lib/fetch.mjs";

export const { POST } = createFetchHandler();
