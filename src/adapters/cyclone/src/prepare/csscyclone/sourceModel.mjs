import { advanceCycloneParticleTransform } from "../../shared/csscyclone/particleTransform.mjs";

const CONTROL_POINT_COUNT = 6;

export const CSSCYCLONE_SOURCE = Object.freeze({
  repository: "https://github.com/reallyslickscreensavers/reallyslickscreensavers",
  revision: "5f0a788bf0cc47f66a233ed528919295cd1e7500",
  path: "src/cyclone/cyclone.cpp",
  sha256: "1b6268aaf4fe25a43a14a0dcea4c4c58f18c1d2472e1366af2287efd938ea286",
  rslibsRevision: "42d251b1a751956f54c8aad263e78af527ef2b82",
  rslibsMathSha256: "8d81f07b7ec4a0abc2788161fd600a260b648f0747387aff5abfea2b2510da93",
  rgbhslSha256: "1866954fedbb83f5076cf078b35501882307285a88874c4e29658da76130e05b",
  license: "GPL-2.0-or-later",
  fieldOfViewDegrees: 80,
  viewDistance: 400,
  wide: 200,
  high: 200,
  particleSize: 7,
  complexity: 3,
  speed: 10,
  stretch: true,
});

const CSSCYCLONE_DESKTOP_BANK = Object.freeze({
  id: "desktop-stream",
  name: "Cyclone",
  seed: 1,
  particleCount: 400,
  frameMilliseconds: 20,
  warmupFrames: 600,
  frameCount: 450,
  chunkCount: 24,
});

export const CSSCYCLONE_BANKS = Object.freeze({
  desktop: CSSCYCLONE_DESKTOP_BANK,
  mobile: Object.freeze({
    ...CSSCYCLONE_DESKTOP_BANK,
    id: "mobile-stream",
    name: "Cyclone Mobile",
    particleCount: 166,
  }),
});

export const CSSCYCLONE_BANK = CSSCYCLONE_BANKS.desktop;

export const CSSCYCLONE_PRESENTATION = Object.freeze({
  saturationSampling: "floor-0.55-plus-0.45-sqrt-uniform",
  minimumSaturation: 0.55,
  hueSampling: "source-uniform-random-targets",
  particleColorAssignment: "source-hue-at-particle-restart",
  preparedPaletteHueSlotCount: 3,
  preparedPaletteAssignment: "source-hue-quantized-to-session-three-family-variant",
  maximumColorFamilyCount: 3,
  startupPaletteFamilies: Object.freeze(["blue", "yellow", "red", "magenta", "green"]),
  startupSelections: Object.freeze([
    Object.freeze({ id: "blue-a", paletteFamily: "blue", chunkIndex: 0, startFrameIndex: 20, frameCount: 40 }),
    Object.freeze({ id: "blue-b", paletteFamily: "blue", chunkIndex: 0, startFrameIndex: 190, frameCount: 40 }),
    Object.freeze({ id: "yellow-a", paletteFamily: "yellow", chunkIndex: 1, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "yellow-b", paletteFamily: "yellow", chunkIndex: 7, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "red-a", paletteFamily: "red", chunkIndex: 5, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "red-b", paletteFamily: "red", chunkIndex: 9, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "magenta-a", paletteFamily: "magenta", chunkIndex: 4, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "magenta-b", paletteFamily: "magenta", chunkIndex: 11, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "green-a", paletteFamily: "green", chunkIndex: 17, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "green-b", paletteFamily: "green", chunkIndex: 19, startFrameIndex: 55, frameCount: 40 }),
  ]),
  mobileStartupSelections: Object.freeze([
    Object.freeze({ id: "blue-a", paletteFamily: "blue", chunkIndex: 0, startFrameIndex: 75, frameCount: 40 }),
    Object.freeze({ id: "blue-b", paletteFamily: "blue", chunkIndex: 0, startFrameIndex: 190, frameCount: 40 }),
    Object.freeze({ id: "yellow-a", paletteFamily: "yellow", chunkIndex: 1, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "yellow-b", paletteFamily: "yellow", chunkIndex: 7, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "red-a", paletteFamily: "red", chunkIndex: 5, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "red-b", paletteFamily: "red", chunkIndex: 9, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "magenta-a", paletteFamily: "magenta", chunkIndex: 4, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "magenta-b", paletteFamily: "magenta", chunkIndex: 11, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "green-a", paletteFamily: "green", chunkIndex: 17, startFrameIndex: 55, frameCount: 40 }),
    Object.freeze({ id: "green-b", paletteFamily: "green", chunkIndex: 19, startFrameIndex: 55, frameCount: 40 }),
  ]),
  startupSilhouetteSampling: "browser-reviewed-expressive-source-windows",
  startupSilhouetteSampleFrameOffsets: Object.freeze([0, 10, 20, 30, 39]),
  startupMinimumMeanSaturation: 0.68,
  startupMinimumDominantHueShare: 0.25,
});

