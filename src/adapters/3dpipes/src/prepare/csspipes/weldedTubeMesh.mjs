import { createHash } from "node:crypto";
import {
  buildPolyMeshTransform,
  computeTextureAtlasPlanPublic,
  formatMatrix3d,
} from "@layoutit/polycss";
import { CSSPIPES_PREBAKE_CONFIG } from "./endlessTubes.mjs";

const clean = (value) => Math.abs(value) < 1e-12 ? 0 : value;
const ZERO_PROJECTIVE_BLEED_GUARDS = Object.freeze({ bleed: 0 });
const vector = (values) => Object.freeze(values.map(clean));
const add = (left, right) => vector(left.map((value, axis) => value + right[axis]));
const subtract = (left, right) => vector(left.map((value, axis) => value - right[axis]));
const scale = (value, amount) => vector(value.map((axis) => axis * amount));
const dot = (left, right) => left.reduce(
  (total, value, axis) => total + value * right[axis],
  0,
);
const cross = (left, right) => vector([
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
]);
const sameVector = (left, right) => left.every(
  (value, axis) => Math.abs(value - right[axis]) < 1e-8,
);

function localPoint(cell, origin) {
  return vector(cell.map((value, axis) =>
    (value - origin[axis]) * CSSPIPES_PREBAKE_CONFIG.stepLength));
}

function initialFrame(direction) {
  const u = direction[2] === 0
    ? vector([0, 0, 1])
    : vector([1, 0, 0]);
  const v = cross(direction, u);
  return Object.freeze({ u, v, direction: vector(direction) });
}

function preparedFrame(frame) {
  if (!frame || !Array.isArray(frame.u) || !Array.isArray(frame.v) ||
      !Array.isArray(frame.direction) || frame.u.length !== 3 ||
      frame.v.length !== 3 || frame.direction.length !== 3) {
    throw new TypeError("Prepared cssPipes tube frame is incomplete");
  }
  return Object.freeze({
    u: vector(frame.u),
    v: vector(frame.v),
    direction: vector(frame.direction),
  });
}

function quarterTurn(value, normal) {
  return add(cross(normal, value), scale(normal, dot(normal, value)));
}

function transportFrame(frame, nextDirectionValue) {
  const nextDirection = vector(nextDirectionValue);
  if (sameVector(frame.direction, nextDirection)) return frame;
  const normal = cross(frame.direction, nextDirection);
  if (dot(frame.direction, nextDirection) !== 0 || Math.hypot(...normal) !== 1) {
    throw new Error("Prepared cssPipes path junction is not a right-angle turn");
  }
  return Object.freeze({
    u: quarterTurn(frame.u, normal),
    v: quarterTurn(frame.v, normal),
    direction: nextDirection,
  });
}

export function buildPreparedTransportedFrames(segments, startingFrame = null) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new TypeError("Prepared cssPipes frame transport requires path segments");
  }
  let frame = startingFrame
    ? preparedFrame(startingFrame)
    : initialFrame(segments[0].direction.delta);
  if (!sameVector(frame.direction, segments[0].direction.delta)) {
    throw new Error("Prepared cssPipes starting frame does not follow its full pipe");
  }
  const frames = [];
  for (const segment of segments) {
    frame = transportFrame(frame, segment.direction.delta);
    frames.push(frame);
  }
  return Object.freeze(frames);
}

function ringFactory(vertices, radialSegments) {
  return (id, center, frame) => {
    const ringVertices = Array.from(
      { length: radialSegments },
      (_, side) => {
        const angle = side * Math.PI * 2 / radialSegments;
        return add(center, add(
          scale(frame.u, CSSPIPES_PREBAKE_CONFIG.tubeRadius * Math.cos(angle)),
          scale(frame.v, CSSPIPES_PREBAKE_CONFIG.tubeRadius * Math.sin(angle)),
        ));
      },
    );
    const vertexIndices = ringVertices.map((vertexValue) => {
      const index = vertices.length;
      vertices.push(vertexValue);
      return index;
    });
    return Object.freeze({
      id,
      center,
      frame,
      vertices: Object.freeze(ringVertices),
      vertexIndices: Object.freeze(vertexIndices),
    });
  };
}

