// SPDX-License-Identifier: GPL-2.0-or-later
import { buildFlocksBugMatrix, flocksHueToHex } from "../../shared/cssflocks/bugTransform.mjs";

const PREPARED_FRAMES_PER_SECOND = 60;
const DEFAULT_ASPECT_RATIO = 16 / 9;

export const CSSFLOCKS_SOURCE = Object.freeze({
  repository: "https://github.com/reallyslickscreensavers/reallyslickscreensavers",
  revision: "a419fc4ecf4b9b19526448bf9f5dfc435e24ca4c",
  path: "src/flocks/flocks.cpp",
  sha256: "0db819da1d123ad4ae2cf5f53bec278e64b2f65ecabe617a843197446c1813d6",
  license: "GPL-2.0-or-later",
  fieldOfViewDegrees: 50,
  leaders: 4,
  followers: 1_000,
  geometry: 1,
  size: 5,
  complexity: 1,
  speed: 15,
  stretch: 20,
  colorFadeSpeed: 15,
  chromatek: 0,
  connections: 0,
});

export const CSSFLOCKS_PREPARED_CADENCE = Object.freeze({
  framesPerSecond: PREPARED_FRAMES_PER_SECOND,
  frameMilliseconds: 1_000 / PREPARED_FRAMES_PER_SECOND,
  warmupSeconds: 20,
  blockSeconds: 1,
  sourceStreamSeconds: 216,
  terminalBridgeSeconds: 8,
});

export const CSSFLOCKS_PREPARED_LOADER = Object.freeze({
  runtimeLookaheadBlockCount: 11,
  runtimeMaterializedLookaheadBlockCount: 2,
  startupMaterializedLookaheadBlockCount: 2,
});

export const CSSFLOCKS_SOURCE_BANK = Object.freeze({
  id: "source-default",
  name: "Flocks Source Default",
  seed: 1,
  leaderCount: CSSFLOCKS_SOURCE.leaders,
  followerCount: CSSFLOCKS_SOURCE.followers,
  bugCount: CSSFLOCKS_SOURCE.leaders + CSSFLOCKS_SOURCE.followers,
  framesPerSecond: CSSFLOCKS_PREPARED_CADENCE.framesPerSecond,
  frameMilliseconds: CSSFLOCKS_PREPARED_CADENCE.frameMilliseconds,
  warmupFrames: Math.round(CSSFLOCKS_PREPARED_CADENCE.warmupSeconds * PREPARED_FRAMES_PER_SECOND),
  frameCount: Math.round(CSSFLOCKS_PREPARED_CADENCE.sourceStreamSeconds * PREPARED_FRAMES_PER_SECOND),
  blockFrameCount: Math.round(CSSFLOCKS_PREPARED_CADENCE.blockSeconds * PREPARED_FRAMES_PER_SECOND),
  aspectRatio: DEFAULT_ASPECT_RATIO,
});

export const CSSFLOCKS_PRODUCT_PROFILES = Object.freeze({
  desktop: Object.freeze({
    id: "desktop",
    modelId: "flocks",
    bugCount: 324,
    leaderCount: CSSFLOCKS_SOURCE.leaders,
    followerCount: 320,
  }),
  mobile: Object.freeze({
    id: "mobile",
    modelId: "flocks-mobile",
    bugCount: 164,
    leaderCount: CSSFLOCKS_SOURCE.leaders,
    followerCount: 160,
  }),
});

export function buildFlocksSourceOracleSequence({ bank = CSSFLOCKS_SOURCE_BANK } = {}) {
  validateBank(bank);
  const rng = createMt19937(bank.seed);
  const bounds = computeSourceBounds(bank.aspectRatio);
  const leaders = Array.from({ length: bank.leaderCount }, (_, index) =>
    createLeader(index, bounds, rng));
  const followers = Array.from({ length: bank.followerCount }, (_, index) =>
    createFollower(bank.leaderCount + index, bounds, rng));
  const deltaSeconds = f32(bank.frameMilliseconds / 1_000);
  const initialBugs = Object.freeze([...leaders, ...followers].map(snapshotBug));
  const frames = [];
  for (let frameIndex = 0; frameIndex < bank.frameCount; frameIndex += 1) {
    stepFlocksSource({ leaders, followers, bounds, rng, deltaSeconds });
    frames.push(Object.freeze({
      index: frameIndex,
      timeMs: frameIndex / bank.framesPerSecond * 1_000,
      bugs: Object.freeze([...leaders, ...followers].map(snapshotBug)),
    }));
  }
  return deepFreeze({
    schema: "cssflocks-source-oracle-sequence@1",
    source: CSSFLOCKS_SOURCE,
    bank: Object.freeze({ ...bank }),
    bounds,
    initialBugs,
    frames: Object.freeze(frames),
  });
}

