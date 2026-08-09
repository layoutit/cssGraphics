import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { captureNativeMenger } from "../src/prepare/cssmenger/nativeOracle.mjs";
import { buildPreparedMengerPlayback, CSSMENGER_SEED } from "../src/prepare/cssmenger/sourcePlayback.mjs";

const sourceRoot = resolve(process.env.CSSMENGER_SOURCE_ROOT ?? ".local/xscreensaver");

test("pinned native menger.c state and pixels are deterministic and source-exact", {
  skip: !existsSync(sourceRoot) || process.platform !== "darwin"
    ? "Pinned local XScreenSaver source and macOS CGL are required"
    : false,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "cssmenger-native-oracle-"));
  const ticks = [0, 1, 5, 20, 45];
  const first = await captureNativeMenger(sourceRoot, {
    seed: CSSMENGER_SEED,
    ticks,
    outputDir: join(root, "first"),
  });
  const second = await captureNativeMenger(sourceRoot, {
    seed: CSSMENGER_SEED,
    ticks,
    outputDir: join(root, "second"),
  });
  assert.equal(first.statesSha256, second.statesSha256);
  assert.equal(first.sequenceSha256, second.sequenceSha256);
  const playback = buildPreparedMengerPlayback();
  for (let index = 0; index < ticks.length; index += 1) {
    const tick = ticks[index];
    const row = first.states[index];
    assert.equal(row.tick, tick);
    assert.equal(row.depth, 3);
    assert.equal(row.polygonCount, 18_048);
    assert.equal(playback.transforms[tick], nativeTransform(row.rotationFractions));
    assert.deepEqual(row.paletteIndices, playback.colorRows[tick]);
    assert.deepEqual(
      row.paletteSource16,
      playback.colorRows[tick].map((paletteIndex) => playback.palette[paletteIndex].source16),
    );
  }
});

function nativeTransform([x, y, z]) {
  return `rotateX(${number(-x * 360)}deg) rotateY(${number(y * 360)}deg) rotateZ(${number(-z * 360)}deg)`;
}

function number(value) {
  return Number(value.toFixed(9)).toString();
}
