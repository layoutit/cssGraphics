export const CSSGRAPHICS_PREPARED_LIGHTING_SECTION_SCHEMA =
  "cssgraphics.prepared-lighting-section@1";

const PACKED_SOURCE_FRAMES_ENCODING = "face-major-delta-json";
const PACKED_BACKGROUND_POSITION_Y_ENCODING =
  "derived-from-source-frame-and-face-height";
const PACKED_TRANSITION_ENCODING =
  "csr-offsets-delta-json-face-and-state-indices";
const EXPANDED_SOURCE_FRAMES_ENCODING = "face-major-uint16le-base64";
const EXPANDED_BACKGROUND_POSITION_Y_ENCODING =
  "face-major-css-pixel-array";
const EXPANDED_TRANSITION_ENCODING =
  "csr-uint32le-offsets-parallel-uint16le-visible-face-state-indices-base64";

type JsonRecord = Record<string, unknown>;

interface LightingParts {
  readonly lighting: JsonRecord;
  readonly contract: JsonRecord;
  readonly surface: JsonRecord;
  readonly packing: JsonRecord;
  readonly faces: unknown[];
  readonly transitions: JsonRecord;
  readonly sequential: JsonRecord;
}

interface FaceRange {
  readonly stateOffset: number;
  readonly count: number;
  readonly leafHeight: number;
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function integer(
  value: unknown,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)
    || value < 0 || value > maximum) {
    throw new TypeError(`${label} must be an integer from 0 through ${maximum}.`);
  }
  return value;
}

