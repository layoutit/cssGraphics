// SPDX-License-Identifier: GPL-2.0-or-later
import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";
import {
  CSSCYCLONE_LIGHTING_BLOCK_SCHEMA,
  CSSCYCLONE_PLAYBACK_SCHEMA,
} from "../shared/csscyclone/preparedBlockTransport.mjs";

const CATALOG_SCHEMA = "csscyclone-prepared-stream-catalog@1";
const BLOCK_SCHEMA = "csscyclone-prepared-stream-block@2";
const LIGHTING_SCHEMA = "csscyclone-prepared-smooth-lighting-atlas@7";
const SOURCE_FIELD_OF_VIEW_DEGREES = 80;
const MOBILE_FIELD_OF_VIEW_DEGREES = 90;
const MOBILE_MAX_WIDTH = 600;

export function resolveCyclonePerspective(viewportWidth, viewportHeight) {
  const fieldOfViewDegrees = viewportWidth < MOBILE_MAX_WIDTH
    ? MOBILE_FIELD_OF_VIEW_DEGREES
    : SOURCE_FIELD_OF_VIEW_DEGREES;
  const perspective = viewportHeight / (2 * Math.tan(fieldOfViewDegrees * Math.PI / 360));
  return Number(perspective.toFixed(4));
}

export function createCyclonePreparedPlayer({
  mounted,
  modelTransform,
  catalog,
  initialBlock,
  initialLookaheadBlocks = [],
  initialFrameIndex,
  lighting,
  lightingAsset,
  loadBlock,
  onBlockWindow = () => undefined,
  onError = () => undefined,
  readNow = () => performance.now(),
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (frame) => cancelAnimationFrame(frame),
  requestDelay = (callback, delay) => setTimeout(callback, delay),
  cancelDelay = (delay) => clearTimeout(delay),
}) {
  validateBinding(
    mounted,
    modelTransform,
    catalog,
    initialBlock,
    initialLookaheadBlocks,
    initialFrameIndex,
    lighting,
    lightingAsset,
    loadBlock,
  );
  const shapeElements = mounted.model.render.shapes.map((shape) => mounted.shapeElements.get(shape.id));
  const leafElements = mounted.model.render.leaves.map((leaf) => mounted.leafHandles.get(leaf.id)?.element);
  if (shapeElements.some((element) => !element) || leafElements.some((element) => !element)) {
    throw new Error("Cyclone retained DOM binding is incomplete");
  }
  let publishedModelTransform = modelTransform;
  let publishedProjectionTransform = mounted.sceneElement.style.transform;
  let publishedSceneTransform = "";
  const publishSceneTransform = () => {
    const transform = `${publishedProjectionTransform} ${publishedModelTransform}`.trim();
    if (transform === publishedSceneTransform) return false;
    mounted.sceneElement.style.transform = transform;
    publishedSceneTransform = transform;
    return true;
  };
  publishSceneTransform();
  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: mounted.sceneElement,
      writeTransform(transform) {
        if (transform === publishedModelTransform) return false;
        publishedModelTransform = transform;
        return publishSceneTransform();
      },
    },
    shapes: shapeElements.map((element) => ({ element })),
    leaves: leafElements.map((element) => ({ element })),
  });
  mounted.sceneElement.style.setProperty(
    "--cyclone-lighting-atlas",
    `url("${lightingAsset.url.replace(/"/gu, "%22")}")`,
  );
  mounted.sceneElement.style.setProperty("--cyclone-lighting-size", lighting.backgroundSize);

  let activeBlock = initialBlock;
  let playback = activeBlock.playback;
  let lightingFrames = activeBlock.lighting;
  let activeBlockIndex = activeBlock.streamBlockIndex;
  const pendingBlocks = new Map(initialLookaheadBlocks.map((block) => [
    block.streamBlockIndex,
    { block, promise: Promise.resolve(block), error: null },
  ]));
  let paused = true;
  let destroyed = false;
  let frameRequest = null;
  let delayRequest = null;
  let clockOrigin = readNow() - initialFrameIndex * playback.frameMilliseconds;
  let pausedAt = initialFrameIndex * playback.frameMilliseconds;
  let frameIndex = initialFrameIndex;
  const schedulerLeadMilliseconds = Math.min(4, playback.frameMilliseconds / 4);
  let schedulerFrameRequestCount = 0;
  let schedulerFrameCallbackCount = 0;
  let schedulerFrameCancelCount = 0;
  let schedulerDelayRequestCount = 0;
  let schedulerDelayCallbackCount = 0;
  let schedulerDelayCancelCount = 0;
  let collapsedFrameCount = 0;
  let applyCount = 0;
  let shapeTransformWrites = 0;
  let lightingLeafAddressWrites = 0;
  let preparedChunkSwitchCount = 0;
  let preparedBlockSwitchCount = 0;
  let preparedBlockPrefetchCount = initialLookaheadBlocks.length;
  let runtimePreparedBlockWaitCount = 0;
  let preparedContinuousHandoffCount = 0;
  let preparedTerminalWrapCount = 0;
  const lightingRowWrites = 0;
  const lightingLeafBindingWrites = leafElements.length;
  let currentParticleColorStateIndices = [];

  publishTransforms(initialFrameIndex);
  publishLighting(initialFrameIndex, true);
  applyCount += 1;
  queueLookaheadBlocks();

  function publishTransforms(nextFrameIndex) {
    const frameOffset = nextFrameIndex * playback.particleCount;
    for (let particleIndex = 0; particleIndex < playback.particleCount; particleIndex += 1) {
      shapeTransformWrites += Number(target.shapes[particleIndex].writeTransform(
        playback.transforms[frameOffset + particleIndex],
      ));
    }
  }

  function publishLighting(nextFrameIndex, force = false) {
    const frameOffset = nextFrameIndex * playback.particleCount;
    for (let particleIndex = 0; particleIndex < playback.particleCount; particleIndex += 1) {
      const nextStateIndex = lightingFrames.frameParticleColorStateIndices[frameOffset + particleIndex];
      if (!force && nextStateIndex === currentParticleColorStateIndices[particleIndex]) continue;
      const leafOffset = particleIndex * lighting.facesPerParticle;
      const tileOffset = nextStateIndex * lighting.facesPerParticle;
      for (let faceIndex = 0; faceIndex < lighting.facesPerParticle; faceIndex += 1) {
        leafElements[leafOffset + faceIndex].style.backgroundPosition =
          lighting.tileBackgroundPositions[tileOffset + faceIndex];
        if (!force) lightingLeafAddressWrites += 1;
      }
      currentParticleColorStateIndices[particleIndex] = nextStateIndex;
    }
  }

  function advanceTo(nextFrameIndex) {
    if (frameIndex === nextFrameIndex) return;
    const distance = nextFrameIndex - frameIndex;
    if (distance < 1) throw new RangeError("Cyclone cannot rewind across a prepared block boundary");
    publishTransforms(nextFrameIndex);
    publishLighting(nextFrameIndex);
    if (distance > 1) collapsedFrameCount += distance - 1;
    frameIndex = nextFrameIndex;
    applyCount += 1;
  }

  function lookaheadBlockIndices() {
    const indices = [];
    for (let offset = 1; offset <= catalog.runtimeLookaheadBlockCount; offset += 1) {
      const index = (activeBlockIndex + offset) % catalog.blockCount;
      if (!indices.includes(index)) indices.push(index);
    }
    return indices;
  }

  function queueLookaheadBlocks() {
    if (destroyed) return;
    const indices = lookaheadBlockIndices();
    const retainedIndices = new Set(indices);
    onBlockWindow([activeBlockIndex, ...indices]);
    for (const index of pendingBlocks.keys()) {
      if (!retainedIndices.has(index)) pendingBlocks.delete(index);
    }
    for (const index of indices) {
      if (pendingBlocks.has(index)) continue;
      const pending = { block: null, promise: null, error: null };
      preparedBlockPrefetchCount += 1;
      pending.promise = Promise.resolve(loadBlock(index)).then((block) => {
        if (destroyed || pendingBlocks.get(index) !== pending) return null;
        validateBlockBinding(block, catalog, mounted.model, lighting);
        pending.block = block;
        return block;
      }).catch((error) => {
        if (pendingBlocks.get(index) === pending) pending.error = error;
        onError(error);
        return null;
      });
      pendingBlocks.set(index, pending);
    }
  }

  async function activatePendingBlock() {
    const nextBlockIndex = (activeBlockIndex + 1) % catalog.blockCount;
    if (!pendingBlocks.has(nextBlockIndex)) queueLookaheadBlocks();
    const pending = pendingBlocks.get(nextBlockIndex);
    if (!pending) throw new Error(`Prepared Cyclone lookahead block ${nextBlockIndex} is unavailable`);
    const waited = pending.block === null;
    if (waited) {
      runtimePreparedBlockWaitCount += 1;
      if (pending.error) throw pending.error;
      await pending.promise;
    }
    if (!pending.block) {
      throw pending.error ?? new Error(`Prepared Cyclone lookahead block ${nextBlockIndex} is unavailable`);
    }
    const previousBlockIndex = activeBlockIndex;
    const previousChunkIndex = activeBlock.chunkIndex;
    activeBlock = pending.block;
    activeBlockIndex = nextBlockIndex;
    playback = activeBlock.playback;
    lightingFrames = activeBlock.lighting;
    pendingBlocks.delete(nextBlockIndex);
    frameIndex = 0;
    publishTransforms(0);
    publishLighting(0);
    applyCount += 1;
    preparedBlockSwitchCount += 1;
    if (activeBlockIndex === previousBlockIndex + 1) preparedContinuousHandoffCount += 1;
    else preparedTerminalWrapCount += 1;
    if (activeBlock.chunkIndex !== previousChunkIndex) preparedChunkSwitchCount += 1;
    queueLookaheadBlocks();
    return waited;
  }

  function requestPaintAlignedWake() {
    frameRequest = requestFrame(wake);
    schedulerFrameRequestCount += 1;
  }

  function schedule() {
    if (paused || destroyed || frameRequest !== null || delayRequest !== null) return;
    const elapsed = Math.max(0, readNow() - clockOrigin);
    const nextFrameTime = Math.min(playback.durationMilliseconds, (frameIndex + 1) * playback.frameMilliseconds);
    const waitMilliseconds = Math.max(0, nextFrameTime - elapsed - schedulerLeadMilliseconds);
    if (waitMilliseconds <= 1) {
      requestPaintAlignedWake();
      return;
    }
    delayRequest = requestDelay(() => {
      delayRequest = null;
      schedulerDelayCallbackCount += 1;
      if (!paused && !destroyed && frameRequest === null) requestPaintAlignedWake();
    }, waitMilliseconds);
    schedulerDelayRequestCount += 1;
  }

  async function wake() {
    frameRequest = null;
    if (paused || destroyed) return;
    schedulerFrameCallbackCount += 1;
    try {
      const elapsed = Math.max(0, readNow() - clockOrigin);
      const paintAlignedElapsed = elapsed + schedulerLeadMilliseconds;
      if (paintAlignedElapsed >= playback.durationMilliseconds) {
        const boundaryTime = clockOrigin + playback.durationMilliseconds;
        const waited = await activatePendingBlock();
        clockOrigin = waited ? readNow() : boundaryTime;
        pausedAt = 0;
      } else {
        advanceTo(Math.floor(paintAlignedElapsed / playback.frameMilliseconds));
      }
    } catch (error) {
      paused = true;
      onError(error);
      return;
    }
    schedule();
  }

  function pause() {
    if (paused || destroyed) return snapshot();
    pausedAt = Math.min(
      playback.durationMilliseconds,
      Math.max(0, readNow() - clockOrigin),
    );
    paused = true;
    if (frameRequest !== null) {
      cancelFrame(frameRequest);
      schedulerFrameCancelCount += 1;
    }
    frameRequest = null;
    if (delayRequest !== null) {
      cancelDelay(delayRequest);
      schedulerDelayCancelCount += 1;
    }
    delayRequest = null;
    return snapshot();
  }

  function resume() {
    if (!paused || destroyed) return snapshot();
    clockOrigin = readNow() - pausedAt;
    paused = false;
    schedule();
    return snapshot();
  }

  function seekFrame(nextFrameIndex) {
    if (!Number.isSafeInteger(nextFrameIndex) || nextFrameIndex < 0 || nextFrameIndex >= playback.frameCount) {
      throw new RangeError("Cyclone prepared frame is out of range");
    }
    const wasPaused = paused;
    if (!wasPaused) pause();
    if (nextFrameIndex !== frameIndex) {
      publishTransforms(nextFrameIndex);
      publishLighting(nextFrameIndex);
      frameIndex = nextFrameIndex;
      applyCount += 1;
    }
    pausedAt = nextFrameIndex * playback.frameMilliseconds;
    if (!wasPaused) resume();
    return snapshot();
  }

  function resize() {
    const perspective = resolveCyclonePerspective(innerWidth, innerHeight);
    mounted.cameraElement.style.perspective = `${perspective}px`;
    publishedProjectionTransform = `translateZ(${perspective}px)`;
    publishSceneTransform();
  }

  function snapshot() {
    target.assertStableDomIdentity();
    const pendingBlockIndices = lookaheadBlockIndices();
    const nextPendingBlock = pendingBlocks.get(pendingBlockIndices[0]);
    return Object.freeze({
      paused,
      frameIndex,
      streamFrameIndex: activeBlock.startFrameIndex + frameIndex,
      frameCount: playback.frameCount,
      streamFrameCount: catalog.streamFrameCount,
      frameMilliseconds: playback.frameMilliseconds,
      durationMilliseconds: playback.durationMilliseconds,
      streamDurationMilliseconds: catalog.streamDurationMilliseconds,
      activeBlockIndex,
      activeChunkIndex: activeBlock.chunkIndex,
      pendingBlockIndex: pendingBlockIndices[0] ?? null,
      pendingBlockReady: nextPendingBlock?.block !== null && nextPendingBlock?.block !== undefined,
      pendingBlockIndices: Object.freeze(pendingBlockIndices),
      pendingBlockReadyCount: pendingBlockIndices.filter((index) => pendingBlocks.get(index)?.block).length,
      schedulerLeadMilliseconds,
      schedulerFrameRequestCount,
      schedulerFrameCallbackCount,
      schedulerFrameCancelCount,
      schedulerDelayRequestCount,
      schedulerDelayCallbackCount,
      schedulerDelayCancelCount,
      runtimeSchedulerTransport: "deadline-setTimeout-requestAnimationFrame-prepared-publication",
      collapsedFrameCount,
      applyCount,
      shapeTransformWrites,
      lightingRowWrites,
      lightingLeafBindingWrites,
      lightingLeafAddressWrites,
      preparedChunkSwitchCount,
      preparedBlockSwitchCount,
      preparedBlockPrefetchCount,
      runtimePreparedBlockWaitCount,
      preparedContinuousHandoffCount,
      preparedTerminalWrapCount,
      preparedLightingAssetBytes: lightingAsset.byteLength,
      preparedLightingPaletteFamily: lightingAsset.paletteFamily,
      preparedLightingMaximumColorFamilyCount: lighting.maximumColorFamilyCount,
      preparedLightingColorStateCount: lighting.colorStateCount,
      preparedLightingColorRestartCount: lighting.colorRestartCount,
      runtimeGeometryConstructionCount: 0,
      runtimeAtlasRasterizationCount: 0,
      runtimeLightingCalculationCount: 0,
      runtimeLightingAtlasConstructionCount: 0,
      runtimeFrameMatrixFormattingCount: 0,
      runtimeIdLookupCount: 0,
      runtimeDomGrowth: false,
      retainedModelWrapperCount: 0,
      retainedDomStable: true,
    });
  }

  return Object.freeze({
    resize,
    pause,
    resume,
    seekFrame,
    stats: snapshot,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      paused = true;
      if (frameRequest !== null) cancelFrame(frameRequest);
      frameRequest = null;
      if (delayRequest !== null) cancelDelay(delayRequest);
      delayRequest = null;
      removeEventListener("resize", resize);
      target.destroy();
      mounted.destroy();
      lightingAsset.destroy();
    },
  });
}

