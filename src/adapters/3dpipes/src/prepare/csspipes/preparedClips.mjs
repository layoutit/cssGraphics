import { createHash } from "node:crypto";
import {
  buildPolySceneTransform,
} from "@layoutit/polycss";
import {
  CSSPIPES_CAMERA_CONTRACT,
  CSSPIPES_PALETTE,
  CSSPIPES_PREBAKE_CONFIG,
  CSSPIPES_PRODUCT_PALETTE,
  CSSPIPES_SOURCE_VIEWPORT,
  CSSPIPES_VIEWPORT_PROFILES,
  preparedPipeLeafCount,
} from "./endlessTubes.mjs";
import {
  buildPreparedBandIntervalLeafTransforms,
  buildPreparedBandLeafTransforms,
  buildPreparedTransportedFrames,
  buildWeldedPipeMesh,
} from "./weldedTubeMesh.mjs";

const DIRECTIONS = Object.freeze([
  Object.freeze({ delta: Object.freeze([1, 0, 0]) }),
  Object.freeze({ delta: Object.freeze([-1, 0, 0]) }),
  Object.freeze({ delta: Object.freeze([0, 1, 0]) }),
  Object.freeze({ delta: Object.freeze([0, -1, 0]) }),
  Object.freeze({ delta: Object.freeze([0, 0, 1]) }),
  Object.freeze({ delta: Object.freeze([0, 0, -1]) }),
]);

const STARTS = Object.freeze([
  Object.freeze([-6, -4, -3]),
  Object.freeze([6, -4, 3]),
  Object.freeze([-5, 5, 3]),
  Object.freeze([5, 5, -3]),
  Object.freeze([0, 0, 0]),
  Object.freeze([-6, 0, 3]),
  Object.freeze([6, 0, -3]),
]);
const CSSPIPES_DESKTOP_MEAN_ZOOM = 30;

if (STARTS.length !== CSSPIPES_PREBAKE_CONFIG.pipeCount) {
  throw new Error("cssPipes prepared start count must match pipeCount");
}

function xorshift32(seed) {
  let state = seed >>> 0 || 0x6d2b79f5;
  return Object.freeze({
    next() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0x1_0000_0000;
    },
  });
}

const cellKey = (cell) => `${cell[0]},${cell[1]},${cell[2]}`;
const addCell = (cell, delta) => [
  cell[0] + delta[0], cell[1] + delta[1], cell[2] + delta[2],
];
const opposite = (left, right) =>
  left.delta[0] === -right.delta[0] &&
  left.delta[1] === -right.delta[1] &&
  left.delta[2] === -right.delta[2];

function chooseDirection(
  random,
  current,
  cell,
  occupied,
  allowedCell = () => true,
  preferredCellScore = null,
) {
  const candidates = DIRECTIONS.filter((direction) => {
    const next = addCell(cell, direction.delta);
    return !opposite(direction, current) && allowedCell(next) &&
      !occupied.has(cellKey(next));
  });
  if (candidates.length === 0) return null;
  if (preferredCellScore) {
    const scored = candidates.map((direction) => ({
      direction,
      score: preferredCellScore(addCell(cell, direction.delta)),
    }));
    const minimum = Math.min(...scored.map((entry) => entry.score));
    const preferred = scored.filter((entry) => entry.score === minimum)
      .map((entry) => entry.direction);
    const straight = preferred.find((direction) => direction === current);
    if (straight && random.next() < CSSPIPES_PREBAKE_CONFIG.straightWeight) {
      return straight;
    }
    return preferred[Math.floor(random.next() * preferred.length)];
  }
  const straight = candidates.find((direction) => direction === current);
  if (straight && random.next() < CSSPIPES_PREBAKE_CONFIG.straightWeight) return straight;
  const turns = candidates.filter((direction) => direction !== current);
  const pool = turns.length > 0 ? turns : candidates;
  return pool[Math.floor(random.next() * pool.length)];
}

const candidateSeed = (candidate) =>
  (0x9e3779b9 * (candidate + 1) + 0x43535350) >>> 0;

const MATERIAL_FIXED_INDICES = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

function preparedColorOklab(hex) {
  const channels = hex.match(/[0-9a-f]{2}/giu).map((value) =>
    Number.parseInt(value, 16) / 255).map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const [red, green, blue] = channels;
  const long = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  );
  const medium = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  );
  const short = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  );
  return Object.freeze([
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  ]);
}

const MATERIAL_OKLAB = Object.freeze(CSSPIPES_PALETTE.map(preparedColorOklab));

function materialOklabDistance(left, right) {
  return Math.hypot(
    MATERIAL_OKLAB[left][0] - MATERIAL_OKLAB[right][0],
    MATERIAL_OKLAB[left][1] - MATERIAL_OKLAB[right][1],
    MATERIAL_OKLAB[left][2] - MATERIAL_OKLAB[right][2],
  );
}

function minimumMaterialOklabDistance(indices) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let left = 0; left < indices.length; left += 1) {
    for (let right = left + 1; right < indices.length; right += 1) {
      minimum = Math.min(minimum, materialOklabDistance(indices[left], indices[right]));
    }
  }
  return minimum;
}

function buildPreparedMaterialSelection(_seed, sourcePipeBySlot) {
  if (!Array.isArray(sourcePipeBySlot) ||
      sourcePipeBySlot.length !== CSSPIPES_PREBAKE_CONFIG.pipeCount ||
      new Set(sourcePipeBySlot).size !== CSSPIPES_PREBAKE_CONFIG.pipeCount ||
      !sourcePipeBySlot.every((sourcePipe) => Number.isInteger(sourcePipe) &&
        sourcePipe >= 0 && sourcePipe < CSSPIPES_PREBAKE_CONFIG.pipeCount)) {
    throw new Error("cssPipes prepared source-pipe order must be a complete permutation");
  }
  const materialIndicesByPipe = Object.freeze(
    sourcePipeBySlot.map((sourcePipe) => MATERIAL_FIXED_INDICES[sourcePipe]),
  );
  return Object.freeze({
    materialIndicesByPipe,
    diversity: Object.freeze({
      schema: "csspipes-prepared-fixed-material-proof@1",
      fixedSet: true,
      sourcePipeStable: true,
      repeatedMaterialCount: materialIndicesByPipe.length -
        new Set(materialIndicesByPipe).size,
      minimumOklabDistance: Number(
        minimumMaterialOklabDistance(materialIndicesByPipe).toFixed(6),
      ),
    }),
  });
}

function initializeCandidateWalkers({
  random,
  occupied,
  starts,
  initialDirections,
  allowedCell,
  usePreparedStarts,
}) {
  return starts.map((start, pipe) => {
    const preparedStart = usePreparedStarts
      ? [...start]
      : start.map((value) => value + Math.floor(random.next() * 5) - 2);
    if (!allowedCell(preparedStart) || occupied.has(cellKey(preparedStart))) return null;
    occupied.add(cellKey(preparedStart));
    return {
      pipe,
      startCell: preparedStart,
      cell: preparedStart,
      direction: initialDirections?.[pipe] ??
        DIRECTIONS[Math.floor(random.next() * DIRECTIONS.length)],
      segments: [],
    };
  });
}

function advanceCandidateWalkers({
  random,
  occupied,
  walkers,
  endpointTargets,
  allowedCell,
  returnToStarts,
  forceInitialDirections,
}) {
  for (let segment = 0; segment < CSSPIPES_PREBAKE_CONFIG.segmentsPerPipe; segment += 1) {
    for (const walker of walkers) {
      const endpointTarget = endpointTargets?.[walker.pipe] ??
        (returnToStarts ? walker.startCell : null);
      const preferredCellScore = endpointTarget && segment >=
          CSSPIPES_PREBAKE_CONFIG.segmentsPerPipe -
            CSSPIPES_PREBAKE_CONFIG.preparedChainEndpointReturnSegments
        ? (cell) => cell.reduce(
          (total, value, axis) => total + Math.abs(value - endpointTarget[axis]),
          0,
        )
        : null;
      const forcedDirection = segment === 0 && forceInitialDirections
        ? walker.direction
        : null;
      const forcedNext = forcedDirection
        ? addCell(walker.cell, forcedDirection.delta)
        : null;
      const direction = forcedDirection && allowedCell(forcedNext) &&
          !occupied.has(cellKey(forcedNext))
        ? forcedDirection
        : forcedDirection
          ? null
          : chooseDirection(
            random,
            walker.direction,
            walker.cell,
            occupied,
            allowedCell,
            preferredCellScore,
          );
      if (!direction) return false;
      const next = addCell(walker.cell, direction.delta);
      walker.segments.push({ start: walker.cell, end: next, direction });
      walker.cell = next;
      walker.direction = direction;
      occupied.add(cellKey(next));
    }
  }
  return true;
}

function candidateBounds(walkers) {
  const segments = walkers.flatMap((walker) => walker.segments);
  const points = segments.flatMap((segment) => [segment.start, segment.end]);
  const min = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
  const span = min.map((value, axis) => max[axis] - value);
  if (Math.max(...span) > 34 || span[0] < 15 || span[1] < 15 || span[2] < 12) {
    return null;
  }
  const center = [0, 1, 2].map((axis) =>
    points.reduce((total, point) => total + point[axis], 0) / points.length);
  return { walkers, points, min, max, span, center };
}

function generateCandidate(seed, options = {}) {
  const random = xorshift32(seed);
  const occupied = new Set(options.blockedCellKeys ?? []);
  const starts = options.starts ?? STARTS;
  const initialDirections = options.initialDirections ?? null;
  const endpointTargets = options.endpointTargets ?? null;
  const allowedCell = options.allowedCell ?? (() => true);
  if (starts.length !== CSSPIPES_PREBAKE_CONFIG.pipeCount ||
      (initialDirections && initialDirections.length !== starts.length)) {
    throw new Error("Prepared cssPipes chained start state is incomplete");
  }
  if (options.starts) {
    for (const start of starts) occupied.delete(cellKey(start));
  }
  const walkers = initializeCandidateWalkers({
    random,
    occupied,
    starts,
    initialDirections,
    allowedCell,
    usePreparedStarts: Boolean(options.starts),
  });
  if (walkers.includes(null) || !advanceCandidateWalkers({
    random,
    occupied,
    walkers,
    endpointTargets,
    allowedCell,
    returnToStarts: options.returnToStarts,
    forceInitialDirections: options.forceInitialDirections,
  })) return null;
  if (options.requireFreeContinuation && walkers.some((walker) =>
    occupied.has(cellKey(addCell(walker.cell, walker.direction.delta))))) {
    return null;
  }
  return candidateBounds(walkers);
}

function generatedCellKeys(generated) {
  return new Set(generated.walkers.flatMap((walker) => walker.segments.flatMap(
    (segment) => [cellKey(segment.start), cellKey(segment.end)],
  )));
}

