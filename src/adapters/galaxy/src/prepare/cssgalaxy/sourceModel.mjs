// SPDX-License-Identifier: HPND

const VECTOR = Object.freeze([
  3951096678, 1141277249, 2480103125, 2707569682, 299730482, 4259445343,
  4196601416, 1927830288, 2552754534, 2039360758, 1739546395, 2394763994,
  2645429346, 578465010, 1138168509, 960347592, 1218805097, 331920724,
  136757403, 1372238758, 951837919, 912608081, 1641202836, 3597483205,
  2609610878, 342647964, 1790781987, 3083359110, 126547608, 735593562,
  1364860169, 88240761, 123161791, 2168127358, 2950153604, 1047427037,
  1861311165, 2109159457, 890034277, 2381957287, 1711222699, 387884763,
  3785047504, 3233886172, 1607866416, 4041823072, 984949279, 2748545107,
  838981238, 1096414934, 1859160272, 1946436445, 1916111696, 3644183052,
  2082959571,
]);

export const CSSGALAXY_SOURCE = Object.freeze({
  repository: "https://github.com/Zygo/xscreensaver",
  revision: "906693799e4fb7581436590cf84ecb2d3c9186ba",
  path: "hacks/galaxy.c",
  sha256: "801b7a7ff3749b032974b8dfe9021c2e3998645f138f9beec7e09037e36d66d9",
  license: "HPND",
});

export const CSSGALAXY_CONSTANTS = Object.freeze({
  minGalaxies: 2,
  maxGalaxies: 5,
  maxStars: 3000,
  deltaT: 0.005,
  epsilon: 0.00000001,
  sqrtEpsilon: 0.0001,
  galaxyRangeSize: 0.1,
  galaxyMinSize: 0.15,
  qcons: 0.001,
  colorBase: 16,
  ncolors: 64,
});

export const CSSGALAXY_CADENCE = Object.freeze({
  sourceFramesPerSecond: 50,
  framesPerSecond: 60,
  frameMilliseconds: 1000 / 60,
  blockSeconds: 4,
  bankSeconds: 24,
  bankCount: 5,
  streamSeconds: 120,
});

export const CSSGALAXY_VARIANT_COUNTS = Object.freeze([600, 800, 1200, 1500, 1600, 1900]);
export const CSSGALAXY_MOBILE_STAR_COUNT = 1000;
export const CSSGALAXY_PREPARED_GALAXY_COUNTS = Object.freeze([2, 3]);
export const CSSGALAXY_VIEWPORT = Object.freeze({ width: 800, height: 600 });

export function createGalaxySourceUniverse({
  seed,
  width = CSSGALAXY_VIEWPORT.width,
  height = CSSGALAXY_VIEWPORT.height,
  cycles = 250,
  galaxyCount = 2,
} = {}) {
  if (!Number.isSafeInteger(seed) || seed <= 0 || seed > 0xffffffff) {
    throw new RangeError("Galaxy authoring seed must be a non-zero uint32");
  }
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new RangeError("Galaxy viewport must use positive integer dimensions");
  }
  if (!Number.isSafeInteger(cycles) || cycles < 1 || !Number.isSafeInteger(galaxyCount) ||
      galaxyCount < CSSGALAXY_CONSTANTS.minGalaxies ||
      galaxyCount > CSSGALAXY_CONSTANTS.maxGalaxies) {
    throw new RangeError("Galaxy prototype requires positive cycles and two to five galaxies");
  }
  const rng = createYaRandom(seed);
  const palette = createUniformPalette(rng, CSSGALAXY_CONSTANTS.ncolors);
  const universe = {
    seed,
    width,
    height,
    cycles,
    galaxyCount,
    rng,
    palette,
    scale: (width + height) / 8,
    midx: Math.floor(width / 2),
    midy: Math.floor(height / 2),
    pscale: 1,
    galaxies: [],
    step: 0,
    globalFrameIndex: 0,
    generation: -1,
    rotX: 0,
    rotY: 0,
    restartPending: false,
  };
  startOver(universe);
  return universe;
}

