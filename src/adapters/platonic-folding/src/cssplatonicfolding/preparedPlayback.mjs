import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

const PLAYBACK_SCHEMA = "cssplatonicfolding-prepared-dom-playback@1";

export function createPlatonicPreparedPlayer({
  mounted,
  playback,
  readNow = () => performance.now(),
  requestDelay = (callback, delay) => setTimeout(callback, delay),
  cancelDelay = (timer) => clearTimeout(timer),
}) {
  validatePlaybackBinding(mounted, playback);
  const shapeElements = mounted.model.render.shapes.map((shape) => mounted.shapeElements.get(shape.id));
  const leafElements = mounted.model.render.leaves.map((leaf) => mounted.leafHandles.get(leaf.id)?.element);
  if (shapeElements.some((element) => !element) || leafElements.some((element) => !element)) {
    throw new Error("Platonic Folding retained DOM binding is incomplete");
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
  const desiredShapeTransforms = Int32Array.from(playback.mounted.shapeTransformIndices);
  const publishedShapeTransforms = Int32Array.from(playback.mounted.shapeTransformIndices);
  const desiredAtlasRows = Int16Array.from(playback.mounted.atlasRows);
  const publishedAtlasRows = Int16Array.from(playback.mounted.atlasRows);
  const desiredVisibility = Uint8Array.from(playback.mounted.visibility);
  const publishedVisibility = Uint8Array.from(playback.mounted.visibility);
  let desiredModelTransform = playback.mounted.modelTransformIndex;
  let publishedModelTransformIndex = playback.mounted.modelTransformIndex;
  let paused = true;
  let destroyed = false;
  let timer = null;
  let clockOrigin = readNow();
  let pausedAt = 0;
  let frameIndex = -1;
  let timerCallbackCount = 0;
  let collapsedFrameCount = 0;
  let applyCount = 0;
  let modelTransformWrites = 0;
  let shapeTransformWrites = 0;
  let visibilityWrites = 0;
  let atlasRowWrites = 0;
  let runtimeCatchupFullStateScanCount = 0;

  applyFrameZero();

  function applyFrameZero() {
    applyRow(playback.frames[0], true);
    frameIndex = 0;
    applyCount += 1;
  }

  function applyRow(row, publish) {
    for (const leafIndex of row[3]) {
      desiredVisibility[leafIndex] = 0;
      if (!publish) continue;
      visibilityWrites += Number(target.leaves[leafIndex].writeVisibility(false));
      publishedVisibility[leafIndex] = 0;
    }

    if (row[0] >= 0) {
      desiredModelTransform = row[0];
      if (publish) publishModelTransform();
    }

    for (let operation = 0; operation < row[1].length; operation += 2) {
      const shapeIndex = row[1][operation];
      const transformIndex = row[1][operation + 1];
      desiredShapeTransforms[shapeIndex] = transformIndex;
      if (!publish || publishedVisibility[shapeIndex] === 0) continue;
      shapeTransformWrites += Number(target.shapes[shapeIndex].writeTransform(playback.transforms[transformIndex]));
      publishedShapeTransforms[shapeIndex] = transformIndex;
    }

    for (let operation = 0; operation < row[2].length; operation += 2) {
      const leafIndex = row[2][operation];
      const atlasRow = row[2][operation + 1];
      desiredAtlasRows[leafIndex] = atlasRow;
      if (!publish || publishedVisibility[leafIndex] === 0) continue;
      atlasRowWrites += Number(target.leaves[leafIndex].writeImagePositionY(playback.imagePositionYs[atlasRow]));
      publishedAtlasRows[leafIndex] = atlasRow;
    }

    for (const leafIndex of row[4]) {
      desiredVisibility[leafIndex] = 1;
      if (!publish) continue;
      publishVisibleLeafState(leafIndex);
      visibilityWrites += Number(target.leaves[leafIndex].writeVisibility(true));
      publishedVisibility[leafIndex] = 1;
    }
  }

  function publishModelTransform() {
    if (publishedModelTransformIndex === desiredModelTransform) return;
    modelTransformWrites += Number(target.model.writeTransform(playback.transforms[desiredModelTransform]));
    publishedModelTransformIndex = desiredModelTransform;
  }

  function publishVisibleLeafState(leafIndex) {
    if (publishedShapeTransforms[leafIndex] !== desiredShapeTransforms[leafIndex]) {
      shapeTransformWrites += Number(target.shapes[leafIndex]
        .writeTransform(playback.transforms[desiredShapeTransforms[leafIndex]]));
      publishedShapeTransforms[leafIndex] = desiredShapeTransforms[leafIndex];
    }
    if (publishedAtlasRows[leafIndex] !== desiredAtlasRows[leafIndex]) {
      atlasRowWrites += Number(target.leaves[leafIndex]
        .writeImagePositionY(playback.imagePositionYs[desiredAtlasRows[leafIndex]]));
      publishedAtlasRows[leafIndex] = desiredAtlasRows[leafIndex];
    }
  }

  function publishCachedState() {
    runtimeCatchupFullStateScanCount += 1;
    for (let leafIndex = 0; leafIndex < playback.leafCount; leafIndex += 1) {
      if (desiredVisibility[leafIndex] === 0 && publishedVisibility[leafIndex] === 1) {
        visibilityWrites += Number(target.leaves[leafIndex].writeVisibility(false));
        publishedVisibility[leafIndex] = 0;
      }
    }
    publishModelTransform();
    for (let leafIndex = 0; leafIndex < playback.leafCount; leafIndex += 1) {
      if (desiredVisibility[leafIndex] === 0) continue;
      publishVisibleLeafState(leafIndex);
      if (publishedVisibility[leafIndex] === 0) {
        visibilityWrites += Number(target.leaves[leafIndex].writeVisibility(true));
        publishedVisibility[leafIndex] = 1;
      }
    }
  }

  function advanceTo(nextFrameIndex) {
    if (frameIndex === nextFrameIndex) return;
    if (frameIndex < 0) {
      applyFrameZero();
      if (nextFrameIndex === 0) return;
    }
    const distance = nextFrameIndex >= frameIndex
      ? nextFrameIndex - frameIndex
      : playback.frameCount - frameIndex + nextFrameIndex;
    if (distance === 1) {
      applyRow(nextFrameIndex === 0 ? playback.wrap : playback.frames[nextFrameIndex], true);
    } else {
      let cursor = frameIndex;
      for (let step = 0; step < distance; step += 1) {
        cursor = (cursor + 1) % playback.frameCount;
        applyRow(cursor === 0 ? playback.wrap : playback.frames[cursor], false);
      }
      publishCachedState();
      collapsedFrameCount += distance - 1;
    }
    frameIndex = nextFrameIndex;
    applyCount += 1;
  }

  function cancelScheduled() {
    if (timer !== null) cancelDelay(timer);
    timer = null;
  }

  function schedule() {
    if (paused || destroyed || timer !== null) return;
    const elapsed = Math.max(0, readNow() - clockOrigin);
    const phase = elapsed % playback.durationMilliseconds;
    const nextFrame = (Math.floor(phase / playback.frameMilliseconds) + 1) * playback.frameMilliseconds;
    timer = requestDelay(wake, Math.max(1, Math.ceil(nextFrame - phase)));
  }

  function wake() {
    timer = null;
    if (paused || destroyed) return;
    timerCallbackCount += 1;
    const elapsed = Math.max(0, readNow() - clockOrigin);
    const dueFrame = Math.floor((elapsed % playback.durationMilliseconds) / playback.frameMilliseconds);
    advanceTo(dueFrame);
    schedule();
  }

  function pause() {
    if (paused || destroyed) return snapshot();
    pausedAt = Math.max(0, readNow() - clockOrigin) % playback.durationMilliseconds;
    paused = true;
    cancelScheduled();
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
      throw new RangeError("Platonic Folding prepared frame is out of range");
    }
    const wasPaused = paused;
    if (!wasPaused) pause();
    pausedAt = nextFrameIndex * playback.frameMilliseconds;
    advanceTo(nextFrameIndex);
    if (!wasPaused) resume();
    return snapshot();
  }

  function resize() {
    const perspective = Math.min(innerWidth, innerHeight) /
      (2 * Math.tan(22.5 * Math.PI / 180));
    const roundedPerspective = Number(perspective.toFixed(4));
    mounted.cameraElement.style.perspective = `${roundedPerspective}px`;
    mounted.sceneElement.style.transform = `translateZ(${roundedPerspective}px)`;
  }

  function snapshot() {
    target.assertStableDomIdentity();
    return Object.freeze({
      paused,
      frameIndex,
      frameCount: playback.frameCount,
      durationMilliseconds: playback.durationMilliseconds,
      frameMilliseconds: playback.frameMilliseconds,
      timerCallbackCount,
      collapsedFrameCount,
      applyCount,
      modelTransformWrites,
      shapeTransformWrites,
      visibilityWrites,
      atlasRowWrites,
      preparedStateMaterializationCount: 0,
      runtimeFullStateDiffCount: 0,
      runtimeMatrixFormattingCount: 0,
      runtimeIdLookupCount: 0,
      runtimeNormalFullStateScanCount: 0,
      runtimeCatchupFullStateScanCount,
      runtimeHiddenShapeTransformWrites: 0,
      runtimeHiddenAtlasRowWrites: 0,
      runtimeGeometryConstructionCount: 0,
      runtimeAtlasRasterizationCount: 0,
      runtimeDomGrowth: false,
      retainedDomStable: true,
    });
  }

  return Object.freeze({
    resize,
    resume,
    pause,
    seekFrame,
    stats: snapshot,
    destroy() {
      if (destroyed) return;
      paused = true;
      destroyed = true;
      cancelScheduled();
      removeEventListener("resize", resize);
      target.destroy();
      mounted.destroy();
    },
  });
}

function validatePlaybackBinding(mounted, playback) {
  if (playback?.schema !== PLAYBACK_SCHEMA ||
      playback.modelId !== mounted.model.identity.id ||
      playback.frameCount !== playback.frames?.length ||
      playback.frameCount < 1 ||
      playback.shapeCount !== mounted.model.render.shapes.length ||
      playback.leafCount !== mounted.model.render.leaves.length ||
      playback.mounted?.shapeTransformIndices?.length !== playback.shapeCount ||
      playback.mounted?.atlasRows?.length !== playback.leafCount ||
      playback.mounted?.visibility?.length !== playback.leafCount ||
      !Array.isArray(playback.wrap)) {
    throw new Error("Platonic Folding prepared playback binding drifted");
  }
}