function generatedFromPipeSegments(segmentsByPipe) {
  if (!Array.isArray(segmentsByPipe) ||
      segmentsByPipe.length !== CSSPIPES_PREBAKE_CONFIG.pipeCount ||
      segmentsByPipe.some((segments) => !Array.isArray(segments) || segments.length === 0)) {
    throw new TypeError("Prepared cssPipes full route requires seven non-empty pipes");
  }
  const walkers = segmentsByPipe.map((segments, pipe) => Object.freeze({
    pipe,
    startCell: Object.freeze([...segments[0].start]),
    cell: Object.freeze([...segments.at(-1).end]),
    direction: segments.at(-1).direction,
    segments: Object.freeze([...segments]),
  }));
  const points = walkers.flatMap((walker) =>
    walker.segments.flatMap((segment) => [segment.start, segment.end]));
  const min = [0, 1, 2].map((axis) =>
    Math.min(...points.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) =>
    Math.max(...points.map((point) => point[axis])));
  const span = min.map((value, axis) => max[axis] - value);
  const center = [0, 1, 2].map((axis) =>
    points.reduce((total, point) => total + point[axis], 0) / points.length);
  return Object.freeze({
    walkers: Object.freeze(walkers),
    points: Object.freeze(points),
    min: Object.freeze(min),
    max: Object.freeze(max),
    span: Object.freeze(span),
    center: Object.freeze(center),
  });
}

function concatenateGeneratedCheckpoints(checkpoints) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    throw new TypeError("Prepared cssPipes full route requires generation checkpoints");
  }
  const segmentsByPipe = Array.from(
    { length: CSSPIPES_PREBAKE_CONFIG.pipeCount },
    (_, sourcePipe) => checkpoints.flatMap((checkpoint, checkpointIndex) => {
      const walker = checkpoint.generated.walkers[sourcePipe];
      if (checkpointIndex > 0) {
        const previous = checkpoints[checkpointIndex - 1].generated.walkers[sourcePipe];
        if (cellKey(previous.cell) !== cellKey(walker.segments[0].start) ||
            previous.direction !== walker.segments[0].direction) {
          throw new Error(
            "Prepared cssPipes full route lost a welded generation checkpoint",
          );
        }
      }
      return walker.segments;
    }),
  );
  return generatedFromPipeSegments(segmentsByPipe);
}

function sliceGeneratedRouteBackwards(generated, segmentCount) {
  const totalSegments = generated.walkers[0].segments.length;
  if (!Number.isInteger(segmentCount) || segmentCount < 1 ||
      totalSegments % segmentCount !== 0 ||
      generated.walkers.some((walker) => walker.segments.length !== totalSegments)) {
    throw new Error("Prepared cssPipes full route cannot be sliced evenly");
  }
  const backwardSlices = [];
  for (let end = totalSegments; end > 0; end -= segmentCount) {
    const start = end - segmentCount;
    backwardSlices.push(Object.freeze({
      fullSegmentStart: start,
      generated: generatedFromPipeSegments(generated.walkers.map((walker) =>
        walker.segments.slice(start, end))),
    }));
  }
  return Object.freeze(backwardSlices.reverse());
}

function preparedFullRouteHash(generated) {
  return createHash("sha256").update(JSON.stringify(generated.walkers.map((walker) =>
    walker.segments.map((segment) => [
      segment.start,
      segment.end,
      segment.direction.delta,
    ])))).digest("hex");
}

function compileMaximalRuns(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return Object.freeze([]);
  const runs = [];
  let startSegment = 0;
  for (let segmentIndex = 1; segmentIndex <= segments.length; segmentIndex += 1) {
    if (segmentIndex < segments.length &&
        segments[segmentIndex].direction === segments[startSegment].direction) continue;
    const runSegments = segments.slice(startSegment, segmentIndex);
    runs.push({
      startSegment,
      endSegment: segmentIndex,
      segmentCount: segmentIndex - startSegment,
      direction: runSegments[0].direction,
      start: runSegments[0].start,
      end: runSegments.at(-1).end,
      segments: runSegments,
    });
    startSegment = segmentIndex;
  }
  return Object.freeze(runs.map((run, runIndex) => Object.freeze({
    ...run,
    hasPrevious: runIndex > 0,
    hasNext: runIndex < runs.length - 1,
    segments: Object.freeze(run.segments),
  })));
}

const radians = (degrees) => degrees * Math.PI / 180;

function rotateZ([x, y, z], degrees) {
  const angle = radians(degrees);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine * x - sine * y, sine * x + cosine * y, z];
}

function rotateX([x, y, z], degrees) {
  const angle = radians(degrees);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [x, cosine * y - sine * z, sine * y + cosine * z];
}

function preparedCssPoint(point, target, zoom) {
  const relative = point.map((value, axis) => value - target[axis]);
  let css = [relative[1] * 50, relative[0] * 50, relative[2] * 50];
  css = rotateZ(css, CSSPIPES_CAMERA_CONTRACT.rotY);
  css = rotateX(css, CSSPIPES_CAMERA_CONTRACT.rotX);
  return css.map((value) => value * zoom / 50);
}

function projectPreparedPoint(point, target, zoom) {
  const css = preparedCssPoint(point, target, zoom);
  const perspectiveScale = CSSPIPES_CAMERA_CONTRACT.perspective /
    (CSSPIPES_CAMERA_CONTRACT.perspective - css[2]);
  return [
    CSSPIPES_SOURCE_VIEWPORT.width / 2 + css[0] * perspectiveScale,
    CSSPIPES_SOURCE_VIEWPORT.height / 2 + css[1] * perspectiveScale,
  ];
}

function expandedPreparedPoints(points) {
  const radius = CSSPIPES_PREBAKE_CONFIG.tubeRadius * 1.35;
  return points.flatMap((point) => [
    point,
    [point[0] + radius, point[1], point[2]],
    [point[0] - radius, point[1], point[2]],
    [point[0], point[1] + radius, point[2]],
    [point[0], point[1] - radius, point[2]],
    [point[0], point[1], point[2] + radius],
    [point[0], point[1], point[2] - radius],
  ]);
}

function projectedBounds(points, target, zoom) {
  const projected = points.map((point) => projectPreparedPoint(point, target, zoom));
  const minX = Math.min(...projected.map((point) => point[0]));
  const maxX = Math.max(...projected.map((point) => point[0]));
  const minY = Math.min(...projected.map((point) => point[1]));
  const maxY = Math.max(...projected.map((point) => point[1]));
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function fitCamera(points) {
  const expanded = expandedPreparedPoints(points);
  const target = [0, 0, 0];
  let zoom = 27;
  const targetWidth = CSSPIPES_SOURCE_VIEWPORT.width;
  const targetHeight = CSSPIPES_SOURCE_VIEWPORT.height - CSSPIPES_CAMERA_CONTRACT.safeTopGap;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const bounds = projectedBounds(expanded, target, zoom);
    zoom *= Math.max(1, targetWidth / bounds.width, targetHeight / bounds.height);
  }
  zoom = Math.max(18, Math.min(58, zoom));
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const bounds = projectedBounds(expanded, target, zoom);
    const errorX = (bounds.minX + bounds.maxX) / 2 - CSSPIPES_SOURCE_VIEWPORT.width / 2;
    const errorY = (bounds.minY + bounds.maxY) / 2 - CSSPIPES_SOURCE_VIEWPORT.height / 2;
    const xBounds = projectedBounds(expanded, [target[0] + 0.1, target[1], target[2]], zoom);
    const yBounds = projectedBounds(expanded, [target[0], target[1] + 0.1, target[2]], zoom);
    const ax = ((xBounds.minX + xBounds.maxX) / 2 - (bounds.minX + bounds.maxX) / 2) / 0.1;
    const ay = ((xBounds.minY + xBounds.maxY) / 2 - (bounds.minY + bounds.maxY) / 2) / 0.1;
    const bx = ((yBounds.minX + yBounds.maxX) / 2 - (bounds.minX + bounds.maxX) / 2) / 0.1;
    const by = ((yBounds.minY + yBounds.maxY) / 2 - (bounds.minY + bounds.maxY) / 2) / 0.1;
    const determinant = ax * by - ay * bx;
    if (Math.abs(determinant) < 1e-8) break;
    target[0] += (-errorX * by + errorY * bx) / determinant;
    target[1] += (-ax * errorY + ay * errorX) / determinant;
  }
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const bounds = projectedBounds(expanded, target, zoom);
    const factor = Math.max(1, targetWidth / bounds.width, targetHeight / bounds.height);
    if (Math.abs(factor - 1) < 0.0001) break;
    zoom = Math.max(18, Math.min(58, zoom * factor));
  }
  const bounds = projectedBounds(expanded, target, zoom);
  const state = Object.freeze({
    target: Object.freeze(target.map((value) => Number(value.toFixed(6)))),
    zoom: Number(zoom.toFixed(6)),
    rotX: CSSPIPES_CAMERA_CONTRACT.rotX,
    rotY: CSSPIPES_CAMERA_CONTRACT.rotY,
    distance: CSSPIPES_CAMERA_CONTRACT.distance,
  });
  return Object.freeze({
    state,
    transform: buildPolySceneTransform(state),
    projectedBounds: Object.freeze(Object.fromEntries(
      Object.entries(bounds).map(([key, value]) => [key, Number(value.toFixed(3))]),
    )),
  });
}

function preparedPerspectiveQualification(points, camera) {
  const maximumDepth = Math.max(...expandedPreparedPoints(points).map((point) =>
    preparedCssPoint(point, camera.state.target, camera.state.zoom)[2]));
  const perspectiveScale = CSSPIPES_CAMERA_CONTRACT.perspective /
    (CSSPIPES_CAMERA_CONTRACT.perspective - maximumDepth);
  const qualified = Number.isFinite(perspectiveScale) &&
    maximumDepth < CSSPIPES_CAMERA_CONTRACT.perspective &&
    perspectiveScale <= CSSPIPES_PREBAKE_CONFIG.preparedPerspectiveScaleMaximum;
  return Object.freeze({
    qualified,
    maximumDepth: Number(maximumDepth.toFixed(6)),
    perspectiveScale: Number(perspectiveScale.toFixed(6)),
  });
}

function limitPreparedPerspective(points, camera) {
  const qualification = preparedPerspectiveQualification(points, camera);
  if (qualification.qualified) return { camera, qualification };
  const maximumDepth = CSSPIPES_CAMERA_CONTRACT.perspective *
    (1 - 1 / CSSPIPES_PREBAKE_CONFIG.preparedPerspectiveScaleMaximum);
  const scale = maximumDepth / qualification.maximumDepth;
  if (!(scale > 0 && scale < 1)) {
    throw new Error("Prepared camera perspective clearance cannot be fitted");
  }
  const limitedCamera = scaledPreparedCamera(camera, scale);
  const limitedQualification = preparedPerspectiveQualification(points, limitedCamera);
  if (!limitedQualification.qualified) {
    throw new Error("Prepared camera perspective clearance did not converge");
  }
  return { camera: limitedCamera, qualification: limitedQualification };
}