export function advanceGalaxySource(universe) {
  if (universe.restartPending) {
    startOver(universe);
    universe.restartPending = false;
  }
  universe.rotY += 0.01;
  universe.rotX += 0.004;
  const cox = fcos(universe.rotY);
  const six = fsin(universe.rotY);
  const cor = fcos(universe.rotX);
  const sir = fsin(universe.rotX);
  const { deltaT, epsilon, sqrtEpsilon, qcons } = CSSGALAXY_CONSTANTS;
  const eps = 1 / (epsilon * sqrtEpsilon * deltaT * deltaT * qcons);

  for (let galaxyIndex = 0; galaxyIndex < universe.galaxies.length; galaxyIndex += 1) {
    const galaxy = universe.galaxies[galaxyIndex];
    for (let starIndex = 0; starIndex < galaxy.stars.length; starIndex += 1) {
      const star = galaxy.stars[starIndex];
      let v0 = star.vel[0];
      let v1 = star.vel[1];
      let v2 = star.vel[2];
      for (let attractorIndex = 0; attractorIndex < universe.galaxies.length; attractorIndex += 1) {
        const attractor = universe.galaxies[attractorIndex];
        const d0 = attractor.pos[0] - star.pos[0];
        const d1 = attractor.pos[1] - star.pos[1];
        const d2 = attractor.pos[2] - star.pos[2];
        const squaredDistance = d0 * d0 + d1 * d1 + d2 * d2;
        const acceleration = squaredDistance > epsilon
          ? attractor.mass / (squaredDistance * Math.sqrt(squaredDistance)) * deltaT * deltaT * qcons
          : attractor.mass / (eps * Math.sqrt(eps));
        v0 += d0 * acceleration;
        v1 += d1 * acceleration;
        v2 += d2 * acceleration;
      }
      star.vel[0] = v0;
      star.vel[1] = v1;
      star.vel[2] = v2;
      star.pos[0] += v0;
      star.pos[1] += v1;
      star.pos[2] += v2;
      star.x = toShort(((cox * star.pos[0]) - (six * star.pos[2])) *
        universe.scale * universe.pscale + universe.midx);
      star.y = toShort(((cor * star.pos[1]) -
        (sir * ((six * star.pos[0]) + (cox * star.pos[2])))) *
        universe.scale * universe.pscale + universe.midy);
    }

    for (let otherIndex = galaxyIndex + 1; otherIndex < universe.galaxies.length; otherIndex += 1) {
      const other = universe.galaxies[otherIndex];
      let d0 = other.pos[0] - galaxy.pos[0];
      let d1 = other.pos[1] - galaxy.pos[1];
      let d2 = other.pos[2] - galaxy.pos[2];
      const squaredDistance = d0 * d0 + d1 * d1 + d2 * d2;
      const acceleration = squaredDistance > epsilon
        ? 1 / (squaredDistance * Math.sqrt(squaredDistance)) * deltaT * qcons
        : 1 / (epsilon * sqrtEpsilon) * deltaT * qcons;
      d0 *= acceleration;
      d1 *= acceleration;
      d2 *= acceleration;
      galaxy.vel[0] += d0 * other.mass;
      galaxy.vel[1] += d1 * other.mass;
      galaxy.vel[2] += d2 * other.mass;
      other.vel[0] -= d0 * galaxy.mass;
      other.vel[1] -= d1 * galaxy.mass;
      other.vel[2] -= d2 * galaxy.mass;
    }
    galaxy.pos[0] += galaxy.vel[0] * deltaT;
    galaxy.pos[1] += galaxy.vel[1] * deltaT;
    galaxy.pos[2] += galaxy.vel[2] * deltaT;
  }

  const frame = Object.freeze({
    index: universe.globalFrameIndex,
    generation: universe.generation,
    generationFrameIndex: universe.step,
    rotX: universe.rotX,
    rotY: universe.rotY,
    universe,
  });
  universe.globalFrameIndex += 1;
  universe.step += 1;
  if (universe.step > universe.cycles * 4) universe.restartPending = true;
  return frame;
}

