// SPDX-License-Identifier: HPND
import { Buffer } from "node:buffer";
import {
  CSSCITYFLOW_FACE_IDS,
  CSSCITYFLOW_FRAME_MILLISECONDS,
  CSSCITYFLOW_PREPARED_FRAME_COUNT,
  CSSCITYFLOW_PRESENTATION_FRAME_COUNT,
  CSSCITYFLOW_PRESENTATION_FRAME_MILLISECONDS,
  buildCityflowSourceState,
  cityflowFrameAt,
} from "./sourceModel.mjs";
import preparedVisibility from "../../../notes/references/prepared-visibility.json" with { type: "json" };
import preparedEasedVisibility from "../../../notes/references/prepared-visibility-adaptive-smooth-sine.json" with { type: "json" };
import preparedWideVisibility from "../../../notes/references/prepared-visibility-wide.json" with { type: "json" };
import preparedSideDepth from "../../../notes/references/prepared-side-depth.json" with { type: "json" };
import preparedStaticVisibility from "../../../notes/references/prepared-static-visibility.json" with { type: "json" };
import { buildCityflowPreparedTransformTable } from "../../csscityflow/preparedTransformTable.mjs";

const MAXIMUM_BRIEF_DIRECTION_RUN_FRAMES = 12;
const PRESENTATION_EASING_RAMP_START_FRAMES = 24;
const PRESENTATION_EASING_RAMP_FULL_FRAMES = 54;
const PRESENTATION_EASING_MAXIMUM_CENTER_REDUCTION = 0.6;

const SOURCE_MODEL_MATRIX = Object.freeze([
  29.600317554756, 6.483735104931, 8.604207095757, 0,
  -10.773634514759, 17.813915794524, 23.639864707904, 0,
  0, 25.15701856649, -18.95717322929, 0,
  -2.7, -2.7, -30, 1,
]);
export const CSSCITYFLOW_SOURCE_BOTTOM = 5;
export const CSSCITYFLOW_SOURCE_FAR_PLANE = -50;
const CSSCITYFLOW_SOURCE_VIEW = Object.freeze({
  cameraDistance: 30,
  worldScale: 15,
  floorRotationDegrees: -90,
  floorOffsetX: -0.18,
  floorOffsetZ: -0.18,
  tiltDegrees: 37,
  turnDegrees: 20,
  boxScale: 2.1,
});
const CSSCITYFLOW_DESKTOP_DEFAULT_SIDE_DEPTH_SCALE = preparedSideDepth.defaultDepthScale;
const CSSCITYFLOW_DESKTOP_SIDE_DEPTH_BY_FACE_INDEX = validatePreparedSideDepth(preparedSideDepth);
const CSSCITYFLOW_DESKTOP_STATIC_VISIBILITY = validatePreparedStaticVisibility(preparedStaticVisibility);
const TOP_FACE_MATRIX = Object.freeze([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.5, -0.5, 1, 1,
]);

export function buildCityflowMorphModel(options = {}) {
  const state = buildCityflowSourceState(options);
  const initialFrame = cityflowFrameAt(state, 0);
  const shapeIds = state.boxes.map((box) => `box-${String(box.renderIndex).padStart(4, "0")}`);
  const polygons = [];
  const vertices = [];
  const leaves = state.boxes.flatMap((box, boxIndex) => CSSCITYFLOW_FACE_IDS.map((faceId, faceIndex) => {
    const leafIndex = boxIndex * CSSCITYFLOW_FACE_IDS.length + faceIndex;
    const polygonId = `polygon-${String(leafIndex).padStart(4, "0")}`;
    const vertexOffset = vertices.length;
    vertices.push(
      Object.freeze([0, 0, 0]),
      Object.freeze([1, 0, 0]),
      Object.freeze([1, 1, 0]),
      Object.freeze([0, 1, 0]),
    );
    polygons.push(Object.freeze({
      id: polygonId,
      vertexIndices: Object.freeze([vertexOffset, vertexOffset + 1, vertexOffset + 2, vertexOffset + 3]),
      normalIndices: Object.freeze([faceIndex, faceIndex, faceIndex, faceIndex]),
    }));
    return Object.freeze({
      id: `${shapeIds[boxIndex]}-${faceId}`,
      polygonId,
      shapeId: shapeIds[boxIndex],
      materialId: "cityflow-face",
      strategy: "solid-quad",
      width: 1,
      height: 1,
      matrix: preparedFaceMatrix(state.source.id, boxIndex, faceId, faceIndex),
      atlas: null,
      fallback: null,
    });
  }));
  return Object.freeze({
    state,
    model: Object.freeze({
      schema: "polycss-morph.model@1",
      identity: Object.freeze({ id: state.source.modelId, name: state.source.name, revision: "1.0.0" }),
      profile: "static-prepared",
      capabilities: Object.freeze(["retained-render"]),
      budgets: Object.freeze({
        maxVertices: vertices.length,
        maxPolygons: polygons.length,
        maxLeaves: leaves.length,
        maxFrames: 0,
        maxJoints: 0,
        maxResources: 1,
        maxBytes: 16 * 1024 * 1024,
      }),
      topology: Object.freeze({
        vertices: Object.freeze(vertices),
        normals: Object.freeze([
          Object.freeze([0, 0, -1]),
          Object.freeze([0, 1, 0]),
          Object.freeze([1, 0, 0]),
        ]),
        polygons: Object.freeze(polygons),
      }),
      materials: Object.freeze([Object.freeze({
        id: "cityflow-face",
        color: Object.freeze([1, 1, 1, 1]),
      })]),
      render: Object.freeze({
        modelMatrix: SOURCE_MODEL_MATRIX,
        shapes: Object.freeze(shapeIds.map((id, index) => Object.freeze({
          id,
          matrix: boxStateMatrix(state.boxes[index], initialFrame.boxes[index]),
        }))),
        leaves: Object.freeze(leaves),
      }),
      deformation: Object.freeze({ kind: "none" }),
      controls: Object.freeze([]),
      springs: Object.freeze([]),
      animations: Object.freeze([]),
      playback: null,
      provenance: Object.freeze({
        generator: "csscityflow-preparer",
        generatorVersion: "1.0.0",
        sources: Object.freeze([Object.freeze({
          id: "xscreensaver-cityflow",
          kind: "open-data",
          uri: `https://github.com/Zygo/xscreensaver/blob/${state.source.commit}/${state.source.primaryPath}`,
          sha256: state.source.primarySha256,
          license: "HPND",
        })]),
      }),
    }),
  });
}

function boxStateMatrix(box, sample) {
  const clippedBottoms = cityflowClippedBottoms(box);
  return Object.freeze(boxPlaybackMatrixValues(
    box,
    -sample.height / 2,
    Math.min(clippedBottoms.front, clippedBottoms.right),
  ));
}

export function cityflowClippedBottoms(box) {
  const x = box.centerX;
  const y = box.centerY;
  const xw = box.cth * box.width / 2;
  const xd = box.sth * box.depth / 2;
  const yw = -box.sth * box.width / 2;
  const yd = box.cth * box.depth / 2;
  return Object.freeze({
    front: clippedBottom([
      [x + xw + xd, y + yw + yd],
      [x - xw + xd, y - yw + yd],
    ]),
    right: clippedBottom([
      [x + xw - xd, y + yw - yd],
      [x + xw + xd, y + yw + yd],
    ]),
  });
}

function clippedBottom(edge) {
  return Math.min(CSSCITYFLOW_SOURCE_BOTTOM, ...edge.map(([x, y]) => {
    const eyeZAtZero = cityflowEyeZ(x, y, 0);
    const eyeZPerZ = cityflowEyeZ(x, y, 1) - eyeZAtZero;
    return (CSSCITYFLOW_SOURCE_FAR_PLANE - eyeZAtZero) / eyeZPerZ;
  }));
}

export function cityflowEyeZ(x, y, z) {
  let point = [
    x * CSSCITYFLOW_SOURCE_VIEW.boxScale,
    y * CSSCITYFLOW_SOURCE_VIEW.boxScale,
    z * CSSCITYFLOW_SOURCE_VIEW.boxScale,
  ];
  point = rotateZ(point, CSSCITYFLOW_SOURCE_VIEW.turnDegrees);
  point = rotateX(point, CSSCITYFLOW_SOURCE_VIEW.tiltDegrees);
  point = [
    point[0] + CSSCITYFLOW_SOURCE_VIEW.floorOffsetX,
    point[1],
    point[2] + CSSCITYFLOW_SOURCE_VIEW.floorOffsetZ,
  ];
  point = rotateX(point, CSSCITYFLOW_SOURCE_VIEW.floorRotationDegrees);
  point = point.map((value) => value * CSSCITYFLOW_SOURCE_VIEW.worldScale);
  point = rotateX(point, -180);
  return point[2] - CSSCITYFLOW_SOURCE_VIEW.cameraDistance;
}