function preparedCameraQualification(camera) {
  const bounds = camera.projectedBounds;
  const aspectRatio = bounds.width / bounds.height;
  const overscanRatio = Math.max(
    bounds.width / CSSPIPES_SOURCE_VIEWPORT.width,
    bounds.height / CSSPIPES_SOURCE_VIEWPORT.height,
  );
  const qualified = bounds.width >= 1200 && bounds.height >= 620 &&
    aspectRatio >= CSSPIPES_PREBAKE_CONFIG.preparedCameraAspectRatioMinimum &&
    aspectRatio <= CSSPIPES_PREBAKE_CONFIG.preparedCameraAspectRatioMaximum &&
    overscanRatio <= CSSPIPES_PREBAKE_CONFIG.preparedCameraOverscanMaximum;
  return Object.freeze({
    qualified,
    aspectRatio: Number(aspectRatio.toFixed(6)),
    overscanRatio: Number(overscanRatio.toFixed(6)),
  });
}

function preparedScreenOccupancy(points, camera) {
  const columns = CSSPIPES_PREBAKE_CONFIG.preparedScreenGridColumns;
  const rows = CSSPIPES_PREBAKE_CONFIG.preparedScreenGridRows;
  const occupied = new Set();
  for (const point of points) {
    const [x, y] = projectPreparedPoint(point, camera.state.target, camera.state.zoom);
    if (x < 0 || x > CSSPIPES_SOURCE_VIEWPORT.width ||
        y < 0 || y > CSSPIPES_SOURCE_VIEWPORT.height) continue;
    const column = Math.min(columns - 1, Math.floor(
      x / CSSPIPES_SOURCE_VIEWPORT.width * columns,
    ));
    const row = Math.min(rows - 1, Math.floor(
      y / CSSPIPES_SOURCE_VIEWPORT.height * rows,
    ));
    occupied.add(row * columns + column);
  }
  const occupiedCellCount = occupied.size;
  const totalCellCount = columns * rows;
  return Object.freeze({
    schema: "csspipes-prepared-screen-occupancy@1",
    columns,
    rows,
    occupiedCellCount,
    totalCellCount,
    occupiedRatio: Number((occupiedCellCount / totalCellCount).toFixed(6)),
    qualified: occupiedCellCount >=
      CSSPIPES_PREBAKE_CONFIG.preparedScreenMinimumOccupiedCells,
  });
}

function scaledPreparedCamera(camera, scale) {
  const state = Object.freeze({
    ...camera.state,
    zoom: Number((camera.state.zoom * scale).toFixed(6)),
  });
  const centerX = CSSPIPES_SOURCE_VIEWPORT.width / 2;
  const centerY = CSSPIPES_SOURCE_VIEWPORT.height / 2;
  const scaled = (value, center) => center + (value - center) * scale;
  const projectedBounds = Object.freeze({
    minX: Number(scaled(camera.projectedBounds.minX, centerX).toFixed(3)),
    maxX: Number(scaled(camera.projectedBounds.maxX, centerX).toFixed(3)),
    minY: Number(scaled(camera.projectedBounds.minY, centerY).toFixed(3)),
    maxY: Number(scaled(camera.projectedBounds.maxY, centerY).toFixed(3)),
    width: Number((camera.projectedBounds.width * scale).toFixed(3)),
    height: Number((camera.projectedBounds.height * scale).toFixed(3)),
  });
  return Object.freeze({
    state,
    transform: buildPolySceneTransform(state),
    projectedBounds,
  });
}

function applyPreparedPresentationCameras(entries) {
  const desktop = entries.filter((entry) => entry.viewportProfile === "desktop");
  const meanZoom = desktop.reduce(
    (total, entry) => total + entry.camera.state.zoom,
    0,
  ) / desktop.length;
  const scale = CSSPIPES_DESKTOP_MEAN_ZOOM / meanZoom;
  return entries.map((entry) => {
    const presentationScale = entry.viewportProfile === "desktop" ? scale : 1;
    const presentationCamera = scaledPreparedCamera(entry.camera, presentationScale);
    const presentationChainCamera = scaledPreparedCamera(
      entry.chainCamera,
      presentationScale,
    );
    const localPoints = entry.generated.points.map((point) =>
      preparedCellPoint(point, entry.preparedCenter));
    const limited = limitPreparedPerspective(localPoints, presentationCamera);
    const cameraScale = limited.camera.state.zoom / presentationCamera.state.zoom;
    const chainCamera = scaledPreparedCamera(presentationChainCamera, cameraScale);
    return Object.freeze({
      ...entry,
      camera: limited.camera,
      cameraQualification: preparedCameraQualification(limited.camera),
      perspectiveQualification: limited.qualification,
      screenOccupancy: preparedScreenOccupancy(localPoints, limited.camera),
      chainCamera,
      chainScreenOccupancy: preparedScreenOccupancy(localPoints, chainCamera),
    });
  });
}

const sameState = (left, right) =>
  left.rootTransform === right.rootTransform && left.rootOpacity === right.rootOpacity &&
  JSON.stringify(left.shapeTransforms) === JSON.stringify(right.shapeTransforms) &&
  JSON.stringify(left.shapeVisibility) === JSON.stringify(right.shapeVisibility) &&
  JSON.stringify(left.leafTransforms) === JSON.stringify(right.leafTransforms) &&
  JSON.stringify(left.leafVisibility) === JSON.stringify(right.leafVisibility);

function cloneState(state) {
  return {
    rootTransform: state.rootTransform,
    rootOpacity: state.rootOpacity,
    shapeTransforms: [...state.shapeTransforms],
    shapeVisibility: [...state.shapeVisibility],
    leafTransforms: [...state.leafTransforms],
    leafVisibility: [...state.leafVisibility],
  };
}

function applyRetractionRows(state, rows, leafTransitions, side) {
  const transformColumn = side === "before" ? 1 : 3;
  const visibilityColumn = side === "before" ? 2 : 4;
  for (const row of rows) {
    for (let index = 0; index < row[1]; index += 1) {
      const offset = (row[0] + index) * 5;
      const leaf = leafTransitions[offset];
      state.leafTransforms[leaf] = leafTransitions[offset + transformColumn];
      state.leafVisibility[leaf] = leafTransitions[offset + visibilityColumn];
    }
  }
  return state;
}

