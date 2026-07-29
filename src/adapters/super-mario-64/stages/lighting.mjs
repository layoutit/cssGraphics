import {
  serializeTitleHeadContract,
  titleHeadContentHash,
  titleHeadSha256,
} from "./contract.mjs";
import {
  encodePngRgba8Paeth,
} from "../../../prepare/shared/png.mjs";
import {
  TITLE_HEAD_LIGHTING_NODE_BYTES,
  TITLE_HEAD_LIGHTING_STATE_FIELD_SCHEMA,
} from "./spatialResolution.mjs";
import sharp from "sharp";
import {
  TITLE_HEAD_LEAF_STYLES_PATH,
  buildTitleHeadLeafStyles,
} from "./leafStyles.mjs";

// lightingTimeline
const TITLE_HEAD_LIGHTING_TIMELINE_SCHEMA = "cssgraphics-title-head-lighting-timeline@1";
const TITLE_HEAD_LIGHTING_TIMELINE_REPORT_SCHEMA = "cssgraphics-title-head-lighting-timeline-report@1";

const REGULAR_FRAME_COUNT = 820;
const LIGHT_DIRECTION_SCALE = 120;
const HILITE_TEXTURE_SIZE = 32;
const CAMERA = Object.freeze({
  worldPosition: Object.freeze([0, 200, 2000]),
  lookAt: Object.freeze([0, 200, 0]),
  rollDegrees: 0,
});

const f32 = Math.fround;
const add = (left, right) => f32(f32(left) + f32(right));
const subtract = (left, right) => f32(f32(left) - f32(right));
const multiply = (left, right) => f32(f32(left) * f32(right));
const divide = (left, right) => f32(f32(left) / f32(right));
const DEG_PER_RAD = 57.29577950560105;

function lightingTimelineFail(message) {
  throw new TypeError(message);
}

function requireSignature(source, pattern, label) {
  if (typeof source !== "string" || !pattern.test(source)) lightingTimelineFail(`authoritative source lost ${label}`);
}

function exactSchema(value, schema, label) {
  if (!value || value.schema !== schema || !/^[0-9a-f]{64}$/u.test(value.contentHash)) {
    lightingTimelineFail(`${label} is not a complete prepared contract`);
  }
}

function floatBits(value) {
  const bytes = new ArrayBuffer(4);
  const view = new DataView(bytes);
  view.setFloat32(0, f32(value), false);
  return view.getUint32(0, false).toString(16).padStart(8, "0");
}

function vecBits(value) {
  return value.map(floatBits).join(":");
}

function magnitude(value) {
  const sum = add(add(multiply(value[0], value[0]), multiply(value[1], value[1])), multiply(value[2], value[2]));
  return f32(Math.sqrt(sum));
}

function normalize(value, label) {
  const result = value.map(f32);
  const length = magnitude(result);
  if (!(length > 0)) lightingTimelineFail(`${label} reached a zero/invalid magnitude`);
  return Object.freeze(result.map((component) => divide(component, length)));
}

function animationChannel(animation, targetId) {
  const matches = animation.channels.filter((channel) => channel.targetId === targetId);
  if (matches.length !== 1) lightingTimelineFail(`${targetId} must resolve to exactly one regular animation channel`);
  const channel = matches[0];
  const sequence = channel.regularSequence;
  if (!sequence || !Array.isArray(sequence.samples) || sequence.samples.length !== REGULAR_FRAME_COUNT
    || !Array.isArray(sequence.componentScale) || sequence.componentScale.length !== 6) {
    lightingTimelineFail(`${targetId} does not expose one complete ${REGULAR_FRAME_COUNT}-frame regular sequence`);
  }
  return channel;
}

function samplePosition(channel, frameIndex) {
  const row = channel.regularSequence.samples[frameIndex];
  if (!Array.isArray(row) || row.length !== 6 || row.some((entry) => !Number.isFinite(entry))) {
    lightingTimelineFail(`${channel.id} frame ${frameIndex + 1} is incomplete`);
  }
  return Object.freeze(row.slice(3).map((value, index) => multiply(value, channel.regularSequence.componentScale[index + 3])));
}

function identityMatrix() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ].map(f32);
}

function multiplyMatrices(left, right) {
  const output = new Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let value = multiply(left[row * 4], right[column]);
      value = add(value, multiply(left[row * 4 + 1], right[4 + column]));
      value = add(value, multiply(left[row * 4 + 2], right[8 + column]));
      value = add(value, multiply(left[row * 4 + 3], right[12 + column]));
      output[row * 4 + column] = value;
    }
  }
  return output;
}

function axisRotation(axis, degrees) {
  const radians = f32(f32(degrees) / DEG_PER_RAD);
  const sine = f32(Math.sin(radians));
  const cosine = f32(Math.cos(radians));
  if (axis === 0) return [1, 0, 0, 0, 0, cosine, sine, 0, 0, f32(-sine), cosine, 0, 0, 0, 0, 1].map(f32);
  if (axis === 1) return [cosine, 0, f32(-sine), 0, 0, 1, 0, 0, sine, 0, cosine, 0, 0, 0, 0, 1].map(f32);
  return [cosine, sine, 0, 0, f32(-sine), cosine, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].map(f32);
}

function rotationMatrix(rotationDegrees) {
  let matrix = identityMatrix();
  for (let axis = 0; axis < 3; axis += 1) {
    if (rotationDegrees[axis] !== 0) matrix = multiplyMatrices(matrix, axisRotation(axis, rotationDegrees[axis]));
  }
  return Object.freeze(matrix);
}

function sampleRoot(channel, frameIndex) {
  const row = channel.regularSequence.samples[frameIndex];
  const scaled = row.map((value, index) => multiply(value, channel.regularSequence.componentScale[index]));
  const rotationDegrees = Object.freeze(scaled.slice(0, 3));
  const position = Object.freeze(scaled.slice(3));
  return Object.freeze({ rotationDegrees, position, rotationMatrix: rotationMatrix(rotationDegrees) });
}

function transformDirectionToModel(direction, matrix, label) {
  const value = direction.map((component) => divide(component, 127));
  const transformed = [0, 1, 2].map((row) => {
    let result = multiply(value[0], matrix[row * 4]);
    result = add(result, multiply(value[1], matrix[row * 4 + 1]));
    return add(result, multiply(value[2], matrix[row * 4 + 2]));
  });
  return normalize(transformed, label);
}

function transformUnitToModel(direction, matrix, label) {
  const transformed = [0, 1, 2].map((row) => {
    let result = multiply(direction[0], matrix[row * 4]);
    result = add(result, multiply(direction[1], matrix[row * 4 + 1]));
    return add(result, multiply(direction[2], matrix[row * 4 + 2]));
  });
  return normalize(transformed, label);
}

function quantizeDirection(value) {
  return Object.freeze(value.map((component) => {
    const scaled = Math.trunc(multiply(component, LIGHT_DIRECTION_SCALE));
    if (scaled < -128 || scaled > 127) lightingTimelineFail(`light direction ${scaled} overflows source s8`);
    return scaled;
  }));
}

function cameraMatrix() {
  const from = CAMERA.worldPosition.map(f32);
  const to = CAMERA.lookAt.map(f32);
  const d = {
    z: subtract(to[0], from[0]),
    y: subtract(to[1], from[1]),
    x: subtract(to[2], from[2]),
  };
  const inverse = divide(-1, f32(Math.sqrt(add(add(multiply(d.z, d.z), multiply(d.y, d.y)), multiply(d.x, d.x)))));
  d.z = multiply(d.z, inverse);
  d.y = multiply(d.y, inverse);
  d.x = multiply(d.x, inverse);
  let zColY = f32(Math.sin(0));
  let yColY = f32(Math.cos(0));
  let xColY = f32(0);
  const colX = {
    z: subtract(multiply(yColY, d.x), multiply(xColY, d.y)),
    y: subtract(multiply(xColY, d.z), multiply(zColY, d.x)),
    x: subtract(multiply(zColY, d.y), multiply(yColY, d.z)),
  };
  const inverseX = divide(1, f32(Math.sqrt(add(add(multiply(colX.z, colX.z), multiply(colX.y, colX.y)), multiply(colX.x, colX.x)))));
  colX.z = multiply(colX.z, inverseX);
  colX.y = multiply(colX.y, inverseX);
  colX.x = multiply(colX.x, inverseX);
  const nextZ = subtract(multiply(d.y, colX.x), multiply(d.x, colX.y));
  const nextY = subtract(multiply(d.x, colX.z), multiply(d.z, colX.x));
  const nextX = subtract(multiply(d.z, colX.y), multiply(d.y, colX.z));
  const inverseY = divide(1, f32(Math.sqrt(add(add(multiply(nextZ, nextZ), multiply(nextY, nextY)), multiply(nextX, nextX)))));
  zColY = multiply(nextZ, inverseY);
  yColY = multiply(nextY, inverseY);
  xColY = multiply(nextX, inverseY);
  return Object.freeze([
    Object.freeze([colX.z, zColY, d.z, 0]),
    Object.freeze([colX.y, yColY, d.y, 0]),
    Object.freeze([colX.x, xColY, d.x, 0]),
    Object.freeze([0, 0, 0, 1]),
  ]);
}

function hiliteState(phongDirection, matrix) {
  const half = Object.freeze([
    add(matrix[0][2], phongDirection[0]),
    add(matrix[1][2], phongDirection[1]),
    add(matrix[2][2], phongDirection[2]),
  ]);
  const length = magnitude(half);
  let normalized;
  let x1;
  let y1;
  if (length > f32(0.1)) {
    normalized = Object.freeze(half.map((component) => divide(component, length)));
    const x = add(add(multiply(normalized[0], matrix[0][0]), multiply(normalized[1], matrix[1][0])), multiply(normalized[2], matrix[2][0]));
    const y = add(add(multiply(normalized[0], matrix[0][1]), multiply(normalized[1], matrix[1][1])), multiply(normalized[2], matrix[2][1]));
    x1 = Math.trunc(add(multiply(x, HILITE_TEXTURE_SIZE * 2), HILITE_TEXTURE_SIZE * 4));
    y1 = Math.trunc(add(multiply(y, HILITE_TEXTURE_SIZE * 2), HILITE_TEXTURE_SIZE * 4));
  } else {
    normalized = Object.freeze([f32(0), f32(0), f32(0)]);
    x1 = HILITE_TEXTURE_SIZE * 2;
    y1 = HILITE_TEXTURE_SIZE * 2;
  }
  return Object.freeze({
    halfVectorF32: half,
    halfVectorF32Bits: vecBits(half),
    normalizedHalfF32: normalized,
    normalizedHalfF32Bits: vecBits(normalized),
    x1,
    y1,
    tileS: x1 & 0xfff,
    tileT: y1 & 0xfff,
    textureSize: HILITE_TEXTURE_SIZE,
  });
}