function base64Bytes(value: unknown, label: string): Uint8Array {
  if (typeof value !== "string") throw new TypeError(`${label} must be base64.`);
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new TypeError(`${label} must be base64.`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

function uintsFromBase64(
  value: unknown,
  width: number,
  label: string,
): number[] {
  const bytes = base64Bytes(value, label);
  if (bytes.length % width !== 0) {
    throw new TypeError(`${label} has an invalid byte length.`);
  }
  const values: number[] = new Array(bytes.length / width);
  for (let index = 0; index < values.length; index += 1) {
    let valueAtIndex = 0;
    for (let byte = 0; byte < width; byte += 1) {
      valueAtIndex += bytes[index * width + byte] * (2 ** (byte * 8));
    }
    values[index] = valueAtIndex;
  }
  return values;
}

function uintsBase64(
  values: readonly unknown[],
  width: number,
  label: string,
): string {
  const maximum = width === 2 ? 0xffff : 0xffff_ffff;
  const bytes = new Uint8Array(values.length * width);
  for (let index = 0; index < values.length; index += 1) {
    const value = integer(values[index], `${label}[${index}]`, maximum);
    for (let byte = 0; byte < width; byte += 1) {
      bytes[index * width + byte] = Math.floor(value / (2 ** (byte * 8))) & 0xff;
    }
  }
  return bytesBase64(bytes);
}

function lightingParts(section: unknown, label: string): LightingParts {
  const lighting = record(section, label);
  const contract = record(lighting.contract, `${label}.contract`);
  const surface = record(contract.surface, `${label}.contract.surface`);
  const packing = record(surface.statePacking, `${label}.contract.surface.statePacking`);
  const faces = array(surface.faces, `${label}.contract.surface.faces`);
  const transitions = record(contract.transitions, `${label}.contract.transitions`);
  const sequential = record(transitions.sequential, `${label}.contract.transitions.sequential`);
  return { lighting, contract, surface, packing, faces, transitions, sequential };
}

function faceRanges(
  faces: readonly unknown[],
  stateCount: number,
  label: string,
): FaceRange[] {
  let expectedOffset = 0;
  const ranges = faces.map((faceValue, faceIndex) => {
    const face = record(faceValue, `${label}[${faceIndex}]`);
    const stateOffset = integer(face.stateOffset, `${label}[${faceIndex}].stateOffset`);
    const count = integer(face.stateCount, `${label}[${faceIndex}].stateCount`);
    const leafHeight = integer(face.leafHeight, `${label}[${faceIndex}].leafHeight`);
    if (stateOffset !== expectedOffset || count < 1 || leafHeight < 1) {
      throw new TypeError(`${label}[${faceIndex}] has an invalid state range.`);
    }
    expectedOffset += count;
    return { stateOffset, count, leafHeight };
  });
  if (expectedOffset !== stateCount) {
    throw new TypeError(`${label} does not close over the lighting state table.`);
  }
  return ranges;
}

function compactSourceFrames(
  packing: JsonRecord,
  faces: readonly unknown[],
): JsonRecord {
  if (packing.sourceFramesEncoding !== EXPANDED_SOURCE_FRAMES_ENCODING
    || packing.backgroundPositionYsEncoding !== EXPANDED_BACKGROUND_POSITION_Y_ENCODING) {
    throw new TypeError("Prepared lighting source-frame packing is unsupported.");
  }
  const stateCount = integer(packing.stateCount, "lighting state count");
  const sourceFrames = uintsFromBase64(
    packing.sourceFramesBase64,
    2,
    "lighting source frames",
  );
  const positions = array(
    packing.backgroundPositionYs,
    "lighting background-position-y values",
  );
  if (sourceFrames.length !== stateCount || positions.length !== stateCount) {
    throw new TypeError("Prepared lighting state columns are incomplete.");
  }
  const deltas: number[] = new Array(stateCount);
  for (const range of faceRanges(faces, stateCount, "lighting faces")) {
    let previous = 0;
    for (let localIndex = 0; localIndex < range.count; localIndex += 1) {
      const index = range.stateOffset + localIndex;
      const sourceFrame = integer(sourceFrames[index], `sourceFrames[${index}]`, 0xffff);
      if (sourceFrame < previous) {
        throw new TypeError("Prepared lighting source frames must be monotonic per face.");
      }
      deltas[index] = sourceFrame - previous;
      previous = sourceFrame;
      const expectedPosition = `${sourceFrame === 0 ? 0 : -sourceFrame * range.leafHeight}px`;
      if (positions[index] !== expectedPosition) {
        throw new TypeError(
          `Prepared lighting background-position-y ${index} is not source-derived.`,
        );
      }
    }
  }
  const {
    backgroundPositionYs: _backgroundPositionYs,
    sourceFramesBase64: _sourceFramesBase64,
    ...stable
  } = packing;
  return {
    ...stable,
    sourceFramesEncoding: PACKED_SOURCE_FRAMES_ENCODING,
    sourceFrameDeltas: deltas,
    backgroundPositionYsEncoding: PACKED_BACKGROUND_POSITION_Y_ENCODING,
  };
}

function expandSourceFrames(
  packing: JsonRecord,
  faces: readonly unknown[],
): JsonRecord {
  if (packing.sourceFramesEncoding !== PACKED_SOURCE_FRAMES_ENCODING
    || packing.backgroundPositionYsEncoding !== PACKED_BACKGROUND_POSITION_Y_ENCODING) {
    throw new TypeError("Packed lighting source-frame encoding is unsupported.");
  }
  const stateCount = integer(packing.stateCount, "packed lighting state count");
  const deltas = array(packing.sourceFrameDeltas, "packed lighting source-frame deltas");
  if (deltas.length !== stateCount) {
    throw new TypeError("Packed lighting source-frame deltas are incomplete.");
  }
  const sourceFrames: number[] = new Array(stateCount);
  const positions: string[] = new Array(stateCount);
  for (const range of faceRanges(faces, stateCount, "packed lighting faces")) {
    let sourceFrame = 0;
    for (let localIndex = 0; localIndex < range.count; localIndex += 1) {
      const index = range.stateOffset + localIndex;
      sourceFrame += integer(deltas[index], `sourceFrameDeltas[${index}]`, 0xffff);
      if (sourceFrame > 0xffff) {
        throw new TypeError("Packed lighting source frame exceeds uint16.");
      }
      sourceFrames[index] = sourceFrame;
      positions[index] = `${sourceFrame === 0 ? 0 : -sourceFrame * range.leafHeight}px`;
    }
  }
  const { sourceFrameDeltas: _sourceFrameDeltas, ...stable } = packing;
  return {
    ...stable,
    sourceFramesEncoding: EXPANDED_SOURCE_FRAMES_ENCODING,
    sourceFramesBase64: uintsBase64(sourceFrames, 2, "lighting source frames"),
    backgroundPositionYsEncoding: EXPANDED_BACKGROUND_POSITION_Y_ENCODING,
    backgroundPositionYs: positions,
  };
}

function compactSequentialTransitions(
  sequential: JsonRecord,
  faceCount: number,
): JsonRecord {
  if (sequential.encoding !== EXPANDED_TRANSITION_ENCODING) {
    throw new TypeError("Prepared lighting transition packing is unsupported.");
  }
  const offsets = uintsFromBase64(
    sequential.offsetsBase64,
    4,
    "lighting transition offsets",
  );
  const faces = uintsFromBase64(
    sequential.faceIndicesBase64,
    2,
    "lighting transition face indices",
  );
  const states = uintsFromBase64(
    sequential.stateIndicesBase64,
    2,
    "lighting transition state indices",
  );
  if (offsets.length !== sequential.offsetCount
    || faces.length !== sequential.faceIndexCount
    || states.length !== sequential.stateIndexCount
    || faces.length !== states.length
    || offsets.at(-1) !== faces.length) {
    throw new TypeError("Prepared lighting transition columns are incomplete.");
  }
  const faceDeltas: number[] = new Array(faces.length);
  const stateDeltas: number[] = new Array(states.length);
  const previousStates: number[] = new Array(faceCount).fill(0);
  for (let frame = 0; frame < offsets.length - 1; frame += 1) {
    let previousFace = 0;
    for (let index = offsets[frame]; index < offsets[frame + 1]; index += 1) {
      const face = integer(faces[index], `transition face ${index}`, faceCount - 1);
      const state = integer(states[index], `transition state ${index}`, 0xffff);
      if (face < previousFace || state < previousStates[face]) {
        throw new TypeError("Prepared lighting transitions are not monotonic.");
      }
      faceDeltas[index] = face - previousFace;
      stateDeltas[index] = state - previousStates[face];
      previousFace = face;
      previousStates[face] = state;
    }
  }
  const {
    faceIndicesBase64: _faceIndicesBase64,
    stateIndicesBase64: _stateIndicesBase64,
    ...stable
  } = sequential;
  return {
    ...stable,
    encoding: PACKED_TRANSITION_ENCODING,
    faceIndexDeltas: faceDeltas,
    stateIndexDeltas: stateDeltas,
  };
}

function expandSequentialTransitions(
  sequential: JsonRecord,
  faceCount: number,
): JsonRecord {
  if (sequential.encoding !== PACKED_TRANSITION_ENCODING) {
    throw new TypeError("Packed lighting transition encoding is unsupported.");
  }
  const offsets = uintsFromBase64(
    sequential.offsetsBase64,
    4,
    "packed lighting transition offsets",
  );
  const faceDeltas = array(
    sequential.faceIndexDeltas,
    "packed lighting transition face deltas",
  );
  const stateDeltas = array(
    sequential.stateIndexDeltas,
    "packed lighting transition state deltas",
  );
  if (offsets.length !== sequential.offsetCount
    || faceDeltas.length !== sequential.faceIndexCount
    || stateDeltas.length !== sequential.stateIndexCount
    || faceDeltas.length !== stateDeltas.length
    || offsets.at(-1) !== faceDeltas.length) {
    throw new TypeError("Packed lighting transition columns are incomplete.");
  }
  const faces: number[] = new Array(faceDeltas.length);
  const states: number[] = new Array(stateDeltas.length);
  const previousStates: number[] = new Array(faceCount).fill(0);
  for (let frame = 0; frame < offsets.length - 1; frame += 1) {
    let face = 0;
    for (let index = offsets[frame]; index < offsets[frame + 1]; index += 1) {
      face += integer(faceDeltas[index], `transition face delta ${index}`, 0xffff);
      if (face >= faceCount) throw new TypeError("Packed transition face is out of range.");
      const state = previousStates[face]
        + integer(stateDeltas[index], `transition state delta ${index}`, 0xffff);
      if (state > 0xffff) throw new TypeError("Packed transition state exceeds uint16.");
      faces[index] = face;
      states[index] = state;
      previousStates[face] = state;
    }
  }
  const {
    faceIndexDeltas: _faceIndexDeltas,
    stateIndexDeltas: _stateIndexDeltas,
    ...stable
  } = sequential;
  return {
    ...stable,
    encoding: EXPANDED_TRANSITION_ENCODING,
    faceIndicesBase64: uintsBase64(faces, 2, "lighting transition faces"),
    stateIndicesBase64: uintsBase64(states, 2, "lighting transition states"),
  };
}

export function compactPreparedLightingSection(section: unknown): JsonRecord {
  const {
    lighting,
    contract,
    surface,
    packing,
    faces,
    transitions,
    sequential,
  } = lightingParts(section, "Prepared lighting");
  return {
    schema: CSSGRAPHICS_PREPARED_LIGHTING_SECTION_SCHEMA,
    lighting: {
      ...lighting,
      contract: {
        ...contract,
        surface: {
          ...surface,
          statePacking: compactSourceFrames(packing, faces),
        },
        transitions: {
          ...transitions,
          sequential: compactSequentialTransitions(sequential, faces.length),
        },
      },
    },
  };
}

export function expandPreparedLightingSection(value: unknown): JsonRecord {
  const packed = record(value, "Packed prepared lighting");
  if (packed.schema !== CSSGRAPHICS_PREPARED_LIGHTING_SECTION_SCHEMA) {
    throw new TypeError("Packed prepared lighting schema is unsupported.");
  }
  const {
    lighting,
    contract,
    surface,
    packing,
    faces,
    transitions,
    sequential,
  } = lightingParts(packed.lighting, "Packed prepared lighting");
  return {
    ...lighting,
    contract: {
      ...contract,
      surface: {
        ...surface,
        statePacking: expandSourceFrames(packing, faces),
      },
      transitions: {
        ...transitions,
        sequential: expandSequentialTransitions(sequential, faces.length),
      },
    },
  };
}