export function commitGalaxySourceFrame(universe) {
  for (const galaxy of universe.galaxies) {
    for (const star of galaxy.stars) {
      star.oldX = star.x;
      star.oldY = star.y;
    }
  }
}

export function renderGalaxyPrefixFrame(frame, totalStarCount) {
  validateVariantCount(totalStarCount);
  const prefixCounts = distributeGalaxyPrefixCounts(totalStarCount, frame.universe.galaxies.length);
  const laterOldPoints = new Array(frame.universe.galaxies.length);
  const suffixOldPoints = new Set();
  for (let galaxyIndex = frame.universe.galaxies.length - 1; galaxyIndex >= 0; galaxyIndex -= 1) {
    laterOldPoints[galaxyIndex] = new Set(suffixOldPoints);
    const galaxy = frame.universe.galaxies[galaxyIndex];
    for (let index = 0; index < prefixCounts[galaxyIndex]; index += 1) {
      suffixOldPoints.add(pointKey(galaxy.stars[index].oldX, galaxy.stars[index].oldY));
    }
  }
  const transforms = new Array(totalStarCount);
  let offset = 0;
  for (let galaxyIndex = 0; galaxyIndex < frame.universe.galaxies.length; galaxyIndex += 1) {
    const galaxy = frame.universe.galaxies[galaxyIndex];
    for (let index = 0; index < prefixCounts[galaxyIndex]; index += 1) {
      const star = galaxy.stars[index];
      const erasedByLaterGalaxy = laterOldPoints[galaxyIndex].has(pointKey(star.x, star.y));
      transforms[offset] = erasedByLaterGalaxy
        ? "translate3d(-32768px,-32768px,0)"
        : `translate3d(${star.x}px,${star.y}px,0)`;
      offset += 1;
    }
  }
  return Object.freeze({
    transforms: Object.freeze(transforms),
    colors: Object.freeze(frame.universe.galaxies.map((galaxy) => galaxy.color)),
  });
}

export function snapshotGalaxyState(frame, totalStarCount = 1900) {
  validateVariantCount(totalStarCount);
  const prefixCounts = distributeGalaxyPrefixCounts(totalStarCount, frame.universe.galaxies.length);
  return Object.freeze({
    index: frame.index,
    generation: frame.generation,
    generationFrameIndex: frame.generationFrameIndex,
    rotX: frame.rotX,
    rotY: frame.rotY,
    galaxies: Object.freeze(frame.universe.galaxies.map((galaxy, galaxyIndex) => Object.freeze({
      mass: galaxy.mass,
      nstars: galaxy.stars.length,
      galcol: galaxy.galcol,
      color: galaxy.color,
      pos: Object.freeze([...galaxy.pos]),
      vel: Object.freeze([...galaxy.vel]),
      stars: Object.freeze(galaxy.stars.slice(0, prefixCounts[galaxyIndex]).map((star) => Object.freeze({
        pos: Object.freeze([...star.pos]),
        vel: Object.freeze([...star.vel]),
        x: star.x,
        y: star.y,
      }))),
    }))),
  });
}

export function projectGalaxyCenter(universe, galaxy) {
  const cox = fcos(universe.rotY);
  const six = fsin(universe.rotY);
  const cor = fcos(universe.rotX);
  const sir = fsin(universe.rotX);
  return Object.freeze([
    ((cox * galaxy.pos[0]) - (six * galaxy.pos[2])) * universe.scale + universe.midx,
    ((cor * galaxy.pos[1]) - (sir * ((six * galaxy.pos[0]) + (cox * galaxy.pos[2])))) *
      universe.scale + universe.midy,
  ]);
}

