export const FLOAT = Math.fround;
const POLYCSS_SOURCE_UNIT_PIXELS = 50;

export const CSSFLOWER_SOURCE_PROFILE = Object.freeze({
  schema: "cssflower-source-profile@1",
  id: "microsoft-flower-box-default-cube-subdiv10",
  authority: "src/adapters/flowerbox/README.md",
  authorityStatus: "pinned-source-native-state-validated-locally-not-packaged",
  geometry: "cube",
  subdivision: 10,
  sideCount: 6,
  sideLocalPointCount: 726,
  triangleCount: 1200,
  smoothShading: true,
  bloom: Object.freeze({
    resetSf: 0,
    minSf: -1.1,
    maxSf: 5.1,
    sfIncrement: 0.05,
    radialFormula: "d = float32(length(basePosition) * 2); vlen = float32((1 - d) / d); position = float32(basePosition * float32(vlen * sf + 1))",
    radialFormulaStatus: "pinned-source-operation-order",
    crossingRule: "reverse-sfi-after-crossing-bound-without-clamp",
    arithmetic: "ieee754-binary32-stepwise",
  }),
  rotation: Object.freeze({ xDegreesPerUpdate: 3, yDegreesPerUpdate: 2, zDegreesPerUpdate: 0 }),
  colorCycling: false,
  camera: Object.freeze({
    fovDegrees: 45,
    eye: Object.freeze([0, 0, 3.5]),
    target: Object.freeze([0, 0, 0]),
    up: Object.freeze([0, 1, 0]),
    near: 2,
    far: 5,
    aspect: 1,
    stagePixels: 720,
  }),
  light: Object.freeze({
    position: Object.freeze([2, 2, 10, 1]),
    specular: Object.freeze([0.8, 0.8, 0.8, 1]),
    shininess: 30,
    globalAmbient: Object.freeze([0.2, 0.2, 0.2, 1]),
    materialAmbient: Object.freeze([0.2, 0.2, 0.2, 1]),
    lightAmbient: Object.freeze([0, 0, 0, 1]),
    lightDiffuse: Object.freeze([1, 1, 1, 1]),
    lightSpecular: Object.freeze([1, 1, 1, 1]),
    normalizeNormals: true,
    localViewer: false,
    positionSetUnderIdentityModelview: true,
    cameraTransformMatrix: "projection",
  }),
  presentationTicksPerSecond: 30,
});

export const CSSFLOWER_SIDE_MATERIALS = Object.freeze([
  Object.freeze({ id: "front-red", color: "#ff0000", rgb: Object.freeze([255, 0, 0]) }),
  Object.freeze({ id: "back-green", color: "#00ff00", rgb: Object.freeze([0, 255, 0]) }),
  Object.freeze({ id: "top-blue", color: "#0000ff", rgb: Object.freeze([0, 0, 255]) }),
  Object.freeze({ id: "bottom-magenta", color: "#ff00ff", rgb: Object.freeze([255, 0, 255]) }),
  Object.freeze({ id: "right-cyan", color: "#00ffff", rgb: Object.freeze([0, 255, 255]) }),
  Object.freeze({ id: "left-yellow", color: "#ffff00", rgb: Object.freeze([255, 255, 0]) }),
]);

export const CSSFLOWER_CAMERA = Object.freeze(buildPolyCssCamera());

export function buildPolyCssCamera() {
  const source = CSSFLOWER_SOURCE_PROFILE.camera;
  const perspective = source.stagePixels / 2 / Math.tan(source.fovDegrees * Math.PI / 360);
  return {
    projection: "perspective",
    perspective,
    zoom: POLYCSS_SOURCE_UNIT_PIXELS,
    rotX: 0,
    rotY: 0,
    target: [0, 0, 0],
    distance: POLYCSS_SOURCE_UNIT_PIXELS * source.eye[2] - perspective,
    calibration: {
      sourceUnitPixels: POLYCSS_SOURCE_UNIT_PIXELS,
      equation: "zoom*p/(p+distance-sourceUnitPixels*z) = p/(eyeZ-z)",
      depthAware: true,
    },
    sourceViewport: { width: source.stagePixels, height: source.stagePixels },
    source: {
      fovDegrees: source.fovDegrees,
      eye: [...source.eye],
      target: [...source.target],
      up: [...source.up],
      near: source.near,
      far: source.far,
      aspect: source.aspect,
    },
  };
}

export function sourceToPolyCss([x, y, z]) {
  return [FLOAT(-y), FLOAT(x), FLOAT(z)];
}

export function preparedRootTransform(xDegrees, yDegrees) {
  const x = normalizeDegrees(xDegrees);
  const y = normalizeDegrees(yDegrees);
  return `rotateX(${-x}deg) rotateY(${y}deg)`;
}

export function normalizeDegrees(value) {
  const normalized = value % 360;
  return Object.is(normalized, -0) ? 0 : normalized < 0 ? normalized + 360 : normalized;
}

export function floatBits(value) {
  const floats = new Float32Array([FLOAT(value)]);
  return new Uint32Array(floats.buffer)[0];
}

export function floatHex(value) {
  return floatBits(value).toString(16).padStart(8, "0");
}
