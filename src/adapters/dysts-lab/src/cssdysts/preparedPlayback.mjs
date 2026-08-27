// SPDX-License-Identifier: MIT
import { COORDINATE_SCALE, PERSPECTIVE_DISTANCE, PREPARED_DEPTH_BIAS,
  PREPARED_POSITION_BIAS } from "../shared/cssdysts/preparedRailTransport.mjs";

export function createChaosPreparedPlayer({ catalog, prepared, leafPhaseIndices, leafRevealOrder,
  leafOpacities, publish, publishOpacity, handoff, handoffStartCoordinates,
  rankToPhysical,
  onCycleComplete, readNow = () => performance.now(), requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame }) {
  const revealFrameCount = Math.round(catalog.revealSeconds * catalog.framesPerSecond);
  const handoffFrameCount = Math.round(catalog.handoffSeconds * catalog.framesPerSecond);
  const transitionFrameCount = handoff ? handoffFrameCount : revealFrameCount;
  const holdFrameCount = Math.round(catalog.holdSeconds * catalog.framesPerSecond);
  if (catalog.starCount !== 2000 || prepared.transforms.length !== catalog.sampleCount ||
      leafPhaseIndices.length !== catalog.starCount ||
      leafRevealOrder.length !== catalog.starCount || leafOpacities.length !== catalog.starCount ||
      catalog.revealSeconds !== 3 || catalog.handoffSeconds !== 2 || catalog.holdSeconds !== 3 ||
      catalog.handoffControlPointCount !== catalog.starCount ||
      !(prepared.coordinates instanceof Uint16Array) ||
      prepared.coordinates.length !== catalog.sampleCount * 3 ||
      !(prepared.handoffControlCoordinates instanceof Uint16Array) ||
      prepared.handoffControlCoordinates.length !== catalog.starCount * 3 ||
      !Number.isSafeInteger(catalog.sourcePhaseOffset) || catalog.sourcePhaseOffset < 0 ||
      catalog.sourcePhaseOffset >= catalog.sampleCount ||
      typeof publish !== "function" || typeof publishOpacity !== "function" ||
      typeof handoff !== "boolean" ||
      (handoff && (!(handoffStartCoordinates instanceof Float64Array) ||
        handoffStartCoordinates.length !== catalog.starCount * 3)) ||
      !(rankToPhysical instanceof Uint16Array) || rankToPhysical.length !== catalog.starCount ||
      typeof onCycleComplete !== "function") {
    throw new Error("Chaos prepared player binding drifted");
  }
  let paused = true;
  let destroyed = false;
  let frameRequest = null;
  let startedAt = 0;
  let hasStarted = false;
  let pausedAt = 0;
  let pausedDuration = 0;
  let publishedFrame = 0;
  let appliedFrameCount = 0;
  let sourceFrameDropCount = 0;
  let transformWriteCount = 0;
  let opacityWriteCount = 0;
  let runtimeCoordinateCalculationCount = 0;
  let runtimeCoordinateFormattingCount = 0;
  let revealedLeafCount = 0;
  let visibleLeafCount = handoff ? catalog.starCount : 0;
  let growthComplete = false;
  let cycleComplete = false;
  const frameMilliseconds = 1000 / catalog.framesPerSecond;
  const cycleFrameCount = transitionFrameCount + holdFrameCount;
  const initialRevealStartRank = handoff ? 0 : findInitialRevealStartRank(
    leafPhaseIndices, leafRevealOrder, catalog.sourcePhaseOffset);
  const handoffComponents = handoff ? prepareHandoffComponents({ catalog, prepared,
    leafPhaseIndices, leafRevealOrder, handoffStartCoordinates,
    transitionFrameCount }) : null;

  if (!handoff) {
    for (let leafIndex = 0; leafIndex < catalog.starCount; leafIndex += 1) {
      if (publishOpacity(leafIndex, "0") !== false) opacityWriteCount += 1;
    }
  }

  function publishFrame(streamFrame) {
    if (cycleComplete) return false;
    if (handoff && streamFrame < handoffFrameCount) publishScatterToTarget(streamFrame);
    else publishIncomingFrame(streamFrame);
    if (streamFrame >= transitionFrameCount) growthComplete = true;
    appliedFrameCount += 1;
    publishedFrame = streamFrame;
    if (streamFrame >= cycleFrameCount) {
      cycleComplete = true;
      paused = true;
      onCycleComplete();
    }
    return true;
  }

  function publishScatterToTarget(streamFrame) {
    if (streamFrame > 0) publishCurvedHandoffFrame(handoffComponents,
      cubicBezierProgress(streamFrame / handoffFrameCount, .45, 0, .55, 1));
    visibleLeafCount = catalog.starCount;
  }

  function publishCurvedHandoffFrame({ start, control, incoming }, progress) {
    const inverse = 1 - progress;
    const startWeight = inverse * inverse;
    const controlWeight = 2 * inverse * progress;
    const incomingWeight = progress * progress;
    for (let rank = 0; rank < catalog.starCount; rank += 1) {
      const offset = rank * 3;
      publish(rankToPhysical[rank], formatInterpolatedTransform(
        start[offset] * startWeight + control[offset] * controlWeight +
          incoming[offset] * incomingWeight,
        start[offset + 1] * startWeight + control[offset + 1] * controlWeight +
          incoming[offset + 1] * incomingWeight,
        start[offset + 2] * startWeight + control[offset + 2] * controlWeight +
          incoming[offset + 2] * incomingWeight));
    }
    transformWriteCount += catalog.starCount;
    runtimeCoordinateCalculationCount += catalog.starCount;
    runtimeCoordinateFormattingCount += catalog.starCount;
  }

  function publishIncomingFrame(streamFrame) {
    const growthFrame = Math.min(streamFrame, revealFrameCount);
    const dueLeafCount = handoff || streamFrame > revealFrameCount
      ? catalog.starCount
      : Math.min(catalog.starCount,
        Math.floor(growthFrame * catalog.starCount / revealFrameCount));
    if (!handoff) {
      while (revealedLeafCount < dueLeafCount) {
        const physicalLeaf = rankToPhysical[revealedLeafCount];
        if (publishOpacity(physicalLeaf, leafOpacities[physicalLeaf]) !== false) {
          opacityWriteCount += 1;
        }
        revealedLeafCount += 1;
      }
      visibleLeafCount = revealedLeafCount;
    }
    const sourceFrame = streamFrame % catalog.sampleCount;
    for (let rank = 0; rank < dueLeafCount; rank += 1) {
      const revealRank = handoff ? rank :
        (initialRevealStartRank + rank) % catalog.starCount;
      const logicalLeaf = leafRevealOrder[revealRank];
      const phaseOffset = handoff ? 0 : -catalog.sourcePhaseOffset;
      publish(rankToPhysical[rank], sampleTransform(prepared.transforms,
        leafPhaseIndices[logicalLeaf] + phaseOffset + sourceFrame, catalog.sampleCount));
    }
    transformWriteCount += dueLeafCount;
  }

  function tick(timestamp) {
    frameRequest = null;
    if (destroyed || paused) return;
    const now = Math.max(timestamp, readNow());
    const elapsedFrame = (now - startedAt - pausedDuration) / frameMilliseconds;
    const dueFrame = Math.floor(elapsedFrame);
    if (dueFrame > publishedFrame) {
      sourceFrameDropCount += Math.max(0, dueFrame - publishedFrame - 1);
      publishFrame(dueFrame);
    }
    if (cycleComplete) return;
    frameRequest = requestFrame(tick);
  }

  return Object.freeze({
    publishFrame,
    resume() {
      if (destroyed || cycleComplete || !paused) return false;
      const now = readNow();
      if (!hasStarted) {
        startedAt = now - publishedFrame * frameMilliseconds;
        hasStarted = true;
      } else pausedDuration += now - pausedAt;
      paused = false;
      frameRequest = requestFrame(tick);
      return true;
    },
    pause() {
      if (paused || destroyed) return false;
      paused = true;
      pausedAt = readNow();
      if (frameRequest !== null) cancelFrame(frameRequest);
      frameRequest = null;
      return true;
    },
    destroy() {
      destroyed = true;
      if (frameRequest !== null) cancelFrame(frameRequest);
      frameRequest = null;
    },
    captureTerminalPreparedComponents() {
      if (!cycleComplete) {
        throw new Error("Chaos terminal prepared coordinates are not ready");
      }
      const output = new Float64Array(catalog.starCount * 3);
      const sourceFrame = publishedFrame % catalog.sampleCount;
      for (let rank = 0; rank < catalog.starCount; rank += 1) {
        const revealRank = handoff ? rank :
          (initialRevealStartRank + rank) % catalog.starCount;
        const logicalLeaf = leafRevealOrder[revealRank];
        const phaseOffset = handoff ? 0 : -catalog.sourcePhaseOffset;
        const sampleIndex = normalizeSampleIndex(
          leafPhaseIndices[logicalLeaf] + phaseOffset + sourceFrame, catalog.sampleCount);
        readPreparedComponents(prepared.coordinates, sampleIndex, output, rank * 3);
      }
      return output;
    },
    stats() {
      return Object.freeze({
        framesPerSecond: catalog.framesPerSecond,
        publishedFrame,
        appliedFrameCount,
        sourceFrameDropCount,
        transformWriteCount,
        opacityWriteCount,
        visibleLeafCount,
        growthComplete,
        handoff,
        cycleComplete,
        runtimePhysicsCount: 0,
        runtimeCoordinateCalculationCount,
        runtimeCoordinateFormattingCount,
      });
    },
  });
}