export function distributeGalaxyPrefixCounts(totalStarCount, galaxyCount) {
  validateVariantCount(totalStarCount);
  if (!Number.isSafeInteger(galaxyCount) || galaxyCount < CSSGALAXY_CONSTANTS.minGalaxies ||
      galaxyCount > CSSGALAXY_CONSTANTS.maxGalaxies) {
    throw new RangeError("Galaxy prefix distribution requires two to five galaxies");
  }
  const baseCount = Math.floor(totalStarCount / galaxyCount);
  const remainder = totalStarCount % galaxyCount;
  return Object.freeze(Array.from(
    { length: galaxyCount }, (_, galaxyIndex) => baseCount + Number(galaxyIndex < remainder)));
}

export function createYaRandom(seed) {
  const values = new Uint32Array(VECTOR);
  let authoringSeed = seed >>> 0;
  values[0] = (values[0] + authoringSeed) >>> 0;
  for (let index = 1; index < values.length; index += 1) {
    authoringSeed = Math.imul(authoringSeed, 999) >>> 0;
    authoringSeed = rotateLeft(authoringSeed, 9);
    authoringSeed = (authoringSeed + Math.imul(values[index - 1], 1001)) >>> 0;
    authoringSeed = rotateLeft(authoringSeed, 15);
    values[index] = (values[index] + authoringSeed) >>> 0;
  }
  let index1 = values[0] % values.length;
  let index2 = (index1 + 24) % values.length;
  return Object.freeze({
    random() {
      const result = (values[index1] + values[index2]) >>> 0;
      values[index1] = result;
      index1 = index1 + 1 === values.length ? 0 : index1 + 1;
      index2 = index2 + 1 === values.length ? 0 : index2 + 1;
      return result;
    },
  });
}

function startOver(universe) {
  universe.step = 0;
  universe.rotY = 0;
  universe.rotX = 0;
  universe.generation += 1;
  universe.galaxies = Array.from({ length: universe.galaxyCount }, () => createGalaxy(universe));
}

function createGalaxy(universe) {
  const { rng } = universe;
  let galcol = nrand(rng, CSSGALAXY_CONSTANTS.colorBase - 2);
  if (galcol > 1) galcol += 2;
  const nstars = nrand(rng, CSSGALAXY_CONSTANTS.maxStars / 2) + CSSGALAXY_CONSTANTS.maxStars / 2;
  const w1 = 2 * Math.PI * floatRand(rng);
  const w2 = 2 * Math.PI * floatRand(rng);
  const sinw1 = fsin(w1);
  const sinw2 = fsin(w2);
  const cosw1 = fcos(w1);
  const cosw2 = fcos(w2);
  const matrix = [
    [cosw2, -sinw1 * sinw2, cosw1 * sinw2],
    [0, cosw1, sinw1],
    [-sinw2, -sinw1 * cosw2, cosw1 * cosw2],
  ];
  const vel = [floatRand(rng) * 2 - 1, floatRand(rng) * 2 - 1, floatRand(rng) * 2 - 1];
  const pos = [
    -vel[0] * CSSGALAXY_CONSTANTS.deltaT * universe.cycles + floatRand(rng) - 0.5,
    -vel[1] * CSSGALAXY_CONSTANTS.deltaT * universe.cycles + floatRand(rng) - 0.5,
    -vel[2] * CSSGALAXY_CONSTANTS.deltaT * universe.cycles + floatRand(rng) - 0.5,
  ];
  const mass = Math.trunc(floatRand(rng) * 1000) + 1;
  const size = CSSGALAXY_CONSTANTS.galaxyRangeSize * floatRand(rng) +
    CSSGALAXY_CONSTANTS.galaxyMinSize;
  const stars = Array.from({ length: nstars }, () => createStar(rng, matrix, pos, vel, mass, size));
  const colorIndex = Math.floor(CSSGALAXY_CONSTANTS.ncolors / CSSGALAXY_CONSTANTS.colorBase) * galcol;
  return { mass, nstars, stars, pos, vel, galcol, color: universe.palette[colorIndex] };
}

