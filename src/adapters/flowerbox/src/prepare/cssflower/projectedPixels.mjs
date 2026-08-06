import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { buildPreparedFullRotationCycle } from "./bloomCycle.mjs";
import {
  buildCubeTopology,
  computeSmoothPointNormals,
  deformCubePoints,
} from "./cubeTopology.mjs";
import { computePreparedVertexLightingUnquantized } from "./compilePreparedCycle.mjs";
import { CSSFLOWER_SOURCE_PROFILE } from "./sourceProfile.mjs";

const EDGE = CSSFLOWER_SOURCE_PROFILE.camera.stagePixels;
const HALF_EDGE = EDGE / 2;
const CAMERA = CSSFLOWER_SOURCE_PROFILE.camera;
const FOCAL_PIXELS = HALF_EDGE / Math.tan(CAMERA.fovDegrees * Math.PI / 360);
const ATLAS_WIDTH = 2_048;
const SPACE_TIME_ATLAS_WIDTH = 8_192;
const DEPTH_MAX = (1 << 16) - 1;
const EPSILON = 1e-10;
const topology = buildCubeTopology();
const cycle = buildPreparedFullRotationCycle();

export function buildCssflowerPreparedInverseRootTransforms() {
  return Object.freeze(Array.from({ length: cycle.rootStateCount }, (_, rootStateIndex) => (
    preparedInverseRootTransform({ rootStateIndex })
  )));
}

export function scanCssflowerProjectedLeafBounds() {
  const leaves = Array.from({ length: topology.triangleCount }, (_, index) => ({
    index,
    maxWidth: 0,
    maxHeight: 0,
    maxArea: 0,
    maxAreaTick: -1,
    visibleStateCount: 0,
  }));
  const states = [];
  for (const state of cycle.states) {
    const positions = deformCubePoints(topology, state.sf);
    const rotation = sourceModelRotation(state);
    const projectedPoints = topology.points.map((point) => {
      const offset = point.index * 3;
      const world = rotateSourceVector(rotation, [
        positions[offset],
        positions[offset + 1],
        positions[offset + 2],
      ]);
      const eyeDistance = CAMERA.eye[2] - world[2];
      return Object.freeze({
        x: HALF_EDGE + FOCAL_PIXELS * world[0] / eyeDistance,
        y: HALF_EDGE - FOCAL_PIXELS * world[1] / eyeDistance,
      });
    });
    let frontFacingTriangleCount = 0;
    let boundingArea = 0;
    let maxLeafArea = 0;
    let maxLeafWidth = 0;
    let maxLeafHeight = 0;
    for (const triangle of topology.triangles) {
      const vertices = triangle.pointIndices.map((pointIndex) => projectedPoints[pointIndex]);
      if (orient(vertices[0], vertices[1], vertices[2]) >= -EPSILON) continue;
      frontFacingTriangleCount += 1;
      const minX = Math.max(0, Math.ceil(Math.min(...vertices.map((value) => value.x)) - 0.5));
      const maxX = Math.min(EDGE - 1, Math.floor(Math.max(...vertices.map((value) => value.x)) - 0.5));
      const minY = Math.max(0, Math.ceil(Math.min(...vertices.map((value) => value.y)) - 0.5));
      const maxY = Math.min(EDGE - 1, Math.floor(Math.max(...vertices.map((value) => value.y)) - 0.5));
      const width = Math.max(0, maxX - minX + 1);
      const height = Math.max(0, maxY - minY + 1);
      const area = width * height;
      const leaf = leaves[triangle.index];
      leaf.visibleStateCount += 1;
      leaf.maxWidth = Math.max(leaf.maxWidth, width);
      leaf.maxHeight = Math.max(leaf.maxHeight, height);
      if (area > leaf.maxArea) {
        leaf.maxArea = area;
        leaf.maxAreaTick = state.tick;
      }
      boundingArea += area;
      maxLeafArea = Math.max(maxLeafArea, area);
      maxLeafWidth = Math.max(maxLeafWidth, width);
      maxLeafHeight = Math.max(maxLeafHeight, height);
    }
    states.push(Object.freeze({
      tick: state.tick,
      sf: state.sf,
      sfHex: state.sfHex,
      geometryStateIndex: state.geometryStateIndex,
      rootStateIndex: state.rootStateIndex,
      frontFacingTriangleCount,
      boundingArea,
      maxLeafArea,
      maxLeafWidth,
      maxLeafHeight,
    }));
  }
  const fixedSlotArea = leaves.reduce((sum, leaf) => sum + leaf.maxWidth * leaf.maxHeight, 0);
  return Object.freeze({
    schema: "cssflower-projected-leaf-bound-scan@1",
    stateCount: states.length,
    retainedLeafCount: leaves.length,
    fixedSlotArea,
    fixedSlotDecodedBytesPerFrame: fixedSlotArea * 4,
    maximumLeafWidth: Math.max(...leaves.map((leaf) => leaf.maxWidth)),
    maximumLeafHeight: Math.max(...leaves.map((leaf) => leaf.maxHeight)),
    maximumLeafArea: Math.max(...leaves.map((leaf) => leaf.maxArea)),
    leaves: Object.freeze(leaves.map((leaf) => Object.freeze(leaf))),
    states: Object.freeze(states),
  });
}

