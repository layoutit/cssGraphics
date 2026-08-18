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

const SQRT_2_4 = Math.SQRT2 / 4;
const SQRT_2_2 = Math.SQRT1_2;
const SQRT_3_2 = Math.sqrt(3) / 2;
const COS_36 = Math.cos(Math.PI / 5);
const SIN_36 = Math.sin(Math.PI / 5);
const COS_72 = Math.cos(2 * Math.PI / 5);
const SIN_72 = Math.sin(2 * Math.PI / 5);
const DODECA_ICOSA_IN_RADIUS = (3 + Math.sqrt(5)) / 4;
const SOURCE_ORDER = Object.freeze([
  "icosahedron",
  "dodecahedron",
  "hexahedron",
  "octahedron",
  "tetrahedron",
]);
const LIGHT_DIRECTION = normalize([1, 1, 1]);
const LIGHT_HALF_VECTOR = normalize([LIGHT_DIRECTION[0], LIGHT_DIRECTION[1], LIGHT_DIRECTION[2] + 1]);

export const CSSPLATONIC_FRAME_MILLISECONDS = 25;
export const CSSPLATONIC_LIGHT_LEVELS = 64;
export const CSSPLATONIC_RASTER_LEAF_SIZE = 64;
export const CSSPLATONIC_SEED = 26081705;

export const PLATONIC_SOURCE = Object.freeze({
  commit: "906693799e4fb7581436590cf84ecb2d3c9186ba",
  primaryPath: "hacks/glx/platonicfolding.c",
  primarySha256: "2c2c31987b09941814000f2c1dbbfee8f92f7fa1a82fca120c2c57c03e03057d",
  configPath: "hacks/config/platonicfolding.xml",
  configSha256: "2fb097c5365aba8b3510c355b3b81695177275ef3d4a0d4c3fd1c0bd38df759f",
  delayMicroseconds: 25_000,
  appearFrames: 181,
  hingeFrames: 90,
  disappearFrames: 181,
  fieldOfViewDegrees: 45,
});

export const PLATONIC_BANKS = Object.freeze({
  desktop: Object.freeze({
    ...PLATONIC_SOURCE,
    id: "desktop",
    name: "Platonic Folding",
    entryAxis: "vertical",
    eyeDistanceScale: 1,
  }),
  mobile: Object.freeze({
    ...PLATONIC_SOURCE,
    id: "mobile",
    name: "Platonic Folding",
    entryAxis: "horizontal",
    eyeDistanceScale: 1.55,
  }),
});

