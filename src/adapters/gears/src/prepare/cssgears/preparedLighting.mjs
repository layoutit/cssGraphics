import { createHash } from "node:crypto";
import { computeTextureAtlasPlanPublic } from "@layoutit/polycss";
import { PNG } from "pngjs";

const TILE_WIDTH = 2;
const TILE_HEIGHT = 2;
const preparedBytes = new WeakMap();

export function buildPreparedGearsLighting({ faces, assembly, sourceProfile, playback }) {
  if (!Array.isArray(faces) || faces.length === 0 ||
      !Array.isArray(assembly?.gears) || assembly.gears.length !== 3 ||
      playback?.stateCount !== 720 || !sourceProfile?.light ||
      !isRotation(sourceProfile.sceneRotationDegrees) ||
      !isRotation(sourceProfile.presentation?.rotationDegrees)) {
    throw new TypeError("Complete source-bound cssGears lighting input is required");
  }
  const faceCount = faces.length;
  const width = faceCount * TILE_WIDTH;
  const height = TILE_HEIGHT;
  const image = new PNG({ width, height, colorType: 6 });
  const faceCorners = faces.map((face, faceIndex) => cornerVertexIndices(face, faceIndex));
  const initialColors = new Array(faceCount);
  const faceVertexColors = new Array(faceCount);
  const theta = assembly.gears.map((gear) => gear.initialTheta);
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const face = faces[faceIndex];
    const vertexColors = face.normals.map((normal) => shadeVertex(
      face.material,
      normal,
      theta[face.gearIndex],
      sourceProfile,
    ));
    faceVertexColors[faceIndex] = Object.freeze(vertexColors.map((color) => Object.freeze(color)));
    const cornerColors = faceCorners[faceIndex].map((vertexIndex) => vertexColors[vertexIndex]);
    writeTile(image, faceIndex, 0, cornerColors);
    initialColors[faceIndex] = averageColor(cornerColors);
  }
  const bytes = PNG.sync.write(image, {
    colorType: 6,
    inputColorType: 6,
    bitDepth: 8,
  });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const contract = Object.freeze({
    schema: "cssgears-prepared-opengl-static-lighting-atlas@1",
    technique: "prepared-canonical-native-tick-zero-smooth-vertex-fixed-function-lighting-atlas",
    source: "hacks/glx/gears.c#init_gears+draw_gears and hacks/glx/involute.c#draw_involute_gear",
    assetUrl: `/cssgears/assets/lighting-${sha256}.png`,
    assetSha256: sha256,
    encoding: "PNG-RGBA8",
    pngColorSpace: "untagged-legacy-opengl-framebuffer-bytes",
    interpolation: "browser-perspective-transformed-2x2-vertex-color-field",
    width: image.width,
    height: image.height,
    tileWidth: TILE_WIDTH,
    tileHeight: TILE_HEIGHT,
    faceCount,
    animatedFaceCount: 0,
    staticFaceCount: faceCount,
    animatedFaceIndices: Object.freeze([]),
    canonicalSourceStateIndex: 0,
    atlasStateCount: 1,
    sourceStateCount: playback.stateCount,
    lightingRotationPolicy: "prepared-product-scene-rotation-native-fixed-eye-space-light",
    lightingRotationDegrees: Object.freeze([...sourceProfile.presentation.rotationDegrees]),
    nativeSceneRotationDegrees: Object.freeze([...sourceProfile.sceneRotationDegrees]),
    presentationRotationDegrees: Object.freeze([...sourceProfile.presentation.rotationDegrees]),
    backgroundPositionXs: Object.freeze(Array.from(
      { length: faceCount },
      (_, faceIndex) => `${-faceIndex * TILE_WIDTH}px`,
    )),
    backgroundPositionY: "0px",
    decodedBytes: image.width * image.height * 4,
    backgroundSize: `${image.width}px ${image.height}px`,
    material: Object.freeze({
      ambientAndDiffuse: "captured-per-source-polygon",
      specular: Object.freeze([1, 1, 1, 1]),
      shininess: sourceProfile.light.shininess,
    }),
    light: sourceProfile.light,
    model: "OpenGL-1.x-infinite-viewer-ambient-Lambert-Blinn-Phong",
    ambient: Object.freeze({ color: "#ffffff", intensity: Math.PI }),
    directional: Object.freeze({ direction: [0, 0, 1], color: "#ffffff", intensity: 0 }),
    runtime: Object.freeze({
      lightingCalculations: 0,
      atlasConstruction: 0,
      perLeafStyleWrites: 0,
      stylesheetRuleWritesPerPublishedState: 0,
      backgroundPositionWritesPerPublishedState: 0,
      rootLightingRowDependentFaceCount: 0,
      topologyMutation: false,
    }),
  });
  preparedBytes.set(contract, bytes);
  return Object.freeze({
    contract,
    initialColors: Object.freeze(initialColors),
    faceVertexColors: Object.freeze(faceVertexColors),
  });
}

