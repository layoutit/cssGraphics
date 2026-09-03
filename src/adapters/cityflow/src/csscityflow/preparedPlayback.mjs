// SPDX-License-Identifier: HPND
import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";
import { createCityflowDeadlineScheduler } from "./deadlineScheduler.mjs";
import { expandCityflowPreparedTransforms } from "./preparedTransformTable.mjs";

const COLOR_PATTERN = /^#[a-f0-9]{6}$/u;
const decodedPackets = new WeakMap();

export function createCityflowPreparedPlayer({
  playback,
  dom,
  ...overrides
}) {
  const decoded = validatePlayback(playback, dom);
  const shapeElements = dom.shapeElements;
  const frameCount = playback.frameCount;
  const boxCount = playback.boxCount;
  const facesPerBox = playback.facesPerBox;
  const frameMilliseconds = playback.tickIntervalUs[0] / playback.tickIntervalUs[1] / 1_000;
  const transforms = decoded.transforms;
  const transformOffsets = playback.transformIndices.transformOffsets;
  const presentationTransformIndices = decoded.presentationTransformIndices;
  const sourceTransformIndices = decoded.sourceTransformIndices;
  const presentationMaterialIndices = decoded.presentationMaterialIndices;
  const sourceMaterialIndices = decoded.sourceMaterialIndices;
  const presentationColorTransitionOffsets = decoded.presentationColorTransitionOffsets;
  const presentationColorTransitionFaceIndices = decoded.presentationColorTransitionFaceIndices;
  const presentationColorTransitionColorIndices = decoded.presentationColorTransitionColorIndices;
  const presentationTransitionColors = playback.colors.presentationTransitions.colors;
  const presentationBoxVisibilityRows = decoded.presentationBoxVisibilityRows;
  const presentationBoxVisibilityOffsets = decoded.presentationBoxVisibilityOffsets;
  const presentationBoxVisibilityIndices = decoded.presentationBoxVisibilityIndices;
  const materials = playback.colors.materials;
  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: dom.sceneElement,
      writeTransform() { return false; },
    },
    shapes: shapeElements.map((element) => ({ element })),
    leaves: [],
  });
  const leafElements = shapeElements.map((element) => [...element.children]);
  if (leafElements.some((leaves) => leaves.length !== facesPerBox ||
      leaves.some((leaf) => !(leaf instanceof HTMLElement)))) {
    throw new Error("Cityflow retained face binding drifted");
  }
  const flatLeafElements = leafElements.flat();
  const visibleBoxMask = presentationBoxVisibilityRows[0].slice();
  const visibleFaceMask = Uint8Array.from(
    { length: boxCount * facesPerBox },
    (_, faceIndex) => visibleBoxMask[Math.floor(faceIndex / facesPerBox)],
  );
  let visibleFaceCount = visibleFaceMask.reduce((sum, visible) => sum + visible, 0);
  let visibleBoxCount = visibleBoxMask.reduce((sum, visible) => sum + visible, 0);
  let currentVisibilityFrameIndex = 0;
  let sourceVisibilityMode = false;
  let initialVisibilityStyleWrites = 0;
  for (let boxIndex = 0; boxIndex < visibleBoxMask.length; boxIndex += 1) {
    if (visibleBoxMask[boxIndex] !== 0) continue;
    for (const leaf of leafElements[boxIndex]) leaf.style.visibility = "hidden";
    initialVisibilityStyleWrites += facesPerBox;
  }
  const currentTransformIndices = new Int32Array(boxCount).fill(-1);
  const currentFaceColors = new Array(boxCount * facesPerBox).fill(null);
  let frameIndex = 0;
  let sourceFrameIndex = null;
  let publicationCount = 0;
  let shapeStyleWrites = 0;
  let styleChannelWrites = 0;
  let leafColorStyleWrites = 0;
  let visibilityStyleWrites = 0;
  let sourceSeekStyleAssemblies = 0;
  let nextShapeStyleWrites = 0;
  let nextLeafColorStyleWrites = 0;
  let nextVisibilityStyleWrites = 0;
  const lastPublication = {
    frameIndex: 0,
    shapeStyleWrites: 0,
    leafColorStyleWrites: 0,
    visibilityStyleWrites: 0,
  };

  publishPresentationState(0, false);
  const initialShapeStyleWrites = nextShapeStyleWrites;
  const initialLeafColorStyleWrites = nextLeafColorStyleWrites;
  target.assertStableDomIdentity();
  const scheduler = createCityflowDeadlineScheduler({
    ...overrides,
    frameMilliseconds,
    publishDue(tick) {
      publishFrame(tick % frameCount);
    },
  });

  function publishFrame(nextFrameIndex) {
    if (nextFrameIndex === frameIndex && sourceFrameIndex === null) return frameIndex;
    const sequential = sourceFrameIndex === null && !sourceVisibilityMode &&
      nextFrameIndex === (frameIndex + 1) % frameCount;
    publishPresentationState(nextFrameIndex, sequential);
    frameIndex = nextFrameIndex;
    sourceFrameIndex = null;
    recordPublication(frameIndex);
    return frameIndex;
  }

  function publishSourceFrame(nextSourceFrameIndex) {
    nextVisibilityStyleWrites = enterSourceVisibility();
    const nextFrameIndex = Math.min(
      frameCount - 1,
      Math.round(nextSourceFrameIndex * playback.sourceTickIntervalUs[0] /
        playback.sourceTickIntervalUs[1] /
        (playback.tickIntervalUs[0] / playback.tickIntervalUs[1])),
    );
    const offset = nextSourceFrameIndex * boxCount;
    nextShapeStyleWrites = publishTransforms(sourceTransformIndices, offset);
    nextLeafColorStyleWrites = publishAbsoluteColors(sourceMaterialIndices, offset);
    sourceFrameIndex = nextSourceFrameIndex;
    frameIndex = nextFrameIndex;
    recordPublication(frameIndex);
    return sourceFrameIndex;
  }

  function publishPresentationState(nextFrameIndex, sequential) {
    nextVisibilityStyleWrites = publishPresentationBoxVisibility(nextFrameIndex);
    const offset = nextFrameIndex * boxCount;
    nextShapeStyleWrites = publishTransforms(presentationTransformIndices, offset);
    nextLeafColorStyleWrites = sequential
      ? publishPreparedColorTransitions(nextFrameIndex)
      : publishAbsoluteColors(presentationMaterialIndices, offset);
  }

  function publishTransforms(transformIndices, offset) {
    let writes = 0;
    for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
      if (visibleBoxMask[boxIndex] === 0) continue;
      const transformIndex = transformIndices[offset + boxIndex];
      if (currentTransformIndices[boxIndex] === transformIndex) continue;
      shapeElements[boxIndex].style.transform =
        transforms[transformOffsets[boxIndex] + transformIndex];
      currentTransformIndices[boxIndex] = transformIndex;
      writes += 1;
    }
    return writes;
  }

  function publishAbsoluteColors(materialIndices, offset) {
    let writes = 0;
    for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
      const materialIndex = materialIndices[offset + boxIndex];
      const material = materials[materialIndex];
      for (let localFaceIndex = 0; localFaceIndex < facesPerBox; localFaceIndex += 1) {
        const faceIndex = boxIndex * facesPerBox + localFaceIndex;
        if (visibleFaceMask[faceIndex] === 0 ||
            currentFaceColors[faceIndex] === material[localFaceIndex]) continue;
        leafElements[boxIndex][localFaceIndex].style.backgroundColor = material[localFaceIndex];
        currentFaceColors[faceIndex] = material[localFaceIndex];
        writes += 1;
      }
    }
    return writes;
  }

  function publishPreparedColorTransitions(nextFrameIndex) {
    let writes = 0;
    for (let cursor = presentationColorTransitionOffsets[nextFrameIndex];
      cursor < presentationColorTransitionOffsets[nextFrameIndex + 1]; cursor += 1) {
      const faceIndex = presentationColorTransitionFaceIndices[cursor];
      const color = presentationTransitionColors[
        presentationColorTransitionColorIndices[cursor]
      ];
      flatLeafElements[faceIndex].style.backgroundColor = color;
      currentFaceColors[faceIndex] = color;
      writes += 1;
    }
    return writes;
  }

  function publishPresentationBoxVisibility(nextFrameIndex) {
    let writes = 0;
    if (sourceVisibilityMode) {
      writes += applyBoxVisibilityRow(presentationBoxVisibilityRows[nextFrameIndex]);
      sourceVisibilityMode = false;
    } else if (nextFrameIndex === (currentVisibilityFrameIndex + 1) % frameCount) {
      for (let cursor = presentationBoxVisibilityOffsets[nextFrameIndex];
        cursor < presentationBoxVisibilityOffsets[nextFrameIndex + 1]; cursor += 1) {
        writes += setBoxVisibility(
          presentationBoxVisibilityIndices[cursor],
          visibleBoxMask[presentationBoxVisibilityIndices[cursor]] === 0,
        );
      }
    } else if (nextFrameIndex !== currentVisibilityFrameIndex) {
      writes += applyBoxVisibilityRow(presentationBoxVisibilityRows[nextFrameIndex]);
    }
    currentVisibilityFrameIndex = nextFrameIndex;
    return writes;
  }

  function enterSourceVisibility() {
    if (sourceVisibilityMode) return 0;
    const writes = applyBoxVisibilityRow(new Uint8Array(boxCount).fill(1));
    currentVisibilityFrameIndex = null;
    sourceVisibilityMode = true;
    return writes;
  }

  function applyBoxVisibilityRow(row) {
    let writes = 0;
    for (let boxIndex = 0; boxIndex < row.length; boxIndex += 1) {
      if (visibleBoxMask[boxIndex] === row[boxIndex]) continue;
      writes += setBoxVisibility(boxIndex, row[boxIndex] !== 0);
    }
    return writes;
  }

  function setBoxVisibility(boxIndex, visible) {
    const nextVisible = Number(visible);
    if (visibleBoxMask[boxIndex] === nextVisible) return 0;
    for (const leaf of leafElements[boxIndex]) {
      leaf.style.visibility = visible ? "" : "hidden";
    }
    visibleBoxMask[boxIndex] = nextVisible;
    visibleBoxCount += visible ? 1 : -1;
    const boxFaceOffset = boxIndex * facesPerBox;
    for (let localFaceIndex = 0; localFaceIndex < facesPerBox; localFaceIndex += 1) {
      visibleFaceMask[boxFaceOffset + localFaceIndex] = nextVisible;
    }
    visibleFaceCount += visible ? facesPerBox : -facesPerBox;
    if (visible) currentTransformIndices[boxIndex] = -1;
    return facesPerBox;
  }

  function recordPublication(nextFrameIndex) {
    publicationCount += 1;
    shapeStyleWrites += nextShapeStyleWrites;
    leafColorStyleWrites += nextLeafColorStyleWrites;
    visibilityStyleWrites += nextVisibilityStyleWrites;
    styleChannelWrites += nextShapeStyleWrites + nextLeafColorStyleWrites +
      nextVisibilityStyleWrites;
    lastPublication.frameIndex = nextFrameIndex;
    lastPublication.shapeStyleWrites = nextShapeStyleWrites;
    lastPublication.leafColorStyleWrites = nextLeafColorStyleWrites;
    lastPublication.visibilityStyleWrites = nextVisibilityStyleWrites;
  }

  function snapshot() {
    const schedulerStats = scheduler.stats();
    target.assertStableDomIdentity();
    dom.assertStableDomIdentity();
    const domStats = dom.stats();
    return Object.freeze({
      schema: "csscityflow-prepared-player-stats@7",
      ready: true,
      paused: schedulerStats.paused,
      tick: schedulerStats.tick,
      frameIndex,
      frameCount,
      sourceFrameIndex,
      activeVisibilityVariant: sourceVisibilityMode
        ? "exact-source-seek-all-retained-faces"
        : "prepared-whole-box-visibility",
      sourceFrameCount: playback.sourceFrameCount,
      boxCount,
      frameMilliseconds,
      catchUpPolicy: playback.catchUpPolicy,
      timerCallbackCount: schedulerStats.timerCallbackCount,
      animationFrameCallbackCount: schedulerStats.animationFrameCallbackCount,
      schedulerEarlyCallbackCount: schedulerStats.earlyCallbackCount,
      schedulerEarlyDeadlineToleranceMilliseconds:
        schedulerStats.earlyDeadlineToleranceMilliseconds,
      schedulerMinimumDistinctPublicationSpacingMilliseconds:
        schedulerStats.minimumDistinctPublicationSpacingMilliseconds,
      schedulerDisplayPhaseResyncCount: schedulerStats.displayPhaseResyncCount,
      schedulerLateDeadlineResetCount: schedulerStats.lateDeadlineResetCount,
      publishedAdjacentTransitionCount: schedulerStats.publishedAdjacentTransitionCount,
      preparedStateSkipCount: schedulerStats.preparedStateSkipCount,
      schedulerTimeSource: schedulerStats.schedulerTimeSource,
      publicationPacingTimeSource: schedulerStats.publicationPacingTimeSource,
      resumePublicationPolicy: schedulerStats.resumePublicationPolicy,
      publicationCount,
      shapeStyleWrites,
      styleChannelWrites,
      leafColorStyleWrites,
      visibilityStyleWrites,
      sourceSeekStyleAssemblies,
      retainedFaceCount: boxCount * facesPerBox,
      retainedBoxCount: boxCount,
      visibleFaceCount,
      visibleBoxCount,
      staticSuppressedFaceCount: playback.staticVisibility.hiddenFaceCount,
      staticSuppressedBoxCount: playback.staticVisibility.hiddenBoxCount,
      staticSuppressionBindingWrites:
        playback.staticVisibility.hiddenFaceCount,
      visibilityWrites: visibilityStyleWrites,
      visibilityTransitionAssignments: visibilityStyleWrites,
      preparedTimelineAuthority: "sequential-prepared-state-index",
      presentationMode: playback.presentation.kind,
      transformPresentationMode: playback.presentation.transformPublication,
      preparedTransformAnimationCount: 0,
      preparedTransformStateCount: playback.frameCount,
      preparedTransformAnimationMode: "none-prepared-visible-root-state-publication",
      runtimeShapeStyleWriteUpperBound:
        playback.staticVisibility.presentation.maximumVisibleBoxes,
      runtimeLeafColorStyleWriteUpperBound:
        playback.presentation.statePublication.maximumLeafColorStyleWritesPerScheduledTick,
      runtimeLeafColorStyleWrites: leafColorStyleWrites,
      pseudoElementSideFacePublication: false,
      pseudoElementFaceColorOverlay: false,
      retainedSideLeafPaintOwners: 1,
      sideLeafPreparedHeight: 1,
      sideLeafPreparedDefaultDepthScale: playback.sideDepth.defaultDepthScale,
      sideLeafPreparedMaximumDepthScale: playback.sideDepth.maximumDepthScale,
      sideLeafPreparedOverrideCount: playback.sideDepth.overrideCount,
      sideLeafPreparedDefaultTopOffset: 1 - playback.sideDepth.defaultDepthScale,
      sideLeafPreparedMinimumTopOffset: 1 - playback.sideDepth.maximumDepthScale,
      sideLeafLayoutSubpixelFree: true,
      initialShapeStyleWrites,
      initialLeafColorStyleWrites,
      initialVisibilityWrites:
        initialVisibilityStyleWrites,
      visibilityCullingPolicy:
        "prepared-viewport-independent-whole-box-direct-leaf-visibility-no-face-culling",
      minimumVisibleFaceCount: playback.staticVisibility.presentation.minimumVisibleFaces,
      maximumVisibleFaceCount: playback.staticVisibility.presentation.maximumVisibleFaces,
      minimumVisibleBoxCount: playback.staticVisibility.presentation.minimumVisibleBoxes,
      maximumVisibleBoxCount: playback.staticVisibility.presentation.maximumVisibleBoxes,
      lastPublication: Object.freeze({ ...lastPublication }),
      identityStable: true,
      runtimeGeometryCalculationCount: 0,
      runtimeAtlasRasterizationCount: 0,
      retainedModelRootCount: domStats.retainedModelRootCount,
      retainedDomClassAttributeCount: domStats.retainedDomClassAttributeCount,
      retainedDomDataAttributeCount: domStats.retainedDomDataAttributeCount,
      retainedDomAriaAttributeCount: domStats.retainedDomAriaAttributeCount,
      retainedCameraInlineStyleAttributeCount: domStats.retainedCameraInlineStyleAttributeCount,
      retainedSceneInlineStyleAttributeCount: domStats.retainedSceneInlineStyleAttributeCount,
      retainedSceneInlineTransformCount: domStats.retainedSceneInlineTransformCount,
      retainedBackfaceInlineStyleCount: domStats.retainedBackfaceInlineStyleCount,
      runtimeDomMutationCount: domStats.runtimeDomMutationCount,
      runtimeDomGrowth: false,
    });
  }

  return Object.freeze({
    get paused() { return scheduler.paused; },
    get frameIndex() { return frameIndex; },
    pause() {
      scheduler.pause();
      return snapshot();
    },
    resume() {
      scheduler.resume();
      return snapshot();
    },
    seekFrame(value) {
      if (!Number.isSafeInteger(value) || value < 0 || value >= frameCount) {
        throw new RangeError("Cityflow prepared frame is out of range");
      }
      publishFrame(value);
      scheduler.seekTick(value);
      return snapshot();
    },
    seekPresentationTime(value) {
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError("Cityflow prepared presentation time is out of range");
      }
      const normalized = value % (frameCount * frameMilliseconds);
      const nextFrameIndex = Math.floor((normalized + 0.001) / frameMilliseconds) % frameCount;
      publishFrame(nextFrameIndex);
      scheduler.seekTick(nextFrameIndex);
      return snapshot();
    },
    seekSourceFrame(value) {
      if (!Number.isSafeInteger(value) || value < 0 || value >= playback.sourceFrameCount) {
        throw new RangeError("Cityflow prepared source frame is out of range");
      }
      publishSourceFrame(value);
      scheduler.seekTick(frameIndex);
      return snapshot();
    },
    preparedTransformAt(boxIndex, transformIndex) {
      if (!Number.isSafeInteger(boxIndex) || boxIndex < 0 || boxIndex >= boxCount ||
          !Number.isSafeInteger(transformIndex) || transformIndex < 0 ||
          transformIndex >= transformOffsets[boxIndex + 1] - transformOffsets[boxIndex]) {
        throw new RangeError("Cityflow prepared transform address is out of range");
      }
      return transforms[transformOffsets[boxIndex] + transformIndex];
    },
    assertStableDomIdentity() {
      target.assertStableDomIdentity();
      dom.assertStableDomIdentity();
      return true;
    },
    stats: snapshot,
    destroy() {
      scheduler.destroy();
      target.destroy();
    },
  });
}

