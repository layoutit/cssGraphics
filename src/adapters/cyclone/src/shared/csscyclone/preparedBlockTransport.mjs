import { formatMatrix3dValues } from "@layoutit/polycss";
import { advanceCycloneParticleTransform } from "./particleTransform.mjs";

export const CSSCYCLONE_BLOCK_ENCODING = "gzip-cyclone-source-state-float64-uint16@1";
export const CSSCYCLONE_PLAYBACK_SCHEMA = "csscyclone-prepared-dom-playback@4";
export const CSSCYCLONE_LIGHTING_BLOCK_SCHEMA = "csscyclone-prepared-lighting-block@2";

const MAGIC = "CCST";
const VERSION = 1;
const CONTROL_POINT_COUNT = 6;
const PARTICLE_STATE_FIELD_COUNT = 3;
const CYCLONE_FRAME_VALUE_COUNT = CONTROL_POINT_COUNT * 3 + CONTROL_POINT_COUNT;
const HEADER_BYTES = 24;
const RESET_EVENT_BYTES = 20;

export function encodeCyclonePreparedBlock({ frames, lightingRows, particleCount }) {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 0xffff ||
      !Number.isSafeInteger(particleCount) || particleCount < 1 || particleCount > 0xffff ||
      !Array.isArray(lightingRows) || lightingRows.length !== frames.length ||
      lightingRows.some((row) => !Array.isArray(row) || row.length !== particleCount ||
        row.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 0xffff)) ||
      frames.some((frame) => !validTransformFrame(frame?.transformState, particleCount))) {
    throw new TypeError("Complete prepared Cyclone source-state block inputs are required");
  }
  const resetEvents = [];
  for (let frameIndex = 1; frameIndex < frames.length; frameIndex += 1) {
    for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
      const state = frames[frameIndex].transformState.particles[particleIndex];
      if (state.reset) resetEvents.push({ frameIndex, particleIndex, width: state.width, spinAngle: state.spinAngle });
    }
  }
  const cycloneBytes = frames.length * CYCLONE_FRAME_VALUE_COUNT * Float64Array.BYTES_PER_ELEMENT;
  const initialStateBytes = particleCount * PARTICLE_STATE_FIELD_COUNT * Float64Array.BYTES_PER_ELEMENT;
  const resetBytes = resetEvents.length * RESET_EVENT_BYTES;
  const lightingValueCount = frames.length * particleCount;
  const lightingBytes = lightingValueCount * Uint16Array.BYTES_PER_ELEMENT;
  const bytes = new Uint8Array(HEADER_BYTES + cycloneBytes + initialStateBytes + resetBytes + lightingBytes);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < MAGIC.length; index += 1) bytes[index] = MAGIC.charCodeAt(index);
  bytes[4] = VERSION;
  bytes[5] = CONTROL_POINT_COUNT;
  bytes[6] = PARTICLE_STATE_FIELD_COUNT;
  bytes[7] = 0;
  view.setUint16(8, particleCount, true);
  view.setUint16(10, frames.length, true);
  view.setUint32(12, resetEvents.length, true);
  view.setUint32(16, lightingValueCount, true);
  view.setUint32(20, 0, true);
  let offset = HEADER_BYTES;
  for (const frame of frames) {
    for (const point of frame.transformState.points) {
      for (const value of point) {
        view.setFloat64(offset, value, true);
        offset += Float64Array.BYTES_PER_ELEMENT;
      }
    }
    for (const value of frame.transformState.widths) {
      view.setFloat64(offset, value, true);
      offset += Float64Array.BYTES_PER_ELEMENT;
    }
  }
  for (const state of frames[0].transformState.particles) {
    for (const value of [state.width, state.step, state.spinAngle]) {
      view.setFloat64(offset, value, true);
      offset += Float64Array.BYTES_PER_ELEMENT;
    }
  }
  for (const event of resetEvents) {
    view.setUint16(offset, event.frameIndex, true);
    view.setUint16(offset + 2, event.particleIndex, true);
    view.setFloat64(offset + 4, event.width, true);
    view.setFloat64(offset + 12, event.spinAngle, true);
    offset += RESET_EVENT_BYTES;
  }
  for (const row of lightingRows) {
    for (const value of row) {
      view.setUint16(offset, value, true);
      offset += Uint16Array.BYTES_PER_ELEMENT;
    }
  }
  if (offset !== bytes.byteLength) throw new Error("Prepared Cyclone source-state block byte count drifted");
  return bytes;
}