export function buildCycloneSourceSequence({ bank = CSSCYCLONE_BANK } = {}) {
  return buildCycloneSourceChunks({ bank }).next().value;
}

export function* buildCycloneSourceChunks({ bank = CSSCYCLONE_BANK } = {}) {
  validateBank(bank);
  const rng = createMt19937(bank.seed);
  const cyclone = createCyclone(rng);
  const particles = Array.from({ length: bank.particleCount }, () => createParticle(cyclone, rng));
  const deltaSeconds = bank.frameMilliseconds / 1_000;
  for (let frame = 0; frame < bank.warmupFrames; frame += 1) {
    stepSource(cyclone, particles, rng, deltaSeconds);
  }
  for (let chunkIndex = 0; chunkIndex < bank.chunkCount; chunkIndex += 1) {
    const frames = [];
    const startFrameIndex = chunkIndex * bank.frameCount;
    for (let frame = 0; frame < bank.frameCount; frame += 1) {
      const transformState = stepSource(cyclone, particles, rng, deltaSeconds);
      frames.push(Object.freeze({
        timeMs: (startFrameIndex + frame) * bank.frameMilliseconds,
        transformState,
        particles: Object.freeze(particles.map((particle) => Object.freeze({
          matrix: particle.matrix,
          color: particle.color,
          colorRgb: particle.colorRgb,
        }))),
      }));
    }
    yield deepFreeze({
      schema: "csscyclone-source-sequence@2",
      source: CSSCYCLONE_SOURCE,
      bank: Object.freeze({
        ...bank,
        id: `chunk-${String(chunkIndex).padStart(2, "0")}`,
        streamId: bank.id,
        chunkIndex,
        startFrameIndex,
      }),
      modelMatrix: flattenCss(multiply4(scale4([1, -1, 1]), translation([0, 0, -CSSCYCLONE_SOURCE.viewDistance]))),
      frames,
      durationMilliseconds: bank.frameCount * bank.frameMilliseconds,
      streamDurationMilliseconds: bank.chunkCount * bank.frameCount * bank.frameMilliseconds,
    });
  }
}

export function selectCycloneSourceParticlePrefix(source, bank = CSSCYCLONE_BANKS.mobile) {
  validateBank(bank);
  if (source?.schema !== "csscyclone-source-sequence@2" ||
      !Array.isArray(source.frames) || source.frames.length !== source.bank?.frameCount ||
      bank.particleCount > source.bank.particleCount ||
      bank.seed !== source.bank.seed ||
      bank.frameMilliseconds !== source.bank.frameMilliseconds ||
      bank.warmupFrames !== source.bank.warmupFrames ||
      bank.frameCount !== source.bank.frameCount ||
      bank.chunkCount !== source.bank.chunkCount) {
    throw new Error("Cyclone mobile particle-prefix source binding drifted");
  }
  return deepFreeze({
    ...source,
    bank: Object.freeze({
      ...bank,
      id: source.bank.id,
      streamId: bank.id,
      chunkIndex: source.bank.chunkIndex,
      startFrameIndex: source.bank.startFrameIndex,
    }),
    frames: Object.freeze(source.frames.map((frame) => Object.freeze({
      ...frame,
      transformState: Object.freeze({
        ...frame.transformState,
        particles: Object.freeze(frame.transformState.particles.slice(0, bank.particleCount)),
      }),
      particles: Object.freeze(frame.particles.slice(0, bank.particleCount)),
    }))),
  });
}

