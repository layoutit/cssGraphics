// SPDX-License-Identifier: GPL-2.0-only
import { readPreparedBytes } from "./preparedResponse.mjs";

const LEAF_COUNT = 40;
const AFFINE_COMPONENT_COUNT = 12;
const AFFINE_SCALE = 1_000;
const CHUNK_MAGIC = Object.freeze([0x43, 0x53, 0x45, 0x50, 0x43, 0x48, 0x32, 0x00]);

export function createPreparedElectropaintChunkStore(playback, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const contract = playback?.chunks;
  if (contract?.schema !== "cssselectropaint-prepared-timeline-chunks@1" ||
      contract.continuity !== "single-prepared-state-stream-split-without-inner-resets" ||
      !Array.isArray(contract.descriptors) || contract.count !== contract.descriptors.length ||
      contract.count < 1 || contract.framesPerChunk < 40 ||
      contract.runtimeLookaheadChunkCount < 1 ||
      contract.runtimeLookaheadChunkCount > contract.count) {
    throw new Error("Prepared ElectroPaint chunk-store contract is invalid");
  }
  const descriptors = Object.freeze(contract.descriptors.map((descriptor, index) => {
    if (descriptor?.chunkIndex !== index ||
        descriptor.startStateIndex !== index * contract.framesPerChunk ||
        descriptor.stateCount !== contract.framesPerChunk || descriptor.encoding !== "gzip-binary" ||
        !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 ||
        !Number.isSafeInteger(descriptor.storedBytes) || descriptor.storedBytes < 1 ||
        !/^[a-f0-9]{64}$/u.test(descriptor.sha256) ||
        !validChunkUrl(descriptor.url)) {
      throw new Error(`Prepared ElectroPaint chunk descriptor ${index} is invalid`);
    }
    return Object.freeze({ ...descriptor });
  }));
  const requests = new Map();
  const values = new Map();
  let requestCount = 0;

  function load(index) {
    const descriptor = descriptors[index];
    if (!descriptor) throw new RangeError(`Prepared ElectroPaint chunk ${index} is out of range`);
    let request = requests.get(index);
    if (!request) {
      requestCount += 1;
      request = fetchImpl(descriptor.url, { cache: "force-cache" }).then(async (response) => {
        if (!response?.ok) {
          throw new Error(`Prepared ElectroPaint chunk ${index} request failed (${response?.status ?? "network"})`);
        }
        const chunk = decodePreparedElectropaintBinaryChunk(
          await readPreparedBytes(response),
          descriptor,
          playback.palette.length,
        );
        if (requests.get(index) === request) values.set(index, chunk);
        return chunk;
      });
      requests.set(index, request);
    }
    return request;
  }

  return Object.freeze({
    load,
    preload(indices) { return Promise.all([...new Set(indices)].map(load)); },
    loaded(index) { return values.get(index) ?? null; },
    retain(indices) {
      const retained = new Set(indices);
      for (const index of requests.keys()) {
        if (retained.has(index)) continue;
        requests.delete(index);
        values.delete(index);
      }
    },
    stats() {
      return Object.freeze({
        requestCount,
        loadedChunkCount: values.size,
        retainedRequestCount: requests.size,
      });
    },
  });
}