export function buildFlocksSourceSequence({ bank = CSSFLOCKS_SOURCE_BANK } = {}) {
  validateBank(bank);
  const rng = createMt19937(bank.seed);
  const bounds = computeSourceBounds(bank.aspectRatio);
  const leaders = Array.from({ length: bank.leaderCount }, (_, index) =>
    createLeader(index, bounds, rng));
  const followers = Array.from({ length: bank.followerCount }, (_, index) =>
    createFollower(bank.leaderCount + index, bounds, rng));
  const deltaSeconds = f32(bank.frameMilliseconds / 1_000);
  for (let frameIndex = 0; frameIndex < bank.warmupFrames; frameIndex += 1) {
    stepFlocksSource({ leaders, followers, bounds, rng, deltaSeconds });
  }
  const frames = [];
  for (let frameIndex = 0; frameIndex < bank.frameCount; frameIndex += 1) {
    stepFlocksSource({ leaders, followers, bounds, rng, deltaSeconds });
    frames.push(Object.freeze({
      index: frameIndex,
      timeMs: frameIndex / bank.framesPerSecond * 1_000,
      bugs: Object.freeze([...leaders, ...followers].map(snapshotBug)),
    }));
  }
  return deepFreeze({
    schema: "cssflocks-source-sequence@1",
    source: CSSFLOCKS_SOURCE,
    bank: Object.freeze({ ...bank }),
    bounds,
    modelMatrix: flattenCss(multiply4(
      scale4([1, -1, 1]),
      translation([0, 0, -bounds.wide * 2]),
    )),
    frames: Object.freeze(frames),
    durationMilliseconds: bank.frameCount / bank.framesPerSecond * 1_000,
  });
}

export function* buildFlocksSourceBlocks({ bank = CSSFLOCKS_SOURCE_BANK } = {}) {
  validateBank(bank);
  const rng = createMt19937(bank.seed);
  const bounds = computeSourceBounds(bank.aspectRatio);
  const leaders = Array.from({ length: bank.leaderCount }, (_, index) =>
    createLeader(index, bounds, rng));
  const followers = Array.from({ length: bank.followerCount }, (_, index) =>
    createFollower(bank.leaderCount + index, bounds, rng));
  const deltaSeconds = f32(bank.frameMilliseconds / 1_000);
  for (let frameIndex = 0; frameIndex < bank.warmupFrames; frameIndex += 1) {
    stepFlocksSource({ leaders, followers, bounds, rng, deltaSeconds });
  }
  const blockCount = bank.frameCount / bank.blockFrameCount;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const frames = [];
    const startFrameIndex = blockIndex * bank.blockFrameCount;
    for (let localFrameIndex = 0; localFrameIndex < bank.blockFrameCount; localFrameIndex += 1) {
      stepFlocksSource({ leaders, followers, bounds, rng, deltaSeconds });
      frames.push(Object.freeze({
        index: startFrameIndex + localFrameIndex,
        timeMs: (startFrameIndex + localFrameIndex) / bank.framesPerSecond * 1_000,
        bugs: Object.freeze([...leaders, ...followers].map(snapshotBug)),
      }));
    }
    yield deepFreeze({
      schema: "cssflocks-source-sequence@1",
      source: CSSFLOCKS_SOURCE,
      bank: Object.freeze({ ...bank, blockIndex, blockCount, startFrameIndex }),
      bounds,
      modelMatrix: flattenCss(multiply4(
        scale4([1, -1, 1]),
        translation([0, 0, -bounds.wide * 2]),
      )),
      frames: Object.freeze(frames),
      durationMilliseconds: bank.blockFrameCount / bank.framesPerSecond * 1_000,
      streamDurationMilliseconds: bank.frameCount / bank.framesPerSecond * 1_000,
    });
  }
}

