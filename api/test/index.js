// Entry point so that `node --test api/test/` works on Node 22.
//
// Node 22 does not expand a directory argument to `--test`; it resolves the directory as a module,
// which lands here. This file only loads every *.test.mjs beside it, so the tests run exactly as
// they do under `node --test api/test/*.test.mjs` (which skips this file). It is CommonJS on purpose:
// a directory resolves to index.js, and there is no root package.json to make .js mean ESM.
// It never ships: .vercelignore keeps api/test out of the deployment.
"use strict";
const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  for (const name of readdirSync(__dirname).filter((n) => n.endsWith(".test.mjs")).sort()) {
    await import(pathToFileURL(join(__dirname, name)).href);
  }
})().catch((e) => {
  process.exitCode = 1;
  throw e;
});