function validateBank(bank) {
  for (const [name, value] of Object.entries({
    seed: bank?.seed,
    particleCount: bank?.particleCount,
    frameMilliseconds: bank?.frameMilliseconds,
    warmupFrames: bank?.warmupFrames,
    frameCount: bank?.frameCount,
    chunkCount: bank?.chunkCount,
  })) {
    if (!Number.isSafeInteger(value) || value < (name === "warmupFrames" ? 0 : 1)) {
      throw new RangeError(`Cyclone ${name} must be a positive safe integer`);
    }
  }
}

function createCyclone(rng) {
  const xyz = Array.from({ length: CONTROL_POINT_COUNT }, () => [0, 0, 0]);
  const targetxyz = Array.from({ length: CONTROL_POINT_COUNT }, () => [0, 0, 0]);
  const oldxyz = Array.from({ length: CONTROL_POINT_COUNT }, () => [0, 0, 0]);
  const last = CONTROL_POINT_COUNT - 1;
  xyz[last] = [randf(rng, 400) - 200, 200, randf(rng, 400) - 200];
  xyz[last - 1] = [xyz[last][0], randf(rng, 66) + 50, xyz[last][2]];
  for (let index = CSSCYCLONE_SOURCE.complexity; index > 1; index -= 1) {
    xyz[index] = [
      xyz[index + 1][0] + randf(rng, 200) - 100,
      randf(rng, 400) - 200,
      xyz[index + 1][2] + randf(rng, 200) - 100,
    ];
  }
  xyz[1] = [
    xyz[2][0] + randf(rng, 100) - 50,
    -randf(rng, 100) - 50,
    xyz[2][2] + randf(rng, 100) - 50,
  ];
  xyz[0] = [
    xyz[1][0] + randf(rng, 25) - 12,
    -200,
    xyz[1][2] + randf(rng, 25) - 12,
  ];
  for (let index = 0; index < CONTROL_POINT_COUNT; index += 1) {
    targetxyz[index] = [...xyz[index]];
    oldxyz[index] = [...xyz[index]];
  }
  const width = Array(CONTROL_POINT_COUNT).fill(0);
  width[last] = randf(rng, 175) + 75;
  width[last - 1] = randf(rng, 60) + 15;
  for (let index = CSSCYCLONE_SOURCE.complexity; index > 1; index -= 1) width[index] = randf(rng, 25) + 15;
  width[1] = randf(rng, 25) + 5;
  width[0] = randf(rng, 15) + 5;
  const hue = randf(rng, 1);
  const saturation = randomSaturation(rng);
  return {
    xyz,
    targetxyz,
    oldxyz,
    xyzChange: Array.from({ length: CONTROL_POINT_COUNT }, () => [0, 0]),
    width,
    targetWidth: [...width],
    oldWidth: [...width],
    widthChange: Array.from({ length: CONTROL_POINT_COUNT }, () => [0, 0]),
    hsl: [hue, saturation, 0],
    oldhsl: [hue, saturation, 0],
    targethsl: [randf(rng, 1), randomSaturation(rng), 1],
    hslChange: [0, 10],
  };
}

function createParticle(cyclone, rng) {
  const particle = {
    cyclone,
    width: 0,
    step: 0,
    spinAngle: 0,
    color: "#000000",
    colorRgb: Object.freeze([0, 0, 0]),
    matrix: identity4Flat(),
  };
  resetParticle(particle, rng);
  return particle;
}

function resetParticle(particle, rng) {
  particle.width = randf(rng, 0.8) + 0.2;
  particle.step = 0;
  particle.spinAngle = randf(rng, 360);
  particle.colorRgb = Object.freeze(hsl2rgb(...particle.cyclone.hsl));
  particle.color = rgbHex(particle.colorRgb);
}

function stepSource(cyclone, particles, rng, deltaSeconds) {
  updateCyclone(cyclone, rng, deltaSeconds);
  const particleStates = particles.map((particle) => updateParticle(particle, rng, deltaSeconds));
  return Object.freeze({
    points: Object.freeze(cyclone.xyz.map((point) => Object.freeze([...point]))),
    widths: Object.freeze([...cyclone.width]),
    particles: Object.freeze(particleStates),
  });
}

