import {
  computeTextureAtlasPlanPublic,
  resolvePolyTextureLeafGeometry,
  resolveProjectiveQuadGuards,
} from "@layoutit/polycss";
import {
  clothTriangleMatrixFromWorldPoints,
  CSSCLOTH_CAMERA_POSITION,
  CSSCLOTH_VIEW_BASIS,
  resolveClothTriangleBasis,
  sourceWorldToCssView as transformSourceWorldToCssView,
} from "../../shared/csscloth/clothTriangleTransform.mjs";

export const CSSCLOTH_SOURCE = Object.freeze({
  repository: "https://github.com/mrdoob/three.js",
  tag: "r132",
  revision: "e62b253081438c030d6af1ee3c3346a89124f277",
  primaryPath: "examples/webgl_animation_cloth.html",
  primarySha256: "dfcac0d0942ae045d04d2643384c248e995d7ed0dc86655d2cc338041f95f106",
});
export const CSSCLOTH_LOGO_SOURCE = Object.freeze({
  repository: "https://github.com/CSS-Next/logo.css",
  revision: "48f24dccd4e169118d17bab998c3d276e95167df",
  path: "css.svg",
  sha256: "28dceb38651b6d3d43119bae6f56dc6dd76415cfedd4a718afcd61fc7bec8ba3",
  license: "CC0-1.0",
});

export const CSSCLOTH_SEGMENTS = 10;
export const CSSCLOTH_PARTICLE_COUNT = 121;
export const CSSCLOTH_TRIANGLE_COUNT = 200;
export const CSSCLOTH_MOBILE_SEGMENTS = 6;
export const CSSCLOTH_MOBILE_PARTICLE_COUNT = 49;
export const CSSCLOTH_MOBILE_TRIANGLE_COUNT = 72;
export const CSSCLOTH_RASTER_LEAF_SIZE = 28;
export const CSSCLOTH_GROUND_SOURCE_REPEAT_COUNT = 25;
export const CSSCLOTH_GROUND_REPEAT_COUNT = 14;
export const CSSCLOTH_GROUND_RASTER_WIDTH = 3072;
export const CSSCLOTH_GROUND_RASTER_HEIGHT = 2048;
export const CSSCLOTH_FOG_COLOR = Object.freeze([0xcc, 0xe0, 0xff]);
export const CSSCLOTH_FOG_LEVELS = 64;
export const CSSCLOTH_LIGHT_LEVELS = 9;
export const CSSCLOTH_SHADOW_LIGHT_DIRECTION = Object.freeze(normalize([-50, -200, -100]));
export const CSSCLOTH_SIMULATION_FRAME_MILLISECONDS = 1000 / 60;
export const CSSCLOTH_OUTPUT_FRAME_MILLISECONDS = CSSCLOTH_SIMULATION_FRAME_MILLISECONDS;
export const CSSCLOTH_BANK_FRAME_COUNT = 1440;
export const CSSCLOTH_BANK_COUNT = 8;
export const CSSCLOTH_STREAM_FRAME_COUNT = CSSCLOTH_BANK_FRAME_COUNT * CSSCLOTH_BANK_COUNT;
export const CSSCLOTH_WARMUP_FRAME_COUNT = CSSCLOTH_BANK_FRAME_COUNT;