function internState(map, list, key, value) {
  const previous = map.get(key);
  if (previous !== undefined) return previous;
  const index = list.length;
  map.set(key, index);
  list.push(Object.freeze({ id: index, key, ...value }));
  return index;
}

function sourceProof(sources) {
  const { drawObjects, renderer, gbi, gdMath, shapeHelper } = sources ?? {};
  requireSignature(drawObjects, /void\s+setup_lights\([^)]*\)[\s\S]{0,220}set_light_num\(NUMLIGHTS_2\)[\s\S]{0,160}GD_PROP_AMB_COLOUR,\s*0\.5f,\s*0\.5f,\s*0\.5f/u, "two-light 0.5 ambient setup");
  requireSignature(drawObjects, /sLightPositionCache\[light->id\]\.x\s*=\s*light->position\.x\s*-\s*sLightPositionOffset\.x[\s\S]{0,420}gd_normalize_vec3f\(&sLightPositionCache\[light->id\]\)/u, "animated light direction normalization");
  requireSignature(drawObjects, /LIGHT_UNK20[\s\S]{0,260}sPhongLight\s*=\s*light/u, "phong-light selection");
  requireSignature(drawObjects, /gd_dl_hilite\(mtl->gddlNumber,\s*gViewUpdateCamera,\s*&sPhongLight->position,[\s\S]{0,160}&sPhongLightPosition,\s*&sPhongLight->colour\)/u, "material hilite inputs");
  requireSignature(renderer, /GD_PROP_LIGHT_DIR:[\s\S]{0,220}sLightDirections\[sLightId\]\.x\s*=\s*\(s32\)\(f1\s*\*\s*120\.f\)/u, "120-scale direction quantization");
  requireSignature(renderer, /lightDir\[0\]\s*=\s*\(s8\)sLightDirections\[i\]\.x[\s\S]{0,180}lightDir\[2\]\s*=\s*\(s8\)sLightDirections\[i\]\.z/u, "signed-byte light directions");
  requireSignature(renderer, /sp40\.z\s*=\s*cam->unkE8\[0\]\[2\]\s*\+\s*arg4->x[\s\S]{0,900}hilite->h\.y1/u, "hilite half-vector and tile offsets");
  requireSignature(renderer, /gsSPSetGeometryMode\(G_TEXTURE_GEN\)[\s\S]{0,380}G_CC_HILITERGBA/u, "shine texture generation and combine");
  requireSignature(gbi, /#define\s+G_CC_HILITERGBA\s+PRIMITIVE,\s*SHADE,\s*TEXEL0,\s*SHADE,\s*PRIMITIVE,\s*SHADE,\s*TEXEL0,\s*SHADE/u, "hilite RGB/alpha combine macro");
  requireSignature(gdMath, /s32\s+gd_normalize_vec3f\([^)]*\)[\s\S]{0,700}mag\s*=\s*gd_sqrt_f\(mag\)[\s\S]{0,420}vec->z\s*\/=\s*mag/u, "float vector normalization");
  requireSignature(shapeHelper, /s32\s+load_mario_head\([^)]*\)[\s\S]{0,1800}d_set_world_pos\(0\.0f,\s*200\.0f,\s*2000\.0f\)/u, "regular-head camera position");
  return Object.freeze([
    ["src/goddard/draw_objects.c", drawObjects],
    ["src/goddard/renderer.c", renderer],
    ["include/PR/gbi.h", gbi],
    ["src/goddard/gd_math.c", gdMath],
    ["src/goddard/shape_helper.c", shapeHelper],
  ].map(([path, source]) => Object.freeze({
    path,
    sha256: titleHeadSha256(source),
  })));
}

function buildTitleHeadLightingTimeline({
  animation,
  deformation,
  materials,
  authoritativeSources,
} = {}) {
  exactSchema(animation, "cssgraphics-title-head-animation@1", "animation");
  exactSchema(deformation, "cssgraphics-title-head-deformation@1", "deformation");
  exactSchema(materials, "cssgraphics-title-head-materials@1", "materials");
  if (animation.deformationHash !== deformation.contentHash
    || materials.provenance?.geometryContentHash !== deformation.geometryHash) {
    lightingTimelineFail("lighting timeline inputs do not belong to one prepared generation");
  }
  const sourceFiles = sourceProof(authoritativeSources);
  const rootChannel = animationChannel(animation, deformation.rootNetId);
  const lights = [...(materials.sourceState?.lighting?.lights ?? [])]
    .sort((left, right) => left.lightSlot - right.lightSlot);
  if (lights.length !== 2 || lights[0]?.id !== "N231" || lights[1]?.id !== "N228"
    || lights[0].phongHighlightSource !== false || lights[1].phongHighlightSource !== true) {
    lightingTimelineFail("regular light slot/role identity drifted");
  }
  const lightChannels = new Map(lights.map((light) => [light.id, animationChannel(animation, light.id)]));
  const matrix = cameraMatrix();
  const combinedStates = [];
  const combinedMap = new Map();
  const perLightStates = Object.fromEntries(lights.map((light) => [light.id, []]));
  const perLightMaps = Object.fromEntries(lights.map((light) => [light.id, new Map()]));
  const shineStates = [];
  const shineMap = new Map();
  const surfaceCombinedStates = [];
  const surfaceCombinedMap = new Map();
  const surfacePerLightStates = Object.fromEntries(lights.map((light) => [light.id, []]));
  const surfacePerLightMaps = Object.fromEntries(lights.map((light) => [light.id, new Map()]));
  const shineSurfaceStates = [];
  const shineSurfaceMap = new Map();
  const frames = [];

  for (let frameIndex = 0; frameIndex < REGULAR_FRAME_COUNT; frameIndex += 1) {
    const root = sampleRoot(rootChannel, frameIndex);
    const rootPosition = root.position;
    const lookAtModelX = transformUnitToModel([1, 0, 0], root.rotationMatrix, `look-at X frame ${frameIndex + 1}`);
    const lookAtModelY = transformUnitToModel([0, 1, 0], root.rotationMatrix, `look-at Y frame ${frameIndex + 1}`);
    const frameLights = lights.map((light) => {
      const position = samplePosition(lightChannels.get(light.id), frameIndex);
      const relative = Object.freeze(position.map((value, axis) => subtract(value, rootPosition[axis])));
      const directionF32 = normalize(relative, `${light.id} frame ${frameIndex + 1}`);
      const directionS8 = quantizeDirection(directionF32);
      const directionModelF32 = transformDirectionToModel(
        directionS8,
        root.rotationMatrix,
        `${light.id} model coefficient frame ${frameIndex + 1}`,
      );
      const stateKey = directionS8.join(",");
      const stateId = internState(perLightMaps[light.id], perLightStates[light.id], stateKey, {
        lightId: light.id,
        lightSlot: light.lightSlot,
        directionS8,
      });
      return Object.freeze({
        id: light.id,
        lightSlot: light.lightSlot,
        animationChannelId: lightChannels.get(light.id).id,
        position,
        relativePositionF32: relative,
        relativePositionF32Bits: vecBits(relative),
        directionF32,
        directionF32Bits: vecBits(directionF32),
        directionS8,
        directionModelF32,
        directionModelF32Bits: vecBits(directionModelF32),
        diffuse: Object.freeze([...light.diffuse]),
        intensity: f32(light.initialIntensity),
        stateId,
      });
    });
    const combinedKey = frameLights.map((light) => light.directionS8.join(",")).join("|");
    const combinedStateId = internState(combinedMap, combinedStates, combinedKey, {
      lightStateIds: Object.freeze(frameLights.map((light) => light.stateId)),
      directionsS8: Object.freeze(frameLights.map((light) => light.directionS8)),
    });
    const surfaceLightStateIds = frameLights.map((light) => internState(
      surfacePerLightMaps[light.id],
      surfacePerLightStates[light.id],
      light.directionModelF32Bits,
      {
        lightId: light.id,
        lightSlot: light.lightSlot,
        directionModelF32: light.directionModelF32,
        directionModelF32Bits: light.directionModelF32Bits,
      },
    ));
    const surfaceCombinedKey = frameLights.map((light) => light.directionModelF32Bits).join("|");
    const surfaceCombinedStateId = internState(surfaceCombinedMap, surfaceCombinedStates, surfaceCombinedKey, {
      lightStateIds: Object.freeze(surfaceLightStateIds),
      directionsModelF32Bits: Object.freeze(frameLights.map((light) => light.directionModelF32Bits)),
    });
    const phong = frameLights.find((light) => light.id === "N228");
    const hilite = hiliteState(phong.directionF32, matrix);
    const shineKey = `${hilite.tileS},${hilite.tileT}`;
    const shineStateId = internState(shineMap, shineStates, shineKey, {
      phongLightId: phong.id,
      tileS: hilite.tileS,
      tileT: hilite.tileT,
      x1: hilite.x1,
      y1: hilite.y1,
    });
    const shineSurfaceKey = `${shineKey}|${vecBits(lookAtModelX)}|${vecBits(lookAtModelY)}`;
    const shineSurfaceStateId = internState(shineSurfaceMap, shineSurfaceStates, shineSurfaceKey, {
      hiliteStateId: shineStateId,
      tileS: hilite.tileS,
      tileT: hilite.tileT,
      lookAtModelX,
      lookAtModelXBits: vecBits(lookAtModelX),
      lookAtModelY,
      lookAtModelYBits: vecBits(lookAtModelY),
    });
    frames.push(Object.freeze({
      frame: frameIndex + 1,
      root: Object.freeze({
        targetId: deformation.rootNetId,
        animationChannelId: rootChannel.id,
        position: rootPosition,
        positionF32Bits: vecBits(rootPosition),
        rotationDegrees: root.rotationDegrees,
        rotationDegreesF32Bits: vecBits(root.rotationDegrees),
        rotationMatrix: root.rotationMatrix,
      }),
      lights: Object.freeze(frameLights),
      combinedStateId,
      surfaceCombinedStateId,
      shineStateId,
      shineSurfaceStateId,
      lookAtModel: Object.freeze({
        x: lookAtModelX,
        xBits: vecBits(lookAtModelX),
        y: lookAtModelY,
        yBits: vecBits(lookAtModelY),
      }),
      hilite,
    }));
  }
  const payload = {
    schema: TITLE_HEAD_LIGHTING_TIMELINE_SCHEMA,
    slice: "sm64-regular-interactive-title-head",
    sequence: "regular",
    frameCount: REGULAR_FRAME_COUNT,
    animationHash: animation.contentHash,
    deformationHash: deformation.contentHash,
    materialsHash: materials.contentHash,
    ambientScale: Object.freeze([...materials.sourceState.lighting.ambientScale]),
    camera: Object.freeze({ ...CAMERA, matrix }),
    sourceMath: Object.freeze({
      normalize: "ordered-f32 sqrt then component divide",
      directionQuantization: "truncate-s32(normalized-component * 120), then cast-s8",
      hilite: "normalize(camera-look-z + phong-direction), project camera x/y, truncate-s32, mask-12bit",
      combine: "G_CC_HILITERGBA=(primitive-shade)*texel0+shade for rgb and alpha",
    }),
    lights: Object.freeze(lights.map((light) => Object.freeze({
      id: light.id,
      sourceOrder: light.sourceOrder,
      lightSlot: light.lightSlot,
      phongHighlightSource: light.phongHighlightSource,
      diffuse: Object.freeze([...light.diffuse]),
      intensity: f32(light.initialIntensity),
      animationChannelId: lightChannels.get(light.id).id,
    }))),
    states: Object.freeze({
      combined: Object.freeze(combinedStates),
      perLight: Object.freeze(Object.fromEntries(lights.map((light) => [light.id, Object.freeze(perLightStates[light.id])]))),
      shine: Object.freeze(shineStates),
      surfaceCombined: Object.freeze(surfaceCombinedStates),
      surfacePerLight: Object.freeze(Object.fromEntries(lights.map((light) => [light.id, Object.freeze(surfacePerLightStates[light.id])]))),
      shineSurface: Object.freeze(shineSurfaceStates),
    }),
    frames: Object.freeze(frames),
    provenance: Object.freeze({ sourceFiles }),
    runtime: Object.freeze({
      ownsLightMath: false,
      ownsShineMath: false,
      frameLookup: "direct-prepared-index",
      maximumRootRowWrites: 3,
    }),
  };
  return Object.freeze({ ...payload, contentHash: titleHeadContentHash(payload) });
}