export function decodeCyclonePreparedBlock(bytes, descriptor, catalog) {
  const operations = decodeCyclonePreparedBlockOperations(bytes, descriptor, catalog);
  let result = operations.next();
  while (!result.done) result = operations.next();
  return result.value;
}

export async function decodeCyclonePreparedBlockIncrementally(
  bytes,
  descriptor,
  catalog,
  {
    setDelay = globalThis.setTimeout.bind(globalThis),
    readNow = () => globalThis.performance.now(),
    sliceBudgetMilliseconds = 4,
    isCurrent = () => true,
    onSlice = () => undefined,
  } = {},
) {
  if (typeof setDelay !== "function" || typeof readNow !== "function" ||
      typeof isCurrent !== "function" || typeof onSlice !== "function" ||
      !Number.isFinite(sliceBudgetMilliseconds) ||
      sliceBudgetMilliseconds <= 0 || sliceBudgetMilliseconds > 4) {
    throw new TypeError("Cyclone incremental source-state decoder scheduling is invalid");
  }
  const operations = decodeCyclonePreparedBlockOperations(bytes, descriptor, catalog);
  let firstSlice = true;
  while (true) {
    if (!firstSlice) {
      await new Promise((resolveDelay) => setDelay(resolveDelay, catalog.frameMilliseconds));
      if (!isCurrent()) return null;
    }
    firstSlice = false;
    if (!isCurrent()) return null;
    const startedAt = readNow();
    let operationCount = 0;
    while (operationCount < 8_192) {
      const result = operations.next();
      if (result.done) {
        onSlice(operationCount, readNow() - startedAt);
        return result.value;
      }
      operationCount += result.value;
      if (operationCount >= 64 && readNow() - startedAt >= sliceBudgetMilliseconds) break;
    }
    onSlice(operationCount, readNow() - startedAt);
  }
}

