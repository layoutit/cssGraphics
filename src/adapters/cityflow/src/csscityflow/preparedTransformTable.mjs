// SPDX-License-Identifier: HPND

const AFFINE_MATRIX_POSITIONS = Object.freeze([0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]);
const AFFINE_MATRIX_WIDTH = AFFINE_MATRIX_POSITIONS.length;
const CHANGING_COMPONENT = 8;
const MAXIMUM_DECIMAL_PLACES = 9;
const TRANSFORM_TABLE_SCHEMA = "csscityflow-prepared-transform-table@1";
const TRANSFORM_TABLE_ENCODING =
  "per-box-affine-template-plus-z-delta-signed-varint-base64";

export function buildCityflowPreparedTransformTable(transforms, transformOffsets) {
  if (!validTransformOffsets(transformOffsets, transformOffsets?.length - 1, transforms?.length) ||
      !Array.isArray(transforms)) {
    throw new Error("Cityflow prepared transform input drifted");
  }
  const groups = [];
  for (let boxIndex = 0; boxIndex < transformOffsets.length - 1; boxIndex += 1) {
    const start = transformOffsets[boxIndex];
    const end = transformOffsets[boxIndex + 1];
    const rows = transforms.slice(start, end).map((transform, localIndex) =>
      affineMatrixValues(transform, `Cityflow transform ${start + localIndex}`));
    const template = rows[0].slice();
    template[CHANGING_COMPONENT] = 0;
    for (const row of rows) {
      if (row.some((value, component) =>
        component !== CHANGING_COMPONENT && value !== template[component])) {
        throw new Error(`Cityflow box ${boxIndex} changes more than its prepared height component`);
      }
    }
    const changingValues = rows.map((row) => row[CHANGING_COMPONENT]);
    const scale = exactDecimalScale(changingValues);
    if (scale === 0) {
      throw new Error(`Cityflow box ${boxIndex} height precision exceeds prepared transport`);
    }
    groups.push(Object.freeze({
      template: Object.freeze(template),
      scale,
      deltaCount: rows.length,
      deltasBase64: encodeSignedVarintDeltas(changingValues, scale),
    }));
  }
  const table = Object.freeze({
    schema: TRANSFORM_TABLE_SCHEMA,
    precedent:
      "cssgraphics.prepared-transform-table@1+cssgravitywell-sparse-component-varints@2",
    encoding: TRANSFORM_TABLE_ENCODING,
    count: transforms.length,
    width: AFFINE_MATRIX_WIDTH,
    changingComponent: CHANGING_COMPONENT,
    groups: Object.freeze(groups),
  });
  const expanded = expandCityflowPreparedTransforms(table, transformOffsets);
  if (expanded.some((transform, index) => transform !== transforms[index])) {
    throw new Error("Cityflow prepared transform transport is not byte exact");
  }
  return table;
}

export function expandCityflowPreparedTransforms(table, transformOffsets) {
  const boxCount = transformOffsets?.length - 1;
  if (table?.schema !== TRANSFORM_TABLE_SCHEMA ||
      table.precedent !==
        "cssgraphics.prepared-transform-table@1+cssgravitywell-sparse-component-varints@2" ||
      table.encoding !== TRANSFORM_TABLE_ENCODING ||
      !Number.isSafeInteger(table.count) || table.count < 1 ||
      table.width !== AFFINE_MATRIX_WIDTH ||
      table.changingComponent !== CHANGING_COMPONENT ||
      !validTransformOffsets(transformOffsets, boxCount, table.count) ||
      !Array.isArray(table.groups) || table.groups.length !== boxCount) {
    throw new Error("Cityflow prepared transform table drifted");
  }
  const transforms = new Array(table.count);
  for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
    const group = table.groups[boxIndex];
    const start = transformOffsets[boxIndex];
    const end = transformOffsets[boxIndex + 1];
    const count = end - start;
    if (!Array.isArray(group?.template) || group.template.length !== AFFINE_MATRIX_WIDTH ||
        group.template.some((value) => typeof value !== "number" || !Number.isFinite(value)) ||
        group.template[CHANGING_COMPONENT] !== 0 ||
        !Number.isSafeInteger(group.scale) || !isSupportedScale(group.scale) ||
        group.deltaCount !== count || typeof group.deltasBase64 !== "string") {
      throw new Error(`Cityflow prepared transform group ${boxIndex} drifted`);
    }
    const changingValues = decodeSignedVarintDeltas(
      group.deltasBase64,
      group.scale,
      count,
      boxIndex,
    );
    for (let localIndex = 0; localIndex < count; localIndex += 1) {
      const values = group.template.slice();
      values[CHANGING_COMPONENT] = changingValues[localIndex];
      transforms[start + localIndex] = affineMatrixString(values);
    }
  }
  return Object.freeze(transforms);
}