function createStar(rng, matrix, galaxyPos, galaxyVel, mass, size) {
  const w = 2 * Math.PI * floatRand(rng);
  const sinw = fsin(w);
  const cosw = fcos(w);
  const d = floatRand(rng) * size;
  let h = floatRand(rng) * Math.exp(-2 * (d / size)) / 5 * size;
  if (floatRand(rng) < 0.5) h = -h;
  const pos = [
    matrix[0][0] * d * cosw + matrix[1][0] * d * sinw + matrix[2][0] * h + galaxyPos[0],
    matrix[0][1] * d * cosw + matrix[1][1] * d * sinw + matrix[2][1] * h + galaxyPos[1],
    matrix[0][2] * d * cosw + matrix[1][2] * d * sinw + matrix[2][2] * h + galaxyPos[2],
  ];
  const speed = Math.sqrt(mass * CSSGALAXY_CONSTANTS.qcons / Math.sqrt(d * d + h * h));
  const vel = [
    (-matrix[0][0] * speed * sinw + matrix[1][0] * speed * cosw + galaxyVel[0]) *
      CSSGALAXY_CONSTANTS.deltaT,
    (-matrix[0][1] * speed * sinw + matrix[1][1] * speed * cosw + galaxyVel[1]) *
      CSSGALAXY_CONSTANTS.deltaT,
    (-matrix[0][2] * speed * sinw + matrix[1][2] * speed * cosw + galaxyVel[2]) *
      CSSGALAXY_CONSTANTS.deltaT,
  ];
  return { pos, vel, oldX: 0, oldY: 0, x: 0, y: 0 };
}

function createUniformPalette(rng, count) {
  const saturation = (rng.random() % 34 + 66) / 100;
  const value = (rng.random() % 34 + 66) / 100;
  const halfCount = Math.floor(count / 2) + 1;
  const colors = new Array(count);
  const deltaHue = 359 / halfCount;
  for (let index = 0; index < halfCount; index += 1) {
    colors[index] = hsvToHex(Math.trunc(index * deltaHue), saturation, value);
  }
  for (let index = halfCount; index < count; index += 1) colors[index] = colors[count - index];
  return Object.freeze(colors);
}

function hsvToHex(hue, saturation, value) {
  const h = (hue % 360) / 60;
  const sector = Math.trunc(h);
  const fraction = h - sector;
  const p1 = value * (1 - saturation);
  const p2 = value * (1 - saturation * fraction);
  const p3 = value * (1 - saturation * (1 - fraction));
  const rgb = sector === 0 ? [value, p3, p1]
    : sector === 1 ? [p2, value, p1]
      : sector === 2 ? [p1, value, p3]
        : sector === 3 ? [p1, p2, value]
          : sector === 4 ? [p3, p1, value]
            : [value, p1, p2];
  return `#${rgb.map((component) => Math.round((Math.trunc(component * 65535)) / 257)
    .toString(16).padStart(2, "0")).join("")}`;
}

function validateVariantCount(totalStarCount) {
  if (totalStarCount !== CSSGALAXY_MOBILE_STAR_COUNT &&
      !CSSGALAXY_VARIANT_COUNTS.includes(totalStarCount)) {
    throw new RangeError("Galaxy star count is not a qualified comparison or product count");
  }
}

function nrand(rng, maximum) {
  return Math.floor(rng.random() * maximum / 0x100000000);
}

function floatRand(rng) {
  return (rng.random() & 0x7fffffff) / 2147483648;
}

function rotateLeft(value, count) {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

function fsin(value) {
  return Math.fround(Math.sin(value));
}

function fcos(value) {
  return Math.fround(Math.cos(value));
}

function toShort(value) {
  const integer = Math.trunc(value);
  return (integer << 16) >> 16;
}

function pointKey(x, y) {
  return ((x & 0xffff) * 0x10000) + (y & 0xffff);
}
