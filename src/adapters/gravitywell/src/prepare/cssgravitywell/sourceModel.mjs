const RANDOM_VECTOR = Object.freeze([
  0o35340171546, 0o10401501101, 0o22364657325, 0o24130436022, 0o02167303062,
  0o37570375137, 0o37210607110, 0o16272055420, 0o23011770546, 0o17143426366,
  0o14753657433, 0o21657231332, 0o23553406142, 0o04236526362, 0o10365611275,
  0o07117336710, 0o11051276551, 0o02362132524, 0o01011540233, 0o12162531646,
  0o07056762337, 0o06631245521, 0o14164542224, 0o32633236305, 0o23342700176,
  0o02433062234, 0o15257225043, 0o26762051606, 0o00742573230, 0o05366042132,
  0o12126416411, 0o00520471171, 0o00725646277, 0o20116577576, 0o25765742604,
  0o07633473735, 0o15674255275, 0o17555634041, 0o06503154145, 0o21576344247,
  0o14577627653, 0o02707523333, 0o34146376720, 0o30060227734, 0o13765414060,
  0o36072251540, 0o07255221037, 0o24364674123, 0o06200353166, 0o10126373326,
  0o15664104320, 0o16401041535, 0o16215305520, 0o33115351014, 0o17411670323,
]);

export const SOURCE = Object.freeze({
  delayMicroseconds: 30_000,
  count: 15,
  resolution: 1,
  gridSize: 16 / 7,
  speed: 1,
  resolutionBase: 512,
  gridSegment: 16,
  speedBase: 2.5,
  massEpsilon: 0.03,
  slopeEpsilon: 0.06,
  maximumMassColor: 120,
});

export const CSSGRAVITYWELL_SEED = 26080802;
export const CSSGRAVITYWELL_SEEDS = Object.freeze(Array.from(
  { length: 24 },
  (_, index) => CSSGRAVITYWELL_SEED + index * 104_729,
));
export const PREPARED_FRAME_COUNT = 240;
export const PREPARED_MAXIMUM_ACTIVE_WELL_COUNT = 2;
export const PREPARED_MINIMUM_WELL_FRAME_SPEED = 1;
export const PREPARED_MAXIMUM_WELL_FRAME_SPEED = 1.6;
export const PREPARED_FOG_LEVELS = 32;
export const PREPARED_OPACITY_DEPTH_LEVELS = 16;
export const PREPARED_LINE_COVERAGE = 0.6;
export const PREPARED_LINE_WIDTH_PIXELS = 2;
export const PREPARED_LINE_ENDPOINT_OVERLAP_PIXELS = PREPARED_LINE_WIDTH_PIXELS / 2;
export const PREPARED_MAXIMUM_DEPTH_OPACITY_REDUCTION = 0.75;
export const PREPARED_TRANSITION_FRAME_COUNT = 16;
export const PREPARED_FLAT_HOLD_FRAME_COUNT = 4;
export const PREPARED_DRAIN_FRAME_BUDGET = 60;
export const PREPARED_MAX_BANK_FRAME_COUNT = PREPARED_FRAME_COUNT + PREPARED_DRAIN_FRAME_BUDGET +
  PREPARED_TRANSITION_FRAME_COUNT + PREPARED_FLAT_HOLD_FRAME_COUNT * 2;

export function buildPreparedGravityWellStates({
  seed = CSSGRAVITYWELL_SEED,
  frameCount = PREPARED_FRAME_COUNT,
} = {}) {
  if (!Number.isSafeInteger(seed) || seed <= 0) throw new RangeError("Gravity Well seed must be positive");
  if (!Number.isSafeInteger(frameCount) || frameCount < 2) throw new RangeError("Gravity Well needs at least two frames");
  const rng = createYaRandom(seed);
  const gridWidth = Math.max(2, Math.trunc((SOURCE.resolutionBase * SOURCE.resolution) / SOURCE.gridSegment));
  const sourceExtent = (gridWidth - 1) * SOURCE.gridSegment;
  const stars = newPreparedStars({ rng, gridWidth });
  const trackballQuaternion = trackball(
    0,
    0,
    -0.4 + rng.frand(0.8),
    -0.3 + rng.frand(0.2),
  );

  const frames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    frames.push(captureGravityWellFrame(stars, gridWidth, frameIndex));
    moveStars(stars, rng, gridWidth);
  }
  return Object.freeze({
    schema: "cssgravitywell-source-states@1",
    seed,
    frameCount,
    sourceTicksPerSecond: 1_000_000 / SOURCE.delayMicroseconds,
    gridWidth,
    gridCellCount: gridWidth - 1,
    sourceExtent,
    trackballQuaternion,
    sourceProfile: SOURCE,
    frames: Object.freeze(frames),
  });
}

