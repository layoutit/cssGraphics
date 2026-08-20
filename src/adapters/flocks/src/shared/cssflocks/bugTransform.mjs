// SPDX-License-Identifier: GPL-2.0-or-later
export function buildFlocksBugMatrix(position, velocity, stretchAmount = 20) {
  if (!Array.isArray(position) || position.length !== 3 || position.some((value) => !Number.isFinite(value)) ||
      !Array.isArray(velocity) || velocity.length !== 3 || velocity.some((value) => !Number.isFinite(value)) ||
      !Number.isFinite(stretchAmount) || stretchAmount < 0) {
    throw new TypeError("Complete Flocks bug transform inputs are required");
  }
  const velocityLength = Math.hypot(...velocity);
  const direction = velocityLength > 0 ? velocity.map((value) => value / velocityLength) : [0, 0, 0];
  const stretch = Math.max(velocityLength * 0.04 * stretchAmount * 0.05, 1);
  const yaw = velocityLength > 0 ? Math.atan2(-direction[0], -direction[2]) : 0;
  const pitch = velocityLength > 0 ? Math.asin(clamp(direction[1], -1, 1)) : 0;
  return Object.freeze({
    direction: Object.freeze(direction.map(rounded)),
    stretch: rounded(stretch),
    matrix: flattenCss(multiply4(
      translation(position),
      multiply4(rotationY(yaw), multiply4(rotationX(pitch), scale4([1, 1, stretch]))),
    )),
  });
}

export function flocksHueToHex(hue) {
  if (!Number.isFinite(hue)) throw new TypeError("Flocks hue must be finite");
  return `#${flocksHueToRgb(hue)
    .map((value) => Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function flocksHueToRgb(hue, saturation = 1, luminosity = 1) {
  if (![hue, saturation, luminosity].every(Number.isFinite)) {
    throw new TypeError("Finite Flocks HSL values are required");
  }
  let h = hue % 1;
  if (h < 0) h += 1;
  let red;
  let green;
  let blue;
  if (h < 1 / 6) {
    red = 1; green = h * 6; blue = 0;
  } else if (h < 1 / 2) {
    green = 1;
    if (h < 1 / 3) {
      red = 1 - (h - 1 / 6) * 6; blue = 0;
    } else {
      blue = (h - 1 / 3) * 6; red = 0;
    }
  } else if (h < 5 / 6) {
    blue = 1;
    if (h < 2 / 3) {
      green = 1 - (h - 1 / 2) * 6; red = 0;
    } else {
      red = (h - 2 / 3) * 6; green = 0;
    }
  } else {
    red = 1; blue = 1 - (h - 5 / 6) * 6; green = 0;
  }
  return [red, green, blue].map((channel) => (1 - saturation * (1 - channel)) * luminosity);
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
  matrix[0][3] = x; matrix[1][3] = y; matrix[2][3] = z;
  return matrix;
}

function scale4([x, y, z]) {
  const matrix = identity4();
  matrix[0][0] = x; matrix[1][1] = y; matrix[2][2] = z;
  return matrix;
}

function rotationY(radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [[cosine, 0, sine, 0], [0, 1, 0, 0], [-sine, 0, cosine, 0], [0, 0, 0, 1]];
}

function rotationX(radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [[1, 0, 0, 0], [0, cosine, -sine, 0], [0, sine, cosine, 0], [0, 0, 0, 1]];
}

function flattenCss(matrix) {
  return Object.freeze(matrix[0].map((unused, column) => matrix.map((row) => rounded(row[column]))).flat());
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value) {
  const result = Number(value.toFixed(6));
  return Object.is(result, -0) ? 0 : result;
}