function affineMatrixValues(transform, label) {
  if (typeof transform !== "string" || !transform.startsWith("matrix3d(") ||
      !transform.endsWith(")")) {
    throw new Error(`${label} is not a canonical matrix3d string`);
  }
  const tokens = transform.slice(9, -1).split(",");
  if (tokens.length !== 16 || tokens[3] !== "0" || tokens[7] !== "0" ||
      tokens[11] !== "0" || tokens[15] !== "1") {
    throw new Error(`${label} does not use the prepared affine matrix layout`);
  }
  return AFFINE_MATRIX_POSITIONS.map((position) => {
    const token = tokens[position];
    const value = Number(token);
    if (!Number.isFinite(value) || String(value) !== token) {
      throw new Error(`${label} contains a noncanonical number`);
    }
    return value;
  });
}

function affineMatrixString(values) {
  const matrix = [
    values[0], values[1], values[2], 0,
    values[3], values[4], values[5], 0,
    values[6], values[7], values[8], 0,
    values[9], values[10], values[11], 1,
  ];
  return `matrix3d(${matrix.join(",")})`;
}

function exactDecimalScale(values) {
  for (let decimals = 0; decimals <= MAXIMUM_DECIMAL_PLACES; decimals += 1) {
    const scale = 10 ** decimals;
    if (values.every((value) => {
      const scaled = Math.round(value * scale);
      return Number.isSafeInteger(scaled) && String(scaled / scale) === String(value);
    })) return scale;
  }
  return 0;
}

function isSupportedScale(scale) {
  for (let decimals = 0; decimals <= MAXIMUM_DECIMAL_PLACES; decimals += 1) {
    if (scale === 10 ** decimals) return true;
  }
  return false;
}

function encodeSignedVarintDeltas(values, scale) {
  const bytes = [];
  let previous = 0;
  for (const value of values) {
    const next = Math.round(value * scale);
    const delta = next - previous;
    previous = next;
    appendSignedVarint(bytes, delta);
  }
  return encodeBase64(Uint8Array.from(bytes));
}

function appendSignedVarint(target, value) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Cityflow prepared fixed-point matrix delta is unsafe");
  }
  let encoded = value >= 0 ? value * 2 : (-value * 2) - 1;
  if (!Number.isSafeInteger(encoded)) {
    throw new RangeError("Cityflow prepared fixed-point matrix zigzag value is unsafe");
  }
  while (encoded >= 0x80) {
    target.push((encoded % 0x80) | 0x80);
    encoded = Math.floor(encoded / 0x80);
  }
  target.push(encoded);
}

function decodeSignedVarintDeltas(base64, scale, count, boxIndex) {
  const bytes = decodeBase64(base64);
  const values = new Array(count);
  let offset = 0;
  let current = 0;
  for (let index = 0; index < count; index += 1) {
    let encoded = 0;
    let multiplier = 1;
    let complete = false;
    while (offset < bytes.length) {
      const byte = bytes[offset];
      offset += 1;
      encoded += (byte & 0x7f) * multiplier;
      if (!Number.isSafeInteger(encoded)) {
        throw new Error(`Cityflow prepared transform group ${boxIndex} varint is unsafe`);
      }
      if ((byte & 0x80) === 0) {
        complete = true;
        break;
      }
      multiplier *= 0x80;
      if (!Number.isSafeInteger(multiplier)) {
        throw new Error(`Cityflow prepared transform group ${boxIndex} varint is too long`);
      }
    }
    if (!complete) {
      throw new Error(`Cityflow prepared transform group ${boxIndex} is truncated`);
    }
    const delta = encoded % 2 === 0 ? encoded / 2 : -(encoded + 1) / 2;
    current += delta;
    if (!Number.isSafeInteger(current)) {
      throw new Error(`Cityflow prepared transform group ${boxIndex} value is unsafe`);
    }
    values[index] = current / scale;
  }
  if (offset !== bytes.length) {
    throw new Error(`Cityflow prepared transform group ${boxIndex} has trailing bytes`);
  }
  return values;
}

function validTransformOffsets(offsets, boxCount, transformCount) {
  return Number.isSafeInteger(boxCount) && boxCount > 0 &&
    Array.isArray(offsets) && offsets.length === boxCount + 1 && offsets[0] === 0 &&
    offsets.at(-1) === transformCount && offsets.every((offset, index) =>
      Number.isSafeInteger(offset) && offset >= 0 &&
      (index === 0 || offset > offsets[index - 1]));
}

function encodeBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Cityflow prepared transform base64 drifted");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
