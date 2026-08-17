import {
  computeTextureAtlasPlanPublic,
} from "@layoutit/polycss";

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

const FLIPFLOP_SOURCE_COMMON = Object.freeze({
  commit: "906693799e4fb7581436590cf84ecb2d3c9186ba",
  primaryPath: "hacks/glx/flipflop.c",
  primarySha256: "099d290a75e52d6ccc5de7ea1344ef8ee0889293acef034e9ed85f2bdf2e41fb",
  configPath: "hacks/config/flipflop.xml",
  tileRatio: 95,
  halfThickness: 0.04,
  delayMicroseconds: 20_000,
  flipsPerFrame: 0.03,
  moveAttemptsPerFrame: 40,
  spin: 0.1,
  boardDegreesPerFrame: 0.1,
});

export const FLIPFLOP_BANKS = Object.freeze({
  desktop: createSourceBank("desktop", "flipflop", "Flip Flop", 9, 9),
  mobile: createSourceBank("mobile", "flipflop-mobile", "Flip Flop Mobile", 5, 5),
});

export const FLIPFLOP_SOURCE = FLIPFLOP_BANKS.desktop;

export function resolveFlipFlopBank(bankId) {
  const bank = FLIPFLOP_BANKS[bankId];
  if (!bank) throw new RangeError(`Unknown Flip Flop prepared bank: ${bankId}`);
  return bank;
}

export const CSSFLIPFLOP_SEED = 26081701;
export const CSSFLIPFLOP_SOURCE_FRAME_COUNT = 600;
export const CSSFLIPFLOP_FRAME_MILLISECONDS = FLIPFLOP_SOURCE.delayMicroseconds / 1_000;
export const CSSFLIPFLOP_TILE_FACE_COUNT = 6;
export const CSSFLIPFLOP_PIXELS_PER_SOURCE_UNIT = 80;
export const CSSFLIPFLOP_RASTER_LEAF_SIZE = 20;
export const CSSFLIPFLOP_LIGHT_LEVELS = 64;
export const CSSFLIPFLOP_LIGHT_DIRECTIONS = 4;
export const CSSFLIPFLOP_LIGHT_MAGNITUDES = Object.freeze([0, 0.05, 0.12]);
export const CSSFLIPFLOP_LIGHT_PROFILE_COUNT =
  CSSFLIPFLOP_LIGHT_LEVELS * CSSFLIPFLOP_LIGHT_DIRECTIONS * CSSFLIPFLOP_LIGHT_MAGNITUDES.length;

const COLOR_ROWS = Object.freeze([
  Object.freeze({ id: "red", rgba: Object.freeze([1, 0, 0, 1]) }),
  Object.freeze({ id: "blue", rgba: Object.freeze([0, 0, 1, 1]) }),
  Object.freeze({ id: "yellow", rgba: Object.freeze([1, 1, 0, 1]) }),
]);

function createSourceBank(id, modelId, name, boardWidth, boardDepth) {
  const cellCount = boardWidth * boardDepth;
  const tileCount = Math.floor(cellCount * FLIPFLOP_SOURCE_COMMON.tileRatio / 100);
  return Object.freeze({
    ...FLIPFLOP_SOURCE_COMMON,
    id,
    modelId,
    name,
    boardWidth,
    boardDepth,
    boardAverageSize: Math.floor((boardWidth + boardDepth) / 2),
    tileCount,
    emptyCellCount: cellCount - tileCount,
  });
}

const SOURCE_FACES = Object.freeze((() => {
  const h = FLIPFLOP_SOURCE.halfThickness;
  const faceSpan = 1 - h * 2;
  const edgeSpan = h * 2;
  return [
    Object.freeze({ id: "bottom", normal: Object.freeze([0, -1, 0]), width: faceSpan, height: faceSpan, vertices: Object.freeze([[h, -h, h], [1 - h, -h, h], [1 - h, -h, 1 - h], [h, -h, 1 - h]]) }),
    Object.freeze({ id: "top", normal: Object.freeze([0, 1, 0]), width: faceSpan, height: faceSpan, vertices: Object.freeze([[h, h, 1 - h], [1 - h, h, 1 - h], [1 - h, h, h], [h, h, h]]) }),
    Object.freeze({ id: "near", normal: Object.freeze([0, 0, -1]), width: faceSpan, height: edgeSpan, vertices: Object.freeze([[h, h, h], [1 - h, h, h], [1 - h, -h, h], [h, -h, h]]) }),
    Object.freeze({ id: "far", normal: Object.freeze([0, 0, 1]), width: edgeSpan, height: faceSpan, vertices: Object.freeze([[h, h, 1 - h], [h, -h, 1 - h], [1 - h, -h, 1 - h], [1 - h, h, 1 - h]]) }),
    Object.freeze({ id: "right", normal: Object.freeze([1, 0, 0]), width: edgeSpan, height: faceSpan, vertices: Object.freeze([[1 - h, h, 1 - h], [1 - h, -h, 1 - h], [1 - h, -h, h], [1 - h, h, h]]) }),
    Object.freeze({ id: "left", normal: Object.freeze([-1, 0, 0]), width: faceSpan, height: edgeSpan, vertices: Object.freeze([[h, h, 1 - h], [h, h, h], [h, -h, h], [h, -h, 1 - h]]) }),
  ];
})());