const DAMPING = 0.03;
const DRAG = 1 - DAMPING;
const MASS = 0.1;
const REST_DISTANCE = 25;
const GRAVITY = 981 * 1.4;
const TIMESTEP = 18 / 1000;
const TIMESTEP_SQUARED = TIMESTEP * TIMESTEP;
const WIND_PHASE_MILLISECONDS = 12_345;
const GRAVITY_FORCE = Object.freeze([0, -GRAVITY * MASS, 0]);
const LIGHT_DIRECTION = normalize([50, 200, 100]);
const CAMERA_POSITION = CSSCLOTH_CAMERA_POSITION;
const VIEW_BASIS = CSSCLOTH_VIEW_BASIS;
const GROUND_WORLD_Y = -250;
const GROUND_FAR_VIEW_Z = -16_000;
const GROUND_NEAR_VIEW_Z = -1_000;
const GROUND_HALF_FOV_RADIANS = Math.PI / 12;
const GROUND_ASPECT_COVERAGE = 3;
const FOG_NEAR = 500;
const FOG_FAR = 10_000;
const CLOTH_SEAM_EDGES = buildClothSeamEdges();
const FIXTURE_BOXES = deepFreeze([
  { id: "pole-left", center: [-125, -62, 0], size: [5, 375, 5] },
  { id: "pole-right", center: [125, -62, 0], size: [5, 375, 5] },
  { id: "pole-top", center: [0, 125, 0], size: [255, 5, 5] },
  { id: "foot-left", center: [-125, -250, 0], size: [10, 10, 10] },
  { id: "foot-right", center: [125, -250, 0], size: [10, 10, 10] },
]);

export function buildClothSourceFrames({
  frameCount = CSSCLOTH_BANK_FRAME_COUNT,
  warmupFrameCount = 0,
  windPhaseMilliseconds = WIND_PHASE_MILLISECONDS,
} = {}) {
  if (!Number.isSafeInteger(frameCount) || frameCount < 2) {
    throw new RangeError("Cloth preparation needs at least two output frames");
  }
  if (!Number.isFinite(windPhaseMilliseconds)) {
    throw new TypeError("Cloth wind phase must be finite");
  }
  if (!Number.isSafeInteger(warmupFrameCount) || warmupFrameCount < 0) {
    throw new RangeError("Cloth preparation needs a non-negative warm-up frame count");
  }
  const triangles = buildClothTriangles();
  const constraints = buildConstraints();
  const particles = buildParticles();
  let normals = Array.from({ length: CSSCLOTH_PARTICLE_COUNT }, () => [0, 0, 1]);
  const frames = [];
  const bankCheckpoints = [];
  for (let step = 0; step < warmupFrameCount + frameCount; step += 1) {
    const now = windPhaseMilliseconds + (step + 1) * CSSCLOTH_SIMULATION_FRAME_MILLISECONDS;
    if (step >= warmupFrameCount &&
        (step - warmupFrameCount) % CSSCLOTH_BANK_FRAME_COUNT === 0) {
      bankCheckpoints.push(captureSimulationCheckpoint(
        particles,
        step - warmupFrameCount,
        windPhaseMilliseconds,
        step + 1,
      ));
    }
    simulateStep(particles, constraints, triangles, normals, now);
    normals = computeSmoothNormals(particles, triangles);
    if (step >= warmupFrameCount) {
      frames.push(captureFrame(particles, normals, triangles, frames.length));
    }
  }
  return deepFreeze({
    schema: "csscloth-source-frames@1",
    frameMilliseconds: CSSCLOTH_OUTPUT_FRAME_MILLISECONDS,
    windPhaseMilliseconds,
    frames,
    triangles,
    bankCheckpoints,
  });
}