function buildTitleHeadLightingTimelineReport(timeline) {
  exactSchema(timeline, TITLE_HEAD_LIGHTING_TIMELINE_SCHEMA, "lighting timeline");
  const preliminaryCombinedDirectionStates = 555;
  const report = {
    schema: TITLE_HEAD_LIGHTING_TIMELINE_REPORT_SCHEMA,
    status: "pass",
    timelineHash: timeline.contentHash,
    frameCount: timeline.frameCount,
    counts: Object.freeze({
      combinedDirectionStates: timeline.states.combined.length,
      whiteKeyStates: timeline.states.perLight.N228.length,
      redFillStates: timeline.states.perLight.N231.length,
      shineTileStates: timeline.states.shine.length,
      combinedSurfaceStates: timeline.states.surfaceCombined.length,
      whiteSurfaceStates: timeline.states.surfacePerLight.N228.length,
      redSurfaceStates: timeline.states.surfacePerLight.N231.length,
      shineSurfaceStates: timeline.states.shineSurface.length,
    }),
    preliminary: Object.freeze({
      combinedDirectionStates: preliminaryCombinedDirectionStates,
      matchesCombinedDirectionProbe: timeline.states.combined.length === preliminaryCombinedDirectionStates,
    }),
    firstFrame: Object.freeze({
      combinedStateId: timeline.frames[0].combinedStateId,
      shineStateId: timeline.frames[0].shineStateId,
    }),
    lastFrame: Object.freeze({
      combinedStateId: timeline.frames.at(-1).combinedStateId,
      shineStateId: timeline.frames.at(-1).shineStateId,
    }),
    runtime: timeline.runtime,
  };
  return Object.freeze({ ...report, contentHash: titleHeadContentHash(report) });
}

// lightingAtlasPlan
const TITLE_HEAD_LIGHTING_ATLAS_PLAN_SCHEMA =
  "cssgraphics-title-head-lighting-atlas-plan@1";
const ACCEPTED_LIGHTING_ATLAS_PLAN_HASH =
  "527450fd4fb477801adf1af35a001df3756d5fa3e282ba6eb8eb234a2d36efcd";

// lightingCompositor
const NORMAL_SCALE = 127;

function lightingCompositorFail(message) {
  throw new TypeError(message);
}

function compositorRgbBytes(value, label = "colour") {
  if (typeof value === "string") {
    const match = /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/u.exec(value);
    if (!match) lightingCompositorFail(`${label} is not prepared RGB8`);
    value = match.slice(1).map(Number);
  }
  if (!Array.isArray(value) || value.length !== 3
    || value.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)) {
    lightingCompositorFail(`${label} is not prepared RGB8`);
  }
  return value;
}

function normalS8(value, label = "normal") {
  if (!Array.isArray(value) || value.length !== 3
    || value.some((entry) => !Number.isInteger(entry) || entry < -127 || entry > 127)) {
    lightingCompositorFail(`${label} is not a source signed-byte normal`);
  }
  return value;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, value));
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

/**
 * Prepare-only source lighting adapter. Contributions are truncated in source
 * light-slot order, accumulated in integer colour channels, then saturated.
 */
function shadeTitleHeadVertex({ baseRgb, normal, ambientScale, lights }) {
  const base = compositorRgbBytes(baseRgb, "base colour");
  const sourceNormal = normalS8(normal);
  if (!Array.isArray(ambientScale) || ambientScale.length !== 3
    || ambientScale.some((entry) => !Number.isFinite(entry))) {
    lightingCompositorFail("ambient scale is incomplete");
  }
  if (!Array.isArray(lights) || lights.length !== 2) lightingCompositorFail("exactly two source lights are required");
  const output = base.map((entry, channel) => Math.trunc(entry * ambientScale[channel]));
  for (const light of [...lights].sort((left, right) => left.lightSlot - right.lightSlot)) {
    const direction = light.directionModelF32;
    if (!Array.isArray(direction) || direction.length !== 3 || direction.some((entry) => !Number.isFinite(entry))) {
      lightingCompositorFail(`${light.id ?? "light"} has no prepared model-space direction`);
    }
    const coefficient = Math.max(0, Math.min(1, dot(sourceNormal, direction) / NORMAL_SCALE));
    for (let channel = 0; channel < 3; channel += 1) {
      const diffuseByte = Math.trunc(base[channel] * light.diffuse[channel] * light.intensity);
      output[channel] += Math.trunc(diffuseByte * coefficient);
    }
  }
  return Object.freeze(output.map(clampByte));
}

/** Returns unwrapped source texel coordinates; wrapping happens after interpolation. */
function generateTitleHeadShineCoordinates({
  normal,
  lookAtModel,
  hilite,
  textureScale = [1984, 1984],
}) {
  const sourceNormal = normalS8(normal);
  if (!lookAtModel || !Array.isArray(lookAtModel.x) || !Array.isArray(lookAtModel.y)) {
    lightingCompositorFail("prepared model-space look-at basis is missing");
  }
  if (!hilite || !Number.isInteger(hilite.tileS) || !Number.isInteger(hilite.tileT)) {
    lightingCompositorFail("prepared hilite tile origin is missing");
  }
  if (!Array.isArray(textureScale) || textureScale.length !== 2
    || textureScale.some((entry) => !Number.isFinite(entry))) {
    lightingCompositorFail("shine texture scale is incomplete");
  }
  const generatedS10_5 = ((dot(sourceNormal, lookAtModel.x) / NORMAL_SCALE + 1) / 4) * textureScale[0];
  const generatedT10_5 = ((dot(sourceNormal, lookAtModel.y) / NORMAL_SCALE + 1) / 4) * textureScale[1];
  return Object.freeze([
    generatedS10_5 / 32 - hilite.tileS / 4 + 0.5,
    generatedT10_5 / 32 - hilite.tileT / 4 + 0.5,
  ]);
}

// lightingAtlases
const TITLE_HEAD_LIGHTING_ATLASES_SCHEMA = "cssgraphics-title-head-lighting-atlases@7";

const FACE_SIZE = 32;
const SURFACE_CELL_SIZE = 4;
const LIGHTING_ATLAS_FRAME_COUNT = 820;
const ALPHA_SUPERSAMPLES = 4;
const PAGE_LIMIT = 4096;
const TILE_GUTTER = 1;
const MAX_STATE_COLUMNS = 41;
const TEMPORAL_RGB_DELTA_POLICY = Object.freeze({
  label: "prepared-tile-max-dimension-tiered-4-6-12",
  basis: "prepared tile maximum dimension",
  tiers: Object.freeze([
    Object.freeze({ minimumDimension: 16, maximumDelta: 4 }),
    Object.freeze({ minimumDimension: 12, maximumDelta: 6 }),
    Object.freeze({ minimumDimension: 0, maximumDelta: 12 }),
  ]),
});
const FLIPBOOK_SPATIAL_POLICY = Object.freeze({
  label: "prepare-intermediate-frozen-source-exact-area-tiered-16-12-8",
  basis: "temporary state-selection raster; final output sizing is selected after visibility compaction",
});
const TEMPORAL_SELECTION_SPATIAL_POLICY = Object.freeze({
  label: "frozen-source-exact-area-tiered-16-12-8",
  tiers: Object.freeze([
    Object.freeze({ minArea: 1536, maxDimension: 16 }),
    Object.freeze({ minArea: 512, maxDimension: 12 }),
    Object.freeze({ minArea: 0, maxDimension: 8 }),
  ]),
});

