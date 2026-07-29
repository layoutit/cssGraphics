import {
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  chromium,
} from "playwright";
import {
  resolve,
} from "node:path";
import {
  TITLE_HEAD_LIGHTING_FIELD_SIZE,
  measureTitleHeadSpatialReconstruction,
} from "./spatialResolution.mjs";

// visibilityAuditProducer
const FRAME_COUNT = 820;
const FACE_COUNT = 1213;
const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const AREA_EPSILON = 1e-7;
const LINE_EPSILON = 1e-9;
const DEPTH_EPSILON = 1e-12;

function cross(a, b, point) {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function signedArea(polygon) {
  let total = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    total += current.x * next.y - next.x * current.y;
  }
  return total / 2;
}

function area(polygon) {
  return Math.abs(signedArea(polygon));
}

function ccw(polygon) {
  return signedArea(polygon) < 0 ? [...polygon].reverse() : polygon;
}

function clipByValue(polygon, valueAt, keepPositive, epsilon = LINE_EPSILON) {
  if (polygon.length < 3) return [];
  const output = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const currentValue = valueAt(current);
    const nextValue = valueAt(next);
    const currentInside = keepPositive ? currentValue >= -epsilon : currentValue <= epsilon;
    const nextInside = keepPositive ? nextValue >= -epsilon : nextValue <= epsilon;
    if (currentInside) output.push(current);
    if (currentInside === nextInside) continue;
    const denominator = currentValue - nextValue;
    if (Math.abs(denominator) <= Number.EPSILON) continue;
    const ratio = currentValue / denominator;
    output.push({
      x: current.x + (next.x - current.x) * ratio,
      y: current.y + (next.y - current.y) * ratio,
    });
  }
  return output.length >= 3 && area(output) > AREA_EPSILON ? output : [];
}

function clipToConvex(subject, clip) {
  let output = subject;
  const normalized = ccw(clip);
  for (let index = 0; index < normalized.length && output.length >= 3; index += 1) {
    const start = normalized[index];
    const end = normalized[(index + 1) % normalized.length];
    output = clipByValue(output, (point) => cross(start, end, point), true);
  }
  return output;
}

function subtractConvex(subject, clip) {
  let inside = subject;
  const survivors = [];
  const normalized = ccw(clip);
  for (let index = 0; index < normalized.length && inside.length >= 3; index += 1) {
    const start = normalized[index];
    const end = normalized[(index + 1) % normalized.length];
    const valueAt = (point) => cross(start, end, point);
    const outside = clipByValue(inside, valueAt, false);
    if (outside.length >= 3 && area(outside) > AREA_EPSILON) survivors.push(outside);
    inside = clipByValue(inside, valueAt, true);
  }
  if (inside.length < 3) return [subject];
  return survivors;
}

function plane(points, values) {
  const [a, b, c] = points;
  const denominator = a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);
  if (Math.abs(denominator) <= Number.EPSILON) return null;
  const A = (
    values[0] * (b.y - c.y)
    + values[1] * (c.y - a.y)
    + values[2] * (a.y - b.y)
  ) / denominator;
  const B = (
    values[0] * (c.x - b.x)
    + values[1] * (a.x - c.x)
    + values[2] * (b.x - a.x)
  ) / denominator;
  const C = (
    values[0] * (b.x * c.y - c.x * b.y)
    + values[1] * (c.x * a.y - a.x * c.y)
    + values[2] * (a.x * b.y - b.x * a.y)
  ) / denominator;
  return { A, B, C };
}