function rotateX([x, y, z], degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [x, cosine * y - sine * z, sine * y + cosine * z];
}

function rotateZ([x, y, z], degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [cosine * x - sine * y, sine * x + cosine * y, z];
}

export function buildCityflowPreparedCss(state) {
  return [
    `:root{--csscityflow-background:${paletteColor(state.palette[0])}}`,
    `.polycss-scene>div>b{position:absolute;display:block!important;width:1px;height:1px;` +
      `margin:0;padding:0;border:0;transform-style:preserve-3d;transform-origin:0 0;` +
      `backface-visibility:hidden;-webkit-backface-visibility:hidden}`,
    `.polycss-scene>div>b:nth-child(1){backface-visibility:visible;` +
      `-webkit-backface-visibility:visible}`,
  ].join("");
}

export function buildCityflowPreparedPlayback(state) {
  const frameCount = CSSCITYFLOW_PRESENTATION_FRAME_COUNT;
  const sourceFrameCount = CSSCITYFLOW_PREPARED_FRAME_COUNT;
  const boxCount = state.boxes.length;
  const paletteSize = state.palette.length;
  const staticVisibility = state.source.id === "desktop"
    ? CSSCITYFLOW_DESKTOP_STATIC_VISIBILITY
    : buildFullyVisibleStaticVisibility(state, frameCount);
  const sideDepth = cityflowPreparedSideDepthProfile(state.source.id);
  const presentationTransformIndices = new Uint16Array(frameCount * boxCount);
  const presentationMaterialIndices = new Uint16Array(frameCount * boxCount);
  const sourceTransformIndices = new Uint16Array(sourceFrameCount * boxCount);
  const sourceMaterialIndices = new Uint16Array(sourceFrameCount * boxCount);
  const transformBanks = Array.from({ length: boxCount }, () => []);
  const transformIndexByValue = Array.from({ length: boxCount }, () => new Map());
  const materials = [];
  const materialIndexByValue = new Map();
  const paletteMaterialIndices = new Uint16Array(boxCount * paletteSize);
  const materialIndex = (material) => {
    const key = material.join(",");
    let index = materialIndexByValue.get(key);
    if (index === undefined) {
      index = materials.length;
      if (index > 0xffff) {
        throw new Error("Cityflow prepared materials exceeded uint16");
      }
      materialIndexByValue.set(key, index);
      materials.push(Object.freeze(material));
    }
    return index;
  };
  const bottoms = state.boxes.map((box) => {
    const clipped = cityflowClippedBottoms(box);
    return Math.min(clipped.front, clipped.right);
  });

  for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
    const box = state.boxes[boxIndex];
    for (let paletteIndex = 0; paletteIndex < paletteSize; paletteIndex += 1) {
      const material = CSSCITYFLOW_FACE_IDS.map((_, faceIndex) =>
        litPaletteColor(state.palette[paletteIndex], box.lightFactors[faceIndex]));
      paletteMaterialIndices[boxIndex * paletteSize + paletteIndex] =
        materialIndex(material);
    }
  }

  const sourceFrames = buildCityflowSourceFrames(state);
  const transformIndex = (boxIndex, height) => {
    const transform = boxPlaybackMatrix(
      state.boxes[boxIndex],
      -height / 2,
      bottoms[boxIndex],
    );
    let index = transformIndexByValue[boxIndex].get(transform);
    if (index === undefined) {
      index = transformBanks[boxIndex].length;
      if (index > 0xffff) throw new Error("Cityflow per-box transforms exceeded uint16");
      transformIndexByValue[boxIndex].set(transform, index);
      transformBanks[boxIndex].push(transform);
    }
    return index;
  };
  for (let frameIndex = 0; frameIndex < sourceFrameCount; frameIndex += 1) {
    for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
      const sample = sourceFrames[frameIndex].boxes[boxIndex];
      const offset = frameIndex * boxCount + boxIndex;
      sourceTransformIndices[offset] = transformIndex(boxIndex, sample.height);
      sourceMaterialIndices[offset] =
        paletteMaterialIndices[boxIndex * paletteSize + sample.colorIndex];
    }
  }

  const presentationHeights = buildCityflowPreparedHeightRows(state, sourceFrames);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
      const height = presentationHeights[frameIndex][boxIndex];
      const palettePosition = height * paletteSize * 0.7;
      const offset = frameIndex * boxCount + boxIndex;
      presentationTransformIndices[offset] = transformIndex(boxIndex, height);
      presentationMaterialIndices[offset] = materialIndex(
        CSSCITYFLOW_FACE_IDS.map((_, faceIndex) => interpolatedLitPaletteColor(
          state.palette,
          palettePosition,
          state.boxes[boxIndex].lightFactors[faceIndex],
        )),
      );
    }
  }

  const transforms = [];
  const transformOffsets = [0];
  for (const bank of transformBanks) {
    transforms.push(...bank);
    transformOffsets.push(transforms.length);
  }
  const transformTable = buildCityflowPreparedTransformTable(transforms, transformOffsets);
  const presentationColorTransitions = buildPresentationColorTransitions({
    frameCount,
    boxCount,
    facesPerBox: CSSCITYFLOW_FACE_IDS.length,
    materials,
    presentationMaterialIndices,
    staticVisibility,
  });

  return Object.freeze({
    schema: "csscityflow-prepared-playback@58",
    precedent: "domformat@0/polycss-playback@0@cc8da736",
    bankId: state.source.id,
    modelId: state.source.modelId,
    catchUpPolicy: "adjacent-state-late-deadline-reset",
    frameCount,
    tickIntervalUs: Object.freeze([50_000, 3]),
    sourceFrameCount,
    sourceTickIntervalUs: Object.freeze([CSSCITYFLOW_FRAME_MILLISECONDS * 1_000, 1]),
    boxCount,
    paletteSize,
    facesPerBox: CSSCITYFLOW_FACE_IDS.length,
    staticVisibility,
    sideDepth: Object.freeze({
      schema: preparedSideDepth.schema,
      defaultDepthScale: sideDepth.defaultDepthScale,
      maximumDepthScale: sideDepth.maximumDepthScale,
      overrideCount: sideDepth.byFaceIndex.size,
    }),
    loop: Object.freeze({
      kind: "prepared-periodic-source-sample-reconstruction",
      exactSourceLoop: false,
      phaseStepRadians: Math.PI * 2 / frameCount,
      sourcePeriodFrames: Math.PI * 2 / 0.025,
      presentationPeriodFrames: frameCount,
      closureContinuity:
        "periodic-zero-sum-twelve-frame-direction-run-folded-adaptive-smooth-sine-eased-sample-cycle",
    }),
    presentation: Object.freeze({
      kind: "prepared-periodic-source-sample-reconstruction",
      sourceFramesPerSecond: 1_000 / CSSCITYFLOW_FRAME_MILLISECONDS,
      framesPerSecond: 60,
      exactSourceStateSeek: true,
      heightInterpolation: "periodic-uniform-cubic-b-spline-c2-source-approximation",
      temporalFilter:
        "prepared-periodic-five-tap-fold-twelve-three-tap-refold-twelve-five-tap-refold-twelve-adaptive-smooth-sine-eased-extrema@1",
      directionRunSuppression:
        "prepared-circular-twelve-frame-or-short-direction-run-folding-zero-sum-adaptive-smooth-sine-24-54-0.6-eased@1",
      colorInterpolation:
        "prepared-srgb-interpolated-final-face-color",
      transformPublication:
        "prepared-packed-transform-components-expanded-once-plus-sparse-final-face-color-and-whole-box-leaf-visibility-publication",
      statePublication: Object.freeze({
        schema: "csscityflow-prepared-state-publication@22",
        frameCount,
        animationCount: 0,
        runtimeFormatting: false,
        loadTimeAssembly: "one-time-prepared-transform-component-table-expansion",
        sourceSeekAssembly: "none-cached-expanded-transform-and-final-face-color-dictionaries",
        atomicProperties:
          "prepared-root-transform-plus-direct-leaf-visibility-and-final-face-background-color",
        minimumShapeStyleWritesPerScheduledTick: 0,
        maximumShapeStyleWritesPerScheduledTick:
          staticVisibility.presentation.maximumVisibleBoxes,
        maximumLeafColorStyleWritesPerScheduledTick:
          presentationColorTransitions.maximumWritesPerFrame,
        maximumVisibilityStyleWritesPerScheduledTick:
          staticVisibility.presentation.maximumTransitionWritesPerFrame *
            CSSCITYFLOW_FACE_IDS.length,
      }),
    }),
    transformTable,
    transformIndices: Object.freeze({
      schema: "csscityflow-prepared-transform-indices@2",
      encoding: "per-box-u16le-base64-plus-transform-offsets",
      count: frameCount * boxCount,
      transformOffsets: Object.freeze(transformOffsets),
      presentationBase64: Buffer.from(presentationTransformIndices.buffer).toString("base64"),
      sourceCount: sourceFrameCount * boxCount,
      sourceBase64: Buffer.from(sourceTransformIndices.buffer).toString("base64"),
    }),
    colors: Object.freeze({
      schema: "csscityflow-prepared-face-local-materials@7",
      encoding:
        "prepared-three-final-color-tuples-plus-packed-absolute-indices-and-sparse-presentation-transitions",
      materials: Object.freeze(materials),
      presentationMaterialIndicesBase64:
        Buffer.from(presentationMaterialIndices.buffer).toString("base64"),
      sourceMaterialIndicesBase64:
        Buffer.from(sourceMaterialIndices.buffer).toString("base64"),
      presentationTransitions: presentationColorTransitions,
    }),
    diagnostics: Object.freeze({
      visibility: state.source.id === "desktop"
        ? buildPreparedVisibilityContract(state, frameCount)
        : Object.freeze({
          schema: "csscityflow-mobile-diagnostic-visibility@1",
          bankId: state.source.id,
          faceCount: state.boxes.length * CSSCITYFLOW_FACE_IDS.length,
          frameCount,
          coverage: "product-publishes-complete-mobile-bank",
        }),
      productPolicy: "diagnostic-only-never-consumed-by-product-playback",
    }),
  });
}