function lightingAtlasesFail(message) {
  throw new Error(`Title-head lighting atlases: ${message}`);
}

function uint16LeBase64(values) {
  const bytes = Buffer.allocUnsafe(values.length * 2);
  for (let index = 0; index < values.length; index += 1) {
    bytes.writeUInt16LE(values[index], index * 2);
  }
  return bytes.toString("base64");
}

function uint32LeBase64(values) {
  const bytes = Buffer.allocUnsafe(values.length * 4);
  for (let index = 0; index < values.length; index += 1) {
    bytes.writeUInt32LE(values[index], index * 4);
  }
  return bytes.toString("base64");
}

function lightingAtlasRgbBytes(value) {
  const match = /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/u.exec(value);
  if (!match) lightingAtlasesFail(`invalid prepared RGB colour ${value}`);
  return match.slice(1).map(Number);
}

function affineValue(apex, left, right, u, v) {
  return apex + (right - left) * (u - 0.5) + ((left + right) / 2 - apex) * v;
}

function canonicalFaces(trianglePlan, materials) {
  const materialById = new Map(materials.materials.map((entry) => [entry.id, entry]));
  const normalsByShape = new Map(materials.normals.map((entry) => [entry.shapeId, entry]));
  return trianglePlan.leaves.map((leaf) => {
    const material = materialById.get(leaf.materialId);
    const normalSet = normalsByShape.get(leaf.shapeId);
    if (!material || !normalSet) lightingAtlasesFail(`${leaf.faceId} has incomplete prepared inputs`);
    const polycssNormals = leaf.polycss.update.vertexIndices.map((index) => normalSet.vertexNormalsS8[index]);
    const { a, b, c } = leaf.polycss.basis;
    return Object.freeze({
      faceId: leaf.faceId,
      sourceOrder: leaf.sourceOrder,
      baseRgb: Object.freeze(lightingAtlasRgbBytes(material.polycss.leafStyle.backgroundColor)),
      normals: Object.freeze([polycssNormals[c], polycssNormals[a], polycssNormals[b]]),
    });
  });
}

function sampleIntensity(texture, s, t) {
  const wrapped = (value, size) => {
    const result = value % size;
    return result < 0 ? result + size : result;
  };
  const x = wrapped(s, texture.width);
  const y = wrapped(t, texture.height);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = (x0 + 1) % texture.width;
  const y1 = (y0 + 1) % texture.height;
  const fx = x - x0;
  const fy = y - y0;
  const pixels = texture.pixels;
  const top = pixels[(y0 * texture.width + x0) * 4] * (1 - fx)
    + pixels[(y0 * texture.width + x1) * 4] * fx;
  const bottom = pixels[(y1 * texture.width + x0) * 4] * (1 - fx)
    + pixels[(y1 * texture.width + x1) * 4] * fx;
  return Math.max(0, Math.min(255, Math.round(top * (1 - fy) + bottom * fy)));
}

function renderSurfaceNodes(face, frame, texture, ambientScale) {
  const vertices = face.normals.map((normal) => shadeTitleHeadVertex({
    baseRgb: face.baseRgb,
    normal,
    ambientScale,
    lights: frame.lights,
  }));
  const vertexUv = face.normals.map((normal) => generateTitleHeadShineCoordinates({
    normal,
    lookAtModel: frame.lookAtModel,
    hilite: frame.hilite,
  }));
  const primitiveLight = frame.lights.find((light) => light.id === "N228");
  const primitive = primitiveLight?.diffuse.map((value) => Math.max(
    0,
    Math.min(255, Math.trunc(value * primitiveLight.intensity * 255)),
  ));
  if (!primitive) lightingAtlasesFail(`frame ${frame.frame} has no prepared N228 primitive colour`);
  const pixels = Buffer.alloc(SURFACE_CELL_SIZE * SURFACE_CELL_SIZE * 3);
  for (let y = 0; y < SURFACE_CELL_SIZE; y += 1) {
    const v = y / (SURFACE_CELL_SIZE - 1);
    for (let x = 0; x < SURFACE_CELL_SIZE; x += 1) {
      const u = x / (SURFACE_CELL_SIZE - 1);
      const s = affineValue(vertexUv[0][0], vertexUv[1][0], vertexUv[2][0], u, v);
      const t = affineValue(vertexUv[0][1], vertexUv[1][1], vertexUv[2][1], u, v);
      const intensity = sampleIntensity(texture, s, t);
      const alpha = intensity / 255;
      const offset = (y * SURFACE_CELL_SIZE + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const diffuse = affineValue(
          vertices[0][channel],
          vertices[1][channel],
          vertices[2][channel],
          u,
          v,
        );
        pixels[offset + channel] = Math.max(0, Math.min(255, Math.round(
          diffuse * (1 - alpha) + primitive[channel] * alpha,
        )));
      }
    }
  }
  return pixels;
}

function barycentricWeights(x, y, width, height) {
  const top = (height - y) / height;
  const right = (x - width / 2 * top) / width;
  return [top, 1 - top - right, right];
}

function surfaceAlpha(width, height) {
  const alpha = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let covered = 0;
      for (let sampleY = 0; sampleY < ALPHA_SUPERSAMPLES; sampleY += 1) {
        for (let sampleX = 0; sampleX < ALPHA_SUPERSAMPLES; sampleX += 1) {
          const weights = barycentricWeights(
            x + (sampleX + 0.5) / ALPHA_SUPERSAMPLES,
            y + (sampleY + 0.5) / ALPHA_SUPERSAMPLES,
            width,
            height,
          );
          if (weights.every((weight) => weight >= 0 && weight <= 1)) covered += 1;
        }
      }
      alpha[y * width + x] = Math.round(
        covered / (ALPHA_SUPERSAMPLES * ALPHA_SUPERSAMPLES) * 255,
      );
    }
  }
  return alpha;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function preparedTemporalSelectionTileSizes(footprints) {
  return Object.freeze(footprints.map((footprint) => {
    const area = footprint.width * footprint.height;
    const tier = TEMPORAL_SELECTION_SPATIAL_POLICY.tiers.find(
      (entry) => area >= entry.minArea,
    );
    if (!tier) lightingAtlasesFail(`no spatial lighting tier covers ${footprint.width}x${footprint.height}`);
    return Object.freeze({
      width: Math.min(footprint.width, tier.maxDimension),
      height: Math.min(footprint.height, tier.maxDimension),
    });
  }));
}

function buildPreparedStateTimeline(sourceFrames, faceId) {
  const changes = new Uint8Array(LIGHTING_ATLAS_FRAME_COUNT);
  const stateIndices = new Uint16Array(LIGHTING_ATLAS_FRAME_COUNT);
  let previousFrame = -1;
  for (let stateIndex = 0; stateIndex < sourceFrames.length; stateIndex += 1) {
    const sourceFrame = sourceFrames[stateIndex];
    if (sourceFrame >= LIGHTING_ATLAS_FRAME_COUNT
      || sourceFrame <= previousFrame
      || (stateIndex === 0 && sourceFrame !== 0)) {
      lightingAtlasesFail(`${faceId} has an invalid prepared state timeline`);
    }
    if (stateIndex > 0) changes[sourceFrame] = 1;
    previousFrame = sourceFrame;
  }
  if (sourceFrames.length > 1) changes[0] = 1;
  let stateIndex = 0;
  for (let frameIndex = 0;
    frameIndex < LIGHTING_ATLAS_FRAME_COUNT;
    frameIndex += 1) {
    while (stateIndex + 1 < sourceFrames.length
      && sourceFrames[stateIndex + 1] <= frameIndex) {
      stateIndex += 1;
    }
    stateIndices[frameIndex] = stateIndex;
  }
  return Object.freeze({ changes, stateIndices });
}

function buildPreparedStateField(facePlans, timelineNodes, faceCount) {
  const stateCount = facePlans.reduce(
    (total, plan) => total + plan.stateNodeOffsets.length,
    0,
  );
  const bytes = Buffer.alloc(stateCount * TITLE_HEAD_LIGHTING_NODE_BYTES);
  const representativeFrames = [];
  const faces = [];
  const timelines = [];
  let stateIndex = 0;
  for (let faceIndex = 0; faceIndex < facePlans.length; faceIndex += 1) {
    const plan = facePlans[faceIndex];
    if (plan.face.sourceOrder !== faceIndex
      || plan.stateNodeOffsets.length !== plan.sourceFrameIndices.length) {
      lightingAtlasesFail(`prepared lighting face ${faceIndex} escaped source order`);
    }
    const states = plan.stateNodeOffsets.map((nodeOffset, localStateIndex) => {
      timelineNodes.copy(
        bytes,
        stateIndex * TITLE_HEAD_LIGHTING_NODE_BYTES,
        nodeOffset,
        nodeOffset + TITLE_HEAD_LIGHTING_NODE_BYTES,
      );
      representativeFrames.push(
        Math.floor(nodeOffset / TITLE_HEAD_LIGHTING_NODE_BYTES / faceCount),
      );
      const state = Object.freeze({
        sourceFrame: plan.sourceFrameIndices[localStateIndex],
        nodeOffset: stateIndex * TITLE_HEAD_LIGHTING_NODE_BYTES,
      });
      stateIndex += 1;
      return state;
    });
    const sourceFrames = Uint16Array.from(
      states.map((state) => state.sourceFrame),
    );
    timelines.push(buildPreparedStateTimeline(sourceFrames, plan.face.faceId));
    faces.push(Object.freeze({
      faceId: plan.face.faceId,
      sourceOrder: faceIndex,
      tileWidth: plan.size.width,
      tileHeight: plan.size.height,
      temporalMaxRgbDelta: plan.temporalMaxRgbDelta,
      states: Object.freeze(states),
      sourceFrames,
    }));
  }
  if (stateIndex !== stateCount) lightingAtlasesFail("prepared lighting state field lost state order");
  return Object.freeze({
    bytes,
    representativeFrames: Object.freeze(representativeFrames),
    faces: Object.freeze(faces),
    timeline: Object.freeze({
      changesByFace: Object.freeze(
        timelines.map(({ changes }) => changes),
      ),
      stateIndicesByFace: Object.freeze(
        timelines.map(({ stateIndices }) => stateIndices),
      ),
    }),
  });
}

