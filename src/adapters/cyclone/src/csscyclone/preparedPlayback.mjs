// SPDX-License-Identifier: GPL-2.0-or-later
import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

const CATALOG_SCHEMA = "csscyclone-prepared-stream-catalog@1";
const BLOCK_SCHEMA = "csscyclone-prepared-stream-block@1";
const PLAYBACK_SCHEMA = "csscyclone-prepared-dom-playback@3";
const LIGHTING_SCHEMA = "csscyclone-prepared-smooth-lighting-atlas@4";
const LIGHTING_BLOCK_SCHEMA = "csscyclone-prepared-lighting-block@1";
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
  catalog,
  initialBlock,
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
  validateBinding(mounted, catalog, initialBlock, initialFrameIndex, lighting, lightingAsset, loadBlock);
  const shapeElements = mounted.model.render.shapes.map((shape) => mounted.shapeElements.get(shape.id));
  const leafElements = mounted.model.render.leaves.map((leaf) => mounted.leafHandles.get(leaf.id)?.element);
  if (shapeElements.some((element) => !element) || leafElements.some((element) => !element)) {
    throw new Error("Cyclone retained DOM binding is incomplete");
  }
  let publishedModelTransform = mounted.modelElement.style.transform;
  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: mounted.modelElement,
      writeTransform(transform) {
        if (transform === publishedModelTransform) return false;
        mounted.modelElement.style.transform = transform;
        publishedModelTransform = transform;
        return true;
      },
    },
    shapes: shapeElements.map((element) => ({ element })),
    leaves: leafElements.map((element) => ({ element })),
  });
  mounted.modelElement.style.setProperty(
    "--cyclone-lighting-atlas",
    `url("${lightingAsset.url.replace(/"/gu, "%22")}")`,
  );
  mounted.modelElement.style.setProperty("--cyclone-lighting-size", lighting.backgroundSize);

  let activeBlock = initialBlock;
  let playback = activeBlock.playback;
  let lightingFrames = activeBlock.lighting;
  let activeBlockIndex = activeBlock.streamBlockIndex;
  let pendingBlock = null;
  let pendingBlockIndex = null;
  let pendingBlockPromise = null;
  let pendingBlockError = null;
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
  let preparedBlockPrefetchCount = 0;
  let runtimePreparedBlockWaitCount = 0;
  let preparedContinuousHandoffCount = 0;
  let preparedTerminalWrapCount = 0;
  const lightingRowWrites = 0;
  const lightingLeafBindingWrites = leafElements.length;
  let currentParticleColorStateIndices = [];

  publishTransforms(playback.frames[initialFrameIndex]);
  publishLighting(initialFrameIndex, true);
  applyCount += 1;
  queueNextBlock();

  function publishTransforms(row) {
    for (let operation = 0; operation < row.length; operation += 2) {
      const particleIndex = row[operation];
      const transformIndex = row[operation + 1];
      shapeTransformWrites += Number(target.shapes[particleIndex].writeTransform(playback.transforms[transformIndex]));
    }
  }

  function publishLighting(nextFrameIndex, force = false) {
    const nextStateIndices = lightingFrames.frameParticleColorStateIndices[nextFrameIndex];
    for (let particleIndex = 0; particleIndex < nextStateIndices.length; particleIndex += 1) {
      const nextStateIndex = nextStateIndices[particleIndex];
      if (!force && nextStateIndex === currentParticleColorStateIndices[particleIndex]) continue;
      const leafOffset = particleIndex * lighting.facesPerParticle;
      const tileOffset = nextStateIndex * lighting.facesPerParticle;
      for (let faceIndex = 0; faceIndex < lighting.facesPerParticle; faceIndex += 1) {
        leafElements[leafOffset + faceIndex].style.backgroundPosition =
          lighting.tileBackgroundPositions[tileOffset + faceIndex];
        if (!force) lightingLeafAddressWrites += 1;
      }
    }
    currentParticleColorStateIndices = [...nextStateIndices];
  }

  function advanceTo(nextFrameIndex) {
    if (frameIndex === nextFrameIndex) return;
    const distance = nextFrameIndex - frameIndex;
    if (distance < 1) throw new RangeError("Cyclone cannot rewind across a prepared block boundary");
    publishTransforms(playback.frames[nextFrameIndex]);
    publishLighting(nextFrameIndex);
    if (distance > 1) collapsedFrameCount += distance - 1;
    frameIndex = nextFrameIndex;
    applyCount += 1;
  }

  function queueNextBlock() {
    if (destroyed || pendingBlock || pendingBlockPromise) return pendingBlockPromise;
    pendingBlockIndex = (activeBlockIndex + 1) % catalog.blockCount;
    pendingBlockError = null;
    preparedBlockPrefetchCount += 1;
    onBlockWindow(activeBlockIndex, pendingBlockIndex);
    pendingBlockPromise = Promise.resolve(loadBlock(pendingBlockIndex)).then((block) => {
      if (destroyed) return null;
      validateBlockBinding(block, catalog, mounted.model, lighting);
      pendingBlock = block;
      pendingBlockPromise = null;
      return block;
    }).catch((error) => {
      pendingBlockError = error;
      pendingBlockPromise = null;
      onError(error);
      return null;
    });
    return pendingBlockPromise;
  }

  async function activatePendingBlock() {
    const waited = pendingBlock === null;
    if (waited) {
      runtimePreparedBlockWaitCount += 1;
      if (pendingBlockError) throw pendingBlockError;
      await (pendingBlockPromise ?? queueNextBlock());
    }
    if (!pendingBlock) throw pendingBlockError ?? new Error("Prepared Cyclone lookahead block is unavailable");
    const previousBlockIndex = activeBlockIndex;
    const previousChunkIndex = activeBlock.chunkIndex;
    activeBlock = pendingBlock;
    activeBlockIndex = pendingBlockIndex;
    playback = activeBlock.playback;
    lightingFrames = activeBlock.lighting;
    pendingBlock = null;
    pendingBlockIndex = null;
    pendingBlockPromise = null;
    pendingBlockError = null;
    frameIndex = 0;
    publishTransforms(playback.frames[0]);
    publishLighting(0);
    applyCount += 1;
    preparedBlockSwitchCount += 1;
    if (activeBlockIndex === previousBlockIndex + 1) preparedContinuousHandoffCount += 1;
    else preparedTerminalWrapCount += 1;
    if (activeBlock.chunkIndex !== previousChunkIndex) preparedChunkSwitchCount += 1;
    queueNextBlock();
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
      publishTransforms(playback.frames[nextFrameIndex]);
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
    mounted.sceneElement.style.transform = `translateZ(${perspective}px)`;
  }

  function snapshot() {
    target.assertStableDomIdentity();
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
      pendingBlockIndex,
      pendingBlockReady: pendingBlock !== null,
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
      preparedLightingColorStateCount: lighting.colorStateCount,
      preparedLightingColorRestartCount: lighting.colorRestartCount,
      runtimeGeometryConstructionCount: 0,
      runtimeAtlasRasterizationCount: 0,
      runtimeLightingCalculationCount: 0,
      runtimeLightingAtlasConstructionCount: 0,
      runtimeMatrixFormattingCount: 0,
      runtimeIdLookupCount: 0,
      runtimePreparedStateMaterializationCount: 0,
      runtimeDomGrowth: false,
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

function validateBinding(mounted, catalog, initialBlock, initialFrameIndex, lighting, lightingAsset, loadBlock) {
  if (catalog?.schema !== CATALOG_SCHEMA ||
      catalog.blockCount !== catalog.entries?.length ||
      catalog.runtimeLookaheadBlockCount !== 1 ||
      lighting?.schema !== LIGHTING_SCHEMA ||
      lighting.streamId !== catalog.streamId ||
      lighting.chunkCount !== catalog.chunkCount ||
      lighting.chunkFrameCount !== catalog.chunkFrameCount ||
      lighting.leafCount !== mounted.model.render.leaves.length ||
      lighting.facesPerParticle * mounted.model.render.shapes.length !== lighting.leafCount ||
      lighting.tileBackgroundPositions?.length !== lighting.tileCount ||
      lighting.runtime?.lightingCalculations !== 0 ||
      lighting.runtime?.atlasConstruction !== 0 ||
      lightingAsset?.sha256 !== lighting.assetSha256 ||
      typeof loadBlock !== "function" ||
      !Number.isSafeInteger(initialFrameIndex) || initialFrameIndex < 0 ||
      initialFrameIndex >= catalog.blockFrameCount) {
    throw new Error("Cyclone prepared stream binding drifted");
  }
  validateBlockBinding(initialBlock, catalog, mounted.model, lighting);
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
      playback?.schema !== PLAYBACK_SCHEMA ||
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
      playback.frames?.length !== playback.frameCount ||
      playback.particleCount !== model.render.shapes.length ||
      playback.leafCount !== model.render.leaves.length ||
      playback.mounted?.shapeTransformIndices?.length !== playback.particleCount ||
      playback.frames.some((row) => row?.length !== playback.particleCount * 2) ||
      lightingFrames?.schema !== LIGHTING_BLOCK_SCHEMA ||
      lightingFrames.streamId !== catalog.streamId ||
      lightingFrames.streamBlockIndex !== block.streamBlockIndex ||
      lightingFrames.chunkIndex !== block.chunkIndex ||
      lightingFrames.blockIndex !== block.blockIndex ||
      lightingFrames.startFrameIndex !== block.startFrameIndex ||
      lightingFrames.frameCount !== playback.frameCount ||
      lightingFrames.particleCount !== playback.particleCount ||
      lightingFrames.frameParticleColorStateIndices?.length !== playback.frameCount ||
      lightingFrames.frameParticleColorStateIndices.some((row) => row?.length !== playback.particleCount ||
        row.some((stateIndex) => !Number.isSafeInteger(stateIndex) || stateIndex < 0 ||
          stateIndex >= lighting.colorStateCount))) {
    throw new Error(`Cyclone prepared block ${block?.streamBlockIndex ?? "unknown"} binding drifted`);
  }
}