function buildPresentationColorTransitions({
  frameCount,
  boxCount,
  facesPerBox,
  materials,
  presentationMaterialIndices,
  staticVisibility,
}) {
  const faceCount = boxCount * facesPerBox;
  const presentation = staticVisibility.presentation;
  const initial = Buffer.from(presentation.initialVisibleBoxBitsBase64, "base64");
  const visibilityOffsets = decodeLittleEndianUint16(
    Buffer.from(presentation.transitionOffsetsBase64, "base64"),
  );
  const visibilityIndices = decodeLittleEndianUint16(
    Buffer.from(presentation.transitionBoxIndicesBase64, "base64"),
  );
  const visible = Uint8Array.from({ length: boxCount }, (_, boxIndex) =>
    initial[boxIndex >> 3] >> (boxIndex & 7) & 1);
  const visibilityRows = [visible.slice()];
  for (let frameIndex = 1; frameIndex < frameCount; frameIndex += 1) {
    for (let cursor = visibilityOffsets[frameIndex];
      cursor < visibilityOffsets[frameIndex + 1]; cursor += 1) {
      visible[visibilityIndices[cursor]] ^= 1;
    }
    visibilityRows.push(visible.slice());
  }

  const offsets = [0];
  const faceIndices = [];
  const colors = [];
  const colorIndices = [];
  const colorIndexByValue = new Map();
  const colorIndex = (color) => {
    let index = colorIndexByValue.get(color);
    if (index === undefined) {
      index = colors.length;
      if (index > 0xffff) {
        throw new Error("Cityflow prepared transition colors exceeded uint16");
      }
      colorIndexByValue.set(color, index);
      colors.push(color);
    }
    return index;
  };
  let maximumWritesPerFrame = 0;
  for (let targetFrameIndex = 0; targetFrameIndex < frameCount; targetFrameIndex += 1) {
    const previousFrameIndex = (targetFrameIndex - 1 + frameCount) % frameCount;
    const targetOffset = targetFrameIndex * boxCount;
    const previousOffset = previousFrameIndex * boxCount;
    const targetVisible = visibilityRows[targetFrameIndex];
    const previousVisible = visibilityRows[previousFrameIndex];
    const frameStart = faceIndices.length;
    for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
      if (targetVisible[boxIndex] === 0) continue;
      const targetMaterialIndex = presentationMaterialIndices[targetOffset + boxIndex];
      const previousMaterialIndex = presentationMaterialIndices[previousOffset + boxIndex];
      for (let localFaceIndex = 0; localFaceIndex < facesPerBox; localFaceIndex += 1) {
        if (previousVisible[boxIndex] !== 0 &&
            materials[targetMaterialIndex][localFaceIndex] ===
              materials[previousMaterialIndex][localFaceIndex]) {
          continue;
        }
        faceIndices.push(boxIndex * facesPerBox + localFaceIndex);
        colorIndices.push(colorIndex(materials[targetMaterialIndex][localFaceIndex]));
      }
    }
    const frameWrites = faceIndices.length - frameStart;
    maximumWritesPerFrame = Math.max(maximumWritesPerFrame, frameWrites);
    offsets.push(faceIndices.length);
  }
  return Object.freeze({
    schema: "csscityflow-prepared-face-color-transitions@2",
    encoding:
      "final-color-dictionary-plus-u32le-target-frame-offsets-and-u16le-face-and-color-indices",
    frameCount,
    faceCount,
    transitionCount: faceIndices.length,
    maximumWritesPerFrame,
    colors: Object.freeze(colors),
    offsetsBase64: encodeLittleEndianUint32(offsets),
    faceIndicesBase64: encodeLittleEndianUint16(faceIndices),
    colorIndicesBase64: encodeLittleEndianUint16(colorIndices),
  });
}

export function cityflowPreparedSideDepth(faceIndex, bankId = "desktop") {
  const profile = cityflowPreparedSideDepthProfile(bankId);
  return profile.byFaceIndex.get(faceIndex) ?? profile.defaultDepthScale;
}

function preparedFaceMatrix(bankId, boxIndex, faceId, faceIndex) {
  if (faceId === "top") return TOP_FACE_MATRIX;
  const depthScale = cityflowPreparedSideDepth(
    boxIndex * CSSCITYFLOW_FACE_IDS.length + faceIndex,
    bankId,
  );
  const topOffset = 1 - depthScale;
  if (faceId === "front") {
    return Object.freeze([
      1, 0, 0, 0, 0, 0, depthScale, 0, 0, 1, 0, 0,
      -0.5, 0.5, topOffset, 1,
    ]);
  }
  return Object.freeze([
    0, 1, 0, 0, 0, 0, depthScale, 0, 1, 0, 0, 0,
    0.5, -0.5, topOffset, 1,
  ]);
}

function cityflowPreparedSideDepthProfile(bankId) {
  if (bankId === "desktop") {
    return Object.freeze({
      defaultDepthScale: CSSCITYFLOW_DESKTOP_DEFAULT_SIDE_DEPTH_SCALE,
      maximumDepthScale: preparedSideDepth.maximumDepthScale,
      byFaceIndex: CSSCITYFLOW_DESKTOP_SIDE_DEPTH_BY_FACE_INDEX,
    });
  }
  if (bankId === "mobile") {
    return Object.freeze({
      defaultDepthScale: 0.28,
      maximumDepthScale: 0.28,
      byFaceIndex: new Map(),
    });
  }
  throw new RangeError(`Unknown Cityflow side-depth bank: ${bankId}`);
}

function buildFullyVisibleStaticVisibility(state, frameCount) {
  const boxCount = state.boxes.length;
  const facesPerBox = CSSCITYFLOW_FACE_IDS.length;
  const faceCount = boxCount * facesPerBox;
  const initial = Buffer.alloc(Math.ceil(boxCount / 8), 0xff);
  if (boxCount % 8 !== 0) initial[initial.length - 1] &= (1 << (boxCount % 8)) - 1;
  const transitionOffsets = new Array(frameCount + 1).fill(0);
  return Object.freeze({
    schema: "csscityflow-prepared-static-visibility@3",
    faceCount,
    visibleFaceCount: faceCount,
    hiddenFaceCount: 0,
    visibleBoxCount: boxCount,
    hiddenBoxCount: 0,
    hiddenFaceIndices: Object.freeze([]),
    hiddenBoxIndices: Object.freeze([]),
    sortingDependencyBoxIndices: Object.freeze([]),
    policy: "prepared-whole-box-visibility-no-face-culling",
    presentation: Object.freeze({
      schema: "csscityflow-prepared-presentation-box-visibility@1",
      encoding: "initial-box-bitset-plus-u16le-per-target-frame-toggle-offsets-and-box-indices",
      frameCount,
      boxCount,
      faceCount,
      transitionDilationFrames: 0,
      alwaysVisibleBoxIndices: Object.freeze(Array.from({ length: boxCount }, (_, index) => index)),
      initialVisibleCount: faceCount,
      initialVisibleBoxes: boxCount,
      minimumVisibleFaces: faceCount,
      maximumVisibleFaces: faceCount,
      meanVisibleFaces: faceCount,
      minimumVisibleBoxes: boxCount,
      maximumVisibleBoxes: boxCount,
      meanVisibleBoxes: boxCount,
      transitionCount: 0,
      maximumTransitionWritesPerFrame: 0,
      initialVisibleBoxBitsBase64: initial.toString("base64"),
      transitionOffsetsBase64: encodeLittleEndianUint16(transitionOffsets),
      transitionBoxIndicesBase64: "",
      policy: "complete-mobile-bank-whole-box-publication",
    }),
  });
}