function buildTimelineNodes(faces, timeline, texture) {
  const nodeBytes = SURFACE_CELL_SIZE * SURFACE_CELL_SIZE * 3;
  const output = Buffer.alloc(LIGHTING_ATLAS_FRAME_COUNT * faces.length * nodeBytes);
  for (let frameIndex = 0; frameIndex < LIGHTING_ATLAS_FRAME_COUNT; frameIndex += 1) {
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
      renderSurfaceNodes(
        faces[faceIndex],
        timeline.frames[frameIndex],
        texture,
        timeline.ambientScale,
      ).copy(output, (frameIndex * faces.length + faceIndex) * nodeBytes);
    }
  }
  return output;
}

function renderedTilesWithinRgbDelta(
  tiles,
  tileByteLength,
  leftFrameIndex,
  rightFrameIndex,
  maximumDelta,
) {
  if (tiles.length !== tileByteLength * LIGHTING_ATLAS_FRAME_COUNT || tileByteLength % 4 !== 0) {
    lightingAtlasesFail("rendered lighting tiles have incompatible dimensions");
  }
  let leftOffset = leftFrameIndex * tileByteLength;
  let rightOffset = rightFrameIndex * tileByteLength;
  const leftEnd = leftOffset + tileByteLength;
  for (; leftOffset < leftEnd; leftOffset += 4, rightOffset += 4) {
    if (Math.abs(tiles[leftOffset] - tiles[rightOffset]) > maximumDelta
      || Math.abs(tiles[leftOffset + 1] - tiles[rightOffset + 1]) > maximumDelta
      || Math.abs(tiles[leftOffset + 2] - tiles[rightOffset + 2]) > maximumDelta) {
      return false;
    }
  }
  return true;
}

function greedyCausalHoldPlan(tiles, tileByteLength, maximumDelta) {
  const activationFrameIndices = [0];
  const representativeFrameIndices = [0];
  let representativeFrameIndex = 0;
  for (let frameIndex = 1; frameIndex < LIGHTING_ATLAS_FRAME_COUNT; frameIndex += 1) {
    if (!renderedTilesWithinRgbDelta(
      tiles,
      tileByteLength,
      frameIndex,
      representativeFrameIndex,
      maximumDelta,
    )) {
      activationFrameIndices.push(frameIndex);
      representativeFrameIndices.push(frameIndex);
      representativeFrameIndex = frameIndex;
    }
  }
  return Object.freeze({
    activationFrameIndices: Object.freeze(activationFrameIndices),
    representativeFrameIndices: Object.freeze(representativeFrameIndices),
  });
}

/**
 * At each uncovered frame, every earlier source tile defines one possible
 * causal hold interval. Selecting the interval that reaches farthest is the
 * minimum interval cover of the ordered timeline.
 */
function globallyMinimizedCausalHoldPlan(tiles, tileByteLength, maximumDelta) {
  const activationFrameIndices = [];
  const representativeFrameIndices = [];
  let startFrameIndex = 0;
  while (startFrameIndex < LIGHTING_ATLAS_FRAME_COUNT) {
    let survivors = [];
    for (let representativeFrameIndex = 0;
      representativeFrameIndex <= startFrameIndex;
      representativeFrameIndex += 1) {
      if (renderedTilesWithinRgbDelta(
        tiles,
        tileByteLength,
        startFrameIndex,
        representativeFrameIndex,
        maximumDelta,
      )) {
        survivors.push(representativeFrameIndex);
      }
    }
    if (survivors.length === 0) lightingAtlasesFail(`frame ${startFrameIndex} has no causal lighting state`);

    let endFrameIndex = startFrameIndex;
    while (endFrameIndex + 1 < LIGHTING_ATLAS_FRAME_COUNT) {
      const nextFrameIndex = endFrameIndex + 1;
      const nextSurvivors = survivors.filter((representativeFrameIndex) => (
        renderedTilesWithinRgbDelta(
          tiles,
          tileByteLength,
          nextFrameIndex,
          representativeFrameIndex,
          maximumDelta,
        )
      ));
      if (nextSurvivors.length === 0) break;
      survivors = nextSurvivors;
      endFrameIndex = nextFrameIndex;
    }

    activationFrameIndices.push(startFrameIndex);
    representativeFrameIndices.push(survivors.at(-1));
    startFrameIndex = endFrameIndex + 1;
  }
  return Object.freeze({
    activationFrameIndices: Object.freeze(activationFrameIndices),
    representativeFrameIndices: Object.freeze(representativeFrameIndices),
  });
}

function validateCausalHoldPlan(plan, tiles, tileByteLength, maximumDelta) {
  if (plan.activationFrameIndices.length !== plan.representativeFrameIndices.length
    || plan.activationFrameIndices[0] !== 0) {
    lightingAtlasesFail("causal lighting plan has invalid state arrays");
  }
  for (let stateIndex = 0; stateIndex < plan.activationFrameIndices.length; stateIndex += 1) {
    const activationFrameIndex = plan.activationFrameIndices[stateIndex];
    const representativeFrameIndex = plan.representativeFrameIndices[stateIndex];
    const nextActivationFrameIndex = plan.activationFrameIndices[stateIndex + 1] ?? LIGHTING_ATLAS_FRAME_COUNT;
    if (representativeFrameIndex > activationFrameIndex
      || (stateIndex > 0
        && activationFrameIndex <= plan.activationFrameIndices[stateIndex - 1])) {
      lightingAtlasesFail(`causal lighting state ${stateIndex} has invalid frame ordering`);
    }
    for (let frameIndex = activationFrameIndex;
      frameIndex < nextActivationFrameIndex;
      frameIndex += 1) {
      if (!renderedTilesWithinRgbDelta(
        tiles,
        tileByteLength,
        frameIndex,
        representativeFrameIndex,
        maximumDelta,
      )) {
        lightingAtlasesFail(`causal lighting state ${stateIndex} exceeds its prepared RGB bound`);
      }
    }
  }
}

function temporalMaximumRgbDelta(size) {
  const maximumDimension = Math.max(size.width, size.height);
  const tier = TEMPORAL_RGB_DELTA_POLICY.tiers.find(
    (entry) => maximumDimension >= entry.minimumDimension,
  );
  if (!tier) lightingAtlasesFail(`no temporal lighting tier covers ${size.width}x${size.height}`);
  return tier.maximumDelta;
}

function buildCompactFaceStatePlans(
  faces,
  temporalSelectionSizes,
  outputSizes,
  timelineNodes,
  alphaBySize,
) {
  const nodeBytes = SURFACE_CELL_SIZE * SURFACE_CELL_SIZE * 3;
  return faces.map((face, faceIndex) => {
    const temporalSelectionSize = temporalSelectionSizes[faceIndex];
    const outputSize = outputSizes[faceIndex];
    const sizeKey = `${temporalSelectionSize.width}x${temporalSelectionSize.height}`;
    let alpha = alphaBySize.get(sizeKey);
    if (!alpha) {
      alpha = surfaceAlpha(temporalSelectionSize.width, temporalSelectionSize.height);
      alphaBySize.set(sizeKey, alpha);
    }
    const tileByteLength = temporalSelectionSize.width * temporalSelectionSize.height * 4;
    const renderedTiles = Buffer.alloc(tileByteLength * LIGHTING_ATLAS_FRAME_COUNT);
    const temporalMaxRgbDelta = temporalMaximumRgbDelta(temporalSelectionSize);
    for (let frameIndex = 0; frameIndex < LIGHTING_ATLAS_FRAME_COUNT; frameIndex += 1) {
      const nodeOffset = (frameIndex * faces.length + faceIndex) * nodeBytes;
      const currentTile = renderedTiles.subarray(
        frameIndex * tileByteLength,
        (frameIndex + 1) * tileByteLength,
      );
      writeRenderedTile({
        pagePixels: currentTile,
        pageWidth: temporalSelectionSize.width,
        originX: 0,
        originY: 0,
        width: temporalSelectionSize.width,
        height: temporalSelectionSize.height,
        alpha,
        timelineNodes,
        nodeOffset,
      });
    }
    const greedyPlan = greedyCausalHoldPlan(
      renderedTiles,
      tileByteLength,
      temporalMaxRgbDelta,
    );
    const optimizedPlan = globallyMinimizedCausalHoldPlan(
      renderedTiles,
      tileByteLength,
      temporalMaxRgbDelta,
    );
    if (optimizedPlan.activationFrameIndices.length > greedyPlan.activationFrameIndices.length) {
      lightingAtlasesFail(`${face.faceId} global lighting plan regressed the greedy state count`);
    }
    const selectedPlan = optimizedPlan.activationFrameIndices.length
      < greedyPlan.activationFrameIndices.length
      ? optimizedPlan
      : greedyPlan;
    validateCausalHoldPlan(
      selectedPlan,
      renderedTiles,
      tileByteLength,
      temporalMaxRgbDelta,
    );
    const stateNodeOffsets = selectedPlan.representativeFrameIndices.map(
      (frameIndex) => (frameIndex * faces.length + faceIndex) * nodeBytes,
    );
    const sourceFrameIndices = selectedPlan.activationFrameIndices;
    return Object.freeze({
      face,
      size: outputSize,
      temporalMaxRgbDelta,
      greedyStateCount: greedyPlan.activationFrameIndices.length,
      globallyOptimized: selectedPlan === optimizedPlan,
      stateNodeOffsets: Object.freeze(stateNodeOffsets),
      sourceFrameIndices: Object.freeze(sourceFrameIndices),
    });
  });
}

