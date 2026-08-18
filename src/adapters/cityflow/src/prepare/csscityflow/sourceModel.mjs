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

const SOURCE_COMMON = Object.freeze({
  commit: "906693799e4fb7581436590cf84ecb2d3c9186ba",
  primaryPath: "hacks/glx/cityflow.c",
  primarySha256: "9113c9f3214ba6c1f350b3863c306e6015e47a856a17bbe24d597f909dfa027b",
  configPath: "hacks/config/cityflow.xml",
  configSha256: "0453c12e39e4b7d32e66a7780d69979aaaa42d0632a3b6757df9c1cee6c7c919",
  delayMicroseconds: 20_000,
  skewDegrees: 12,
  waveCount: 6,
  waveSpeed: 25,
  waveRadius: 256,
  textureSize: 512,
  paletteSize: 256,
});

export const CITYFLOW_BANKS = Object.freeze({
  desktop: createBank("desktop", "cityflow", "Cityflow", 200),
});

export const CITYFLOW_SOURCE = CITYFLOW_BANKS.desktop;
export const CSSCITYFLOW_SEED = 26081702;
export const CSSCITYFLOW_FRAME_MILLISECONDS = SOURCE_COMMON.delayMicroseconds / 1_000;
export const CSSCITYFLOW_PHASE_STEP = SOURCE_COMMON.waveSpeed / 1_000;
export const CSSCITYFLOW_PHASE_PERIOD = Math.PI * 2;
export const CSSCITYFLOW_FACE_IDS = Object.freeze(["top", "front", "right"]);

function createBank(id, modelId, name, boxCount) {
  return Object.freeze({ ...SOURCE_COMMON, id, modelId, name, boxCount });
}

export function resolveCityflowBank(bankId) {
  const bank = CITYFLOW_BANKS[bankId];
  if (!bank) throw new RangeError(`Unknown Cityflow prepared bank: ${bankId}`);
  return bank;
}

export function buildCityflowSourceState({
  bankId = "desktop",
  seed = CSSCITYFLOW_SEED,
} = {}) {
  const source = resolveCityflowBank(bankId);
  if (!Number.isSafeInteger(seed) || seed <= 0) throw new RangeError("Cityflow seed must be positive");
  const rng = createYaRandom(seed);
  const palette = makeSmoothColorMap(rng, source.paletteSize);
  const waves = Object.freeze(Array.from({ length: source.waveCount }, (_, index) => Object.freeze({
    index,
    xTheta: rng.frand(Math.PI * 2),
    yTheta: rng.frand(Math.PI * 2),
  })));
  const scale = f32(1.8 / Math.sqrt(source.boxCount));
  const boxes = [];
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (let sourceIndex = 0; sourceIndex < source.boxCount; sourceIndex += 1) {
    const theta = -rng.frand(source.skewDegrees) * Math.PI / 180;
    const x = f32(rng.frand(1) - 0.5);
    const y = f32(rng.frand(1) - 0.5);
    const z = f32(rng.frand(0.12));
    const cth = f32(Math.cos(theta));
    const sth = f32(Math.sin(theta));
    const width = f32(scale * (rng.frand(1) + 0.2));
    const depth = f32(scale * (rng.frand(1) + 0.2));
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    boxes.push({ sourceIndex, x, y, z, cth, sth, width, depth });
  }
  boxes.sort((left, right) => Math.trunc(right.y * 10_000) - Math.trunc(left.y * 10_000));
  const preparedBoxes = boxes.map((box, renderIndex) => {
    const fx = f32(f32(box.x - minX) / f32(maxX - minX));
    const fy = f32(f32(box.y - minY) / f32(maxY - minY));
    const sampleX = Math.trunc(f32(source.textureSize * fx)) % source.textureSize;
    const sampleY = Math.trunc(f32(source.textureSize * fy)) % source.textureSize;
    const centerX = f32(f32(box.cth * box.x) + f32(box.sth * box.y));
    const centerY = f32(f32(-box.sth * box.x) + f32(box.cth * box.y));
    return Object.freeze({
      ...box,
      renderIndex,
      centerX,
      centerY,
      sampleX,
      sampleY,
      lightFactors: cityflowLightFactors(box),
    });
  });
  return Object.freeze({
    schema: "csscityflow-source-state@1",
    seed,
    source,
    palette,
    waves,
    bounds: Object.freeze({ minX, maxX, minY, maxY }),
    boxes: Object.freeze(preparedBoxes),
  });
}

