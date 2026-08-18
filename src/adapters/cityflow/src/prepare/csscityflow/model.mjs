import { Buffer } from "node:buffer";
import {
  CSSCITYFLOW_FACE_IDS,
  CSSCITYFLOW_FRAME_MILLISECONDS,
  buildCityflowSourceState,
  cityflowFrameAt,
} from "./sourceModel.mjs";

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
const FACE_MATRICES = Object.freeze({
  top: Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.5, -0.5, 1, 1]),
  front: Object.freeze([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, -0.5, 0.5, 0, 1]),
  right: Object.freeze([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0.5, -0.5, 0, 1]),
});

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
      matrix: FACE_MATRICES[faceId],
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
          license: "XScreenSaver cityflow.c permissive notice",
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
  const rules = [
    `:root{--csscityflow-background:${paletteColor(state.palette[0])}}`,
    `.csscityflow-box>b{color:rgb(from var(--csscityflow-base) calc(r * var(--csscityflow-light)) calc(g * var(--csscityflow-light)) calc(b * var(--csscityflow-light)))!important}`,
    `.csscityflow-box>b:first-child{backface-visibility:visible!important}`,
    `.csscityflow-box>b:not(:first-child){backface-visibility:hidden!important}`,
  ];
  for (let index = 0; index < state.palette.length; index += 1) {
    rules.push(`.csscityflow-color-${index}{--csscityflow-base:${paletteColor(state.palette[index])}}`);
  }
  return rules.join("");
}

export function buildCityflowPreparedPlayback(state) {
  const frameCount = 252;
  const transformIndices = new Uint32Array(frameCount * state.boxes.length);
  const colorIndices = new Uint8Array(frameCount * state.boxes.length);
  const transforms = [];
  const transformIndexByValue = new Map();
  const bottoms = state.boxes.map((box) => {
    const clipped = cityflowClippedBottoms(box);
    return Math.min(clipped.front, clipped.right);
  });
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frame = cityflowFrameAt(state, frameIndex);
    for (let boxIndex = 0; boxIndex < state.boxes.length; boxIndex += 1) {
      const sample = frame.boxes[boxIndex];
      const transform = boxPlaybackMatrix(
        state.boxes[boxIndex],
        -sample.height / 2,
        bottoms[boxIndex],
      );
      let transformIndex = transformIndexByValue.get(transform);
      if (transformIndex === undefined) {
        transformIndex = transforms.length;
        transformIndexByValue.set(transform, transformIndex);
        transforms.push(transform);
      }
      const offset = frameIndex * state.boxes.length + boxIndex;
      transformIndices[offset] = transformIndex;
      colorIndices[offset] = sample.colorIndex;
    }
  }
  return Object.freeze({
    schema: "csscityflow-prepared-playback@1",
    precedent: "domformat@0/polycss-playback@0@cc8da736",
    catchUpPolicy: "elapsed",
    frameCount,
    tickIntervalUs: Object.freeze([CSSCITYFLOW_FRAME_MILLISECONDS * 1_000, 1]),
    boxCount: state.boxes.length,
    transforms: Object.freeze(transforms),
    transformIndicesBase64: Buffer.from(transformIndices.buffer).toString("base64"),
    colorIndicesBase64: Buffer.from(colorIndices.buffer).toString("base64"),
  });
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

function formatNumber(value) {
  return Number(value.toFixed(9)).toString();
}