export function buildPreparedGravityWellBankStates({
  seed = CSSGRAVITYWELL_SEED,
  sourceFrameCount = PREPARED_FRAME_COUNT,
  drainFrameBudget = PREPARED_DRAIN_FRAME_BUDGET,
} = {}) {
  if (!Number.isSafeInteger(seed) || seed <= 0) throw new RangeError("Gravity Well seed must be positive");
  if (!Number.isSafeInteger(sourceFrameCount) || sourceFrameCount < 2 ||
      !Number.isSafeInteger(drainFrameBudget) || drainFrameBudget < 1) {
    throw new RangeError("Gravity Well prepared bank frame budget is invalid");
  }
  const rng = createYaRandom(seed);
  const gridWidth = Math.max(2, Math.trunc((SOURCE.resolutionBase * SOURCE.resolution) / SOURCE.gridSegment));
  const sourceExtent = (gridWidth - 1) * SOURCE.gridSegment;
  const stars = newPreparedStars({ rng, gridWidth });
  const trackballQuaternion = trackball(
    0,
    0,
    -0.4 + rng.frand(0.8),
    -0.3 + rng.frand(0.2),
  );
  const frames = [];
  for (let frameIndex = 0; frameIndex < sourceFrameCount; frameIndex += 1) {
    frames.push(captureGravityWellFrame(stars, gridWidth, frameIndex));
    moveStars(stars, rng, gridWidth);
  }

  const wellDrainFrameCounts = stars.map((star) => preparedWellDrainFrameCount(star, gridWidth, drainFrameBudget));
  const maximumWellDrainFrameCount = Math.max(...wellDrainFrameCounts);
  for (let drainFrameIndex = 0; drainFrameIndex <= maximumWellDrainFrameCount; drainFrameIndex += 1) {
    const wellWeights = wellDrainFrameCounts.map((duration) => duration === 0
      ? 0
      : 1 - smoothstep(Math.min(1, drainFrameIndex / duration)));
    const frameIndex = frames.length;
    const frame = captureGravityWellFrame(stars, gridWidth, frameIndex, null, wellWeights);
    frames.push(frame);
    moveStarsWithoutRespawn(stars);
  }
  const terminalDepths = frames.at(-1)?.depths;
  if (!terminalDepths?.every((depth) => depth === 0)) {
    throw new Error("Gravity Well prepared bank did not drain every active well");
  }
  return Object.freeze({
    schema: "cssgravitywell-prepared-bank-states@1",
    seed,
    frameCount: frames.length,
    sourceFrameCount,
    drainFrameCount: frames.length - sourceFrameCount,
    drainFrameBudget,
    drainMode: "prepared-per-well-smoothstep-no-respawn",
    wellDrainFrameCounts: Object.freeze(wellDrainFrameCounts),
    maximumWellDrainFrameCount,
    allWellsComplete: true,
    sourceTicksPerSecond: 1_000_000 / SOURCE.delayMicroseconds,
    gridWidth,
    gridCellCount: gridWidth - 1,
    sourceExtent,
    trackballQuaternion,
    sourceProfile: SOURCE,
    frames: Object.freeze(frames),
  });
}

