// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import test from "node:test";
import {
  CSSCITYFLOW_SOURCE_FAR_PLANE,
  buildCityflowMorphModel,
  buildCityflowPreparedCss,
  buildCityflowPreparedPlayback,
  cityflowPreparedSideDepth,
  cityflowClippedBottoms,
  cityflowEyeZ,
} from "../src/prepare/csscityflow/model.mjs";
import { expandCityflowPreparedTransforms } from
  "../src/csscityflow/preparedTransformTable.mjs";
import {
  CSSCITYFLOW_PHASE_PERIOD,
  CSSCITYFLOW_PHASE_STEP,
  CSSCITYFLOW_PREPARED_FRAME_COUNT,
  CSSCITYFLOW_PRESENTATION_FRAME_COUNT,
} from "../src/prepare/csscityflow/sourceModel.mjs";

test("builds one retained root and three prepared source-face leaves per box", () => {
  for (const [bankId, boxCount] of [["desktop", 200], ["mobile", 100]]) {
    const { state, model } = buildCityflowMorphModel({ bankId });
    assert.equal(model.profile, "static-prepared");
    assert.equal(model.render.shapes.length, boxCount);
    assert.equal(model.render.leaves.length, boxCount * 3);
    assert.equal(model.topology.polygons.length, boxCount * 3);
    assert.equal(model.topology.vertices.length, boxCount * 12);
    assert.ok(model.render.leaves.every((leaf) =>
      leaf.strategy === "solid-quad" && leaf.width === 1 &&
      leaf.height === 1 && leaf.atlas === null));
    const [top, front, right] = model.render.leaves;
    assert.equal(top.matrix[14], 1);
    const defaultDepth = bankId === "desktop" ? 0.1 : 0.28;
    assert.equal(front.matrix[6], defaultDepth);
    assert.equal(right.matrix[6], defaultDepth);
    assert.equal(front.matrix[14], 1 - defaultDepth);
    assert.equal(right.matrix[14], 1 - defaultDepth);
    assert.equal(front.matrix[14] + front.matrix[6] * front.height, 1);
    assert.equal(right.matrix[14] + right.matrix[6] * right.height, 1);
    const preparedDepths = model.render.leaves
      .map((leaf, faceIndex) => faceIndex % 3 === 0 ? null : leaf.matrix[6])
      .filter((depth) => depth !== null);
    assert.equal(preparedDepths.filter((depth) => depth > defaultDepth).length,
      bankId === "desktop" ? 19 : 0);
    assert.equal(Math.max(...preparedDepths), 0.28);
    assert.equal(cityflowPreparedSideDepth(97, bankId), bankId === "desktop" ? 0.2 : 0.28);
    assert.equal(model.render.leaves[97].matrix[14], bankId === "desktop" ? 0.8 : 0.72);
    assert.equal(model.render.leaves[97].matrix[14] + model.render.leaves[97].matrix[6], 1);
    assert.deepEqual(model.materials, [{ id: "cityflow-face", color: [1, 1, 1, 1] }]);
  }
});

