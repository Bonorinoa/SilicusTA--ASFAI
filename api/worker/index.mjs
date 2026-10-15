// POST /api/worker — the model proxy. Logic and tests: api/_lib/worker.mjs, api/test/worker.test.mjs.
import { createWorkerHandler } from "../_lib/worker.mjs";

export const { POST } = createWorkerHandler();
