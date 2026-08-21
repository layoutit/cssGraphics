import assert from "node:assert/strict";
import test from "node:test";
import {
  CSSGRAPHICS_REALLYSLICK_PALETTE_STARTUP_WEIGHTS,
  CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANT_IDS,
  mapReallySlickHueToPreparedHex,
  selectReallySlickPaletteVariant,
} from "../../shared/reallyslickPalette.mjs";

test("maps source hue ranks to the selected three-color Really Slick palette", () => {
  assert.deepEqual(
    [0, 0.399, 0.401, 0.799, 0.801, 0.999].map((hue) =>
      mapReallySlickHueToPreparedHex(hue, "rotate-120")),
    ["#00ffff", "#00ffff", "#0080ff", "#0080ff", "#0000ff", "#0000ff"],
  );
  assert.equal(mapReallySlickHueToPreparedHex(1, "rotate-120"), "#00ffff");
  assert.throws(() => mapReallySlickHueToPreparedHex(0, "sepia"), /variant is invalid/u);
});

test("shares one weighted session cycle without adjacent repeats", () => {
  const storage = fixtureStorage();
  let randomValue = 0;
  const options = {
    storage,
    weights: CSSGRAPHICS_REALLYSLICK_PALETTE_STARTUP_WEIGHTS,
    randomUint32: () => randomValue++,
  };
  const cycleLength = CSSGRAPHICS_REALLYSLICK_PALETTE_STARTUP_WEIGHTS
    .reduce((sum, weight) => sum + weight, 0);
  const selections = Array.from({ length: cycleLength * 2 }, () =>
    selectReallySlickPaletteVariant(CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANT_IDS, options)
      .paletteVariantId);
  assert.ok(selections.every((variantId, index) => index === 0 || variantId !== selections[index - 1]));
  for (const cycle of [selections.slice(0, cycleLength), selections.slice(cycleLength)]) {
    assert.deepEqual(
      CSSGRAPHICS_REALLYSLICK_PALETTE_VARIANT_IDS.map((variantId) =>
        cycle.filter((entry) => entry === variantId).length),
      CSSGRAPHICS_REALLYSLICK_PALETTE_STARTUP_WEIGHTS,
    );
  }
});

function fixtureStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}