function chooseBlockLayout(plan) {
  const stateCount = plan.stateNodeOffsets.length;
  const columns = Math.min(MAX_STATE_COLUMNS, stateCount);
  const rows = Math.ceil(stateCount / columns);
  const slotWidth = plan.size.width + TILE_GUTTER;
  const slotHeight = plan.size.height + TILE_GUTTER;
  const width = columns * slotWidth + TILE_GUTTER;
  const height = rows * slotHeight + TILE_GUTTER;
  if (width > PAGE_LIMIT || height > PAGE_LIMIT) {
    lightingAtlasesFail(`${plan.face.faceId} cannot fit its compact prepared state matrix on one page`);
  }
  return {
    ...plan,
    columns,
    rows,
    width,
    height,
    slotWidth,
    slotHeight,
    pageIndex: -1,
    x: -1,
    y: -1,
  };
}

function packBlocks(plans) {
  const blocks = plans.map(chooseBlockLayout).sort((left, right) => (
    right.height - left.height || right.width - left.width || left.face.sourceOrder - right.face.sourceOrder
  ));
  const pages = [];
  const createPage = () => {
    const page = { shelves: [], blocks: [], width: 0, height: 0 };
    pages.push(page);
    return page;
  };
  const placeOnPage = (page, block) => {
    for (const shelf of page.shelves) {
      if (block.height <= shelf.height && shelf.x + block.width <= PAGE_LIMIT) {
        block.x = shelf.x;
        block.y = shelf.y;
        block.pageIndex = pages.indexOf(page);
        shelf.x += block.width;
        page.width = Math.max(page.width, shelf.x);
        page.blocks.push(block);
        return true;
      }
    }
    if (page.height + block.height > PAGE_LIMIT) return false;
    const shelf = { x: block.width, y: page.height, height: block.height };
    page.shelves.push(shelf);
    block.x = 0;
    block.y = page.height;
    block.pageIndex = pages.indexOf(page);
    page.height += block.height;
    page.width = Math.max(page.width, block.width);
    page.blocks.push(block);
    return true;
  };
  for (const block of blocks) {
    let placed = false;
    for (const page of pages) {
      if (placeOnPage(page, block)) {
        placed = true;
        break;
      }
    }
    if (!placed && !placeOnPage(createPage(), block)) {
      lightingAtlasesFail(`${block.face.faceId} cannot be assigned to a static lighting page`);
    }
  }
  const bySourceOrder = Array.from({ length: blocks.length });
  for (const block of blocks) bySourceOrder[block.face.sourceOrder] = block;
  if (bySourceOrder.some((entry) => !entry)) lightingAtlasesFail("packed lighting blocks lost source order");
  return Object.freeze({
    pages: Object.freeze(pages.map((page) => Object.freeze({
      ...page,
      shelves: undefined,
      blocks: Object.freeze(page.blocks),
    }))),
    blocks: Object.freeze(bySourceOrder),
  });
}

function writeRenderedTile({
  pagePixels,
  pageWidth,
  originX,
  originY,
  width,
  height,
  alpha,
  timelineNodes,
  nodeOffset,
}) {
  for (let y = 0; y < height; y += 1) {
    const sourceY = y * (SURFACE_CELL_SIZE - 1) / (height - 1);
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(SURFACE_CELL_SIZE - 1, y0 + 1);
    const yWeight = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const pixelAlpha = alpha[y * width + x];
      const target = ((originY + y) * pageWidth + originX + x) * 4;
      if (pixelAlpha !== 0) {
        const sourceX = x * (SURFACE_CELL_SIZE - 1) / (width - 1);
        const x0 = Math.floor(sourceX);
        const x1 = Math.min(SURFACE_CELL_SIZE - 1, x0 + 1);
        const xWeight = sourceX - x0;
        for (let channel = 0; channel < 3; channel += 1) {
          const top = timelineNodes[nodeOffset + (y0 * SURFACE_CELL_SIZE + x0) * 3 + channel]
            * (1 - xWeight)
            + timelineNodes[nodeOffset + (y0 * SURFACE_CELL_SIZE + x1) * 3 + channel] * xWeight;
          const bottom = timelineNodes[nodeOffset + (y1 * SURFACE_CELL_SIZE + x0) * 3 + channel]
            * (1 - xWeight)
            + timelineNodes[nodeOffset + (y1 * SURFACE_CELL_SIZE + x1) * 3 + channel] * xWeight;
          pagePixels[target + channel] = Math.round(top * (1 - yWeight) + bottom * yWeight);
        }
      }
      pagePixels[target + 3] = pixelAlpha;
    }
  }
}

function lightingAtlasCssNumber(value) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function pagePath(index) {
  return index === 0
    ? "model/title-head-lit-surface.png"
    : `model/title-head-lit-surface-${String(index).padStart(2, "0")}.png`;
}