function validatePreparedSideDepth(value) {
  if (value?.schema !== "csscityflow-prepared-side-depth@1" ||
      value.defaultDepthScale !== 0.1 ||
      !Number.isFinite(value.maximumDepthScale) ||
      !Array.isArray(value.entries)) {
    throw new Error("Cityflow prepared side-depth reference drifted");
  }
  const byFaceIndex = new Map();
  for (const entry of value.entries) {
    const expectedFace = CSSCITYFLOW_FACE_IDS[entry.faceIndex % CSSCITYFLOW_FACE_IDS.length];
    if (!Number.isSafeInteger(entry.faceIndex) || entry.faceIndex < 0 || entry.faceIndex >= 600 ||
        entry.boxIndex !== Math.floor(entry.faceIndex / CSSCITYFLOW_FACE_IDS.length) ||
        entry.face !== expectedFace || entry.face === "top" ||
        !Number.isFinite(entry.depthScale) ||
        entry.depthScale <= value.defaultDepthScale ||
        entry.depthScale > value.maximumDepthScale ||
        !Number.isFinite(entry.measuredRequiredScale) ||
        entry.measuredRequiredScale >= entry.depthScale ||
        byFaceIndex.has(entry.faceIndex)) {
      throw new Error("Cityflow prepared side-depth entry drifted");
    }
    byFaceIndex.set(entry.faceIndex, entry.depthScale);
  }
  if (Math.max(...byFaceIndex.values()) !== value.maximumDepthScale) {
    throw new Error("Cityflow prepared side-depth maximum drifted");
  }
  return byFaceIndex;
}

function validatePreparedStaticVisibility(value) {
  const hiddenFaceIndices = value?.hiddenFaceIndices;
  const hiddenBoxIndices = value?.hiddenBoxIndices;
  const sortingDependencyBoxIndices = value?.sortingDependencyBoxIndices;
  const presentation = value?.presentation;
  const initial = Buffer.from(presentation?.initialVisibleBoxBitsBase64 ?? "", "base64");
  const offsetBytes = Buffer.from(presentation?.transitionOffsetsBase64 ?? "", "base64");
  const indexBytes = Buffer.from(presentation?.transitionBoxIndicesBase64 ?? "", "base64");
  if (value?.schema !== "csscityflow-prepared-static-visibility@3" ||
      value.sourceRevision !== "906693799e4fb7581436590cf84ecb2d3c9186ba" ||
      value.seed !== 26081702 || value.frameCount !== 301 || value.boxCount !== 200 ||
      value.facesPerBox !== CSSCITYFLOW_FACE_IDS.length || value.faceCount !== 600 ||
      value.visibleFaceCount !== 585 || value.hiddenFaceCount !== 15 ||
      value.visibleBoxCount !== 195 || value.hiddenBoxCount !== 5 ||
      !Array.isArray(hiddenFaceIndices) || hiddenFaceIndices.length !== value.hiddenFaceCount ||
      !Array.isArray(hiddenBoxIndices) || hiddenBoxIndices.length !== value.hiddenBoxCount ||
      hiddenFaceIndices.some((faceIndex, index) =>
        !Number.isSafeInteger(faceIndex) || faceIndex < 0 || faceIndex >= value.faceCount ||
        (index > 0 && faceIndex <= hiddenFaceIndices[index - 1])) ||
      hiddenBoxIndices.some((boxIndex, index) =>
        !Number.isSafeInteger(boxIndex) || boxIndex < 0 || boxIndex >= value.boxCount ||
        (index > 0 && boxIndex <= hiddenBoxIndices[index - 1])) ||
      hiddenBoxIndices.some((boxIndex) =>
        !CSSCITYFLOW_FACE_IDS.every((_, faceIndex) =>
          hiddenFaceIndices.includes(boxIndex * CSSCITYFLOW_FACE_IDS.length + faceIndex))) ||
      !Array.isArray(sortingDependencyBoxIndices) ||
      sortingDependencyBoxIndices.length !== 8 ||
      sortingDependencyBoxIndices.some((boxIndex, index) =>
        boxIndex !== [155, 156, 165, 171, 172, 179, 185, 196][index]) ||
      value.coverage?.policy !==
        "whole-box-visibility-union-plus-full-frame-css-3d-sorting-dependencies" ||
      !Array.isArray(value.coverage.projectionViewports) ||
      value.coverage.projectionViewports.length !== 3 ||
      presentation?.schema !== "csscityflow-prepared-presentation-box-visibility@1" ||
      presentation.encoding !==
        "initial-box-bitset-plus-u16le-per-target-frame-toggle-offsets-and-box-indices" ||
      presentation.frameCount !== value.frameCount ||
      presentation.boxCount !== value.boxCount || presentation.faceCount !== value.faceCount ||
      presentation.transitionDilationFrames !== 12 ||
      presentation.policy !==
        "viewport-independent-whole-box-only-three-projection-union-with-12-frame-dilation-plus-full-frame-sorting-dependencies" ||
      !Array.isArray(presentation.alwaysVisibleBoxIndices) ||
      presentation.alwaysVisibleBoxIndices.length !== 128 ||
      presentation.alwaysVisibleBoxIndices.some((boxIndex, index) =>
        !Number.isSafeInteger(boxIndex) || boxIndex < 0 || boxIndex >= value.boxCount ||
        (index > 0 && boxIndex <= presentation.alwaysVisibleBoxIndices[index - 1])) ||
      presentation.initialVisibleCount !== 510 ||
      presentation.initialVisibleBoxes !== 170 ||
      presentation.minimumVisibleFaces !== 498 ||
      presentation.maximumVisibleFaces !== 561 ||
      Math.abs(presentation.meanVisibleFaces - 522.1495016611295) > 1e-12 ||
      presentation.minimumVisibleBoxes !== 166 ||
      presentation.maximumVisibleBoxes !== 187 ||
      Math.abs(presentation.meanVisibleBoxes - 174.04983388704318) > 1e-12 ||
      presentation.transitionCount !== 240 ||
      presentation.maximumTransitionWritesPerFrame !== 6 ||
      initial.byteLength !== Math.ceil(value.boxCount / 8) ||
      offsetBytes.byteLength !== (value.frameCount + 1) * Uint16Array.BYTES_PER_ELEMENT ||
      indexBytes.byteLength !== presentation.transitionCount * Uint16Array.BYTES_PER_ELEMENT) {
    throw new Error("Cityflow prepared static-visibility reference drifted");
  }
  const offsets = decodeLittleEndianUint16(offsetBytes);
  const indices = decodeLittleEndianUint16(indexBytes);
  const visible = Uint8Array.from({ length: value.boxCount }, (_, boxIndex) =>
    initial[boxIndex >> 3] >> (boxIndex & 7) & 1);
  const visibleBoxCounts = [];
  const alwaysVisible = new Uint8Array(value.boxCount).fill(1);
  const everVisible = new Uint8Array(value.boxCount);
  for (let frameIndex = 0; frameIndex < value.frameCount; frameIndex += 1) {
    if (frameIndex > 0) {
      for (let cursor = offsets[frameIndex]; cursor < offsets[frameIndex + 1]; cursor += 1) {
        visible[indices[cursor]] ^= 1;
      }
    }
    for (let boxIndex = 0; boxIndex < value.boxCount; boxIndex += 1) {
      alwaysVisible[boxIndex] &= visible[boxIndex];
      everVisible[boxIndex] |= visible[boxIndex];
    }
    visibleBoxCounts.push(visible.reduce((sum, entry) => sum + entry, 0));
  }
  const visibleFaceCounts = visibleBoxCounts.map((count) => count * CSSCITYFLOW_FACE_IDS.length);
  if (offsets[0] !== 0 || offsets.at(-1) !== indices.length ||
      offsets.some((offset, index) => index > 0 && offset < offsets[index - 1]) ||
      indices.some((boxIndex) => boxIndex >= value.boxCount) ||
      visibleFaceCounts[0] !== presentation.initialVisibleCount ||
      visibleBoxCounts[0] !== presentation.initialVisibleBoxes ||
      Math.min(...visibleFaceCounts) !== presentation.minimumVisibleFaces ||
      Math.max(...visibleFaceCounts) !== presentation.maximumVisibleFaces ||
      Math.abs(visibleFaceCounts.reduce((sum, entry) => sum + entry, 0) / value.frameCount -
        presentation.meanVisibleFaces) > 1e-12 ||
      Math.min(...visibleBoxCounts) !== presentation.minimumVisibleBoxes ||
      Math.max(...visibleBoxCounts) !== presentation.maximumVisibleBoxes ||
      Math.abs(visibleBoxCounts.reduce((sum, entry) => sum + entry, 0) / value.frameCount -
        presentation.meanVisibleBoxes) > 1e-12 ||
      hiddenBoxIndices.some((boxIndex) => everVisible[boxIndex] !== 0) ||
      sortingDependencyBoxIndices.some((boxIndex) => alwaysVisible[boxIndex] === 0) ||
      presentation.alwaysVisibleBoxIndices.some((boxIndex) =>
        alwaysVisible[boxIndex] === 0) ||
      Array.from(alwaysVisible).reduce((sum, entry) => sum + entry, 0) !==
        presentation.alwaysVisibleBoxIndices.length) {
    throw new Error("Cityflow prepared presentation visibility schedule drifted");
  }
  return Object.freeze({
    schema: value.schema,
    faceCount: value.faceCount,
    visibleFaceCount: value.visibleFaceCount,
    hiddenFaceCount: value.hiddenFaceCount,
    visibleBoxCount: value.visibleBoxCount,
    hiddenBoxCount: value.hiddenBoxCount,
    hiddenFaceIndices: Object.freeze([...hiddenFaceIndices]),
    hiddenBoxIndices: Object.freeze([...hiddenBoxIndices]),
    sortingDependencyBoxIndices: Object.freeze([...sortingDependencyBoxIndices]),
    policy: "prepared-whole-box-visibility-no-face-culling",
    presentation: Object.freeze({
      schema: presentation.schema,
      encoding: presentation.encoding,
      frameCount: presentation.frameCount,
      boxCount: presentation.boxCount,
      faceCount: presentation.faceCount,
      transitionDilationFrames: presentation.transitionDilationFrames,
      alwaysVisibleBoxIndices: Object.freeze([...presentation.alwaysVisibleBoxIndices]),
      initialVisibleCount: presentation.initialVisibleCount,
      initialVisibleBoxes: presentation.initialVisibleBoxes,
      minimumVisibleFaces: presentation.minimumVisibleFaces,
      maximumVisibleFaces: presentation.maximumVisibleFaces,
      meanVisibleFaces: presentation.meanVisibleFaces,
      minimumVisibleBoxes: presentation.minimumVisibleBoxes,
      maximumVisibleBoxes: presentation.maximumVisibleBoxes,
      meanVisibleBoxes: presentation.meanVisibleBoxes,
      transitionCount: presentation.transitionCount,
      maximumTransitionWritesPerFrame: presentation.maximumTransitionWritesPerFrame,
      initialVisibleBoxBitsBase64: presentation.initialVisibleBoxBitsBase64,
      transitionOffsetsBase64: presentation.transitionOffsetsBase64,
      transitionBoxIndicesBase64: presentation.transitionBoxIndicesBase64,
      policy: presentation.policy,
    }),
  });
}