export function buildPreparedGravityWellTimeline(state, {
  transitionFrameCount = PREPARED_TRANSITION_FRAME_COUNT,
  flatHoldFrameCount = PREPARED_FLAT_HOLD_FRAME_COUNT,
} = {}) {
  if (state?.schema !== "cssgravitywell-prepared-bank-states@1" || !state.allWellsComplete ||
      !Array.isArray(state.frames) || state.sourceFrameCount < 2 || state.frameCount <= state.sourceFrameCount) {
    throw new TypeError("Gravity Well prepared timeline requires source states");
  }
  if (!Number.isSafeInteger(transitionFrameCount) || transitionFrameCount < 2 ||
      !Number.isSafeInteger(flatHoldFrameCount) || flatHoldFrameCount < 1) {
    throw new RangeError("Gravity Well prepared timeline envelope is invalid");
  }
  const flatDepths = Object.freeze(Array(state.gridWidth ** 2).fill(0));
  const frames = [];
  const append = (phase, sourceFrameIndex, depths, opacityDepths) => {
    frames.push(Object.freeze({
      frameIndex: frames.length,
      phase,
      sourceFrameIndex,
      depths,
      opacityDepths,
    }));
  };
  for (let index = 0; index < flatHoldFrameCount; index += 1) {
    append("flat-in", null, flatDepths, flatDepths);
  }
  for (let index = 1; index < transitionFrameCount; index += 1) {
    const weight = smoothstep(index / transitionFrameCount);
    append(
      "rise",
      0,
      scaleDepths(state.frames[0].depths, weight),
      scaleDepths(state.frames[0].opacityDepths, weight),
    );
  }
  const sourceFrameStartIndex = frames.length;
  for (const frame of state.frames) {
    const isSource = frame.frameIndex < state.sourceFrameCount;
    append(
      isSource ? "source" : "drain",
      isSource ? frame.frameIndex : null,
      frame.depths,
      frame.opacityDepths,
    );
  }
  const sourceFrameEndIndex = sourceFrameStartIndex + state.sourceFrameCount - 1;
  const drainFrameStartIndex = sourceFrameEndIndex + 1;
  const allWellsCompleteFrameIndex = frames.length - 1;
  for (let index = 0; index < flatHoldFrameCount; index += 1) {
    append("flat-out", null, flatDepths, flatDepths);
  }
  return Object.freeze({
    schema: "cssgravitywell-prepared-timeline@1",
    frameCount: frames.length,
    sourceFrameStartIndex,
    sourceFrameEndIndex,
    drainFrameStartIndex,
    allWellsCompleteFrameIndex,
    terminalFlatFrameIndex: frames.length - 1,
    transitionFrameCount,
    flatHoldFrameCount,
    firstAndLastGroundFlat: true,
    allWellsCompleteBeforeSwitch: true,
    switchPreparedBankAtEnd: true,
    frames: Object.freeze(frames),
  });
}

export function preparedWorldPositions(state, depths) {
  const { gridWidth } = state;
  if (depths.length !== gridWidth * gridWidth) throw new RangeError("Gravity Well depth grid is incomplete");
  return Object.freeze(depths.map((depth, index) => {
    const xIndex = index % gridWidth;
    const yIndex = Math.trunc(index / gridWidth);
    return Object.freeze([
      xIndex * SOURCE.gridSegment,
      yIndex * SOURCE.gridSegment,
      depth,
    ]);
  }));
}

export function buildGridSegments(gridWidth) {
  const segments = [];
  for (let y = 0; y < gridWidth - 1; y += 1) {
    for (let x = 0; x < gridWidth - 1; x += 1) {
      const a = y * gridWidth + x;
      segments.push(Object.freeze([a, a + 1]));
    }
  }
  for (let x = 0; x < gridWidth - 1; x += 1) {
    for (let y = 0; y < gridWidth - 1; y += 1) {
      const a = y * gridWidth + x;
      segments.push(Object.freeze([a, a + gridWidth]));
    }
  }
  return Object.freeze(segments);
}

export function buildGridClosingSegments(gridWidth) {
  const segments = [];
  const finalIndex = gridWidth - 1;
  const finalRowStart = finalIndex * gridWidth;
  for (let x = 0; x < finalIndex; x += 1) {
    segments.push(Object.freeze([finalRowStart + x, finalRowStart + x + 1]));
  }
  for (let y = 0; y < finalIndex; y += 1) {
    const a = y * gridWidth + finalIndex;
    segments.push(Object.freeze([a, a + gridWidth]));
  }
  return Object.freeze(segments);
}

export function buildPreparedGridSegments(gridWidth) {
  return Object.freeze([
    ...buildGridSegments(gridWidth),
    ...buildGridClosingSegments(gridWidth),
  ]);
}

