// SPDX-License-Identifier: GPL-2.0-only
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  createPreparedKentMotion,
  KENT_HISTORY_LENGTH,
  KENT_SEED,
  KENT_SOURCE_TICKS_PER_SECOND,
  KENT_SOURCE_VIEWPORT,
  KENT_SQUARE_SIZE_PIXELS,
} from "./kentMotion.mjs";

export const SOURCE_CHUNK_COUNT = 128;
export const SOURCE_FRAMES_PER_CHUNK = 500;
export const SOURCE_FRAME_COUNT = SOURCE_CHUNK_COUNT * SOURCE_FRAMES_PER_CHUNK;
export const SOURCE_FRAME_DELAY_MILLISECONDS = 1_000 / KENT_SOURCE_TICKS_PER_SECOND;
export const SOURCE_DISPLAY_PERIOD_MICROSECONDS = 1_000_000 / KENT_SOURCE_TICKS_PER_SECOND;
export const PREPARED_AFFINE_QUANTIZATION_SCALE = 1_000;

const WITNESS_STATE_INDICES = new Set([0, 39, 359, 1_199, 9_999, 31_999, 63_999]);

function presentationCadence(stateCount) {
  return Object.freeze({
    policy: "fixed-kent-animation-interval",
    dynamic: false,
    statesPerDisplay: 1,
    sourceTicksPerSecond: KENT_SOURCE_TICKS_PER_SECOND,
    sourceFrameDelayMilliseconds: SOURCE_FRAME_DELAY_MILLISECONDS,
    sourceLoopCadence: "one-kent-random-walk-step-per-60hz-animation-callback",
    runtimeSelection: "single-constant-frame-period-no-cadence-table",
    effectiveMeanStatesPerSecond: KENT_SOURCE_TICKS_PER_SECOND,
    totalDurationMilliseconds: stateCount * SOURCE_FRAME_DELAY_MILLISECONDS,
  });
}