export function buildClothSourceFramesFromCheckpoint(checkpoint, frameCount) {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 ||
      !Number.isSafeInteger(checkpoint?.streamFrameOffset) || checkpoint.streamFrameOffset < 0 ||
      !Number.isFinite(checkpoint?.windPhaseMilliseconds) ||
      !Number.isSafeInteger(checkpoint?.nextSimulationStepIndex) ||
      checkpoint.nextSimulationStepIndex < 1 ||
      !Array.isArray(checkpoint?.positions) || checkpoint.positions.length !== CSSCLOTH_PARTICLE_COUNT ||
      !Array.isArray(checkpoint?.previousPositions) ||
      checkpoint.previousPositions.length !== CSSCLOTH_PARTICLE_COUNT) {
    throw new TypeError("Complete Cloth simulation checkpoint is required");
  }
  const triangles = buildClothTriangles();
  const constraints = buildConstraints();
  const particles = buildParticles();
  for (let index = 0; index < particles.length; index += 1) {
    const position = checkpoint.positions[index];
    const previous = checkpoint.previousPositions[index];
    if (!validPoint(position) || !validPoint(previous)) {
      throw new TypeError("Cloth simulation checkpoint contains an invalid particle");
    }
    particles[index].position = [...position];
    particles[index].previous = [...previous];
  }
  let normals = computeSmoothNormals(particles, triangles);
  const frames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const now = checkpoint.windPhaseMilliseconds +
      (checkpoint.nextSimulationStepIndex + frameIndex) *
        CSSCLOTH_SIMULATION_FRAME_MILLISECONDS;
    simulateStep(particles, constraints, triangles, normals, now);
    normals = computeSmoothNormals(particles, triangles);
    frames.push(captureFrame(
      particles,
      normals,
      triangles,
      checkpoint.streamFrameOffset + frameIndex,
    ));
  }
  return deepFreeze({
    schema: "csscloth-checkpoint-source-frames@1",
    frameMilliseconds: CSSCLOTH_OUTPUT_FRAME_MILLISECONDS,
    frames,
    triangles,
  });
}

export function buildClothMobileSourceFrames(source) {
  if (!Array.isArray(source?.frames) || source.frames.length === 0 ||
      !Array.isArray(source?.triangles) || source.triangles.length !== CSSCLOTH_TRIANGLE_COUNT) {
    throw new TypeError("Mobile Cloth preparation needs complete desktop source frames");
  }
  const triangles = buildClothTriangles({ segments: CSSCLOTH_MOBILE_SEGMENTS });
  const frames = source.frames.map((frame) => {
    const positions = new Array(CSSCLOTH_PARTICLE_COUNT);
    const normals = new Array(CSSCLOTH_PARTICLE_COUNT);
    for (let triangleIndex = 0; triangleIndex < source.triangles.length; triangleIndex += 1) {
      const topology = source.triangles[triangleIndex];
      const triangle = frame.triangles[triangleIndex];
      for (let cornerIndex = 0; cornerIndex < 3; cornerIndex += 1) {
        const particle = topology.particleIndices[cornerIndex];
        positions[particle] = triangle.positions[cornerIndex];
        normals[particle] = triangle.normals[cornerIndex];
      }
    }
    const mobilePositions = [];
    const mobileNormals = [];
    for (let v = 0; v <= CSSCLOTH_MOBILE_SEGMENTS; v += 1) {
      for (let u = 0; u <= CSSCLOTH_MOBILE_SEGMENTS; u += 1) {
        const sourceU = u * CSSCLOTH_SEGMENTS / CSSCLOTH_MOBILE_SEGMENTS;
        const sourceV = v * CSSCLOTH_SEGMENTS / CSSCLOTH_MOBILE_SEGMENTS;
        mobilePositions.push(Object.freeze(sampleSourceGrid(positions, sourceU, sourceV)));
        mobileNormals.push(Object.freeze(normalize(sampleSourceGrid(normals, sourceU, sourceV))));
      }
    }
    return Object.freeze({
      frameIndex: frame.frameIndex,
      particlePositions: Object.freeze(mobilePositions),
      triangles: Object.freeze(triangles.map((triangle) => Object.freeze({
        positions: Object.freeze(triangle.particleIndices.map((index) => mobilePositions[index])),
        normals: Object.freeze(triangle.particleIndices.map((index) => mobileNormals[index])),
      }))),
    });
  });
  return deepFreeze({
    ...source,
    schema: "csscloth-mobile-source-frames@1",
    frames,
    triangles,
  });
}