export function preparedGridLineQuads(
  state,
  depths,
  lineWidthPixels = PREPARED_LINE_WIDTH_PIXELS,
  opacityDepths = null,
  endpointOverlapPixels = PREPARED_LINE_ENDPOINT_OVERLAP_PIXELS,
) {
  const positions = preparedWorldPositions(state, depths);
  const preparedOpacityDepths = opacityDepths ?? depths.map(
    (depth) => Math.min(1, Math.max(0, depth / SOURCE.maximumMassColor)),
  );
  if (preparedOpacityDepths.length !== depths.length || !Number.isFinite(endpointOverlapPixels) ||
      endpointOverlapPixels < 0 || endpointOverlapPixels > 4) {
    throw new RangeError("Gravity Well prepared line geometry inputs are incomplete");
  }
  const modelView = nativeModelViewMatrix(state.trackballQuaternion);
  const perspective = 600 / (2 * Math.tan(20 * Math.PI / 180));
  return Object.freeze(buildPreparedGridSegments(state.gridWidth).map(([firstIndex, secondIndex]) => {
    const first = transformPoint(modelView, positions[firstIndex]);
    const second = transformPoint(modelView, positions[secondIndex]);
    const firstScreen = projectEyePoint(first, perspective);
    const secondScreen = projectEyePoint(second, perspective);
    const screenDx = secondScreen[0] - firstScreen[0];
    const screenDy = secondScreen[1] - firstScreen[1];
    const screenLength = Math.hypot(screenDx, screenDy);
    const unitScreenX = screenDx / screenLength;
    const unitScreenY = screenDy / screenLength;
    const offsetScreenX = (-screenDy / screenLength) * lineWidthPixels / 2;
    const offsetScreenY = (screenDx / screenLength) * lineWidthPixels / 2;
    const firstOverlap = eyeOffsetForScreenPixels(
      first,
      -unitScreenX * endpointOverlapPixels,
      -unitScreenY * endpointOverlapPixels,
      perspective,
    );
    const secondOverlap = eyeOffsetForScreenPixels(
      second,
      unitScreenX * endpointOverlapPixels,
      unitScreenY * endpointOverlapPixels,
      perspective,
    );
    const extendedFirst = [first[0] + firstOverlap[0], first[1] + firstOverlap[1], first[2]];
    const extendedSecond = [second[0] + secondOverlap[0], second[1] + secondOverlap[1], second[2]];
    const midpoint = [
      (first[0] + second[0]) / 2,
      (first[1] + second[1]) / 2,
      (first[2] + second[2]) / 2,
    ];
    const sharedOffset = eyeOffsetForScreenPixels(midpoint, offsetScreenX, offsetScreenY, perspective);
    return Object.freeze({
      points: Object.freeze([
        Object.freeze([extendedFirst[0] - sharedOffset[0], extendedFirst[1] - sharedOffset[1], extendedFirst[2]]),
        Object.freeze([extendedSecond[0] - sharedOffset[0], extendedSecond[1] - sharedOffset[1], extendedSecond[2]]),
        Object.freeze([extendedSecond[0] + sharedOffset[0], extendedSecond[1] + sharedOffset[1], extendedSecond[2]]),
        Object.freeze([extendedFirst[0] + sharedOffset[0], extendedFirst[1] + sharedOffset[1], extendedFirst[2]]),
      ]),
      width: 1,
      height: 1,
      colorDepth: (depths[firstIndex] + depths[secondIndex]) / 2,
      opacityDepth: (preparedOpacityDepths[firstIndex] + preparedOpacityDepths[secondIndex]) / 2,
      eyeDepth: -(first[2] + second[2]) / 2,
    });
  }));
}

export function preparedDepthColorRow(depth) {
  const eased = Math.sin(Math.min(1, Math.max(0, depth / SOURCE.maximumMassColor)) * Math.PI / 2);
  return Math.min(127, Math.max(0, Math.trunc(eased * 128)));
}

export function preparedColorRamp() {
  return Object.freeze(Array.from({ length: 128 }, (_, index) => {
    const hue = Math.trunc(120 - index * (120 / 128));
    const channel = hsvToRgb(hue, 1, 1);
    return `rgb(${channel.map((value) => Math.round(value * 255)).join(", ")})`;
  }));
}

export function preparedFoggedColorPalette() {
  const rgb = [0, 255, 0];
  return Object.freeze(Array.from(
    { length: PREPARED_OPACITY_DEPTH_LEVELS },
    (_, opacityDepthLevel) => Array.from({ length: PREPARED_FOG_LEVELS }, (_, fogLevel) => {
      const normalizedDepth = opacityDepthLevel / (PREPARED_OPACITY_DEPTH_LEVELS - 1);
      const depthOpacity = 1 - smoothstep(normalizedDepth) * PREPARED_MAXIMUM_DEPTH_OPACITY_REDUCTION;
      const factor = (fogLevel / (PREPARED_FOG_LEVELS - 1)) * PREPARED_LINE_COVERAGE * depthOpacity;
      return `rgb(${rgb.join(" ")} / ${cssNumber(factor)})`;
    }),
  ).flat());
}