export function buildPreparedElectropaintScene(authorities, options = {}) {
  if (!authorities?.kentReference?.commit || !authorities?.ralphReference?.commit ||
      !authorities?.browserReference?.commit) {
    throw new Error("ElectroPaint preparation requires verified Kent motion authorities");
  }
  const chunkCount = options.chunkCount ?? SOURCE_CHUNK_COUNT;
  const framesPerChunk = options.framesPerChunk ?? SOURCE_FRAMES_PER_CHUNK;
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 256 ||
      !Number.isSafeInteger(framesPerChunk) || framesPerChunk < 40 || framesPerChunk > 10_000) {
    throw new RangeError("ElectroPaint chunk preparation dimensions are invalid");
  }
  const stateCount = chunkCount * framesPerChunk;
  const cadence = presentationCadence(stateCount);
  const emitChunk = options.emitChunk ?? ((chunk) => serializePreparedElectropaintChunk(chunk).descriptor);
  const palette = [];
  const paletteIndices = new Map();
  const seed = options.seed ?? KENT_SEED;
  const warmupStateCount = options.warmupStateCount ?? 0;
  const sceneId = options.sceneId ?? "default-kent";
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff ||
      !Number.isSafeInteger(warmupStateCount) || warmupStateCount < 0 || warmupStateCount > 1_000_000 ||
      !/^[a-z0-9-]+$/u.test(sceneId)) {
    throw new RangeError("ElectroPaint Kent variant preparation options are invalid");
  }
  const motion = createPreparedKentMotion(seed);
  for (let warmupIndex = 0; warmupIndex < warmupStateCount; warmupIndex += 1) motion.step();
  const randomStateWitnesses = [];
  const chunkDescriptors = [];
  let initialTransforms = null;
  let initialColorIndices = null;
  let physicalTransforms = null;
  let physicalColorIndices = null;
  let transformAssignmentCount = 0;
  let colorAssignmentCount = 0;

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const transformRows = Array.from({ length: framesPerChunk }, () => []);
    const colorRows = Array.from({ length: framesPerChunk }, () => []);
    let chunkInitial = null;
    for (let localStateIndex = 0; localStateIndex < framesPerChunk; localStateIndex += 1) {
      const globalStateIndex = chunkIndex * framesPerChunk + localStateIndex;
      if (globalStateIndex > 0) motion.step();
      const frame = motion.readFrame();
      const matrices = frame.matrices.map(canonicalMatrix);
      const transforms = matrices.map(preparedMatrix3d);
      const colors = frame.colors.map((color) => paletteIndex(palette, paletteIndices, color));
      if (globalStateIndex === 0) {
        initialTransforms = [...transforms];
        initialColorIndices = [...colors];
        physicalTransforms = [...transforms];
        physicalColorIndices = [...colors];
      } else {
        for (let logicalIndex = 0; logicalIndex < KENT_HISTORY_LENGTH; logicalIndex += 1) {
          const physicalIndex = physicalIndexFor(globalStateIndex, logicalIndex);
          const transform = transforms[logicalIndex];
          if (physicalTransforms[physicalIndex] !== transform) {
            transformRows[localStateIndex].push(Object.freeze({
              physicalIndex,
              affine: Object.freeze(affine12(matrices[logicalIndex])),
            }));
            physicalTransforms[physicalIndex] = transform;
          }
          const colorIndex = colors[logicalIndex];
          if (physicalColorIndices[physicalIndex] !== colorIndex) {
            colorRows[localStateIndex].push(Object.freeze({ physicalIndex, colorIndex }));
            physicalColorIndices[physicalIndex] = colorIndex;
          }
        }
      }
      if (localStateIndex === 0) {
        chunkInitial = Object.freeze({
          globalStateIndex,
          leafTransforms: Object.freeze([...physicalTransforms]),
          colorIndices: Object.freeze([...physicalColorIndices]),
        });
      }
      if (WITNESS_STATE_INDICES.has(globalStateIndex) || globalStateIndex === stateCount - 1) {
        randomStateWitnesses.push(Object.freeze({
          stateIndex: globalStateIndex,
          randomState: motion.randomState(),
        }));
      }
    }
    const transformSchedule = encodeTransformSchedule(transformRows);
    const colorSchedule = encodeColorSchedule(colorRows);
    transformAssignmentCount += transformSchedule.assignmentCount;
    colorAssignmentCount += colorSchedule.assignmentCount;
    const chunk = Object.freeze({
      schema: "cssselectropaint-prepared-timeline-chunk@1",
      chunkIndex,
      startStateIndex: chunkIndex * framesPerChunk,
      stateCount: framesPerChunk,
      initial: chunkInitial,
      transformSchedule,
      colorSchedule,
    });
    const descriptor = emitChunk(chunk);
    assertChunkDescriptor(descriptor, chunk);
    chunkDescriptors.push(Object.freeze(descriptor));
  }

  if (palette.length > 65_535) {
    throw new Error(`ElectroPaint prepared palette exceeded uint16 capacity: ${palette.length}`);
  }
  const restart = Object.freeze({
    schema: "cssselectropaint-prepared-restart@1",
    transformCount: KENT_HISTORY_LENGTH,
    colorCount: KENT_HISTORY_LENGTH,
    leafTransforms: Object.freeze([...initialTransforms]),
    colorIndices: Object.freeze([...initialColorIndices]),
  });
  const playback = buildPreparedPlayback({
    stateCount,
    chunkCount,
    framesPerChunk,
    cadence,
    palette,
    initialTransforms,
    initialColorIndices,
    restart,
    chunkDescriptors,
    transformAssignmentCount,
    colorAssignmentCount,
  });
  const halfSquareWorldUnits = KENT_SQUARE_SIZE_PIXELS / 100;
  return Object.freeze({
    schema: "cssselectropaint-prepared-scene@2",
    id: sceneId,
    label: "ElectroPaint — Kent motion",
    mode: "model-viewer",
    artifactMode: "prepared-polycss-snapshot-plus-timeline-chunks",
    source: authorities,
    sourceProfile: Object.freeze({
      schema: "cssselectropaint-source-profile@3",
      program: "ElectroPaint",
      motion: "Kent Rosenkoetter random-walk clone",
      deterministicPreparationSeed: `0x${seed.toString(16)}`,
      discardedWarmupStateCount: warmupStateCount,
      seedPolicy: "fixed-prepare-time-variant-seed-and-warmup-for-repeatable-publication",
      sourceFrameCount: stateCount,
      presentationCadence: cadence,
      historyLength: KENT_HISTORY_LENGTH,
      visibleSquareCount: KENT_HISTORY_LENGTH,
      sourceSquareSizeAt960x540: KENT_SQUARE_SIZE_PIXELS,
      sourceQuad: Object.freeze([
        [-halfSquareWorldUnits, -halfSquareWorldUnits, 0],
        [halfSquareWorldUnits, -halfSquareWorldUnits, 0],
        [halfSquareWorldUnits, halfSquareWorldUnits, 0],
        [-halfSquareWorldUnits, halfSquareWorldUnits, 0],
      ]),
      interpretation: "deterministic prepare-time execution of the pinned Kent-derived random-walk and CSS transform order",
      nativePixelParity: "not-claimed",
      sourceStateParity: "source-parameter-and-transform-order-bound; stochastic sequence intentionally deterministic",
    }),
    camera: Object.freeze({
      projection: "css-perspective",
      perspective: 1_000,
      perspectiveOrigin: "50% 75%",
      sourceViewport: KENT_SOURCE_VIEWPORT,
      rootTransform: "translateY(135px) rotateX(45deg)",
      zoom: 50,
      rotX: 0,
      rotY: 0,
      target: Object.freeze([0, 0, 0]),
      distance: 0,
    }),
    renderer: Object.freeze({
      package: "@layoutit/polycss",
      version: "0.2.11",
      representation: "forty-ring-mapped-flat-polycss-b-quads",
      stableDom: true,
      preparedFlatPolycssQuadLeaves: true,
      preparedSparseStateRanges: true,
      runtimeGeometryPayload: true,
      runtimeLeafWideComparison: false,
      runtimeGeometryConstruction: false,
      runtimeMatrixCalculation: false,
      runtimeColorCalculation: false,
      runtimeRandomGeneration: false,
      runtimeCameraCalculation: false,
      runtimeCadenceCalculation: false,
      runtimeDomGrowth: false,
      alternateRenderer: false,
    }),
    lighting: Object.freeze({
      ambient: Object.freeze({ color: "#ffffff", intensity: 1 }),
      directional: Object.freeze({ direction: Object.freeze([0, -1, 0]), color: "#ffffff", intensity: 0 }),
    }),
    playback,
    meshes: Object.freeze(Array.from({ length: KENT_HISTORY_LENGTH }, (_, index) => Object.freeze({
      id: `kent-wing-${String(index).padStart(2, "0")}`,
      sourceHistoryOffset: index,
      polygons: Object.freeze([Object.freeze({
        vertices: Object.freeze([
          [-halfSquareWorldUnits, -halfSquareWorldUnits, 0],
          [-halfSquareWorldUnits, halfSquareWorldUnits, 0],
          [halfSquareWorldUnits, halfSquareWorldUnits, 0],
          [halfSquareWorldUnits, -halfSquareWorldUnits, 0],
        ]),
        normals: Object.freeze([[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]]),
        material: Object.freeze([1, 1, 1, 1]),
      })]),
    }))),
    metrics: Object.freeze({
      preparedRetainedQuadCount: KENT_HISTORY_LENGTH,
      preparedPolygonLeafCount: KENT_HISTORY_LENGTH,
      preparedTimelineStateCount: stateCount,
      preparedTimelineChunkCount: chunkCount,
      preparedFramesPerChunk: framesPerChunk,
      preparedPaletteEntryCount: palette.length,
      preparedLeafTransformAssignmentCount: transformAssignmentCount,
      preparedColorClassAssignmentCount: colorAssignmentCount,
      preparedMeanLeafTransformAssignmentsPerSequentialState:
        transformAssignmentCount / (stateCount - 1),
      preparedMeanColorAssignmentsPerSequentialState:
        colorAssignmentCount / (stateCount - 1),
      preparedChunkStoredBytes: chunkDescriptors.reduce((total, descriptor) => total + descriptor.storedBytes, 0),
      runtimeRootTransformWriteCount: 0,
      runtimeLeafWideComparisonCount: 0,
      runtimeOutlineWriteCount: 0,
      runtimeGeometryConstructionCount: 0,
      runtimeMatrixCalculationCount: 0,
      runtimeColorCalculationCount: 0,
      runtimeRandomGenerationCount: 0,
      runtimeCameraCalculationCount: 0,
      runtimeCadenceCalculationCount: 0,
      runtimeCadenceDelayLookupCount: 0,
      runtimeDomGrowth: false,
    }),
    oracle: Object.freeze({
      sourceIdentity: "exact-pinned-commit-and-file-hashes",
      deterministicState: "prepared-kent-derived-random-walk",
      randomStateWitnesses: Object.freeze(randomStateWitnesses),
      browserVisualCapture: "pending-retained-dom-capture",
      nativeVisualCapture: "not-yet-captured",
      nativeBrowserVisualParity: "not-claimed",
      nativePixelParity: "not-claimed",
    }),
    warnings: Object.freeze([
      "This uses only the Kent-derived motion program; no alternate ElectroPaint program is included.",
      "Kent's random motion is frozen into reproducible seed-and-warmup banks at preparation.",
      "The browser selects one prepared bank per page load, retains one 40-wing DOM bank, and fetches only that bank's four-chunk horizon.",
      "Every runtime transform and palette assignment is selected from prepared state ranges; no source motion or renderer runs in the browser.",
      `The ${stateCount.toLocaleString("en-US")}-state timeline restarts after ${(stateCount / 60).toFixed(1)} seconds and is not claimed to be a natural random-walk period.`,
      "Visual parity is pending a dedicated Kent-native oracle and is not inferred from another implementation.",
    ]),
  });
}