const SOLIDS = Object.freeze({
  tetrahedron: solid({
    id: "tetrahedron",
    faceCount: 4,
    eyeDistance: 6,
    maximumAngle: 109.4712206344907,
    vertices: [
      [1, 0, -SQRT_2_4],
      [-0.5, SQRT_3_2, -SQRT_2_4],
      [-0.5, -SQRT_3_2, -SQRT_2_4],
    ],
    edges: [
      [0, 1, 0, 0], [0, 2, 2, 0], [0, 3, 1, 0],
      [1, 2, 1, 2], [1, 3, 2, 1], [2, 3, 1, 2],
    ],
  }),
  hexahedron: solid({
    id: "hexahedron",
    faceCount: 6,
    eyeDistance: 6,
    maximumAngle: 90,
    vertices: [
      [SQRT_2_2, -SQRT_2_2, -SQRT_2_2],
      [SQRT_2_2, SQRT_2_2, -SQRT_2_2],
      [-SQRT_2_2, SQRT_2_2, -SQRT_2_2],
      [-SQRT_2_2, -SQRT_2_2, -SQRT_2_2],
    ],
    edges: [
      [0, 1, 0, 0], [0, 2, 1, 0], [0, 3, 2, 0], [0, 4, 3, 0],
      [1, 2, 3, 1], [1, 4, 1, 3], [1, 5, 2, 0], [2, 3, 3, 1],
      [2, 5, 2, 3], [3, 4, 3, 1], [3, 5, 2, 2], [4, 5, 2, 1],
    ],
  }),
  octahedron: solid({
    id: "octahedron",
    faceCount: 8,
    eyeDistance: 6,
    maximumAngle: 70.5287793655093,
    vertices: [
      [1, 0, -SQRT_2_2],
      [-0.5, SQRT_3_2, -SQRT_2_2],
      [-0.5, -SQRT_3_2, -SQRT_2_2],
    ],
    edges: [
      [0, 1, 0, 0], [0, 2, 1, 0], [0, 3, 2, 0], [1, 4, 1, 2],
      [1, 5, 2, 1], [2, 5, 1, 0], [2, 6, 2, 0], [3, 4, 2, 0],
      [3, 6, 1, 2], [4, 7, 1, 1], [5, 7, 2, 0], [6, 7, 1, 2],
    ],
  }),
  dodecahedron: solid({
    id: "dodecahedron",
    faceCount: 12,
    eyeDistance: 12,
    maximumAngle: 63.434948822922,
    vertices: [
      [1, 0, -DODECA_ICOSA_IN_RADIUS],
      [COS_72, SIN_72, -DODECA_ICOSA_IN_RADIUS],
      [-COS_36, SIN_36, -DODECA_ICOSA_IN_RADIUS],
      [-COS_36, -SIN_36, -DODECA_ICOSA_IN_RADIUS],
      [COS_72, -SIN_72, -DODECA_ICOSA_IN_RADIUS],
    ],
    edges: [
      [0, 1, 0, 0], [0, 2, 1, 4], [0, 3, 2, 0], [0, 4, 3, 3], [0, 5, 4, 1],
      [1, 2, 4, 0], [1, 5, 1, 0], [1, 6, 2, 0], [1, 7, 3, 0],
      [2, 3, 3, 1], [2, 7, 1, 4], [2, 8, 2, 2], [3, 4, 4, 4],
      [3, 8, 2, 1], [3, 9, 3, 0], [4, 5, 2, 2], [4, 9, 0, 4],
      [4, 10, 1, 4], [5, 6, 4, 1], [5, 10, 3, 3], [6, 7, 4, 1],
      [6, 10, 2, 2], [6, 11, 3, 3], [7, 8, 3, 3], [7, 11, 2, 2],
      [8, 9, 0, 1], [8, 11, 4, 1], [9, 10, 3, 0], [9, 11, 2, 0],
      [10, 11, 1, 4],
    ],
  }),
  icosahedron: solid({
    id: "icosahedron",
    faceCount: 20,
    eyeDistance: 12,
    maximumAngle: 41.8103148957786,
    vertices: [
      [1, 0, -DODECA_ICOSA_IN_RADIUS],
      [-0.5, SQRT_3_2, -DODECA_ICOSA_IN_RADIUS],
      [-0.5, -SQRT_3_2, -DODECA_ICOSA_IN_RADIUS],
    ],
    edges: [
      [0, 1, 2, 0], [0, 2, 0, 0], [0, 3, 1, 0], [1, 4, 2, 0],
      [1, 9, 1, 0], [2, 5, 1, 2], [2, 6, 2, 1], [3, 7, 1, 0],
      [3, 8, 2, 0], [4, 5, 2, 0], [4, 10, 1, 0], [5, 15, 1, 2],
      [6, 7, 0, 1], [6, 14, 2, 1], [7, 13, 2, 0], [8, 9, 2, 1],
      [8, 12, 1, 2], [9, 11, 2, 1], [10, 11, 1, 0], [10, 18, 2, 0],
      [11, 17, 2, 1], [12, 13, 0, 2], [12, 17, 1, 2], [13, 16, 1, 0],
      [14, 15, 2, 1], [14, 16, 0, 1], [15, 18, 0, 2], [16, 19, 2, 0],
      [17, 19, 0, 2], [18, 19, 1, 1],
    ],
  }),
});

export function resolvePlatonicBank(bankId) {
  const bank = PLATONIC_BANKS[bankId];
  if (!bank) throw new RangeError(`Unknown Platonic Folding bank: ${bankId}`);
  return bank;
}

export function platonicSolids() {
  return SOURCE_ORDER.map((id) => SOLIDS[id]);
}

