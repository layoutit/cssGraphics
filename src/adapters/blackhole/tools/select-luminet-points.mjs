// SPDX-License-Identifier: MIT

const REPAIR_DIRECTIONS = Object.freeze([
  Object.freeze([1, 0]),
  Object.freeze([-1, 0]),
  Object.freeze([0, 1]),
  Object.freeze([0, -1]),
  Object.freeze([1, 1]),
  Object.freeze([-1, 1]),
  Object.freeze([1, -1]),
  Object.freeze([-1, -1]),
]);
const COLLISION_SEPARATION_TENTHS = 10;

export function selectNonOverlappingLuminetPointFrames({
  coordinates,
  frameCount,
  sourcePointCount,
  sourceDirectPointCount,
  sourceGhostPointCount,
  selectedDirectPointCount,
  selectedGhostPointCount,
}) {
  if (!(coordinates instanceof Int32Array) || !Number.isSafeInteger(frameCount) ||
      frameCount < 1 || !Number.isSafeInteger(sourcePointCount) || sourcePointCount < 1 ||
      coordinates.length !== frameCount * sourcePointCount * 2 ||
      !Number.isSafeInteger(sourceDirectPointCount) || sourceDirectPointCount < 1 ||
      !Number.isSafeInteger(sourceGhostPointCount) || sourceGhostPointCount < 1 ||
      sourceDirectPointCount + sourceGhostPointCount !== sourcePointCount ||
      !Number.isSafeInteger(selectedDirectPointCount) || selectedDirectPointCount < 1 ||
      selectedDirectPointCount > sourceDirectPointCount ||
      !Number.isSafeInteger(selectedGhostPointCount) || selectedGhostPointCount < 1 ||
      selectedGhostPointCount > sourceGhostPointCount) {
    throw new TypeError("Complete Luminet point-selection inputs are required");
  }

  const sourcePointIndices = [
    ...stratifiedPointIndices(0, sourceDirectPointCount, selectedDirectPointCount),
    ...stratifiedPointIndices(
      sourceDirectPointCount, sourceGhostPointCount, selectedGhostPointCount),
  ];
  const selectedPointCount = sourcePointIndices.length;
  const selectedCoordinates = new Int32Array(frameCount * selectedPointCount * 2);
  let framesWithPreparedCollisionSeparation = 0;
  let preparedCollisionSeparationCount = 0;
  let maximumPreparedCollisionSeparationCount = 0;
  let maximumPreparedCollisionSeparationTenths = 0;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const usedCoordinates = new Set();
    let frameSeparationCount = 0;
    for (let selectedIndex = 0; selectedIndex < selectedPointCount; selectedIndex += 1) {
      const sourceIndex = sourcePointIndices[selectedIndex];
      const sourceOffset = (frameIndex * sourcePointCount + sourceIndex) * 2;
      let x = coordinates[sourceOffset];
      let y = coordinates[sourceOffset + 1];
      if (usedCoordinates.has(coordinateKey(x, y))) {
        const separated = nearestPreparedSeparation({
          x,
          y,
          selectedIndex,
          sourceIndex,
          usedCoordinates,
        });
        x = separated.x;
        y = separated.y;
        maximumPreparedCollisionSeparationTenths = Math.max(
          maximumPreparedCollisionSeparationTenths, separated.distanceTenths);
        frameSeparationCount += 1;
      }
      const key = coordinateKey(x, y);
      if (usedCoordinates.has(key)) {
        throw new Error("Luminet prepared collision separation retained an exact collision");
      }
      usedCoordinates.add(key);
      const selectedOffset = (frameIndex * selectedPointCount + selectedIndex) * 2;
      selectedCoordinates[selectedOffset] = x;
      selectedCoordinates[selectedOffset + 1] = y;
    }
    if (frameSeparationCount > 0) framesWithPreparedCollisionSeparation += 1;
    preparedCollisionSeparationCount += frameSeparationCount;
    maximumPreparedCollisionSeparationCount = Math.max(
      maximumPreparedCollisionSeparationCount, frameSeparationCount);
  }

  return Object.freeze({
    sourcePointIndices: Object.freeze(sourcePointIndices),
    selectedCoordinates,
    report: Object.freeze({
      analyzedSourceFrameCount: frameCount,
      retainedStratifiedPointCount: selectedPointCount,
      framesWithPreparedCollisionSeparation,
      preparedCollisionSeparationCount,
      maximumPreparedCollisionSeparationCount,
      maximumPreparedCollisionSeparationPixels:
        Number((maximumPreparedCollisionSeparationTenths / 10).toFixed(3)),
      sourceCoordinateSampleCount: frameCount * selectedPointCount,
      sourceExactCoordinateSampleCount:
        frameCount * selectedPointCount - preparedCollisionSeparationCount,
      selectedExactCoordinateConflictPairCount: 0,
    }),
  });
}

function nearestPreparedSeparation({ x, y, selectedIndex, sourceIndex, usedCoordinates }) {
  const directionOffset = (selectedIndex + sourceIndex) % REPAIR_DIRECTIONS.length;
  for (let radius = 1; radius <= 8; radius += 1) {
    for (let directionIndex = 0;
      directionIndex < REPAIR_DIRECTIONS.length;
      directionIndex += 1) {
      const direction = REPAIR_DIRECTIONS[
        (directionIndex + directionOffset) % REPAIR_DIRECTIONS.length];
      const offsetX = direction[0] * COLLISION_SEPARATION_TENTHS * radius;
      const offsetY = direction[1] * COLLISION_SEPARATION_TENTHS * radius;
      const separatedX = x + offsetX;
      const separatedY = y + offsetY;
      if (!usedCoordinates.has(coordinateKey(separatedX, separatedY))) {
        return Object.freeze({
          x: separatedX,
          y: separatedY,
          distanceTenths: Math.hypot(offsetX, offsetY),
        });
      }
    }
  }
  throw new Error(`Luminet point ${sourceIndex} exhausted prepared collision separations`);
}

function coordinateKey(x, y) {
  return `${x},${y}`;
}

function stratifiedPointIndices(startIndex, sourceCount, selectedCount) {
  return Array.from({ length: selectedCount }, (_, selectedIndex) =>
    startIndex + Math.floor((selectedIndex + 0.5) * sourceCount / selectedCount));
}