function prepareTitleHeadLightingAtlases({
  timeline,
  trianglePlan,
  materials,
  textures,
  shineTexture,
  footprintBuild,
} = {}) {
  if (timeline?.schema !== "cssgraphics-title-head-lighting-timeline@1" || timeline.frames?.length !== LIGHTING_ATLAS_FRAME_COUNT) {
    lightingAtlasesFail("the complete regular lighting timeline is required");
  }
  if (trianglePlan?.schema !== "cssgraphics-title-head-triangle-plan@2"
    || materials?.schema !== "cssgraphics-title-head-materials@1"
    || textures?.schema !== "cssgraphics-title-head-textures@1") {
    lightingAtlasesFail("prepared triangle/material/texture contracts are incomplete");
  }
  const atlasPlan = Object.freeze({
    schema: TITLE_HEAD_LIGHTING_ATLAS_PLAN_SCHEMA,
    timelineHash: timeline.contentHash,
    trianglePlanHash: trianglePlan.contentHash,
    materialsHash: materials.contentHash,
    texturesHash: textures.contentHash,
    contentHash: ACCEPTED_LIGHTING_ATLAS_PLAN_HASH,
  });
  const faces = canonicalFaces(trianglePlan, materials);
  if (faces.length !== 1213) lightingAtlasesFail(`expected 1213 faces, got ${faces.length}`);
  const sourceFootprints = footprintBuild?.faces;
  if (footprintBuild?.report?.schema
      !== "cssgraphics-title-head-surface-footprints@1"
    || footprintBuild.report.samples !== LIGHTING_ATLAS_FRAME_COUNT
    || footprintBuild.report.faceCount !== faces.length
    || !Array.isArray(sourceFootprints)
    || sourceFootprints.length !== faces.length) {
    lightingAtlasesFail("the in-memory source-pixel footprints are incomplete");
  }
  const temporalSelectionSizes = preparedTemporalSelectionTileSizes(sourceFootprints);
  const sizes = temporalSelectionSizes;
  const texture = shineTexture;
  if (texture?.width !== 32
    || texture.height !== 32
    || !Buffer.isBuffer(texture.pixels)
    || texture.pixels.length !== 32 * 32 * 4) {
    lightingAtlasesFail("the in-memory shine texture is incomplete");
  }
  const timelineNodes = buildTimelineNodes(faces, timeline, texture);
  const alphaBySize = new Map();
  const facePlans = buildCompactFaceStatePlans(
    faces,
    temporalSelectionSizes,
    sizes,
    timelineNodes,
    alphaBySize,
  );
  const packed = packBlocks(facePlans);
  const pageMetadata = [];
  for (let pageIndex = 0; pageIndex < packed.pages.length; pageIndex += 1) {
    const page = packed.pages[pageIndex];
    const pixels = Buffer.alloc(page.width * page.height * 4);
    for (const block of page.blocks) {
      const sizeKey = `${block.size.width}x${block.size.height}`;
      let alpha = alphaBySize.get(sizeKey);
      if (!alpha) {
        alpha = surfaceAlpha(block.size.width, block.size.height);
        alphaBySize.set(sizeKey, alpha);
      }
      for (let stateIndex = 0; stateIndex < block.stateNodeOffsets.length; stateIndex += 1) {
        const column = stateIndex % block.columns;
        const row = Math.floor(stateIndex / block.columns);
        const originX = block.x + column * block.slotWidth + TILE_GUTTER;
        const originY = block.y + row * block.slotHeight + TILE_GUTTER;
        writeRenderedTile({
          pagePixels: pixels,
          pageWidth: page.width,
          originX,
          originY,
          width: block.size.width,
          height: block.size.height,
          alpha,
          timelineNodes,
          nodeOffset: block.stateNodeOffsets[stateIndex],
        });
      }
    }
    const bytes = encodePngRgba8Paeth(pixels, page.width, page.height);
    pageMetadata.push(Object.freeze({
      path: pagePath(pageIndex),
      role: "title-head-prepared-static-rgba-polygon-flipbook-page",
      width: page.width,
      height: page.height,
      decodedBytes: pixels.length,
      sha256: titleHeadSha256(bytes),
    }));
  }
  const changedStatesByFrame = Array.from({ length: LIGHTING_ATLAS_FRAME_COUNT }, () => []);
  for (const block of packed.blocks) {
    for (let stateIndex = 1; stateIndex < block.sourceFrameIndices.length; stateIndex += 1) {
      changedStatesByFrame[block.sourceFrameIndices[stateIndex]].push(Object.freeze({
        faceIndex: block.face.sourceOrder,
        stateIndex,
      }));
    }
  }
  const sequentialFaceIndices = [];
  const sequentialStateIndices = [];
  const sequentialOffsets = new Uint32Array(LIGHTING_ATLAS_FRAME_COUNT + 1);
  for (let frameIndex = 0; frameIndex < LIGHTING_ATLAS_FRAME_COUNT; frameIndex += 1) {
    sequentialOffsets[frameIndex] = sequentialFaceIndices.length;
    changedStatesByFrame[frameIndex].sort((left, right) => left.faceIndex - right.faceIndex);
    for (const entry of changedStatesByFrame[frameIndex]) {
      sequentialFaceIndices.push(entry.faceIndex);
      sequentialStateIndices.push(entry.stateIndex);
    }
  }
  sequentialOffsets[LIGHTING_ATLAS_FRAME_COUNT] = sequentialFaceIndices.length;
  const sequentialWrites = changedStatesByFrame.slice(1).map((entries) => entries.length);
  let stateOffset = 0;
  const stateBackgroundPositions = [];
  const faceMetadata = packed.blocks.map((block) => {
    const page = packed.pages[block.pageIndex];
    const scaleX = FACE_SIZE / block.size.width;
    const scaleY = FACE_SIZE / block.size.height;
    const initialX = Number(lightingAtlasCssNumber(-(block.x + TILE_GUTTER) * scaleX));
    const initialY = Number(lightingAtlasCssNumber(-(block.y + TILE_GUTTER) * scaleY));
    const columnStep = Number(lightingAtlasCssNumber(-block.slotWidth * scaleX));
    const rowStep = Number(lightingAtlasCssNumber(-block.slotHeight * scaleY));
    const backgroundPositions = Array.from(
      { length: block.stateNodeOffsets.length },
      (_, stateIndex) => {
        const column = stateIndex % block.columns;
        const row = Math.floor(stateIndex / block.columns);
        return `${lightingAtlasCssNumber(initialX + column * columnStep)}px `
          + `${lightingAtlasCssNumber(initialY + row * rowStep)}px`;
      },
    );
    stateBackgroundPositions.push(...backgroundPositions);
    const metadata = Object.freeze({
      faceId: block.face.faceId,
      sourceOrder: block.face.sourceOrder,
      pageIndex: block.pageIndex,
      path: pagePath(block.pageIndex),
      tileWidth: block.size.width,
      tileHeight: block.size.height,
      stateOffset,
      stateCount: block.stateNodeOffsets.length,
      sourceFrameCount: LIGHTING_ATLAS_FRAME_COUNT,
      columns: block.columns,
      rows: block.rows,
      temporalMaxRgbDelta: block.temporalMaxRgbDelta,
      backgroundSize: `${lightingAtlasCssNumber(page.width * scaleX)}px ${lightingAtlasCssNumber(page.height * scaleY)}px`,
      backgroundPosition: backgroundPositions[0],
    });
    stateOffset += block.stateNodeOffsets.length;
    return metadata;
  });
  const stateSourceFrames = packed.blocks.flatMap((block) => block.sourceFrameIndices);
  if (stateOffset !== stateSourceFrames.length
    || stateBackgroundPositions.length !== stateSourceFrames.length
    || stateSourceFrames.length !== faces.length + sequentialFaceIndices.length) {
    lightingAtlasesFail("compact state packing and prepared transitions disagree");
  }
  const decodedBytes = pageMetadata.reduce(
    (total, page) => total + page.decodedBytes,
    0,
  );
  const sourceStates = faces.length * LIGHTING_ATLAS_FRAME_COUNT;
  const greedyTemporalStates = facePlans.reduce(
    (total, plan) => total + plan.greedyStateCount,
    0,
  );
  const globallyOptimizedFaces = facePlans.reduce(
    (total, plan) => total + Number(plan.globallyOptimized),
    0,
  );
  const payload = {
    schema: TITLE_HEAD_LIGHTING_ATLASES_SCHEMA,
    slice: timeline.slice,
    timelineHash: timeline.contentHash,
    trianglePlanHash: trianglePlan.contentHash,
    materialsHash: materials.contentHash,
    texturesHash: textures.contentHash,
    atlasPlanHash: atlasPlan.contentHash,
    footprintAuditHash: titleHeadContentHash(footprintBuild.report),
    topology: "one stable s selects a prepared retained full-RGBA state from one fixed static PNG page",
    canonicalFaceSize: FACE_SIZE,
    frameCount: LIGHTING_ATLAS_FRAME_COUNT,
    cadenceHz: 30,
    approximation: Object.freeze({
      kind: "source-timeline-with-bounded-spatial-raster-and-temporal-hold",
      policy: FLIPBOOK_SPATIAL_POLICY,
      temporalSampling: "all 820 prepared source frames; globally minimized causal holds by the frozen baseline selection raster",
      temporalRgbDeltaPolicy: TEMPORAL_RGB_DELTA_POLICY,
      temporalSelectionSpatialPolicy: TEMPORAL_SELECTION_SPATIAL_POLICY,
      temporalMaximumRgbDelta: Math.max(
        ...TEMPORAL_RGB_DELTA_POLICY.tiers.map((entry) => entry.maximumDelta),
      ),
      temporalOptimization: Object.freeze({
        kind: "minimum-causal-source-representative-interval-cover",
        objective: "fewest ordered hold states under the unchanged per-face rendered-tile RGB bound",
        representative: "exact prepared source tile at or before its activation frame",
        futureAnticipation: false,
        appliedOnlyWhenStateCountDecreases: true,
        runtimeWork: false,
      }),
      fieldWidth: SURFACE_CELL_SIZE,
      fieldHeight: SURFACE_CELL_SIZE,
    }),
    surface: Object.freeze({
      storage: "compact-fixed-page-static-rgba-polygon-state-matrix",
      composition: "prepared diffuse plus prepared source shine plus exact supersampled triangle alpha",
      pageLimit: PAGE_LIMIT,
      tileGutter: TILE_GUTTER,
      statePacking: Object.freeze({
        maximumColumns: MAX_STATE_COLUMNS,
        sourceFrameCount: LIGHTING_ATLAS_FRAME_COUNT,
        stateCount: stateSourceFrames.length,
        sourceFramesEncoding: "face-major-uint16le-base64",
        sourceFramesMeaning: "state activation frames; an atlas state may use an earlier causal source tile",
        sourceFramesBase64: uint16LeBase64(stateSourceFrames),
        backgroundPositionsEncoding: "face-major-css-pixel-pair-array",
        backgroundPositions: Object.freeze(stateBackgroundPositions),
      }),
      pages: Object.freeze(pageMetadata),
      faces: Object.freeze(faceMetadata),
      cssLayers: 1,
      cssMask: false,
      cssFilter: false,
      cssBlend: false,
      cssPseudoElements: 0,
    }),
    transitions: Object.freeze({
      initialFrame: 1,
      selection: "prepared bounded-delta changed-face ranges assign prepared literal background positions only to affected stable leaves",
      hold: Object.freeze({
        comparison: "maximum final rendered tile RGB channel delta from the selected causal source representative",
        policy: TEMPORAL_RGB_DELTA_POLICY,
        maximumDelta: Math.max(
          ...TEMPORAL_RGB_DELTA_POLICY.tiers.map((entry) => entry.maximumDelta),
        ),
        interpolation: false,
      }),
      sequential: Object.freeze({
        encoding: "csr-uint32le-offsets-parallel-uint16le-face-state-indices-base64",
        offsetCount: sequentialOffsets.length,
        faceIndexCount: sequentialFaceIndices.length,
        stateIndexCount: sequentialStateIndices.length,
        offsetsBase64: uint32LeBase64(sequentialOffsets),
        faceIndicesBase64: uint16LeBase64(sequentialFaceIndices),
        stateIndicesBase64: uint16LeBase64(sequentialStateIndices),
      }),
      nonSequentialFallback: "prepared per-face retained-state lookup updates every stable leaf",
    }),
    totals: Object.freeze({
      pages: pageMetadata.length,
      faces: faces.length,
      sourceStates,
      states: stateSourceFrames.length,
      discardedStates: sourceStates - stateSourceFrames.length,
      greedyTemporalStates,
      globallyOptimizedTemporalStates: stateSourceFrames.length,
      globallyRemovedTemporalStates: greedyTemporalStates - stateSourceFrames.length,
      globallyOptimizedFaces,
      decodedBytes,
      sequentialWrites: Object.freeze({
        mean: sequentialWrites.reduce((total, value) => total + value, 0)
          / sequentialWrites.length,
        p50: percentile(sequentialWrites, 0.5),
        p95: percentile(sequentialWrites, 0.95),
        max: Math.max(...sequentialWrites),
      }),
    }),
    runtime: Object.freeze({
      rootFrameVariables: 0,
      leafFrameVariables: "prepared-changed-only",
      imageUrlWrites: 0,
      browserImageAnimation: false,
      lightingCalculations: 0,
      frameFaceScans: 0,
      operation: "prepared sequential dirty-face literal background-position writes",
    }),
  };
  const contract = Object.freeze({ ...payload, contentHash: titleHeadContentHash(payload) });
  const preparedStateField = buildPreparedStateField(facePlans, timelineNodes, faces.length);
  const stateFieldPayload = Object.freeze({
    schema: TITLE_HEAD_LIGHTING_STATE_FIELD_SCHEMA,
    sourceLightingHash: contract.contentHash,
    timelineHash: timeline.contentHash,
    trianglePlanHash: trianglePlan.contentHash,
    materialsHash: materials.contentHash,
    faceCount: faces.length,
    stateCount: stateSourceFrames.length,
    fieldWidth: SURFACE_CELL_SIZE,
    fieldHeight: SURFACE_CELL_SIZE,
    channels: "RGB",
    bytesPerState: TITLE_HEAD_LIGHTING_NODE_BYTES,
    ordering: "face-major compact-state order matching surface.statePacking",
    representativeFramesEncoding: "face-major-uint16le-base64",
    representativeFramesBase64: uint16LeBase64(preparedStateField.representativeFrames),
    bytesSha256: titleHeadSha256(preparedStateField.bytes),
  });
  const stateFieldContract = Object.freeze({
    ...stateFieldPayload,
    contentHash: titleHeadContentHash(stateFieldPayload),
  });
  return Object.freeze({
    atlasPlan,
    contract,
    stateField: Object.freeze({
      contract: stateFieldContract,
      bytes: preparedStateField.bytes,
    }),
    workspace: Object.freeze({
      lightingHash: contract.contentHash,
      stateFieldHash: stateFieldContract.contentHash,
      faces: preparedStateField.faces,
      timeline: preparedStateField.timeline,
    }),
  });
}

// spaceTimeTexelsProducer
const SPACE_TIME_FRAME_COUNT = 820;
const FACE_COUNT = 1213;
const FIELD_SIZE = 4;
const NODE_BYTES = FIELD_SIZE * FIELD_SIZE * 3;
const WIDTH = FACE_COUNT * FIELD_SIZE;
const HEIGHT = SPACE_TIME_FRAME_COUNT * FIELD_SIZE;
const ACCEPTED_NATIVE_PNG_SHA256 =
  "8e4c04d810d4d2eb1654a9e873bfce9e725930289a597f180adf4758f8f9e7ad";