export function* buildFlocksSourceEndpointSamples({ bank = CSSFLOCKS_SOURCE_BANK } = {}) {
  validateBank(bank);
  const rng = createMt19937(bank.seed);
  const bounds = computeSourceBounds(bank.aspectRatio);
  const leaders = Array.from({ length: bank.leaderCount }, (_, index) =>
    createLeader(index, bounds, rng));
  const followers = Array.from({ length: bank.followerCount }, (_, index) =>
    createFollower(bank.leaderCount + index, bounds, rng));
  const deltaSeconds = f32(bank.frameMilliseconds / 1_000);
  for (let frameIndex = 0; frameIndex < bank.warmupFrames; frameIndex += 1) {
    stepFlocksSource({ leaders, followers, bounds, rng, deltaSeconds });
  }
  for (let frameIndex = 0; frameIndex < bank.frameCount; frameIndex += 1) {
    stepFlocksSource({ leaders, followers, bounds, rng, deltaSeconds });
    if (frameIndex % bank.framesPerSecond !== 0 && frameIndex % bank.framesPerSecond !== bank.framesPerSecond - 1) continue;
    yield Object.freeze({
      index: frameIndex,
      bugs: Object.freeze([...leaders, ...followers].map(snapshotTransportBug)),
    });
  }
}

export function selectFlocksProductPrefix(source, profile) {
  if (source?.schema !== "cssflocks-source-sequence@1" ||
      !profile || !Number.isSafeInteger(profile.bugCount) ||
      profile.leaderCount !== source.bank.leaderCount ||
      profile.bugCount > source.bank.bugCount ||
      profile.bugCount !== profile.leaderCount + profile.followerCount) {
    throw new Error("Flocks product prefix binding drifted");
  }
  return deepFreeze({
    ...source,
    profile: Object.freeze({ ...profile }),
    frames: Object.freeze(source.frames.map((frame) => Object.freeze({
      ...frame,
      bugs: Object.freeze(frame.bugs.slice(0, profile.bugCount)),
    }))),
  });
}

export function stepFlocksSource({ leaders, followers, bounds, rng, deltaSeconds }) {
  for (const leader of leaders) updateLeader(leader, bounds, rng, deltaSeconds);
  for (const follower of followers) updateFollower(follower, leaders, rng, deltaSeconds);
}

export function computeSourceBounds(aspectRatio = DEFAULT_ASPECT_RATIO) {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new RangeError("Flocks aspect ratio must be positive");
  }
  if (aspectRatio >= 1) {
    return Object.freeze({ wide: Math.trunc(160 * aspectRatio), high: 160, deep: 160, aspectRatio });
  }
  return Object.freeze({ wide: 160, high: Math.trunc(160 / aspectRatio), deep: 160, aspectRatio });
}

function createLeader(index, bounds, rng) {
  return {
    index,
    type: "leader",
    hue: randf(rng, 1),
    x: f32(randf(rng, bounds.wide * 2) - bounds.wide),
    y: f32(randf(rng, bounds.high * 2) - bounds.high),
    z: f32(randf(rng, bounds.wide * 2) + bounds.wide * 2),
    xSpeed: 0,
    ySpeed: 0,
    zSpeed: 0,
    maxSpeed: f32(8 * CSSFLOCKS_SOURCE.speed),
    accel: f32(13 * CSSFLOCKS_SOURCE.speed),
    right: 1,
    up: 1,
    forward: 1,
    craziness: f32(randf(rng, 4) + f32(0.05)),
    nextChange: 1,
    leader: null,
  };
}