export function serializePreparedElectropaintChunk(chunk, options = {}) {
  const sceneId = options.sceneId ?? "default-kent";
  if (!/^[a-z0-9-]+$/u.test(sceneId)) throw new Error("Prepared ElectroPaint chunk scene id is invalid");
  const bytes = encodePreparedElectropaintChunkBinary(chunk);
  const payload = gzipSync(bytes, { level: 9 });
  const hash = createHash("sha256").update(payload).digest("hex");
  const fileName = `chunk-${String(chunk.chunkIndex).padStart(3, "0")}-${hash.slice(0, 16)}.bin.gz`;
  return Object.freeze({
    payload,
    descriptor: Object.freeze({
      chunkIndex: chunk.chunkIndex,
      startStateIndex: chunk.startStateIndex,
      stateCount: chunk.stateCount,
      url: `/cssselectropaint/variants/${sceneId}/chunks/${fileName}`,
      sha256: hash,
      encoding: "gzip-binary",
      bytes: bytes.byteLength,
      storedBytes: payload.byteLength,
      transformAssignmentCount: chunk.transformSchedule.assignmentCount,
      colorAssignmentCount: chunk.colorSchedule.assignmentCount,
    }),
  });
}

function encodePreparedElectropaintChunkBinary(chunk) {
  const transform = chunk.transformSchedule;
  const color = chunk.colorSchedule;
  if (chunk.initial?.leafTransforms?.length !== KENT_HISTORY_LENGTH ||
      chunk.initial.colorIndices?.length !== KENT_HISTORY_LENGTH ||
      transform?.schema !== "cssselectropaint-prepared-chunk-transform-schedule@2" ||
      transform.affineQuantizationScale !== PREPARED_AFFINE_QUANTIZATION_SCALE ||
      color?.schema !== "cssselectropaint-prepared-chunk-color-schedule@1" ||
      color.assignmentCount > 65_535 || color.offsets.some((value) => value > 65_535)) {
    throw new Error(`Prepared ElectroPaint binary chunk ${chunk.chunkIndex} is invalid`);
  }
  const physicalIndices = Buffer.from(transform.physicalIndicesBase64, "base64");
  assertImplicitTransformAddresses(chunk, physicalIndices);
  const affineDeltas = Buffer.from(transform.affineDeltasBase64, "base64");
  const colorPhysicalIndices = Buffer.from(color.physicalIndicesBase64, "base64");
  const colorIndices = Buffer.from(color.colorIndicesBase64, "base64");
  const headerBytes = 26;
  const initialAffineBytes = KENT_HISTORY_LENGTH * 12 * 4;
  const initialColorBytes = KENT_HISTORY_LENGTH * 2;
  const colorOffsetBytes = (chunk.stateCount + 1) * 2;
  const totalBytes = headerBytes + initialAffineBytes + initialColorBytes + colorOffsetBytes +
    colorPhysicalIndices.byteLength + colorIndices.byteLength + affineDeltas.byteLength;
  const output = Buffer.allocUnsafe(totalBytes);
  output.write("CSEPCH2\0", 0, "ascii");
  output.writeUInt16LE(chunk.chunkIndex, 8);
  output.writeUInt32LE(chunk.startStateIndex, 10);
  output.writeUInt16LE(chunk.stateCount, 14);
  output.writeUInt32LE(transform.assignmentCount, 16);
  output.writeUInt16LE(color.assignmentCount, 20);
  output.writeUInt32LE(affineDeltas.byteLength, 22);
  let offset = headerBytes;
  for (const transformString of chunk.initial.leafTransforms) {
    const affine = affine12(parseMatrix3d(transformString));
    for (const value of affine) {
      output.writeInt32LE(Math.round(value * PREPARED_AFFINE_QUANTIZATION_SCALE), offset);
      offset += 4;
    }
  }
  for (const colorIndex of chunk.initial.colorIndices) {
    output.writeUInt16LE(colorIndex, offset);
    offset += 2;
  }
  for (const colorOffset of color.offsets) {
    output.writeUInt16LE(colorOffset, offset);
    offset += 2;
  }
  colorPhysicalIndices.copy(output, offset);
  offset += colorPhysicalIndices.byteLength;
  colorIndices.copy(output, offset);
  offset += colorIndices.byteLength;
  affineDeltas.copy(output, offset);
  offset += affineDeltas.byteLength;
  if (offset !== output.byteLength) throw new Error("Prepared ElectroPaint binary chunk length drifted");
  return output;
}

