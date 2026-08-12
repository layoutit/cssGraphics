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

export const CSSMENGER_SEED = 26080801;
export const SOURCE_FRAME_DELAY_MILLISECONDS = 30;
export const PREPARED_STATE_COUNT = 1536;
export const CYCLIC_CLOSURE_START_STATE = 992;

export function buildPreparedMengerPlayback({
  seed = CSSMENGER_SEED,
  stateCount = PREPARED_STATE_COUNT,
} = {}) {
  if (!Number.isSafeInteger(seed) || seed <= 0) throw new RangeError("cssMenger seed must be a positive safe integer");
  if (!Number.isSafeInteger(stateCount) || stateCount < 5) throw new RangeError("cssMenger state count must be at least five");
  const rng = createYaRandom(seed);
  const rotator = makeRotator(rng, {
    spinXSpeed: 1,
    spinYSpeed: 1,
    spinZSpeed: 1,
    spinAccel: 1,
    wanderSpeed: 0,
    randomizeInitialState: true,
  });
  const palette = makeSmoothColormap(rng, 128);
  const sourceTransformDegrees = [];
  const nativeRotationDegrees = [];
  const colorRows = [];
  let previousTransformDegrees = null;
  const colorOffset1 = Math.trunc(palette.length / 3);
  const colorOffset2 = colorOffset1 * 2;
  for (let tick = 0; tick <= stateCount; tick += 1) {
    const [x, y, z] = getRotation(rotator, rng, true);
    const sourceRotationDegrees = [x * 360, y * 360, z * 360];
    const wrappedTransformDegrees = [-sourceRotationDegrees[0], sourceRotationDegrees[1], -sourceRotationDegrees[2]];
    const transformDegrees = previousTransformDegrees
      ? wrappedTransformDegrees.map((value, axis) => nearestEquivalentDegrees(value, previousTransformDegrees[axis]))
      : wrappedTransformDegrees;
    sourceTransformDegrees.push(Object.freeze(transformDegrees));
    nativeRotationDegrees.push(Object.freeze(sourceRotationDegrees));
    previousTransformDegrees = transformDegrees;
    if (tick === stateCount) continue;
    colorRows.push(Object.freeze([
      tick % palette.length,
      (tick + colorOffset1) % palette.length,
      (tick + colorOffset2) % palette.length,
    ]));
  }
  const closureStartState = Math.min(CYCLIC_CLOSURE_START_STATE, Math.max(0, stateCount - 5));
  const cyclicClosure = closePreparedRotationCycle(sourceTransformDegrees, closureStartState);
  const cyclicTransformDegrees = cyclicClosure.degrees;
  const transforms = cyclicTransformDegrees.slice(0, stateCount).map(transformForDegrees);
  const cycleClosureTransform = transformForDegrees(cyclicTransformDegrees[stateCount]);
  const preparedRotationDegrees = cyclicTransformDegrees.slice(0, stateCount)
    .map((degrees) => Object.freeze([-degrees[0], degrees[1], -degrees[2]]));
  const cycleClosureRotationDegrees = Object.freeze([
    -cyclicTransformDegrees[stateCount][0],
    cyclicTransformDegrees[stateCount][1],
    -cyclicTransformDegrees[stateCount][2],
  ]);
  const nativePrefixStateCount = Math.min(stateCount, closureStartState + 3);
  const cycleClosure = preparedCycleClosureContract({
    cyclicTransformDegrees,
    closureStartState,
    nativePrefixStateCount,
    stateCount,
    targetTurnCounts: cyclicClosure.targetTurnCounts,
  });
  assertEveryAdjacentStateChangesAllPublications(transforms, colorRows, cycleClosureTransform);
  return Object.freeze({
    schema: "cssmenger-prepared-playback@1",
    seed,
    sourceFrameDelayMilliseconds: SOURCE_FRAME_DELAY_MILLISECONDS,
    stateCount,
    segmentStartState: 0,
    segmentEndState: stateCount - 1,
    loop: true,
    initial: Object.freeze({ stateIndex: 0 }),
    palette: Object.freeze(palette),
    transforms: Object.freeze(transforms),
    cycleClosureTransform,
    nativeRotationDegrees: Object.freeze(nativeRotationDegrees.slice(0, stateCount)),
    preparedRotationDegrees: Object.freeze(preparedRotationDegrees),
    cycleClosureRotationDegrees,
    nativePrefixStateCount,
    cycleClosure,
    colorRows: Object.freeze(colorRows),
    adjacentPublicationMode: "all-fields-change",
    loopMode: "prepared-forward-cyclic-c2-rotation-and-palette",
    transformAngleMode: "prepared-native-prefix-quintic-c2-cyclic-closure-unwrapped-degrees",
    runtimeInterpolation: false,
    runtimeColorGeneration: false,
    runtimeRotationCalculation: false,
  });
}