export function buildCityflowSourceFrames(state) {
  return Object.freeze(Array.from(
    { length: CSSCITYFLOW_PREPARED_FRAME_COUNT },
    (_, frameIndex) => cityflowFrameAt(state, frameIndex),
  ));
}

export function buildCityflowPreparedHeightRows(
  state,
  sourceFrames = buildCityflowSourceFrames(state),
) {
  const frameCount = CSSCITYFLOW_PRESENTATION_FRAME_COUNT;
  const sourceFrameCount = sourceFrames.length;
  const reconstructedHeights = Array.from({ length: frameCount }, (_, frameIndex) => {
    const sourcePosition = frameIndex * sourceFrameCount / frameCount;
    const sourceFrameIndex = Math.floor(sourcePosition);
    const fraction = sourcePosition - sourceFrameIndex;
    return Float64Array.from({ length: state.boxes.length }, (_, boxIndex) =>
      periodicUniformCubicBSplineHeight(
        sourceFrames,
        sourceFrameIndex,
        fraction,
        boxIndex,
      ));
  });
  const foldedHeights = foldBriefDirectionRuns(
    periodicFiveTapBinomialFilter(
      foldBriefDirectionRuns(
        periodicThreeTapBinomialFilter(
          foldBriefDirectionRuns(
            periodicFiveTapBinomialFilter(reconstructedHeights),
            MAXIMUM_BRIEF_DIRECTION_RUN_FRAMES,
          ),
        ),
        MAXIMUM_BRIEF_DIRECTION_RUN_FRAMES,
      ),
    ),
    MAXIMUM_BRIEF_DIRECTION_RUN_FRAMES,
  );
  return Object.freeze(adaptiveSmoothSineEaseDirectionRuns(foldedHeights));
}

function periodicUniformCubicBSplineHeight(sourceFrames, sourceFrameIndex, fraction, boxIndex) {
  const count = sourceFrames.length;
  const previous = sourceFrames[(sourceFrameIndex - 1 + count) % count].boxes[boxIndex].height;
  const current = sourceFrames[sourceFrameIndex % count].boxes[boxIndex].height;
  const next = sourceFrames[(sourceFrameIndex + 1) % count].boxes[boxIndex].height;
  const following = sourceFrames[(sourceFrameIndex + 2) % count].boxes[boxIndex].height;
  const inverse = 1 - fraction;
  const squared = fraction * fraction;
  const cubed = squared * fraction;
  const previousWeight = inverse * inverse * inverse / 6;
  const currentWeight = (3 * cubed - 6 * squared + 4) / 6;
  const nextWeight = (-3 * cubed + 3 * squared + 3 * fraction + 1) / 6;
  const followingWeight = cubed / 6;
  return previousWeight * previous + currentWeight * current +
    nextWeight * next + followingWeight * following;
}

function periodicFiveTapBinomialFilter(rows) {
  const weights = [1, 4, 6, 4, 1];
  return rows.map((_, frameIndex) => Float64Array.from(
    { length: rows[frameIndex].length },
    (_, boxIndex) => weights.reduce((sum, weight, weightIndex) => {
      const offset = weightIndex - 2;
      const sourceIndex = (frameIndex + offset + rows.length) % rows.length;
      return sum + weight * rows[sourceIndex][boxIndex];
    }, 0) / 16,
  ));
}

function periodicThreeTapBinomialFilter(rows) {
  const weights = [1, 2, 1];
  return rows.map((_, frameIndex) => Float64Array.from(
    { length: rows[frameIndex].length },
    (_, boxIndex) => weights.reduce((sum, weight, weightIndex) => {
      const offset = weightIndex - 1;
      const sourceIndex = (frameIndex + offset + rows.length) % rows.length;
      return sum + weight * rows[sourceIndex][boxIndex];
    }, 0) / 4,
  ));
}

function foldBriefDirectionRuns(rows, maximumRunLength) {
  const frameCount = rows.length;
  const boxCount = rows[0].length;
  const output = rows.map((row) => Float64Array.from(row));
  for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
    const velocities = Array.from({ length: frameCount }, (_, frameIndex) =>
      rows[frameIndex][boxIndex] - rows[(frameIndex - 1 + frameCount) % frameCount][boxIndex]);
    for (let iteration = 0; iteration < frameCount; iteration += 1) {
      const movingFrameIndices = velocities
        .map((velocity, frameIndex) => Math.abs(velocity) > 1e-7 ? frameIndex : -1)
        .filter((frameIndex) => frameIndex >= 0);
      if (movingFrameIndices.length === 0) break;
      const directions = movingFrameIndices.map((frameIndex) =>
        Math.sign(velocities[frameIndex]));
      const shortRun = circularDirectionRuns(directions)
        .find((run) => run.length <= maximumRunLength);
      if (!shortRun) break;
      for (let index = 0; index < shortRun.length; index += 1) {
        const directionIndex = (shortRun.start + index) % directions.length;
        const frameIndex = movingFrameIndices[directionIndex];
        velocities[frameIndex] *= -1;
      }
    }
    const movingFrameIndices = velocities
      .map((velocity, frameIndex) => Math.abs(velocity) > 1e-7 ? frameIndex : -1)
      .filter((frameIndex) => frameIndex >= 0);
    if (movingFrameIndices.length === 0) continue;
    const directions = movingFrameIndices.map((frameIndex) =>
      Math.sign(velocities[frameIndex]));
    if (circularDirectionRuns(directions).some((run) => run.length <= maximumRunLength)) {
      throw new Error("Cityflow brief direction-run folding did not converge");
    }
    let positiveDistance = 0;
    let negativeDistance = 0;
    for (let index = 0; index < movingFrameIndices.length; index += 1) {
      const distance = Math.abs(velocities[movingFrameIndices[index]]);
      if (directions[index] > 0) positiveDistance += distance;
      else negativeDistance += distance;
    }
    if (positiveDistance === 0 || negativeDistance === 0) {
      throw new Error("Cityflow brief direction-run folding collapsed a periodic trajectory");
    }
    const balancedDistance = (positiveDistance + negativeDistance) / 2;
    const positiveScale = balancedDistance / positiveDistance;
    const negativeScale = balancedDistance / negativeDistance;
    for (let index = 0; index < movingFrameIndices.length; index += 1) {
      const frameIndex = movingFrameIndices[index];
      const direction = directions[index];
      velocities[frameIndex] = direction * Math.abs(velocities[frameIndex]) *
        (direction > 0 ? positiveScale : negativeScale);
    }
    const reconstructed = new Float64Array(frameCount);
    reconstructed[0] = rows[0][boxIndex];
    for (let frameIndex = 1; frameIndex < frameCount; frameIndex += 1) {
      reconstructed[frameIndex] = reconstructed[frameIndex - 1] + velocities[frameIndex];
    }
    const sourceMean = rows.reduce((sum, row) => sum + row[boxIndex], 0) / frameCount;
    const reconstructedMean = reconstructed.reduce((sum, value) => sum + value, 0) / frameCount;
    const centeringOffset = sourceMean - reconstructedMean;
    const sourceMinimum = Math.min(...rows.map((row) => row[boxIndex]));
    const sourceMaximum = Math.max(...rows.map((row) => row[boxIndex]));
    const centeredMinimum = Math.min(...reconstructed) + centeringOffset;
    const centeredMaximum = Math.max(...reconstructed) + centeringOffset;
    const lowerScale = centeredMinimum < sourceMinimum
      ? (sourceMean - sourceMinimum) / (sourceMean - centeredMinimum)
      : 1;
    const upperScale = centeredMaximum > sourceMaximum
      ? (sourceMaximum - sourceMean) / (centeredMaximum - sourceMean)
      : 1;
    const rangeScale = Math.min(1, lowerScale, upperScale);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const centered = reconstructed[frameIndex] + centeringOffset;
      output[frameIndex][boxIndex] = sourceMean + (centered - sourceMean) * rangeScale;
    }
  }
  return output;
}