function bounds(polygon) {
  const xs = polygon.map(({ x }) => x);
  const ys = polygon.map(({ y }) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function boundsOverlap(left, right) {
  return left.minX < right.maxX - LINE_EPSILON
    && right.minX < left.maxX - LINE_EPSILON
    && left.minY < right.maxY - LINE_EPSILON
    && right.minY < left.maxY - LINE_EPSILON;
}

function clipViewport(polygon) {
  let output = polygon;
  output = clipByValue(output, ({ x }) => x, true);
  output = clipByValue(output, ({ x }) => VIEWPORT.width - x, true);
  output = clipByValue(output, ({ y }) => y, true);
  output = clipByValue(output, ({ y }) => VIEWPORT.height - y, true);
  return output;
}

function prepareTriangles(rawTriangles, noViewportClip) {
  return rawTriangles.map((raw, index) => {
    const projected = ccw(raw.map(({ x, y }) => ({ x, y })));
    const polygon = noViewportClip
      ? projected
      : clipViewport(projected);
    if (polygon.length < 3 || area(polygon) <= AREA_EPSILON) {
      return { index, polygon: [], bounds: null, depth: null, projectedArea: 0 };
    }
    const depth = plane(
      raw.map(({ x, y }) => ({ x, y })),
      raw.map(({ inverseW }) => inverseW),
    );
    if (!depth) return { index, polygon: [], bounds: null, depth: null, projectedArea: 0 };
    return {
      index,
      polygon,
      bounds: bounds(polygon),
      depth,
      projectedArea: area(polygon),
    };
  });
}

function occludingPolygon(target, other) {
  if (!target.bounds || !other.bounds || !boundsOverlap(target.bounds, other.bounds)) return [];
  let overlap = clipToConvex(target.polygon, other.polygon);
  if (overlap.length < 3) return [];
  const difference = {
    A: other.depth.A - target.depth.A,
    B: other.depth.B - target.depth.B,
    C: other.depth.C - target.depth.C,
  };
  const values = overlap.map(({ x, y }) => difference.A * x + difference.B * y + difference.C);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (maximum <= DEPTH_EPSILON) {
    if (Math.abs(minimum) <= DEPTH_EPSILON && Math.abs(maximum) <= DEPTH_EPSILON
      && other.index > target.index) {
      return overlap;
    }
    return [];
  }
  if (minimum > DEPTH_EPSILON) return overlap;
  overlap = clipByValue(
    overlap,
    ({ x, y }) => difference.A * x + difference.B * y + difference.C - DEPTH_EPSILON,
    true,
    0,
  );
  return overlap;
}

function mathematicallyVisible(
  rawTriangles,
  order = "descending",
  noViewportClip = false,
) {
  const triangles = prepareTriangles(rawTriangles, noViewportClip);
  const visible = new Uint8Array(triangles.length);
  const visibleAreas = new Float64Array(triangles.length);
  let candidatePairs = 0;
  let occluderPolygons = 0;
  let maximumPieces = 0;
  for (const target of triangles) {
    if (target.polygon.length < 3) continue;
    const occluders = [];
    for (const other of triangles) {
      if (other.index === target.index || other.polygon.length < 3
        || !boundsOverlap(target.bounds, other.bounds)) continue;
      candidatePairs += 1;
      const polygon = occludingPolygon(target, other);
      if (polygon.length < 3 || area(polygon) <= AREA_EPSILON) continue;
      occluders.push({ polygon, coverage: area(polygon) });
      occluderPolygons += 1;
    }
    if (order !== "source") {
      occluders.sort(order === "reverse"
        ? (left, right) => left.coverage - right.coverage
        : (left, right) => right.coverage - left.coverage);
    }
    let pieces = [target.polygon];
    for (const { polygon } of occluders) {
      const next = [];
      for (const piece of pieces) next.push(...subtractConvex(piece, polygon));
      pieces = next.filter((piece) => area(piece) > AREA_EPSILON);
      maximumPieces = Math.max(maximumPieces, pieces.length);
      if (pieces.length === 0) break;
    }
    const remainingArea = pieces.reduce((total, piece) => total + area(piece), 0);
    if (remainingArea > AREA_EPSILON) {
      visible[target.index] = 1;
      visibleAreas[target.index] = remainingArea;
    }
  }
  return {
    visible,
    visibleAreas,
    stats: { candidatePairs, occluderPolygons, maximumPieces },
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

async function prepareTitleHeadVisibilityAudit({
  url,
  reportPath,
  conservativeUnion = false,
  frameStart = 1,
  frameLimit = FRAME_COUNT - frameStart + 1,
  browserExecutable = null,
  browserChannel = null,
  noViewportClip = false,
  includeAreas = false,
}) {
const URL = url;
const REPORT_PATH = reportPath;
const CONSERVATIVE_UNION = conservativeUnion;
const FRAME_START = frameStart;
const FRAME_LIMIT = frameLimit;
const browser = await chromium.launch({
  headless: true,
  ...(browserExecutable
    ? { executablePath: browserExecutable }
    : browserChannel ? { channel: browserChannel } : {}),
});
const criterion = noViewportClip
  ? "positive-area frontmost ideal projected triangle without viewport clipping"
  : "positive-area frontmost ideal projected triangle inside viewport";
const report = CONSERVATIVE_UNION
  ? {
      schema: "cssgraphics-mathematical-visibility-audit@1-conservative-union",
      criterion,
      atlasAlphaConsulted: false,
      numericalGuard:
        "visible if either largest-occluder-first or source-order convex subtraction retains positive area",
      frames: [],
    }
  : {
      schema: "cssgraphics-mathematical-visibility-audit@1",
      url: URL,
      viewport: VIEWPORT,
      criterion,
      atlasAlphaConsulted: false,
      frames: [],
    };

try {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  await page.goto(URL, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForFunction(() => (
    globalThis.__CSSGRAPHICS_PREPARE_AUDIT__?.sourceFrame === 0
    && document.querySelectorAll(".title-head-face").length === 1213
  ));

  const everVisible = new Uint8Array(FACE_COUNT);
  const alwaysVisible = new Uint8Array(FACE_COUNT);
  alwaysVisible.fill(1);
  let previousVisible = null;
  let totalTransitions = 0;
  let totalCandidatePairs = 0;
  let totalOccluderPolygons = 0;
  let maximumPieces = 0;
  let totalOrderDisagreement = 0;
  let maximumOrderDisagreement = 0;

  const frameEnd = Math.min(FRAME_COUNT, FRAME_START + FRAME_LIMIT - 1);
  for (let frame = FRAME_START; frame <= frameEnd; frame += 1) {
    const rawTriangles = await page.evaluate((sampledFrame) => {
      globalThis.__CSSGRAPHICS_PREPARE_AUDIT__.publish(sampledFrame);
      const leaves = [...document.querySelectorAll(".title-head-face")];
      const camera = document.querySelector(".polycss-camera");
      const scene = document.querySelector(".polycss-scene");
      const sceneMatrix = new DOMMatrix(getComputedStyle(scene).transform);
      const sceneLeft = scene.offsetLeft;
      const sceneTop = scene.offsetTop;
      const cameraRect = camera.getBoundingClientRect();
      const cameraMatrix = new DOMMatrix(getComputedStyle(camera).transform);
      const perspective = Number.parseFloat(getComputedStyle(camera).perspective);
      const [originX, originY] = getComputedStyle(camera).perspectiveOrigin
        .split(" ").map((entry) => Number.parseFloat(entry));
      const shapeMatrices = new Map();
      return leaves.map((leaf) => {
        const shape = leaf.parentElement;
        let shapeMatrix = shapeMatrices.get(shape);
        if (!shapeMatrix) {
          shapeMatrix = new DOMMatrix(getComputedStyle(shape).transform);
          shapeMatrices.set(shape, shapeMatrix);
        }
        const combined = sceneMatrix
          .multiply(shapeMatrix)
          .multiply(new DOMMatrix(getComputedStyle(leaf).transform));
        const width = Number(
          leaf.dataset.polycssTextureLeafWidth ?? leaf.offsetWidth,
        );
        const height = Number(
          leaf.dataset.polycssTextureLeafHeight ?? leaf.offsetHeight,
        );
        if (!Number.isFinite(width) || width <= 0
          || !Number.isFinite(height) || height <= 0) {
          throw new Error(
            `Visibility leaf ${leaf.dataset.polyIndex} has invalid sizing.`,
          );
        }
        return [[width / 2, 0], [0, height], [width, height]].map(([x, y]) => {
          const point = combined.transformPoint(new DOMPoint(x, y, 0, 1));
          const inverseW = 1 / (perspective - point.z);
          const perspectiveScale = perspective * inverseW;
          return {
            x: cameraRect.x + (
              originX + (point.x + sceneLeft - originX) * perspectiveScale
            ) * cameraMatrix.a,
            y: cameraRect.y + (
              originY + (point.y + sceneTop - originY) * perspectiveScale
            ) * cameraMatrix.d,
            inverseW,
          };
        });
      });
    }, frame);

    const descending = mathematicallyVisible(
      rawTriangles,
      "descending",
      noViewportClip,
    );
    const source = CONSERVATIVE_UNION
      ? mathematicallyVisible(rawTriangles, "source", noViewportClip)
      : null;
    const result = source === null
      ? descending
      : {
          ...descending,
          visible: Uint8Array.from(
            descending.visible,
            (visible, index) => visible || source.visible[index] ? 1 : 0,
          ),
        };
    const ids = [];
    let transitions = 0;
    let orderDisagreement = 0;
    for (let index = 0; index < FACE_COUNT; index += 1) {
      if (source !== null
        && descending.visible[index] !== source.visible[index]) {
        orderDisagreement += 1;
      }
      if (result.visible[index]) {
        ids.push(index);
        everVisible[index] = 1;
      } else {
        alwaysVisible[index] = 0;
      }
      if (previousVisible && previousVisible[index] !== result.visible[index]) transitions += 1;
    }
    previousVisible = result.visible;
    totalTransitions += transitions;
    totalCandidatePairs += result.stats.candidatePairs;
    totalOccluderPolygons += result.stats.occluderPolygons;
    maximumPieces = Math.max(maximumPieces, result.stats.maximumPieces);
    totalOrderDisagreement += orderDisagreement;
    maximumOrderDisagreement = Math.max(
      maximumOrderDisagreement,
      orderDisagreement,
    );
    report.frames.push({
      frame,
      visibleCount: ids.length,
      hiddenCount: FACE_COUNT - ids.length,
      transitions,
      visibleIds: ids,
      ...(CONSERVATIVE_UNION ? { orderDisagreement } : {}),
      ...(includeAreas ? {
        visibleAreas: ids.map((index) => [index, result.visibleAreas[index]]),
      } : {}),
    });
    if (frame === FRAME_START || frame % 25 === 0 || frame === frameEnd) {
      console.log(`frame ${frame}/${frameEnd}: visible=${ids.length} hidden=${FACE_COUNT - ids.length} transitions=${transitions}`);
    }
  }

  const visibleCounts = report.frames.map(({ visibleCount }) => visibleCount);
  const hiddenCounts = report.frames.map(({ hiddenCount }) => hiddenCount);
  const transitionCounts = report.frames.slice(1).map(({ transitions }) => transitions);
  report.summary = {
    faces: FACE_COUNT,
    frames: report.frames.length,
    visible: {
      min: Math.min(...visibleCounts),
      p50: percentile(visibleCounts, 0.5),
      p95: percentile(visibleCounts, 0.95),
      max: Math.max(...visibleCounts),
      mean: visibleCounts.reduce((sum, value) => sum + value, 0) / visibleCounts.length,
    },
    hidden: {
      min: Math.min(...hiddenCounts),
      p50: percentile(hiddenCounts, 0.5),
      p95: percentile(hiddenCounts, 0.95),
      max: Math.max(...hiddenCounts),
      mean: hiddenCounts.reduce((sum, value) => sum + value, 0) / hiddenCounts.length,
    },
    transitions: {
      min: Math.min(...transitionCounts),
      p50: percentile(transitionCounts, 0.5),
      p95: percentile(transitionCounts, 0.95),
      max: Math.max(...transitionCounts),
      mean: transitionCounts.length > 0 ? totalTransitions / transitionCounts.length : 0,
      total: totalTransitions,
    },
    everVisible: [...everVisible].filter(Boolean).length,
    neverVisible: [...everVisible].filter((value) => !value).length,
    alwaysVisible: [...alwaysVisible].filter(Boolean).length,
    ...(CONSERVATIVE_UNION
      ? {
          numericalOrderDisagreement: {
            mean: totalOrderDisagreement / report.frames.length,
            max: maximumOrderDisagreement,
            total: totalOrderDisagreement,
          },
        }
      : {
          auditComplexity: {
            meanCandidatePairs: totalCandidatePairs / report.frames.length,
            meanOccluderPolygons: totalOccluderPolygons / report.frames.length,
            maximumVisibleRegionPieces: maximumPieces,
          },
        }),
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath: REPORT_PATH, summary: report.summary }, null, 2));
  await context.close();
  return report;
} finally {
  await browser.close();
}
}

// transformAuditProducer
const TRANSFORM_FRAME_COUNT = 820;
const TRANSFORM_FACE_COUNT = 1213;
const SOURCE_VIEWPORT = Object.freeze({ width: 320, height: 240 });

function fail(message) {
  throw new Error(`Title-head transform audit: ${message}`);
}

function requiredPath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} is required`);
  }
  return resolve(value);
}

async function prepareTitleHeadTransformAudit({
  url,
  reportPath,
  trianglePlanPath,
  lightingPath,
  footprintPath,
  spatialPath = null,
  browserExecutable = null,
  browserChannel = null,
}) {
const URL = url;
if (typeof URL !== "string" || !URL.startsWith("http://127.0.0.1:")) {
  fail("TRANSFORM_URL must use the local prepare server");
}

const outputPath = requiredPath(reportPath, "reportPath");
const trianglePlan = JSON.parse(readFileSync(
  requiredPath(trianglePlanPath, "trianglePlanPath"),
  "utf8",
));
const lighting = JSON.parse(readFileSync(
  requiredPath(lightingPath, "lightingPath"),
  "utf8",
));
const footprint = JSON.parse(readFileSync(
  requiredPath(footprintPath, "footprintPath"),
  "utf8",
));
const spatial = typeof spatialPath === "string" && spatialPath.length > 0
  ? JSON.parse(readFileSync(requiredPath(spatialPath, "spatialPath"), "utf8"))
  : null;
const lightingSizedFirstPass = spatial === null;

if (trianglePlan?.schema !== "cssgraphics-title-head-triangle-plan@2"
  || trianglePlan.leaves?.length !== TRANSFORM_FACE_COUNT
  || lighting.surface?.faces?.length !== TRANSFORM_FACE_COUNT
  || footprint?.schema !== "cssgraphics-title-head-surface-footprints@1"
  || footprint.samples !== TRANSFORM_FRAME_COUNT
  || footprint.faceCount !== TRANSFORM_FACE_COUNT
  || (!lightingSizedFirstPass && spatial.faces?.length !== TRANSFORM_FACE_COUNT)) {
  fail("the plan, sizing, footprint, and spatial contracts are not aligned");
}
if (lightingSizedFirstPass
  && lighting.schema !== "cssgraphics-title-head-lighting-atlases@9") {
  fail("the no-spatial first pass requires a prepared sizing lighting root");
}
const auditUrl = new globalThis.URL(URL);
if (auditUrl.searchParams.get("mode") !== "transform"
  || auditUrl.searchParams.get("raster") !== "leaf"
  || auditUrl.searchParams.get("sizing") === null) {
  fail("the transform audit must mount the supplied sizing contract in leaf mode");
}

const footprintWidths = Buffer.from(footprint.widthsBase64, "base64");
const footprintHeights = Buffer.from(footprint.heightsBase64, "base64");
if (footprintWidths.length !== TRANSFORM_FACE_COUNT
  || footprintHeights.length !== TRANSFORM_FACE_COUNT) {
  fail("the footprint rows are incomplete");
}

const sizingRows = Object.freeze(trianglePlan.leaves.map((leaf, sourceOrder) => {
  const atlasFace = lighting.surface.faces[sourceOrder];
  const spatialFace = spatial?.faces[sourceOrder] ?? null;
  if (leaf.sourceOrder !== sourceOrder
    || atlasFace?.sourceOrder !== sourceOrder
    || atlasFace.faceId !== leaf.faceId) {
    fail(`sizing face ${sourceOrder} does not match the triangle plan`);
  }
  const tileWidth = spatialFace?.tileWidth ?? atlasFace.tileWidth;
  const tileHeight = spatialFace?.tileHeight ?? atlasFace.tileHeight;
  const leafWidth = atlasFace.leafWidth ?? lighting.canonicalFaceSize;
  const leafHeight = atlasFace.leafHeight ?? lighting.canonicalFaceSize;
  const footprintWidth = spatialFace?.footprintWidth
    ?? Math.max(TITLE_HEAD_LIGHTING_FIELD_SIZE, footprintWidths[sourceOrder]);
  const footprintHeight = spatialFace?.footprintHeight
    ?? Math.max(TITLE_HEAD_LIGHTING_FIELD_SIZE, footprintHeights[sourceOrder]);
  if (!Number.isSafeInteger(tileWidth)
    || tileWidth < TITLE_HEAD_LIGHTING_FIELD_SIZE
    || !Number.isSafeInteger(tileHeight)
    || tileHeight < TITLE_HEAD_LIGHTING_FIELD_SIZE
    || !Number.isSafeInteger(leafWidth) || leafWidth < 1
    || !Number.isSafeInteger(leafHeight) || leafHeight < 1
    || !Number.isSafeInteger(footprintWidth)
    || footprintWidth < TITLE_HEAD_LIGHTING_FIELD_SIZE
    || !Number.isSafeInteger(footprintHeight)
    || footprintHeight < TITLE_HEAD_LIGHTING_FIELD_SIZE) {
    fail(`sizing face ${sourceOrder} has invalid raster dimensions`);
  }
  const errors = spatialFace === null
    ? measureTitleHeadSpatialReconstruction({
      footprint: Object.freeze({
        width: footprintWidth,
        height: footprintHeight,
      }),
      width: tileWidth,
      height: tileHeight,
    })
    : {
      maximumReconstructionError: spatialFace.maximumReconstructionError,
      maximumEdgeAlphaDeficit: spatialFace.maximumEdgeAlphaDeficit,
    };
  return Object.freeze({
    tileWidth,
    tileHeight,
    leafWidth,
    leafHeight,
    footprintWidth,
    footprintHeight,
    ...errors,
  });
}));

const browser = await chromium.launch({
  headless: true,
  ...(browserExecutable
    ? { executablePath: browserExecutable }
    : browserChannel ? { channel: browserChannel } : {}),
});

try {
  const page = await browser.newPage({
    viewport: SOURCE_VIEWPORT,
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(120_000);
  const response = await page.goto(URL, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  if (response?.status() !== 200) {
    fail(`prepare fixture returned ${response?.status()}`);
  }
  await page.waitForFunction(() => (
    globalThis.__CSSGRAPHICS_PREPARE_AUDIT__?.sourceFrame === 0
    && document.querySelectorAll(".title-head-face").length === 1213
  ));
  await page.evaluate(({ footprints, sizes }) => {
    const faces = [...document.querySelectorAll(".title-head-face")];
    for (const face of faces) {
      const sourceOrder = Number(face.dataset.polyIndex);
      const source = footprints[sourceOrder];
      const size = sizes[sourceOrder];
      if (!source || !size) {
        throw new Error(`Missing transform-audit row ${sourceOrder}.`);
      }
      face.dataset.auditFootprintWidth = String(source.width);
      face.dataset.auditFootprintHeight = String(source.height);
      const width = Number(
        face.dataset.polycssTextureLeafWidth ?? face.offsetWidth,
      );
      const height = Number(
        face.dataset.polycssTextureLeafHeight ?? face.offsetHeight,
      );
      if (width !== size.width || height !== size.height) {
        throw new Error(
          `Mounted face ${sourceOrder} is ${width}x${height}, `
          + `expected ${size.width}x${size.height}.`,
        );
      }
      for (const [sampleX, sampleY] of [
        [0.5, 0.1],
        [0.25, 0.75],
        [0.75, 0.75],
        [0.5, 2 / 3],
      ]) {
        for (const [x, y] of [
          [sampleX, sampleY],
          [sampleX + 0.05, sampleY],
          [sampleX, sampleY + 0.05],
        ]) {
          const probe = document.createElement("span");
          probe.dataset.titleHeadTransformAuditProbe = "";
          probe.style.position = "absolute";
          probe.style.left = `${x * width}px`;
          probe.style.top = `${y * height}px`;
          probe.style.width = "0";
          probe.style.height = "0";
          probe.style.pointerEvents = "none";
          face.appendChild(probe);
        }
      }
    }
  }, {
    footprints: sizingRows.map((row) => ({
      width: row.footprintWidth,
      height: row.footprintHeight,
    })),
    sizes: sizingRows.map((row) => ({
      width: row.leafWidth,
      height: row.leafHeight,
    })),
  });

  const maxima = Array.from({ length: TRANSFORM_FACE_COUNT }, () => ({
    visibleSamples: 0,
    currentSigma: 0,
    exactSigma: 0,
    axisStretchX: 0,
    axisStretchY: 0,
    shearCosine: 0,
    frameIndex: -1,
    sampledFrame: -1,
  }));
  const sampledFrames = [];

  for (let frameIndex = 0; frameIndex < TRANSFORM_FRAME_COUNT; frameIndex += 1) {
    const sample = await page.evaluate(() => {
      const sampledFrame = globalThis
        .__CSSGRAPHICS_PREPARE_AUDIT__
        .publishNextPlaybackFrame();
      const singularValue = (u, v) => {
        const [ax, ay] = u;
        const [bx, by] = v;
        const aa = ax * ax + ay * ay;
        const bb = bx * bx + by * by;
        const ab = ax * bx + ay * by;
        return Math.sqrt(
          (aa + bb + Math.sqrt((aa - bb) ** 2 + 4 * ab * ab)) / 2,
        );
      };
      const length = (vector) => Math.hypot(vector[0], vector[1]);
      const subtract = (left, right) => [
        left[0] - right[0],
        left[1] - right[1],
      ];
      const scale = (vector, divisor) => [
        vector[0] / divisor,
        vector[1] / divisor,
      ];
      const dot = (left, right) => (
        left[0] * right[0] + left[1] * right[1]
      );
      const rows = [...document.querySelectorAll(".title-head-face")].map(
        (face) => {
          const style = getComputedStyle(face);
          if (style.visibility === "hidden"
            || style.display === "none"
            || Number(style.opacity) === 0) {
            return null;
          }
          const points = [...face.querySelectorAll(
            ":scope > [data-title-head-transform-audit-probe]",
          )].map((probe) => {
            const rect = probe.getBoundingClientRect();
            return [rect.x, rect.y];
          });
          const leafWidth = Number(
            face.dataset.polycssTextureLeafWidth ?? face.offsetWidth,
          );
          const leafHeight = Number(
            face.dataset.polycssTextureLeafHeight ?? face.offsetHeight,
          );
          const footprintWidth = Number(face.dataset.auditFootprintWidth);
          const footprintHeight = Number(face.dataset.auditFootprintHeight);
          const pairs = [];
          for (let pointIndex = 0; pointIndex < points.length; pointIndex += 3) {
            pairs.push([
              scale(
                subtract(points[pointIndex + 1], points[pointIndex]),
                0.05 * leafWidth,
              ),
              scale(
                subtract(points[pointIndex + 2], points[pointIndex]),
                0.05 * leafHeight,
              ),
            ]);
          }
          const exactPairs = pairs.map(([u, v]) => [
            scale(u, footprintWidth / leafWidth),
            scale(v, footprintHeight / leafHeight),
          ]);
          return {
            sourceOrder: Number(face.dataset.polyIndex),
            currentSigma: Math.max(
              ...pairs.map(([u, v]) => singularValue(u, v)),
            ),
            exactSigma: Math.max(
              ...exactPairs.map(([u, v]) => singularValue(u, v)),
            ),
            axisStretchX: Math.max(...pairs.map(([u]) => length(u))),
            axisStretchY: Math.max(...pairs.map(([, v]) => length(v))),
            shearCosine: Math.max(...pairs.map(([u, v]) => {
              const denominator = length(u) * length(v);
              return denominator === 0
                ? 0
                : Math.abs(dot(u, v) / denominator);
            })),
          };
        },
      );
      return { sampledFrame, rows };
    });
    sampledFrames.push(sample.sampledFrame);
    for (const row of sample.rows) {
      if (!row) continue;
      const current = maxima[row.sourceOrder];
      current.visibleSamples += 1;
      current.axisStretchX = Math.max(
        current.axisStretchX,
        row.axisStretchX,
      );
      current.axisStretchY = Math.max(
        current.axisStretchY,
        row.axisStretchY,
      );
      current.shearCosine = Math.max(
        current.shearCosine,
        row.shearCosine,
      );
      current.exactSigma = Math.max(current.exactSigma, row.exactSigma);
      if (row.currentSigma > current.currentSigma) {
        current.currentSigma = row.currentSigma;
        current.frameIndex = frameIndex;
        current.sampledFrame = sample.sampledFrame;
      }
    }
    if ((frameIndex + 1) % 100 === 0 || frameIndex + 1 === TRANSFORM_FRAME_COUNT) {
      process.stdout.write(
        `audited ${frameIndex + 1}/${TRANSFORM_FRAME_COUNT} frames\n`,
      );
    }
  }

  const blockPixels = (face, width, height) => (
    (face.columns * (width + 1) + 1)
      * (face.rows * (height + 1) + 1)
  );
  const faces = trianglePlan.leaves.map((leaf, sourceOrder) => {
    const atlasFace = lighting.surface.faces[sourceOrder];
    const sizing = sizingRows[sourceOrder];
    const measured = maxima[sourceOrder];
    return Object.freeze({
      sourceOrder,
      faceId: leaf.faceId,
      shapeId: leaf.shapeId,
      materialId: leaf.materialId,
      visibleSamples: measured.visibleSamples,
      selectedSize: Object.freeze({
        width: sizing.tileWidth,
        height: sizing.tileHeight,
      }),
      sourceFootprint: Object.freeze({
        width: sizing.footprintWidth,
        height: sizing.footprintHeight,
      }),
      maximumCurrentTexelStretch: measured.currentSigma,
      maximumExactFootprintTexelStretch: measured.exactSigma,
      maximumAxisStretchX: measured.axisStretchX,
      maximumAxisStretchY: measured.axisStretchY,
      maximumShearCosine: measured.shearCosine,
      worstFrameIndex: measured.frameIndex,
      worstSampledFrame: measured.sampledFrame,
      currentBlockPixels: blockPixels(
        atlasFace,
        sizing.tileWidth,
        sizing.tileHeight,
      ),
      exactFootprintBlockPixels: blockPixels(
        atlasFace,
        sizing.footprintWidth,
        sizing.footprintHeight,
      ),
      reconstructionMaximumError: sizing.maximumReconstructionError,
      edgeMaximumAlphaDeficit: sizing.maximumEdgeAlphaDeficit,
    });
  });
  const percentile = (values, quantile) => {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor((sorted.length - 1) * quantile)];
  };
  const summary = (rows) => {
    const stretch = rows.map((face) => face.maximumCurrentTexelStretch);
    const exactStretch = rows.map(
      (face) => face.maximumExactFootprintTexelStretch,
    );
    return Object.freeze({
      faces: rows.length,
      underResolved: Object.freeze({
        above1: rows.filter(
          (face) => face.maximumCurrentTexelStretch > 1
        ).length,
        above1_25: rows.filter(
          (face) => face.maximumCurrentTexelStretch > 1.25
        ).length,
        above1_5: rows.filter(
          (face) => face.maximumCurrentTexelStretch > 1.5
        ).length,
        above2: rows.filter(
          (face) => face.maximumCurrentTexelStretch > 2
        ).length,
      }),
      currentStretch: Object.freeze({
        p50: percentile(stretch, 0.5),
        p95: percentile(stretch, 0.95),
        p99: percentile(stretch, 0.99),
        maximum: Math.max(...stretch),
      }),
      exactFootprintDirectionStretch: Object.freeze({
        p50: percentile(exactStretch, 0.5),
        p95: percentile(exactStretch, 0.95),
        p99: percentile(exactStretch, 0.99),
        maximum: Math.max(...exactStretch),
        above1: rows.filter(
          (face) => face.maximumExactFootprintTexelStretch > 1
        ).length,
        above1_1: rows.filter(
          (face) => face.maximumExactFootprintTexelStretch > 1.1
        ).length,
      }),
      estimatedBlockBytes: Object.freeze({
        current: rows.reduce(
          (total, face) => total + face.currentBlockPixels * 4,
          0,
        ),
        exactFootprint: rows.reduce(
          (total, face) => total + face.exactFootprintBlockPixels * 4,
          0,
        ),
      }),
    });
  };
  const groupBy = (key) => {
    const groups = new Map();
    for (const face of faces) {
      const id = face[key];
      const retained = groups.get(id) ?? [];
      retained.push(face);
      groups.set(id, retained);
    }
    return Object.freeze([...groups].map(([id, rows]) => Object.freeze({
      id,
      ...summary(rows),
    })).sort((left, right) => (
      right.currentStretch.maximum - left.currentStretch.maximum
      || left.id.localeCompare(right.id)
    )));
  };
  const report = Object.freeze({
    schema: "cssgraphics-title-head-final-transform-sampling-audit@1",
    route: URL,
    browser: Object.freeze({
      name: "chromium",
      version: browser.version(),
      headless: true,
    }),
    sourceViewport: SOURCE_VIEWPORT,
    sourceFrames: TRANSFORM_FRAME_COUNT,
    sampledFrameMinimum: Math.min(...sampledFrames),
    sampledFrameMaximum: Math.max(...sampledFrames),
    trianglePlanHash: trianglePlan.contentHash,
    lightingHash: lighting.contentHash,
    spatialReportHash: spatial?.contentHash ?? null,
    method:
      "visible final DOM leaf local finite differences; maximum 2x2 singular value at four interior points of the actual canonical triangle domain",
    interpretation:
      "values above 1 mean one prepared atlas texel is enlarged beyond one source-viewport CSS pixel before fullscreen composition",
    summary: summary(faces),
    byShape: groupBy("shapeId"),
    byMaterial: groupBy("materialId"),
    offenders: Object.freeze([...faces].sort((left, right) => (
      right.maximumCurrentTexelStretch - left.maximumCurrentTexelStretch
      || left.sourceOrder - right.sourceOrder
    )).slice(0, 100)),
    faces: Object.freeze(faces),
  });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    browser: report.browser,
    summary: report.summary,
    worst: report.offenders.slice(0, 10),
  }, null, 2)}\n`);
  return report;
} finally {
  await browser.close();
}
}
export {
  prepareTitleHeadTransformAudit,
  prepareTitleHeadVisibilityAudit,
};