function closePreparedRotationCycle(sourceDegrees, closureStartState) {
  const finalStateIndex = sourceDegrees.length - 1;
  const closureStepCount = finalStateIndex - closureStartState;
  if (finalStateIndex < 5 || closureStepCount < 5) {
    throw new RangeError("cssMenger cyclic closure requires at least five prepared transitions");
  }
  const closed = sourceDegrees.map((degrees) => [...degrees]);
  const targetTurnCounts = [];
  const nodes = [0, 1, 2, closureStepCount - 2, closureStepCount - 1, closureStepCount];
  for (let axis = 0; axis < 3; axis += 1) {
    const selected = selectSmoothCycleClosureAxis({
      axis,
      closureStartState,
      finalStateIndex,
      nodes,
      sourceDegrees,
    });
    targetTurnCounts.push(selected.targetTurnCount);
    for (let stateIndex = closureStartState; stateIndex <= finalStateIndex; stateIndex += 1) {
      closed[stateIndex][axis] = selected.degrees[stateIndex - closureStartState];
    }
  }
  return Object.freeze({
    degrees: Object.freeze(closed.map((degrees) => Object.freeze(degrees))),
    targetTurnCounts: Object.freeze(targetTurnCounts),
  });
}

function selectSmoothCycleClosureAxis({
  axis,
  closureStartState,
  finalStateIndex,
  nodes,
  sourceDegrees,
}) {
  const initialVelocity = sourceDegrees[1][axis] - sourceDegrees[0][axis];
  const initialAcceleration = sourceDegrees[2][axis] - 2 * sourceDegrees[1][axis] + sourceDegrees[0][axis];
  const nominalTurnCount = Math.round(
    (sourceDegrees[finalStateIndex][axis] - sourceDegrees[0][axis]) / 360,
  );
  let prefixMaximumStepDegrees = 0;
  for (let stateIndex = 1; stateIndex < closureStartState; stateIndex += 1) {
    prefixMaximumStepDegrees = Math.max(
      prefixMaximumStepDegrees,
      Math.abs(sourceDegrees[stateIndex][axis] - sourceDegrees[stateIndex - 1][axis]),
    );
  }
  let selected = null;
  for (let targetTurnCount = nominalTurnCount - 3;
    targetTurnCount <= nominalTurnCount + 3;
    targetTurnCount += 1) {
    const closureTarget = sourceDegrees[0][axis] + targetTurnCount * 360;
    const corrections = [
      0,
      0,
      0,
      closureTarget - 2 * initialVelocity + initialAcceleration - sourceDegrees[finalStateIndex - 2][axis],
      closureTarget - initialVelocity - sourceDegrees[finalStateIndex - 1][axis],
      closureTarget - sourceDegrees[finalStateIndex][axis],
    ];
    const degrees = [];
    let maximumStepDegrees = prefixMaximumStepDegrees;
    let correctionEnergy = 0;
    let previousDegrees = sourceDegrees[Math.max(0, closureStartState - 1)][axis];
    for (let stateIndex = closureStartState; stateIndex <= finalStateIndex; stateIndex += 1) {
      const correction = lagrangeInterpolation(stateIndex - closureStartState, nodes, corrections);
      const preparedDegrees = sourceDegrees[stateIndex][axis] + correction;
      degrees.push(preparedDegrees);
      maximumStepDegrees = Math.max(maximumStepDegrees, Math.abs(preparedDegrees - previousDegrees));
      correctionEnergy += correction * correction;
      previousDegrees = preparedDegrees;
    }
    const candidate = { correctionEnergy, degrees, maximumStepDegrees, targetTurnCount };
    if (selected === null ||
        candidate.maximumStepDegrees < selected.maximumStepDegrees - 1e-6 ||
        Math.abs(candidate.maximumStepDegrees - selected.maximumStepDegrees) <= 1e-6 &&
          candidate.correctionEnergy < selected.correctionEnergy) {
      selected = candidate;
    }
  }
  return selected;
}