export function prepareCssflowerProjectedPixelSpaceTimeBank(ticks) {
  if (!Array.isArray(ticks) || ticks.length < 1 ||
      ticks.some((tick) => !Number.isSafeInteger(tick) || tick < 0) ||
      new Set(ticks).size !== ticks.length) {
    throw new TypeError("Prepared projected space-time bank requires unique non-negative safe ticks");
  }
  const states = ticks.map((tick) => rasterizeCssflowerProjectedPixels(tick));
  const patchesByState = states.map((state) => state.leaves);
  const slots = Array.from({ length: topology.triangleCount }, (_, index) => {
    const visiblePatches = patchesByState
      .map((patchesForState) => patchesForState[index])
      .filter((patch) => patch.pixelCount > 0);
    const left = visiblePatches.length ? Math.min(...visiblePatches.map((patch) => patch.left)) : EDGE;
    const top = visiblePatches.length ? Math.min(...visiblePatches.map((patch) => patch.top)) : EDGE;
    const right = visiblePatches.length ? Math.max(...visiblePatches.map((patch) => patch.right)) : -1;
    const bottom = visiblePatches.length ? Math.max(...visiblePatches.map((patch) => patch.bottom)) : -1;
    return {
      index,
      pixelCount: visiblePatches.reduce((sum, patch) => sum + patch.pixelCount, 0),
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left + 1),
      height: Math.max(0, bottom - top + 1),
      atlasX: 0,
      atlasY: 0,
    };
  });
  const atlasHeight = packSpaceTimeLeafStrips(slots, states.length);
  const atlas = new PNG({ width: SPACE_TIME_ATLAS_WIDTH, height: atlasHeight, colorType: 6 });
  for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
    const state = states[stateIndex];
    const frame = state.frameImage;
    const patches = patchesByState[stateIndex];
    for (let pixelIndex = 0; pixelIndex < state.owner.length; pixelIndex += 1) {
      const triangleIndex = state.owner[pixelIndex];
      if (triangleIndex < 0) continue;
      const slot = slots[triangleIndex];
      const x = pixelIndex % EDGE;
      const y = Math.floor(pixelIndex / EDGE);
      const atlasX = slot.atlasX + x - slot.left;
      const atlasY = slot.atlasY + stateIndex * slot.height + y - slot.top;
      const sourceOffset = pixelIndex * 4;
      const atlasOffset = (atlasY * atlas.width + atlasX) * 4;
      atlas.data[atlasOffset] = frame.data[sourceOffset];
      atlas.data[atlasOffset + 1] = frame.data[sourceOffset + 1];
      atlas.data[atlasOffset + 2] = frame.data[sourceOffset + 2];
      atlas.data[atlasOffset + 3] = 255;
    }
  }
  const atlasBytes = PNG.sync.write(atlas, { colorType: 6, inputColorType: 6 });
  const leafCss = slots.map((slot) => slot.pixelCount === 0
    ? hiddenBankLeafCss()
    : spaceTimeBankLeafCss(slot, atlas.width, atlas.height));
  const packets = states.map((state, stateIndex) => {
    const sourceState = cycle.states[state.timelineStateIndex];
    return Object.freeze({
      tick: state.tick,
      sf: state.state.sf,
      rootTransform: state.rootTransform,
      meshTransform: preparedInverseRootTransform(sourceState),
      frameIndex: stateIndex,
      visibleLeafCount: state.topology.visibleLeafCount,
    });
  });
  return Object.freeze({
    schema: "cssflower-prepared-projected-pixel-space-time-bank@1",
    layout: "source-order-fixed-union-leaf-strips-by-consecutive-source-frame-rows",
    ticks: Object.freeze([...ticks]),
    retainedLeafCount: topology.triangleCount,
    activeUnionLeafCount: slots.filter((slot) => slot.pixelCount > 0).length,
    frameCount: states.length,
    slots: Object.freeze(slots.map((slot) => Object.freeze({ ...slot }))),
    leafCss: Object.freeze(leafCss),
    packets: Object.freeze(packets),
    atlas: Object.freeze({
      width: atlas.width,
      height: atlas.height,
      bytes: atlasBytes,
      sha256: sha256(atlasBytes),
      dataUrl: `data:image/png;base64,${atlasBytes.toString("base64")}`,
    }),
    states: Object.freeze(states.map(projectedStateDescriptor)),
    authority: Object.freeze({
      precedent: "cssgraphics-super-mario-64-source-order-face-columns-by-source-frame-rows",
      input: "independently-prepared-cssflower-source-state",
      nativeStateIngestion: false,
      nativePixelIngestion: false,
      runtimeProjection: false,
      runtimeRasterization: false,
      runtimeGeometryConstruction: false,
    }),
  });
}

