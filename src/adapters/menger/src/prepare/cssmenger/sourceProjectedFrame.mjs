import sharp from "sharp";
import {
  preparedSourceFaceNormal,
  preparedSourceFaceVertices,
} from "./mengerGeometry.mjs";

const SOURCE_EYE_Z = 30;
const SOURCE_FOV_DEGREES = 30;
const SOURCE_NEAR = 1;
const SOURCE_FAR = 100;
const DEPTH_MAX = (1 << 24) - 1;
const EPSILON = 1e-10;
const preparedFaces = new WeakMap();

export async function prepareMengerSourceProjectedFrame({
  geometry,
  playback,
  stateIndex,
  viewport = { width: 960, height: 600 },
} = {}) {
  if (!geometry?.metrics?.sourceFaceCoverageExact ||
      playback?.schema !== "cssmenger-prepared-playback@1" ||
      !Number.isSafeInteger(stateIndex) || stateIndex < 0 || stateIndex >= playback.stateCount ||
      !Number.isSafeInteger(viewport?.width) || viewport.width < 1 ||
      !Number.isSafeInteger(viewport?.height) || viewport.height < 1) {
    throw new TypeError("Complete prepared cssMenger source frame inputs are required");
  }
  const faces = sourceFacesFor(geometry);
  const rotation = playback.nativeRotationDegrees[stateIndex];
  const materialIndices = playback.colorRows[stateIndex];
  const focalPixels = viewport.height / 2 / Math.tan(SOURCE_FOV_DEGREES * Math.PI / 360);
  const frame = Buffer.alloc(viewport.width * viewport.height * 4);
  const depth = new Uint32Array(viewport.width * viewport.height);
  depth.fill(DEPTH_MAX);
  let candidateFragmentCount = 0;
  let depthAcceptedFragmentCount = 0;

  for (const face of faces) {
    const normal = rotateNative(face.normal, rotation);
    const material = playback.palette[materialIndices[face.axisGroup]].material;
    const vertices = face.vertices.map((vertex) => {
      const world = rotateNative(vertex, rotation);
      const eyeDistance = SOURCE_EYE_Z - world[2];
      if (!(eyeDistance >= SOURCE_NEAR && eyeDistance <= SOURCE_FAR)) {
        throw new Error(`Prepared cssMenger source face ${face.sourceIndex} left the clip interval`);
      }
      return Object.freeze({
        x: viewport.width / 2 + focalPixels * world[0] / eyeDistance,
        y: viewport.height / 2 - focalPixels * world[1] / eyeDistance,
        inverseEyeDistance: 1 / eyeDistance,
        windowDepth: windowDepthForEyeDistance(eyeDistance),
        color: Object.freeze(shadeVertex(material, world, normal)),
      });
    });
    for (const indices of [[0, 1, 2], [0, 2, 3]]) {
      const triangle = indices.map((index) => vertices[index]);
      const area = orient(triangle[0], triangle[1], triangle[2]);
      if (Math.abs(area) <= EPSILON) continue;
      const minX = Math.max(0, Math.ceil(Math.min(...triangle.map((value) => value.x)) - 0.5));
      const maxX = Math.min(viewport.width - 1, Math.floor(Math.max(...triangle.map((value) => value.x)) - 0.5));
      const minY = Math.max(0, Math.ceil(Math.min(...triangle.map((value) => value.y)) - 0.5));
      const maxY = Math.min(viewport.height - 1, Math.floor(Math.max(...triangle.map((value) => value.y)) - 0.5));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const sample = { x: x + 0.5, y: y + 0.5 };
          const barycentric = [
            orient(triangle[1], triangle[2], sample) / area,
            orient(triangle[2], triangle[0], sample) / area,
            orient(triangle[0], triangle[1], sample) / area,
          ];
          if (barycentric.some((weight) => weight < -EPSILON)) continue;
          candidateFragmentCount += 1;
          const windowDepth = barycentric.reduce((sum, weight, index) => (
            sum + weight * triangle[index].windowDepth
          ), 0);
          const depth24 = Math.max(0, Math.min(DEPTH_MAX, Math.round(windowDepth * DEPTH_MAX)));
          const pixelIndex = y * viewport.width + x;
          if (depth24 >= depth[pixelIndex]) continue;
          depth[pixelIndex] = depth24;
          depthAcceptedFragmentCount += 1;
          const inverseEyeDistance = barycentric.reduce((sum, weight, index) => (
            sum + weight * triangle[index].inverseEyeDistance
          ), 0);
          const frameOffset = pixelIndex * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            const numerator = barycentric.reduce((sum, weight, index) => (
              sum + weight * triangle[index].color[channel] * triangle[index].inverseEyeDistance
            ), 0);
            frame[frameOffset + channel] = byte(numerator / inverseEyeDistance);
          }
          frame[frameOffset + 3] = 255;
        }
      }
    }
  }

  const bounds = nonBlackBounds(frame, viewport);
  const pngBytes = await sharp(frame, {
    raw: { width: viewport.width, height: viewport.height, channels: 4 },
  }).png().toBuffer();
  return Object.freeze({
    schema: "cssmenger-prepared-source-projected-frame@1",
    stateIndex,
    viewport: Object.freeze({ ...viewport }),
    bounds,
    pngBytes,
    sourceFaceCount: faces.length,
    candidateFragmentCount,
    depthAcceptedFragmentCount,
    authority: Object.freeze({
      input: "independently-prepared-xscreensaver-source-state",
      nativeStateIngestion: false,
      nativePixelIngestion: false,
      runtimeProjection: false,
      runtimeRasterization: false,
      runtimeGeometryConstruction: false,
    }),
  });
}

