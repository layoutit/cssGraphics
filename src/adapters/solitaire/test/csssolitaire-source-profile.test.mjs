import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { referencePath } from "../src/prepare/csssolitaire/paths.mjs";

test("source lock binds recovered behavior and excludes proprietary product bytes", async () => {
  const lock = JSON.parse(await readFile(referencePath, "utf8"));
  assert.equal(lock.schema, "csssolitaire-source-lock@1");
  assert.equal(lock.referenceRevision, "33a6d492ffa63f0b16b1ad982930c16d367f6bbb");
  assert.equal(lock.binaryIdentities["sol.exe"],
    "a6fc95a5b288593c9559bd177ec43bf9b30d8a98cf19e82bf5a1ba5600857f04");
  assert.equal(lock.binaryIdentities["cards.dll"],
    "0fb81e48d8b45e9995ae1e05fd28c1631dbbcdc71180904c1356bfa2c1ead506");
  assert.equal(lock.recoveredRoutine.address, "0x01004df0");
  assert.equal(lock.recoveredRoutine.facts.rankOrder, "King through Ace");
  assert.equal(lock.recoveredRoutine.facts.slotCount, 7);
  assert.equal(lock.recoveredRoutine.facts.horizontalGap,
    "max((clientWidth - cardWidth * 7) / 8, cardWidth / 8 + 3), using signed integer truncation");
  assert.equal(lock.recoveredRoutine.facts.cardsRemainUpright, true);
  assert.equal(lock.recoveredRoutine.facts.framebufferClearDuringCard, false);
  assert.equal(lock.preparedDeterminism.rng, "MSVCRT-compatible");
  assert.equal(lock.cardArtwork.license, "CC0-1.0");
  assert.equal(lock.cardArtwork.preparedPngSha256,
    "e782179fb60932722548e3e6b46038a2df16d15001d3ea8cbdd22cc005f2841d");
  assert.deepEqual(lock.publicBoundary, {
    proprietaryBinaryIncluded: false,
    microsoftCardArtworkIncluded: false,
    nativeCaptureIncluded: false,
    ghidraProjectIncluded: false,
    cc0CardArtworkIncluded: true,
  });
});