function circularDirectionRuns(directions) {
  const runs = [];
  let direction = directions[0];
  let start = 0;
  for (let index = 1; index < directions.length; index += 1) {
    if (directions[index] === direction) continue;
    runs.push({ direction, start, length: index - start });
    direction = directions[index];
    start = index;
  }
  runs.push({ direction, start, length: directions.length - start });
  if (runs.length > 1 && runs[0].direction === runs.at(-1).direction) {
    runs[0] = {
      direction: runs[0].direction,
      start: runs.at(-1).start,
      length: runs[0].length + runs.at(-1).length,
    };
    runs.pop();
  }
  return runs;
}

function adaptiveSmoothSineEaseDirectionRuns(rows) {
  const frameCount = rows.length;
  const boxCount = rows[0].length;
  const output = Array.from({ length: frameCount }, () => new Float64Array(boxCount));
  for (let boxIndex = 0; boxIndex < boxCount; boxIndex += 1) {
    const velocities = Array.from({ length: frameCount }, (_, frameIndex) =>
      rows[frameIndex][boxIndex] -
      rows[(frameIndex - 1 + frameCount) % frameCount][boxIndex]);
    const movingFrameIndices = velocities
      .map((velocity, frameIndex) => Math.abs(velocity) > 1e-7 ? frameIndex : -1)
      .filter((frameIndex) => frameIndex >= 0);
    if (movingFrameIndices.length === 0) {
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        output[frameIndex][boxIndex] = rows[frameIndex][boxIndex];
      }
      continue;
    }
    const runs = circularDirectionRuns(movingFrameIndices.map((frameIndex) =>
      Math.sign(velocities[frameIndex])));
    const extrema = runs.map((run, runIndex) => {
      const lastMovingFrameIndex = movingFrameIndices[
        (run.start + run.length - 1) % movingFrameIndices.length
      ];
      const nextRun = runs[(runIndex + 1) % runs.length];
      const nextMovingFrameIndex = movingFrameIndices[nextRun.start];
      const stationarySpan =
        (nextMovingFrameIndex - lastMovingFrameIndex + frameCount) % frameCount;
      return {
        frameIndex: (lastMovingFrameIndex + Math.floor(stationarySpan / 2)) % frameCount,
        height: rows[lastMovingFrameIndex][boxIndex],
      };
    }).sort((left, right) => left.frameIndex - right.frameIndex);
    for (let extremaIndex = 0; extremaIndex < extrema.length; extremaIndex += 1) {
      const start = extrema[extremaIndex];
      const end = extrema[(extremaIndex + 1) % extrema.length];
      const duration = (end.frameIndex - start.frameIndex + frameCount) % frameCount;
      const ramp = Math.max(0, Math.min(1,
        (duration - PRESENTATION_EASING_RAMP_START_FRAMES) /
        (PRESENTATION_EASING_RAMP_FULL_FRAMES - PRESENTATION_EASING_RAMP_START_FRAMES)));
      const centerReduction = PRESENTATION_EASING_MAXIMUM_CENTER_REDUCTION * ramp;
      for (let offset = 0; offset < duration; offset += 1) {
        const fraction = offset / duration;
        const easedFraction = smoothSineEasedFraction(fraction, centerReduction);
        const frameIndex = (start.frameIndex + offset) % frameCount;
        output[frameIndex][boxIndex] =
          start.height + (end.height - start.height) * easedFraction;
      }
    }
  }
  return output;
}

function smoothSineEasedFraction(fraction, centerReduction) {
  const cosine = Math.cos(Math.PI * fraction);
  const sineIntegral = 1 - cosine;
  const sineCubedIntegral = 2 / 3 - cosine + cosine ** 3 / 3;
  return (sineIntegral - centerReduction * sineCubedIntegral) /
    (2 - 4 * centerReduction / 3);
}