export function preparedLightingAssetBytes(contract) {
  return preparedBytes.get(contract) ?? null;
}

export function registerPreparedLightingAsset(contract, bytes) {
  if (!contract || !(bytes instanceof Uint8Array)) {
    throw new TypeError("Prepared cssGears lighting asset registration is incomplete");
  }
  preparedBytes.set(contract, bytes);
}

function cornerVertexIndices(face, faceIndex) {
  if (!Array.isArray(face?.vertices) || face.vertices.length !== 4 ||
      !Array.isArray(face.normals) || face.normals.length !== 4 ||
      !Array.isArray(face.material) || face.material.length !== 4) {
    throw new TypeError(`cssGears lighting face ${faceIndex} is incomplete`);
  }
  const plan = computeTextureAtlasPlanPublic({
    vertices: face.vertices,
    color: "#ffffff",
  }, faceIndex);
  if (!plan || plan.screenPts?.length !== 8) {
    throw new Error(`cssGears lighting face ${faceIndex} has no PolyCSS basis`);
  }
  const xs = [plan.screenPts[0], plan.screenPts[2], plan.screenPts[4], plan.screenPts[6]];
  const ys = [plan.screenPts[1], plan.screenPts[3], plan.screenPts[5], plan.screenPts[7]];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const targets = [
    [minX, minY],
    [maxX, minY],
    [minX, maxY],
    [maxX, maxY],
  ];
  const available = new Set([0, 1, 2, 3]);
  return targets.map(([targetX, targetY]) => {
    let best = -1;
    let distance = Infinity;
    for (const vertexIndex of available) {
      const dx = xs[vertexIndex] - targetX;
      const dy = ys[vertexIndex] - targetY;
      const candidate = dx * dx + dy * dy;
      if (candidate < distance) {
        best = vertexIndex;
        distance = candidate;
      }
    }
    if (best < 0) throw new Error(`cssGears lighting face ${faceIndex} corner mapping failed`);
    available.delete(best);
    return best;
  });
}

function shadeVertex(material, normal, gearTheta, sourceProfile) {
  const worldNormal = normalize(rotateScene(
    rotateZ(normal, gearTheta),
    sourceProfile.presentation.rotationDegrees,
  ));
  const lightDirection = normalize(sourceProfile.light.position.slice(0, 3));
  const viewer = [0, 0, 1];
  const halfVector = normalize([
    lightDirection[0] + viewer[0],
    lightDirection[1] + viewer[1],
    lightDirection[2] + viewer[2],
  ]);
  const diffuse = Math.max(0, dot(worldNormal, lightDirection));
  const specular = diffuse > 0
    ? Math.pow(Math.max(0, dot(worldNormal, halfVector)), sourceProfile.light.shininess)
    : 0;
  const materialSpecular = [1, 1, 1];
  return [0, 1, 2].map((channel) => byte(
    material[channel] * sourceProfile.light.globalAmbient[channel]
      + material[channel] * sourceProfile.light.ambient[channel]
      + material[channel] * sourceProfile.light.diffuse[channel] * diffuse
      + materialSpecular[channel] * sourceProfile.light.specular[channel] * specular,
  ));
}

function isRotation(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function writeTile(image, faceIndex, stateIndex, colors) {
  const startX = faceIndex * TILE_WIDTH;
  const startY = stateIndex * TILE_HEIGHT;
  for (let y = 0; y < TILE_HEIGHT; y += 1) {
    for (let x = 0; x < TILE_WIDTH; x += 1) {
      const color = colors[y * TILE_WIDTH + x];
      const offset = ((startY + y) * image.width + startX + x) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
  }
}

function averageColor(colors) {
  return `#${[0, 1, 2].map((channel) => Math.round(
    colors.reduce((sum, color) => sum + color[channel], 0) / colors.length,
  ).toString(16).padStart(2, "0")).join("")}`;
}

function rotateScene(vector, [rotX, rotY, rotZ]) {
  return rotateX(rotateY(rotateZ(vector, rotZ), rotY), rotX);
}

function rotateX([x, y, z], degrees) {
  const angle = degrees * Math.PI / 180;
  return [x, y * Math.cos(angle) - z * Math.sin(angle), y * Math.sin(angle) + z * Math.cos(angle)];
}

function rotateY([x, y, z], degrees) {
  const angle = degrees * Math.PI / 180;
  return [x * Math.cos(angle) + z * Math.sin(angle), y, -x * Math.sin(angle) + z * Math.cos(angle)];
}

function rotateZ([x, y, z], degrees) {
  const angle = degrees * Math.PI / 180;
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), z];
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return length > 0 ? vector.map((component) => component / length) : [0, 0, 1];
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function byte(value) {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}