export function prepareCssflowerProjectedPixelBank(ticks) {
  if (!Array.isArray(ticks) || ticks.length < 1 ||
      ticks.some((tick) => !Number.isSafeInteger(tick) || tick < 0) ||
      new Set(ticks).size !== ticks.length) {
    throw new TypeError("Prepared projected-pixel bank requires unique non-negative safe ticks");
  }
  const states = ticks.map((tick) => prepareCssflowerProjectedPixels(tick));
  const patchesByState = states.map((state) => buildLeafPatches(state.owner));
  const slots = Array.from({ length: topology.triangleCount }, (_, index) => {
    const patches = patchesByState.map((patchesForState) => patchesForState[index]);
    return {
      index,
      pixelCount: patches.reduce((sum, patch) => sum + patch.pixelCount, 0),
      width: Math.max(0, ...patches.map((patch) => patch.width)),
      height: Math.max(0, ...patches.map((patch) => patch.height)),
      atlasX: 0,
      atlasY: 0,
    };
  });
  const stateStride = packLeafPatches(slots);
  const atlas = new PNG({ width: ATLAS_WIDTH, height: stateStride * states.length, colorType: 6 });
  for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
    const state = states[stateIndex];
    const frame = PNG.sync.read(state.frame.bytes);
    const patches = patchesByState[stateIndex];
    const stateY = stateIndex * stateStride;
    for (let pixelIndex = 0; pixelIndex < state.owner.length; pixelIndex += 1) {
      const triangleIndex = state.owner[pixelIndex];
      if (triangleIndex < 0) continue;
      const slot = slots[triangleIndex];
      const patch = patches[triangleIndex];
      const x = pixelIndex % EDGE;
      const y = Math.floor(pixelIndex / EDGE);
      const atlasX = slot.atlasX + x - patch.left;
      const atlasY = stateY + slot.atlasY + y - patch.top;
      const sourceOffset = pixelIndex * 4;
      const atlasOffset = (atlasY * atlas.width + atlasX) * 4;
      atlas.data[atlasOffset] = frame.data[sourceOffset];
      atlas.data[atlasOffset + 1] = frame.data[sourceOffset + 1];
      atlas.data[atlasOffset + 2] = frame.data[sourceOffset + 2];
      atlas.data[atlasOffset + 3] = 255;
    }
  }
  const atlasBytes = PNG.sync.write(atlas, { colorType: 6, inputColorType: 6 });
  const leafCss = slots.map((slot) => slot.pixelCount === 0
    ? hiddenBankLeafCss()
    : bankLeafCss(slot, atlas.width, atlas.height));
  const packets = states.map((state, stateIndex) => {
    const inverseRoot = inverseCssRootRotation(cycle.states[state.timelineStateIndex]);
    const patches = patchesByState[stateIndex];
    return Object.freeze({
      tick: state.tick,
      sf: state.state.sf,
      rootTransform: state.rootTransform,
      atlasY: -stateIndex * stateStride,
      visibleLeafCount: state.topology.visibleLeafCount,
      transforms: Object.freeze(patches.map((patch, triangleIndex) => {
        if (slots[triangleIndex].pixelCount === 0) return "none";
        return patch.pixelCount === 0
          ? projectedLeafTransform({ left: -10_000, top: -10_000 }, inverseRoot)
          : projectedLeafTransform(patch, inverseRoot);
      })),
    });
  });
  return Object.freeze({
    schema: "cssflower-prepared-projected-pixel-bank@1",
    ticks: Object.freeze([...ticks]),
    retainedLeafCount: topology.triangleCount,
    activeUnionLeafCount: slots.filter((slot) => slot.pixelCount > 0).length,
    stateStride,
    leafCss: Object.freeze(leafCss),
    packets: Object.freeze(packets),
    atlas: Object.freeze({
      width: atlas.width,
      height: atlas.height,
      bytes: atlasBytes,
      sha256: sha256(atlasBytes),
      dataUrl: `data:image/png;base64,${atlasBytes.toString("base64")}`,
    }),
    states: Object.freeze(states),
    authority: Object.freeze({
      input: "independently-prepared-cssflower-source-state",
      nativeStateIngestion: false,
      nativePixelIngestion: false,
      runtimeProjection: false,
      runtimeRasterization: false,
      runtimeGeometryConstruction: false,
    }),
  });
}