function stateDigest(state) {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

const preparedTransformScalar = (value) => Number(value.toFixed(12));

function preparedPipeEndpointRing(mesh, endpoint) {
  const ring = endpoint === "start" ? mesh.startRing : mesh.endRing;
  if (!ring) throw new Error(`Prepared cssPipes ${endpoint} ring is missing`);
  return ring;
}

function preparedPipeEndpointPoint(entry, sourcePipe, endpoint) {
  const slot = entry.sourcePipeBySlot.indexOf(sourcePipe);
  if (slot < 0) throw new Error(`Prepared cssPipes source pipe ${sourcePipe} is missing`);
  const mesh = entry.weldedMeshesByPipe[slot];
  const ring = preparedPipeEndpointRing(mesh, endpoint);
  return Object.freeze(mesh.rootPosition.map((value, axis) =>
    preparedTransformScalar(value + ring.center[axis])));
}

function preparedPipeEndpointRingPoints(entry, sourcePipe, endpoint) {
  const slot = entry.sourcePipeBySlot.indexOf(sourcePipe);
  if (slot < 0) throw new Error(`Prepared cssPipes source pipe ${sourcePipe} is missing`);
  const mesh = entry.weldedMeshesByPipe[slot];
  const ring = preparedPipeEndpointRing(mesh, endpoint);
  return Object.freeze(ring.vertices.map((vertex) => Object.freeze(
    vertex.map((value, axis) => preparedTransformScalar(
      value + mesh.rootPosition[axis],
    )),
  )));
}

function preparedRingSetError(left, right) {
  return Math.max(...left.map((point) => Math.min(...right.map((candidate) =>
    Math.hypot(...point.map((value, axis) => value - candidate[axis]))))));
}

function buildPreparedSourceSchedule(sourceFrameCount, targetFrameCount, direction) {
  if (!Number.isInteger(sourceFrameCount) || sourceFrameCount < 1 ||
      !Number.isInteger(targetFrameCount) || targetFrameCount < 1 ||
      (direction !== "ascending" && direction !== "descending")) {
    throw new TypeError("Prepared cssPipes snake schedule is incomplete");
  }
  const motionFrameCount = sourceFrameCount - 1;
  if (motionFrameCount < 1 || targetFrameCount > motionFrameCount) {
    throw new RangeError("Prepared cssPipes snake schedule cannot contain idle frames");
  }
  let consumed = 0;
  const rows = Array.from({ length: targetFrameCount }, (_, frame) => {
    const start = Math.floor(frame * motionFrameCount / targetFrameCount);
    const end = Math.floor((frame + 1) * motionFrameCount / targetFrameCount);
    const count = end - start;
    consumed += count;
    return Object.freeze([
      direction === "ascending" ? start + 1 : sourceFrameCount - start - 2,
      count,
    ]);
  });
  if (consumed !== motionFrameCount || rows.some((row) => row[1] < 1)) {
    throw new Error("Prepared cssPipes snake schedule did not consume its source rows");
  }
  return Object.freeze(rows);
}

function buildPreparedBankRecycle({
  recording,
  transitionFrameCount,
  tailSourceRows,
  recycleClipIndex,
  recycleRecording,
  recycleShapeTransforms,
  pipeLeafOffsets,
  leavesPerPipeByPipe,
}) {
  if (recycleClipIndex === null) {
    return Object.freeze({
      rows: Object.freeze([]),
      shapeAssignments: Object.freeze([]),
      leafAssignments: Object.freeze([]),
    });
  }
  if (!recycleRecording || recycleShapeTransforms.length !== pipeLeafOffsets.length ||
      tailSourceRows.length !== transitionFrameCount) {
    throw new Error("Prepared cssPipes recycled bank is incomplete");
  }
  const completionFrameByPipe = pipeLeafOffsets.map((_, pipe) => {
    const sourceFrame = Math.max(...recording.snakeTail.bandRows
      .filter((row) => row[0] === pipe)
      .map((row) => row[3]));
    const frame = tailSourceRows.findIndex(([start, count]) =>
      sourceFrame >= start && sourceFrame < start + count);
    if (frame < 0) throw new Error(`Prepared recycled pipe ${pipe} has no completion frame`);
    return frame;
  });
  const connectedLeavesByPipe = pipeLeafOffsets.map((offset, pipe) => {
    const end = offset + leavesPerPipeByPipe[pipe];
    const leaves = [];
    const connected = recycleRecording.experiment.connectedInitial.leaves;
    for (let index = 0; index < connected.length; index += 3) {
      const leaf = connected[index];
      if (leaf >= offset && leaf < end) leaves.push(leaf, connected[index + 1], 0);
    }
    return Object.freeze(leaves);
  });
  const shapeAssignments = [];
  const leafAssignments = [];
  const rows = Array.from({ length: transitionFrameCount }, (_, frame) => {
    const shapeOffset = shapeAssignments.length / 2;
    const leafOffset = leafAssignments.length / 3;
    for (let pipe = 0; pipe < completionFrameByPipe.length; pipe += 1) {
      if (completionFrameByPipe[pipe] !== frame) continue;
      shapeAssignments.push(pipe, recycleShapeTransforms[pipe]);
      leafAssignments.push(...connectedLeavesByPipe[pipe]);
    }
    return Object.freeze([
      shapeOffset,
      shapeAssignments.length / 2 - shapeOffset,
      leafOffset,
      leafAssignments.length / 3 - leafOffset,
    ]);
  });
  if (shapeAssignments.length / 2 !== pipeLeafOffsets.length ||
      leafAssignments.length / 3 !==
        recycleRecording.experiment.connectedInitial.leaves.length / 3) {
    throw new Error("Prepared cssPipes recycled bank did not cover its connected seed");
  }
  return Object.freeze({
    rows: Object.freeze(rows),
    shapeAssignments: Object.freeze(shapeAssignments),
    leafAssignments: Object.freeze(leafAssignments),
  });
}

function buildPreparedZSeedLoopTrack({
  entry,
  recording,
  nextEntry,
  nextRecording,
  recycleClipIndex,
  recycleRecording,
  recycleShapeTransforms,
  clipIndex,
  viewportProfile,
  chainIndex,
  chainLength,
  previousClipIndex,
  nextClipIndex,
  shapeTransforms,
  nextShapeTransforms,
  pipeLeafOffsets,
  leavesPerPipeByPipe,
  internTransform,
}) {
  const openingFrameCount = Math.min(
    CSSPIPES_PREBAKE_CONFIG.snakeFramesPerSeed,
    recording.sourceFrameCount - 1,
  );
  const transitionFrameCount = nextRecording
    ? Math.min(
      CSSPIPES_PREBAKE_CONFIG.snakeFramesPerSeed,
      recording.snakeTail.sourceFrameCount - 1,
      nextRecording.sourceFrameCount - 1,
    )
    : 0;
  const tailSourceRows = nextClipIndex === null
    ? Object.freeze([])
    : buildPreparedSourceSchedule(
      recording.snakeTail.sourceFrameCount,
      transitionFrameCount,
      "ascending",
    );
  const headSourceRows = nextClipIndex === null
    ? Object.freeze([])
    : buildPreparedSourceSchedule(
      nextRecording.sourceFrameCount,
      transitionFrameCount,
      "descending",
    );
  const recycledBank = buildPreparedBankRecycle({
    recording,
    transitionFrameCount,
    tailSourceRows,
    recycleClipIndex,
    recycleRecording,
    recycleShapeTransforms,
    pipeLeafOffsets,
    leavesPerPipeByPipe,
  });
  return Object.freeze({
    schema: "csspipes-prepared-z-seed-loop-track@6",
    clipIndex,
    viewportProfile,
    chainIndex,
    chainLength,
    previousClipIndex,
    nextClipIndex,
    terminal: nextClipIndex === null,
    seedOriginTransform: internTransform("none"),
    sourceFrameCount: recording.sourceFrameCount,
    openingFrameCount,
    openingHeadRows: buildPreparedSourceSchedule(
      recording.sourceFrameCount,
      openingFrameCount,
      "descending",
    ),
    transitionFrameCount,
    tailSourceRows,
    headSourceRows,
    recycleClipIndex,
    recycleRows: recycledBank.rows,
    recycleShapeAssignments: recycledBank.shapeAssignments,
    recycleLeafAssignments: recycledBank.leafAssignments,
    recycleMode: "prepare-hidden-pipe-when-outgoing-pipe-empties",
    tailDirection: "start-to-tip",
    headDirection: "start-to-tip",
    visibleHandoffState: "simultaneous-open-tail-and-open-head",
    cameraMode: "prepared-static-profile-camera",
    cameraTravelPixels: 0,
    cameraDuringPlayback: "hold-static-profile-camera",
    nextCycle: nextClipIndex === null
      ? "clean-opening-restart"
      : "next-prepared-forward-seed",
    chainDirection: entry.chainDirection,
    chainChapter: entry.chainChapter,
    modelTransform: internTransform(entry.chainCamera.transform),
    shapeTransforms: Object.freeze(shapeTransforms),
    nextShapeTransforms: Object.freeze(nextShapeTransforms ?? []),
    nextConnectedInitialLeafCount: nextRecording
      ? nextRecording.experiment.connectedInitial.leaves.length / 3
      : 0,
    nextRouteHash: nextEntry?.fullPipe.routeHash ?? null,
  });
}

function buildPreparedZSeedLoopTracks({
  accepted,
  clips,
  viewportPlaylists,
  pipeLeafOffsets,
  leavesPerPipeByPipe,
  internTransform,
}) {
  const tracks = Array(clips.length);
  let maximumStartToPreviousTipError = 0;
  let maximumStartRingToPreviousTipError = 0;
  let maximumAdjacentNonHandoffCellOverlapCount = 0;
  let preparedHandoffCount = 0;
  for (const [viewportProfile, playlist] of Object.entries(viewportPlaylists)) {
    for (let chainIndex = 0; chainIndex < playlist.length; chainIndex += 1) {
      const clipIndex = playlist[chainIndex];
      const nextClipIndex = playlist[chainIndex + 1] ?? null;
      const recycleClipIndex = playlist[chainIndex + 2] ?? null;
      if (nextClipIndex !== null) {
        const currentCells = generatedCellKeys(accepted[clipIndex].generated);
        const nextCells = generatedCellKeys(accepted[nextClipIndex].generated);
        const handoffCells = new Set(accepted[clipIndex].generated.walkers.map(
          (walker) => cellKey(walker.cell),
        ));
        const nonHandoffOverlapCount = [...nextCells].filter((key) =>
          currentCells.has(key) && !handoffCells.has(key)).length;
        maximumAdjacentNonHandoffCellOverlapCount = Math.max(
          maximumAdjacentNonHandoffCellOverlapCount,
          nonHandoffOverlapCount,
        );
        for (let sourcePipe = 0;
          sourcePipe < CSSPIPES_PREBAKE_CONFIG.pipeCount;
          sourcePipe += 1) {
          const tip = preparedPipeEndpointPoint(accepted[clipIndex], sourcePipe, "tip");
          const start = preparedPipeEndpointPoint(accepted[nextClipIndex], sourcePipe, "start");
          const tipRing = preparedPipeEndpointRingPoints(
            accepted[clipIndex],
            sourcePipe,
            "tip",
          );
          const startRing = preparedPipeEndpointRingPoints(
            accepted[nextClipIndex],
            sourcePipe,
            "start",
          );
          maximumStartToPreviousTipError = Math.max(
            maximumStartToPreviousTipError,
            Math.hypot(...tip.map((value, axis) => value - start[axis])),
          );
          maximumStartRingToPreviousTipError = Math.max(
            maximumStartRingToPreviousTipError,
            preparedRingSetError(tipRing, startRing),
          );
          preparedHandoffCount += 1;
        }
      }
      const shapeTransforms = accepted[clipIndex].weldedMeshesByPipe.map((mesh) =>
        internTransform(mesh.rootTransform));
      const nextShapeTransforms = nextClipIndex === null
        ? []
        : accepted[nextClipIndex].weldedMeshesByPipe.map((mesh) =>
          internTransform(mesh.rootTransform));
      const recycleShapeTransforms = recycleClipIndex === null
        ? []
        : accepted[recycleClipIndex].weldedMeshesByPipe.map((mesh) =>
          internTransform(mesh.rootTransform));
      tracks[clipIndex] = buildPreparedZSeedLoopTrack({
        entry: accepted[clipIndex],
        recording: clips[clipIndex].recording,
        nextEntry: nextClipIndex === null ? null : accepted[nextClipIndex],
        nextRecording: nextClipIndex === null ? null : clips[nextClipIndex].recording,
        recycleClipIndex,
        recycleRecording: recycleClipIndex === null ? null : clips[recycleClipIndex].recording,
        recycleShapeTransforms,
        clipIndex,
        viewportProfile,
        chainIndex,
        chainLength: playlist.length,
        previousClipIndex: playlist[chainIndex - 1] ?? null,
        nextClipIndex,
        shapeTransforms,
        nextShapeTransforms,
        pipeLeafOffsets,
        leavesPerPipeByPipe,
        internTransform,
      });
    }
  }
  if (tracks.some((track) => !track)) {
    throw new Error("Prepared cssPipes static-camera seed loop is incomplete");
  }
  if (maximumStartToPreviousTipError > 1e-8) {
    throw new Error(
      `Prepared cssPipes seed handoff drifted by ${maximumStartToPreviousTipError}`,
    );
  }
  if (maximumStartRingToPreviousTipError > 1e-8) {
    throw new Error(
      `Prepared cssPipes full-pipe ring handoff drifted by ${maximumStartRingToPreviousTipError}`,
    );
  }
  if (maximumAdjacentNonHandoffCellOverlapCount !== 0) {
    throw new Error(
      `Prepared cssPipes adjacent seeds overlap in ${maximumAdjacentNonHandoffCellOverlapCount} non-handoff cells`,
    );
  }
  const preparedFullPipeCount = new Set(accepted.map((entry) =>
    `${entry.viewportProfile}:${entry.chainChapter}:${entry.fullPipe.routeHash}`)).size;
  return Object.freeze({
    tracks: Object.freeze(tracks),
    proof: Object.freeze({
      schema: "csspipes-prepared-seed-handoff-proof@4",
      pipeIdentity: "source-pipe-index-across-ranked-retained-root-banks",
      chainRepresentation: "finite-complete-forward-profile-pipes-sliced-tail-to-head",
      chapterCount: CSSPIPES_PREBAKE_CONFIG.preparedForwardChainChapterCount,
      preparedFullPipeCount,
      preparedSlicesFromCompletePipes: true,
      fullPipeSegmentsPerSourcePipe:
        accepted[0].fullPipe.totalSegmentsPerPipe,
      sliceOrder: "tail-to-head-from-complete-pipe",
      preparedHandoffCount,
      preparedShapePlacementCount: clips.length * CSSPIPES_PREBAKE_CONFIG.pipeCount,
      storageComplexity: "linear-in-prepared-seed-count",
      maximumStartToPreviousTipError: preparedTransformScalar(
        maximumStartToPreviousTipError,
      ),
      maximumStartRingToPreviousTipError: preparedTransformScalar(
        maximumStartRingToPreviousTipError,
      ),
      adjacentSeedOccupancy: "previous-seed-cells-blocked-except-seven-handoff-cells",
      maximumAdjacentNonHandoffCellOverlapCount,
      allSevenPipes: true,
      profileWrap: "none-clean-opening-restart-after-exhaustion",
    }),
  });
}

function buildPreparedTubeBandDurations(bands) {
  if (!Array.isArray(bands) || bands.length === 0) {
    throw new TypeError("Prepared cssPipes timing requires tube bands");
  }
  const framesPerWorldUnit = CSSPIPES_PREBAKE_CONFIG.playbackFramesPerSecond /
    CSSPIPES_PREBAKE_CONFIG.growthWorldUnitsPerSecond;
  const animatedFraction = 1 - CSSPIPES_PREBAKE_CONFIG.tubeEntryProgress;
  let cumulativeDistance = 0;
  let previousEndFrame = 0;
  return Object.freeze(bands.map((band) => {
    if (!(band?.centerlineLength > 0)) {
      throw new TypeError("Prepared cssPipes tube band must have positive centerline length");
    }
    cumulativeDistance += band.centerlineLength * animatedFraction;
    const endFrame = Math.max(
      previousEndFrame + 1,
      Math.round(cumulativeDistance * framesPerWorldUnit),
    );
    const durationFrames = endFrame - previousEndFrame;
    previousEndFrame = endFrame;
    return durationFrames;
  }));
}

function synchronizePreparedBandDurations(durations, targetFrameCount) {
  const sourceFrameCount = durations.reduce((total, count) => total + count, 0);
  if (!Number.isInteger(targetFrameCount) || targetFrameCount < sourceFrameCount) {
    throw new RangeError("Prepared cssPipes synchronized duration is invalid");
  }
  if (sourceFrameCount === targetFrameCount) return durations;
  let sourceCursor = 0;
  let targetCursor = 0;
  return Object.freeze(durations.map((duration) => {
    sourceCursor += duration;
    const targetEnd = Math.round(
      sourceCursor * targetFrameCount / sourceFrameCount,
    );
    const synchronizedDuration = targetEnd - targetCursor;
    targetCursor = targetEnd;
    if (synchronizedDuration < 1) {
      throw new Error("Prepared cssPipes synchronized band lost its motion frame");
    }
    return synchronizedDuration;
  }));
}

function buildPreparedTube(entry, bandSlotsByPipe, internTransform) {
  const leavesPerPipeByPipe = bandSlotsByPipe.map((count, pipe) =>
    preparedPipeLeafCount(
      count,
      CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe[pipe],
    ));
  const pipeLeafOffsets = leavesPerPipeByPipe.map((_, pipe) =>
    leavesPerPipeByPipe.slice(0, pipe).reduce((total, count) => total + count, 0));
  const leafCount = leavesPerPipeByPipe.reduce((total, count) => total + count, 0);
  const none = internTransform("none");
  const finalShapeTransforms = entry.weldedMeshesByPipe.map((mesh) =>
    internTransform(mesh.rootTransform));
  const finalShapeVisibility = Array(CSSPIPES_PREBAKE_CONFIG.pipeCount).fill(1);
  const finalLeafTransforms = Array(leafCount).fill(none);
  const finalLeafVisibility = Array(leafCount).fill(0);
  const seedLeafTransforms = Array(leafCount).fill(none);
  const seedLeafVisibility = Array(leafCount).fill(0);
  const connectedSeedLeafTransforms = Array(leafCount).fill(none);
  const connectedSeedLeafVisibility = Array(leafCount).fill(0);
  const handoffStartLeafTransforms = Array(leafCount).fill(none);
  const handoffStartLeafVisibility = Array(leafCount).fill(0);
  const unitsByPipe = [];
  const sourceBandDurationsByPipe = entry.weldedMeshesByPipe.map((mesh) =>
    buildPreparedTubeBandDurations(mesh.bands));
  const synchronizedPipeFrameCount = Math.max(...sourceBandDurationsByPipe.map(
    (durations) => durations.reduce((total, count) => total + count, 0),
  ));

  for (let pipe = 0; pipe < entry.weldedMeshesByPipe.length; pipe += 1) {
    const mesh = entry.weldedMeshesByPipe[pipe];
    const radialSegments = mesh.radialSegments;
    const bandDurations = synchronizePreparedBandDurations(
      sourceBandDurationsByPipe[pipe],
      synchronizedPipeFrameCount,
    );
    const pipeLeafOffset = pipeLeafOffsets[pipe];
    const units = [];
    for (let band = 0; band < mesh.bands.length; band += 1) {
      const durationFrames = bandDurations[band];
      const states = Object.freeze(Array.from(
        { length: durationFrames + 1 },
        (_, step) => {
          const progress = CSSPIPES_PREBAKE_CONFIG.tubeEntryProgress +
            (1 - CSSPIPES_PREBAKE_CONFIG.tubeEntryProgress) * step / durationFrames;
          return Object.freeze(
            buildPreparedBandLeafTransforms(mesh, band, progress).map(internTransform),
          );
        },
      ));
      const tailStates = Object.freeze(Array.from(
        { length: durationFrames },
        (_, step) => {
          if (step === 0) return states.at(-1);
          return Object.freeze(buildPreparedBandIntervalLeafTransforms(
            mesh,
            band,
            step / durationFrames,
            1,
          ).map(internTransform));
        },
      ));
      const leafOffset = pipeLeafOffset + band * radialSegments;
      for (let side = 0; side < radialSegments; side += 1) {
        finalLeafTransforms[leafOffset + side] = states.at(-1)[side];
        finalLeafVisibility[leafOffset + side] = 1;
        seedLeafTransforms[leafOffset + side] = states[0][side];
        seedLeafVisibility[leafOffset + side] = band === 0 ? 1 : 0;
        connectedSeedLeafTransforms[leafOffset + side] = states[0][side];
        connectedSeedLeafVisibility[leafOffset + side] = band === 0 ? 1 : 0;
      }
      units.push(Object.freeze({
        pipe,
        band,
        radialSegments,
        leafOffset,
        durationFrames,
        states,
        tailStates,
      }));
    }
    unitsByPipe.push(Object.freeze(units));
  }

  return Object.freeze({
    unitsByPipe: Object.freeze(unitsByPipe),
    initialVisibleBandCount: CSSPIPES_PREBAKE_CONFIG.pipeCount,
    initialVisibleLeafCount: CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe.reduce(
      (total, count) => total + count,
      0,
    ),
    finalState: Object.freeze({
      rootTransform: none,
      rootOpacity: 1,
      shapeTransforms: Object.freeze(finalShapeTransforms),
      shapeVisibility: Object.freeze(finalShapeVisibility),
      leafTransforms: Object.freeze(finalLeafTransforms),
      leafVisibility: Object.freeze(finalLeafVisibility),
    }),
    seedState: Object.freeze({
      rootTransform: none,
      rootOpacity: 1,
      shapeTransforms: Object.freeze([...finalShapeTransforms]),
      shapeVisibility: Object.freeze([...finalShapeVisibility]),
      leafTransforms: Object.freeze(seedLeafTransforms),
      leafVisibility: Object.freeze(seedLeafVisibility),
    }),
    connectedSeedState: Object.freeze({
      rootTransform: none,
      rootOpacity: 1,
      shapeTransforms: Object.freeze([...finalShapeTransforms]),
      shapeVisibility: Object.freeze([...finalShapeVisibility]),
      leafTransforms: Object.freeze(connectedSeedLeafTransforms),
      leafVisibility: Object.freeze(connectedSeedLeafVisibility),
    }),
    handoffStartState: Object.freeze({
      rootTransform: none,
      rootOpacity: 1,
      shapeTransforms: Object.freeze([...finalShapeTransforms]),
      shapeVisibility: Object.freeze([...finalShapeVisibility]),
      leafTransforms: Object.freeze(handoffStartLeafTransforms),
      leafVisibility: Object.freeze(handoffStartLeafVisibility),
    }),
  });
}

function preparedInitialState(state, modelTransform) {
  return Object.freeze({
    modelTransform,
    rootTransform: state.rootTransform,
    rootOpacity: state.rootOpacity,
    shapes: Object.freeze(state.shapeTransforms.flatMap(
      (transform, index) => [index, transform, state.shapeVisibility[index]],
    )),
    leaves: Object.freeze(state.leafTransforms.flatMap(
      (transform, index) => [index, transform, state.leafVisibility[index]],
    )),
  });
}

function preparedSparseInitialState(state, modelTransform) {
  return Object.freeze({
    modelTransform,
    rootTransform: state.rootTransform,
    rootOpacity: state.rootOpacity,
    shapes: Object.freeze(state.shapeTransforms.flatMap(
      (transform, index) => [index, transform, state.shapeVisibility[index]],
    )),
    leaves: Object.freeze(state.leafTransforms.flatMap(
      (transform, index) => state.leafVisibility[index] === 1
        ? [index, transform, 1]
        : [],
    )),
  });
}

function buildPreparedGrowEntry(prepared) {
  const leafTransitions = [];
  for (let leaf = 0; leaf < prepared.seedState.leafTransforms.length; leaf += 1) {
    const beforeTransform = prepared.handoffStartState.leafTransforms[leaf];
    const beforeVisibility = prepared.handoffStartState.leafVisibility[leaf];
    const afterTransform = prepared.seedState.leafTransforms[leaf];
    const afterVisibility = prepared.seedState.leafVisibility[leaf];
    if (beforeTransform === afterTransform && beforeVisibility === afterVisibility) continue;
    leafTransitions.push(
      leaf,
      beforeTransform,
      beforeVisibility,
      afterTransform,
      afterVisibility,
    );
  }
  return Object.freeze({
    schema: "csspipes-prepared-empty-to-growth-entry@1",
    row: Object.freeze([0, leafTransitions.length / 5]),
    leafTransitions: Object.freeze(leafTransitions),
  });
}

function buildPreparedExperimentRecording(prepared, modelTransform) {
  const growEntry = buildPreparedGrowEntry(prepared);
  return Object.freeze({
    schema: "csspipes-prepared-visible-tip-handoff@1",
    initial: preparedInitialState(prepared.handoffStartState, modelTransform),
    connectedInitial: preparedSparseInitialState(
      prepared.connectedSeedState,
      modelTransform,
    ),
    growEntry,
    proof: Object.freeze({
      initialState: "empty-open-tubes",
      connectedInitialState: "first-open-bands",
      connectedSeedStatePrepared: true,
      growEntryPrepared: true,
      runtimeGeometrySemantics: false,
    }),
  });
}

function buildPreparedSnakeTailRecording(prepared) {
  const changes = [];
  const bandRows = [];
  let lastFrame = 0;
  const addLeaf = (frame, leaf, transform, visible) => {
    (changes[frame] ??= new Map()).set(leaf, Object.freeze([
      leaf,
      transform,
      visible,
    ]));
  };

  for (let pipe = 0; pipe < prepared.unitsByPipe.length; pipe += 1) {
    const units = prepared.unitsByPipe[pipe];
    let cursor = pipe * CSSPIPES_PREBAKE_CONFIG.pipeStaggerFrames;
    for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
      const unit = units[unitIndex];
      const radialSegments = unit.radialSegments;
      const startFrame = cursor;
      for (let step = 1; step < unit.durationFrames; step += 1) {
        for (let side = 0; side < radialSegments; side += 1) {
          addLeaf(
            startFrame + step,
            unit.leafOffset + side,
            unit.tailStates[step][side],
            1,
          );
        }
      }
      const endFrame = startFrame + unit.durationFrames;
      for (let side = 0; side < radialSegments; side += 1) {
        addLeaf(
          endFrame,
          unit.leafOffset + side,
          unit.tailStates.at(-1)[side],
          0,
        );
      }
      bandRows.push(Object.freeze([pipe, unit.band, startFrame, endFrame]));
      cursor = endFrame;
      lastFrame = Math.max(lastFrame, endFrame);
    }
  }

  const leafAssignments = [];
  const sourceRows = Array.from({ length: lastFrame + 1 }, (_, frame) => {
    const assignments = [...(changes[frame]?.values() ?? [])];
    const offset = leafAssignments.length / 3;
    for (const assignment of assignments) leafAssignments.push(...assignment);
    return Object.freeze([offset, assignments.length]);
  });
  const visibility = new Uint8Array(prepared.finalState.leafVisibility);
  for (const row of sourceRows) {
    for (let index = 0; index < row[1]; index += 1) {
      const offset = (row[0] + index) * 3;
      visibility[leafAssignments[offset]] = leafAssignments[offset + 2];
    }
  }
  if (visibility.some((visible) => visible !== 0) || bandRows.some((row, index) => {
    const next = bandRows[index + 1];
    return next?.[0] === row[0] && next[2] !== row[3];
  })) {
    throw new Error("Prepared cssPipes snake tail did not crop continuously to empty");
  }
  return Object.freeze({
    schema: "csspipes-prepared-snake-tail@1",
    sourceFrameCount: sourceRows.length,
    sourceRows: Object.freeze(sourceRows),
    leafAssignments: Object.freeze(leafAssignments),
    bandRows: Object.freeze(bandRows),
    proof: Object.freeze({
      direction: "start-to-tip",
      reachesEmpty: true,
      noBandBoundaryIdleFrames: true,
      runtimeGeometrySemantics: false,
    }),
  });
}

