// SPDX-License-Identifier: GPL-2.0-only
// Adapted for cssGraphics on 2026-08-09 from oppegard/electropaint
// commit 714092ad588e668bee9eb66dfdc94c66f516452b.

export const identity = () => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += a[index * 4 + row] * b[column * 4 + index];
      }
      out[column * 4 + row] = value;
    }
  }
  return out;
}

export function invertAffine(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 16 ||
      matrix.some((value) => !Number.isFinite(value)) ||
      Math.abs(matrix[3]) > 1e-12 || Math.abs(matrix[7]) > 1e-12 ||
      Math.abs(matrix[11]) > 1e-12 || Math.abs(matrix[15] - 1) > 1e-12) {
    throw new TypeError("Expected a finite affine matrix");
  }
  const a00 = matrix[0];
  const a01 = matrix[4];
  const a02 = matrix[8];
  const a10 = matrix[1];
  const a11 = matrix[5];
  const a12 = matrix[9];
  const a20 = matrix[2];
  const a21 = matrix[6];
  const a22 = matrix[10];
  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  const determinant = a00 * b01 + a01 * b11 + a02 * b21;
  if (Math.abs(determinant) < 1e-12) throw new Error("Cannot invert a singular affine matrix");
  const inverseDeterminant = 1 / determinant;
  const r00 = b01 * inverseDeterminant;
  const r01 = (-a22 * a01 + a02 * a21) * inverseDeterminant;
  const r02 = (a12 * a01 - a02 * a11) * inverseDeterminant;
  const r10 = b11 * inverseDeterminant;
  const r11 = (a22 * a00 - a02 * a20) * inverseDeterminant;
  const r12 = (-a12 * a00 + a02 * a10) * inverseDeterminant;
  const r20 = b21 * inverseDeterminant;
  const r21 = (-a21 * a00 + a01 * a20) * inverseDeterminant;
  const r22 = (a11 * a00 - a01 * a10) * inverseDeterminant;
  const tx = matrix[12];
  const ty = matrix[13];
  const tz = matrix[14];
  return [
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    -(r00 * tx + r01 * ty + r02 * tz),
    -(r10 * tx + r11 * ty + r12 * tz),
    -(r20 * tx + r21 * ty + r22 * tz),
    1,
  ];
}

export const translation = (x, y, z) => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  x, y, z, 1,
];

export const scaling = (x, y, z) => [
  x, 0, 0, 0,
  0, y, 0, 0,
  0, 0, z, 0,
  0, 0, 0, 1,
];

const radians = (degrees) => degrees * Math.PI / 180;

export function rotationX(degrees) {
  const cosine = Math.cos(radians(degrees));
  const sine = Math.sin(radians(degrees));
  return [1, 0, 0, 0, 0, cosine, sine, 0, 0, -sine, cosine, 0, 0, 0, 0, 1];
}

export function rotationY(degrees) {
  const cosine = Math.cos(radians(degrees));
  const sine = Math.sin(radians(degrees));
  return [cosine, 0, -sine, 0, 0, 1, 0, 0, sine, 0, cosine, 0, 0, 0, 0, 1];
}

export function rotationZ(degrees) {
  const cosine = Math.cos(radians(degrees));
  const sine = Math.sin(radians(degrees));
  return [cosine, sine, 0, 0, -sine, cosine, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function hlsToRgb(hue, lightness, saturation) {
  let degrees = hue * 360;
  const component = (low, high, input) => {
    let adjusted = input;
    if (adjusted > 360) adjusted -= 360;
    if (adjusted < 0) adjusted += 360;
    if (adjusted < 60) return low + (high - low) * adjusted / 60;
    if (adjusted < 180) return high;
    if (adjusted < 240) return low + (high - low) * (240 - adjusted) / 60;
    return low;
  };
  if (saturation === 0) return [lightness, lightness, lightness];
  const high = lightness <= 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const low = 2 * lightness - high;
  degrees %= 360;
  return [
    component(low, high, degrees + 120),
    component(low, high, degrees),
    component(low, high, degrees - 120),
  ];
}

export function wrap(value, minimum, maximum) {
  const range = maximum - minimum;
  if (range === 0) return minimum;
  return ((value - minimum) % range + range) % range + minimum;
}