function validateBinding(
  mounted,
  modelTransform,
  catalog,
  initialBlock,
  initialLookaheadBlocks,
  initialFrameIndex,
  lighting,
  lightingAsset,
  loadBlock,
) {
  const lightingVariant = lighting?.variants?.find((variant) =>
    variant?.paletteFamily === lightingAsset?.paletteFamily);
  if (typeof modelTransform !== "string" || !modelTransform.startsWith("matrix3d(") ||
      catalog?.schema !== CATALOG_SCHEMA ||
      catalog.blockCount !== catalog.entries?.length ||
      !Number.isSafeInteger(catalog.runtimeLookaheadBlockCount) ||
      catalog.runtimeLookaheadBlockCount < 1 ||
      catalog.runtimeLookaheadBlockCount > catalog.blockCount ||
      !Array.isArray(initialLookaheadBlocks) ||
      initialLookaheadBlocks.length > catalog.runtimeLookaheadBlockCount ||
      new Set(initialLookaheadBlocks.map((block) => block?.streamBlockIndex)).size !==
        initialLookaheadBlocks.length ||
      initialLookaheadBlocks.some((block, index) =>
        block?.streamBlockIndex !== (initialBlock.streamBlockIndex + index + 1) % catalog.blockCount) ||
      lighting?.schema !== LIGHTING_SCHEMA ||
      lighting.streamId !== catalog.streamId ||
      lighting.chunkCount !== catalog.chunkCount ||
      lighting.chunkFrameCount !== catalog.chunkFrameCount ||
      lighting.leafCount !== mounted.model.render.leaves.length ||
      lighting.facesPerParticle * mounted.model.render.shapes.length !== lighting.leafCount ||
      lighting.tileBackgroundPositions?.length !== lighting.tileCount ||
      lighting.maximumColorFamilyCount !== 3 ||
      lighting.paletteHueSlotCount !== 3 ||
      lightingAsset?.hueSlots?.length !== lighting.maximumColorFamilyCount ||
      lighting.runtime?.lightingCalculations !== 0 ||
      lighting.runtime?.atlasConstruction !== 0 ||
      lightingAsset?.sha256 !== lightingVariant?.assetSha256 ||
      typeof loadBlock !== "function" ||
      !Number.isSafeInteger(initialFrameIndex) || initialFrameIndex < 0 ||
      initialFrameIndex >= catalog.blockFrameCount) {
    throw new Error("Cyclone prepared stream binding drifted");
  }
  validateBlockBinding(initialBlock, catalog, mounted.model, lighting);
  for (const block of initialLookaheadBlocks) {
    validateBlockBinding(block, catalog, mounted.model, lighting);
  }
}