function createFollower(index, bounds, rng) {
  return {
    index,
    type: "follower",
    hue: randf(rng, 1),
    x: f32(randf(rng, bounds.wide * 2) - bounds.wide),
    y: f32(randf(rng, bounds.high * 2) - bounds.high),
    z: f32(randf(rng, bounds.wide * 5) + bounds.wide * 2),
    xSpeed: 0,
    ySpeed: 0,
    zSpeed: 0,
    maxSpeed: f32(f32(randf(rng, 6) + 4) * CSSFLOCKS_SOURCE.speed),
    accel: f32(f32(randf(rng, 4) + 9) * CSSFLOCKS_SOURCE.speed),
    right: 0,
    up: 0,
    forward: 0,
    craziness: null,
    nextChange: null,
    leader: 0,
  };
}

function updateLeader(bug, bounds, rng, deltaSeconds) {
  bug.nextChange = f32(bug.nextChange - deltaSeconds);
  if (bug.nextChange <= 0) {
    if (randi(rng, 2)) bug.right += 1;
    if (randi(rng, 2)) bug.up += 1;
    if (randi(rng, 2)) bug.forward += 1;
    if (bug.right >= 2) bug.right = 0;
    if (bug.up >= 2) bug.up = 0;
    if (bug.forward >= 2) bug.forward = 0;
    bug.nextChange = randf(rng, bug.craziness);
  }
  bug.xSpeed = f32(bug.xSpeed + f32((bug.right ? 1 : -1) * f32(bug.accel * deltaSeconds)));
  bug.ySpeed = f32(bug.ySpeed + f32((bug.up ? 1 : -1) * f32(bug.accel * deltaSeconds)));
  bug.zSpeed = f32(bug.zSpeed + f32((bug.forward ? -1 : 1) * f32(bug.accel * deltaSeconds)));
  if (bug.x < -bounds.wide) bug.right = 1;
  if (bug.x > bounds.wide) bug.right = 0;
  if (bug.y < -bounds.high) bug.up = 1;
  if (bug.y > bounds.high) bug.up = 0;
  if (bug.z < -bounds.deep) bug.forward = 0;
  if (bug.z > bounds.deep) bug.forward = 1;
  finishBugUpdate(bug, deltaSeconds);
}

function updateFollower(bug, leaders, rng, deltaSeconds) {
  if (randi(rng, 10) === 0) {
    let oldDistance = 10_000_000;
    for (let index = 0; index < leaders.length; index += 1) {
      const leader = leaders[index];
      const xDistance = f32(leader.x - bug.x);
      const yDistance = f32(leader.y - bug.y);
      const zDistance = f32(leader.z - bug.z);
      const distance = f32(f32(f32(xDistance * xDistance) + f32(yDistance * yDistance)) + f32(zDistance * zDistance));
      if (distance < oldDistance) {
        oldDistance = distance;
        bug.leader = index;
      }
    }
  }
  const leader = leaders[bug.leader];
  bug.xSpeed = f32(bug.xSpeed + f32((leader.x - bug.x > 0 ? 1 : -1) * f32(bug.accel * deltaSeconds)));
  bug.ySpeed = f32(bug.ySpeed + f32((leader.y - bug.y > 0 ? 1 : -1) * f32(bug.accel * deltaSeconds)));
  bug.zSpeed = f32(bug.zSpeed + f32((leader.z - bug.z > 0 ? 1 : -1) * f32(bug.accel * deltaSeconds)));
  const colorFade = f32(CSSFLOCKS_SOURCE.colorFadeSpeed * f32(0.01));
  const colorStep = f32(colorFade * deltaSeconds);
  const hueDistance = Math.abs(bug.hue - leader.hue);
  if (hueDistance < colorStep) {
    bug.hue = leader.hue;
  } else if (hueDistance < 0.5) {
    bug.hue = f32(bug.hue + (bug.hue > leader.hue ? -colorStep : colorStep));
  } else {
    bug.hue = f32(bug.hue + (bug.hue > leader.hue ? colorStep : -colorStep));
    if (bug.hue > 1) bug.hue = f32(bug.hue - 1);
    if (bug.hue < 0) bug.hue = f32(bug.hue + 1);
  }
  finishBugUpdate(bug, deltaSeconds);
}