export function buildClothTriangles({
  segments = CSSCLOTH_SEGMENTS,
  sourceSegments = segments,
} = {}) {
  if (!Number.isSafeInteger(segments) || segments < 1 ||
      !Number.isSafeInteger(sourceSegments) || sourceSegments < segments ||
      sourceSegments % segments !== 0) {
    throw new RangeError("Cloth topology needs evenly sampled source segments");
  }
  const sourceStep = sourceSegments / segments;
  const triangles = [];
  for (let v = 0; v < segments; v += 1) {
    for (let u = 0; u < segments; u += 1) {
      const sourceU = u * sourceStep;
      const sourceV = v * sourceStep;
      const a = topologyParticleIndex(sourceU, sourceV, sourceSegments);
      const b = topologyParticleIndex(sourceU + sourceStep, sourceV, sourceSegments);
      const c = topologyParticleIndex(sourceU + sourceStep, sourceV + sourceStep, sourceSegments);
      const d = topologyParticleIndex(sourceU, sourceV + sourceStep, sourceSegments);
      const u0 = u / segments;
      const u1 = (u + 1) / segments;
      const v0 = v / segments;
      const v1 = (v + 1) / segments;
      triangles.push(Object.freeze({
        id: `cloth-${String(triangles.length).padStart(3, "0")}`,
        particleIndices: Object.freeze([a, b, d]),
        uv: Object.freeze([[u0, v0], [u1, v0], [u0, v1]].map(Object.freeze)),
      }));
      triangles.push(Object.freeze({
        id: `cloth-${String(triangles.length).padStart(3, "0")}`,
        particleIndices: Object.freeze([b, c, d]),
        uv: Object.freeze([[u1, v0], [u1, v1], [u0, v1]].map(Object.freeze)),
      }));
    }
  }
  return Object.freeze(triangles);
}

export function clothTriangleMatrix(frame, triangleIndex, seamEdges = CLOTH_SEAM_EDGES) {
  const triangle = frame.triangles[triangleIndex];
  if (!triangle) throw new RangeError("Cloth triangle index is out of range");
  return Object.freeze(clothTriangleMatrixFromWorldPoints(
    triangle.positions,
    triangleIndex,
    seamEdges,
  ));
}

export function clothTriangleBasis(triangleIndex) {
  return resolveClothTriangleBasis(triangleIndex);
}

export function clothTriangleSeamEdges(triangleIndex) {
  const seamEdges = CLOTH_SEAM_EDGES[triangleIndex];
  if (!seamEdges) throw new RangeError("Cloth triangle index is out of range");
  return seamEdges;
}

export function clothTriangleLightState(frame, triangleIndex) {
  const triangle = frame.triangles[triangleIndex];
  if (!triangle) throw new RangeError("Cloth triangle index is out of range");
  const center = triangle.positions.reduce(
    (sum, point) => add(sum, scale(point, 1 / 3)),
    [0, 0, 0],
  );
  const faceNormal = normalize(cross(
    subtract(triangle.positions[2], triangle.positions[1]),
    subtract(triangle.positions[0], triangle.positions[1]),
  ));
  const faceSign = dot3(faceNormal, subtract(CAMERA_POSITION, center)) >= 0 ? 1 : -1;
  return Object.freeze(triangle.normals.map((normal) => Math.round(
    Math.max(0, faceSign * dot3(normal, LIGHT_DIRECTION)) * (CSSCLOTH_LIGHT_LEVELS - 1),
  )));
}

export function clothTriangleFogState(frame, triangleIndex) {
  const triangle = frame.triangles[triangleIndex];
  if (!triangle) throw new RangeError("Cloth triangle index is out of range");
  return Object.freeze(triangle.positions.map((position) => Math.round(
    clothFogFactor(-sourceWorldToCssView(position)[2]) * (CSSCLOTH_FOG_LEVELS - 1),
  )));
}