export function buildPlatonicSourceSequence({ bankId = "desktop", seed = CSSPLATONIC_SEED } = {}) {
  const bank = resolvePlatonicBank(bankId);
  const rng = createYaRandom(seed);
  const solids = SOURCE_ORDER.map((solidId, sequenceIndex) => {
    const definition = SOLIDS[solidId];
    const colorMatrix = randomRotationMatrix(rng);
    const tree = createUnfoldingTree(definition, rng);
    const faceColors = buildFaceColors(definition, tree, colorMatrix);
    return Object.freeze({
      definition,
      tree,
      faceColors,
      alpha: sequenceIndex % 2 === 0 ? 300 : 120,
      initialDelta: rng.frand(360),
      deltaStep: sequenceIndex % 2 === 0 ? 0.5 : -0.5,
    });
  });
  const faceDefinitions = [];
  let faceColumn = 0;
  for (const entry of solids) {
    const box = polygonBounds(entry.definition.vertices);
    for (let faceIndex = 0; faceIndex < entry.definition.faceCount; faceIndex += 1) {
      faceDefinitions.push({
        id: `${entry.definition.id}-face-${String(faceIndex).padStart(2, "0")}`,
        solidId: entry.definition.id,
        faceIndex,
        faceColumn,
        vertices: entry.definition.vertices,
        bounds: box,
        color: entry.faceColors[faceIndex],
        lightPalette: null,
      });
      faceColumn += 1;
    }
  }
  const frames = [];
  for (const entry of solids) appendSolidFrames(frames, entry, bank);
  prepareLightingStates(faceDefinitions, frames);
  return deepFreeze({
    schema: "cssplatonicfolding-source-sequence@1",
    bank,
    seed,
    faceDefinitions,
    frames,
    durationMilliseconds: frames.length * CSSPLATONIC_FRAME_MILLISECONDS,
  });
}

function appendSolidFrames(frames, entry, bank) {
  const { definition } = entry;
  const eyeDistance = definition.eyeDistance * bank.eyeDistanceScale;
  const travel = eyeDistance * 2 / 3;
  const start = bank.entryAxis === "horizontal" ? [-travel, 0, 0] : [0, -travel, 0];
  const finish = bank.entryAxis === "horizontal" ? [travel, 0, 0] : [0, travel, 0];
  let solidFrame = 0;
  for (let step = 0; step < PLATONIC_SOURCE.appearFrames; step += 1) {
    const t = easeDecelerate(step / (PLATONIC_SOURCE.appearFrames - 1));
    pushFrame(frames, entry, solidFrame, mix3(start, [0, 0, 0], t), definition.maximumAngle, eyeDistance);
    solidFrame += 1;
  }
  for (let step = 1; step <= PLATONIC_SOURCE.hingeFrames; step += 1) {
    pushFrame(frames, entry, solidFrame, [0, 0, 0], definition.maximumAngle *
      (1 - step / PLATONIC_SOURCE.hingeFrames), eyeDistance);
    solidFrame += 1;
  }
  for (let step = 1; step <= PLATONIC_SOURCE.hingeFrames; step += 1) {
    pushFrame(frames, entry, solidFrame, [0, 0, 0], definition.maximumAngle *
      (step / PLATONIC_SOURCE.hingeFrames), eyeDistance);
    solidFrame += 1;
  }
  for (let step = 0; step < PLATONIC_SOURCE.disappearFrames; step += 1) {
    const t = easeAccelerate(step / (PLATONIC_SOURCE.disappearFrames - 1));
    pushFrame(frames, entry, solidFrame, mix3([0, 0, 0], finish, t), definition.maximumAngle, eyeDistance);
    solidFrame += 1;
  }
}

function pushFrame(frames, entry, solidFrame, position, rawAngle, eyeDistance) {
  const angles = Array(entry.definition.faceCount - 1).fill(rawAngle);
  const poses = computeFacePoses(entry.definition, entry.tree, angles);
  const rotation = multiply4(rotationX(entry.alpha), rotationZ(
    entry.initialDelta + solidFrame * entry.deltaStep,
  ));
  const sourceModel = multiply4(translation([
    position[0],
    position[1],
    -eyeDistance,
  ]), rotation);
  const faceCenter = polygonCenter(entry.definition.vertices);
  const modelMatrix = multiply4(scale4([1, -1, 1]), sourceModel);
  frames.push({
    timeMs: frames.length * CSSPLATONIC_FRAME_MILLISECONDS,
    solidId: entry.definition.id,
    modelMatrix: flattenCss(modelMatrix),
    faces: poses.map((pose, faceIndex) => ({
      faceIndex,
      matrix: flattenCss(pose),
      lightColor: lightColorForPose(entry.faceColors[faceIndex], faceCenter, pose, sourceModel),
      lightRow: -1,
    })),
  });
}