function* decodeCyclonePreparedBlockOperations(bytes, descriptor, catalog) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER_BYTES ||
      String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== MAGIC ||
      bytes[4] !== VERSION || bytes[5] !== CONTROL_POINT_COUNT ||
      bytes[6] !== PARTICLE_STATE_FIELD_COUNT || bytes[7] !== 0 ||
      descriptor?.encoding !== CSSCYCLONE_BLOCK_ENCODING ||
      catalog?.playbackSchema !== CSSCYCLONE_PLAYBACK_SCHEMA ||
      catalog?.lightingBlockSchema !== CSSCYCLONE_LIGHTING_BLOCK_SCHEMA) {
    throw new Error(`Prepared Cyclone block ${descriptor?.index ?? "unknown"} binary header drifted`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const particleCount = view.getUint16(8, true);
  const frameCount = view.getUint16(10, true);
  const resetEventCount = view.getUint32(12, true);
  const lightingValueCount = view.getUint32(16, true);
  if (view.getUint32(20, true) !== 0 || particleCount !== catalog.particleCount ||
      frameCount !== descriptor.frameCount || lightingValueCount !== particleCount * frameCount ||
      !validSourceProfile(catalog.sourceTransformProfile)) {
    throw new Error(`Prepared Cyclone block ${descriptor.index} source-state counts drifted`);
  }
  const cycloneBytes = frameCount * CYCLONE_FRAME_VALUE_COUNT * Float64Array.BYTES_PER_ELEMENT;
  const initialStateBytes = particleCount * PARTICLE_STATE_FIELD_COUNT * Float64Array.BYTES_PER_ELEMENT;
  const resetBytes = resetEventCount * RESET_EVENT_BYTES;
  const lightingBytes = lightingValueCount * Uint16Array.BYTES_PER_ELEMENT;
  if (HEADER_BYTES + cycloneBytes + initialStateBytes + resetBytes + lightingBytes !== bytes.byteLength) {
    throw new Error(`Prepared Cyclone block ${descriptor.index} binary byte length drifted`);
  }
  const cycloneOffset = HEADER_BYTES;
  const initialStateOffset = cycloneOffset + cycloneBytes;
  const resetOffset = initialStateOffset + initialStateBytes;
  const lightingOffset = resetOffset + resetBytes;
  const states = Array.from({ length: particleCount }, (_, particleIndex) => {
    const offset = initialStateOffset + particleIndex * PARTICLE_STATE_FIELD_COUNT * Float64Array.BYTES_PER_ELEMENT;
    return {
      width: view.getFloat64(offset, true),
      step: view.getFloat64(offset + 8, true),
      spinAngle: view.getFloat64(offset + 16, true),
    };
  });
  if (states.some((state) => !validParticleState(state))) {
    throw new Error(`Prepared Cyclone block ${descriptor.index} initial particle state drifted`);
  }
  const resetEvents = [];
  let previousFrameIndex = 0;
  let previousParticleIndex = -1;
  for (let eventIndex = 0; eventIndex < resetEventCount; eventIndex += 1) {
    const offset = resetOffset + eventIndex * RESET_EVENT_BYTES;
    const event = {
      frameIndex: view.getUint16(offset, true),
      particleIndex: view.getUint16(offset + 2, true),
      width: view.getFloat64(offset + 4, true),
      spinAngle: view.getFloat64(offset + 12, true),
    };
    if (event.frameIndex < 1 || event.frameIndex >= frameCount ||
        event.particleIndex >= particleCount || !Number.isFinite(event.width) || event.width <= 0 ||
        !Number.isFinite(event.spinAngle) || event.frameIndex < previousFrameIndex ||
        (event.frameIndex === previousFrameIndex && event.particleIndex <= previousParticleIndex)) {
      throw new Error(`Prepared Cyclone block ${descriptor.index} reset event drifted`);
    }
    previousFrameIndex = event.frameIndex;
    previousParticleIndex = event.particleIndex;
    resetEvents.push(event);
  }
  const transforms = new Array(frameCount * particleCount);
  let resetCursor = 0;
  let operationsSinceYield = 0;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameOffset = cycloneOffset + frameIndex * CYCLONE_FRAME_VALUE_COUNT * Float64Array.BYTES_PER_ELEMENT;
    const points = Array.from({ length: CONTROL_POINT_COUNT }, (_, pointIndex) =>
      Array.from({ length: 3 }, (unused, axis) =>
        view.getFloat64(frameOffset + (pointIndex * 3 + axis) * Float64Array.BYTES_PER_ELEMENT, true)));
    const widthOffset = frameOffset + CONTROL_POINT_COUNT * 3 * Float64Array.BYTES_PER_ELEMENT;
    const widths = Array.from({ length: CONTROL_POINT_COUNT }, (unused, widthIndex) =>
      view.getFloat64(widthOffset + widthIndex * Float64Array.BYTES_PER_ELEMENT, true));
    for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
      const reset = resetEvents[resetCursor];
      if (reset?.frameIndex === frameIndex && reset.particleIndex === particleIndex) {
        states[particleIndex] = { width: reset.width, step: 0, spinAngle: reset.spinAngle };
        resetCursor += 1;
      }
      const advanced = advanceCycloneParticleTransform({
        state: states[particleIndex],
        points,
        widths,
        deltaSeconds: catalog.frameMilliseconds / 1_000,
        speed: catalog.sourceTransformProfile.speed,
        complexity: catalog.sourceTransformProfile.complexity,
        particleSize: catalog.sourceTransformProfile.particleSize,
      });
      transforms[frameIndex * particleCount + particleIndex] =
        `matrix3d(${formatMatrix3dValues(advanced.matrix, 6)})`;
      states[particleIndex] = advanced.state;
      operationsSinceYield += 1;
      if (operationsSinceYield === 64) {
        yield operationsSinceYield;
        operationsSinceYield = 0;
      }
    }
  }
  if (operationsSinceYield > 0) yield operationsSinceYield;
  if (resetCursor !== resetEvents.length) {
    throw new Error(`Prepared Cyclone block ${descriptor.index} reset events were not consumed`);
  }
  const lightingValues = new Uint16Array(lightingValueCount);
  for (let index = 0; index < lightingValues.length; index += 1) {
    lightingValues[index] = view.getUint16(lightingOffset + index * Uint16Array.BYTES_PER_ELEMENT, true);
  }
  const preparedCssStringByteLength = transforms.reduce(
    (total, transform) => total + transform.length * Uint16Array.BYTES_PER_ELEMENT,
    0,
  );
  return Object.freeze({
    schema: "csscyclone-prepared-stream-block@2",
    streamId: catalog.streamId,
    streamBlockIndex: descriptor.index,
    chunkIndex: descriptor.chunkIndex,
    blockIndex: descriptor.blockIndex,
    startFrameIndex: descriptor.startFrameIndex,
    frameCount,
    playback: Object.freeze({
      schema: CSSCYCLONE_PLAYBACK_SCHEMA,
      modelId: catalog.modelId,
      streamId: catalog.streamId,
      streamBlockIndex: descriptor.index,
      chunkIndex: descriptor.chunkIndex,
      blockIndex: descriptor.blockIndex,
      chunkCount: catalog.chunkCount,
      blockCount: catalog.blockCount,
      blocksPerChunk: catalog.blocksPerChunk,
      startFrameIndex: descriptor.startFrameIndex,
      frameCount,
      particleCount,
      leafCount: catalog.leafCount,
      frameMilliseconds: catalog.frameMilliseconds,
      durationMilliseconds: frameCount * catalog.frameMilliseconds,
      loop: false,
      transforms: Object.freeze(transforms),
    }),
    lighting: Object.freeze({
      schema: CSSCYCLONE_LIGHTING_BLOCK_SCHEMA,
      streamId: catalog.streamId,
      streamBlockIndex: descriptor.index,
      chunkIndex: descriptor.chunkIndex,
      blockIndex: descriptor.blockIndex,
      startFrameIndex: descriptor.startFrameIndex,
      frameCount,
      particleCount,
      frameParticleColorStateIndices: lightingValues,
    }),
    preparedMatrixExpansionCount: transforms.length,
    preparedCssStringByteLength,
  });
}

function validTransformFrame(state, particleCount) {
  return state && Array.isArray(state.points) && state.points.length === CONTROL_POINT_COUNT &&
    state.points.every((point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)) &&
    Array.isArray(state.widths) && state.widths.length === CONTROL_POINT_COUNT && state.widths.every(Number.isFinite) &&
    Array.isArray(state.particles) && state.particles.length === particleCount &&
    state.particles.every((particle) => validParticleState(particle) && typeof particle.reset === "boolean");
}

function validParticleState(state) {
  return state && Number.isFinite(state.width) && state.width > 0 &&
    Number.isFinite(state.step) && Number.isFinite(state.spinAngle);
}

function validSourceProfile(profile) {
  return profile?.controlPointCount === CONTROL_POINT_COUNT && Number.isFinite(profile.speed) && profile.speed > 0 &&
    Number.isSafeInteger(profile.complexity) && profile.complexity >= 1 &&
    Number.isFinite(profile.particleSize) && profile.particleSize > 0;
}