function buildPreparedVisibilityContract(state, frameCount) {
  const faceCount = state.boxes.length * CSSCITYFLOW_FACE_IDS.length;
  const initial = Buffer.from(preparedVisibility.initialVisibleBitsBase64, "base64");
  const offsetBytes = Buffer.from(preparedVisibility.transitionOffsetsBase64, "base64");
  const faceBytes = Buffer.from(preparedVisibility.transitionFaceIndicesBase64, "base64");
  if (preparedVisibility.schema !== "csscityflow-prepared-visibility-source@1" ||
      preparedVisibility.sourceRevision !== state.source.commit ||
      preparedVisibility.seed !== state.seed || preparedVisibility.frameCount !== frameCount ||
      preparedVisibility.faceCount !== faceCount ||
      preparedVisibility.transitionDilationFrames !== 1 ||
      initial.byteLength !== Math.ceil(faceCount / 8) ||
      offsetBytes.byteLength !== (frameCount + 1) * Uint16Array.BYTES_PER_ELEMENT ||
      faceBytes.byteLength !== preparedVisibility.transitionCount * Uint16Array.BYTES_PER_ELEMENT) {
    throw new Error("Cityflow prepared visibility source drifted");
  }
  const offsets = decodeLittleEndianUint16(offsetBytes);
  const indices = decodeLittleEndianUint16(faceBytes);
  if (offsets[0] !== 0 || offsets.at(-1) !== indices.length ||
      offsets.some((offset, index) => index > 0 && offset < offsets[index - 1]) ||
      indices.some((index) => index >= faceCount)) {
    throw new Error("Cityflow prepared visibility schedule drifted");
  }
  const visible = Uint8Array.from({ length: faceCount }, (_, faceIndex) =>
    initial[faceIndex >> 3] >> (faceIndex & 7) & 1);
  let visibleCount = visible.reduce((sum, value) => sum + value, 0);
  if (visibleCount !== preparedVisibility.initialVisibleCount) {
    throw new Error("Cityflow prepared initial visibility drifted");
  }
  const sourceRows = [visible.slice()];
  let minimumVisibleFaces = visibleCount;
  let maximumVisibleFaces = visibleCount;
  let visibleFaceSum = visibleCount;
  for (let frameIndex = 1; frameIndex < frameCount; frameIndex += 1) {
    applyVisibilityToggles(frameIndex);
    sourceRows.push(visible.slice());
    minimumVisibleFaces = Math.min(minimumVisibleFaces, visibleCount);
    maximumVisibleFaces = Math.max(maximumVisibleFaces, visibleCount);
    visibleFaceSum += visibleCount;
  }
  applyVisibilityToggles(0);
  const initialRoundTrip = visible.every((value, index) =>
    value === (initial[index >> 3] >> (index & 7) & 1));
  if (!initialRoundTrip || minimumVisibleFaces !== preparedVisibility.minimumVisibleFaces ||
      maximumVisibleFaces !== preparedVisibility.maximumVisibleFaces ||
      Math.abs(visibleFaceSum / frameCount - preparedVisibility.meanVisibleFaces) > 1e-12) {
    throw new Error("Cityflow prepared visibility census drifted");
  }
  const easedInitial = Buffer.from(
    preparedEasedVisibility.initialVisibleBitsBase64 ?? "",
    "base64",
  );
  const easedOffsetBytes = Buffer.from(
    preparedEasedVisibility.transitionOffsetsBase64 ?? "",
    "base64",
  );
  const easedFaceBytes = Buffer.from(
    preparedEasedVisibility.transitionFaceIndicesBase64 ?? "",
    "base64",
  );
  if (preparedEasedVisibility.schema !== "csscityflow-browser-visible-face-id-source@1" ||
      preparedEasedVisibility.encoding !==
        "initial-bitset-plus-u16le-per-target-frame-toggle-offsets-and-face-indices" ||
      preparedEasedVisibility.frameCount !== frameCount ||
      preparedEasedVisibility.faceCount !== faceCount ||
      preparedEasedVisibility.viewport?.width !== 1280 ||
      preparedEasedVisibility.viewport?.height !== 720 ||
      easedInitial.byteLength !== Math.ceil(faceCount / 8) ||
      easedOffsetBytes.byteLength !== (frameCount + 1) * Uint16Array.BYTES_PER_ELEMENT ||
      easedFaceBytes.byteLength !==
        preparedEasedVisibility.transitionCount * Uint16Array.BYTES_PER_ELEMENT) {
    throw new Error("Cityflow prepared eased visibility source drifted");
  }
  const easedOffsets = decodeLittleEndianUint16(easedOffsetBytes);
  const easedIndices = decodeLittleEndianUint16(easedFaceBytes);
  if (easedOffsets[0] !== 0 || easedOffsets.at(-1) !== easedIndices.length ||
      easedOffsets.some((offset, index) => index > 0 && offset < easedOffsets[index - 1]) ||
      easedIndices.some((faceIndex) => faceIndex >= faceCount)) {
    throw new Error("Cityflow prepared eased visibility schedule drifted");
  }
  const easedVisible = Uint8Array.from({ length: faceCount }, (_, faceIndex) =>
    easedInitial[faceIndex >> 3] >> (faceIndex & 7) & 1);
  const easedRows = [easedVisible.slice()];
  for (let frameIndex = 1; frameIndex < frameCount; frameIndex += 1) {
    for (let cursor = easedOffsets[frameIndex]; cursor < easedOffsets[frameIndex + 1]; cursor += 1) {
      easedVisible[easedIndices[cursor]] ^= 1;
    }
    easedRows.push(easedVisible.slice());
  }
  const preparedRows = sourceRows.map((_, frameIndex) => Uint8Array.from(
    { length: faceCount },
    (_, faceIndex) => sourceRows[(frameIndex - 2 + frameCount) % frameCount][faceIndex] |
      sourceRows[(frameIndex - 1 + frameCount) % frameCount][faceIndex] |
      sourceRows[frameIndex][faceIndex] |
      sourceRows[(frameIndex + 1) % frameCount][faceIndex] |
      sourceRows[(frameIndex + 2) % frameCount][faceIndex] |
      easedRows[(frameIndex - 2 + frameCount) % frameCount][faceIndex] |
      easedRows[(frameIndex - 1 + frameCount) % frameCount][faceIndex] |
      easedRows[frameIndex][faceIndex] |
      easedRows[(frameIndex + 1) % frameCount][faceIndex] |
      easedRows[(frameIndex + 2) % frameCount][faceIndex],
  ));
  const conservativeExtendedDilationFrames = 12;
  const conservativeExtendedDilationFaceIndices = Object.freeze([
    156 * CSSCITYFLOW_FACE_IDS.length + 1,
    156 * CSSCITYFLOW_FACE_IDS.length + 2,
    160 * CSSCITYFLOW_FACE_IDS.length + 2,
    181 * CSSCITYFLOW_FACE_IDS.length,
    184 * CSSCITYFLOW_FACE_IDS.length + 1,
    188 * CSSCITYFLOW_FACE_IDS.length + 1,
    188 * CSSCITYFLOW_FACE_IDS.length + 2,
    194 * CSSCITYFLOW_FACE_IDS.length,
  ]);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (const faceIndex of conservativeExtendedDilationFaceIndices) {
      for (let offset = -conservativeExtendedDilationFrames;
        offset <= conservativeExtendedDilationFrames; offset += 1) {
        if (sourceRows[(frameIndex + offset + frameCount) % frameCount][faceIndex] !== 0) {
          preparedRows[frameIndex][faceIndex] = 1;
          break;
        }
      }
    }
  }
  const conservativeAlwaysVisibleFaceIndices = Object.freeze([
    114 * CSSCITYFLOW_FACE_IDS.length,
    123 * CSSCITYFLOW_FACE_IDS.length,
    150 * CSSCITYFLOW_FACE_IDS.length + 2,
    151 * CSSCITYFLOW_FACE_IDS.length + 1,
    168 * CSSCITYFLOW_FACE_IDS.length,
    184 * CSSCITYFLOW_FACE_IDS.length,
  ]);
  for (const row of preparedRows) {
    for (const faceIndex of conservativeAlwaysVisibleFaceIndices) row[faceIndex] = 1;
  }
  const preparedInitial = Buffer.alloc(Math.ceil(faceCount / 8));
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    if (preparedRows[0][faceIndex] !== 0) {
      preparedInitial[faceIndex >> 3] |= 1 << (faceIndex & 7);
    }
  }
  const preparedOffsets = [0];
  const preparedIndices = [];
  for (let targetFrameIndex = 0; targetFrameIndex < frameCount; targetFrameIndex += 1) {
    const previousFrameIndex = (targetFrameIndex - 1 + frameCount) % frameCount;
    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
      if (preparedRows[targetFrameIndex][faceIndex] !== preparedRows[previousFrameIndex][faceIndex]) {
        preparedIndices.push(faceIndex);
      }
    }
    preparedOffsets.push(preparedIndices.length);
  }
  const preparedOffsetBytes = Buffer.alloc(
    preparedOffsets.length * Uint16Array.BYTES_PER_ELEMENT,
  );
  const preparedFaceBytes = Buffer.alloc(
    preparedIndices.length * Uint16Array.BYTES_PER_ELEMENT,
  );
  preparedOffsets.forEach((value, index) => preparedOffsetBytes.writeUInt16LE(value, index * 2));
  preparedIndices.forEach((value, index) => preparedFaceBytes.writeUInt16LE(value, index * 2));
  const preparedVisibleCounts = preparedRows.map((row) =>
    row.reduce((sum, value) => sum + value, 0));
  const preparedVisibleBoxCounts = preparedRows.map((row) =>
    state.boxes.reduce((sum, _, boxIndex) => sum + Number(
      row[boxIndex * CSSCITYFLOW_FACE_IDS.length] !== 0 ||
      row[boxIndex * CSSCITYFLOW_FACE_IDS.length + 1] !== 0 ||
      row[boxIndex * CSSCITYFLOW_FACE_IDS.length + 2] !== 0,
    ), 0));
  const preparedVisibleFaceSum = preparedVisibleCounts.reduce((sum, value) => sum + value, 0);
  const preparedVisibleBoxSum = preparedVisibleBoxCounts.reduce((sum, value) => sum + value, 0);
  const wide = buildPreparedWideVisibilityContract(state, frameCount, faceCount);
  return Object.freeze({
    schema: "csscityflow-prepared-visibility-culling@2",
    encoding: "initial-bitset-plus-u16le-per-target-frame-toggle-offsets-and-face-indices",
    faceCount,
    frameCount,
    transitionDilationFrames: preparedVisibility.transitionDilationFrames + 2,
    initialVisibleCount: preparedVisibleCounts[0],
    minimumVisibleFaces: Math.min(...preparedVisibleCounts),
    maximumVisibleFaces: Math.max(...preparedVisibleCounts),
    meanVisibleFaces: preparedVisibleFaceSum / frameCount,
    minimumVisibleBoxes: Math.min(...preparedVisibleBoxCounts),
    maximumVisibleBoxes: Math.max(...preparedVisibleBoxCounts),
    meanVisibleBoxes: preparedVisibleBoxSum / frameCount,
    transitionCount: preparedIndices.length,
    conservativeAlwaysVisibleFaceIndices,
    conservativeExtendedDilationFrames,
    conservativeExtendedDilationFaceIndices,
    initialVisibleBitsBase64: preparedInitial.toString("base64"),
    transitionOffsetsBase64: preparedOffsetBytes.toString("base64"),
    transitionFaceIndicesBase64: preparedFaceBytes.toString("base64"),
    wide,
    viewportUnion: Object.freeze(preparedVisibility.viewportUnion.map((viewport) =>
      Object.freeze({ width: viewport.width, height: viewport.height }))),
    provenance: Object.freeze({
      ...preparedVisibility.provenance,
      transitionSafety:
        "source-one-frame-plus-two-prepared-trajectory-frames-before-and-after",
      baseTransitionDilationFrames: preparedVisibility.transitionDilationFrames,
      additionalPreparedTrajectoryDilationFrames: 2,
      effectiveTransitionDilationFrames: preparedVisibility.transitionDilationFrames + 2,
      validatedPresentation:
        "prepared-folded-adaptive-smooth-sine-eased-extrema-plus-browser-face-id-union-60hz",
    }),
  });

  function applyVisibilityToggles(frameIndex) {
    const seen = new Set();
    for (let cursor = offsets[frameIndex]; cursor < offsets[frameIndex + 1]; cursor += 1) {
      const faceIndex = indices[cursor];
      if (seen.has(faceIndex)) throw new Error("Cityflow prepared visibility row toggles a face twice");
      seen.add(faceIndex);
      visible[faceIndex] ^= 1;
      visibleCount += visible[faceIndex] === 1 ? 1 : -1;
    }
  }
}