function buildFaceColors(definition, tree, colorMatrix) {
  const poses = computeFacePoses(
    definition,
    tree,
    Array(definition.faceCount - 1).fill(definition.maximumAngle),
  );
  return Object.freeze(poses.map((pose) => {
    const center = [0, 0, 0];
    for (const vertex of definition.vertices) {
      const transformed = transformPoint(pose, vertex);
      center[0] += transformed[0];
      center[1] += transformed[1];
      center[2] += transformed[2];
    }
    const rotated = normalize(transformDirection(colorMatrix, center));
    return Object.freeze(rotated.map((value) => (value + 1) / 2));
  }));
}

function computeFacePoses(definition, tree, angles) {
  const poses = Array(definition.faceCount);
  const visit = (node, parentPose) => {
    let pose = parentPose;
    if (node.parent !== null) {
      const easedAngle = easeQuintic(angles[node.foldAngleIndex], definition.maximumAngle);
      const fold = foldRotation(node, definition.vertices, easedAngle);
      pose = multiply4(parentPose, multiply4(fold, node.unfoldPose));
    }
    poses[node.face] = pose;
    for (const child of node.children) visit(child, pose);
  };
  visit(tree, identity4());
  return poses;
}

function foldRotation(node, vertices, angle) {
  const first = transformPoint(node.unfoldPose, vertices[node.edgeSelf]);
  const second = transformPoint(node.unfoldPose, vertices[(node.edgeSelf + 1) % vertices.length]);
  const midpoint = mix3(first, second, 0.5);
  const axis = normalize(sub3(second, first));
  const radial = normalize([midpoint[0], midpoint[1], 0]);
  const basis = identity4();
  for (let row = 0; row < 3; row += 1) {
    basis[row][0] = radial[row];
    basis[row][1] = row === 2 ? 1 : 0;
    basis[row][2] = axis[row];
  }
  return multiply4(
    translation(midpoint),
    multiply4(basis, multiply4(rotationZ(angle), multiply4(transpose4(basis), translation(midpoint.map((v) => -v))))),
  );
}

function createUnfoldingTree(definition, rng) {
  const edges = definition.edges.map(([src, dst, edgeSrc, edgeDst]) => ({
    src,
    dst,
    edgeSrc,
    edgeDst,
    weight: rng.frand(1),
  })).sort((left, right) => left.weight - right.weight);
  const parent = Array.from({ length: definition.faceCount }, (_, index) => index);
  const rank = Array(definition.faceCount).fill(0);
  const selected = [];
  for (const edge of edges) {
    const srcRoot = findRoot(parent, edge.src);
    const dstRoot = findRoot(parent, edge.dst);
    if (srcRoot === dstRoot) continue;
    selected.push(edge);
    unionRoots(parent, rank, srcRoot, dstRoot);
    if (selected.length === definition.faceCount - 1) break;
  }
  const adjacency = Array.from({ length: definition.faceCount }, () => []);
  for (const edge of selected) {
    adjacency[edge.dst].unshift({ face: edge.src, edgeParent: edge.edgeDst, edgeSelf: edge.edgeSrc });
    adjacency[edge.src].unshift({ face: edge.dst, edgeParent: edge.edgeSrc, edgeSelf: edge.edgeDst });
  }
  let foldAngleIndex = 0;
  const build = (face, parentFace, edgeParent = -1, edgeSelf = -1) => {
    const node = {
      face,
      parent: parentFace,
      edgeParent,
      edgeSelf,
      foldAngleIndex: parentFace === null ? -1 : foldAngleIndex++,
      unfoldPose: identity4(),
      children: [],
    };
    node.unfoldPose = parentFace === null
      ? identity4()
      : unfoldingPose(definition.vertices, edgeParent, edgeSelf);
    node.children = adjacency[face]
      .filter((entry) => entry.face !== parentFace)
      .map((entry) => build(entry.face, face, entry.edgeParent, entry.edgeSelf));
    return node;
  };
  return deepFreeze(build(0, null));
}

