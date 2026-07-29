import {
  createCssGraphicsModelCodecRegistry,
  defineCssGraphicsModelCodec,
  type CssGraphicsModelCodec,
} from "../transport.mjs";
import type { CssGraphicsModelData } from "../modelPackage.mjs";
import {
  compactPreparedLightingSection,
  expandPreparedLightingSection,
} from "./preparedLighting.mjs";

export const CSSGRAPHICS_PREPARED_PLAYBACK_JSON_CODEC_ID =
  "cssgraphics.prepared-playback-json@1";

const MODEL_DATA_SCHEMA = "cssgraphics.model-data@1";
const PACKED_MODEL_SCHEMA = "cssgraphics.prepared-playback-transport@1";
const TRANSFORM_TABLE_SCHEMA = "cssgraphics.prepared-transform-table@1";
const CHANGE_TABLE_SCHEMA = "cssgraphics.sparse-change-table@1";
const INITIAL_TABLE_SCHEMA = "cssgraphics.initial-state-table@1";
const LEAF_FIT_SCHEMA = "cssgraphics.source-milli-leaf-fit@1";
const MATRIX_WIDTH = 12;
const MATRIX_POSITIONS = Object.freeze([0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]);
const MAX_SCALED_DECIMALS = 6;
const SOURCE_MILLI_FACTOR = 1000;

type JsonRecord = Record<string, unknown>;
type MatrixValues = number[] | null;

interface PlaybackParts {
  readonly playback: JsonRecord;
  readonly packet: JsonRecord;
}

interface TransformGroup {
  readonly owner: string;
  readonly indices: number[];
}