function sourceFacesFor(geometry) {
  const cached = preparedFaces.get(geometry);
  if (cached) return cached;
  const faces = Object.freeze(geometry.sourceFaces.map((face) => Object.freeze({
    sourceIndex: face.sourceIndex,
    axisGroup: face.axisGroup,
    normal: Object.freeze([...preparedSourceFaceNormal(face)]),
    vertices: Object.freeze([...preparedSourceFaceVertices(face, geometry.cellsPerAxis)]
      .reverse()
      .map(([x, y, z]) => Object.freeze([x, -y, z]))),
  })));
  preparedFaces.set(geometry, faces);
  return faces;
}

function shadeVertex(material, [x, y, z], normal) {
  const light0 = normalize([-1 - x * 0.1, -1 - y * 0.1, 1 - z * 0.1]);
  const light1 = normalize([1 - x * 0.1, -0.2 - y * 0.1, 0.2 - z * 0.1]);
  const factor = 0.2 + Math.max(0, dot(normal, light0)) + Math.max(0, dot(normal, light1));
  return [0, 1, 2].map((channel) => clamp01(material[channel] * factor));
}

function rotateNative([x, y, z], [xDegrees, yDegrees, zDegrees]) {
  const zAngle = zDegrees * Math.PI / 180;
  const zx = x * Math.cos(zAngle) - y * Math.sin(zAngle);
  const zy = x * Math.sin(zAngle) + y * Math.cos(zAngle);
  const yAngle = yDegrees * Math.PI / 180;
  const yx = zx * Math.cos(yAngle) + z * Math.sin(yAngle);
  const yz = -zx * Math.sin(yAngle) + z * Math.cos(yAngle);
  const xAngle = xDegrees * Math.PI / 180;
  return [
    yx,
    zy * Math.cos(xAngle) - yz * Math.sin(xAngle),
    zy * Math.sin(xAngle) + yz * Math.cos(xAngle),
  ];
}

function windowDepthForEyeDistance(eyeDistance) {
  return SOURCE_FAR / (SOURCE_FAR - SOURCE_NEAR) -
    SOURCE_FAR * SOURCE_NEAR / ((SOURCE_FAR - SOURCE_NEAR) * eyeDistance);
}

function orient(first, second, third) {
  return (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x);
}

function nonBlackBounds(frame, viewport) {
  let left = viewport.width;
  let top = viewport.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < viewport.height; y += 1) {
    for (let x = 0; x < viewport.width; x += 1) {
      const offset = (y * viewport.width + x) * 4;
      if (frame[offset + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error("Prepared cssMenger source frame is blank");
  return Object.freeze({ left, top, right, bottom });
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((component) => component / length);
}

function dot(left, right) {
  return left.reduce((sum, component, axis) => sum + component * right[axis], 0);
}

function byte(value) {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