function buildRetractionRecording(prepared, entry, modelTransform) {
  const growthChanges = [];
  const bandRows = [];
  let lastGrowthFrame = 0;
  let firstBoundary = null;
  const addLeaf = (frame, transition) => {
    (growthChanges[frame] ??= []).push(transition);
  };

  for (let pipe = 0; pipe < prepared.unitsByPipe.length; pipe += 1) {
    const units = prepared.unitsByPipe[pipe];
    let cursor = pipe * CSSPIPES_PREBAKE_CONFIG.pipeStaggerFrames;
    for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
      const unit = units[unitIndex];
      const radialSegments = unit.radialSegments;
      const startFrame = cursor;
      if (unitIndex > 0) {
        for (let side = 0; side < radialSegments; side += 1) {
          addLeaf(startFrame, Object.freeze([
            unit.leafOffset + side,
            unit.states[0][side],
            1,
            unit.states[0][side],
            0,
          ]));
        }
      }
      for (let step = 1; step <= unit.durationFrames; step += 1) {
        for (let side = 0; side < radialSegments; side += 1) {
          addLeaf(startFrame + step, Object.freeze([
            unit.leafOffset + side,
            unit.states[step][side],
            1,
            unit.states[step - 1][side],
            1,
          ]));
        }
      }
      const endFrame = startFrame + unit.durationFrames;
      bandRows.push(Object.freeze([pipe, unit.band, startFrame, endFrame]));
      if (firstBoundary === null && unitIndex === 1) {
        firstBoundary = Object.freeze({
          pipe,
          leftBand: units[unitIndex - 1].band,
          rightBand: unit.band,
          sharedFrame: startFrame,
          leftLeaf: units[unitIndex - 1].leafOffset,
          rightLeaf: unit.leafOffset,
        });
      }
      cursor = endFrame;
      lastGrowthFrame = Math.max(lastGrowthFrame, endFrame);
    }
  }

  const sourceFrameCount = lastGrowthFrame + 1;
  const leafTransitions = [];
  const sourceRows = Array.from({ length: sourceFrameCount }, (_, sourceFrame) => {
    const growthFrame = sourceFrameCount - sourceFrame - 1;
    const changes = growthChanges[growthFrame] ?? [];
    const offset = leafTransitions.length / 5;
    for (const transition of changes) leafTransitions.push(...transition);
    return Object.freeze([offset, changes.length]);
  });
  const retracted = applyRetractionRows(
    cloneState(prepared.finalState),
    sourceRows,
    leafTransitions,
    "after",
  );
  const replayed = applyRetractionRows(
    cloneState(prepared.seedState),
    [...sourceRows].reverse(),
    leafTransitions,
    "before",
  );
  if (!sameState(retracted, prepared.seedState) ||
      !sameState(replayed, prepared.finalState)) {
    throw new Error("Prepared cssPipes continuous-tube retraction did not round-trip");
  }
  if (!firstBoundary || bandRows.some((row, index) => {
    const next = bandRows[index + 1];
    return next?.[0] === row[0] && next[2] !== row[3];
  })) {
    throw new Error("Prepared cssPipes tube-band playback contains a boundary pause");
  }

  const snakeTail = buildPreparedSnakeTailRecording(prepared);
  if (snakeTail.sourceFrameCount !== sourceFrameCount) {
    throw new Error("Prepared cssPipes head and tail frame counts drifted");
  }
  const weldCount = entry.weldedMeshesByPipe.reduce(
    (total, mesh) => total + mesh.welds.length,
    0,
  );
  const payload = {
    schema: "csspipes-prepared-retraction-recording@2",
    sourceDirection: "final-to-seed",
    playbackDirection: "reverse-source-rows",
    sourceFrameCount,
    reverseFrameCount: sourceFrameCount,
    experiment: buildPreparedExperimentRecording(prepared, modelTransform),
    snakeTail,
    sourceRows: Object.freeze(sourceRows),
    leafTransitions: Object.freeze(leafTransitions),
    bandRows: Object.freeze(bandRows),
    proof: Object.freeze({
      finalStateSha256: stateDigest(prepared.finalState),
      seedStateSha256: stateDigest(prepared.seedState),
      retractionReachesSeed: true,
      reversePlaybackReachesFinal: true,
      sourceRowsConsumedDescending: true,
      topology: "one-continuous-shared-ring-tube-per-pipe",
      noBandBoundaryIdleFrames: true,
      constantPreparedWorldSpeed: true,
      timingSource: "prepared-cumulative-centerline-distance",
      growthWorldUnitsPerSecond: CSSPIPES_PREBAKE_CONFIG.growthWorldUnitsPerSecond,
      weldedSharedRingCount: weldCount,
      firstBoundary,
    }),
  };
  return Object.freeze({
    ...payload,
    contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  });
}