interface LeafFit {
  readonly schema: typeof LEAF_FIT_SCHEMA;
  readonly canonicalSize: number;
  readonly width: number;
  readonly height: number;
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

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function modelData(value: unknown, label: string): CssGraphicsModelData {
  const model = record(value, label);
  if (model.schema !== MODEL_DATA_SCHEMA || typeof model.id !== "string") {
    throw new TypeError(`${label} must be complete cssGraphics model data.`);
  }
  record(model.sections, `${label}.sections`);
  return model as unknown as CssGraphicsModelData;
}

function playbackPacket(
  model: CssGraphicsModelData,
  label: string,
): PlaybackParts {
  const playback = record(model.sections.playback, `${label}.sections.playback`);
  return {
    playback,
    packet: record(playback.packet, `${label}.sections.playback.packet`),
  };
}

function matrixValues(value: unknown, label: string): MatrixValues {
  if (value === "") return null;
  if (typeof value !== "string" || !value.startsWith("matrix3d(") || !value.endsWith(")")) {
    throw new TypeError(`${label} must be a canonical matrix3d string.`);
  }
  const tokens = value.slice(9, -1).split(",");
  if (tokens.length !== 16 || tokens[3] !== "0" || tokens[7] !== "0"
    || tokens[11] !== "0" || tokens[15] !== "1") {
    throw new TypeError(`${label} must use the prepared affine matrix3d layout.`);
  }
  return MATRIX_POSITIONS.map((position) => {
    const token = tokens[position];
    const parsed = Number(token);
    if (!Number.isFinite(parsed) || String(parsed) !== token) {
      throw new TypeError(`${label} contains a noncanonical number.`);
    }
    return parsed;
  });
}

function matrixString(values: readonly number[]): string {
  const row = [
    values[0], values[1], values[2], 0,
    values[3], values[4], values[5], 0,
    values[6], values[7], values[8], 0,
    values[9], values[10], values[11], 1,
  ];
  return `matrix3d(${row.join(",")})`;
}

function exactDecimalScale(values: readonly number[]): number {
  for (let decimals = 0; decimals <= MAX_SCALED_DECIMALS; decimals += 1) {
    const scale = 10 ** decimals;
    if (values.every((value) => (
      Number.isSafeInteger(Math.round(value * scale))
      && String(Math.round(value * scale) / scale) === String(value)
    ))) {
      return scale;
    }
  }
  return 0;
}

function cssNumber(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function milliCss(value: number): string {
  if (value === 0) return "0";
  const negative = value < 0;
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / SOURCE_MILLI_FACTOR);
  const remainder = absolute % SOURCE_MILLI_FACTOR;
  const sign = negative ? "-" : "";
  if (remainder === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(remainder).padStart(3, "0").replace(/0+$/u, "")}`;
}

function assignOwner(
  owners: Array<string | undefined>,
  transformIndex: unknown,
  owner: string,
  label: string,
): void {
  const index = integer(transformIndex, label);
  if (index < 0 || index >= owners.length) {
    throw new RangeError(`${label} is outside the transform table.`);
  }
  if (owners[index] === undefined) owners[index] = owner;
}

function assignTripletOwners(
  owners: Array<string | undefined>,
  values: unknown,
  kind: string,
  label: string,
): void {
  const rows = array(values, label);
  if (rows.length % 3 !== 0) throw new TypeError(`${label} must contain triplets.`);
  for (let offset = 0; offset < rows.length; offset += 3) {
    assignOwner(
      owners,
      rows[offset + 1],
      `${kind}:${integer(rows[offset], `${label}[${offset}]`)}`,
      `${label}[${offset + 1}]`,
    );
  }
}

function transformOwners(packet: JsonRecord, count: number): string[] {
  const owners: Array<string | undefined> = new Array(count);
  const initial = record(packet.initial, "playback.initial");
  assignOwner(owners, initial.modelTransform, "model", "playback.initial.modelTransform");
  assignTripletOwners(owners, initial.shapes, "shape", "playback.initial.shapes");
  assignTripletOwners(owners, initial.leaves, "leaf", "playback.initial.leaves");
  for (const [index, rowValue] of array(packet.frameRows, "playback.frameRows").entries()) {
    const row = array(rowValue, `playback.frameRows[${index}]`);
    if (row.length !== 8) throw new TypeError(`playback.frameRows[${index}] is invalid.`);
    if (row[3] !== -1) {
      assignOwner(owners, row[3], "model", `playback.frameRows[${index}][3]`);
    }
  }
  assignTripletOwners(owners, packet.shapeChanges, "shape", "playback.shapeChanges");
  assignTripletOwners(owners, packet.leafChanges, "leaf", "playback.leafChanges");
  if (owners.some((owner) => owner === undefined)) {
    throw new TypeError("Every prepared transform must have a playback owner.");
  }
  return owners as string[];
}

function transformGroups(packet: JsonRecord, count: number): TransformGroup[] {
  const owners = transformOwners(packet, count);
  const byOwner = new Map<string, number[]>();
  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index];
    let indices = byOwner.get(owner);
    if (!indices) {
      indices = [];
      byOwner.set(owner, indices);
    }
    indices.push(index);
  }
  return [...byOwner].map(([owner, indices]) => ({ owner, indices }));
}

function preparedLeafFits(model: CssGraphicsModelData): Map<string, LeafFit> {
  const structure = model.sections.structure;
  const lighting = model.sections.lighting;
  const trianglePlan = structure === undefined
    ? undefined
    : record(structure.trianglePlan, "model.sections.structure.trianglePlan");
  const contract = lighting === undefined
    ? undefined
    : record(lighting.contract, "model.sections.lighting.contract");
  const surface = contract === undefined
    ? undefined
    : record(contract.surface, "model.sections.lighting.contract.surface");
  const leaves = trianglePlan?.leaves;
  const faces = surface?.faces;
  if (!Array.isArray(leaves) || !Array.isArray(faces) || leaves.length !== faces.length) {
    return new Map<string, LeafFit>();
  }
  const fits = new Map<string, LeafFit>();
  for (let index = 0; index < leaves.length; index += 1) {
    const leaf = record(leaves[index], `model structure leaf ${index}`);
    const face = record(faces[index], `model lighting face ${index}`);
    const polycss = record(leaf.polycss, `model structure leaf ${index}.polycss`);
    const update = record(polycss.update, `model structure leaf ${index}.polycss.update`);
    const canonicalSize = update.canonicalSize;
    if (leaf.sourceOrder !== index || face.sourceOrder !== index
      || leaf.faceId !== face.faceId
      || typeof canonicalSize !== "number"
      || !Number.isSafeInteger(canonicalSize) || canonicalSize < 1
      || typeof face.leafWidth !== "number"
      || !Number.isSafeInteger(face.leafWidth) || face.leafWidth < 1
      || typeof face.leafHeight !== "number"
      || !Number.isSafeInteger(face.leafHeight) || face.leafHeight < 1) {
      return new Map<string, LeafFit>();
    }
    fits.set(`leaf:${index}`, Object.freeze({
      schema: LEAF_FIT_SCHEMA,
      canonicalSize,
      width: face.leafWidth,
      height: face.leafHeight,
    }));
  }
  return fits;
}

function fittedLeafMatrixString(
  values: readonly number[],
  fit: LeafFit,
): string {
  const basis = values.slice(0, 9).map((value) => value / SOURCE_MILLI_FACTOR);
  const xScale = fit.canonicalSize / fit.width;
  const yScale = fit.canonicalSize / fit.height;
  for (const index of [0, 1, 2]) basis[index] *= xScale;
  for (const index of [3, 4, 5]) basis[index] *= yScale;
  return matrixString([
    ...basis.slice(0, 6).map((value) => Number(cssNumber(value))),
    ...values.slice(6).map((value) => Number(milliCss(value))),
  ]);
}

function sourceMilliLeafRows(
  rows: readonly MatrixValues[],
  fit: LeafFit,
): MatrixValues[] | null {
  const encoded: MatrixValues[] = [];
  for (const row of rows) {
    if (row === null) {
      encoded.push(null);
      continue;
    }
    const source = row.map((value, column) => {
      let scaled = value;
      if (column < 3) scaled *= fit.width / fit.canonicalSize;
      else if (column < 6) scaled *= fit.height / fit.canonicalSize;
      return Math.round(scaled * SOURCE_MILLI_FACTOR);
    });
    if (source.some((value) => !Number.isSafeInteger(value))
      || fittedLeafMatrixString(source, fit) !== matrixString(row)) {
      return null;
    }
    encoded.push(source);
  }
  return encoded;
}

function componentStreams(
  rows: readonly MatrixValues[],
  fixedScale: number | null = null,
): JsonRecord {
  const empty: number[] = [];
  const present: number[][] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === null) empty.push(index);
    else present.push(row);
  }
  const scales: number[] = [];
  const columns: number[][] = [];
  for (let column = 0; column < MATRIX_WIDTH; column += 1) {
    const values = present.map((row) => row[column]);
    const scale = fixedScale ?? exactDecimalScale(values);
    scales.push(scale);
    if (scale) {
      const deltas = [];
      let previous = 0;
      for (const value of values) {
        const next = fixedScale === null ? Math.round(value * scale) : value;
        deltas.push(next - previous);
        previous = next;
      }
      columns.push(deltas);
    } else {
      columns.push(values);
    }
  }
  return { empty, scales, columns };
}

function compactTransforms(
  packet: JsonRecord,
  model: CssGraphicsModelData,
): JsonRecord {
  const transforms = array(packet.transforms, "playback.transforms");
  const fits = preparedLeafFits(model);
  const groups = transformGroups(packet, transforms.length).map(({ owner, indices }) => {
    const rows = indices.map((index) => (
      matrixValues(transforms[index], `playback.transforms[${index}]`)
    ));
    const fit = fits.get(owner);
    const sourceRows = fit ? sourceMilliLeafRows(rows, fit) : null;
    if (sourceRows) {
      return {
        encoding: "source-milli-fitted-leaf",
        ...componentStreams(sourceRows, SOURCE_MILLI_FACTOR),
      };
    }
    return {
      encoding: "decimal-component-streams",
      ...componentStreams(rows),
    };
  });
  return {
    schema: TRANSFORM_TABLE_SCHEMA,
    count: transforms.length,
    width: MATRIX_WIDTH,
    groups,
  };
}

function expandComponentStreams(
  group: JsonRecord,
  rowCount: number,
  label: string,
): MatrixValues[] {
  const empty = new Set(array(group.empty, `${label}.empty`).map((entry) => (
    integer(entry, `${label}.empty[]`)
  )));
  if ([...empty].some((index) => index < 0 || index >= rowCount)) {
    throw new TypeError(`${label}.empty contains an invalid row.`);
  }
  const scales = array(group.scales, `${label}.scales`);
  const columns = array(group.columns, `${label}.columns`);
  if (scales.length !== MATRIX_WIDTH || columns.length !== MATRIX_WIDTH) {
    throw new TypeError(`${label} has an invalid component width.`);
  }
  const presentCount = rowCount - empty.size;
  const expandedColumns = columns.map((columnValue, column) => {
    const values = array(columnValue, `${label}.columns[${column}]`);
    if (values.length !== presentCount) {
      throw new TypeError(`${label}.columns[${column}] has an invalid length.`);
    }
    const scale = integer(scales[column], `${label}.scales[${column}]`);
    if (scale < 0 || scale > 1_000_000) {
      throw new TypeError(`${label}.scales[${column}] is unsupported.`);
    }
    if (!scale) return values.map((entry) => finite(entry, "packed transform value"));
    let current = 0;
    return values.map((entry) => {
      current += integer(entry, "packed transform delta");
      return current / scale;
    });
  });
  const rows: MatrixValues[] = [];
  let cursor = 0;
  for (let index = 0; index < rowCount; index += 1) {
    if (empty.has(index)) {
      rows.push(null);
      continue;
    }
    rows.push(expandedColumns.map((column) => column[cursor]));
    cursor += 1;
  }
  return rows;
}

function expandTransforms(
  value: unknown,
  packet: JsonRecord,
  model: CssGraphicsModelData,
): string[] {
  const table = record(value, "packed transforms");
  if (table.schema !== TRANSFORM_TABLE_SCHEMA
    || integer(table.width, "packed transforms.width") !== MATRIX_WIDTH) {
    throw new TypeError("Packed transform table is unsupported.");
  }
  const count = integer(table.count, "packed transforms.count");
  if (count < 1) throw new TypeError("Packed transform table is empty.");
  const transforms: Array<string | undefined> = new Array(count);
  const derivedGroups = transformGroups(packet, count);
  const packedGroups = array(table.groups, "packed transforms.groups");
  if (packedGroups.length !== derivedGroups.length) {
    throw new TypeError("Packed transform groups do not match playback owners.");
  }
  const fits = preparedLeafFits(model);
  for (let groupIndex = 0; groupIndex < packedGroups.length; groupIndex += 1) {
    const groupValue = packedGroups[groupIndex];
    const group = record(groupValue, `packed transforms.groups[${groupIndex}]`);
    const { owner, indices } = derivedGroups[groupIndex];
    const label = `packed transforms.groups[${groupIndex}]`;
    const rows = expandComponentStreams(group, indices.length, label);
    const fit = fits.get(owner);
    if (group.encoding === "source-milli-fitted-leaf" && !fit) {
      throw new TypeError(`${label} has no declared leaf fit.`);
    }
    if (group.encoding !== "source-milli-fitted-leaf"
      && group.encoding !== "decimal-component-streams") {
      throw new TypeError(`${label}.encoding is unsupported.`);
    }
    for (let rowIndex = 0; rowIndex < indices.length; rowIndex += 1) {
      const index = indices[rowIndex];
      const row = rows[rowIndex];
      if (transforms[index] !== undefined) {
        throw new TypeError("Packed transform indices are duplicated.");
      }
      if (row === null) {
        transforms[index] = "";
      } else if (group.encoding === "source-milli-fitted-leaf") {
        if (!fit) throw new TypeError(`${label} has no declared leaf fit.`);
        transforms[index] = fittedLeafMatrixString(
          row.map((entry) => Math.round(entry * SOURCE_MILLI_FACTOR)),
          fit,
        );
      } else {
        transforms[index] = matrixString(row);
      }
    }
  }
  if (transforms.includes(undefined)) {
    throw new TypeError("Packed transform table is incomplete.");
  }
  return transforms as string[];
}

function compactInitial(value: unknown, label: string): JsonRecord {
  const rows = array(value, label);
  if (rows.length % 3 !== 0) throw new TypeError(`${label} must contain triplets.`);
  const transforms: number[] = [];
  const visibility: number[] = [];
  let previousTransform = 0;
  for (let offset = 0; offset < rows.length; offset += 3) {
    const sourceIndex = offset / 3;
    if (rows[offset] !== sourceIndex) throw new TypeError(`${label} is not source ordered.`);
    const transform = integer(rows[offset + 1], `${label}[${offset + 1}]`);
    transforms.push(transform - previousTransform);
    previousTransform = transform;
    visibility.push(integer(rows[offset + 2], `${label}[${offset + 2}]`));
  }
  return {
    schema: INITIAL_TABLE_SCHEMA,
    count: rows.length / 3,
    transforms,
    visibility,
  };
}

function expandInitial(value: unknown, label: string): number[] {
  const table = record(value, label);
  if (table.schema !== INITIAL_TABLE_SCHEMA) throw new TypeError(`${label} is unsupported.`);
  const count = integer(table.count, `${label}.count`);
  const transforms = array(table.transforms, `${label}.transforms`);
  const visibility = array(table.visibility, `${label}.visibility`);
  if (transforms.length !== count || visibility.length !== count) {
    throw new TypeError(`${label} is incomplete.`);
  }
  const rows: number[] = [];
  let transform = 0;
  for (let index = 0; index < count; index += 1) {
    transform += integer(transforms[index], `${label}.transforms[${index}]`);
    rows.push(index, transform, integer(visibility[index], `${label}.visibility[${index}]`));
  }
  return rows;
}

function compactChanges(
  values: unknown,
  frameRows: readonly unknown[],
  offsetColumn: number,
  countColumn: number,
  label: string,
): JsonRecord {
  const rows = array(values, label);
  if (rows.length % 3 !== 0) throw new TypeError(`${label} must contain triplets.`);
  const sources: number[] = [];
  const transforms: number[] = [];
  const visibility: number[] = [];
  let previousTransform = 0;
  let consumed = 0;
  for (const [frameIndex, frameValue] of frameRows.entries()) {
    const frame = array(frameValue, `playback.frameRows[${frameIndex}]`);
    const offset = integer(frame[offsetColumn], `playback.frameRows[${frameIndex}][${offsetColumn}]`);
    const count = integer(frame[countColumn], `playback.frameRows[${frameIndex}][${countColumn}]`);
    if (offset !== consumed) throw new TypeError(`${label} offsets are not contiguous.`);
    let previousSource = 0;
    for (let index = 0; index < count; index += 1) {
      const base = (offset + index) * 3;
      const source = integer(rows[base], `${label}[${base}]`);
      const transform = integer(rows[base + 1], `${label}[${base + 1}]`);
      sources.push(source - previousSource);
      transforms.push(transform - previousTransform);
      visibility.push(integer(rows[base + 2], `${label}[${base + 2}]`));
      previousSource = source;
      previousTransform = transform;
    }
    consumed += count;
  }
  if (consumed * 3 !== rows.length) throw new TypeError(`${label} has trailing rows.`);
  return { schema: CHANGE_TABLE_SCHEMA, sources, transforms, visibility };
}

function expandChanges(
  value: unknown,
  frameRows: readonly unknown[],
  offsetColumn: number,
  countColumn: number,
  label: string,
): number[] {
  const table = record(value, label);
  if (table.schema !== CHANGE_TABLE_SCHEMA) throw new TypeError(`${label} is unsupported.`);
  const sources = array(table.sources, `${label}.sources`);
  const transforms = array(table.transforms, `${label}.transforms`);
  const visibility = array(table.visibility, `${label}.visibility`);
  if (sources.length !== transforms.length || sources.length !== visibility.length) {
    throw new TypeError(`${label} columns differ in length.`);
  }
  const rows: number[] = [];
  let previousTransform = 0;
  let cursor = 0;
  for (const [frameIndex, frameValue] of frameRows.entries()) {
    const frame = array(frameValue, `playback.frameRows[${frameIndex}]`);
    const offset = integer(frame[offsetColumn], `playback.frameRows[${frameIndex}][${offsetColumn}]`);
    const count = integer(frame[countColumn], `playback.frameRows[${frameIndex}][${countColumn}]`);
    if (offset !== cursor) throw new TypeError(`${label} offsets are not contiguous.`);
    let source = 0;
    for (let index = 0; index < count; index += 1) {
      source += integer(sources[cursor], `${label}.sources[${cursor}]`);
      previousTransform += integer(transforms[cursor], `${label}.transforms[${cursor}]`);
      rows.push(source, previousTransform, integer(visibility[cursor], `${label}.visibility[${cursor}]`));
      cursor += 1;
    }
  }
  if (cursor !== sources.length) throw new TypeError(`${label} has trailing rows.`);
  return rows;
}

function compactModel(model: CssGraphicsModelData): JsonRecord {
  const { playback, packet } = playbackPacket(model, "Prepared playback codec input");
  const frameRows = array(packet.frameRows, "playback.frameRows");
  const transforms = compactTransforms(packet, model);
  const initial = record(packet.initial, "playback.initial");
  const lighting = model.sections.lighting === undefined
    ? undefined
    : compactPreparedLightingSection(model.sections.lighting);
  return {
    schema: PACKED_MODEL_SCHEMA,
    model: {
      ...model,
      sections: {
        ...model.sections,
        ...(lighting === undefined ? {} : { lighting }),
        playback: {
          ...playback,
          packet: {
            ...packet,
            transforms,
            initial: {
              ...initial,
              shapes: compactInitial(initial.shapes, "playback.initial.shapes"),
              leaves: compactInitial(initial.leaves, "playback.initial.leaves"),
            },
            shapeChanges: compactChanges(
              packet.shapeChanges,
              frameRows,
              4,
              5,
              "playback.shapeChanges",
            ),
            leafChanges: compactChanges(
              packet.leafChanges,
              frameRows,
              6,
              7,
              "playback.leafChanges",
            ),
          },
        },
      },
    },
  };
}

function expandModel(value: unknown): CssGraphicsModelData {
  const packed = record(value, "Prepared playback codec part");
  if (packed.schema !== PACKED_MODEL_SCHEMA) {
    throw new TypeError("Prepared playback codec schema is unsupported.");
  }
  const packedModel = modelData(packed.model, "Prepared playback codec model");
  const model = packedModel.sections.lighting === undefined
    ? packedModel
    : {
      ...packedModel,
      sections: {
        ...packedModel.sections,
        lighting: expandPreparedLightingSection(packedModel.sections.lighting),
      },
    };
  const { playback, packet } = playbackPacket(model, "Prepared playback codec model");
  const frameRows = array(packet.frameRows, "playback.frameRows");
  const initial = record(packet.initial, "playback.initial");
  const expandedInitial = {
    ...initial,
    shapes: expandInitial(initial.shapes, "packed initial shapes"),
    leaves: expandInitial(initial.leaves, "packed initial leaves"),
  };
  const expandedShapeChanges = expandChanges(
    packet.shapeChanges,
    frameRows,
    4,
    5,
    "packed shape changes",
  );
  const expandedLeafChanges = expandChanges(
    packet.leafChanges,
    frameRows,
    6,
    7,
    "packed leaf changes",
  );
  const expandedPacket = {
    ...packet,
    initial: expandedInitial,
    shapeChanges: expandedShapeChanges,
    leafChanges: expandedLeafChanges,
  };
  return {
    ...model,
    sections: {
      ...model.sections,
      playback: {
        ...playback,
        packet: {
          ...expandedPacket,
          transforms: expandTransforms(packet.transforms, expandedPacket, model),
        },
      },
    },
  } as CssGraphicsModelData;
}

export const cssGraphicsPreparedPlaybackJsonCodec: CssGraphicsModelCodec =
defineCssGraphicsModelCodec({
  id: CSSGRAPHICS_PREPARED_PLAYBACK_JSON_CODEC_ID,
  async encode(model) {
    return Object.freeze({
      parts: Object.freeze([Object.freeze({
        id: "model",
        value: compactModel(modelData(model, "Prepared playback codec input")),
      })]),
    });
  },
  async decode(parts) {
    if (!(parts instanceof Map) || parts.size !== 1 || !parts.has("model")) {
      throw new TypeError("Prepared playback codec requires one model part.");
    }
    return expandModel(parts.get("model"));
  },
});

export const cssGraphicsModelCodecRegistry = createCssGraphicsModelCodecRegistry([
  cssGraphicsPreparedPlaybackJsonCodec,
]);
