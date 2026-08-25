// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBlackHolePresentationFrame,
  CSSBLACKHOLE_PRESENTATION_PADDING_PIXELS,
  CSSBLACKHOLE_PRESENTATION_VERTICAL_VIEWPORT_PADDING_PIXELS,
} from
  "../src/cssblackhole/stagePresentation.mjs";

const sourceViewport = Object.freeze({ width: 800, height: 600 });
const sourceBounds = Object.freeze({
  minimumX: 126.2,
  maximumX: 673.8,
  minimumY: 117.7,
  maximumY: 432.5,
});

test("Luminet contains its prepared content bounds inside responsive hosts", () => {
  const desktop = calculateBlackHolePresentationFrame({
    hostWidth: 926, hostHeight: 800, sourceViewport, sourceBounds,
  });
  const mobile = calculateBlackHolePresentationFrame({
    hostWidth: 390, hostHeight: 600, sourceViewport, sourceBounds,
  });
  assert.equal(CSSBLACKHOLE_PRESENTATION_PADDING_PIXELS, 90);
  assert.equal(CSSBLACKHOLE_PRESENTATION_VERTICAL_VIEWPORT_PADDING_PIXELS, 22);
  assert.deepEqual(Object.fromEntries(Object.entries(desktop.paddedBounds)
    .map(([key, value]) => [key, Number(value.toFixed(1))])), {
    minimumX: 36.2,
    maximumX: 763.8,
    minimumY: 27.7,
    maximumY: 522.5,
  });
  assert.equal(desktop.centerX, 400);
  assert.equal(desktop.centerY, 275.1);
  assert.ok(Math.abs(desktop.scale - 926 / 727.6) < 1e-12);
  assert.ok(Math.abs(mobile.scale - 390 / 727.6) < 1e-12);
});

test("Luminet reserves extra top and bottom room for its top-down view", () => {
  const monitor = calculateBlackHolePresentationFrame({
    hostWidth: 1_600,
    hostHeight: 1_233,
    sourceViewport,
    sourceBounds: {
      minimumX: 126.2,
      maximumX: 673.8,
      minimumY: 26.8,
      maximumY: 573.2,
    },
  });
  assert.ok(Math.abs(monitor.scale - 1_189 / 600) < 1e-12);
  const topMargin = 1_233 / 2 + (26.8 - monitor.centerY) * monitor.scale;
  const bottomMargin = 1_233 / 2 - (573.2 - monitor.centerY) * monitor.scale;
  assert.ok(topMargin > 75);
  assert.ok(bottomMargin > 75);
});

test("Luminet rejects invalid presentation dimensions", () => {
  assert.throws(() => calculateBlackHolePresentationFrame({
    hostWidth: 0, hostHeight: 600, sourceViewport, sourceBounds,
  }),
    /host width must be a positive finite number/u);
  assert.throws(() => calculateBlackHolePresentationFrame({
    hostWidth: 800, hostHeight: 600, sourceViewport: { width: 0, height: 600 }, sourceBounds,
  }),
    /source viewport width must be a positive finite number/u);
  assert.throws(() => calculateBlackHolePresentationFrame({
    hostWidth: 800,
    hostHeight: 600,
    sourceViewport,
    sourceBounds: { ...sourceBounds, maximumX: 801 },
  }), /bounds must fit its source viewport/u);
  assert.throws(() => calculateBlackHolePresentationFrame({
    hostWidth: 800, hostHeight: 600, sourceViewport, sourceBounds, paddingPixels: -1,
  }), /padding must be a non-negative finite number/u);
  assert.throws(() => calculateBlackHolePresentationFrame({
    hostWidth: 800,
    hostHeight: 600,
    sourceViewport,
    sourceBounds,
    verticalViewportPaddingPixels: -1,
  }), /vertical viewport padding must be a non-negative finite number/u);
});