export function preparedFoggedColorIndex(_depth, opacityDepth, eyeDepth) {
  const opacityDepthIndex = Math.max(0, Math.min(
    PREPARED_OPACITY_DEPTH_LEVELS - 1,
    Math.round(opacityDepth * (PREPARED_OPACITY_DEPTH_LEVELS - 1)),
  ));
  const density = 0.005;
  const fogFactor = Math.exp(-((density * Math.max(0, eyeDepth)) ** 2));
  const fogLevel = Math.max(0, Math.min(PREPARED_FOG_LEVELS - 1, Math.round(fogFactor * (PREPARED_FOG_LEVELS - 1))));
  return opacityDepthIndex * PREPARED_FOG_LEVELS + fogLevel;
}

export function nativeModelViewMatrix(quaternion) {
  if (!Array.isArray(quaternion) || quaternion.length !== 4) throw new TypeError("Gravity Well trackball quaternion is invalid");
  const [x, y, z, w] = quaternion;
  const trackballMatrix = [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (z * x + y * w), 0,
    2 * (x * y + z * w), 1 - 2 * (z * z + x * x), 2 * (y * z - x * w), 0,
    2 * (z * x - y * w), 2 * (y * z + x * w), 1 - 2 * (y * y + x * x), 0,
    0, 0, 0, 1,
  ];
  const rotateX90 = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
  const sourceTranslation = translation(-256, -384, 3);
  const viewTranslation = translation(0, 0, -30);
  const flipCssY = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return Object.freeze(multiplyMatrices(
    flipCssY,
    multiplyMatrices(viewTranslation, multiplyMatrices(trackballMatrix, multiplyMatrices(rotateX90, sourceTranslation))),
  ));
}

function captureGravityWellFrame(stars, gridWidth, frameIndex, activeStars = null, wellWeights = null) {
  const depths = [];
  const contributionsByPoint = [];
  const maximumContributions = Array(stars.length).fill(0);
  for (let yIndex = 0; yIndex < gridWidth; yIndex += 1) {
    const y = yIndex * SOURCE.gridSegment;
    for (let xIndex = 0; xIndex < gridWidth; xIndex += 1) {
      const x = xIndex * SOURCE.gridSegment;
      const contributions = stars.map((star, starIndex) => {
        if (activeStars && !activeStars[starIndex]) return 0;
        const contribution = gravityContributionAt(star, x, y);
        maximumContributions[starIndex] = Math.max(maximumContributions[starIndex], contribution);
        return contribution;
      });
      contributionsByPoint.push(contributions);
      depths.push(contributions.reduce(
        (total, contribution, starIndex) => total + contribution * (wellWeights?.[starIndex] ?? 1),
        0,
      ));
    }
  }
  const opacityDepths = contributionsByPoint.map((contributions) => Math.min(1, Math.max(
    0,
    ...contributions.map((contribution, starIndex) => maximumContributions[starIndex] === 0
      ? 0
      : (contribution / maximumContributions[starIndex]) * (wellWeights?.[starIndex] ?? 1)),
  )));
  const footprintDepths = stars.map((star, starIndex) => {
    if (activeStars && !activeStars[starIndex]) return 0;
    const starWeight = wellWeights?.[starIndex] ?? 1;
    let depth = star.surfaceGravity * starWeight;
    for (let otherIndex = 0; otherIndex < stars.length; otherIndex += 1) {
      if (otherIndex === starIndex || (activeStars && !activeStars[otherIndex])) continue;
      const other = stars[otherIndex];
      const dx = other.x - star.x;
      const dy = other.y - star.y;
      depth += (other.mass / (dx * dx + dy * dy)) * (wellWeights?.[otherIndex] ?? 1);
    }
    return depth;
  });
  return Object.freeze({
    frameIndex,
    depths: Object.freeze(depths),
    opacityDepths: Object.freeze(opacityDepths),
    stars: Object.freeze(stars.map((star, starIndex) => Object.freeze({
      x: star.x,
      y: star.y,
      radius: star.radius,
      mass: star.mass,
      footprintDepth: footprintDepths[starIndex],
    }))),
  });
}