function assertImplicitTransformAddresses(chunk, physicalIndices) {
  let assignment = 0;
  for (let localStateIndex = 0; localStateIndex < chunk.stateCount; localStateIndex += 1) {
    const expectedCount = chunk.startStateIndex === 0 && localStateIndex === 0 ? 0 : KENT_HISTORY_LENGTH;
    if (chunk.transformSchedule.offsets[localStateIndex] !== assignment ||
        chunk.transformSchedule.offsets[localStateIndex + 1] !== assignment + expectedCount) {
      throw new Error(`Prepared ElectroPaint chunk ${chunk.chunkIndex} transform ranges are not implicit`);
    }
    const globalStateIndex = chunk.startStateIndex + localStateIndex;
    for (let logicalIndex = 0; logicalIndex < expectedCount; logicalIndex += 1) {
      if (physicalIndices[assignment] !== physicalIndexFor(globalStateIndex, logicalIndex)) {
        throw new Error(`Prepared ElectroPaint chunk ${chunk.chunkIndex} transform addresses are not implicit`);
      }
      assignment += 1;
    }
  }
  if (assignment !== physicalIndices.byteLength) {
    throw new Error(`Prepared ElectroPaint chunk ${chunk.chunkIndex} transform address count drifted`);
  }
}

function parseMatrix3d(value) {
  if (!/^matrix3d\([^)]+\)$/u.test(value)) throw new Error("Prepared ElectroPaint matrix string is invalid");
  const values = value.slice(9, -1).split(",").map(Number);
  if (values.length !== 16 || values.some((component) => !Number.isFinite(component))) {
    throw new Error("Prepared ElectroPaint matrix string component count drifted");
  }
  return values;
}