export function buildFlipFlopSourceFrames({
  seed = CSSFLIPFLOP_SEED,
  frameCount = CSSFLIPFLOP_SOURCE_FRAME_COUNT,
  bankId = "desktop",
} = {}) {
  if (!Number.isSafeInteger(seed) || seed <= 0) throw new RangeError("Flip Flop seed must be positive");
  if (!Number.isSafeInteger(frameCount) || frameCount < 2) throw new RangeError("Flip Flop needs at least two source frames");
  const source = resolveFlipFlopBank(bankId);
  const rng = createYaRandom(seed);
  const state = initializeSheet(source);
  const frames = [];
  let theta = 0;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let attempt = 0; attempt < source.moveAttemptsPerFrame; attempt += 1) {
      attemptMove(state, rng, source);
    }
    advanceMoves(state, source);
    frames.push(captureFrame(state, frameIndex, theta, source));
    theta += 0.01 * source.spin;
  }
  return deepFreeze({
    schema: "cssflipflop-source-frames@1",
    bankId: source.id,
    seed,
    sourceFrameCount: frames.length,
    frameMilliseconds: CSSFLIPFLOP_FRAME_MILLISECONDS,
    source,
    frames,
  });
}

export function buildFlipFlopPresentationFrames(sourceState) {
  if (sourceState?.schema !== "cssflipflop-source-frames@1" || sourceState.frames.length < 2) {
    throw new TypeError("Flip Flop presentation requires prepared source frames");
  }
  const forward = sourceState.frames;
  const reverse = forward.slice(0, -1).reverse();
  const states = [...forward, ...reverse];
  return deepFreeze({
    schema: "cssflipflop-presentation-frames@1",
    sourceFrameCount: forward.length,
    frameCount: states.length,
    frameMilliseconds: sourceState.frameMilliseconds,
    durationMilliseconds: states.length * sourceState.frameMilliseconds,
    sourceBoundaryFrameIndex: forward.length - 1,
    sourceAuthority: Object.freeze({ start: 0, end: forward.length - 1 }),
    presentationEnvelope: "prepared-exact-state-rewind",
    frames: states.map((state, frameIndex) => Object.freeze({ ...state, frameIndex })),
  });
}

export function buildFlipFlopTileGeometry() {
  return deepFreeze(SOURCE_FACES.map((face, faceIndex) => {
    const vertices = face.vertices.map(sourceVertexToPolyWorld);
    const plan = computeTextureAtlasPlanPublic({ vertices, color: "#ffffff" }, faceIndex, {
      tileSize: 1,
      layerElevation: 1,
      seamBleed: 0,
    });
    if (!plan || typeof plan.matrix !== "string" || plan.canvasW <= 0 || plan.canvasH <= 0) {
      throw new Error(`Flip Flop ${face.id} face did not resolve to a retained quad`);
    }
    const matrix = scaleLocalAxes(plan.matrix.split(",").map(Number), face.width, face.height);
    return Object.freeze({
      id: face.id,
      vertices: Object.freeze(vertices.map((vertex) => Object.freeze(vertex))),
      matrix: Object.freeze(matrix),
      width: face.width,
      height: face.height,
      sourceVertexIndices: Object.freeze(sourceVertexIndicesByLeafCorner(face, matrix)),
    });
  }));
}

function scaleLocalAxes(matrix, width, height) {
  return matrix.map((value, index) => index < 4
    ? value * width
    : index < 8
      ? value * height
      : value);
}

function sourceVertexIndicesByLeafCorner(face, matrix) {
  const sourceCssVertices = face.vertices.map(([x, y, z]) => [x, -y, z]);
  const corners = [
    transformPoint(matrix, [0, 0, 0]),
    transformPoint(matrix, [1, 0, 0]),
    transformPoint(matrix, [1, 1, 0]),
    transformPoint(matrix, [0, 1, 0]),
  ];
  return corners.map((corner) => {
    const distances = sourceCssVertices.map((vertex) =>
      Math.hypot(...vertex.map((value, index) => value - corner[index])));
    const index = distances.indexOf(Math.min(...distances));
    if (distances[index] > 0.000001) throw new Error(`Flip Flop ${face.id} raster corner drifted`);
    return index;
  });
}