function lagrangeInterpolation(value, nodes, samples) {
  let result = 0;
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    let basis = 1;
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      if (nodeIndex !== sampleIndex) {
        basis *= (value - nodes[nodeIndex]) / (nodes[sampleIndex] - nodes[nodeIndex]);
      }
    }
    result += samples[sampleIndex] * basis;
  }
  return result;
}

function preparedCycleClosureContract({
  cyclicTransformDegrees,
  closureStartState,
  nativePrefixStateCount,
  stateCount,
  targetTurnCounts,
}) {
  const initialVelocity = delta(cyclicTransformDegrees[1], cyclicTransformDegrees[0]);
  const closureVelocity = delta(cyclicTransformDegrees[stateCount], cyclicTransformDegrees[stateCount - 1]);
  const initialAcceleration = delta(
    delta(cyclicTransformDegrees[2], cyclicTransformDegrees[1]),
    initialVelocity,
  );
  const closureAcceleration = delta(
    closureVelocity,
    delta(cyclicTransformDegrees[stateCount - 1], cyclicTransformDegrees[stateCount - 2]),
  );
  return Object.freeze({
    schema: "cssmenger-prepared-cyclic-rotation-closure@1",
    closureStartState,
    nativePrefixStateCount,
    stateCount,
    targetTurnCounts,
    cycleDurationMilliseconds: stateCount * SOURCE_FRAME_DELAY_MILLISECONDS,
    interpolation: "prepare-time-quintic-through-two-position-velocity-acceleration-boundaries",
    orientationMaximumEquivalentDeltaDegrees: Math.max(...cyclicTransformDegrees[stateCount]
      .map((value, axis) => equivalentAngleDelta(value, cyclicTransformDegrees[0][axis]))),
    velocityMaximumDeltaDegreesPerTick: Math.max(...closureVelocity
      .map((value, axis) => Math.abs(value - initialVelocity[axis]))),
    accelerationMaximumDeltaDegreesPerTickSquared: Math.max(...closureAcceleration
      .map((value, axis) => Math.abs(value - initialAcceleration[axis]))),
  });
}