function preparedCellPoint(cell, preparedCenter) {
  return cell.map((value, axis) =>
    (value - preparedCenter[axis]) * CSSPIPES_PREBAKE_CONFIG.stepLength);
}

function preparedChainCellAllowed(cell, preparedCenter, camera) {
  const [x, y] = projectPreparedPoint(
    preparedCellPoint(cell, preparedCenter),
    camera.state.target,
    camera.state.zoom,
  );
  const marginX = CSSPIPES_SOURCE_VIEWPORT.width * 0.06;
  const marginY = CSSPIPES_SOURCE_VIEWPORT.height * 0.06;
  return Number.isFinite(x) && Number.isFinite(y) &&
    x >= -marginX && x <= CSSPIPES_SOURCE_VIEWPORT.width + marginX &&
    y >= -marginY && y <= CSSPIPES_SOURCE_VIEWPORT.height + marginY;
}

function preparedChainEndpointsVisible(generated, preparedCenter, camera) {
  const safeMinX = CSSPIPES_SOURCE_VIEWPORT.width *
    CSSPIPES_PREBAKE_CONFIG.preparedChainEndpointSafeMarginXRatio;
  const safeMaxX = CSSPIPES_SOURCE_VIEWPORT.width - safeMinX;
  const safeMinY = CSSPIPES_SOURCE_VIEWPORT.height *
    CSSPIPES_PREBAKE_CONFIG.preparedChainEndpointSafeMarginYRatio;
  const safeMaxY = CSSPIPES_SOURCE_VIEWPORT.height - safeMinY;
  return generated.walkers.every((walker) => {
    const points = [walker.segments[0].start, walker.segments.at(-1).end];
    return points.every((cell) => {
      const [x, y] = projectPreparedPoint(
        preparedCellPoint(cell, preparedCenter),
        camera.state.target,
        camera.state.zoom,
      );
      return x >= safeMinX && x <= safeMaxX && y >= safeMinY && y <= safeMaxY;
    });
  });
}

function inspectPreparedEntry({
  seed,
  generated,
  viewportProfile,
  preparedCenter,
  chainCamera = null,
  chainDirection = "forward",
  chainChapter = 0,
}) {
  const localPoints = generated.points.map((point) =>
    preparedCellPoint(point, preparedCenter));
  const camera = fitCamera(localPoints);
  const cameraQualification = preparedCameraQualification(camera);
  if (!cameraQualification.qualified) return null;
  const screenOccupancy = preparedScreenOccupancy(localPoints, camera);
  if (!screenOccupancy.qualified) return null;
  const preparedChainCamera = chainCamera ?? camera;
  const chainScreenOccupancy = preparedScreenOccupancy(
    localPoints,
    preparedChainCamera,
  );
  if (!chainScreenOccupancy.qualified ||
      !preparedChainEndpointsVisible(generated, preparedCenter, preparedChainCamera)) {
    return null;
  }
  const sourceRuns = generated.walkers.map((walker, sourcePipe) => Object.freeze({
    sourcePipe,
    runs: compileMaximalRuns(walker.segments),
  }));
  const rankedRuns = [...new Set(CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe)]
    .flatMap((radialSegments) => sourceRuns
      .filter((entry) =>
        CSSPIPES_PREBAKE_CONFIG.radialSegmentsBySourcePipe[entry.sourcePipe] ===
          radialSegments)
      .sort((left, right) =>
        right.runs.length - left.runs.length || left.sourcePipe - right.sourcePipe));
  if (rankedRuns.some((entry, pipe) =>
    entry.runs.length * 2 - 1 > CSSPIPES_PREBAKE_CONFIG.preparedBandSlotsByPipe[pipe])) {
    return null;
  }
  const runsByPipe = rankedRuns.map((entry) => entry.runs);
  const sourcePipeBySlot = Object.freeze(rankedRuns.map((entry) => entry.sourcePipe));
  return Object.freeze({
    seed,
    generated,
    preparedCenter: Object.freeze([...preparedCenter]),
    camera,
    cameraQualification,
    screenOccupancy,
    chainCamera: preparedChainCamera,
    chainScreenOccupancy,
    chainDirection,
    chainChapter,
    viewportProfile,
    runsByPipe,
    sourcePipeBySlot,
  });
}