function buildPreparedWideVisibilityContract(state, frameCount, faceCount) {
  const initial = Buffer.from(preparedWideVisibility.initialVisibleBitsBase64, "base64");
  const offsets = Buffer.from(preparedWideVisibility.transitionOffsetsBase64, "base64");
  const indices = Buffer.from(preparedWideVisibility.transitionFaceIndicesBase64, "base64");
  const sourceInitial = Buffer.from(preparedWideVisibility.source?.initialVisibleBitsBase64 ?? "", "base64");
  const sourceOffsets = Buffer.from(preparedWideVisibility.source?.transitionOffsetsBase64 ?? "", "base64");
  const sourceIndices = Buffer.from(preparedWideVisibility.source?.transitionFaceIndicesBase64 ?? "", "base64");
  if (preparedWideVisibility.schema !== "csscityflow-prepared-wide-visibility-source@1" ||
      preparedWideVisibility.sourceRevision !== state.source.commit ||
      preparedWideVisibility.seed !== state.seed ||
      preparedWideVisibility.frameCount !== frameCount ||
      preparedWideVisibility.sourceFrameCount !== CSSCITYFLOW_PREPARED_FRAME_COUNT ||
      preparedWideVisibility.faceCount !== faceCount ||
      preparedWideVisibility.viewport?.width !== 2560 ||
      preparedWideVisibility.viewport?.height !== 1224 ||
      preparedWideVisibility.selection !==
        "stage-width-greater-than-two-times-stage-height" ||
      preparedWideVisibility.transitionDilationFrames !== 0 ||
      initial.byteLength !== Math.ceil(faceCount / 8) ||
      offsets.byteLength !== (frameCount + 1) * Uint16Array.BYTES_PER_ELEMENT ||
      indices.byteLength !== preparedWideVisibility.transitionCount * Uint16Array.BYTES_PER_ELEMENT ||
      preparedWideVisibility.source?.schema !== "csscityflow-prepared-wide-source-visibility@1" ||
      preparedWideVisibility.source.frameCount !== CSSCITYFLOW_PREPARED_FRAME_COUNT ||
      preparedWideVisibility.source.transitionDilationFrames !== 0 ||
      sourceInitial.byteLength !== Math.ceil(faceCount / 8) ||
      sourceOffsets.byteLength !== (CSSCITYFLOW_PREPARED_FRAME_COUNT + 1) * Uint16Array.BYTES_PER_ELEMENT ||
      sourceIndices.byteLength !==
        preparedWideVisibility.source.transitionCount * Uint16Array.BYTES_PER_ELEMENT) {
    throw new Error("Cityflow prepared wide visibility source drifted");
  }
  return Object.freeze({
    schema: "csscityflow-prepared-visibility-variant@1",
    encoding: "initial-bitset-plus-u16le-per-target-frame-toggle-offsets-and-face-indices",
    selection: preparedWideVisibility.selection,
    sourceViewport: Object.freeze({ ...preparedWideVisibility.viewport }),
    faceCount,
    frameCount,
    transitionDilationFrames: preparedWideVisibility.transitionDilationFrames,
    initialVisibleCount: preparedWideVisibility.initialVisibleCount,
    minimumVisibleFaces: preparedWideVisibility.minimumVisibleFaces,
    maximumVisibleFaces: preparedWideVisibility.maximumVisibleFaces,
    meanVisibleFaces: preparedWideVisibility.meanVisibleFaces,
    minimumVisibleBoxes: preparedWideVisibility.minimumVisibleBoxes,
    maximumVisibleBoxes: preparedWideVisibility.maximumVisibleBoxes,
    meanVisibleBoxes: preparedWideVisibility.meanVisibleBoxes,
    transitionCount: preparedWideVisibility.transitionCount,
    initialVisibleBitsBase64: preparedWideVisibility.initialVisibleBitsBase64,
    transitionOffsetsBase64: preparedWideVisibility.transitionOffsetsBase64,
    transitionFaceIndicesBase64: preparedWideVisibility.transitionFaceIndicesBase64,
    source: Object.freeze({
      schema: preparedWideVisibility.source.schema,
      encoding: "initial-bitset-plus-u16le-per-target-frame-toggle-offsets-and-face-indices",
      faceCount,
      frameCount: preparedWideVisibility.source.frameCount,
      transitionDilationFrames: preparedWideVisibility.source.transitionDilationFrames,
      initialVisibleCount: preparedWideVisibility.source.initialVisibleCount,
      minimumVisibleFaces: preparedWideVisibility.source.minimumVisibleFaces,
      maximumVisibleFaces: preparedWideVisibility.source.maximumVisibleFaces,
      meanVisibleFaces: preparedWideVisibility.source.meanVisibleFaces,
      minimumVisibleBoxes: preparedWideVisibility.source.minimumVisibleBoxes,
      maximumVisibleBoxes: preparedWideVisibility.source.maximumVisibleBoxes,
      meanVisibleBoxes: preparedWideVisibility.source.meanVisibleBoxes,
      transitionCount: preparedWideVisibility.source.transitionCount,
      initialVisibleBitsBase64: preparedWideVisibility.source.initialVisibleBitsBase64,
      transitionOffsetsBase64: preparedWideVisibility.source.transitionOffsetsBase64,
      transitionFaceIndicesBase64: preparedWideVisibility.source.transitionFaceIndicesBase64,
    }),
    provenance: Object.freeze({ ...preparedWideVisibility.provenance }),
  });
}

function decodeLittleEndianUint16(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint16Array.from({ length: bytes.byteLength / 2 }, (_, index) =>
    view.getUint16(index * 2, true));
}

function encodeLittleEndianUint16(values) {
  const bytes = Buffer.alloc(values.length * Uint16Array.BYTES_PER_ELEMENT);
  values.forEach((value, index) => bytes.writeUInt16LE(value, index * 2));
  return bytes.toString("base64");
}

function encodeLittleEndianUint32(values) {
  const bytes = Buffer.alloc(values.length * Uint32Array.BYTES_PER_ELEMENT);
  values.forEach((value, index) => bytes.writeUInt32LE(value, index * 4));
  return bytes.toString("base64");
}

function boxPlaybackMatrix(box, top, bottom) {
  return `matrix3d(${boxPlaybackMatrixValues(box, top, bottom).map(formatNumber).join(",")})`;
}

function boxPlaybackMatrixValues(box, top, bottom) {
  return [
    box.cth * box.width,
    -box.sth * box.width,
    0,
    0,
    box.sth * box.depth,
    box.cth * box.depth,
    0,
    0,
    0,
    0,
    top - bottom,
    0,
    box.centerX,
    box.centerY,
    bottom,
    1,
  ];
}

function paletteColor(color) {
  return `#${color.map((channel) => Math.round(channel * 255 / 65536).toString(16).padStart(2, "0")).join("")}`;
}

function litPaletteColor(color, lightFactor) {
  return `#${color.map((channel) => {
    const base = Math.round(channel * 255 / 65536);
    return Math.min(255, Math.round(base * lightFactor)).toString(16).padStart(2, "0");
  }).join("")}`;
}

function interpolatedLitPaletteColor(palette, position, lightFactor) {
  const wrapped = (position % palette.length + palette.length) % palette.length;
  const index = Math.floor(wrapped);
  const fraction = wrapped - index;
  const current = palette[index];
  const next = palette[(index + 1) % palette.length];
  return `#${current.map((channel, channelIndex) => {
    const currentBase = Math.round(channel * 255 / 65536);
    const nextBase = Math.round(next[channelIndex] * 255 / 65536);
    const currentLit = Math.min(255, Math.round(currentBase * lightFactor));
    const nextLit = Math.min(255, Math.round(nextBase * lightFactor));
    return Math.round(currentLit + (nextLit - currentLit) * fraction)
      .toString(16)
      .padStart(2, "0");
  }).join("")}`;
}

function formatNumber(value) {
  return Number(value.toFixed(9)).toString();
}