function unfoldingPose(vertices, edgeParent, edgeSelf) {
  const parentFirst = vertices[edgeParent];
  const parentSecond = vertices[(edgeParent + 1) % vertices.length];
  const selfFirst = vertices[edgeSelf];
  const selfSecond = vertices[(edgeSelf + 1) % vertices.length];
  const parentDirection = normalize(sub3(parentSecond, parentFirst));
  const selfDirection = normalize(sub3(selfFirst, selfSecond));
  const crossZ = selfDirection[0] * parentDirection[1] - selfDirection[1] * parentDirection[0];
  const dot = selfDirection[0] * parentDirection[0] + selfDirection[1] * parentDirection[1];
  const angle = Math.atan2(crossZ, dot) * 180 / Math.PI;
  const midpoint = mix3(parentFirst, parentSecond, 0.5);
  return multiply4(translation([midpoint[0] * 2, midpoint[1] * 2, 0]), rotationZ(angle));
}

function lightColorForPose(baseColor, faceCenter, pose, sourceModel) {
  const modelPose = multiply4(sourceModel, pose);
  let normal = normalize(transformDirection(modelPose, [0, 0, 1]));
  const center = transformPoint(modelPose, faceCenter);
  if (dot3(normal, center.map((value) => -value)) < 0) {
    normal = normal.map((value) => -value);
  }
  const diffuse = Math.max(0, dot3(normal, LIGHT_DIRECTION));
  const specular = diffuse === 0
    ? 0
    : 0.75 * Math.pow(Math.max(0, dot3(normal, LIGHT_HALF_VECTOR)), 30);
  return baseColor.map((channel) => Math.min(1, channel * (0.5 + 0.7 * diffuse) + specular));
}

function polygonCenter(vertices) {
  const center = [0, 0, 0];
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis += 1) center[axis] += vertex[axis];
  }
  return center.map((value) => value / vertices.length);
}

function prepareLightingStates(faceDefinitions, frames) {
  for (const face of faceDefinitions) {
    const samples = frames
      .filter((frame) => frame.solidId === face.solidId)
      .map((frame) => frame.faces[face.faceIndex].lightColor);
    face.lightPalette = clusterColors(samples, CSSPLATONIC_LIGHT_LEVELS);
    for (const frame of frames) {
      if (frame.solidId !== face.solidId) continue;
      const sample = frame.faces[face.faceIndex];
      sample.lightRow = nearestColorIndex(sample.lightColor, face.lightPalette);
    }
  }
}

function clusterColors(samples, count) {
  const unique = [];
  const keys = new Set();
  for (const sample of samples) {
    const key = sample.map((value) => value.toFixed(10)).join(",");
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(sample);
  }
  const centers = [unique[0].slice()];
  while (centers.length < Math.min(count, unique.length)) {
    let selected = unique[0];
    let selectedDistance = -1;
    for (const sample of unique) {
      const distance = Math.min(...centers.map((center) => colorDistanceSquared(sample, center)));
      if (distance > selectedDistance) {
        selected = sample;
        selectedDistance = distance;
      }
    }
    centers.push(selected.slice());
  }
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const sums = centers.map(() => [0, 0, 0]);
    const weights = centers.map(() => 0);
    for (const sample of samples) {
      const index = nearestColorIndex(sample, centers);
      weights[index] += 1;
      for (let channel = 0; channel < 3; channel += 1) sums[index][channel] += sample[channel];
    }
    let changed = false;
    for (let index = 0; index < centers.length; index += 1) {
      if (weights[index] === 0) continue;
      const next = sums[index].map((value) => value / weights[index]);
      if (colorDistanceSquared(next, centers[index]) > 1e-16) changed = true;
      centers[index] = next;
    }
    if (!changed) break;
  }
  centers.sort((left, right) => {
    const lightness = left[0] + left[1] + left[2] - right[0] - right[1] - right[2];
    if (lightness !== 0) return lightness;
    for (let channel = 0; channel < 3; channel += 1) {
      if (left[channel] !== right[channel]) return left[channel] - right[channel];
    }
    return 0;
  });
  while (centers.length < count) centers.push(centers.at(-1).slice());
  return centers;
}