function gravityContributionAt(star, x, y) {
  const dx = star.x - x;
  const dy = star.y - y;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared > star.ro2) return 0;
  return distanceSquared < star.ri2
    ? star.surfaceGravity
    : star.mass / Math.max(distanceSquared, 1e-12);
}

function newStar({ rng, index, gridWidth }) {
  const width = gridWidth * SOURCE.gridSegment;
  const radius = 2 * (2 + rng.frand(3) + rng.frand(3) + rng.frand(3));
  const mass = radius * 150 * (2 + rng.frand(3) + rng.frand(3) + rng.frand(3));
  const ro2 = mass / SOURCE.massEpsilon;
  const ri2 = radius * radius;
  const rm2 = Math.max(ri2, Math.pow(mass * (2 / SOURCE.slopeEpsilon), 2 / 3));
  return {
    radius,
    mass,
    ro2: Math.max(ro2, rm2),
    rm2,
    ri2,
    ro: Math.sqrt(Math.max(ro2, rm2)),
    x: width * (index === 0 ? 0.5 : 0.35 + rng.frand(0.3)),
    y: 0,
    dx: ((rng.frand(1) - 0.5) * 0.1) / SOURCE.resolution,
    dy: (0.1 + rng.frand(0.6)) / SOURCE.resolution,
    surfaceGravity: mass / ri2,
  };
}

function newPreparedStars({ rng, gridWidth }) {
  const stars = Array.from({ length: SOURCE.count }, (_, index) => {
    const star = newStar({ rng, index, gridWidth });
    star.y = rng.frand(star.ro * 2 + gridWidth * SOURCE.gridSegment) - star.ro;
    return star;
  }).slice(0, PREPARED_MAXIMUM_ACTIVE_WELL_COUNT);
  stars.forEach((star, index) => {
    isolatePreparedWell(star, index, gridWidth);
    star.y = initialPreparedWellY(index, gridWidth);
  });
  return stars;
}

function isolatePreparedWell(star, index, gridWidth) {
  star.x = gridWidth * SOURCE.gridSegment * (index === 0 ? 0.32 : 0.68);
  star.dx = (index === 0 ? -1 : 1) * Math.abs(star.dx);
  const normalizedSourceSpeed = (star.dy * SOURCE.resolution - 0.1) / 0.6;
  const preparedFrameSpeed = PREPARED_MINIMUM_WELL_FRAME_SPEED + normalizedSourceSpeed *
    (PREPARED_MAXIMUM_WELL_FRAME_SPEED - PREPARED_MINIMUM_WELL_FRAME_SPEED);
  star.dy = preparedFrameSpeed / (SOURCE.speed * SOURCE.speedBase * SOURCE.resolution);
}

function initialPreparedWellY(index, gridWidth) {
  return gridWidth * SOURCE.gridSegment * (index === 0 ? 0.3 : 0.65);
}

function moveStars(stars, rng, gridWidth) {
  const width = gridWidth * SOURCE.gridSegment;
  const height = width;
  const offset = SOURCE.speed * SOURCE.speedBase * SOURCE.resolution;
  for (let index = 0; index < stars.length; index += 1) {
    const star = stars[index];
    star.x += star.dx * offset;
    star.y += star.dy * offset;
    if (star.x < -star.ro || star.y < -star.ro || star.x >= width + star.ro || star.y >= height + star.ro) {
      const replacement = newStar({ rng, index, gridWidth });
      isolatePreparedWell(replacement, index, gridWidth);
      Object.assign(star, replacement, { y: -replacement.ro });
    }
  }
}

function preparedWellDrainFrameCount(star, gridWidth, drainFrameBudget) {
  let maximumDepth = 0;
  for (let yIndex = 0; yIndex < gridWidth; yIndex += 1) {
    const y = yIndex * SOURCE.gridSegment;
    for (let xIndex = 0; xIndex < gridWidth; xIndex += 1) {
      const x = xIndex * SOURCE.gridSegment;
      const dx = star.x - x;
      const dy = star.y - y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > star.ro2) continue;
      maximumDepth = Math.max(maximumDepth, distanceSquared < star.ri2
        ? star.surfaceGravity
        : star.mass / Math.max(distanceSquared, 1e-12));
    }
  }
  if (maximumDepth === 0) return 0;
  const minimumFrames = Math.min(18, drainFrameBudget);
  const strength = Math.min(1, Math.sqrt(maximumDepth / SOURCE.maximumMassColor));
  return Math.max(minimumFrames, Math.round(minimumFrames + strength * (drainFrameBudget - minimumFrames)));
}