function buildPreparedPlayback({
  stateCount,
  chunkCount,
  framesPerChunk,
  cadence,
  palette,
  initialTransforms,
  initialColorIndices,
  restart,
  chunkDescriptors,
  transformAssignmentCount,
  colorAssignmentCount,
}) {
  return Object.freeze({
    schema: "cssselectropaint-prepared-playback@4",
    stateCount,
    sourceFrameDelayMilliseconds: SOURCE_FRAME_DELAY_MILLISECONDS,
    presentationCadence: cadence,
    loop: true,
    initialStateIndex: 0,
    historyRingStride: 1,
    rootTransform: "translateY(135px) rotateX(45deg)",
    initial: Object.freeze({
      stateIndex: 0,
      leafTransforms: Object.freeze(initialTransforms),
      colorIndices: Object.freeze(initialColorIndices),
    }),
    palette: Object.freeze(palette),
    chunks: Object.freeze({
      schema: "cssselectropaint-prepared-timeline-chunks@1",
      continuity: "single-prepared-state-stream-split-without-inner-resets",
      count: chunkCount,
      framesPerChunk,
      runtimeLookaheadChunkCount: Math.min(4, chunkCount),
      totalBytes: chunkDescriptors.reduce((total, descriptor) => total + descriptor.bytes, 0),
      totalStoredBytes: chunkDescriptors.reduce((total, descriptor) => total + descriptor.storedBytes, 0),
      maximumStoredBytes: Math.max(...chunkDescriptors.map((descriptor) => descriptor.storedBytes)),
      descriptors: Object.freeze(chunkDescriptors),
    }),
    restart,
    metrics: Object.freeze({
      transformAssignmentCount,
      colorAssignmentCount,
      maximumTransformAssignmentsPerSequentialState: KENT_HISTORY_LENGTH,
      maximumColorAssignmentsPerSequentialState: 1,
      innerChunkBoundaryResetCount: 0,
      meanTransformAssignmentsPerSequentialState: transformAssignmentCount / (stateCount - 1),
      meanColorAssignmentsPerSequentialState: colorAssignmentCount / (stateCount - 1),
    }),
    outline: Object.freeze({ invariant: true, style: "solid-white-1px", runtimeWrites: 0 }),
  });
}

