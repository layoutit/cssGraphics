// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production site and standalone adapter use the same bank-selecting entry", async () => {
  const [entry, standalone, router] = await Promise.all([
    readFile(new URL("../src/csscityflow/entry.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../../site/scene-router.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(entry, /selectCityflowPreparedBank\(/u);
  assert.match(entry, /await import\("\.\/mobileClient\.mjs"\)/u);
  assert.match(entry, /await import\("\.\/client\.mjs"\)/u);
  assert.match(entry, /runtime\.mountCityflow\(host, bankId\)/u);
  assert.match(standalone, /csscityflow\/entry\.mjs/u);
  assert.match(router, /cityflow\/src\/csscityflow\/entry\.mjs/u);
  assert.doesNotMatch(router, /cityflow\/src\/csscityflow\/client\.mjs/u);
});