export function buildClothLightingBank(source) {
  if (!Array.isArray(source?.frames) || source.frames.length === 0 ||
      !Array.isArray(source?.triangles) || source.triangles.length === 0) {
    throw new TypeError("Cloth lighting preparation needs complete source frames and topology");
  }
  const stateMaps = Array.from({ length: source.triangles.length }, () => new Map());
  const states = Array.from({ length: source.triangles.length }, () => []);
  const frameRows = source.frames.map((frame) => Object.freeze(frame.triangles.map((_, triangleIndex) => {
    const state = Object.freeze([
      ...clothTriangleLightState(frame, triangleIndex),
      ...clothTriangleFogState(frame, triangleIndex),
    ]);
    const key = state.join(",");
    let row = stateMaps[triangleIndex].get(key);
    if (row === undefined) {
      row = states[triangleIndex].length;
      if (row > 0xffff) throw new RangeError(`Cloth triangle ${triangleIndex} exceeds the lighting row budget`);
      stateMaps[triangleIndex].set(key, row);
      states[triangleIndex].push(state);
    }
    return row;
  })));
  return deepFreeze({ states, frameRows });
}

export function clothLightColor(level) {
  if (!Number.isSafeInteger(level) || level < 0 || level >= CSSCLOTH_LIGHT_LEVELS) {
    throw new RangeError("Cloth light level is out of range");
  }
  return shadeSourceRgb([1, 1, 1], level / (CSSCLOTH_LIGHT_LEVELS - 1));
}

export function shadeSourceRgb(baseSrgb, dot) {
  const ambient = 0x66 / 255;
  const directional = [0xdf / 255, 0xeb / 255, 1];
  return Object.freeze(baseSrgb.map((channel, index) => linearToSrgb(
    Math.min(1, srgbToLinear(channel) * (ambient + directional[index] * Math.max(0, dot))),
  )));
}

export function shadeGroundSourceRgb(baseSrgb) {
  return shadeSourceRgb(baseSrgb, LIGHT_DIRECTION[1]);
}

export function clothFogFactor(viewDepth) {
  const amount = Math.max(0, Math.min(1, (viewDepth - FOG_NEAR) / (FOG_FAR - FOG_NEAR)));
  return amount * amount * (3 - 2 * amount);
}

export function sourceWorldToCssView(point) {
  return Object.freeze(transformSourceWorldToCssView(point));
}

export function projectClothShadowPoint(point) {
  const distance = (GROUND_WORLD_Y - point[1]) / CSSCLOTH_SHADOW_LIGHT_DIRECTION[1];
  return Object.freeze(sourceWorldToCssView([
    point[0] + CSSCLOTH_SHADOW_LIGHT_DIRECTION[0] * distance,
    GROUND_WORLD_Y + 0.1,
    point[2] + CSSCLOTH_SHADOW_LIGHT_DIRECTION[2] * distance,
  ]));
}

export function clothShadowTriangleMatrix(points) {
  return triangleMatrix(points, CSSCLOTH_RASTER_LEAF_SIZE, CSSCLOTH_RASTER_LEAF_SIZE);
}

export function buildFixtureFaces() {
  return deepFreeze(FIXTURE_BOXES.flatMap((box) => boxFaces(box)));
}

export function buildFixtureShadowCasters() {
  return deepFreeze(FIXTURE_BOXES.map((box) => ({
    id: box.id,
    vertices: Object.values(boxCorners(box)),
  })));
}

export function buildGroundPlane() {
  const view = [GROUND_FAR_VIEW_Z, GROUND_NEAR_VIEW_Z].flatMap((z) => {
    const y = groundViewYAtZ(z);
    const halfWidth = -z * Math.tan(GROUND_HALF_FOV_RADIANS) * GROUND_ASPECT_COVERAGE;
    return [[-halfWidth, y, z], [halfWidth, y, z]];
  });
  const world = view.map(sourceCssViewToWorld);
  return Object.freeze({
    id: "ground",
    world: Object.freeze(world.map(Object.freeze)),
    view: Object.freeze(view.map(Object.freeze)),
    matrix: groundHomographyMatrix(view),
    width: CSSCLOTH_GROUND_RASTER_WIDTH,
    height: CSSCLOTH_GROUND_RASTER_HEIGHT,
  });
}