function rasterizeCssflowerProjectedPixels(tick) {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError("Prepared projected pixels require a non-negative safe tick");
  }
  const timelineStateIndex = tick < cycle.stateCount
    ? tick
    : cycle.cycleStartState + ((tick - cycle.cycleStartState) % cycle.cycleLength);
  const state = cycle.states[timelineStateIndex];
  const positions = deformCubePoints(topology, state.sf);
  const normals = computeSmoothPointNormals(topology, positions);
  const colors = computePreparedVertexLightingUnquantized(topology, positions, normals, state);
  const rotation = sourceModelRotation(state);
  const projectedPoints = topology.points.map((point) => {
    const offset = point.index * 3;
    const world = rotateSourceVector(rotation, [
      positions[offset],
      positions[offset + 1],
      positions[offset + 2],
    ]);
    const eyeDistance = CAMERA.eye[2] - world[2];
    if (eyeDistance < CAMERA.near || eyeDistance > CAMERA.far) {
      throw new Error(`cssFlower projected point ${point.index} left the qualified source clip interval`);
    }
    return Object.freeze({
      x: HALF_EDGE + FOCAL_PIXELS * world[0] / eyeDistance,
      y: HALF_EDGE - FOCAL_PIXELS * world[1] / eyeDistance,
      inverseEyeDistance: 1 / eyeDistance,
      windowDepth: windowDepthForEyeDistance(eyeDistance),
      colorOffset: offset,
    });
  });

  const frame = new PNG({ width: EDGE, height: EDGE, colorType: 6 });
  const owner = new Int16Array(EDGE * EDGE);
  const depth = new Uint16Array(EDGE * EDGE);
  owner.fill(-1);
  depth.fill(DEPTH_MAX);
  for (let offset = 0; offset < frame.data.length; offset += 4) frame.data[offset + 3] = 255;

  let frontFacingTriangleCount = 0;
  let candidateFragmentCount = 0;
  let depthAcceptedFragmentCount = 0;
  for (const triangle of topology.triangles) {
    const vertices = triangle.pointIndices.map((pointIndex) => projectedPoints[pointIndex]);
    const area = orient(vertices[0], vertices[1], vertices[2]);
    // Source GL uses the default CCW front face. The stored image has its Y axis
    // flipped relative to OpenGL window coordinates, so front faces are negative.
    if (area >= -EPSILON) continue;
    frontFacingTriangleCount += 1;
    const minX = Math.max(0, Math.ceil(Math.min(...vertices.map((value) => value.x)) - 0.5));
    const maxX = Math.min(EDGE - 1, Math.floor(Math.max(...vertices.map((value) => value.x)) - 0.5));
    const minY = Math.max(0, Math.ceil(Math.min(...vertices.map((value) => value.y)) - 0.5));
    const maxY = Math.min(EDGE - 1, Math.floor(Math.max(...vertices.map((value) => value.y)) - 0.5));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const sample = { x: x + 0.5, y: y + 0.5 };
        const barycentric = [
          orient(vertices[1], vertices[2], sample) / area,
          orient(vertices[2], vertices[0], sample) / area,
          orient(vertices[0], vertices[1], sample) / area,
        ];
        if (barycentric.some((value) => value < -EPSILON)) continue;
        candidateFragmentCount += 1;
        const inverseEyeDistance = barycentric.reduce((sum, weight, index) => (
          sum + weight * vertices[index].inverseEyeDistance
        ), 0);
        const windowDepth = barycentric.reduce((sum, weight, index) => (
          sum + weight * vertices[index].windowDepth
        ), 0);
        const depth16 = Math.max(0, Math.min(DEPTH_MAX, Math.round(windowDepth * DEPTH_MAX)));
        const pixelIndex = y * EDGE + x;
        if (depth16 >= depth[pixelIndex]) continue;
        depthAcceptedFragmentCount += 1;
        depth[pixelIndex] = depth16;
        owner[pixelIndex] = triangle.index;
        const frameOffset = pixelIndex * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          const numerator = barycentric.reduce((sum, weight, index) => (
            sum + weight * colors[vertices[index].colorOffset + channel] * vertices[index].inverseEyeDistance
          ), 0);
          frame.data[frameOffset + channel] = clampByte(numerator / inverseEyeDistance);
        }
      }
    }
  }

  const leaves = buildLeafPatches(owner);
  const rootTransform = cycle.rootTransforms[state.rootStateIndex];
  const ownedPixelCount = leaves.reduce((sum, leaf) => sum + leaf.pixelCount, 0);
  return Object.freeze({
    tick,
    timelineStateIndex,
    state: Object.freeze({
      sf: state.sf,
      sfHex: state.sfHex,
      sfi: state.sfi,
      sfiHex: state.sfiHex,
      geometryStateIndex: state.geometryStateIndex,
      rootStateIndex: state.rootStateIndex,
      rotationDegrees: Object.freeze([
        state.rotationXDegrees,
        state.rotationYDegrees,
        state.rotationZDegrees,
      ]),
    }),
    viewport: Object.freeze({ width: EDGE, height: EDGE, deviceScaleFactor: 1 }),
    projection: Object.freeze({
      fovDegrees: CAMERA.fovDegrees,
      eye: Object.freeze([...CAMERA.eye]),
      near: CAMERA.near,
      far: CAMERA.far,
      focalPixels: FOCAL_PIXELS,
      rasterSample: "integer-pixel-center",
      cull: "source-default-CCW-front",
      depth: "source-depth16-less",
      interpolation: "perspective-correct-smooth-vertex-lighting",
    }),
    topology: Object.freeze({
      pointCount: topology.points.length,
      triangleCount: topology.triangleCount,
      retainedLeafCount: topology.triangleCount,
      frontFacingTriangleCount,
      visibleLeafCount: leaves.filter((leaf) => leaf.pixelCount > 0).length,
      ownedPixelCount,
      candidateFragmentCount,
      depthAcceptedFragmentCount,
    }),
    rootTransform,
    frameImage: frame,
    owner,
    leaves,
    authority: Object.freeze({
      input: "independently-prepared-cssflower-source-state",
      nativeStateIngestion: false,
      nativePixelIngestion: false,
      runtimeProjection: false,
      runtimeRasterization: false,
      runtimeGeometryConstruction: false,
    }),
  });
}

