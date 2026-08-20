import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

export function createPolyMorphPreparedShadowTarget(mounted, playback) {
  const handles = Array.from({ length: playback.shadowTriangleCount }, (_, index) =>
    mounted.leafHandles.get(`leaf-cloth-shadow-${String(index).padStart(2, "0")}`));
  if (handles.some((handle) => !handle)) {
    throw new Error("Prepared Morph shadow binding is incomplete");
  }
  validatePlayback(playback, playback.shadowTriangleCount);
  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: mounted.sceneElement,
      writeTransform() {
        return false;
      },
    },
    shapes: [],
    leaves: handles.map(({ element }) => ({ element })),
  });
  let lastFrameIndex = -1;
  let transformAssignments = 0;
  let visibilityAssignments = 0;
  let transformWrites = 0;
  let visibilityWrites = 0;
  let absoluteSeekCount = 0;
  let currentPlayback = playback;

  function applyFrame(frameIndex) {
    const transformStart = currentPlayback.shadowTransformOffsets[frameIndex];
    const transformEnd = currentPlayback.shadowTransformOffsets[frameIndex + 1];
    for (let assignment = transformStart; assignment < transformEnd; assignment += 1) {
      const triangleIndex = currentPlayback.shadowTransformIndices[assignment];
      transformWrites += Number(target.leaves[triangleIndex].writeTransform(
        currentPlayback.shadowTransformValues[assignment],
      ));
    }
    transformAssignments += transformEnd - transformStart;
    const visibilityStart = currentPlayback.shadowVisibilityOffsets[frameIndex];
    const visibilityEnd = currentPlayback.shadowVisibilityOffsets[frameIndex + 1];
    for (let assignment = visibilityStart; assignment < visibilityEnd; assignment += 1) {
      const triangleIndex = currentPlayback.shadowVisibilityIndices[assignment];
      visibilityWrites += Number(target.leaves[triangleIndex].writeVisibility(
        currentPlayback.shadowVisibilityValues[assignment] === 1,
      ));
    }
    visibilityAssignments += visibilityEnd - visibilityStart;
  }

  function applyAbsoluteFrame(frameIndex) {
    const transforms = new Array(currentPlayback.shadowTriangleCount);
    const visibility = new Uint8Array(currentPlayback.shadowTriangleCount);
    for (let sourceFrame = 0; sourceFrame <= frameIndex; sourceFrame += 1) {
      const transformStart = currentPlayback.shadowTransformOffsets[sourceFrame];
      const transformEnd = currentPlayback.shadowTransformOffsets[sourceFrame + 1];
      for (let assignment = transformStart; assignment < transformEnd; assignment += 1) {
        transforms[currentPlayback.shadowTransformIndices[assignment]] =
          currentPlayback.shadowTransformValues[assignment];
      }
      const visibilityStart = currentPlayback.shadowVisibilityOffsets[sourceFrame];
      const visibilityEnd = currentPlayback.shadowVisibilityOffsets[sourceFrame + 1];
      for (let assignment = visibilityStart; assignment < visibilityEnd; assignment += 1) {
        visibility[currentPlayback.shadowVisibilityIndices[assignment]] =
          currentPlayback.shadowVisibilityValues[assignment];
      }
    }
    for (let triangleIndex = 0; triangleIndex < currentPlayback.shadowTriangleCount; triangleIndex += 1) {
      transformWrites += Number(target.leaves[triangleIndex].writeTransform(transforms[triangleIndex]));
      visibilityWrites += Number(target.leaves[triangleIndex].writeVisibility(visibility[triangleIndex] === 1));
    }
    transformAssignments += currentPlayback.shadowTriangleCount;
    visibilityAssignments += currentPlayback.shadowTriangleCount;
    absoluteSeekCount += 1;
  }

  return Object.freeze({
    publish(frameIndex) {
      if (frameIndex === lastFrameIndex) return;
      const sequentialFrame = lastFrameIndex < 0
        ? frameIndex === 0
        : frameIndex === lastFrameIndex + 1;
      if (sequentialFrame) applyFrame(frameIndex);
      else applyAbsoluteFrame(frameIndex);
      lastFrameIndex = frameIndex;
    },
    setPlayback(nextPlayback) {
      validatePlayback(nextPlayback, currentPlayback.shadowTriangleCount);
      currentPlayback = nextPlayback;
      lastFrameIndex = -1;
    },
    assertStableDomIdentity() {
      target.assertStableDomIdentity();
    },
    snapshot() {
      return Object.freeze({
        transformAssignments,
        visibilityAssignments,
        transformWrites,
        visibilityWrites,
        absoluteSeekCount,
      });
    },
    destroy() {
      target.destroy();
    },
  });
}

function validatePlayback(playback, shadowTriangleCount) {
  if (playback?.shadowTriangleCount !== shadowTriangleCount ||
      playback.shadowTransformOffsets.length !== playback.frameCount + 1 ||
      playback.shadowTransformIndices.length !== playback.shadowTransformValues.length ||
      playback.shadowTransformOffsets[playback.frameCount] !== playback.shadowTransformValues.length ||
      playback.shadowVisibilityOffsets.length !== playback.frameCount + 1 ||
      playback.shadowVisibilityIndices.length !== playback.shadowVisibilityValues.length ||
      playback.shadowVisibilityOffsets[playback.frameCount] !== playback.shadowVisibilityValues.length) {
    throw new Error("Prepared Morph shadow binding is incomplete");
  }
}