function finishBugUpdate(bug, deltaSeconds) {
  bug.xSpeed = f32(clamp(bug.xSpeed, -bug.maxSpeed, bug.maxSpeed));
  bug.ySpeed = f32(clamp(bug.ySpeed, -bug.maxSpeed, bug.maxSpeed));
  bug.zSpeed = f32(clamp(bug.zSpeed, -bug.maxSpeed, bug.maxSpeed));
  bug.x = f32(bug.x + f32(bug.xSpeed * deltaSeconds));
  bug.y = f32(bug.y + f32(bug.ySpeed * deltaSeconds));
  bug.z = f32(bug.z + f32(bug.zSpeed * deltaSeconds));
}

function snapshotBug(bug) {
  const transform = buildFlocksBugMatrix(
    [bug.x, bug.y, bug.z],
    [bug.xSpeed, bug.ySpeed, bug.zSpeed],
    CSSFLOCKS_SOURCE.stretch,
  );
  return Object.freeze({
    index: bug.index,
    type: bug.type,
    leader: bug.leader,
    position: Object.freeze([rounded(bug.x), rounded(bug.y), rounded(bug.z)]),
    velocity: Object.freeze([rounded(bug.xSpeed), rounded(bug.ySpeed), rounded(bug.zSpeed)]),
    direction: transform.direction,
    stretch: transform.stretch,
    hue: rounded(bug.hue),
    color: flocksHueToHex(bug.hue),
    matrix: transform.matrix,
  });
}

function snapshotTransportBug(bug) {
  return Object.freeze({
    index: bug.index,
    type: bug.type,
    position: Object.freeze([rounded(bug.x), rounded(bug.y), rounded(bug.z)]),
    velocity: Object.freeze([rounded(bug.xSpeed), rounded(bug.ySpeed), rounded(bug.zSpeed)]),
    hue: rounded(bug.hue),
  });
}

function validateBank(bank) {
  for (const [name, value] of Object.entries({
    seed: bank?.seed,
    leaderCount: bank?.leaderCount,
    followerCount: bank?.followerCount,
    bugCount: bank?.bugCount,
    framesPerSecond: bank?.framesPerSecond,
    warmupFrames: bank?.warmupFrames,
    frameCount: bank?.frameCount,
    blockFrameCount: bank?.blockFrameCount,
  })) {
    const minimum = name === "warmupFrames" || name === "followerCount" ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new RangeError(`Flocks ${name} must be a safe integer >= ${minimum}`);
    }
  }
  if (bank.bugCount !== bank.leaderCount + bank.followerCount ||
      bank.frameMilliseconds !== 1_000 / bank.framesPerSecond ||
      bank.frameCount % bank.blockFrameCount !== 0 ||
      !Number.isFinite(bank.aspectRatio) || bank.aspectRatio <= 0) {
    throw new RangeError("Flocks bank binding is inconsistent");
  }
}

function createMt19937(seed) {
  const state = new Uint32Array(624);
  state[0] = seed >>> 0;
  for (let index = 1; index < state.length; index += 1) {
    state[index] = (Math.imul(1812433253, state[index - 1] ^ (state[index - 1] >>> 30)) + index) >>> 0;
  }
  let cursor = state.length;
  const nextUint32 = () => {
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
      return value >>> 0;
  };
  return Object.freeze({
    nextFloat() {
      return (nextUint32() >>> 8) / 0x01000000;
    },
    nextInt(maximum) {
      if (!Number.isSafeInteger(maximum) || maximum <= 0) {
        throw new RangeError("Flocks random integer maximum must be positive");
      }
      if (maximum === 1) return 0;
      const width = Math.ceil(Math.log2(maximum));
      const mask = 2 ** width - 1;
      let value;
      do value = nextUint32() & mask;
      while (value >= maximum);
      return value;
    },
  });
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

function flattenCss(matrix) {
  return Object.freeze(matrix[0].map((unused, column) => matrix.map((row) => rounded(row[column]))).flat());
}

function randf(rng, maximum) {
  return f32(rng.nextFloat() * maximum);
}

function randi(rng, maximum) {
  return rng.nextInt(maximum);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function f32(value) {
  return Math.fround(value);
}

function rounded(value) {
  const result = Number(value.toFixed(6));
  return Object.is(result, -0) ? 0 : result;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
