import {
  mountTitleHeadRetainedScene,
} from "./scene.js";
import {
  createRegularTitleHeadAnimatorState,
  stepRegularTitleHeadAnimatorState,
} from "../source-model/animator.js";
import { parseTitleHeadAuditMotion } from "./motion.js";

const SOURCE_VIEWPORT = Object.freeze({ width: 320, height: 240 });
const CAMERA = Object.freeze({
  sourceWorldPosition: Object.freeze([0, 200, 2000] as const),
  near: 30,
  far: 5000,
  rotX: 90,
  rotY: 90,
  zoom: 50,
  perspectivePx: 120 / Math.tan(Math.PI / 8),
});
const APPEARANCE = Object.freeze({
  19: Object.freeze(["arrival-19", 0.9723, -28.074] as const),
  20: Object.freeze(["arrival-20", 0.7824, -20.14] as const),
  21: Object.freeze(["arrival-21", 0.9372, -10.995] as const),
});
const STEADY_APPEARANCE = Object.freeze(["steady", 1, 0] as const);

type JsonRecord = Record<string, unknown>;

interface AuditTrianglePlan {
  readonly topology: Readonly<{
    shapes: readonly Readonly<{ id: string }>[];
    materials: readonly Readonly<{ id: string; sourceAlpha: number }>[];
  }>;
  readonly leaves: readonly Readonly<{
    id: string;
    sourceOrder: number;
    shapeId: string;
    faceId: string;
    materialId: string;
    polycss: Readonly<{
      transform: string;
      update: Readonly<{
        canonicalSize: number;
        matrixDecimals: number;
      }>;
    }>;
  }>[];
  readonly totals: Readonly<{
    shapeRoots: number;
    sourceFaces: number;
  }>;
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function generatedRoot(): string {
  const value = new URLSearchParams(globalThis.location.search).get("root");
  if (!value
    || !value.startsWith("/build/generated/")
    || value.includes("\\")
    || value.includes("?")
    || value.includes("#")
    || value.split("/").includes("..")) {
    throw new TypeError("The prepare audit needs one ignored generated root.");
  }
  return value.replace(/\/+$/u, "");
}

function normalizedAssetPath(value: string | null, label: string): string {
  if (!value
    || !value.startsWith("/")
    || value.includes("\\")
    || value.includes("?")
    || value.includes("#")
    || value.split("/").includes("..")) {
    throw new TypeError(`${label} must be one root-relative ignored path.`);
  }
  return value;
}

async function response(path: string): Promise<Response> {
  const result = await fetch(path, { cache: "no-store" });
  if (!result.ok) throw new Error(`${path} returned ${result.status}.`);
  return result;
}

function configureCamera(
  scene: ReturnType<typeof mountTitleHeadRetainedScene>,
): void {
  const targetDepth = (
    CAMERA.sourceWorldPosition[2] - CAMERA.perspectivePx
  ) / CAMERA.zoom;
  scene.root.camera.update({
    target: [0, targetDepth, CAMERA.sourceWorldPosition[1] / CAMERA.zoom],
    rotX: CAMERA.rotX,
    rotY: CAMERA.rotY,
    zoom: CAMERA.zoom,
    distance: 0,
  });
  scene.root.updateProjection({
    perspectivePx: CAMERA.perspectivePx,
    originX: SOURCE_VIEWPORT.width / 2,
    originY: SOURCE_VIEWPORT.height / 2,
    screenRollDegrees: 0,
    near: CAMERA.near,
    far: CAMERA.far,
  });
}

const root = generatedRoot();
const search = new URLSearchParams(globalThis.location.search);
const mode = search.get("mode") ?? "visibility";
const rasterMode = search.get("raster") ?? "leaf";
if (mode !== "visibility" && mode !== "transform") {
  throw new TypeError(`Unknown prepare-audit mode ${mode}.`);
}
if (rasterMode !== "leaf"
  && rasterMode !== "tile"
  && rasterMode !== "field") {
  throw new TypeError(`Unknown prepare-audit raster mode ${rasterMode}.`);
}
const footprintPath = normalizedAssetPath(
  search.get("footprints"),
  "The prepare audit footprint report",
);
const sizingPath = search.get("sizing") === null
  ? null
  : normalizedAssetPath(
    search.get("sizing"),
    "The prepare audit sizing contract",
  );
const visibilityPath = search.get("visibility") === null
  ? null
  : normalizedAssetPath(
    search.get("visibility"),
    "The prepare audit visibility report",
  );
const [
  trianglePlan,
  footprintTrianglePlan,
  animation,
  deformation,
  motionResponse,
  footprintReport,
  sizing,
  visibilityAudit,
] = await Promise.all([
  response(`${root}/triangle-plan.json`).then((value) => value.json()),
  response(`${root}/triangle-plan-footprint.json`).then(
    (value) => value.json(),
  ),
  response(`${root}/animation-graph.json`).then((value) => value.json()),
  response(`${root}/deformation-graph.json`).then((value) => value.json()),
  response(`${root}/motion-frames-footprint.bin`),
  response(footprintPath).then((value) => value.json()),
  sizingPath === null
    ? Promise.resolve(null)
    : response(sizingPath).then((value) => value.json()),
  visibilityPath === null
    ? Promise.resolve(null)
    : response(visibilityPath).then((value) => value.json()),
]);
// The source-lighting and footprint plans intentionally use recovered
// prepare-only seam constants that the public runtime parser must reject.
// Their producer has already hash-verified them before this fixture runs.
const plan = trianglePlan as AuditTrianglePlan;
const footprints = record(footprintReport, "footprint report");
if (footprints.schema !== "cssgraphics-title-head-surface-footprints@1"
  || footprints.samples !== 820
  || footprints.faceCount !== 1213
  || typeof footprints.widthsBase64 !== "string"
  || typeof footprints.heightsBase64 !== "string") {
  throw new TypeError("The prepare audit footprint report is incomplete.");
}
const decodeBytes = (value: string): Uint8Array => {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
const footprintWidths = decodeBytes(footprints.widthsBase64);
const footprintHeights = decodeBytes(footprints.heightsBase64);
const sizingContract = sizing === null
  ? null
  : record(sizing, "sizing contract");
const sizingFaces = sizingContract === null
  ? null
  : (sizingContract.surface as JsonRecord | undefined)?.faces;
const sizingCanonicalFaceSize = sizingContract === null
  ? null
  : Number(sizingContract.canonicalFaceSize);
if (footprintWidths.length !== plan.leaves.length
  || footprintHeights.length !== plan.leaves.length
  || (sizingFaces !== null
    && (!Array.isArray(sizingFaces)
      || sizingFaces.length !== plan.leaves.length))) {
  throw new TypeError("The prepare audit sizing rows do not cover the topology.");
}
const rasterSizes = plan.leaves.map((leaf) => {
  const sizingFace = sizingFaces === null
    ? null
    : record(sizingFaces[leaf.sourceOrder], `sizing face ${leaf.sourceOrder}`);
  if (mode === "visibility") {
    const canonicalSize = Number(leaf.polycss.update.canonicalSize);
    if (!Number.isSafeInteger(canonicalSize) || canonicalSize < 1) {
      throw new TypeError(
        `Prepare audit face ${leaf.sourceOrder} has no native coordinate box.`,
      );
    }
    return Object.freeze({
      leafWidth: canonicalSize,
      leafHeight: canonicalSize,
    });
  }
  const minimumSize = rasterMode === "leaf" ? 1 : 4;
  const leafWidth = Math.max(
    minimumSize,
    Number(
      (rasterMode === "field"
        ? (leaf.shapeId === "mario-mustache"
          ? footprintWidths[leaf.sourceOrder]
          : 4)
        : rasterMode === "tile"
          ? sizingFace?.tileWidth
          : sizingFace?.leafWidth ?? sizingCanonicalFaceSize)
      ?? sizingFace?.leafWidth
      ?? sizingFace?.tileWidth
      ?? footprintWidths[leaf.sourceOrder],
    ),
  );
  const leafHeight = Math.max(
    minimumSize,
    Number(
      (rasterMode === "field"
        ? (leaf.shapeId === "mario-mustache"
          ? footprintHeights[leaf.sourceOrder]
          : 4)
        : rasterMode === "tile"
          ? sizingFace?.tileHeight
          : sizingFace?.leafHeight ?? sizingCanonicalFaceSize)
      ?? sizingFace?.leafHeight
      ?? sizingFace?.tileHeight
      ?? footprintHeights[leaf.sourceOrder],
    ),
  );
  if (!Number.isSafeInteger(leafWidth) || leafWidth < minimumSize
    || !Number.isSafeInteger(leafHeight) || leafHeight < minimumSize) {
    throw new TypeError(`Prepare audit face ${leaf.sourceOrder} has invalid raster sizing.`);
  }
  return Object.freeze({ leafWidth, leafHeight });
});
const renderPlan = {
  shapes: plan.topology.shapes.map((shape) => ({
    id: shape.id,
  })),
  materials: plan.topology.materials.map((material) => ({
    id: material.id,
    sourceAlpha: material.sourceAlpha,
  })),
  leaves: plan.leaves.map((leaf) => {
    const raster = rasterSizes[leaf.sourceOrder];
    return {
      id: leaf.id,
      sourceOrder: leaf.sourceOrder,
      shapeId: leaf.shapeId,
      faceId: leaf.faceId,
      materialId: leaf.materialId,
      polycss: {
        transform: leaf.polycss.transform,
        paint: {
          path: "model/title-head-surface-atlas.png",
          backgroundPosition: "0px 0px",
          backgroundSize: `${raster.leafWidth}px ${raster.leafHeight}px`,
          leafWidth: raster.leafWidth,
          leafHeight: raster.leafHeight,
        },
        update: {
          canonicalSize: leaf.polycss.update.canonicalSize,
          matrixDecimals: leaf.polycss.update.matrixDecimals,
        },
      },
    };
  }),
  totals: {
    shapeRoots: plan.totals.shapeRoots,
    faceLeaves: plan.totals.sourceFaces,
  },
};

const host = document.body;
const initialVisible = new Uint8Array(plan.leaves.length);
initialVisible.fill(1);
const scene = mountTitleHeadRetainedScene(
  host,
  renderPlan,
  {
    assetBase: `${root}/`,
    initialVisibleFaces: initialVisible,
  },
);
if (scene.triangleHandles.size !== 1213) {
  throw new Error(`Mounted ${scene.triangleHandles.size} leaves, expected 1213.`);
}
for (const leaf of scene.plan.leaves) {
  const handle = scene.triangleHandles.get(leaf.faceId);
  const raster = rasterSizes[leaf.sourceOrder];
  if (!handle || !raster) {
    throw new Error(`Leaf ${leaf.sourceOrder} is not bound to its raster row.`);
  }
  handle.element.classList.add("title-head-face");
  handle.element.dataset.polyIndex = String(leaf.sourceOrder);
  handle.element.dataset.polycssTextureLeafWidth = String(raster.leafWidth);
  handle.element.dataset.polycssTextureLeafHeight = String(raster.leafHeight);
}

const motion = parseTitleHeadAuditMotion(
  new Uint8Array(await motionResponse.arrayBuffer()),
  {
    animation,
    deformation,
    footprintTrianglePlan: footprintTrianglePlan as Parameters<
      typeof parseTitleHeadAuditMotion
    >[1]["footprintTrianglePlan"],
    rasterSizes,
    fitRaster: mode === "transform",
  },
);
configureCamera(scene);
const allFaceIndices = Uint16Array.from(
  { length: plan.leaves.length },
  (_, index) => index,
);
const visibilityRows = (() => {
  if (mode !== "transform") return null;
  if (visibilityAudit !== null) {
    const audit = record(visibilityAudit, "visibility audit");
    if (audit.schema
        !== "cssgraphics-mathematical-visibility-audit@1-conservative-union"
      || !Array.isArray(audit.frames)
      || audit.frames.length !== 820) {
      throw new TypeError("The prepare visibility audit is incomplete.");
    }
    return Object.freeze(audit.frames.map((entry, frameIndex) => {
      const frame = record(entry, `visibility frame ${frameIndex + 1}`);
      if (frame.frame !== frameIndex + 1
        || !Array.isArray(frame.visibleIds)) {
        throw new TypeError(
          `The prepare visibility frame ${frameIndex + 1} is incomplete.`,
        );
      }
      const row = new Uint8Array(plan.leaves.length);
      for (const faceIndex of frame.visibleIds) {
        if (!Number.isSafeInteger(faceIndex)
          || faceIndex < 0
          || faceIndex >= row.length) {
          throw new TypeError(
            `The prepare visibility frame ${frameIndex + 1} is invalid.`,
          );
        }
        row[faceIndex] = 1;
      }
      return row;
    }));
  }
  if (sizing === null) return null;
  const visibility = (record(sizing, "sizing contract")
    .visibilityCulling ?? null) as JsonRecord | null;
  if (!visibility
    || typeof visibility.initialVisibleBitsBase64 !== "string"
    || !visibility.sequential
    || typeof visibility.sequential !== "object") {
    return null;
  }
  const initialBits = decodeBytes(visibility.initialVisibleBitsBase64);
  const current = Uint8Array.from(
    { length: plan.leaves.length },
    (_, index) => (initialBits[index >> 3] >> (index & 7)) & 1,
  );
  const sequential = record(
    visibility.sequential,
    "visibility sequential schedule",
  );
  const offsetsBytes = decodeBytes(String(sequential.offsetsBase64));
  const faceBytes = decodeBytes(String(sequential.faceIndicesBase64));
  const offsets = new Uint32Array(821);
  const indices = new Uint16Array(faceBytes.length / 2);
  const offsetView = new DataView(offsetsBytes.buffer);
  const faceView = new DataView(faceBytes.buffer);
  for (let index = 0; index < offsets.length; index += 1) {
    offsets[index] = offsetView.getUint32(index * 4, true);
  }
  for (let index = 0; index < indices.length; index += 1) {
    indices[index] = faceView.getUint16(index * 2, true);
  }
  const rows = [current.slice()];
  for (let target = 1; target < 820; target += 1) {
    for (let index = offsets[target]; index < offsets[target + 1]; index += 1) {
      current[indices[index]] ^= 1;
    }
    rows.push(current.slice());
  }
  return Object.freeze(rows);
})();
let sourceFrame = 0;
let tick = 0;
let animator = createRegularTitleHeadAnimatorState();

function appearance(frame: number): readonly [string, number, number] {
  return APPEARANCE[frame as keyof typeof APPEARANCE] ?? STEADY_APPEARANCE;
}

function compose(frame: number): void {
  const fit = mode === "transform"
    ? STEADY_APPEARANCE
    : appearance(frame);
  const viewportWidth = globalThis.innerWidth;
  const viewportHeight = globalThis.innerHeight;
  const scale = Math.min(
    viewportWidth / SOURCE_VIEWPORT.width,
    viewportHeight / SOURCE_VIEWPORT.height,
  );
  scene.root.updateViewportComposition({
    viewportWidth,
    viewportHeight,
    sourceWidth: SOURCE_VIEWPORT.width,
    sourceHeight: SOURCE_VIEWPORT.height,
    sourceScale: scale,
    appearanceScale: fit[1],
    translateYSourcePx: fit[2],
    appearanceId: fit[0],
  });
}

const audit = Object.freeze({
  scene,
  motion,
  get sourceFrame(): number {
    return sourceFrame;
  },
  publish(nextFrame: number): void {
    if (nextFrame < 1 || nextFrame > 820) {
      throw new TypeError(
        `Prepare-audit frame ${String(nextFrame)} is outside 1..820.`,
      );
    }
    if (mode === "transform" && visibilityRows !== null) {
      scene.synchronizePreparedVisibility(
        {
          visibleFaces: visibilityRows[nextFrame - 1],
          changedFaceIndices: allFaceIndices,
        },
        true,
      );
    }
    const profile = motion.profile(
      nextFrame,
      mode === "transform" ? 0 : sourceFrame,
    );
    scene.tickPreparedMotion({
      tick,
      ...profile,
    });
    tick += 1;
    sourceFrame = nextFrame;
    compose(sourceFrame);
  },
  publishNextPlaybackFrame(): number {
    const sampledFrame = animator.frame;
    animator = stepRegularTitleHeadAnimatorState(
      animator,
      { dragging: false },
    );
    this.publish(sampledFrame);
    return sampledFrame;
  },
});

(globalThis as typeof globalThis & {
  __CSSGRAPHICS_PREPARE_AUDIT__?: typeof audit;
}).__CSSGRAPHICS_PREPARE_AUDIT__ = audit;
host.dataset.state = "ready";