function groundViewYAtZ(z) {
  return (CAMERA_POSITION[1] - GROUND_WORLD_Y + z * VIEW_BASIS.z[1]) / VIEW_BASIS.y[1];
}

export function sourceCssViewToWorld([x, y, z]) {
  return add(CAMERA_POSITION, add(scale(VIEW_BASIS.x, x), add(
    scale(VIEW_BASIS.y, -y),
    scale(VIEW_BASIS.z, z),
  ))).map(roundMatrix);
}

export function matrixFromQuad(points, primitiveWidth, primitiveHeight = primitiveWidth) {
  return triangleMatrix([points[0], points[1], points[3]], primitiveWidth, primitiveHeight);
}

function simulateStep(particles, constraints, triangles, normals, now) {
  const windStrength = Math.cos(now / 7000) * 20 + 40;
  const wind = normalize([Math.sin(now / 2000), Math.cos(now / 3000), Math.sin(now / 1000)]).map((value) => value * windStrength);
  for (const triangle of triangles) {
    for (const index of triangle.particleIndices) {
      const normal = normalize(normals[index]);
      addForce(particles[index], scale(normal, dot3(normal, wind)));
    }
  }
  for (const particle of particles) {
    addForce(particle, GRAVITY_FORCE);
    const velocity = scale(subtract(particle.position, particle.previous), DRAG);
    const next = add(add(particle.position, velocity), scale(particle.acceleration, TIMESTEP_SQUARED));
    particle.previous = particle.position;
    particle.position = next;
    particle.acceleration = [0, 0, 0];
  }
  for (const [leftIndex, rightIndex] of constraints) {
    const left = particles[leftIndex];
    const right = particles[rightIndex];
    const difference = subtract(right.position, left.position);
    const distance = length(difference);
    if (distance === 0) continue;
    const half = scale(difference, (1 - REST_DISTANCE / distance) * 0.5);
    left.position = add(left.position, half);
    right.position = subtract(right.position, half);
  }
  for (const particle of particles) {
    if (particle.position[1] < -250) particle.position[1] = -250;
  }
  for (let u = 0; u <= CSSCLOTH_SEGMENTS; u += 1) {
    const particle = particles[particleIndex(u, 0)];
    particle.position = [...particle.original];
    particle.previous = [...particle.original];
  }
}

function captureFrame(particles, normals, triangles, frameIndex) {
  const particlePositions = Object.freeze(particles.map((particle) =>
    Object.freeze(particle.position.map(Math.fround))));
  const particleNormals = Object.freeze(normals.map((normal) =>
    Object.freeze(normal.map(Math.fround))));
  return Object.freeze({
    frameIndex,
    particlePositions,
    triangles: Object.freeze(triangles.map((triangle) => Object.freeze({
      positions: Object.freeze(triangle.particleIndices.map((index) => particlePositions[index])),
      normals: Object.freeze(triangle.particleIndices.map((index) => particleNormals[index])),
    }))),
  });
}

function captureSimulationCheckpoint(
  particles,
  streamFrameOffset,
  windPhaseMilliseconds,
  nextSimulationStepIndex,
) {
  return Object.freeze({
    schema: "csscloth-simulation-checkpoint@1",
    streamFrameOffset,
    windPhaseMilliseconds,
    nextSimulationStepIndex,
    positions: Object.freeze(particles.map((particle) =>
      Object.freeze([...particle.position]))),
    previousPositions: Object.freeze(particles.map((particle) =>
      Object.freeze([...particle.previous]))),
  });
}

function validPoint(point) {
  return Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
}