function encodeTransformSchedule(rows) {
  const offsets = [0];
  const indices = [];
  const affineValues = [];
  for (const row of rows) {
    for (const assignment of row) {
      indices.push(assignment.physicalIndex);
      affineValues.push(assignment.affine);
    }
    offsets.push(indices.length);
  }
  const packed = encodePredictedAffineValues(indices, affineValues);
  return Object.freeze({
    schema: "cssselectropaint-prepared-chunk-transform-schedule@2",
    encoding: "base64-u8-physical-indices-plus-third-order-zigzag-varint-quantized-affine12",
    stateCount: rows.length,
    assignmentCount: indices.length,
    maximumAssignmentsPerState: Math.max(...rows.map((row) => row.length)),
    offsets: Object.freeze(offsets),
    physicalIndicesBase64: encodeUint8(indices),
    affineComponentCount: 12,
    affineQuantizationScale: PREPARED_AFFINE_QUANTIZATION_SCALE,
    affinePredictorOrder: 3,
    affineDeltasBase64: packed.toString("base64"),
    decodedMatrixStringCount: indices.length,
    runtimeSelection: "prepared-state-range-only-no-leaf-wide-transform-comparisons",
  });
}

function encodePredictedAffineValues(physicalIndices, affineValues) {
  const histories = Array.from({ length: KENT_HISTORY_LENGTH }, () =>
    Array.from({ length: 12 }, () => [0, 0, 0]));
  const output = [];
  for (let assignmentIndex = 0; assignmentIndex < physicalIndices.length; assignmentIndex += 1) {
    const physicalIndex = physicalIndices[assignmentIndex];
    const affine = affineValues[assignmentIndex];
    for (let componentIndex = 0; componentIndex < 12; componentIndex += 1) {
      const value = Math.round(affine[componentIndex] * PREPARED_AFFINE_QUANTIZATION_SCALE);
      const history = histories[physicalIndex][componentIndex];
      const predicted = 3 * history[0] - 3 * history[1] + history[2];
      encodeUnsignedVarint(zigzag(value - predicted), output);
      history[2] = history[1];
      history[1] = history[0];
      history[0] = value;
    }
  }
  return Buffer.from(output);
}

function zigzag(value) {
  if (!Number.isSafeInteger(value)) throw new Error("Prepared ElectroPaint affine delta exceeded safe integer range");
  return value < 0 ? (-value * 2) - 1 : value * 2;
}