export function cityflowFrameAt(sourceState, tick) {
  if (sourceState?.schema !== "csscityflow-source-state@1") {
    throw new TypeError("Cityflow frame requires prepared source state");
  }
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("Cityflow tick must be non-negative");
  const wavePositions = sourceState.waves.map((wave) => {
    let xTheta = wave.xTheta;
    let yTheta = wave.yTheta;
    for (let index = 0; index <= tick; index += 1) {
      xTheta += CSSCITYFLOW_PHASE_STEP;
      if (xTheta > CSSCITYFLOW_PHASE_PERIOD) xTheta -= CSSCITYFLOW_PHASE_PERIOD;
      yTheta += CSSCITYFLOW_PHASE_STEP;
      if (yTheta > CSSCITYFLOW_PHASE_PERIOD) yTheta -= CSSCITYFLOW_PHASE_PERIOD;
    }
    return Object.freeze({
      xTheta,
      yTheta,
      x: Math.trunc(sourceState.source.textureSize / 2 +
        Math.cos(xTheta) * sourceState.source.textureSize / 2),
      y: Math.trunc(sourceState.source.textureSize / 2 +
        Math.cos(yTheta) * sourceState.source.textureSize / 2),
    });
  });
  const heights = makeWaveHeightTable(sourceState.source);
  const boxes = sourceState.boxes.map((box) => {
    let value = 0;
    for (const wave of wavePositions) {
      const dx = box.sampleX - wave.x;
      const dy = box.sampleY - wave.y;
      const distance = Math.trunc(Math.sqrt(dx * dx + dy * dy));
      value += distance >= sourceState.source.waveRadius ? 0 : heights[distance];
    }
    value = Math.trunc(value * 0.4);
    if (value > 255) value = 255;
    const height = f32(box.z + value / 256 / 2.5 + 0.1);
    const colorIndex = Math.trunc(height * sourceState.source.paletteSize * 0.7) %
      sourceState.source.paletteSize;
    return Object.freeze({ renderIndex: box.renderIndex, sourceIndex: box.sourceIndex, height, colorIndex });
  });
  return Object.freeze({ tick, wavePositions: Object.freeze(wavePositions), boxes: Object.freeze(boxes) });
}

export function cityflowLightFactors(box) {
  const lightLength = Math.hypot(0, 0.25, -1);
  const top = 0.4 + 1 / lightLength;
  const front = 0.4 + Math.max(0, box.cth * 0.25 / lightLength);
  const right = 0.4 + Math.max(0, -box.sth * 0.25 / lightLength);
  return Object.freeze([top, front, right].map((value) => Math.max(0, value)));
}

export function makeWaveHeightTable(source = CITYFLOW_SOURCE) {
  return Object.freeze(Array.from({ length: source.waveRadius }, (_, distance) => {
    const maximum = source.paletteSize * (source.waveRadius - distance) / source.waveRadius;
    return Math.trunc((maximum + maximum * Math.cos(distance / 50)) / 2);
  }));
}

export function createYaRandom(seed) {
  const vector = RANDOM_VECTOR.map((value) => value >>> 0);
  let value = seed >>> 0;
  vector[0] = (vector[0] + value) >>> 0;
  for (let index = 1; index < vector.length; index += 1) {
    value = Math.imul(value, 999) >>> 0;
    value = rotateLeft(value, 9);
    value = (value + Math.imul(vector[index - 1], 1001)) >>> 0;
    value = rotateLeft(value, 15);
    vector[index] = (vector[index] + value) >>> 0;
  }
  let index1 = vector[0] % vector.length;
  let index2 = (index1 + 24) % vector.length;
  return Object.freeze({
    next() {
      const result = (vector[index1] + vector[index2]) >>> 0;
      vector[index1] = result;
      index1 = (index1 + 1) % vector.length;
      index2 = (index2 + 1) % vector.length;
      return result;
    },
    frand(maximum) {
      return this.next() * maximum / 0xFFFFFFFF;
    },
  });
}