export function prepareCssflowerProjectedPixels(tick) {
  const raster = rasterizeCssflowerProjectedPixels(tick);
  const leaves = raster.leaves;
  const atlasHeight = packLeafPatches(leaves);
  const atlas = new PNG({ width: ATLAS_WIDTH, height: atlasHeight, colorType: 6 });
  for (let pixelIndex = 0; pixelIndex < raster.owner.length; pixelIndex += 1) {
    const triangleIndex = raster.owner[pixelIndex];
    if (triangleIndex < 0) continue;
    const leaf = leaves[triangleIndex];
    const x = pixelIndex % EDGE;
    const y = Math.floor(pixelIndex / EDGE);
    const atlasX = leaf.atlasX + x - leaf.left;
    const atlasY = leaf.atlasY + y - leaf.top;
    const sourceOffset = pixelIndex * 4;
    const atlasOffset = (atlasY * atlas.width + atlasX) * 4;
    atlas.data[atlasOffset] = raster.frameImage.data[sourceOffset];
    atlas.data[atlasOffset + 1] = raster.frameImage.data[sourceOffset + 1];
    atlas.data[atlasOffset + 2] = raster.frameImage.data[sourceOffset + 2];
    atlas.data[atlasOffset + 3] = 255;
  }
  const frameBytes = PNG.sync.write(raster.frameImage, { colorType: 2, inputColorType: 6 });
  const atlasBytes = PNG.sync.write(atlas, { colorType: 6, inputColorType: 6 });
  const sourceState = cycle.states[raster.timelineStateIndex];
  const inverseRoot = inverseCssRootRotation(sourceState);
  const leafCss = leaves.map((leaf) => leaf.pixelCount === 0
    ? hiddenLeafCss()
    : visibleLeafCss(leaf, inverseRoot, atlas.width, atlas.height));
  return Object.freeze({
    ...projectedStateDescriptor(raster),
    schema: "cssflower-prepared-projected-pixels@1",
    leafCss: Object.freeze(leafCss),
    atlas: Object.freeze({
      width: atlas.width,
      height: atlas.height,
      bytes: atlasBytes,
      sha256: sha256(atlasBytes),
      dataUrl: `data:image/png;base64,${atlasBytes.toString("base64")}`,
    }),
    frame: Object.freeze({
      width: raster.frameImage.width,
      height: raster.frameImage.height,
      bytes: frameBytes,
      sha256: sha256(frameBytes),
    }),
    owner: raster.owner,
  });
}