function prepareHandoffComponents({ catalog, prepared, leafPhaseIndices, leafRevealOrder,
  handoffStartCoordinates, transitionFrameCount }) {
  const start = handoffStartCoordinates;
  const control = new Float64Array(catalog.starCount * 3);
  const incoming = new Float64Array(catalog.starCount * 3);
  for (let rank = 0; rank < catalog.starCount; rank += 1) {
    const offset = rank * 3;
    readPreparedComponents(prepared.handoffControlCoordinates, rank, control, offset);
    const logicalLeaf = leafRevealOrder[rank];
    const sampleIndex = normalizeSampleIndex(
      leafPhaseIndices[logicalLeaf] + transitionFrameCount, catalog.sampleCount);
    readPreparedComponents(prepared.coordinates, sampleIndex, incoming, offset);
  }
  return Object.freeze({ start, control, incoming });
}

function readPreparedComponents(coordinates, coordinateIndex, output, outputOffset) {
  const inputOffset = coordinateIndex * 3;
  output[outputOffset] = coordinates[inputOffset] / COORDINATE_SCALE - PREPARED_POSITION_BIAS;
  output[outputOffset + 1] = coordinates[inputOffset + 1] / COORDINATE_SCALE -
    PREPARED_POSITION_BIAS;
  const depth = coordinates[inputOffset + 2] / COORDINATE_SCALE - PREPARED_DEPTH_BIAS;
  output[outputOffset + 2] = PERSPECTIVE_DISTANCE / (PERSPECTIVE_DISTANCE - depth);
}

