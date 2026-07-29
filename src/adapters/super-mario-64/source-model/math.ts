export type GoddardVec3 = readonly [number, number, number];
export type GoddardMat4 = readonly number[];

const DEG_PER_RAD = 57.29577950560105;
const RAD_PER_DEG_F32 = Math.fround(1 / DEG_PER_RAD);

const f32 = Math.fround;
const add = (left: number, right: number): number => f32(f32(left) + f32(right));
const subtract = (left: number, right: number): number => f32(f32(left) - f32(right));
const multiply = (left: number, right: number): number => f32(f32(left) * f32(right));
const divide = (left: number, right: number): number => f32(f32(left) / f32(right));

function gdSinD(value: number): number {
  return f32(Math.sin(f32(value)));
}

function gdCosD(value: number): number {
  return f32(Math.cos(f32(value)));
}

function gdSqrtF(value: number): number {
  const input = f32(value);
  return input < 1e-7 ? 0 : f32(Math.sqrt(input));
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return f32(value);
}

function vec3(value: readonly number[], label: string): GoddardVec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${label} must have three components.`);
  }
  return Object.freeze([
    finite(value[0], `${label}[0]`),
    finite(value[1], `${label}[1]`),
    finite(value[2], `${label}[2]`),
  ]);
}

function mat4(value: readonly number[], label: string): number[] {
  if (!Array.isArray(value) || value.length !== 16) {
    throw new TypeError(`${label} must have 16 row-major components.`);
  }
  return value.map((entry, index) => finite(entry, `${label}[${index}]`));
}

function immutableMatrix(value: number[]): GoddardMat4 {
  return Object.freeze(value.map(f32));
}

function immutableVector(x: number, y: number, z: number): GoddardVec3 {
  return Object.freeze([f32(x), f32(y), f32(z)]) as GoddardVec3;
}

function index(row: number, column: number): number {
  return row * 4 + column;
}

export function gdIdentityMatrix(): GoddardMat4 {
  return Object.freeze([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function gdMultiplyMatrices(left: GoddardMat4, right: GoddardMat4): GoddardMat4 {
  const a = mat4(left, "left matrix");
  const b = mat4(right, "right matrix");
  const output = new Array<number>(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let value = multiply(a[index(row, 0)], b[index(0, column)]);
      value = add(value, multiply(a[index(row, 1)], b[index(1, column)]));
      value = add(value, multiply(a[index(row, 2)], b[index(2, column)]));
      value = add(value, multiply(a[index(row, 3)], b[index(3, column)]));
      output[index(row, column)] = value;
    }
  }
  return immutableMatrix(output);
}

export function gdTranslateMatrix(matrix: GoddardMat4, translation: GoddardVec3): GoddardMat4 {
  const output = mat4(matrix, "matrix");
  const value = vec3(translation, "translation");
  output[12] = add(output[12], value[0]);
  output[13] = add(output[13], value[1]);
  output[14] = add(output[14], value[2]);
  return immutableMatrix(output);
}

export function gdScaleMatrix(matrix: GoddardMat4, scale: GoddardVec3): GoddardMat4 {
  const output = mat4(matrix, "matrix");
  const value = vec3(scale, "scale");
  for (let column = 0; column < 3; column += 1) {
    output[index(0, column)] = multiply(output[index(0, column)], value[0]);
    output[index(1, column)] = multiply(output[index(1, column)], value[1]);
    output[index(2, column)] = multiply(output[index(2, column)], value[2]);
  }
  return immutableMatrix(output);
}

function gdCreateRotationMatrix(axisVector: GoddardVec3, sine: number, cosine: number): GoddardMat4 {
  const axis = vec3(axisVector, "rotation axis");
  const s = f32(sine);
  const c = f32(cosine);
  const reverseX = axis[2];
  const reverseY = axis[1];
  const reverseZ = axis[0];
  const oneMinusCos = f32(1 - c);
  const term = (a: number, b: number): number => multiply(multiply(oneMinusCos, a), b);
  return immutableMatrix([
    add(term(reverseZ, reverseZ), c),
    add(term(reverseZ, reverseY), multiply(s, reverseX)),
    subtract(term(reverseZ, reverseX), multiply(s, reverseY)),
    0,
    subtract(term(reverseZ, reverseY), multiply(s, reverseX)),
    add(term(reverseY, reverseY), c),
    add(term(reverseY, reverseX), multiply(s, reverseZ)),
    0,
    add(term(reverseZ, reverseX), multiply(s, reverseY)),
    subtract(term(reverseY, reverseX), multiply(s, reverseZ)),
    add(term(reverseX, reverseX), c),
    0,
    0, 0, 0, 1,
  ]);
}

function gdCreateAngularRotation(axisVector: GoddardVec3, sourceHalfAngleDegrees: number): GoddardMat4 {
  const radians = f32(f32(sourceHalfAngleDegrees) / (DEG_PER_RAD / 2));
  return gdCreateRotationMatrix(axisVector, gdSinD(radians), gdCosD(radians));
}

export function gdRotateMatrixAxis(
  matrix: GoddardMat4,
  axis: 0 | 1 | 2,
  degrees: number,
): GoddardMat4 {
  const vectors: readonly GoddardVec3[] = Object.freeze([
    immutableVector(1, 0, 0),
    immutableVector(0, 1, 0),
    immutableVector(0, 0, 1),
  ]);
  if (!Number.isInteger(axis) || !vectors[axis]) {
    throw new TypeError(`Rotation axis ${axis} is invalid.`);
  }
  const halfAngle = f32(finite(degrees, "rotation degrees") / 2);
  return gdMultiplyMatrices(matrix, gdCreateAngularRotation(vectors[axis], halfAngle));
}

export function gdRotateMatrixEuler(matrix: GoddardMat4, degrees: GoddardVec3): GoddardMat4 {
  const rotation = vec3(degrees, "Euler rotation");
  let output = immutableMatrix(mat4(matrix, "matrix"));
  if (rotation[0] !== 0) output = gdRotateMatrixAxis(output, 0, rotation[0]);
  if (rotation[1] !== 0) output = gdRotateMatrixAxis(output, 1, rotation[1]);
  if (rotation[2] !== 0) output = gdRotateMatrixAxis(output, 2, rotation[2]);
  return output;
}

function transform(value: GoddardVec3, matrix: GoddardMat4, translate: boolean): GoddardVec3 {
  const point = vec3(value, "vector");
  const m = mat4(matrix, "matrix");
  const component = (column: number): number => {
    let output = multiply(m[index(0, column)], point[0]);
    output = add(output, multiply(m[index(1, column)], point[1]));
    output = add(output, multiply(m[index(2, column)], point[2]));
    if (translate) output = add(output, m[index(3, column)]);
    return output;
  };
  return Object.freeze([component(0), component(1), component(2)]);
}

export function gdTransformPoint(value: GoddardVec3, matrix: GoddardMat4): GoddardVec3 {
  return transform(value, matrix, true);
}

export function gdTransformDirection(value: GoddardVec3, matrix: GoddardMat4): GoddardVec3 {
  return transform(value, matrix, false);
}

export function gdVectorMagnitude(value: GoddardVec3): number {
  const vector = vec3(value, "vector");
  let squared = multiply(vector[0], vector[0]);
  squared = add(squared, multiply(vector[1], vector[1]));
  squared = add(squared, multiply(vector[2], vector[2]));
  return gdSqrtF(squared);
}

export function gdNormalizeVector(value: GoddardVec3): Readonly<{ normalized: boolean; value: GoddardVec3 }> {
  const vector = vec3(value, "vector");
  let squared = multiply(vector[0], vector[0]);
  squared = add(squared, multiply(vector[1], vector[1]));
  squared = add(squared, multiply(vector[2], vector[2]));
  if (squared === 0) return Object.freeze({ normalized: false, value: vector });
  const magnitude = gdSqrtF(squared);
  if (magnitude === 0) return Object.freeze({ normalized: false, value: immutableVector(0, 0, 0) });
  return Object.freeze({
    normalized: true,
    value: immutableVector(
      divide(vector[0], magnitude),
      divide(vector[1], magnitude),
      divide(vector[2], magnitude),
    ),
  });
}

function determinant2(a: number, b: number, c: number, d: number): number {
  return subtract(multiply(a, d), multiply(b, c));
}

function determinant3(values: readonly number[]): number {
  let value = multiply(values[0], determinant2(values[4], values[5], values[7], values[8]));
  value = subtract(value, multiply(values[3], determinant2(values[1], values[2], values[7], values[8])));
  return add(value, multiply(values[6], determinant2(values[1], values[2], values[4], values[5])));
}

function minor(matrix: readonly number[], removedRow: number, removedColumn: number): number {
  const values: number[] = [];
  for (let row = 0; row < 4; row += 1) {
    if (row === removedRow) continue;
    for (let column = 0; column < 4; column += 1) {
      if (column !== removedColumn) values.push(matrix[index(row, column)]);
    }
  }
  return determinant3(values);
}

export function gdMatrixDeterminant(matrix: GoddardMat4): number {
  const m = mat4(matrix, "matrix");
  let value = multiply(m[0], minor(m, 0, 0));
  value = subtract(value, multiply(m[1], minor(m, 0, 1)));
  value = add(value, multiply(m[2], minor(m, 0, 2)));
  return subtract(value, multiply(m[3], minor(m, 0, 3)));
}

function gdAdjunctMatrix(matrix: GoddardMat4): GoddardMat4 {
  const m = mat4(matrix, "matrix");
  const inv = (row: number, column: number): number => m[index(3 - column, 3 - row)];
  const det = (...values: number[]): number => determinant3(values);
  const output = new Array<number>(16);
  output[index(0, 0)] = det(inv(2, 2), inv(2, 1), inv(2, 0), inv(1, 2), inv(1, 1), inv(1, 0), inv(0, 2), inv(0, 1), inv(0, 0));
  output[index(1, 0)] = f32(-det(inv(3, 2), inv(3, 1), inv(3, 0), inv(1, 2), inv(1, 1), inv(1, 0), inv(0, 2), inv(0, 1), inv(0, 0)));
  output[index(2, 0)] = det(inv(3, 2), inv(3, 1), inv(3, 0), inv(2, 2), inv(2, 1), inv(2, 0), inv(0, 2), inv(0, 1), inv(0, 0));
  output[index(3, 0)] = f32(-det(inv(3, 2), inv(3, 1), inv(3, 0), inv(2, 2), inv(2, 1), inv(2, 0), inv(1, 2), inv(1, 1), inv(1, 0)));
  output[index(0, 1)] = f32(-det(inv(2, 3), inv(2, 1), inv(2, 0), inv(1, 3), inv(1, 1), inv(1, 0), inv(0, 3), inv(0, 1), inv(0, 0)));
  output[index(1, 1)] = det(inv(3, 3), inv(3, 1), inv(3, 0), inv(1, 3), inv(1, 1), inv(1, 0), inv(0, 3), inv(0, 1), inv(0, 0));
  output[index(2, 1)] = f32(-det(inv(3, 3), inv(3, 1), inv(3, 0), inv(2, 3), inv(2, 1), inv(2, 0), inv(0, 3), inv(0, 1), inv(0, 0)));
  output[index(3, 1)] = det(inv(3, 3), inv(3, 1), inv(3, 0), inv(2, 3), inv(2, 1), inv(2, 0), inv(1, 3), inv(1, 1), inv(1, 0));
  output[index(0, 2)] = det(inv(2, 3), inv(2, 2), inv(2, 0), inv(1, 3), inv(1, 2), inv(1, 0), inv(0, 3), inv(0, 2), inv(0, 0));
  output[index(1, 2)] = f32(-det(inv(3, 3), inv(3, 2), inv(3, 0), inv(1, 3), inv(1, 2), inv(1, 0), inv(0, 3), inv(0, 2), inv(0, 0)));
  output[index(2, 2)] = det(inv(3, 3), inv(3, 2), inv(3, 0), inv(2, 3), inv(2, 2), inv(2, 0), inv(0, 3), inv(0, 2), inv(0, 0));
  output[index(3, 2)] = f32(-det(inv(3, 3), inv(3, 2), inv(3, 0), inv(2, 3), inv(2, 2), inv(2, 0), inv(1, 3), inv(1, 2), inv(1, 0)));
  output[index(0, 3)] = f32(-det(inv(2, 3), inv(2, 2), inv(2, 1), inv(1, 3), inv(1, 2), inv(1, 1), inv(0, 3), inv(0, 2), inv(0, 1)));
  output[index(1, 3)] = det(inv(3, 3), inv(3, 2), inv(3, 1), inv(1, 3), inv(1, 2), inv(1, 1), inv(0, 3), inv(0, 2), inv(0, 1));
  output[index(2, 3)] = f32(-det(inv(3, 3), inv(3, 2), inv(3, 1), inv(2, 3), inv(2, 2), inv(2, 1), inv(0, 3), inv(0, 2), inv(0, 1)));
  output[index(3, 3)] = det(inv(3, 3), inv(3, 2), inv(3, 1), inv(2, 3), inv(2, 2), inv(2, 1), inv(1, 3), inv(1, 2), inv(1, 1));
  return immutableMatrix(output);
}

export function gdInverseMatrix(matrix: GoddardMat4): GoddardMat4 {
  const adjunct = gdAdjunctMatrix(matrix);
  const determinant = gdMatrixDeterminant(adjunct);
  if (Math.abs(determinant) < 1e-5) {
    throw new TypeError("The Goddard source inverse rejected a singular matrix.");
  }
  return immutableMatrix(adjunct.map((value) => divide(value, determinant)));
}

export function gdLookAt(
  from: GoddardVec3,
  to: GoddardVec3,
  rollDegrees = 0,
): GoddardMat4 {
  const source = vec3(from, "camera from");
  const target = vec3(to, "camera to");
  const rollRadians = f32(finite(rollDegrees, "camera roll") * RAD_PER_DEG_F32);
  let zColumnY = gdSinD(rollRadians);
  let yColumnY = gdCosD(rollRadians);
  let xColumnY = 0;
  let dx = subtract(target[2], source[2]);
  let dy = subtract(target[1], source[1]);
  let dz = subtract(target[0], source[0]);
  let inverseLength = add(add(Math.abs(dz), Math.abs(dy)), Math.abs(dx));
  if (inverseLength > 10000 || inverseLength < 10) {
    const normalized = gdNormalizeVector(Object.freeze([dz, dy, dx]));
    if (!normalized.normalized) {
      throw new TypeError("The camera source and target cannot coincide.");
    }
    dz = multiply(normalized.value[0], 10000);
    dy = multiply(normalized.value[1], 10000);
    dx = multiply(normalized.value[2], 10000);
  }
  let lengthSquared = add(add(multiply(dz, dz), multiply(dy, dy)), multiply(dx, dx));
  inverseLength = f32(-1 / gdSqrtF(lengthSquared));
  dz = multiply(dz, inverseLength);
  dy = multiply(dy, inverseLength);
  dx = multiply(dx, inverseLength);

  let columnXz = subtract(multiply(yColumnY, dx), multiply(xColumnY, dy));
  let columnXy = subtract(multiply(xColumnY, dz), multiply(zColumnY, dx));
  let columnXx = subtract(multiply(zColumnY, dy), multiply(yColumnY, dz));
  lengthSquared = add(add(multiply(columnXz, columnXz), multiply(columnXy, columnXy)), multiply(columnXx, columnXx));
  inverseLength = f32(1 / gdSqrtF(lengthSquared));
  if (!Number.isFinite(inverseLength)) throw new TypeError("Camera up is parallel to its view direction.");
  columnXz = multiply(columnXz, inverseLength);
  columnXy = multiply(columnXy, inverseLength);
  columnXx = multiply(columnXx, inverseLength);

  zColumnY = subtract(multiply(dy, columnXx), multiply(dx, columnXy));
  yColumnY = subtract(multiply(dx, columnXz), multiply(dz, columnXx));
  xColumnY = subtract(multiply(dz, columnXy), multiply(dy, columnXz));
  lengthSquared = add(add(multiply(zColumnY, zColumnY), multiply(yColumnY, yColumnY)), multiply(xColumnY, xColumnY));
  inverseLength = f32(1 / gdSqrtF(lengthSquared));
  zColumnY = multiply(zColumnY, inverseLength);
  yColumnY = multiply(yColumnY, inverseLength);
  xColumnY = multiply(xColumnY, inverseLength);

  const translated = (a: number, b: number, c: number): number => {
    let value = multiply(source[0], a);
    value = add(value, multiply(source[1], b));
    value = add(value, multiply(source[2], c));
    return f32(-value);
  };
  return immutableMatrix([
    columnXz, zColumnY, dz, 0,
    columnXy, yColumnY, dy, 0,
    columnXx, xColumnY, dx, 0,
    translated(columnXz, columnXy, columnXx),
    translated(zColumnY, yColumnY, xColumnY),
    translated(dz, dy, dx),
    1,
  ]);
}

export function gdProjectWorldToScreen(
  worldPosition: GoddardVec3,
  cameraMatrix: GoddardMat4,
  viewport: Readonly<{ width: number; height: number }>,
): Readonly<{ projected: boolean; position: GoddardVec3 }> {
  const width = finite(viewport?.width, "viewport width");
  const height = finite(viewport?.height, "viewport height");
  if (width <= 0 || height <= 0) throw new TypeError("Projection viewport must be positive.");
  const camera = gdTransformPoint(worldPosition, cameraMatrix);
  if (camera[2] > -256) return Object.freeze({ projected: false, position: camera });
  const xScale = f32(256 / f32(-camera[2]));
  const yScale = f32(256 / camera[2]);
  const x = add(multiply(camera[0], xScale), divide(width, 2));
  const y = add(multiply(camera[1], yScale), divide(height, 2));
  return Object.freeze({ projected: true, position: immutableVector(x, y, camera[2]) });
}