export function prepareCssflowerProjectedFrame(tick) {
  const raster = rasterizeCssflowerProjectedPixels(tick);
  return Object.freeze({
    ...projectedStateDescriptor(raster),
    schema: "cssflower-prepared-projected-frame@1",
    frameImage: raster.frameImage,
    owner: raster.owner,
    leaves: raster.leaves,
  });
}

function projectedStateDescriptor(raster) {
  return Object.freeze({
    tick: raster.tick,
    timelineStateIndex: raster.timelineStateIndex,
    state: raster.state,
    viewport: raster.viewport,
    projection: raster.projection,
    topology: raster.topology,
    rootTransform: raster.rootTransform,
    authority: raster.authority,
  });
}

function buildLeafPatches(owner) {
  const leaves = Array.from({ length: topology.triangleCount }, (_, index) => ({
    index,
    pixelCount: 0,
    left: EDGE,
    top: EDGE,
    right: -1,
    bottom: -1,
    width: 0,
    height: 0,
    atlasX: 0,
    atlasY: 0,
  }));
  for (let pixelIndex = 0; pixelIndex < owner.length; pixelIndex += 1) {
    const triangleIndex = owner[pixelIndex];
    if (triangleIndex < 0) continue;
    const x = pixelIndex % EDGE;
    const y = Math.floor(pixelIndex / EDGE);
    const leaf = leaves[triangleIndex];
    leaf.pixelCount += 1;
    leaf.left = Math.min(leaf.left, x);
    leaf.top = Math.min(leaf.top, y);
    leaf.right = Math.max(leaf.right, x);
    leaf.bottom = Math.max(leaf.bottom, y);
  }
  for (const leaf of leaves) {
    if (leaf.pixelCount === 0) continue;
    leaf.width = leaf.right - leaf.left + 1;
    leaf.height = leaf.bottom - leaf.top + 1;
  }
  return leaves;
}

function packLeafPatches(leaves) {
  let x = 1;
  let y = 1;
  let rowHeight = 0;
  for (const leaf of leaves) {
    if (leaf.pixelCount === 0) continue;
    if (leaf.width + 2 > ATLAS_WIDTH) {
      throw new Error(`Projected leaf ${leaf.index} exceeds the prepared atlas width`);
    }
    if (x + leaf.width + 1 > ATLAS_WIDTH) {
      x = 1;
      y += rowHeight + 2;
      rowHeight = 0;
    }
    leaf.atlasX = x;
    leaf.atlasY = y;
    x += leaf.width + 2;
    rowHeight = Math.max(rowHeight, leaf.height);
  }
  return Math.max(1, y + rowHeight + 1);
}

function packSpaceTimeLeafStrips(slots, stateCount) {
  let x = 1;
  let y = 1;
  let rowHeight = 0;
  for (const slot of slots) {
    if (slot.pixelCount === 0) continue;
    const stripHeight = slot.height * stateCount;
    if (slot.width + 2 > SPACE_TIME_ATLAS_WIDTH || stripHeight + 2 > 8_192) {
      throw new Error(`Projected space-time leaf ${slot.index} exceeds the 8192px page bound`);
    }
    if (x + slot.width + 1 > SPACE_TIME_ATLAS_WIDTH) {
      x = 1;
      y += rowHeight + 2;
      rowHeight = 0;
    }
    slot.atlasX = x;
    slot.atlasY = y;
    x += slot.width + 2;
    rowHeight = Math.max(rowHeight, stripHeight);
  }
  const height = Math.max(1, y + rowHeight + 1);
  if (height > 8_192) throw new Error(`Projected space-time page height ${height} exceeds 8192px`);
  return height;
}

