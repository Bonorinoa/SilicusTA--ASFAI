/// <reference types="vitest/config" />
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `confirm-gate.mjs` (the real, unmodified state machine at ../confirm-gate)
 * imports `node:crypto` for `createHash("sha256")` (idempotency keys) and
 * `randomUUID` (local id minting). Browsers have neither as CJS-style
 * builtins, so the whole module is aliased to a small pure-JS shim with
 * identical outputs (verified by src/gate/crypto-shim.test.ts). Everything
 * else — confirm-gate.mjs and host-guard.mjs — is bundled unmodified.
 */
// K5: the host the /api proxy reaches. Default 127.0.0.1:8787; a smoke run on other ports sets SILICUS_API_TARGET.
const API_TARGET = process.env.SILICUS_API_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  build: {
    // The Marble attribution notice (MarbleCredit) must ship as a real file a reader can open:
    // an inlined data: URL is blocked by the site's CSP and is not a reachable licence text.
    assetsInlineLimit: (file: string) => (file.endsWith(".md") ? false : undefined),
  },
  resolve: {
    alias: [{ find: /^node:crypto$/, replacement: path.resolve(here, "src/gate/crypto-shim.mjs") }],
  },
  server: {
    fs: {
      // The confirm-gate core lives one directory up; allow the dev server to read it.
      allow: [here, path.resolve(here, "..")],
    },
    // The GUI is a sidecar: every real course action goes to the Silicus host,
    // same-origin, so the client never needs credentials or CORS.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: false },
    },
  },
  preview: {
    // The built app is served the same way: one origin, /api proxied to the host.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