function validateBlockBinding(block, catalog, model, lighting) {
  const playback = block?.playback;
  const lightingFrames = block?.lighting;
  if (block?.schema !== BLOCK_SCHEMA ||
      block.streamId !== catalog.streamId ||
      !Number.isSafeInteger(block.streamBlockIndex) || block.streamBlockIndex < 0 ||
      block.streamBlockIndex >= catalog.blockCount ||
      block.chunkIndex !== Math.floor(block.streamBlockIndex / catalog.blocksPerChunk) ||
      block.blockIndex !== block.streamBlockIndex % catalog.blocksPerChunk ||
      block.startFrameIndex !== block.streamBlockIndex * catalog.blockFrameCount ||
      block.frameCount !== catalog.blockFrameCount ||
      playback?.schema !== CSSCYCLONE_PLAYBACK_SCHEMA ||
      playback.modelId !== model.identity.id ||
      playback.streamId !== catalog.streamId ||
      playback.streamBlockIndex !== block.streamBlockIndex ||
      playback.chunkIndex !== block.chunkIndex ||
      playback.blockIndex !== block.blockIndex ||
      playback.chunkCount !== catalog.chunkCount ||
      playback.blockCount !== catalog.blockCount ||
      playback.blocksPerChunk !== catalog.blocksPerChunk ||
      playback.startFrameIndex !== block.startFrameIndex ||
      playback.frameCount !== block.frameCount ||
      playback.particleCount !== model.render.shapes.length ||
      playback.leafCount !== model.render.leaves.length ||
      playback.transforms?.length !== playback.frameCount * playback.particleCount ||
      playback.transforms.some((transform) => typeof transform !== "string") ||
      lightingFrames?.schema !== CSSCYCLONE_LIGHTING_BLOCK_SCHEMA ||
      lightingFrames.streamId !== catalog.streamId ||
      lightingFrames.streamBlockIndex !== block.streamBlockIndex ||
      lightingFrames.chunkIndex !== block.chunkIndex ||
      lightingFrames.blockIndex !== block.blockIndex ||
      lightingFrames.startFrameIndex !== block.startFrameIndex ||
      lightingFrames.frameCount !== playback.frameCount ||
      lightingFrames.particleCount !== playback.particleCount ||
      !(lightingFrames.frameParticleColorStateIndices instanceof Uint16Array) ||
      lightingFrames.frameParticleColorStateIndices.length !== playback.frameCount * playback.particleCount ||
      lightingFrames.frameParticleColorStateIndices.some((stateIndex) =>
        stateIndex < 0 || stateIndex >= lighting.colorStateCount)) {
    throw new Error(`Cyclone prepared block ${block?.streamBlockIndex ?? "unknown"} binding drifted`);
  }
}