function visibleLeafCss(leaf, inverseRoot, atlasWidth, atlasHeight) {
  return [
    "position:absolute",
    "display:block",
    "left:0",
    "top:0",
    `width:${leaf.width}px`,
    `height:${leaf.height}px`,
    "box-sizing:content-box",
    "margin:0",
    "padding:0",
    "border:0",
    "border-radius:0",
    "corner-top-left-shape:initial",
    "corner-top-right-shape:initial",
    "corner-bottom-right-shape:initial",
    "corner-bottom-left-shape:initial",
    "transform-origin:0 0",
    "transform-style:preserve-3d",
    "backface-visibility:visible",
    `transform:${projectedLeafTransform(leaf, inverseRoot)}`,
    "background-image:var(--cssflower-projected-atlas)",
    "background-color:transparent",
    "background-repeat:no-repeat",
    `background-position:${-leaf.atlasX}px ${-leaf.atlasY}px`,
    `background-size:${atlasWidth}px ${atlasHeight}px`,
    "image-rendering:auto",
    "color:transparent",
    "line-height:0",
    "text-decoration:none",
  ].join(";");
}

function bankLeafCss(slot, atlasWidth, atlasHeight) {
  return [
    "position:absolute",
    "display:block",
    "left:0",
    "top:0",
    `width:${slot.width}px`,
    `height:${slot.height}px`,
    "box-sizing:content-box",
    "margin:0",
    "padding:0",
    "border:0",
    "border-radius:0",
    "corner-top-left-shape:initial",
    "corner-top-right-shape:initial",
    "corner-bottom-right-shape:initial",
    "corner-bottom-left-shape:initial",
    "transform-origin:0 0",
    "transform-style:preserve-3d",
    "backface-visibility:visible",
    "background-image:var(--cssflower-projected-atlas)",
    "background-color:transparent",
    "background-repeat:no-repeat",
    `background-position:${-slot.atlasX}px calc(var(--cssflower-projected-y) - ${slot.atlasY}px)`,
    `background-size:${atlasWidth}px ${atlasHeight}px`,
    "image-rendering:pixelated",
    "color:transparent",
    "line-height:0",
    "text-decoration:none",
  ].join(";");
}

function spaceTimeBankLeafCss(slot, atlasWidth, atlasHeight) {
  return [
    "position:absolute",
    "display:block",
    "left:0",
    "top:0",
    `width:${slot.width}px`,
    `height:${slot.height}px`,
    "box-sizing:content-box",
    "margin:0",
    "padding:0",
    "border:0",
    "border-radius:0",
    "corner-top-left-shape:initial",
    "corner-top-right-shape:initial",
    "corner-bottom-right-shape:initial",
    "corner-bottom-left-shape:initial",
    "transform-origin:0 0",
    "transform-style:preserve-3d",
    "backface-visibility:visible",
    `transform:${projectedLeafScreenTranslation(slot)}`,
    "background-image:var(--cssflower-projected-atlas)",
    "background-color:transparent",
    "background-repeat:no-repeat",
    `background-position:${-slot.atlasX}px calc(${-slot.atlasY}px - var(--cssflower-projected-frame) * ${slot.height}px)`,
    `background-size:${atlasWidth}px ${atlasHeight}px`,
    "image-rendering:pixelated",
    "color:transparent",
    "line-height:0",
    "text-decoration:none",
  ].join(";");
}

function hiddenBankLeafCss() {
  return "position:absolute;display:none;left:0;top:0;width:0;height:0;transform:none;background:none;border:0";
}

function projectedLeafTransform(leaf, inverseRoot) {
  const targetTranslation = [leaf.left - HALF_EDGE, leaf.top - HALF_EDGE, 0];
  const localTranslation = multiplyRotationVector(inverseRoot, targetTranslation);
  const matrix = [
    inverseRoot[0][0], inverseRoot[1][0], inverseRoot[2][0], 0,
    inverseRoot[0][1], inverseRoot[1][1], inverseRoot[2][1], 0,
    inverseRoot[0][2], inverseRoot[1][2], inverseRoot[2][2], 0,
    localTranslation[0], localTranslation[1], localTranslation[2], 1,
  ].map(formatCssNumber).join(",");
  return `matrix3d(${matrix})`;
}