function completePreparedEntry(
  inspected,
  initialFramesBySourcePipe,
  fullPipe,
) {
  if (!inspected || !Array.isArray(initialFramesBySourcePipe) ||
      initialFramesBySourcePipe.length !== CSSPIPES_PREBAKE_CONFIG.pipeCount ||
      !fullPipe?.routeHash) {
    throw new Error("Prepared cssPipes slice is missing its complete-pipe authority");
  }
  const weldedMeshesByPipe = inspected.runsByPipe.map((runs, pipe) => {
    const sourcePipe = inspected.sourcePipeBySlot[pipe];
    return buildWeldedPipeMesh(
      runs,
      inspected.preparedCenter,
      pipe,
      { initialFrame: initialFramesBySourcePipe[sourcePipe] },
    );
  });
  return Object.freeze({
    ...inspected,
    fullPipe: Object.freeze({ ...fullPipe }),
    weldedMeshesByPipe: Object.freeze(weldedMeshesByPipe),
  });
}

function buildAcceptedPreparedEntries() {
  const accepted = [];
  let candidate = 0;
  for (const profile of Object.values(CSSPIPES_VIEWPORT_PROFILES)) {
    const chapterCount = CSSPIPES_PREBAKE_CONFIG.preparedForwardChainChapterCount;
    if (!Number.isInteger(chapterCount) || chapterCount < 1 ||
        profile.seedCount % chapterCount !== 0) {
      throw new Error(
        "Prepared cssPipes forward chapters must divide the profile seed count",
      );
    }
    const forwardSeedCount = profile.seedCount / chapterCount;
    let profilePreparedCenter = null;
    let profileChainCamera = null;
    let profileStartCells = null;
    for (let chapter = 0; chapter < chapterCount; chapter += 1) {
      const candidateForward = [];
      let backtracks = 0;
      while (candidateForward.length < forwardSeedCount) {
        const previous = candidateForward.at(-1) ?? null;
        const starts = previous
          ? previous.generated.walkers.map((walker) => walker.cell)
          : profileStartCells;
        const initialDirections = previous
          ? previous.generated.walkers.map((walker) => walker.direction)
          : null;
        const allowedCell = profilePreparedCenter && profileChainCamera
          ? (cell) => preparedChainCellAllowed(
            cell,
            profilePreparedCenter,
            profileChainCamera,
          )
          : undefined;
        let inspected = null;
        let seed = null;
        let generated = null;
        let attempts = 0;
        while (!inspected && attempts < 2_000) {
          if (candidate > 2_000_000) {
            throw new Error("Prepared cssPipes chain candidate ceiling was exhausted");
          }
          seed = candidateSeed(candidate);
          candidate += 1;
          attempts += 1;
          generated = generateCandidate(seed, {
            requireFreeContinuation: true,
            ...(starts ? {
              starts,
              initialDirections,
              forceInitialDirections: true,
            } : {}),
            ...(allowedCell ? { allowedCell } : {}),
            ...(!starts ? { returnToStarts: true } : {}),
            ...(profileStartCells ? { endpointTargets: profileStartCells } : {}),
            ...(previous ? {
              blockedCellKeys: generatedCellKeys(previous.generated),
            } : {}),
          });
          if (!generated) continue;
          inspected = inspectPreparedEntry({
            seed,
            generated,
            viewportProfile: profile.id,
            preparedCenter: profilePreparedCenter ?? generated.center,
            chainCamera: profileChainCamera,
            chainDirection: "forward",
            chainChapter: chapter,
          });
        }
        if (!inspected) {
          if (candidateForward.length <= 1 || backtracks >= 2_000) {
            throw new Error(
              `Could not complete prepared ${profile.id} full pipe ${chapter}`,
            );
          }
          candidateForward.pop();
          backtracks += 1;
          continue;
        }
        if (!profilePreparedCenter) {
          profilePreparedCenter = inspected.preparedCenter;
          profileChainCamera = inspected.chainCamera;
          profileStartCells = inspected.generated.walkers.map(
            (walker) => Object.freeze([...walker.segments[0].start]),
          );
        }
        candidateForward.push(Object.freeze({ seed, generated }));
      }

      const fullForwardRoute = concatenateGeneratedCheckpoints(candidateForward);
      const fullForwardRouteHash = preparedFullRouteHash(fullForwardRoute);
      const fullForwardMeshes = fullForwardRoute.walkers.map((walker, sourcePipe) =>
        buildWeldedPipeMesh(
          compileMaximalRuns(walker.segments),
          profilePreparedCenter,
          sourcePipe,
        ));
      const forwardFrames = fullForwardRoute.walkers.map((walker, sourcePipe) =>
        buildPreparedTransportedFrames(
          walker.segments,
          preparedPipeEndpointRing(fullForwardMeshes[sourcePipe], "start").frame,
        ));
      const forwardSlices = sliceGeneratedRouteBackwards(
        fullForwardRoute,
        CSSPIPES_PREBAKE_CONFIG.segmentsPerPipe,
      );
      const forward = forwardSlices.map((slice, sliceIndex) => {
        const inspected = inspectPreparedEntry({
          seed: candidateForward[sliceIndex].seed,
          generated: slice.generated,
          viewportProfile: profile.id,
          preparedCenter: profilePreparedCenter,
          chainCamera: profileChainCamera,
          chainDirection: "forward",
          chainChapter: chapter,
        });
        if (!inspected) {
          throw new Error(
            `Prepared ${profile.id} full pipe produced an invalid forward slice ${sliceIndex}`,
          );
        }
        return completePreparedEntry(
          inspected,
          forwardFrames.map((frames) => frames[slice.fullSegmentStart]),
          {
            schema: "csspipes-complete-pipe-slice@1",
            routeHash: fullForwardRouteHash,
            meshHashes: Object.freeze(fullForwardMeshes.map((mesh) => mesh.hash)),
            preparedBeforeSlicing: true,
            sliceOrder: "tail-to-head-from-complete-pipe",
            direction: "forward",
            totalSegmentsPerPipe: fullForwardRoute.walkers[0].segments.length,
            fullSegmentStart: slice.fullSegmentStart,
            sliceIndex,
            sliceCount: forwardSlices.length,
          },
        );
      });

      accepted.push(...forward);
    }
  }
  return Object.freeze({
    accepted: Object.freeze(applyPreparedPresentationCameras(accepted)),
    candidateSeedsExamined: candidate,
  });
}

function buildPreparedClip(entry, clipIndex, bandSlotsByPipe, internTransform) {
  const prepared = buildPreparedTube(entry, bandSlotsByPipe, internTransform);
  const materialSelection = buildPreparedMaterialSelection(
    entry.seed,
    entry.sourcePipeBySlot,
  );
  const materialIndicesByPipe = materialSelection.materialIndicesByPipe;
  const recording = buildRetractionRecording(
    prepared,
    entry,
    internTransform(entry.camera.transform),
  );
  const bandCountsByPipe = entry.weldedMeshesByPipe.map((mesh) => mesh.bands.length);
  const bandCount = bandCountsByPipe.reduce((total, count) => total + count, 0);
  const wallLeafCount = bandCountsByPipe.reduce(
    (total, count, pipe) => total +
      count * CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe[pipe],
    0,
  );
  const weldedMesh = Object.freeze({
    schema: "csspipes-final-continuous-tubes@3",
    preparationDirection: "complete-tubes-to-seed-retraction",
    playbackDirection: "reverse-prepared-retraction",
    meshHashes: Object.freeze(entry.weldedMeshesByPipe.map((mesh) => mesh.hash)),
    vertexCount: entry.weldedMeshesByPipe.reduce(
      (total, mesh) => total + mesh.vertices.length,
      0,
    ),
    polygonCount: entry.weldedMeshesByPipe.reduce(
      (total, mesh) => total + mesh.polygons.length,
      0,
    ),
    bandCount,
    weldCount: entry.weldedMeshesByPipe.reduce(
      (total, mesh) => total + mesh.welds.length,
      0,
    ),
    reverseRetractionBandCounts: Object.freeze(
      entry.weldedMeshesByPipe.map((mesh) => mesh.reverseRetractionBandIds.length),
    ),
  });
  return Object.freeze({
    id: `clip-${String(clipIndex).padStart(3, "0")}`,
    seed: entry.seed,
    viewportProfile: entry.viewportProfile,
    recording,
    initialVisibleBandCount: prepared.initialVisibleBandCount,
    initialVisibleLeafCount: prepared.initialVisibleLeafCount,
    finalVisibleLeafCount: wallLeafCount,
    initialVisibleSurfaceLeafCount:
      CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe.reduce(
        (total, count) => total + count,
        0,
      ),
    finalVisibleSurfaceLeafCount: wallLeafCount,
    bandCount,
    bandCountsByPipe: Object.freeze(bandCountsByPipe),
    sourcePipeBySlot: entry.sourcePipeBySlot,
    materialIndicesByPipe,
    materialDiversity: materialSelection.diversity,
    chainDirection: entry.chainDirection,
    chainChapter: entry.chainChapter,
    chainScreenOccupancy: entry.chainScreenOccupancy,
    fullPipe: entry.fullPipe,
    weldedMesh,
    camera: entry.camera,
    cameraQualification: entry.cameraQualification,
    screenOccupancy: entry.screenOccupancy,
    bounds: Object.freeze({
      min: Object.freeze([...entry.generated.min]),
      max: Object.freeze([...entry.generated.max]),
      span: Object.freeze([...entry.generated.span]),
      preparedCenter: Object.freeze([...entry.preparedCenter]),
    }),
  });
}