const ACCEPTED_SURFACE_PNG_SHA256 =
  "8c3d58b01f040026b14f932b9047948cad675c6f89205121ec14b3cb3da808db";

function spaceTimeFail(message) {
  throw new Error(`cssGraphics space-time texels: ${message}`);
}

function encodeLosslessWebp(bytes) {
  return sharp(bytes, {
    raw: { width: WIDTH, height: HEIGHT, channels: 3 },
    failOn: "error",
  })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
}

function spaceTimeCssNumber(value) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

async function prepareTitleHeadSpaceTimeTexels({
  lightingBuild,
  sourceLightingBuild,
  trianglePlan,
}) {
const {
  contract: lighting,
  workspace,
} = lightingBuild ?? {};
const {
  contract: sourceLighting,
  stateField,
  workspace: sourceWorkspace,
} = sourceLightingBuild ?? {};
const stateFieldContract = stateField.contract;
const stateNodes = stateField.bytes;

if (lighting?.schema !== "cssgraphics-title-head-lighting-atlases@9"
  || lighting.frameCount !== SPACE_TIME_FRAME_COUNT
  || lighting.surface?.faces?.length !== FACE_COUNT
  || sourceLighting?.schema !== "cssgraphics-title-head-lighting-atlases@7"
  || sourceLighting.frameCount !== SPACE_TIME_FRAME_COUNT
  || sourceLighting.surface?.faces?.length !== FACE_COUNT
  || trianglePlan?.schema !== "cssgraphics-title-head-triangle-plan@2"
  || trianglePlan.contentHash !== lighting.trianglePlanHash
  || trianglePlan.leaves?.length !== FACE_COUNT
  || workspace?.lightingHash !== lighting.contentHash
  || workspace.sourceLightingHash !== sourceLighting.contentHash
  || workspace.stateFieldHash !== stateFieldContract.contentHash
  || workspace.faces?.length !== FACE_COUNT
  || sourceWorkspace?.lightingHash !== sourceLighting.contentHash
  || sourceWorkspace.stateFieldHash !== stateFieldContract.contentHash
  || stateFieldContract.sourceLightingHash !== sourceLighting.contentHash
  || stateFieldContract.bytesPerState !== NODE_BYTES
  || stateNodes.length !== stateFieldContract.stateCount * NODE_BYTES
  || stateFieldContract.bytesSha256 !== titleHeadSha256(stateNodes)) {
  spaceTimeFail("the completed compact lighting closure is incomplete or mixed");
}

const nativePixels = Buffer.alloc(WIDTH * HEIGHT * 3);
const faces = [];
const backgroundPositionYs = [];
let currentOffset = 0;

for (let faceIndex = 0; faceIndex < FACE_COUNT; faceIndex += 1) {
  const currentFace = lighting.surface.faces[faceIndex];
  const preparedFace = workspace.faces[faceIndex];
  const retainedActivationFrames = preparedFace?.sourceFrames;
  const retainedStates = preparedFace?.states;
  if (preparedFace?.sourceOrder !== faceIndex
    || currentFace?.sourceOrder !== faceIndex
    || preparedFace.faceId !== currentFace.faceId
    || currentFace.stateOffset !== currentOffset
    || retainedStates?.length !== currentFace.stateCount
    || retainedActivationFrames?.length !== retainedStates.length) {
    spaceTimeFail(`face ${faceIndex} is reordered`);
  }

  let retainedStateIndex = 0;
  for (let frameIndex = 0; frameIndex < SPACE_TIME_FRAME_COUNT; frameIndex += 1) {
    while (retainedStateIndex + 1 < retainedActivationFrames.length
      && retainedActivationFrames[retainedStateIndex + 1] <= frameIndex) {
      retainedStateIndex += 1;
    }
    const nodeOffset = retainedStates[retainedStateIndex].nodeOffset;
    const originX = faceIndex * FIELD_SIZE;
    const originY = frameIndex * FIELD_SIZE;
    for (let y = 0; y < FIELD_SIZE; y += 1) {
      for (let x = 0; x < FIELD_SIZE; x += 1) {
        const nodePixel = (y * FIELD_SIZE + x) * 3;
        const nativePixel = ((originY + y) * WIDTH + originX + x) * 3;
        nativePixels[nativePixel] = stateNodes[nodeOffset + nodePixel];
        nativePixels[nativePixel + 1] = stateNodes[nodeOffset + nodePixel + 1];
        nativePixels[nativePixel + 2] = stateNodes[nodeOffset + nodePixel + 2];
      }
    }
  }

  const scaleX = currentFace.leafWidth / FIELD_SIZE;
  const scaleY = currentFace.leafHeight / FIELD_SIZE;
  const faceBackgroundPositionYs = Array.from(
    retainedActivationFrames,
    (frame) => `${spaceTimeCssNumber(-frame * currentFace.leafHeight)}px`,
  );
  backgroundPositionYs.push(...faceBackgroundPositionYs);
  const {
    backgroundPosition: _backgroundPosition,
    ...stableFace
  } = currentFace;
  faces.push(Object.freeze({
    ...stableFace,
    pageIndex: 0,
    path: "model/title-head-lit-surface.png",
    tileWidth: FIELD_SIZE,
    tileHeight: FIELD_SIZE,
    backgroundSize:
      `${spaceTimeCssNumber(WIDTH * scaleX)}px ${spaceTimeCssNumber(HEIGHT * scaleY)}px`,
    backgroundPositionX:
      `${spaceTimeCssNumber(-faceIndex * currentFace.leafWidth)}px`,
    backgroundPositionY: faceBackgroundPositionYs[0],
  }));
  currentOffset += retainedStates.length;
}

if (currentOffset !== lighting.surface.statePacking.stateCount
  || backgroundPositionYs.length !== currentOffset) {
  spaceTimeFail("the repacked state positions are incomplete");
}

const nativeWebpBytes = await encodeLosslessWebp(nativePixels);
const nativeWebpSha256 = titleHeadSha256(nativeWebpBytes);
const decodedBytes = WIDTH * HEIGHT * 4;
const page = Object.freeze({
  path: "model/title-head-lit-surface.png",
  role: "title-head-prepared-space-time-static-rgba-polygon-frame-matrix",
  encoding: "PNG-RGBA8",
  width: WIDTH,
  height: HEIGHT,
  decodedBytes,
  sha256: ACCEPTED_SURFACE_PNG_SHA256,
  native: Object.freeze({
    path: "model/title-head-lit-native.png",
    role:
      "title-head-prepared-space-time-static-opaque-rgb-native-shape-frame-matrix",
    encoding: "PNG-RGB8",
    opaque: true,
    width: WIDTH,
    height: HEIGHT,
    sourceBytes: nativePixels.length,
    decodedBytes,
    sha256: ACCEPTED_NATIVE_PNG_SHA256,
  }),
});

const {
  contentHash: _contentHash,
  ...stableLighting
} = lighting;
const {
  backgroundPositions: _backgroundPositions,
  backgroundPositionsEncoding: _backgroundPositionsEncoding,
  ...stableStatePacking
} = lighting.surface.statePacking;
const payload = Object.freeze({
  ...stableLighting,
  topology:
    "stable native PolyCSS triangles select opaque 4x4 lighting fields from one prepared face-by-frame space-time matrix",
  approximation: Object.freeze({
    ...lighting.approximation,
    spaceTimePacking: Object.freeze({
      kind: "source-order-face-columns-by-source-frame-rows",
      faceColumns: FACE_COUNT,
      frameRows: SPACE_TIME_FRAME_COUNT,
      fieldWidth: FIELD_SIZE,
      fieldHeight: FIELD_SIZE,
      runtimeWork: false,
    }),
  }),
  surface: Object.freeze({
    ...lighting.surface,
    nativeShape: Object.freeze({
      ...lighting.surface.nativeShape,
      storage:
        "visibility-compacted-fixed-page-static-opaque-rgb-polygon-state-matrix",
      layout: "source-order-face-columns-by-source-frame-rows",
      fieldWidth: FIELD_SIZE,
      fieldHeight: FIELD_SIZE,
      alphaChannel: false,
    }),
    rasterDensity: Object.freeze({
      ...lighting.surface.rasterDensity,
      textureFieldWidth: FIELD_SIZE,
      textureFieldHeight: FIELD_SIZE,
      geometryResolution:
        "native PolyCSS shape independent of lighting field",
      runtimeWork: false,
    }),
    statePacking: Object.freeze({
      ...stableStatePacking,
      physicalLayout: "source-order-face-columns-by-source-frame-rows",
      backgroundPositionYsEncoding: "face-major-css-pixel-array",
      backgroundPositionYs: Object.freeze(backgroundPositionYs),
    }),
    pages: Object.freeze([page]),
    faces: Object.freeze(faces),
  }),
  totals: Object.freeze({
    ...lighting.totals,
    pages: 1,
    decodedBytes,
    nativeSourceBytes: nativePixels.length,
    nativeDecodedBytes: decodedBytes,
  }),
});
const contract = Object.freeze({
  ...payload,
  contentHash: titleHeadContentHash(payload),
});

return Object.freeze({
  contract,
  nativeWebpSha256,
  files: Object.freeze([
    Object.freeze({
      path: "model/title-head-lit-native.webp",
      role:
        "title-head-prepared-space-time-static-opaque-rgb-native-shape-frame-matrix-webp",
      bytes: nativeWebpBytes,
    }),
    Object.freeze({
      path: "lighting-atlases.json",
      role: "title-head-lighting-atlases-contract",
      bytes: Buffer.from(serializeTitleHeadContract(contract)),
    }),
    Object.freeze({
      path: TITLE_HEAD_LEAF_STYLES_PATH,
      role: "title-head-prepared-leaf-styles",
      bytes: Buffer.from(buildTitleHeadLeafStyles({
        trianglePlan,
        lighting: contract,
      })),
    }),
  ]),
});
}
export {
  buildTitleHeadLightingTimeline,
  buildTitleHeadLightingTimelineReport,
  prepareTitleHeadLightingAtlases,
  prepareTitleHeadSpaceTimeTexels,
};