function encodeUnsignedVarint(value, output) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Prepared ElectroPaint affine varint is invalid");
  }
  while (value >= 0x80) {
    output.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  output.push(value);
}

function encodeColorSchedule(rows) {
  const offsets = [0];
  const indices = [];
  const colorIndices = [];
  for (const row of rows) {
    for (const assignment of row) {
      indices.push(assignment.physicalIndex);
      colorIndices.push(assignment.colorIndex);
    }
    offsets.push(indices.length);
  }
  return Object.freeze({
    schema: "cssselectropaint-prepared-chunk-color-schedule@1",
    encoding: "base64-u8-physical-indices-plus-base64-u16le-palette-indices-state-major-ranges",
    stateCount: rows.length,
    assignmentCount: indices.length,
    maximumAssignmentsPerState: Math.max(...rows.map((row) => row.length)),
    offsets: Object.freeze(offsets),
    physicalIndicesBase64: encodeUint8(indices),
    colorIndicesBase64: encodeUint16(colorIndices),
    runtimeSelection: "prepared-state-range-only-no-leaf-wide-color-comparisons",
  });
}

function assertChunkDescriptor(descriptor, chunk) {
  if (descriptor?.chunkIndex !== chunk.chunkIndex ||
      descriptor.startStateIndex !== chunk.startStateIndex ||
      descriptor.stateCount !== chunk.stateCount ||
      descriptor.encoding !== "gzip-binary" || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 ||
      !Number.isSafeInteger(descriptor.storedBytes) || descriptor.storedBytes < 1 ||
      !/^[a-f0-9]{64}$/u.test(descriptor.sha256) ||
      descriptor.transformAssignmentCount !== chunk.transformSchedule.assignmentCount ||
      descriptor.colorAssignmentCount !== chunk.colorSchedule.assignmentCount ||
      !/^\/cssselectropaint\/variants\/[a-z0-9-]+\/chunks\/chunk-\d{3}-[a-f0-9]{16}\.bin\.gz$/u
        .test(descriptor.url) || descriptor.url.includes("..")) {
    throw new Error(`Prepared ElectroPaint chunk descriptor ${chunk.chunkIndex} is invalid`);
  }
}

function physicalIndexFor(stateIndex, logicalIndex) {
  return ((logicalIndex - stateIndex) % KENT_HISTORY_LENGTH + KENT_HISTORY_LENGTH) % KENT_HISTORY_LENGTH;
}

function canonicalMatrix(values) { return values.map((value) => Number(number(value))); }

function encodeUint8(values) { return Buffer.from(Uint8Array.from(values)).toString("base64"); }

function encodeUint16(values) {
  const bytes = Buffer.alloc(values.length * 2);
  for (let index = 0; index < values.length; index += 1) bytes.writeUInt16LE(values[index], index * 2);
  return bytes.toString("base64");
}

function paletteIndex(palette, indices, color) {
  const fill = rgb(color);
  let index = indices.get(fill);
  if (index === undefined) {
    index = palette.length;
    palette.push(Object.freeze({ fill, outline: "rgb(255 255 255)", className: `cp${index}` }));
    indices.set(fill, index);
  }
  return index;
}

function rgb(color) {
  return `rgb(${color.map((component) => Math.max(0, Math.min(255, Math.round(component * 255)))).join(" ")})`;
}

function matrix3d(values) { return `matrix3d(${values.map(number).join(",")})`; }

function preparedMatrix3d(matrix) {
  const affine = affine12(matrix).map((value) =>
    Math.round(value * PREPARED_AFFINE_QUANTIZATION_SCALE) / PREPARED_AFFINE_QUANTIZATION_SCALE);
  return matrix3d([
    affine[0], affine[1], affine[2], 0,
    affine[3], affine[4], affine[5], 0,
    affine[6], affine[7], affine[8], 0,
    affine[9], affine[10], affine[11], 1,
  ]);
}

function affine12(matrix) {
  return [
    matrix[0], matrix[1], matrix[2],
    matrix[4], matrix[5], matrix[6],
    matrix[8], matrix[9], matrix[10],
    matrix[12], matrix[13], matrix[14],
  ];
}

function number(value) {
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return "0";
  return Number(value.toFixed(12)).toString();
}