function makeSmoothColorMap(rng, colorCount) {
  let pointCount;
  const selector = rng.next() % 20;
  if (selector <= 5) pointCount = 2;
  else if (selector <= 15) pointCount = 3;
  else if (selector <= 18) pointCount = 4;
  else pointCount = 5;
  const hues = new Array(pointCount);
  const saturations = new Array(pointCount);
  const values = new Array(pointCount);
  let totalSaturation = 0;
  let totalValue = 0;
  let loop = 0;
  while (true) {
    for (let index = 0; index < pointCount; index += 1) {
      while (true) {
        if (++loop > 10_000) throw new Error("Cityflow source palette selection did not converge");
        hues[index] = rng.next() % 360;
        saturations[index] = rng.frand(1);
        values[index] = rng.frand(0.8) + 0.2;
        if (index === 0) break;
        const other = index + 1 === pointCount ? 0 : index - 1;
        let hueDistance = Math.abs(hues[other] / 360 - hues[index] / 360);
        if (hueDistance > 0.5) hueDistance = 0.5 - (hueDistance - 0.5);
        const distance = Math.sqrt(hueDistance * hueDistance +
          (saturations[other] - saturations[index]) ** 2 +
          (values[other] - values[index]) ** 2);
        if (distance >= 0.2) break;
      }
      totalSaturation += saturations[index];
      totalValue += values[index];
    }
    if (totalSaturation / pointCount >= 0.2 && totalValue / pointCount >= 0.3) break;
  }
  return Object.freeze(makeColorPath(hues, saturations, values, colorCount));
}

function makeColorPath(hues, saturations, values, colorCount) {
  if (hues.length === 2) return makeColorRamp(hues, saturations, values, colorCount);
  const count = hues.length;
  const hueDistances = new Array(count);
  const edges = new Array(count);
  let circumference = 0;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    let distance = Math.abs((hues[index] - hues[next]) / 360);
    if (distance > 0.5) distance = 0.5 - (distance - 0.5);
    hueDistances[index] = distance;
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    edges[index] = Math.sqrt(hueDistances[index] * hueDistances[next] +
      (saturations[next] - saturations[index]) ** 2 +
      (values[next] - values[index]) ** 2);
    circumference += edges[index];
  }
  if (circumference < 0.0001) throw new Error("Cityflow source palette path collapsed");
  const segmentCounts = edges.map((edge) => Math.trunc(colorCount * edge / circumference));
  const hueSteps = new Array(count);
  const saturationSteps = new Array(count);
  const valueSteps = new Array(count);
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    if (segmentCounts[index] > 0) {
      hueSteps[index] = 360 * hueDistances[index] / segmentCounts[index];
      saturationSteps[index] = (saturations[next] - saturations[index]) / segmentCounts[index];
      valueSteps[index] = (values[next] - values[index]) / segmentCounts[index];
    }
  }
  const colors = [];
  for (let index = 0; index < count; index += 1) {
    const distance = hues[(index + 1) % count] - hues[index];
    let direction = distance >= 0 ? -1 : 1;
    if (distance <= 180 && distance >= -180) direction = -direction;
    for (let step = 0; step < segmentCounts[index]; step += 1) {
      let hue = hues[index] + step * hueSteps[index] * direction;
      if (hue < 0) hue += 360;
      colors.push(hsvToRgb(Math.trunc(hue),
        saturations[index] + step * saturationSteps[index],
        values[index] + step * valueSteps[index]));
    }
  }
  if (colors.length === 0) throw new Error("Cityflow source palette emitted no colors");
  while (colors.length < colorCount) colors.push(colors.at(-1));
  return colors.slice(0, colorCount);
}

function makeColorRamp(hues, saturations, values, colorCount) {
  const halfCount = Math.trunc(colorCount / 2) + 1;
  const hueStep = (hues[1] - hues[0]) / halfCount;
  const saturationStep = (saturations[1] - saturations[0]) / halfCount;
  const valueStep = (values[1] - values[0]) / halfCount;
  const colors = new Array(colorCount);
  for (let index = 0; index < halfCount; index += 1) {
    colors[index] = hsvToRgb(
      Math.trunc(hues[0] + index * hueStep),
      saturations[0] + index * saturationStep,
      values[0] + index * valueStep,
    );
  }
  for (let index = halfCount; index < colorCount; index += 1) {
    colors[index] = colors[colorCount - index];
  }
  return colors;
}

function hsvToRgb(hue, saturation, value) {
  const s = Math.max(0, Math.min(1, saturation));
  const v = Math.max(0, Math.min(1, value));
  const h = ((hue % 360) + 360) % 360 / 60;
  const sector = Math.trunc(h);
  const fraction = h - sector;
  const p1 = v * (1 - s);
  const p2 = v * (1 - s * fraction);
  const p3 = v * (1 - s * (1 - fraction));
  const channels = sector === 0 ? [v, p3, p1]
    : sector === 1 ? [p2, v, p1]
      : sector === 2 ? [p1, v, p3]
        : sector === 3 ? [p1, p2, v]
          : sector === 4 ? [p3, p1, v]
            : [v, p1, p2];
  return Object.freeze(channels.map((channel) => Math.trunc(channel * 65535)));
}

function rotateLeft(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function f32(value) {
  return Math.fround(value);
}