function buildParticles() {
  const particles = [];
  for (let v = 0; v <= CSSCLOTH_SEGMENTS; v += 1) {
    for (let u = 0; u <= CSSCLOTH_SEGMENTS; u += 1) {
      const position = [
        (u / CSSCLOTH_SEGMENTS - 0.5) * REST_DISTANCE * CSSCLOTH_SEGMENTS,
        (v / CSSCLOTH_SEGMENTS + 0.5) * REST_DISTANCE * CSSCLOTH_SEGMENTS,
        0,
      ];
      particles.push({
        position: [...position],
        previous: [...position],
        original: Object.freeze(position),
        acceleration: [0, 0, 0],
      });
    }
  }
  return particles;
}

function buildConstraints() {
  const constraints = [];
  for (let v = 0; v < CSSCLOTH_SEGMENTS; v += 1) {
    for (let u = 0; u < CSSCLOTH_SEGMENTS; u += 1) {
      constraints.push([particleIndex(u, v), particleIndex(u, v + 1)]);
      constraints.push([particleIndex(u, v), particleIndex(u + 1, v)]);
    }
  }
  for (let v = 0; v < CSSCLOTH_SEGMENTS; v += 1) {
    constraints.push([particleIndex(CSSCLOTH_SEGMENTS, v), particleIndex(CSSCLOTH_SEGMENTS, v + 1)]);
  }
  for (let u = 0; u < CSSCLOTH_SEGMENTS; u += 1) {
    constraints.push([particleIndex(u, CSSCLOTH_SEGMENTS), particleIndex(u + 1, CSSCLOTH_SEGMENTS)]);
  }
  return constraints;
}

function computeSmoothNormals(particles, triangles) {
  const positions = particles.map((particle) => particle.position.map(Math.fround));
  const normals = Array.from({ length: positions.length }, () => [0, 0, 0]);
  for (const triangle of triangles) {
    const [a, b, c] = triangle.particleIndices;
    const cb = subtract(positions[c], positions[b]);
    const ab = subtract(positions[a], positions[b]);
    const face = cross(cb, ab);
    normals[a] = addF32(normals[a], face);
    normals[b] = addF32(normals[b], face);
    normals[c] = addF32(normals[c], face);
  }
  return normals.map((normal) => normalize(normal).map(Math.fround));
}

function boxFaces({ id, center, size }) {
  const corners = boxCorners({ id, center, size });
  const faces = [
    ["front", [0, 0, 1], [corners.lbf, corners.rbf, corners.rtf, corners.ltf]],
    ["back", [0, 0, -1], [corners.rbn, corners.lbn, corners.ltn, corners.rtn]],
    ["left", [-1, 0, 0], [corners.lbn, corners.lbf, corners.ltf, corners.ltn]],
    ["right", [1, 0, 0], [corners.rbf, corners.rbn, corners.rtn, corners.rtf]],
    ["top", [0, 1, 0], [corners.ltf, corners.rtf, corners.rtn, corners.ltn]],
    ["bottom", [0, -1, 0], [corners.lbn, corners.rbn, corners.rbf, corners.lbf]],
  ];
  return faces.map(([faceId, normal, world]) => {
    const view = world.map(sourceWorldToCssView);
    return Object.freeze({
      id: `${id}-${faceId}`,
      matrix: matrixFromQuad(view, 64),
      color: shadeSourceRgb([1, 1, 1], Math.max(0, dot3(normal, LIGHT_DIRECTION))),
      normal: Object.freeze(normal),
    });
  });
}

function boxCorners({ center, size }) {
  const [cx, cy, cz] = center;
  const [hx, hy, hz] = size.map((value) => value / 2);
  return {
    lbn: [cx - hx, cy - hy, cz - hz],
    rbn: [cx + hx, cy - hy, cz - hz],
    ltn: [cx - hx, cy + hy, cz - hz],
    rtn: [cx + hx, cy + hy, cz - hz],
    lbf: [cx - hx, cy - hy, cz + hz],
    rbf: [cx + hx, cy - hy, cz + hz],
    ltf: [cx - hx, cy + hy, cz + hz],
    rtf: [cx + hx, cy + hy, cz + hz],
  };
}