function formatInterpolatedTransform(x, y, scale) {
  return `translate(${roundDecimal(x, 100)}px,${roundDecimal(y, 100)}px) ` +
    `scale(${roundDecimal(scale, 10_000)})`;
}

function roundDecimal(value, precision) {
  return String(Math.round(value * precision) / precision);
}

function cubicBezierProgress(progress, x1, y1, x2, y2) {
  const x = Math.max(0, Math.min(1, progress));
  let parameter = x;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const inverse = 1 - parameter;
    const sampledX = 3 * inverse * inverse * parameter * x1 +
      3 * inverse * parameter * parameter * x2 + parameter ** 3;
    const derivative = 3 * inverse * inverse * x1 +
      6 * inverse * parameter * (x2 - x1) + 3 * parameter * parameter * (1 - x2);
    if (Math.abs(derivative) < 1e-7) break;
    parameter = Math.max(0, Math.min(1, parameter - (sampledX - x) / derivative));
  }
  const inverse = 1 - parameter;
  return 3 * inverse * inverse * parameter * y1 +
    3 * inverse * parameter * parameter * y2 + parameter ** 3;
}

function normalizeSampleIndex(index, count) {
  return ((index % count) + count) % count;
}

function sampleTransform(transforms, sampleIndex, sampleCount) {
  return transforms[((sampleIndex % sampleCount) + sampleCount) % sampleCount];
}

function findInitialRevealStartRank(leafPhaseIndices, leafRevealOrder, sourcePhaseOffset) {
  let low = 0;
  let high = leafRevealOrder.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (leafPhaseIndices[leafRevealOrder[middle]] < sourcePhaseOffset) low = middle + 1;
    else high = middle;
  }
  return low === leafRevealOrder.length ? 0 : low;
}