function nearestColorIndex(color, palette) {
  let nearest = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index < palette.length; index += 1) {
    const distance = colorDistanceSquared(color, palette[index]);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function colorDistanceSquared(left, right) {
  let distance = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const delta = left[channel] - right[channel];
    distance += delta * delta;
  }
  return distance;
}

function solid(value) {
  return deepFreeze({
    ...value,
    vertices: value.vertices.map((vertex) => Object.freeze(vertex)),
    edges: value.edges.map((edge) => Object.freeze(edge)),
  });
}

function polygonBounds(vertices) {
  const xs = vertices.map((vertex) => vertex[0]);
  const ys = vertices.map((vertex) => vertex[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return Object.freeze({ minX, minY, width: maxX - minX, height: maxY - minY });
}

function createYaRandom(seed) {
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

function randomRotationMatrix(rng) {
  const theta = rng.frand(2 * Math.PI);
  const phi = rng.frand(2 * Math.PI);
  const z = rng.frand(2);
  const radius = Math.sqrt(z);
  const vx = radius * Math.sin(phi);
  const vy = radius * Math.cos(phi);
  const vz = Math.sqrt(2 - z);
  const sine = Math.sin(theta);
  const cosine = Math.cos(theta);
  const sx = vx * cosine - vy * sine;
  const sy = vx * sine + vy * cosine;
  const matrix = identity4();
  matrix[0][0] = vx * sx - cosine;
  matrix[0][1] = vx * sy - sine;
  matrix[0][2] = vx * vz;
  matrix[1][0] = vy * sx + sine;
  matrix[1][1] = vy * sy - cosine;
  matrix[1][2] = vy * vz;
  matrix[2][0] = vz * sx;
  matrix[2][1] = vz * sy;
  matrix[2][2] = 1 - z;
  return matrix;
}

function findRoot(parent, value) {
  if (parent[value] !== value) parent[value] = findRoot(parent, parent[value]);
  return parent[value];
}

function unionRoots(parent, rank, left, right) {
  if (rank[left] < rank[right]) parent[left] = right;
  else if (rank[left] > rank[right]) parent[right] = left;
  else {
    parent[right] = left;
    rank[left] += 1;
  }
}

function identity4() {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

function multiply4(left, right) {
  return left.map((row) => right[0].map((_, column) =>
    row.reduce((sum, value, index) => sum + value * right[index][column], 0)));
}

function transpose4(matrix) {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
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

function rotationX(degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    [1, 0, 0, 0],
    [0, cosine, -sine, 0],
    [0, sine, cosine, 0],
    [0, 0, 0, 1],
  ];
}

function rotationZ(degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    [cosine, -sine, 0, 0],
    [sine, cosine, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

function transformPoint(matrix, [x, y, z]) {
  return [
    matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z + matrix[0][3],
    matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z + matrix[1][3],
    matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z + matrix[2][3],
  ];
}

function transformDirection(matrix, [x, y, z]) {
  return [
    matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z,
    matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z,
    matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z,
  ];
}

function flattenCss(matrix) {
  return Object.freeze(matrix[0].map((_, column) => matrix.map((row) =>
    rounded(row[column]))).flat());
}

function rounded(value) {
  const result = Number(value.toFixed(10));
  return Object.is(result, -0) ? 0 : result;
}

function easeQuintic(value, maximum) {
  const t = value / maximum;
  return maximum * ((6 * t - 15) * t + 10) * t * t * t;
}

function easeAccelerate(value) {
  return value * value * (2 - value);
}

function easeDecelerate(value) {
  return value * (1 + value * (1 - value));
}

function mix3(left, right, t) {
  return left.map((value, index) => value + (right[index] - value) * t);
}

function sub3(left, right) {
  return left.map((value, index) => value - right[index]);
}

function dot3(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return length === 0 ? [...vector] : vector.map((value) => value / length);
}

function rotateLeft(value, count) {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