export function flipFlopColorRows() {
  return COLOR_ROWS;
}

export function flipFlopFaceLightLevel(frame, tile, faceIndex) {
  const face = SOURCE_FACES[faceIndex];
  if (!face) throw new RangeError("Flip Flop face index is out of range");
  const source = resolveFlipFlopBank(frame.bankId);
  const modelView = sourceModelViewMatrix(frame.theta, tile, source);
  const normal = normalize(transformDirection(modelView, face.normal));
  const intensity = face.vertices.reduce((sum, vertex) =>
    sum + sourceVertexLightIntensity(transformPoint(modelView, vertex), normal, source), 0) /
    face.vertices.length;
  return Math.round(clamp01(intensity) * (CSSFLIPFLOP_LIGHT_LEVELS - 1));
}

export function flipFlopFaceLightProfile(frame, tile, faceIndex, sourceVertexIndices) {
  const face = SOURCE_FACES[faceIndex];
  if (!face || !Array.isArray(sourceVertexIndices) || sourceVertexIndices.length !== 4) {
    throw new RangeError("Flip Flop lighting profile needs one prepared source quad");
  }
  const source = resolveFlipFlopBank(frame.bankId);
  const modelView = sourceModelViewMatrix(frame.theta, tile, source);
  const normal = normalize(transformDirection(modelView, face.normal));
  const sourceLevels = face.vertices.map((vertex) =>
    clamp01(sourceVertexLightIntensity(transformPoint(modelView, vertex), normal, source)));
  const [topLeft, topRight, bottomRight, bottomLeft] = sourceVertexIndices.map((index) => sourceLevels[index]);
  const center = (topLeft + topRight + bottomRight + bottomLeft) / 4;
  const gradientX = (topRight + bottomRight - topLeft - bottomLeft) / 2;
  const gradientY = (bottomLeft + bottomRight - topLeft - topRight) / 2;
  const magnitude = Math.hypot(gradientX, gradientY);
  const magnitudeIndex = magnitude < 0.025 ? 0 : magnitude < 0.085 ? 1 : 2;
  const direction = Math.abs(gradientX) >= Math.abs(gradientY)
    ? gradientX >= 0 ? 0 : 2
    : gradientY >= 0 ? 1 : 3;
  const level = Math.round(center * (CSSFLIPFLOP_LIGHT_LEVELS - 1));
  return ((level * CSSFLIPFLOP_LIGHT_MAGNITUDES.length) + magnitudeIndex) *
    CSSFLIPFLOP_LIGHT_DIRECTIONS + direction;
}

export function sourceTileColorIndex(x, z) {
  const mod = ((x + z) % 3 + 3) % 3;
  return mod === 0 ? 0 : mod === 1 ? 1 : 2;
}

function initializeSheet(source) {
  const occupied = new Int16Array(source.boardWidth * source.boardDepth);
  occupied.fill(-1);
  const tiles = [];
  let index = 0;
  for (let x = 0; x < source.boardWidth; x += 1) {
    for (let z = 0; z < source.boardDepth; z += 1) {
      if (index >= source.tileCount) continue;
      occupied[cellIndex(x, z, source)] = index;
      tiles.push({ index, x, z, direction: 0, angle: 0, colorIndex: sourceTileColorIndex(x, z) });
      index += 1;
    }
  }
  if (tiles.length !== source.tileCount) throw new Error(`Flip Flop ${source.id} tile census drifted`);
  return { occupied, tiles };
}

function attemptMove(state, rng, source) {
  const tile = state.tiles[rng.random() % source.tileCount];
  const direction = (rng.random() % 4) + 1;
  if (tile.direction !== 0) return false;
  const [dx, dz] = direction === 1 ? [1, 0]
    : direction === 2 ? [0, 1]
      : direction === 3 ? [-1, 0]
        : [0, -1];
  const nextX = tile.x + dx;
  const nextZ = tile.z + dz;
  if (nextX < 0 || nextX >= source.boardWidth ||
      nextZ < 0 || nextZ >= source.boardDepth ||
      state.occupied[cellIndex(nextX, nextZ, source)] !== -1) return false;
  tile.direction = direction;
  state.occupied[cellIndex(nextX, nextZ, source)] = tile.index;
  state.occupied[cellIndex(tile.x, tile.z, source)] = -1;
  return true;
}

function advanceMoves(state, source) {
  const increment = source.flipsPerFrame * Math.PI;
  for (const tile of state.tiles) {
    if (tile.direction === 0) continue;
    tile.angle += increment;
    if (tile.angle < Math.PI) continue;
    if (tile.direction === 1) tile.x += 1;
    else if (tile.direction === 2) tile.z += 1;
    else if (tile.direction === 3) tile.x -= 1;
    else tile.z -= 1;
    tile.direction = 0;
    tile.angle = 0;
  }
}

