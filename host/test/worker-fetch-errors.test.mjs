/**
 * worker-fetch-errors.test.mjs — a fetchImpl may refuse a call with its own WorkerError (the browser host's
 * passcode-carrying fetch maps the site function's 402/429/503 to one), and that refusal must reach the
 * caller with its code and words intact instead of being flattened into "could not be reached".
 * Any other thrown error is still WORKER_UNREACHABLE, exactly as before.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PlanWorker, WorkerError } from "../worker.mjs";

const objectives = [{ id: "urn:uuid:1", statement: "Students can count." }];

test("a WorkerError thrown by fetchImpl keeps its code and message", async () => {
  const w = new PlanWorker({ url: "https://example.test/v1", model: "m", fetchImpl: async () => { throw new WorkerError("MODEL_NO_CREDITS", "The model account has no credits."); } });
  await assert.rejects(w.draft({ objectives }), { code: "MODEL_NO_CREDITS", message: "The model account has no credits." });
});

test("any other fetch failure is still WORKER_UNREACHABLE", async () => {
  const w = new PlanWorker({ url: "https://example.test/v1", model: "m", fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(w.draft({ objectives }), { code: "WORKER_UNREACHABLE" });
});