function moveStarsWithoutRespawn(stars) {
  const offset = SOURCE.speed * SOURCE.speedBase * SOURCE.resolution;
  for (const star of stars) {
    star.x += star.dx * offset;
    star.y += star.dy * offset;
  }
}

export function createYaRandom(seed) {
  const vector = RANDOM_VECTOR.map((value) => value >>> 0);
  let currentSeed = seed >>> 0;
  vector[0] = (vector[0] + currentSeed) >>> 0;
  for (let index = 1; index < vector.length; index += 1) {
    currentSeed = Math.imul(currentSeed, 999) >>> 0;
    currentSeed = rotateLeft(currentSeed, 9);
    currentSeed = (currentSeed + Math.imul(vector[index - 1], 1001)) >>> 0;
    currentSeed = rotateLeft(currentSeed, 15);
    vector[index] = (vector[index] + currentSeed) >>> 0;
  }
  let index1 = vector[0] % vector.length;
  let index2 = (index1 + 24) % vector.length;
  return Object.freeze({
    random() {
      const value = (vector[index1] + vector[index2]) >>> 0;
      vector[index1] = value;
      index1 = (index1 + 1) % vector.length;
      index2 = (index2 + 1) % vector.length;
      return value;
    },
    frand(limit) {
      return (this.random() * limit) / 0xFFFFFFFF;
    },
  });
}

function rotateLeft(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function hsvToRgb(hue, saturation, value) {
  const chroma = value * saturation;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  const [r, g, b] = segment < 1 ? [chroma, secondary, 0]
    : segment < 2 ? [secondary, chroma, 0]
      : segment < 3 ? [0, chroma, secondary]
        : segment < 4 ? [0, secondary, chroma]
          : segment < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const match = value - chroma;
  return [r + match, g + match, b + match];
}

function parseRgb(value) {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/u.exec(value);
  if (!match) throw new Error(`Prepared Gravity Well color is invalid: ${value}`);
  return match.slice(1).map(Number);
}

function scaleDepths(depths, weight) {
  return Object.freeze(depths.map((depth) => depth * weight));
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function cssNumber(value) {
  return Number(value.toFixed(6)).toString();
}

function trackball(p1x, p1y, p2x, p2y) {
  if (p1x === p2x && p1y === p2y) return Object.freeze([0, 0, 0, 1]);
  const p1 = [p1x, p1y, projectToTrackball(0.8, p1x, p1y)];
  const p2 = [p2x, p2y, projectToTrackball(0.8, p2x, p2y)];
  const axis = [
    p2[1] * p1[2] - p2[2] * p1[1],
    p2[2] * p1[0] - p2[0] * p1[2],
    p2[0] * p1[1] - p2[1] * p1[0],
  ];
  const delta = Math.hypot(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]);
  const angle = 2 * Math.asin(Math.max(-1, Math.min(1, delta / 1.6)));
  const axisLength = Math.hypot(...axis);
  const scale = Math.sin(angle / 2) / axisLength;
  return Object.freeze([axis[0] * scale, axis[1] * scale, axis[2] * scale, Math.cos(angle / 2)]);
}

function projectToTrackball(radius, x, y) {
  const distance = Math.hypot(x, y);
  return distance < radius * Math.SQRT1_2
    ? Math.sqrt(radius * radius - distance * distance)
    : ((radius / Math.SQRT2) ** 2) / distance;
}

function translation(x, y, z) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function multiplyMatrices(left, right) {
  const output = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let cursor = 0; cursor < 4; cursor += 1) {
        output[column * 4 + row] += left[cursor * 4 + row] * right[column * 4 + cursor];
      }
    }
  }
  return output;
}

function transformPoint(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

function projectEyePoint(point, perspective) {
  const scale = perspective / -point[2];
  return [point[0] * scale, point[1] * scale];
}

function eyeOffsetForScreenPixels(point, xPixels, yPixels, perspective) {
  const inverseScale = -point[2] / perspective;
  return [xPixels * inverseScale, yPixels * inverseScale];
}