function updateCyclone(cyclone, rng, deltaSeconds) {
  const speed = CSSCYCLONE_SOURCE.speed;
  const last = CONTROL_POINT_COUNT - 1;
  retargetPoint(cyclone, last, rng, () => [randf(rng, 400) - 200, 200, randf(rng, 400) - 200], 75 / speed, 150 / speed);
  retargetPoint(cyclone, last - 1, rng, () => [
    cyclone.xyz[last][0],
    randf(rng, 66) + 50,
    cyclone.xyz[last][2],
  ], 75 / speed, 100 / speed);
  for (let index = CSSCYCLONE_SOURCE.complexity; index > 1; index -= 1) {
    retargetPoint(cyclone, index, rng, () => [
      cyclone.targetxyz[index + 1][0] +
        (cyclone.targetxyz[index + 1][0] - cyclone.targetxyz[index + 2][0]) / 2 + randf(rng, 100) - 50,
      clamp((cyclone.targetxyz[index + 1][1] + cyclone.targetxyz[index - 1][1]) / 2 + randf(rng, 25) - 12, -200, 200),
      cyclone.targetxyz[index + 1][2] +
        (cyclone.targetxyz[index + 1][2] - cyclone.targetxyz[index + 2][2]) / 2 + randf(rng, 100) - 50,
    ], 50 / speed, 75 / speed);
  }
  retargetPoint(cyclone, 1, rng, () => [
    cyclone.targetxyz[2][0] + randf(rng, 100) - 50,
    -randf(rng, 100) - 50,
    cyclone.targetxyz[2][2] + randf(rng, 100) - 50,
  ], 30 / speed, 50 / speed);
  retargetPoint(cyclone, 0, rng, () => [
    cyclone.xyz[1][0] + randf(rng, 25) - 12,
    -200,
    cyclone.xyz[1][2] + randf(rng, 25) - 12,
  ], 75 / speed, 100 / speed);
  for (let index = 0; index < CONTROL_POINT_COUNT; index += 1) {
    const transition = cyclone.xyzChange[index];
    const phase = transition[1] === 0 ? 0 : transition[0] / transition[1] * Math.PI * 2;
    const between = (1 - Math.cos(phase)) / 2;
    cyclone.xyz[index] = mix3(cyclone.oldxyz[index], cyclone.targetxyz[index], between);
    transition[0] += deltaSeconds;
  }

  retargetWidth(cyclone, last, rng, 75, 225, 50 / speed, 50 / speed);
  retargetWidth(cyclone, last - 1, rng, 15, 100, 50 / speed, 50 / speed);
  for (let index = CSSCYCLONE_SOURCE.complexity; index > 1; index -= 1) {
    retargetWidth(cyclone, index, rng, 15, 50, 40 / speed, 50 / speed);
  }
  retargetWidth(cyclone, 1, rng, 5, 40, 30 / speed, 50 / speed);
  retargetWidth(cyclone, 0, rng, 5, 30, 20 / speed, 50 / speed);
  for (let index = 0; index < CONTROL_POINT_COUNT; index += 1) {
    const transition = cyclone.widthChange[index];
    const between = transition[1] === 0 ? 0 : transition[0] / transition[1];
    cyclone.width[index] = mix(cyclone.oldWidth[index], cyclone.targetWidth[index], between);
    transition[0] += deltaSeconds;
  }

  if (cyclone.hslChange[0] >= cyclone.hslChange[1]) {
    cyclone.oldhsl = [...cyclone.hsl];
    cyclone.targethsl = [randf(rng, 1), randomSaturation(rng), Math.min(1, randf(rng, 1) + 0.5)];
    cyclone.hslChange = [0, randf(rng, 30) + 2];
  }
  const between = cyclone.hslChange[0] / cyclone.hslChange[1];
  const diff = cyclone.targethsl[0] - cyclone.oldhsl[0];
  const direction = (diff > 0.5 || diff < -0.5) && diff > 0.5 ? 1 : 0;
  cyclone.hsl = hslTween(cyclone.oldhsl, cyclone.targethsl, between, direction);
  cyclone.hslChange[0] += deltaSeconds;
}

function retargetPoint(cyclone, index, rng, next, minimumDuration, randomDuration) {
  const transition = cyclone.xyzChange[index];
  if (transition[0] < transition[1]) return;
  cyclone.oldxyz[index] = [...cyclone.xyz[index]];
  cyclone.targetxyz[index] = next();
  transition[0] = 0;
  transition[1] = randf(rng, randomDuration) + minimumDuration;
}

