const PI = Math.PI;

export function advanceCycloneParticleTransform({
  state,
  points,
  widths,
  deltaSeconds,
  speed,
  complexity,
  particleSize,
  radialOrbitScale = 1,
}) {
  if (!validState(state) || !validPoints(points) || !validWidths(widths) ||
      !Number.isFinite(deltaSeconds) || deltaSeconds <= 0 ||
      !Number.isFinite(speed) || speed <= 0 ||
      !Number.isSafeInteger(complexity) || complexity < 1 || complexity + 2 >= widths.length ||
      !Number.isFinite(particleSize) || particleSize <= 0 ||
      !Number.isFinite(radialOrbitScale) || radialOrbitScale <= 0) {
    throw new TypeError("Complete prepared Cyclone particle transform inputs are required");
  }
  const { width } = state;
  const position = bezier(points, state.step);
  const previous = bezier(points, state.step - 0.01);
  const direction = normalize(sub3(position, previous));
  const up = [0, 1, 0];
  const crossVector = cross3(direction, up);
  const tiltAngle = -Math.acos(clamp(dot3(direction, up), -1, 1)) * 180 / PI;
  let widthIndex = Math.floor(state.step * (complexity + 2));
  if (widthIndex >= complexity + 2) widthIndex = complexity + 1;
  const between = (state.step - widthIndex / (complexity + 2)) * (complexity + 2);
  const cycloneWidth = widths[widthIndex] * (1 - between) + widths[widthIndex + 1] * between;
  const stepDelta = 0.2 * deltaSeconds * speed / (width * width * cycloneWidth);
  const spinDelta = 1500 * deltaSeconds * speed / (width * cycloneWidth);
  const nextState = Object.freeze({
    width,
    step: state.step + stepDelta,
    spinAngle: state.spinAngle + spinDelta,
  });
  let stretch = width * cycloneWidth * spinDelta * 0.02;
  stretch = Math.min(stretch, cycloneWidth * 2 / particleSize);
  stretch = Math.max(stretch, 3);
  const matrix = multiply4(
    translation(position),
    multiply4(
      rotationAxis(tiltAngle, crossVector),
      multiply4(
        rotationY(nextState.spinAngle),
        multiply4(
          translation([width * cycloneWidth * radialOrbitScale, 0, 0]),
          scale4([1, 1, stretch]),
        ),
      ),
    ),
  );
  return Object.freeze({
    matrix: Object.freeze(flattenCss(matrix)),
    state: nextState,
  });
}

function validState(state) {
  return state && [state.width, state.step, state.spinAngle].every(Number.isFinite) && state.width > 0;
}

function validPoints(points) {
  return Array.isArray(points) && points.length >= 2 &&
    points.every((point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite));
}

function validWidths(widths) {
  return Array.isArray(widths) && widths.length >= 3 && widths.every(Number.isFinite);
}

function bezier(points, step) {
  const output = [0, 0, 0];
  const degree = points.length - 1;
  for (let index = 0; index < points.length; index += 1) {
    const blend = factorial(degree) / (factorial(index) * factorial(degree - index)) *
      Math.pow(step, index) * Math.pow(1 - step, degree - index);
    output[0] += points[index][0] * blend;
    output[1] += points[index][1] * blend;
    output[2] += points[index][2] * blend;
  }
  return output;
}

function factorial(value) {
  let result = 1;
  for (let factor = 2; factor <= value; factor += 1) result *= factor;
  return result;
}

function identity4() {
  return [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
}

function multiply4(left, right) {
  return left.map((row) => right[0].map((unused, column) =>
    row.reduce((sum, value, index) => sum + value * right[index][column], 0)));
}

function translation([x, y, z]) {
  const matrix = identity4();
  matrix[0][3] = x;
  matrix[1][3] = y;
  matrix[2][3] = z;
  return matrix;
}

function scale4([x, y, z]) {
  const matrix = identity4();
  matrix[0][0] = x;
  matrix[1][1] = y;
  matrix[2][2] = z;
  return matrix;
}

function rotationY(degrees) {
  const radians = degrees * PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [[cosine, 0, sine, 0], [0, 1, 0, 0], [-sine, 0, cosine, 0], [0, 0, 0, 1]];
}

function rotationAxis(degrees, axis) {
  const length = Math.hypot(...axis);
  if (length < 1e-12 || Math.abs(degrees) < 1e-12) return identity4();
  const [x, y, z] = axis.map((value) => value / length);
  const radians = degrees * PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const one = 1 - cosine;
  return [
    [x * x * one + cosine, x * y * one - z * sine, x * z * one + y * sine, 0],
    [y * x * one + z * sine, y * y * one + cosine, y * z * one - x * sine, 0],
    [z * x * one - y * sine, z * y * one + x * sine, z * z * one + cosine, 0],
    [0, 0, 0, 1],
  ];
}

function flattenCss(matrix) {
  return matrix[0].map((unused, column) => matrix.map((row) => rounded(row[column]))).flat();
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return length > 1e-12 ? vector.map((value) => value / length) : [0, 0, 0];
}

function sub3(left, right) {
  return left.map((value, index) => value - right[index]);
}

function dot3(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function cross3(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value) {
  const result = Number(value.toFixed(6));
  return Object.is(result, -0) ? 0 : result;
}