export async function loadCityflowPreparedPlayback(url, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Cityflow prepared playback failed to load: ${response.status}`);
  const playback = await response.json();
  validatePacket(playback);
  return playback;
}

function validatePlayback(playback, dom) {
  const decoded = validatePacket(playback);
  if (!(dom?.sceneElement instanceof HTMLElement) ||
      typeof dom.assertStableDomIdentity !== "function" ||
      !Array.isArray(dom.shapeElements) || dom.shapeElements.length !== playback.boxCount ||
      dom.shapeElements.some((element) => !(element instanceof HTMLElement))) {
    throw new Error("Cityflow retained playback targets drifted");
  }
  return decoded;
}

function validatePacket(playback) {
  const stateCount = playback?.frameCount * playback?.boxCount;
  const sourceStateCount = playback?.sourceFrameCount * playback?.boxCount;
  const expectedModelId = playback?.bankId === "desktop" ? "cityflow"
    : playback?.bankId === "mobile" ? "cityflow-mobile" : null;
  const expectedBoxCount = playback?.bankId === "desktop" ? 200
    : playback?.bankId === "mobile" ? 100 : null;
  const expectedSideDepthDefault = playback?.bankId === "desktop" ? 0.1 : 0.28;
  const expectedSideDepthMaximum = 0.28;
  const expectedSideDepthOverrides = playback?.bankId === "desktop" ? 19 : 0;
  if (playback?.schema !== "csscityflow-prepared-playback@58" ||
      playback.precedent !== "domformat@0/polycss-playback@0@cc8da736" ||
      playback.modelId !== expectedModelId || playback.boxCount !== expectedBoxCount ||
      playback.catchUpPolicy !== "adjacent-state-late-deadline-reset" ||
      playback.frameCount !== 301 || playback.sourceFrameCount !== 251 ||
      playback.paletteSize !== 256 || playback.facesPerBox !== 3 ||
      playback.sideDepth?.schema !== "csscityflow-prepared-side-depth@1" ||
      playback.sideDepth.defaultDepthScale !== expectedSideDepthDefault ||
      playback.sideDepth.maximumDepthScale !== expectedSideDepthMaximum ||
      playback.sideDepth.overrideCount !== expectedSideDepthOverrides ||
      playback.staticVisibility?.schema !== "csscityflow-prepared-static-visibility@3" ||
      playback.staticVisibility.faceCount !== playback.boxCount * playback.facesPerBox ||
      playback.staticVisibility.visibleFaceCount + playback.staticVisibility.hiddenFaceCount !==
        playback.staticVisibility.faceCount ||
      playback.staticVisibility.visibleBoxCount + playback.staticVisibility.hiddenBoxCount !==
        playback.boxCount ||
      playback.staticVisibility.policy !==
        "prepared-whole-box-visibility-no-face-culling" ||
      playback.staticVisibility.presentation?.schema !==
        "csscityflow-prepared-presentation-box-visibility@1" ||
      playback.staticVisibility.presentation.frameCount !== playback.frameCount ||
      playback.staticVisibility.presentation.boxCount !== playback.boxCount ||
      playback.staticVisibility.presentation.faceCount !==
        playback.boxCount * playback.facesPerBox ||
      !Number.isSafeInteger(playback.staticVisibility.presentation.transitionDilationFrames) ||
      playback.staticVisibility.presentation.transitionDilationFrames < 0 ||
      playback.staticVisibility.presentation.initialVisibleCount !==
        playback.staticVisibility.presentation.initialVisibleBoxes * playback.facesPerBox ||
      playback.staticVisibility.presentation.minimumVisibleFaces !==
        playback.staticVisibility.presentation.minimumVisibleBoxes * playback.facesPerBox ||
      playback.staticVisibility.presentation.maximumVisibleFaces !==
        playback.staticVisibility.presentation.maximumVisibleBoxes * playback.facesPerBox ||
      playback.staticVisibility.presentation.minimumVisibleBoxes < 1 ||
      playback.staticVisibility.presentation.maximumVisibleBoxes > playback.boxCount ||
      !Number.isSafeInteger(playback.staticVisibility.presentation.transitionCount) ||
      playback.staticVisibility.presentation.transitionCount < 0 ||
      !Number.isSafeInteger(playback.staticVisibility.presentation.maximumTransitionWritesPerFrame) ||
      playback.staticVisibility.presentation.maximumTransitionWritesPerFrame < 0 ||
      typeof playback.staticVisibility.presentation.policy !== "string" ||
      playback.tickIntervalUs?.[0] !== 50_000 || playback.tickIntervalUs?.[1] !== 3 ||
      playback.sourceTickIntervalUs?.[0] !== 20_000 ||
      playback.sourceTickIntervalUs?.[1] !== 1 ||
      playback.presentation?.kind !== "prepared-periodic-source-sample-reconstruction" ||
      playback.presentation.sourceFramesPerSecond !== 50 ||
      playback.presentation.framesPerSecond !== 60 ||
      playback.presentation.exactSourceStateSeek !== true ||
      playback.presentation.heightInterpolation !==
        "periodic-uniform-cubic-b-spline-c2-source-approximation" ||
      playback.presentation.temporalFilter !==
        "prepared-periodic-five-tap-fold-twelve-three-tap-refold-twelve-five-tap-refold-twelve-adaptive-smooth-sine-eased-extrema@1" ||
      playback.presentation.directionRunSuppression !==
        "prepared-circular-twelve-frame-or-short-direction-run-folding-zero-sum-adaptive-smooth-sine-24-54-0.6-eased@1" ||
      playback.presentation.colorInterpolation !==
        "prepared-srgb-interpolated-final-face-color" ||
      playback.presentation.transformPublication !==
        "prepared-packed-transform-components-expanded-once-plus-sparse-final-face-color-and-whole-box-leaf-visibility-publication" ||
      playback.presentation.statePublication?.schema !==
        "csscityflow-prepared-state-publication@22" ||
      playback.presentation.statePublication.frameCount !== playback.frameCount ||
      playback.presentation.statePublication.animationCount !== 0 ||
      playback.presentation.statePublication.runtimeFormatting !== false ||
      playback.presentation.statePublication.loadTimeAssembly !==
        "one-time-prepared-transform-component-table-expansion" ||
      playback.presentation.statePublication.sourceSeekAssembly !==
        "none-cached-expanded-transform-and-final-face-color-dictionaries" ||
      playback.presentation.statePublication.atomicProperties !==
        "prepared-root-transform-plus-direct-leaf-visibility-and-final-face-background-color" ||
      playback.presentation.statePublication.minimumShapeStyleWritesPerScheduledTick !==
        0 ||
      playback.presentation.statePublication.maximumShapeStyleWritesPerScheduledTick !==
        playback.staticVisibility.presentation.maximumVisibleBoxes ||
      playback.presentation.statePublication.maximumLeafColorStyleWritesPerScheduledTick !==
        playback.colors?.presentationTransitions?.maximumWritesPerFrame ||
      playback.presentation.statePublication.maximumVisibilityStyleWritesPerScheduledTick !==
        playback.staticVisibility.presentation.maximumTransitionWritesPerFrame *
          playback.facesPerBox ||
      playback.transforms !== undefined ||
      playback.transformTable?.schema !== "csscityflow-prepared-transform-table@1" ||
      playback.transformTable.count < playback.boxCount ||
      playback.transformIndices?.schema !== "csscityflow-prepared-transform-indices@2" ||
      playback.transformIndices.encoding !== "per-box-u16le-base64-plus-transform-offsets" ||
      playback.transformIndices.count !== stateCount ||
      playback.transformIndices.sourceCount !== sourceStateCount ||
      !validTransformOffsets(playback.transformIndices.transformOffsets,
        playback.boxCount, playback.transformTable.count) ||
      typeof playback.transformIndices.presentationBase64 !== "string" ||
      typeof playback.transformIndices.sourceBase64 !== "string" ||
      playback.colors?.schema !== "csscityflow-prepared-face-local-materials@7" ||
      playback.colors.encoding !==
        "prepared-three-final-color-tuples-plus-packed-absolute-indices-and-sparse-presentation-transitions" ||
      !Array.isArray(playback.colors.materials) || playback.colors.materials.length < 1 ||
      playback.colors.materials.some((material) => !Array.isArray(material) ||
        material.length !== playback.facesPerBox ||
        material.some((color) => typeof color !== "string" || !COLOR_PATTERN.test(color))) ||
      typeof playback.colors.presentationMaterialIndicesBase64 !== "string" ||
      typeof playback.colors.sourceMaterialIndicesBase64 !== "string" ||
      playback.colors.presentationTransitions?.schema !==
        "csscityflow-prepared-face-color-transitions@2" ||
      playback.colors.presentationTransitions.encoding !==
        "final-color-dictionary-plus-u32le-target-frame-offsets-and-u16le-face-and-color-indices" ||
      playback.colors.presentationTransitions.frameCount !== playback.frameCount ||
      playback.colors.presentationTransitions.faceCount !==
        playback.boxCount * playback.facesPerBox ||
      !Number.isSafeInteger(playback.colors.presentationTransitions.transitionCount) ||
      playback.colors.presentationTransitions.transitionCount < 1 ||
      !Number.isSafeInteger(playback.colors.presentationTransitions.maximumWritesPerFrame) ||
      playback.colors.presentationTransitions.maximumWritesPerFrame < 1 ||
      !Array.isArray(playback.colors.presentationTransitions.colors) ||
      playback.colors.presentationTransitions.colors.length < 1 ||
      playback.colors.presentationTransitions.colors.some((color) =>
        typeof color !== "string" || !COLOR_PATTERN.test(color)) ||
      typeof playback.colors.presentationTransitions.offsetsBase64 !== "string" ||
      typeof playback.colors.presentationTransitions.faceIndicesBase64 !== "string" ||
      typeof playback.colors.presentationTransitions.colorIndicesBase64 !== "string" ||
      (playback.diagnostics?.visibility?.bankId !== undefined &&
        playback.diagnostics.visibility.bankId !== playback.bankId) ||
      playback.diagnostics?.productPolicy !==
        "diagnostic-only-never-consumed-by-product-playback" ||
      playback.loop?.kind !== "prepared-periodic-source-sample-reconstruction" ||
      playback.loop.exactSourceLoop !== false ||
      playback.loop.presentationPeriodFrames !== playback.frameCount ||
      playback.loop.closureContinuity !==
        "periodic-zero-sum-twelve-frame-direction-run-folded-adaptive-smooth-sine-eased-sample-cycle") {
    throw new Error("Cityflow prepared playback packet drifted");
  }
  const cached = decodedPackets.get(playback);
  if (cached) return cached;
  const staticVisibility = decodeStaticVisibility(
    playback.staticVisibility,
    playback.boxCount,
    playback.facesPerBox,
  );
  const transforms = expandCityflowPreparedTransforms(
    playback.transformTable,
    playback.transformIndices.transformOffsets,
  );
  const presentationTransformIndices = decodeUint16(playback.transformIndices.presentationBase64);
  const sourceTransformIndices = decodeUint16(playback.transformIndices.sourceBase64);
  const presentationMaterialIndices =
    decodeUint16(playback.colors.presentationMaterialIndicesBase64);
  const sourceMaterialIndices = decodeUint16(playback.colors.sourceMaterialIndicesBase64);
  const presentationColorTransitionOffsets =
    decodeUint32(playback.colors.presentationTransitions.offsetsBase64);
  const presentationColorTransitionFaceIndices =
    decodeUint16(playback.colors.presentationTransitions.faceIndicesBase64);
  const presentationColorTransitionColorIndices =
    decodeUint16(playback.colors.presentationTransitions.colorIndicesBase64);
  if (presentationTransformIndices.length !== stateCount ||
      sourceTransformIndices.length !== sourceStateCount ||
      !validMaterialIndices(presentationMaterialIndices, stateCount,
        playback.colors.materials.length) ||
      !validMaterialIndices(sourceMaterialIndices, sourceStateCount,
        playback.colors.materials.length) ||
      !validPerBoxTransformIndices(presentationTransformIndices, playback.frameCount,
        playback.boxCount, playback.transformIndices.transformOffsets) ||
      !validPerBoxTransformIndices(sourceTransformIndices, playback.sourceFrameCount,
        playback.boxCount, playback.transformIndices.transformOffsets) ||
      !validColorTransitions({
        offsets: presentationColorTransitionOffsets,
        faceIndices: presentationColorTransitionFaceIndices,
        colorIndices: presentationColorTransitionColorIndices,
        frameCount: playback.frameCount,
        faceCount: playback.boxCount * playback.facesPerBox,
        colorCount: playback.colors.presentationTransitions.colors.length,
        transitionCount: playback.colors.presentationTransitions.transitionCount,
        maximumWritesPerFrame: playback.colors.presentationTransitions.maximumWritesPerFrame,
      })) {
    throw new Error("Cityflow prepared state tables drifted");
  }
  const decoded = Object.freeze({
    transforms,
    presentationTransformIndices,
    sourceTransformIndices,
    presentationMaterialIndices,
    sourceMaterialIndices,
    presentationColorTransitionOffsets,
    presentationColorTransitionFaceIndices,
    presentationColorTransitionColorIndices,
    presentationBoxVisibilityRows: staticVisibility.presentationBoxVisibilityRows,
    presentationBoxVisibilityOffsets: staticVisibility.presentationBoxVisibilityOffsets,
    presentationBoxVisibilityIndices: staticVisibility.presentationBoxVisibilityIndices,
  });
  decodedPackets.set(playback, decoded);
  return decoded;
}

function decodeStaticVisibility(value, boxCount, facesPerBox) {
  const hiddenFaceIndices = value?.hiddenFaceIndices;
  const hiddenBoxIndices = value?.hiddenBoxIndices;
  const presentation = value?.presentation;
  if (!Array.isArray(hiddenFaceIndices) ||
      hiddenFaceIndices.length !== value.hiddenFaceCount ||
      !Array.isArray(hiddenBoxIndices) ||
      hiddenBoxIndices.length !== value.hiddenBoxCount ||
      hiddenFaceIndices.some((faceIndex, index) =>
        !Number.isSafeInteger(faceIndex) || faceIndex < 0 || faceIndex >= boxCount * facesPerBox ||
        (index > 0 && faceIndex <= hiddenFaceIndices[index - 1])) ||
      hiddenBoxIndices.some((boxIndex, index) =>
        !Number.isSafeInteger(boxIndex) || boxIndex < 0 || boxIndex >= boxCount ||
        (index > 0 && boxIndex <= hiddenBoxIndices[index - 1])) ||
      presentation?.encoding !==
        "initial-box-bitset-plus-u16le-per-target-frame-toggle-offsets-and-box-indices" ||
      !Array.isArray(presentation.alwaysVisibleBoxIndices) ||
      presentation.alwaysVisibleBoxIndices.some((boxIndex, index) =>
        !Number.isSafeInteger(boxIndex) || boxIndex < 0 || boxIndex >= boxCount ||
        (index > 0 && boxIndex <= presentation.alwaysVisibleBoxIndices[index - 1])) ||
      typeof presentation.initialVisibleBoxBitsBase64 !== "string" ||
      typeof presentation.transitionOffsetsBase64 !== "string" ||
      typeof presentation.transitionBoxIndicesBase64 !== "string") {
    throw new Error("Cityflow prepared static visibility drifted");
  }
  const hiddenFaceMask = new Uint8Array(boxCount * facesPerBox);
  for (const faceIndex of hiddenFaceIndices) hiddenFaceMask[faceIndex] = 1;
  const computedHiddenBoxIndices = Array.from({ length: boxCount }, (_, boxIndex) => boxIndex)
    .filter((boxIndex) => Array.from({ length: facesPerBox }, (_, faceIndex) =>
      hiddenFaceMask[boxIndex * facesPerBox + faceIndex]).every(Boolean));
  if (computedHiddenBoxIndices.length !== hiddenBoxIndices.length ||
      computedHiddenBoxIndices.some((boxIndex, index) => boxIndex !== hiddenBoxIndices[index])) {
    throw new Error("Cityflow prepared static hidden-box visibility drifted");
  }
  const decoded = decodePresentationVisibility(presentation, boxCount, facesPerBox);
  const rows = decoded.presentationBoxVisibilityRows;
  const visibleBoxCounts = rows.map((row) => row.reduce((sum, visible) => sum + visible, 0));
  const computedAlwaysVisibleBoxIndices = Array.from({ length: boxCount }, (_, boxIndex) => boxIndex)
    .filter((boxIndex) => rows.every((row) => row[boxIndex] !== 0));
  const computedHiddenPresentationBoxIndices =
    Array.from({ length: boxCount }, (_, boxIndex) => boxIndex)
      .filter((boxIndex) => rows.every((row) => row[boxIndex] === 0));
  const computedMinimumVisibleBoxes = Math.min(...visibleBoxCounts);
  const computedMaximumVisibleBoxes = Math.max(...visibleBoxCounts);
  const computedMeanVisibleBoxes = visibleBoxCounts.reduce((sum, count) => sum + count, 0) /
    visibleBoxCounts.length;
  if (visibleBoxCounts[0] !== presentation.initialVisibleBoxes ||
      presentation.initialVisibleCount !== visibleBoxCounts[0] * facesPerBox ||
      computedMinimumVisibleBoxes !== presentation.minimumVisibleBoxes ||
      computedMaximumVisibleBoxes !== presentation.maximumVisibleBoxes ||
      computedMinimumVisibleBoxes * facesPerBox !== presentation.minimumVisibleFaces ||
      computedMaximumVisibleBoxes * facesPerBox !== presentation.maximumVisibleFaces ||
      Math.abs(computedMeanVisibleBoxes - presentation.meanVisibleBoxes) > Number.EPSILON ||
      Math.abs(computedMeanVisibleBoxes * facesPerBox - presentation.meanVisibleFaces) >
        Number.EPSILON * facesPerBox ||
      computedAlwaysVisibleBoxIndices.length !== presentation.alwaysVisibleBoxIndices.length ||
      computedAlwaysVisibleBoxIndices.some((boxIndex, index) =>
        boxIndex !== presentation.alwaysVisibleBoxIndices[index]) ||
      computedHiddenPresentationBoxIndices.length !== hiddenBoxIndices.length ||
      computedHiddenPresentationBoxIndices.some((boxIndex, index) =>
        boxIndex !== hiddenBoxIndices[index]) ||
      value.visibleBoxCount !== boxCount - hiddenBoxIndices.length ||
      value.visibleFaceCount !== value.visibleBoxCount * facesPerBox) {
    throw new Error("Cityflow prepared static visibility metrics drifted");
  }
  return Object.freeze(decoded);
}

function decodePresentationVisibility(presentation, boxCount, facesPerBox) {
  const initial = decodeUint8(presentation.initialVisibleBoxBitsBase64);
  const presentationBoxVisibilityOffsets = decodeUint16(presentation.transitionOffsetsBase64);
  const presentationBoxVisibilityIndices = decodeUint16(presentation.transitionBoxIndicesBase64);
  if (initial.length !== Math.ceil(boxCount / 8) ||
      presentationBoxVisibilityOffsets.length !== presentation.frameCount + 1 ||
      presentationBoxVisibilityOffsets[0] !== 0 ||
      presentationBoxVisibilityOffsets.at(-1) !== presentationBoxVisibilityIndices.length ||
      presentationBoxVisibilityIndices.length !== presentation.transitionCount ||
      presentationBoxVisibilityIndices.some((boxIndex) => boxIndex >= boxCount) ||
      Array.from(presentationBoxVisibilityOffsets).some((offset, index, offsets) =>
        index > 0 && offset < offsets[index - 1])) {
    throw new Error("Cityflow prepared presentation visibility encoding drifted");
  }
  const visible = Uint8Array.from({ length: boxCount }, (_, boxIndex) =>
    initial[boxIndex >> 3] >> (boxIndex & 7) & 1);
  const presentationBoxVisibilityRows = [visible.slice()];
  for (let frameIndex = 1; frameIndex < presentation.frameCount; frameIndex += 1) {
    for (let cursor = presentationBoxVisibilityOffsets[frameIndex];
      cursor < presentationBoxVisibilityOffsets[frameIndex + 1]; cursor += 1) {
      visible[presentationBoxVisibilityIndices[cursor]] ^= 1;
    }
    presentationBoxVisibilityRows.push(visible.slice());
  }
  let computedMaximumTransitionWritesPerFrame = 0;
  for (let frameIndex = 0; frameIndex < presentation.frameCount; frameIndex += 1) {
    const start = presentationBoxVisibilityOffsets[frameIndex];
    const end = presentationBoxVisibilityOffsets[frameIndex + 1];
    computedMaximumTransitionWritesPerFrame = Math.max(
      computedMaximumTransitionWritesPerFrame,
      end - start,
    );
    const toggled = new Set(presentationBoxVisibilityIndices.slice(start, end));
    if (toggled.size !== end - start) {
      throw new Error("Cityflow prepared presentation visibility toggles drifted");
    }
  }
  if (computedMaximumTransitionWritesPerFrame !==
      presentation.maximumTransitionWritesPerFrame) {
    throw new Error("Cityflow prepared presentation visibility metrics drifted");
  }
  return {
    presentationBoxVisibilityRows: Object.freeze(presentationBoxVisibilityRows),
    presentationBoxVisibilityOffsets,
    presentationBoxVisibilityIndices,
  };
}

function validMaterialIndices(values, count, materialCount) {
  return values instanceof Uint16Array && values.length === count && values.every((value) =>
    Number.isSafeInteger(value) && value >= 0 && value < materialCount);
}

function validTransformOffsets(offsets, boxCount, transformCount) {
  return Array.isArray(offsets) && offsets.length === boxCount + 1 && offsets[0] === 0 &&
    offsets.at(-1) === transformCount && offsets.every((offset, index) =>
      Number.isSafeInteger(offset) && offset >= 0 &&
      (index === 0 || offset > offsets[index - 1]));
}

function validPerBoxTransformIndices(values, frameCount, boxCount, offsets) {
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
      if (values[frameIndex * boxCount + boxIndex] >= offsets[boxIndex + 1] - offsets[boxIndex]) {
        return false;
      }
    }
  }
  return true;
}

function validColorTransitions({
  offsets,
  faceIndices,
  colorIndices,
  frameCount,
  faceCount,
  colorCount,
  transitionCount,
  maximumWritesPerFrame,
}) {
  if (!(offsets instanceof Uint32Array) || offsets.length !== frameCount + 1 ||
      offsets[0] !== 0 || offsets.at(-1) !== transitionCount ||
      !(faceIndices instanceof Uint16Array) || faceIndices.length !== transitionCount ||
      !(colorIndices instanceof Uint16Array) || colorIndices.length !== transitionCount ||
      faceIndices.some((faceIndex) => faceIndex >= faceCount) ||
      colorIndices.some((colorIndex) => colorIndex >= colorCount)) {
    return false;
  }
  let computedMaximum = 0;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    if (offsets[frameIndex + 1] < offsets[frameIndex]) return false;
    computedMaximum = Math.max(
      computedMaximum,
      offsets[frameIndex + 1] - offsets[frameIndex],
    );
  }
  return computedMaximum === maximumWritesPerFrame;
}

function decodeUint8(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeUint16(value) {
  const bytes = decodeUint8(value);
  if (bytes.byteLength % Uint16Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("Cityflow uint16 playback table is truncated");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Uint16Array(bytes.byteLength / Uint16Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getUint16(index * Uint16Array.BYTES_PER_ELEMENT, true);
  }
  return values;
}

function decodeUint32(value) {
  const bytes = decodeUint8(value);
  if (bytes.byteLength % Uint32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("Cityflow uint32 playback table is truncated");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Uint32Array(bytes.byteLength / Uint32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getUint32(index * Uint32Array.BYTES_PER_ELEMENT, true);
  }
  return values;
}