function retargetWidth(cyclone, index, rng, minimum, randomRange, minimumDuration, randomDuration) {
  const transition = cyclone.widthChange[index];
  if (transition[0] < transition[1]) return;
  cyclone.oldWidth[index] = cyclone.width[index];
  cyclone.targetWidth[index] = randf(rng, randomRange) + minimum;
  transition[0] = 0;
  transition[1] = randf(rng, randomDuration) + minimumDuration;
}

function updateParticle(particle, rng, deltaSeconds) {
  const reset = particle.step > 1;
  if (reset) resetParticle(particle, rng);
  const preparedState = Object.freeze({
    width: particle.width,
    step: particle.step,
    spinAngle: particle.spinAngle,
    reset,
  });
  const advanced = advanceCycloneParticleTransform({
    state: preparedState,
    points: particle.cyclone.xyz,
    widths: particle.cyclone.width,
    deltaSeconds,
    speed: CSSCYCLONE_SOURCE.speed,
    complexity: CSSCYCLONE_SOURCE.complexity,
    particleSize: CSSCYCLONE_SOURCE.particleSize,
  });
  particle.width = advanced.state.width;
  particle.step = advanced.state.step;
  particle.spinAngle = advanced.state.spinAngle;
  particle.matrix = advanced.matrix;
  return preparedState;
}

function hsl2rgb(hue, saturation, luminosity) {
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
  red = (1 - saturation * (1 - red)) * luminosity;
  green = (1 - saturation * (1 - green)) * luminosity;
  blue = (1 - saturation * (1 - blue)) * luminosity;
  return [red, green, blue];
}

function hslTween(from, to, tween, direction) {
  let hue;
  if (!direction) {
    hue = to[0] >= from[0]
      ? from[0] + tween * (to[0] - from[0])
      : from[0] + tween * (1 - (from[0] - to[0]));
    if (hue > 1) hue -= 1;
  } else {
    hue = from[0] >= to[0]
      ? from[0] - tween * (from[0] - to[0])
      : from[0] - tween * (1 - (to[0] - from[0]));
    if (hue < 0) hue += 1;
  }
  return [hue, mix(from[1], to[1], tween), mix(from[2], to[2], tween)];
}

function createMt19937(seed) {
  const state = new Uint32Array(624);
  state[0] = seed >>> 0;
  for (let index = 1; index < state.length; index += 1) {
    state[index] = (Math.imul(1812433253, state[index - 1] ^ (state[index - 1] >>> 30)) + index) >>> 0;
  }
  let cursor = state.length;
  return Object.freeze({
    nextFloat() {
      if (cursor >= state.length) {
        for (let index = 0; index < state.length; index += 1) {
          const value = (state[index] & 0x80000000) | (state[(index + 1) % 624] & 0x7fffffff);
          state[index] = state[(index + 397) % 624] ^ (value >>> 1) ^ ((value & 1) ? 0x9908b0df : 0);
        }
        cursor = 0;
      }
      let value = state[cursor++];
      value ^= value >>> 11;
      value ^= (value << 7) & 0x9d2c5680;
      value ^= (value << 15) & 0xefc60000;
      value ^= value >>> 18;
      return (value >>> 8) / 0x01000000;
    },
  });
}

function randf(rng, maximum) {
  return rng.nextFloat() * maximum;
}

function randomSaturation(rng) {
  const vividSample = Math.sqrt(randf(rng, 1));
  return CSSCYCLONE_PRESENTATION.minimumSaturation +
    (1 - CSSCYCLONE_PRESENTATION.minimumSaturation) * vividSample;
}

function identity4() {
  return [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
}

function identity4Flat() {
  return Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function multiply4(left, right) {
  return left.map((row) => right[0].map((_, column) =>
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

function flattenCss(matrix) {
  return Object.freeze(matrix[0].map((_, column) => matrix.map((row) => rounded(row[column]))).flat());
}

function rounded(value) {
  const result = Number(value.toFixed(6));
  return Object.is(result, -0) ? 0 : result;
}

function rgbHex(color) {
  return `#${color.map((value) => Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function mix(left, right, amount) {
  return left + (right - left) * amount;
}

function mix3(left, right, amount) {
  return left.map((value, index) => mix(value, right[index], amount));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