function bandPolygons(band, pipeIndex, radialSegments) {
  return Object.freeze(Array.from(
    { length: radialSegments },
    (_, side) => {
      const next = (side + 1) % radialSegments;
      return Object.freeze({
        id: `${band.id}-side-${String(side).padStart(2, "0")}`,
        pipe: pipeIndex,
        band: band.index,
        side,
        vertexIndices: Object.freeze([
          band.startRing.vertexIndices[side],
          band.startRing.vertexIndices[next],
          band.endRing.vertexIndices[next],
          band.endRing.vertexIndices[side],
        ]),
      });
    },
  ));
}

export function buildWeldedPipeMesh(
  runs,
  preparedCenter,
  pipeIndex = 0,
  options = {},
) {
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new TypeError("Prepared welded cssPipes mesh requires maximal runs");
  }
  if (!Array.isArray(preparedCenter) || preparedCenter.length !== 3) {
    throw new TypeError("Prepared welded cssPipes mesh requires a three-axis center");
  }

  const sourceOrigin = vector(runs[0].start);
  const rootPosition = vector(sourceOrigin.map((value, axis) =>
    (value - preparedCenter[axis]) * CSSPIPES_PREBAKE_CONFIG.stepLength));
  const rootTransform = buildPolyMeshTransform({ position: rootPosition }) ?? "none";
  const radialSegments = CSSPIPES_PREBAKE_CONFIG.radialSegmentsByPipe[pipeIndex];
  const vertices = [];
  const makeRing = ringFactory(vertices, radialSegments);
  const bands = [];
  const welds = [];
  let frame = options.initialFrame
    ? preparedFrame(options.initialFrame)
    : initialFrame(runs[0].direction.delta);
  if (!sameVector(frame.direction, runs[0].direction.delta)) {
    throw new Error("Prepared cssPipes sliced mesh lost its full-pipe frame");
  }
  let startRing = makeRing(
    `pipe-${pipeIndex}-ring-000`,
    localPoint(runs[0].start, sourceOrigin),
    frame,
  );
  const firstRing = startRing;
  let ringIndex = 1;

  const appendBand = (
    nextRing,
    sourceRunIndex,
    preparedCenterlineLength = Math.hypot(...subtract(nextRing.center, startRing.center)),
  ) => {
    const index = bands.length;
    const centerlineLength = preparedCenterlineLength;
    if (!(centerlineLength > 0)) {
      throw new Error("Prepared welded cssPipes tube band must have positive length");
    }
    const mutable = {
      id: `pipe-${pipeIndex}-band-${String(index).padStart(3, "0")}`,
      index,
      role: "tube-band",
      sourceRunIndex,
      centerlineLength,
      startRing,
      endRing: nextRing,
    };
    mutable.polygons = bandPolygons(mutable, pipeIndex, radialSegments);
    const band = Object.freeze(mutable);
    if (bands.length > 0) {
      const previous = bands.at(-1);
      if (previous.endRing !== band.startRing) {
        throw new Error("Prepared cssPipes adjacent tube bands lost shared ring identity");
      }
      welds.push(Object.freeze({
        ringId: band.startRing.id,
        leftBandId: previous.id,
        rightBandId: band.id,
      }));
    }
    bands.push(band);
    startRing = nextRing;
    return band;
  };

  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex];
    if (!sameVector(frame.direction, run.direction.delta)) {
      throw new Error("Prepared cssPipes transported tube frame drifted from its path");
    }
    const hasNext = runIndex < runs.length - 1;
    const corner = localPoint(run.end, sourceOrigin);
    const runEnd = hasNext
      ? subtract(corner, scale(frame.direction, CSSPIPES_PREBAKE_CONFIG.turnRadius))
      : corner;
    const runEndRing = makeRing(
      `pipe-${pipeIndex}-ring-${String(ringIndex).padStart(3, "0")}`,
      runEnd,
      frame,
    );
    ringIndex += 1;
    appendBand(runEndRing, runIndex);
    if (!hasNext) continue;

    const nextDirection = vector(runs[runIndex + 1].direction.delta);
    const nextFrame = transportFrame(frame, nextDirection);
    const nextCenter = add(
      corner,
      scale(nextDirection, CSSPIPES_PREBAKE_CONFIG.turnRadius),
    );
    const nextRing = makeRing(
      `pipe-${pipeIndex}-ring-${String(ringIndex).padStart(3, "0")}`,
      nextCenter,
      nextFrame,
    );
    ringIndex += 1;
    appendBand(
      nextRing,
      runIndex,
      CSSPIPES_PREBAKE_CONFIG.turnRadius * Math.PI / 2,
    );
    frame = nextFrame;
  }

  const wallPolygons = bands.flatMap((band) => band.polygons);
  const reverseRetractionBandIds = Object.freeze(bands.map((band) => band.id).reverse());
  if (bands.length !== runs.length * 2 - 1 || welds.length !== bands.length - 1 ||
      wallPolygons.length !== bands.length * radialSegments) {
    throw new Error("Prepared cssPipes welded tube census drifted");
  }
  const hash = createHash("sha256").update(JSON.stringify({
    rootPosition,
    vertices,
    polygons: wallPolygons.map((polygon) => polygon.vertexIndices),
    bands: bands.map((band) => [
      band.startRing.id,
      band.endRing.id,
      band.centerlineLength,
    ]),
    reverseRetractionBandIds,
  })).digest("hex");
  return Object.freeze({
    schema: "csspipes-welded-pipe-mesh@3",
    pipe: pipeIndex,
    radialSegments,
    sourceOrigin,
    preparedCenter: vector(preparedCenter),
    rootPosition,
    rootTransform,
    vertices: Object.freeze(vertices),
    polygons: Object.freeze(wallPolygons),
    bands: Object.freeze(bands),
    startRing: firstRing,
    endRing: startRing,
    welds: Object.freeze(welds),
    reverseRetractionBandIds,
    hash,
  });
}