test("prepares DOMFORMAT-precedented exact states and C2 reconstructed presentation", () => {
  const { state } = buildCityflowMorphModel();
  const playback = buildCityflowPreparedPlayback(state);
  const css = buildCityflowPreparedCss(state);
  assert.equal(playback.schema, "csscityflow-prepared-playback@58");
  assert.equal(playback.bankId, "desktop");
  assert.equal(playback.modelId, "cityflow");
  assert.equal(playback.precedent, "domformat@0/polycss-playback@0@cc8da736");
  assert.equal(playback.catchUpPolicy, "adjacent-state-late-deadline-reset");
  assert.equal(playback.frameCount, CSSCITYFLOW_PRESENTATION_FRAME_COUNT);
  assert.equal(playback.sourceFrameCount, CSSCITYFLOW_PREPARED_FRAME_COUNT);
  assert.equal(playback.sourceFrameCount, Math.round(CSSCITYFLOW_PHASE_PERIOD / CSSCITYFLOW_PHASE_STEP));
  assert.equal(playback.loop.kind, "prepared-periodic-source-sample-reconstruction");
  assert.equal(playback.loop.exactSourceLoop, false);
  assert.equal(playback.loop.presentationPeriodFrames, 301);
  assert.equal(playback.loop.closureContinuity,
    "periodic-zero-sum-twelve-frame-direction-run-folded-adaptive-smooth-sine-eased-sample-cycle");
  assert.deepEqual(playback.tickIntervalUs, [50_000, 3]);
  assert.deepEqual(playback.sourceTickIntervalUs, [20_000, 1]);
  assert.deepEqual(playback.presentation, {
    kind: "prepared-periodic-source-sample-reconstruction",
    sourceFramesPerSecond: 50,
    framesPerSecond: 60,
    exactSourceStateSeek: true,
    heightInterpolation: "periodic-uniform-cubic-b-spline-c2-source-approximation",
    temporalFilter:
      "prepared-periodic-five-tap-fold-twelve-three-tap-refold-twelve-five-tap-refold-twelve-adaptive-smooth-sine-eased-extrema@1",
    directionRunSuppression:
      "prepared-circular-twelve-frame-or-short-direction-run-folding-zero-sum-adaptive-smooth-sine-24-54-0.6-eased@1",
    colorInterpolation: "prepared-srgb-interpolated-final-face-color",
    transformPublication:
      "prepared-packed-transform-components-expanded-once-plus-sparse-final-face-color-and-whole-box-leaf-visibility-publication",
    statePublication: {
      schema: "csscityflow-prepared-state-publication@22",
      frameCount: 301,
      animationCount: 0,
      runtimeFormatting: false,
      loadTimeAssembly: "one-time-prepared-transform-component-table-expansion",
      sourceSeekAssembly: "none-cached-expanded-transform-and-final-face-color-dictionaries",
      atomicProperties:
        "prepared-root-transform-plus-direct-leaf-visibility-and-final-face-background-color",
      minimumShapeStyleWritesPerScheduledTick: 0,
      maximumShapeStyleWritesPerScheduledTick: 187,
      maximumLeafColorStyleWritesPerScheduledTick: 271,
      maximumVisibilityStyleWritesPerScheduledTick: 18,
    },
  });
  assert.equal(playback.boxCount, 200);
  assert.equal(playback.transforms, undefined);
  assert.equal(playback.transformTable.schema, "csscityflow-prepared-transform-table@1");
  assert.equal(playback.transformTable.precedent,
    "cssgraphics.prepared-transform-table@1+cssgravitywell-sparse-component-varints@2");
  assert.equal(playback.transformTable.encoding,
    "per-box-affine-template-plus-z-delta-signed-varint-base64");
  assert.equal(playback.transformTable.count, 76051);
  assert.equal(playback.transformTable.width, 12);
  assert.equal(playback.transformTable.changingComponent, 8);
  assert.equal(playback.transformTable.groups.length, playback.boxCount);
  const transforms = expandCityflowPreparedTransforms(
    playback.transformTable,
    playback.transformIndices.transformOffsets,
  );
  assert.equal(transforms.length, playback.transformTable.count);
  assert.ok(transforms.every((transform) => /^matrix3d\([^)]+\)$/u.test(transform)));
  assert.equal(decodeUint16(playback.transformIndices.presentationBase64).length,
    playback.frameCount * playback.boxCount);
  assert.equal(decodeUint16(playback.transformIndices.sourceBase64).length,
    playback.sourceFrameCount * playback.boxCount);
  assert.equal(decodeUint16(playback.colors.presentationMaterialIndicesBase64).length,
    playback.frameCount * playback.boxCount);
  assert.equal(decodeUint16(playback.colors.sourceMaterialIndicesBase64).length,
    playback.sourceFrameCount * playback.boxCount);
  assert.equal(playback.colors.schema, "csscityflow-prepared-face-local-materials@7");
  assert.equal(playback.colors.presentationTransitions.schema,
    "csscityflow-prepared-face-color-transitions@2");
  assert.equal(playback.colors.presentationTransitions.transitionCount, 61358);
  assert.equal(playback.colors.presentationTransitions.maximumWritesPerFrame, 271);
  assert.equal(decodeUint32(playback.colors.presentationTransitions.offsetsBase64).length,
    playback.frameCount + 1);
  assert.equal(decodeUint16(playback.colors.presentationTransitions.faceIndicesBase64).length,
    playback.colors.presentationTransitions.transitionCount);
  assert.equal(playback.colors.presentationTransitions.colors.length, 662);
  assert.equal(decodeUint16(playback.colors.presentationTransitions.colorIndicesBase64).length,
    playback.colors.presentationTransitions.transitionCount);
  assertPreparedColorTransitions(playback);
  assert.ok(playback.colors.materials.every((material) =>
    material.length === 3 && material.every((color) => /^#[a-f0-9]{6}$/u.test(color))));
  const sideLeaf = buildCityflowMorphModel().model.render.leaves[1];
  assert.equal(sideLeaf.height, 1, "side crop must not use a quantized subpixel layout height");
  assert.equal(sideLeaf.matrix[14], 0.9);
  assert.equal(sideLeaf.matrix[6], 0.1);
  assert.equal(playback.paletteSize, 256);
  assert.equal(playback.facesPerBox, 3);
  assert.equal(playback.staticVisibility.schema, "csscityflow-prepared-static-visibility@3");
  assert.equal(playback.staticVisibility.visibleFaceCount, 585);
  assert.equal(playback.staticVisibility.hiddenFaceCount, 15);
  assert.equal(playback.staticVisibility.visibleBoxCount, 195);
  assert.equal(playback.staticVisibility.hiddenBoxCount, 5);
  assert.equal(playback.staticVisibility.hiddenFaceIndices.length, 15);
  assert.deepEqual(playback.staticVisibility.hiddenBoxIndices,
    [68, 69, 176, 190, 199]);
  assert.equal(playback.staticVisibility.presentation.schema,
    "csscityflow-prepared-presentation-box-visibility@1");
  assert.equal(playback.staticVisibility.presentation.encoding,
    "initial-box-bitset-plus-u16le-per-target-frame-toggle-offsets-and-box-indices");
  assert.equal(playback.staticVisibility.presentation.transitionDilationFrames, 12);
  assert.equal(playback.staticVisibility.presentation.alwaysVisibleBoxIndices.length, 128);
  assert.equal(playback.staticVisibility.presentation.initialVisibleCount, 510);
  assert.equal(playback.staticVisibility.presentation.initialVisibleBoxes, 170);
  assert.equal(playback.staticVisibility.presentation.minimumVisibleFaces, 498);
  assert.equal(playback.staticVisibility.presentation.maximumVisibleFaces, 561);
  assert.equal(playback.staticVisibility.presentation.minimumVisibleBoxes, 166);
  assert.equal(playback.staticVisibility.presentation.maximumVisibleBoxes, 187);
  assert.equal(playback.staticVisibility.presentation.transitionCount, 240);
  assert.equal(playback.staticVisibility.presentation.maximumTransitionWritesPerFrame, 6);
  assert.equal(Buffer.from(
    playback.staticVisibility.presentation.initialVisibleBoxBitsBase64,
    "base64",
  ).byteLength, Math.ceil(playback.boxCount / 8));
  assert.equal(decodeUint16(
    playback.staticVisibility.presentation.transitionOffsetsBase64,
  ).length, playback.frameCount + 1);
  assert.equal(decodeUint16(
    playback.staticVisibility.presentation.transitionBoxIndicesBase64,
  ).length, playback.staticVisibility.presentation.transitionCount);
  assert.deepEqual(playback.sideDepth, {
    schema: "csscityflow-prepared-side-depth@1",
    defaultDepthScale: 0.1,
    maximumDepthScale: 0.28,
    overrideCount: 19,
  });
  assert.equal(playback.visibility, undefined);
  assert.equal(playback.diagnostics.productPolicy,
    "diagnostic-only-never-consumed-by-product-playback");
  assert.equal(playback.diagnostics.visibility.schema,
    "csscityflow-prepared-visibility-culling@2");
  assert.equal(playback.diagnostics.visibility.faceCount, 600);
  assert.equal(playback.diagnostics.visibility.wide.source.schema,
    "csscityflow-prepared-wide-source-visibility@1");
  assert.equal((css.match(/@keyframes csscityflow-motion-/gu) ?? []).length, 0);
  assert.doesNotMatch(css, /will-change/u);
  assert.doesNotMatch(css, /animation-/u);
  assert.doesNotMatch(css, /::before/u);
  assert.doesNotMatch(css, /attr\(|::after/u);
  assert.doesNotMatch(css, /--z|@property/u);
  assert.doesNotMatch(css, /\.csscityflow-box[^}]*transform:/u);
  assert.equal((css.match(/hypot\(/gu) ?? []).length, 0);
  assert.doesNotMatch(css, /filter|clip-path|mask|linear-gradient|radial-gradient/u);

  let stationaryTransitionCount = 0;
  const presentationTransformIndices = decodeUint16(playback.transformIndices.presentationBase64);
  const sourceTransformIndices = decodeUint16(playback.transformIndices.sourceBase64);
  for (let boxIndex = 0; boxIndex < playback.boxCount; boxIndex += 1) {
    const sourceZScales = Array.from({ length: playback.sourceFrameCount }, (_, frameIndex) =>
      zScale(transforms[playback.transformIndices.transformOffsets[boxIndex] +
        sourceTransformIndices[frameIndex * playback.boxCount + boxIndex]]));
    const presentationZScales = Array.from({ length: playback.frameCount }, (_, frameIndex) =>
      zScale(transforms[playback.transformIndices.transformOffsets[boxIndex] +
        presentationTransformIndices[frameIndex * playback.boxCount + boxIndex]
      ]));
    assert.ok(Math.min(...presentationZScales) >= Math.min(...sourceZScales) - 2e-9);
    assert.ok(Math.max(...presentationZScales) <= Math.max(...sourceZScales) + 2e-9);
    const velocities = presentationZScales.map((zScale, frameIndex) =>
      zScale - presentationZScales[(frameIndex - 1 + playback.frameCount) % playback.frameCount]);
    const directions = velocities
      .filter((velocity) => Math.abs(velocity) > 1e-7)
      .map(Math.sign);
    assert.ok(circularDirectionRunLengths(directions).every((length) => length > 12));
    stationaryTransitionCount += velocities
      .filter((velocity) => Math.abs(velocity) <= 1e-9).length;
  }
  assert.ok(stationaryTransitionCount / (playback.frameCount * playback.boxCount) < 0.002);
});

test("prepares an independent packed mobile product bank", () => {
  const { state, model } = buildCityflowMorphModel({ bankId: "mobile" });
  const playback = buildCityflowPreparedPlayback(state);
  assert.equal(model.identity.id, "cityflow-mobile");
  assert.equal(playback.schema, "csscityflow-prepared-playback@58");
  assert.equal(playback.bankId, "mobile");
  assert.equal(playback.modelId, "cityflow-mobile");
  assert.equal(playback.boxCount, 100);
  assert.equal(playback.transformTable.groups.length, 100);
  assert.equal(playback.transformIndices.count, 301 * 100);
  assert.equal(playback.transformIndices.sourceCount, 251 * 100);
  assert.equal(playback.staticVisibility.visibleBoxCount, 100);
  assert.equal(playback.staticVisibility.hiddenBoxCount, 0);
  assert.equal(playback.staticVisibility.presentation.minimumVisibleBoxes, 100);
  assert.equal(playback.staticVisibility.presentation.maximumVisibleBoxes, 100);
  assert.equal(playback.staticVisibility.presentation.transitionCount, 0);
  assert.equal(playback.presentation.statePublication.maximumShapeStyleWritesPerScheduledTick, 100);
  assert.equal(playback.presentation.statePublication.maximumVisibilityStyleWritesPerScheduledTick, 0);
  assert.deepEqual(playback.sideDepth, {
    schema: "csscityflow-prepared-side-depth@1",
    defaultDepthScale: 0.28,
    maximumDepthScale: 0.28,
    overrideCount: 0,
  });
  assert.equal(playback.diagnostics.visibility.schema,
    "csscityflow-mobile-diagnostic-visibility@1");
  assert.equal(playback.diagnostics.visibility.bankId, "mobile");
});

function circularDirectionRunLengths(directions) {
  const lengths = [];
  let direction = directions[0];
  let length = 1;
  for (let index = 1; index < directions.length; index += 1) {
    if (directions[index] === direction) length += 1;
    else {
      lengths.push(length);
      direction = directions[index];
      length = 1;
    }
  }
  lengths.push(length);
  if (lengths.length > 1 && directions[0] === directions.at(-1)) {
    lengths[0] += lengths.pop();
  }
  return lengths;
}

function decodeUint16(value) {
  const bytes = Buffer.from(value, "base64");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint16Array.from({ length: bytes.byteLength / 2 }, (_, index) =>
    view.getUint16(index * 2, true));
}

function decodeUint32(value) {
  const bytes = Buffer.from(value, "base64");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint32Array.from({ length: bytes.byteLength / 4 }, (_, index) =>
    view.getUint32(index * 4, true));
}

function assertPreparedColorTransitions(playback) {
  const transitionOffsets = decodeUint32(
    playback.colors.presentationTransitions.offsetsBase64,
  );
  const transitionFaceIndices = decodeUint16(
    playback.colors.presentationTransitions.faceIndicesBase64,
  );
  const transitionColorIndices = decodeUint16(
    playback.colors.presentationTransitions.colorIndicesBase64,
  );
  const materialIndices = decodeUint16(playback.colors.presentationMaterialIndicesBase64);
  const visibility = playback.staticVisibility.presentation;
  const initialBits = Buffer.from(visibility.initialVisibleBoxBitsBase64, "base64");
  const visibilityOffsets = decodeUint16(visibility.transitionOffsetsBase64);
  const visibilityBoxIndices = decodeUint16(visibility.transitionBoxIndicesBase64);
  const visible = Uint8Array.from({ length: playback.boxCount }, (_, boxIndex) =>
    initialBits[boxIndex >> 3] >> (boxIndex & 7) & 1);
  const visibilityRows = [visible.slice()];
  for (let frameIndex = 1; frameIndex < playback.frameCount; frameIndex += 1) {
    for (let cursor = visibilityOffsets[frameIndex];
      cursor < visibilityOffsets[frameIndex + 1]; cursor += 1) {
      visible[visibilityBoxIndices[cursor]] ^= 1;
    }
    visibilityRows.push(visible.slice());
  }
  let computedMaximum = 0;
  for (let targetFrameIndex = 0;
    targetFrameIndex < playback.frameCount; targetFrameIndex += 1) {
    const previousFrameIndex =
      (targetFrameIndex - 1 + playback.frameCount) % playback.frameCount;
    const expected = [];
    for (let faceIndex = 0; faceIndex < visibility.faceCount; faceIndex += 1) {
      const boxIndex = Math.floor(faceIndex / playback.facesPerBox);
      if (visibilityRows[targetFrameIndex][boxIndex] === 0) continue;
      const localFaceIndex = faceIndex % playback.facesPerBox;
      const targetMaterialIndex =
        materialIndices[targetFrameIndex * playback.boxCount + boxIndex];
      const previousMaterialIndex =
        materialIndices[previousFrameIndex * playback.boxCount + boxIndex];
      if (visibilityRows[previousFrameIndex][boxIndex] === 0 ||
          playback.colors.materials[targetMaterialIndex][localFaceIndex] !==
            playback.colors.materials[previousMaterialIndex][localFaceIndex]) {
        expected.push([
          faceIndex,
          playback.colors.materials[targetMaterialIndex][localFaceIndex],
        ]);
      }
    }
    const start = transitionOffsets[targetFrameIndex];
    const end = transitionOffsets[targetFrameIndex + 1];
    const actual = Array.from({ length: end - start }, (_, index) => [
      transitionFaceIndices[start + index],
      playback.colors.presentationTransitions.colors[transitionColorIndices[start + index]],
    ]);
    assert.deepEqual(actual, expected,
      `prepared color transition frame ${targetFrameIndex} drifted`);
    computedMaximum = Math.max(computedMaximum, actual.length);
  }
  assert.equal(computedMaximum,
    playback.colors.presentationTransitions.maximumWritesPerFrame);
}

function zScale(transform) {
  return Number(transform.slice("matrix3d(".length, -1).split(",")[10]);
}

test("clips source side faces at the native far plane during preparation", () => {
  const { state } = buildCityflowMorphModel();
  for (const box of state.boxes) {
    const x = box.centerX;
    const y = box.centerY;
    const xw = box.cth * box.width / 2;
    const xd = box.sth * box.depth / 2;
    const yw = -box.sth * box.width / 2;
    const yd = box.cth * box.depth / 2;
    const bottoms = cityflowClippedBottoms(box);
    assert.ok(cityflowEyeZ(x + xw + xd, y + yw + yd, bottoms.front) >= CSSCITYFLOW_SOURCE_FAR_PLANE - 1e-9);
    assert.ok(cityflowEyeZ(x - xw + xd, y - yw + yd, bottoms.front) >= CSSCITYFLOW_SOURCE_FAR_PLANE - 1e-9);
    assert.ok(cityflowEyeZ(x + xw - xd, y + yw - yd, bottoms.right) >= CSSCITYFLOW_SOURCE_FAR_PLANE - 1e-9);
    assert.ok(cityflowEyeZ(x + xw + xd, y + yw + yd, bottoms.right) >= CSSCITYFLOW_SOURCE_FAR_PLANE - 1e-9);
  }
});