function captureFrame(state, frameIndex, theta, source) {
  return Object.freeze({
    bankId: source.id,
    frameIndex,
    theta,
    boardMatrix: Object.freeze(boardMatrix(theta, source)),
    tiles: Object.freeze(state.tiles.map((tile) => Object.freeze({
      index: tile.index,
      x: tile.x,
      z: tile.z,
      direction: tile.direction,
      angle: tile.angle,
      colorIndex: tile.colorIndex,
      matrix: Object.freeze(tileMatrix(tile)),
    }))),
  });
}

function boardMatrix(theta, source) {
  const center = translation(
    -source.boardWidth / 2,
    0,
    -source.boardDepth / 2,
  );
  const yaw = rotationY(theta * 100 * Math.PI / 180);
  const tilt = rotationX(-22.5 * Math.PI / 180);
  return roundedMatrix(multiply(
    uniformScale(CSSFLIPFLOP_PIXELS_PER_SOURCE_UNIT),
    multiply(tilt, multiply(yaw, center)),
  ));
}

function tileMatrix(tile) {
  let matrix = translation(tile.x, 0, tile.z);
  if (tile.direction === 1) {
    matrix = multiply(translation(tile.x + 1, 0, tile.z), rotationZ(tile.angle - Math.PI));
  } else if (tile.direction === 2) {
    matrix = multiply(translation(tile.x, 0, tile.z + 1), rotationX(Math.PI - tile.angle));
  } else if (tile.direction === 3) {
    matrix = multiply(matrix, rotationZ(-tile.angle));
  } else if (tile.direction === 4) {
    matrix = multiply(matrix, rotationX(tile.angle));
  }
  return roundedMatrix(matrix);
}

function sourceModelViewMatrix(theta, tile, source) {
  return multiply(
    translation(0, 0, -source.boardAverageSize),
    multiply(
      rotationX(22.5 * Math.PI / 180),
      multiply(
        rotationY(theta * 100 * Math.PI / 180),
        multiply(
          translation(-source.boardWidth / 2, 0, -source.boardDepth / 2),
          sourceTileMatrix(tile),
        ),
      ),
    ),
  );
}

function sourceTileMatrix(tile) {
  let matrix = translation(tile.x, 0, tile.z);
  if (tile.direction === 1) {
    matrix = multiply(translation(tile.x + 1, 0, tile.z), rotationZ(Math.PI - tile.angle));
  } else if (tile.direction === 2) {
    matrix = multiply(translation(tile.x, 0, tile.z + 1), rotationX(tile.angle - Math.PI));
  } else if (tile.direction === 3) {
    matrix = multiply(matrix, rotationZ(tile.angle));
  } else if (tile.direction === 4) {
    matrix = multiply(matrix, rotationX(-tile.angle));
  }
  return matrix;
}

function sourceVertexLightIntensity(vertex, normal, source) {
  const light = [0, source.boardAverageSize * 0.3, 0];
  const delta = light.map((value, index) => value - vertex[index]);
  const distance = Math.hypot(...delta);
  const direction = delta.map((value) => value / distance);
  const diffuse = Math.max(0, normal.reduce((sum, value, index) => sum + value * direction[index], 0));
  const attenuation = 1 / (
    1.2 +
    (0.15 / source.boardAverageSize) * distance +
    (0.15 / source.boardAverageSize) * distance * distance
  );
  return 0.2 + attenuation * (0.8 + diffuse);
}

function transformPoint(matrix, point) {
  return [0, 1, 2].map((row) =>
    matrix[row] * point[0] + matrix[4 + row] * point[1] + matrix[8 + row] * point[2] + matrix[12 + row]);
}

function transformDirection(matrix, direction) {
  return [0, 1, 2].map((row) =>
    matrix[row] * direction[0] + matrix[4 + row] * direction[1] + matrix[8 + row] * direction[2]);
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function sourceVertexToPolyWorld([x, y, z]) {
  return [-y, x, z];
}

function cellIndex(x, z, source) {
  return x * source.boardDepth + z;
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
  });
}

function rotateLeft(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function translation(x, y, z) {
  const matrix = identity();
  matrix[12] = x;
  matrix[13] = y;
  matrix[14] = z;
  return matrix;
}

function uniformScale(value) {
  return [value, 0, 0, 0, 0, value, 0, 0, 0, 0, value, 0, 0, 0, 0, 1];
}

function rotationX(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

function rotationY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function rotationZ(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(left, right) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        result[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
      }
    }
  }
  return result;
}

function roundedMatrix(matrix) {
  return matrix.map((value) => {
    const rounded = Number(value.toFixed(7));
    return Object.is(rounded, -0) ? 0 : rounded;
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
