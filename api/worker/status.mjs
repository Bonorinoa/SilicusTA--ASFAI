// GET /api/worker/status — whether the proxy is configured. Config only, never a credential.
import { createStatusHandler } from "../_lib/worker.mjs";

export const { GET } = createStatusHandler();