function triangleMatrix(points, primitiveWidth, primitiveHeight = primitiveWidth) {
  const [a, b, c] = points;
  const x = scale(subtract(b, a), 1 / primitiveWidth);
  const y = scale(subtract(c, a), 1 / primitiveHeight);
  const normal = normalize(cross(x, y));
  return Object.freeze([
    x[0], x[1], x[2], 0,
    y[0], y[1], y[2], 0,
    normal[0], normal[1], normal[2], 0,
    a[0], a[1], a[2], 1,
  ].map(roundMatrix));
}

function groundHomographyMatrix(viewPoints) {
  const polygon = {
    vertices: [viewPoints[0], viewPoints[1], viewPoints[3], viewPoints[2]]
      .map(([x, y, z]) => [y, x, z]),
    textureImageSource: {
      url: "assets/ground.jpg",
      width: CSSCLOTH_GROUND_RASTER_WIDTH,
      height: CSSCLOTH_GROUND_RASTER_HEIGHT,
    },
    texturePresentation: { backend: "image", projection: "projective" },
  };
  const guards = resolveProjectiveQuadGuards({ bleed: 0, disableGuards: true });
  const plan = computeTextureAtlasPlanPublic(
    polygon,
    0,
    { tileSize: 1, layerElevation: 1 },
    guards,
  );
  const geometry = plan && resolvePolyTextureLeafGeometry(plan, {
    projectiveQuadGuards: guards,
  });
  if (!geometry?.matrix || geometry.projection !== "projective") {
    throw new Error("Cloth ground homography could not be prepared");
  }
  return Object.freeze(geometry.matrix.split(",").map(Number).map(roundMatrix));
}

export function buildClothSeamEdges(triangles = buildClothTriangles()) {
  const edgeOwners = new Map();
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
    const indices = triangles[triangleIndex].particleIndices;
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const left = indices[edgeIndex];
      const right = indices[(edgeIndex + 1) % 3];
      const key = left < right ? `${left}:${right}` : `${right}:${left}`;
      const owners = edgeOwners.get(key) ?? [];
      owners.push([triangleIndex, edgeIndex]);
      edgeOwners.set(key, owners);
    }
  }
  const seamEdges = Array.from({ length: triangles.length }, () => new Set());
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2) continue;
    for (const [triangleIndex, edgeIndex] of owners) seamEdges[triangleIndex].add(edgeIndex);
  }
  return Object.freeze(seamEdges.map((edges) => Object.freeze([...edges])));
}

function particleIndex(u, v) {
  return u + v * (CSSCLOTH_SEGMENTS + 1);
}

function topologyParticleIndex(u, v, segments) {
  return u + v * (segments + 1);
}

function sampleSourceGrid(values, u, v) {
  const left = Math.floor(u);
  const right = Math.min(CSSCLOTH_SEGMENTS, left + 1);
  const top = Math.floor(v);
  const bottom = Math.min(CSSCLOTH_SEGMENTS, top + 1);
  const x = u - left;
  const y = v - top;
  const topValue = add(
    scale(values[particleIndex(left, top)], 1 - x),
    scale(values[particleIndex(right, top)], x),
  );
  const bottomValue = add(
    scale(values[particleIndex(left, bottom)], 1 - x),
    scale(values[particleIndex(right, bottom)], x),
  );
  return add(scale(topValue, 1 - y), scale(bottomValue, y)).map(Math.fround);
}

function addForce(particle, force) {
  particle.acceleration = add(particle.acceleration, scale(force, 1 / MASS));
}

function linearToSrgb(value) {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function roundMatrix(value) {
  const rounded = Number(value.toFixed(7));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function addF32(a, b) { return [Math.fround(a[0] + b[0]), Math.fround(a[1] + b[1]), Math.fround(a[2] + b[2])]; }
function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a, value) { return [a[0] * value, a[1] * value, a[2] * value]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function length(a) { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a) { const magnitude = length(a); return magnitude === 0 ? [0, 0, 0] : scale(a, 1 / magnitude); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