export function decodePreparedElectropaintBinaryChunk(bytes, descriptor, paletteCount) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== descriptor.bytes || bytes.byteLength < 26 ||
      CHUNK_MAGIC.some((value, index) => bytes[index] !== value)) {
    throw new Error(`Prepared ElectroPaint binary chunk ${descriptor.chunkIndex} header drifted`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkIndex = view.getUint16(8, true);
  const startStateIndex = view.getUint32(10, true);
  const stateCount = view.getUint16(14, true);
  const transformAssignmentCount = view.getUint32(16, true);
  const colorAssignmentCount = view.getUint16(20, true);
  const affineDeltaByteLength = view.getUint32(22, true);
  if (chunkIndex !== descriptor.chunkIndex || startStateIndex !== descriptor.startStateIndex ||
      stateCount !== descriptor.stateCount ||
      transformAssignmentCount !== descriptor.transformAssignmentCount ||
      colorAssignmentCount !== descriptor.colorAssignmentCount || colorAssignmentCount > stateCount) {
    throw new Error(`Prepared ElectroPaint binary chunk ${descriptor.chunkIndex} metadata drifted`);
  }
  let offset = 26;
  const leafTransforms = new Array(LEAF_COUNT);
  for (let leafIndex = 0; leafIndex < LEAF_COUNT; leafIndex += 1) {
    const affine = new Array(AFFINE_COMPONENT_COUNT);
    for (let componentIndex = 0; componentIndex < AFFINE_COMPONENT_COUNT; componentIndex += 1) {
      affine[componentIndex] = view.getInt32(offset, true) / AFFINE_SCALE;
      offset += 4;
    }
    leafTransforms[leafIndex] = matrix3dFromAffine(affine);
  }
  const initialColorIndices = new Array(LEAF_COUNT);
  for (let leafIndex = 0; leafIndex < LEAF_COUNT; leafIndex += 1) {
    initialColorIndices[leafIndex] = view.getUint16(offset, true);
    offset += 2;
  }
  const colorOffsets = new Uint16Array(stateCount + 1);
  for (let index = 0; index < colorOffsets.length; index += 1) {
    colorOffsets[index] = view.getUint16(offset, true);
    offset += 2;
  }
  const colorPhysicalIndices = bytes.slice(offset, offset + colorAssignmentCount);
  offset += colorAssignmentCount;
  const colorIndices = new Uint16Array(colorAssignmentCount);
  for (let index = 0; index < colorAssignmentCount; index += 1) {
    colorIndices[index] = view.getUint16(offset, true);
    offset += 2;
  }
  const affineDeltas = bytes.slice(offset, offset + affineDeltaByteLength);
  offset += affineDeltaByteLength;
  if (offset !== bytes.byteLength || colorOffsets[0] !== 0 ||
      colorOffsets.at(-1) !== colorAssignmentCount ||
      initialColorIndices.some((value) => value >= paletteCount) ||
      colorPhysicalIndices.some((value) => value >= LEAF_COUNT) ||
      colorIndices.some((value) => value >= paletteCount)) {
    throw new Error(`Prepared ElectroPaint binary chunk ${descriptor.chunkIndex} body drifted`);
  }
  const transformOffsets = new Uint32Array(stateCount + 1);
  const transformPhysicalIndices = new Uint8Array(transformAssignmentCount);
  let assignment = 0;
  for (let localStateIndex = 0; localStateIndex < stateCount; localStateIndex += 1) {
    transformOffsets[localStateIndex] = assignment;
    const count = startStateIndex === 0 && localStateIndex === 0 ? 0 : LEAF_COUNT;
    const globalStateIndex = startStateIndex + localStateIndex;
    for (let logicalIndex = 0; logicalIndex < count; logicalIndex += 1) {
      transformPhysicalIndices[assignment] = physicalIndexFor(globalStateIndex, logicalIndex);
      assignment += 1;
    }
  }
  transformOffsets[stateCount] = assignment;
  if (assignment !== transformAssignmentCount) {
    throw new Error(`Prepared ElectroPaint binary chunk ${descriptor.chunkIndex} transform count drifted`);
  }
  return Object.freeze({
    schema: "cssselectropaint-prepared-timeline-chunk@2",
    chunkIndex,
    startStateIndex,
    stateCount,
    initial: Object.freeze({
      globalStateIndex: startStateIndex,
      leafTransforms: Object.freeze(leafTransforms),
      colorIndices: Object.freeze(initialColorIndices),
    }),
    transformSchedule: Object.freeze({
      schema: "cssselectropaint-prepared-chunk-transform-schedule@2",
      encoding: "implicit-ring-addresses-plus-third-order-zigzag-varint-quantized-affine12",
      stateCount,
      assignmentCount: transformAssignmentCount,
      maximumAssignmentsPerState: LEAF_COUNT,
      offsets: transformOffsets,
      physicalIndices: transformPhysicalIndices,
      affineComponentCount: AFFINE_COMPONENT_COUNT,
      affineQuantizationScale: AFFINE_SCALE,
      affinePredictorOrder: 3,
      affineDeltas,
      decodedMatrixStringCount: transformAssignmentCount,
      runtimeSelection: "prepared-state-range-only-no-leaf-wide-transform-comparisons",
    }),
    colorSchedule: Object.freeze({
      schema: "cssselectropaint-prepared-chunk-color-schedule@1",
      stateCount,
      assignmentCount: colorAssignmentCount,
      maximumAssignmentsPerState: 1,
      offsets: colorOffsets,
      physicalIndices: colorPhysicalIndices,
      colorIndices,
      runtimeSelection: "prepared-state-range-only-no-leaf-wide-color-comparisons",
    }),
  });
}

function physicalIndexFor(stateIndex, logicalIndex) {
  return ((logicalIndex - stateIndex) % LEAF_COUNT + LEAF_COUNT) % LEAF_COUNT;
}

function matrix3dFromAffine(values) {
  return `matrix3d(${[
    values[0], values[1], values[2], 0,
    values[3], values[4], values[5], 0,
    values[6], values[7], values[8], 0,
    values[9], values[10], values[11], 1,
  ].map(canonicalNumber).join(",")})`;
}

function canonicalNumber(value) {
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return "0";
  return Number(value.toFixed(12)).toString();
}

function validChunkUrl(url) {
  return typeof url === "string" &&
    /^\/cssselectropaint\/variants\/[a-z0-9-]+\/chunks\/chunk-\d{3}-[a-f0-9]{16}\.bin\.gz$/u.test(url) &&
    !url.includes("..");
}