function projectedLeafFactoredTransform(leaf, state) {
  const x = normalizeDegrees(state.rootStateIndex * CSSFLOWER_SOURCE_PROFILE.rotation.xDegreesPerUpdate);
  const y = normalizeDegrees(state.rootStateIndex * CSSFLOWER_SOURCE_PROFILE.rotation.yDegreesPerUpdate);
  const dx = leaf.left - HALF_EDGE;
  const dy = leaf.top - HALF_EDGE;
  return `rotateY(${-y}deg) rotateX(${x}deg) translate3d(${dx}px,${dy}px,0px)`;
}

function preparedInverseRootTransform(state) {
  const x = normalizeDegrees(state.rootStateIndex * CSSFLOWER_SOURCE_PROFILE.rotation.xDegreesPerUpdate);
  const y = normalizeDegrees(state.rootStateIndex * CSSFLOWER_SOURCE_PROFILE.rotation.yDegreesPerUpdate);
  return `rotateY(${-y}deg) rotateX(${x}deg)`;
}

function projectedLeafScreenTranslation(leaf) {
  return `translate3d(${leaf.left - HALF_EDGE}px,${leaf.top - HALF_EDGE}px,0px)`;
}

function hiddenLeafCss() {
  return "position:absolute;display:none;left:0;top:0;width:0;height:0;transform:none;background:none;border:0";
}

function inverseCssRootRotation(state) {
  const x = -normalizeDegrees(state.rootStateIndex * CSSFLOWER_SOURCE_PROFILE.rotation.xDegreesPerUpdate) * Math.PI / 180;
  const y = normalizeDegrees(state.rootStateIndex * CSSFLOWER_SOURCE_PROFILE.rotation.yDegreesPerUpdate) * Math.PI / 180;
  const rx = [
    [1, 0, 0],
    [0, Math.cos(x), -Math.sin(x)],
    [0, Math.sin(x), Math.cos(x)],
  ];
  const ry = [
    [Math.cos(y), 0, Math.sin(y)],
    [0, 1, 0],
    [-Math.sin(y), 0, Math.cos(y)],
  ];
  const root = multiplyRotation(rx, ry);
  return transposeRotation(root);
}

function multiplyRotation(left, right) {
  return Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, column) => (
    left[row][0] * right[0][column] +
    left[row][1] * right[1][column] +
    left[row][2] * right[2][column]
  )));
}

function transposeRotation(value) {
  return Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, column) => value[column][row]));
}

function multiplyRotationVector(rotation, value) {
  return rotation.map((row) => row[0] * value[0] + row[1] * value[1] + row[2] * value[2]);
}

function sourceModelRotation(state) {
  const radians = Math.PI / 180;
  const x = state.rootStateIndex * CSSFLOWER_SOURCE_PROFILE.rotation.xDegreesPerUpdate * radians;
  const y = state.rootStateIndex * CSSFLOWER_SOURCE_PROFILE.rotation.yDegreesPerUpdate * radians;
  const z = state.rotationZDegrees * radians;
  return Object.freeze({
    cx: Math.cos(x), sx: Math.sin(x),
    cy: Math.cos(y), sy: Math.sin(y),
    cz: Math.cos(z), sz: Math.sin(z),
  });
}

function rotateSourceVector(rotation, value) {
  const xAfterZ = rotation.cz * value[0] - rotation.sz * value[1];
  const yAfterZ = rotation.sz * value[0] + rotation.cz * value[1];
  const xAfterY = rotation.cy * xAfterZ + rotation.sy * value[2];
  const zAfterY = -rotation.sy * xAfterZ + rotation.cy * value[2];
  return [
    xAfterY,
    rotation.cx * yAfterZ - rotation.sx * zAfterY,
    rotation.sx * yAfterZ + rotation.cx * zAfterY,
  ];
}

function windowDepthForEyeDistance(eyeDistance) {
  const ndc = (CAMERA.far + CAMERA.near) / (CAMERA.far - CAMERA.near) -
    (2 * CAMERA.far * CAMERA.near) / ((CAMERA.far - CAMERA.near) * eyeDistance);
  return (ndc + 1) / 2;
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeDegrees(value) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function formatCssNumber(value) {
  const rounded = Math.round(value * 1_000_000_000) / 1_000_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