function ringVerticesAtProgress(band, progress) {
  return band.endRing.vertices.map((vertexValue, vertexIndex) =>
    vector(vertexValue.map((value, axis) =>
      band.startRing.vertices[vertexIndex][axis] +
      (value - band.startRing.vertices[vertexIndex][axis]) * progress)));
}

function bandPolygonAtInterval(
  band,
  side,
  startProgress,
  endProgress,
  options = {},
) {
  const radialSegments = band.startRing.vertices.length;
  const next = (side + 1) % radialSegments;
  const start = ringVerticesAtProgress(band, startProgress);
  const end = ringVerticesAtProgress(band, endProgress);
  const vertices = [
    start[side],
    start[next],
    end[next],
    end[side],
  ];
  const textureVertices = options.rotateTextureHalfTurn
    ? [...vertices.slice(2), ...vertices.slice(0, 2)]
    : vertices;
  return Object.freeze({
    color: "#ffffff",
    vertices: Object.freeze(textureVertices),
  });
}

function assertPlanarBandPolygon(polygon, bandIndex, side) {
  const [a, b, c, d] = polygon.vertices;
  const ab = subtract(b, a);
  const ac = subtract(c, a);
  const ad = subtract(d, a);
  const normal = cross(ab, ac);
  const normalLength = Math.hypot(...normal);
  const distance = normalLength > 1e-12
    ? Math.abs(dot(normal, ad)) / normalLength
    : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(distance) || distance > 1e-8) {
    throw new Error(
      `Prepared cssPipes tube band ${bandIndex} side ${side} is not exactly coplanar`,
    );
  }
}

export function buildPreparedBandLeafTransforms(
  mesh,
  bandIndex,
  progress,
  options = {},
) {
  return buildPreparedBandIntervalLeafTransforms(
    mesh,
    bandIndex,
    0,
    progress,
    options,
  );
}

export function buildPreparedBandIntervalLeafTransforms(
  mesh,
  bandIndex,
  startProgress,
  endProgress,
  options = {},
) {
  const band = mesh?.bands?.[bandIndex];
  if (!band || !Number.isFinite(startProgress) || !Number.isFinite(endProgress) ||
      startProgress < 0 || startProgress >= 1 ||
      endProgress <= 0 || endProgress > 1 || startProgress >= endProgress) {
    throw new RangeError(
      "Prepared cssPipes tube-band interval must satisfy 0 <= start < end <= 1",
    );
  }
  return Object.freeze(Array.from(
    { length: mesh.radialSegments },
    (_, side) => {
      const polygon = bandPolygonAtInterval(
        band,
        side,
        startProgress,
        endProgress,
        options,
      );
      assertPlanarBandPolygon(polygon, bandIndex, side);
      const plan = computeTextureAtlasPlanPublic(
        polygon,
        side,
        { seamBleed: 0 },
        ZERO_PROJECTIVE_BLEED_GUARDS,
      );
      if (!plan || typeof plan.projectiveMatrix !== "string" || plan.bleedRatio !== 0) {
        throw new Error(
          `PolyCSS tube band ${bandIndex} side ${side} lost its zero-bleed projective plan`,
        );
      }
      return formatMatrix3d(plan.projectiveMatrix, 8);
    },
  ));
}