export function buildPreparedClipLibrary() {
  const { accepted, candidateSeedsExamined } = buildAcceptedPreparedEntries();

  const bandSlotsByPipe = Object.freeze(Array.from(
    { length: CSSPIPES_PREBAKE_CONFIG.pipeCount },
    (_, pipe) => Math.max(...accepted.map(
      (entry) => entry.weldedMeshesByPipe[pipe].bands.length,
    )),
  ));
  if (bandSlotsByPipe.some(
    (count, pipe) => count !== CSSPIPES_PREBAKE_CONFIG.preparedBandSlotsByPipe[pipe],
  )) {
    throw new Error(
      `Prepared band capacity drifted: ${bandSlotsByPipe.join(",")}`,
    );
  }
  const bandSlotsPerPipe = Math.max(...bandSlotsByPipe);
  const bandSlotCount = bandSlotsByPipe.reduce((total, count) => total + count, 0);
  const wallLeafTargetCount = bandSlotsByPipe.reduce(
    (total, count, pipe) => total +
      count * CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe[pipe],
    0,
  );
  const leavesPerPipeByPipe = Object.freeze(bandSlotsByPipe.map((count, pipe) =>
    preparedPipeLeafCount(
      count,
      CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe[pipe],
    )));
  const leavesPerPipe = Math.max(...leavesPerPipeByPipe);
  const pipeLeafOffsets = Object.freeze(leavesPerPipeByPipe.map((_, pipe) =>
    leavesPerPipeByPipe.slice(0, pipe).reduce((total, count) => total + count, 0)));
  const leafTargetCount = leavesPerPipeByPipe.reduce(
    (total, count) => total + count,
    0,
  );
  if (wallLeafTargetCount > CSSPIPES_PREBAKE_CONFIG.logicalSegmentCount *
      Math.max(...CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe)) {
    throw new Error(
      `Prepared continuous-tube bank ${bandSlotCount} exceeded the logical segment ceiling ${CSSPIPES_PREBAKE_CONFIG.logicalSegmentCount}`,
    );
  }

  const transforms = [];
  const transformIndices = new Map();
  const internTransform = (transform) => {
    let index = transformIndices.get(transform);
    if (index === undefined) {
      index = transforms.length;
      transforms.push(transform);
      transformIndices.set(transform, index);
    }
    return index;
  };
  const clips = accepted.map((entry, clipIndex) =>
    buildPreparedClip(entry, clipIndex, bandSlotsByPipe, internTransform));

  const bandCounts = clips.map((clip) => clip.bandCount);
  const viewportPlaylists = Object.freeze(Object.fromEntries(
    Object.values(CSSPIPES_VIEWPORT_PROFILES).map((profile) => {
      const indices = clips.flatMap((clip, clipIndex) =>
        clip.viewportProfile === profile.id ? [clipIndex] : []);
      if (indices.length !== profile.seedCount) {
        throw new Error(`Prepared ${profile.id} seed pool has ${indices.length}/${profile.seedCount} clips`);
      }
      return [profile.id, Object.freeze(indices)];
    }),
  ));
  const preparedZSeedLoop = buildPreparedZSeedLoopTracks({
    accepted,
    clips,
    viewportPlaylists,
    pipeLeafOffsets,
    leavesPerPipeByPipe,
    internTransform,
  });
  const zSeedLoopTracks = preparedZSeedLoop.tracks;
  const libraryHash = createHash("sha256").update(JSON.stringify({
    transforms,
    clips: clips.map((clip) => [
      clip.seed,
      clip.recording.contentHash,
      clip.weldedMesh.meshHashes,
      clip.camera.transform,
      clip.viewportProfile,
      clip.screenOccupancy,
      clip.materialIndicesByPipe,
      clip.materialDiversity,
    ]),
    bandSlotsByPipe,
    viewportPlaylists,
    zSeedLoopTracks,
    zSeedLoopHandoffProof: preparedZSeedLoop.proof,
  })).digest("hex");
  return Object.freeze({
    schema: "csspipes-prebaked-playback@12",
    mode: "prepared-continuous-tube-retractions-played-in-reverse",
    libraryHash,
    clipCount: clips.length,
    pipeCount: CSSPIPES_PREBAKE_CONFIG.pipeCount,
    sourceTicksPerSecond: CSSPIPES_PREBAKE_CONFIG.sourceTicksPerSecond,
    logicalSegmentCount: CSSPIPES_PREBAKE_CONFIG.logicalSegmentCount,
    bandSlotsPerPipe,
    bandSlotsByPipe,
    bandSlotCount,
    leavesPerPipe,
    leavesPerPipeByPipe,
    pipeLeafOffsets,
    wallLeafTargetCount,
    radialSegments: CSSPIPES_PREBAKE_CONFIG.radialSegments,
    radialSegmentsByPipe: CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe,
    radialSegmentsBySourcePipe:
      CSSPIPES_PREBAKE_CONFIG.radialSegmentsBySourcePipe,
    retainedPipeRootCount: CSSPIPES_PREBAKE_CONFIG.pipeCount,
    retainedRootCount: CSSPIPES_PREBAKE_CONFIG.pipeCount,
    leafTargetCount,
    retainedBankCount: 2,
    totalRetainedRootCount: CSSPIPES_PREBAKE_CONFIG.pipeCount * 2,
    totalLeafTargetCount: leafTargetCount * 2,
    playbackFramesPerSecond: CSSPIPES_PREBAKE_CONFIG.playbackFramesPerSecond,
    preparation: Object.freeze({
      topology: "continuous-shared-ring-tube-meshes",
      tubeBankPacking: "facet-family-then-descending-prepared-band-complexity",
      construction: "build-complete-tubes-then-retract-tip-to-seed",
      recording: "complete-tube-to-seed-retraction",
      playback: "reverse-source-rows",
      runtimeTopologyWork: false,
      runtimeGeometrySemantics: false,
      runtimeTubePacking: false,
    }),
    morph: Object.freeze({
      package: "@layoutit/polycss-morph",
      version: "0.2.11",
      target: "createPolyMorphPreparedDomTarget",
      frameDurationMilliseconds: CSSPIPES_PREBAKE_CONFIG.frameMorphDurationMilliseconds,
      easing: CSSPIPES_PREBAKE_CONFIG.morphEasing,
      growthWorldUnitsPerSecond: CSSPIPES_PREBAKE_CONFIG.growthWorldUnitsPerSecond,
      bandTimingSource: "prepared-cumulative-centerline-distance",
      leafTransformSource: "prepared-zero-bleed-quad-matrices",
    }),
    materials: Object.freeze({
      paletteSchema: CSSPIPES_PRODUCT_PALETTE.schema,
      materialCount: CSSPIPES_PALETTE.length,
      selection: "fixed-seven-color-product-palette-by-source-pipe",
      replacement: false,
      bindingsPerClip: CSSPIPES_PREBAKE_CONFIG.pipeCount,
      diversity: Object.freeze({
        schema: "csspipes-prepared-fixed-materials@1",
        colorSpace: "OKLab-from-prepared-CSS-sRGB",
        fixedIndices: MATERIAL_FIXED_INDICES,
        minimumPairDistance: Number(
          minimumMaterialOklabDistance(MATERIAL_FIXED_INDICES).toFixed(6),
        ),
        sourcePipeStable: true,
      }),
      runtimeRandomness: false,
      runtimePerLeafColorWrites: 0,
    }),
    transforms: Object.freeze(transforms),
    experiments: Object.freeze({
      schema: "csspipes-prepared-experiments@1",
      defaultMode: "z-seed-loop",
      zSeedLoop: Object.freeze({
        schema: "csspipes-prepared-z-seed-loop@7",
        defaultEnabled: true,
        runtimeCameraMath: false,
        runtimeChainMath: false,
        runtimeGeometrySemantics: false,
        playback: "grow-once-then-simultaneous-prepared-head-and-tail",
        seedOriginHandoff: "seven-next-start-rings-welded-to-seven-previous-tip-rings",
        chainPlacement: "finite-prepared-complete-forward-pipe-backward-slices",
        chainChapterCount: CSSPIPES_PREBAKE_CONFIG.preparedForwardChainChapterCount,
        cameraMode: "one-prepared-static-camera-per-viewport-profile",
        profileWrap: "none-clean-opening-restart-after-exhaustion",
        startingSeed: "browser-crypto-cursor-into-prepared-chain",
        retainedBankCount: 2,
        snakeFramesPerSeed: CSSPIPES_PREBAKE_CONFIG.snakeFramesPerSeed,
        tailStorage: "inline-in-canonical-scene-transform-table",
        handoffProof: preparedZSeedLoop.proof,
        trackCount: zSeedLoopTracks.length,
        tracks: Object.freeze(zSeedLoopTracks),
      }),
    }),
    viewportProfiles: CSSPIPES_VIEWPORT_PROFILES,
    viewportPlaylists,
    clips: Object.freeze(clips),
    metrics: Object.freeze({
      candidateSeedsExamined,
      acceptedSeeds: clips.length,
      preparedViewportSeedPools: Object.freeze(Object.fromEntries(
        Object.entries(viewportPlaylists).map(([profile, playlist]) => [profile, playlist.length]),
      )),
      maximumPreparedCameraOverscanRatio: Math.max(
        ...clips.map((clip) => clip.cameraQualification.overscanRatio),
      ),
      maximumPreparedPerspectiveScale: Math.max(
        ...accepted.map((entry) => entry.perspectiveQualification.perspectiveScale),
      ),
      minimumPreparedScreenOccupiedCellCount: Math.min(
        ...clips.map((clip) => clip.screenOccupancy.occupiedCellCount),
      ),
      minimumPreparedChainScreenOccupiedCellCount: Math.min(
        ...clips.map((clip) => clip.chainScreenOccupancy.occupiedCellCount),
      ),
      preparedMaterialDuplicateCount: clips.reduce(
        (total, clip) => total + clip.materialDiversity.repeatedMaterialCount,
        0,
      ),
      minimumPreparedMaterialOklabDistance: Math.min(
        ...clips.map((clip) => clip.materialDiversity.minimumOklabDistance),
      ),
      preparedTransformStates: transforms.length,
      preparedSnakeTailAssignments: clips.reduce(
        (total, clip) => total + clip.recording.snakeTail.leafAssignments.length / 3,
        0,
      ),
      preparedSnakeTailFrames: clips.reduce(
        (total, clip) => total + clip.recording.snakeTail.sourceFrameCount,
        0,
      ),
      preparedRecordingFrames: clips.reduce((total, clip) =>
        total + clip.recording.sourceFrameCount, 0),
      preparedLeafTransitions: clips.reduce((total, clip) =>
        total + clip.recording.leafTransitions.length / 5, 0),
      preparedWeldedMeshVertices: clips.reduce(
        (total, clip) => total + clip.weldedMesh.vertexCount,
        0,
      ),
      preparedWeldedMeshPolygons: clips.reduce(
        (total, clip) => total + clip.weldedMesh.polygonCount,
        0,
      ),
      preparedWeldedJoints: clips.reduce(
        (total, clip) => total + clip.weldedMesh.weldCount,
        0,
      ),
      uniformBandSlotCount: bandSlotsPerPipe * CSSPIPES_PREBAKE_CONFIG.pipeCount,
      packedBandSlotSavings:
        bandSlotsPerPipe * CSSPIPES_PREBAKE_CONFIG.pipeCount - bandSlotCount,
      packedWallLeafSavings:
        bandSlotsPerPipe * CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe.reduce(
          (total, count) => total + count,
          0,
        ) - wallLeafTargetCount,
      totalSurfaceLeafSavings:
        bandSlotsPerPipe * CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe.reduce(
          (total, count) => total + count,
          0,
        ) - wallLeafTargetCount,
      minBandsPerClip: Math.min(...bandCounts),
      maxBandsPerClip: Math.max(...bandCounts),
      averageBandsPerClip: Number((bandCounts.reduce((total, count) => total + count, 0) /
        bandCounts.length).toFixed(3)),
      runtimePathGeneration: false,
      runtimeGeometrySemantics: false,
      runtimeContract: "publish retained indices from descending prepared retraction rows",
    }),
  });
}