function delta(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function equivalentAngleDelta(left, right) {
  return Math.abs(((left - right + 180) % 360 + 360) % 360 - 180);
}

function transformForDegrees(degrees) {
  return `rotateX(${number(degrees[0])}deg) rotateY(${number(degrees[1])}deg) rotateZ(${number(degrees[2])}deg)`;
}

function nearestEquivalentDegrees(value, previousValue) {
  return value - Math.round((value - previousValue) / 360) * 360;
}

function assertEveryAdjacentStateChangesAllPublications(transforms, colorRows, cycleClosureTransform) {
  for (let stateIndex = 1; stateIndex < transforms.length; stateIndex += 1) {
    if (transforms[stateIndex] === transforms[stateIndex - 1] ||
        colorRows[stateIndex].some((paletteIndex, axis) => paletteIndex === colorRows[stateIndex - 1][axis])) {
      throw new Error(`Prepared cssMenger state ${stateIndex} cannot use the direct adjacent-publication path`);
    }
  }
  if (cycleClosureTransform === transforms.at(-1)) {
    throw new Error("Prepared cssMenger cycle boundary cannot hold a publication state");
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

function makeRotator(rng, options) {
  const rotator = {
    spinXSpeed: options.spinXSpeed,
    spinYSpeed: options.spinYSpeed,
    spinZSpeed: options.spinZSpeed,
    wanderSpeed: options.wanderSpeed,
    rotx: 0,
    roty: 0,
    rotz: 0,
    dx: 0,
    dy: 0,
    dz: 0,
    ddx: 0,
    ddy: 0,
    ddz: 0,
    dMax: 0,
    wanderFrame: 0,
  };
  if (options.randomizeInitialState) {
    rotator.rotx = rng.frand(1) * randomSign(rng);
    rotator.roty = rng.frand(1) * randomSign(rng);
    rotator.rotz = rng.frand(1) * randomSign(rng);
    rotator.wanderFrame = rng.random() % 0xFFFF;
  }
  const d = 0.006;
  const dd = 0.00006;
  rotator.dx = bellRandom(rng, d * rotator.spinXSpeed);
  rotator.dy = bellRandom(rng, d * rotator.spinYSpeed);
  rotator.dz = bellRandom(rng, d * rotator.spinZSpeed);
  rotator.dMax = rotator.dx * 2;
  rotator.ddx = (dd + rng.frand(dd + dd)) * rotator.spinXSpeed * options.spinAccel;
  rotator.ddy = (dd + rng.frand(dd + dd)) * rotator.spinYSpeed * options.spinAccel;
  rotator.ddz = (dd + rng.frand(dd + dd)) * rotator.spinZSpeed * options.spinAccel;
  return rotator;
}

function getRotation(rotator, rng, update) {
  if (update) {
    [rotator.rotx, rotator.dx, rotator.ddx] = rotateOne(rotator.rotx, rotator.dx, rotator.ddx, rotator.spinXSpeed, rotator.dMax, rng);
    [rotator.roty, rotator.dy, rotator.ddy] = rotateOne(rotator.roty, rotator.dy, rotator.ddy, rotator.spinYSpeed, rotator.dMax, rng);
    [rotator.rotz, rotator.dz, rotator.ddz] = rotateOne(rotator.rotz, rotator.dz, rotator.ddz, rotator.spinZSpeed, rotator.dMax, rng);
  }
  return [Math.abs(rotator.rotx), Math.abs(rotator.roty), Math.abs(rotator.rotz)];
}

function rotateOne(position, velocity, acceleration, speed, maxVelocity, rng) {
  if (speed === 0) return [position, velocity, acceleration];
  let nextPosition = position;
  if (nextPosition < 0) nextPosition = -(nextPosition + velocity);
  else nextPosition += velocity;
  while (nextPosition < 0) nextPosition += 1;
  while (nextPosition >= 1) nextPosition -= 1;
  nextPosition = position > 0 ? nextPosition : -nextPosition;
  velocity += acceleration;
  if (velocity > maxVelocity || velocity < -maxVelocity) {
    acceleration = -acceleration;
  } else if (velocity < 0) {
    if (rng.random() % 4) {
      velocity = 0;
      if (rng.random() % 2) acceleration = 0;
      else if (acceleration < 0) acceleration = -acceleration;
    } else {
      velocity = -velocity;
      acceleration = -acceleration;
      nextPosition = -nextPosition;
    }
  }
  if (!(rng.random() % 120)) acceleration = -acceleration;
  if (!(rng.random() % 200)) {
    if (acceleration === 0) acceleration = 0.00001;
    else if (rng.random() & 1) acceleration *= 1.2;
    else acceleration *= 0.8;
  }
  return [nextPosition, velocity, acceleration];
}

function makeSmoothColormap(rng, colorCount) {
  const n = rng.random() % 20;
  const pointCount = n <= 5 ? 2 : n <= 15 ? 3 : n <= 18 ? 4 : 5;
  const hues = [];
  const saturations = [];
  const values = [];
  let totalSaturation = 0;
  let totalValue = 0;
  let loop = 0;
  while (true) {
    let accepted = true;
    for (let index = 0; index < pointCount; index += 1) {
      while (true) {
        if (++loop > 10000) throw new Error("XScreenSaver smooth colormap selection did not converge");
        hues[index] = rng.random() % 360;
        saturations[index] = rng.frand(1);
        values[index] = rng.frand(0.8) + 0.2;
        if (index === 0) break;
        const compareIndex = index + 1 === pointCount ? 0 : index - 1;
        const hi = hues[index] / 360;
        const hj = hues[compareIndex] / 360;
        let dh = Math.abs(hj - hi);
        if (dh > 0.5) dh = 0.5 - (dh - 0.5);
        const distance = Math.hypot(
          dh,
          saturations[compareIndex] - saturations[index],
          values[compareIndex] - values[index],
        );
        if (distance >= 0.2) break;
      }
      totalSaturation += saturations[index];
      totalValue += values[index];
    }
    if (totalSaturation / pointCount < 0.2 || totalValue / pointCount < 0.3) accepted = false;
    if (accepted) break;
  }
  return makeColorPath(hues, saturations, values, colorCount);
}

function makeColorPath(hues, saturations, values, colorCount) {
  if (hues.length === 2) return makeClosedColorRamp(hues, saturations, values, colorCount);
  const count = hues.length;
  const hueDistances = [];
  const edgeLengths = [];
  let circumference = 0;
  for (let index = 0; index < count; index += 1) {
    let distance = Math.abs((hues[index] - hues[(index + 1) % count]) / 360);
    if (distance > 0.5) distance = 0.5 - (distance - 0.5);
    hueDistances[index] = distance;
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const edge = Math.sqrt(
      hueDistances[index] * hueDistances[next] +
      (saturations[next] - saturations[index]) ** 2 +
      (values[next] - values[index]) ** 2,
    );
    edgeLengths[index] = edge;
    circumference += edge;
  }
  if (circumference < 0.0001) throw new Error("XScreenSaver smooth colormap circumference collapsed");
  const counts = edgeLengths.map((edge) => Math.trunc(colorCount * edge / circumference));
  const colors = [];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const stepCount = counts[index];
    if (stepCount <= 0) continue;
    const dh = 360 * (hueDistances[index] / stepCount);
    const ds = (saturations[next] - saturations[index]) / stepCount;
    const dv = (values[next] - values[index]) / stepCount;
    const distance = hues[next] - hues[index];
    let direction = distance >= 0 ? -1 : 1;
    if (distance <= 180 && distance >= -180) direction = -direction;
    for (let step = 0; step < stepCount; step += 1) {
      let hue = hues[index] + step * dh * direction;
      if (hue < 0) hue += 360;
      colors.push(hsvToPreparedColor(Math.trunc(hue), saturations[index] + step * ds, values[index] + step * dv));
    }
  }
  if (colors.length === 0) throw new Error("XScreenSaver smooth colormap emitted no colors");
  while (colors.length < colorCount) colors.push(colors.at(-1));
  return colors.slice(0, colorCount);
}

function makeClosedColorRamp(hues, saturations, values, colorCount) {
  const wanted = Math.trunc(colorCount / 2) + 1;
  const dh = (hues[1] - hues[0]) / wanted;
  const ds = (saturations[1] - saturations[0]) / wanted;
  const dv = (values[1] - values[0]) / wanted;
  const colors = Array(colorCount);
  for (let index = 0; index < wanted; index += 1) {
    colors[index] = hsvToPreparedColor(
      Math.trunc(hues[0] + index * dh),
      saturations[0] + index * ds,
      values[0] + index * dv,
    );
  }
  for (let index = wanted; index < colorCount; index += 1) colors[index] = colors[colorCount - index];
  return colors;
}

function hsvToPreparedColor(hue, saturation, value) {
  const s = Math.min(1, Math.max(0, saturation));
  const v = Math.min(1, Math.max(0, value));
  const h = ((hue % 360) + 360) % 360 / 60;
  const sector = Math.trunc(h);
  const fraction = h - sector;
  const p1 = v * (1 - s);
  const p2 = v * (1 - s * fraction);
  const p3 = v * (1 - s * (1 - fraction));
  const rgb = sector === 0 ? [v, p3, p1]
    : sector === 1 ? [p2, v, p1]
      : sector === 2 ? [p1, v, p3]
        : sector === 3 ? [p1, p2, v]
          : sector === 4 ? [p3, p1, v]
            : [v, p1, p2];
  const source16 = rgb.map((component) => Math.trunc(component * 65535));
  const material = source16.map((component) => component / 65536);
  return Object.freeze({
    source16: Object.freeze(source16),
    material: Object.freeze([...material, 1]),
    css: `rgb(${source16.map((component) => Math.round(component / 257)).join(" ")})`,
  });
}

function bellRandom(rng, limit) {
  return (rng.frand(limit) + rng.frand(limit) + rng.frand(limit)) / 3;
}

function randomSign(rng) {
  return rng.random() & 1 ? 1 : -1;
}

function rotateLeft(value, count) {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

function number(value) {
  return Number(value.toFixed(9)).toString();
}
