import { createHash } from "node:crypto";
import {
  SOLID_TRIANGLE_CANONICAL_SIZE,
  computeSolidTrianglePlan,
  computeTextureAtlasPlanPublic,
  resolveAtlasLeafBox,
} from "@layoutit/polycss";
import { PNG } from "pngjs";
import {
  CSSFLOWER_BOUNDARY_SEAM_BLEED,
  CSSFLOWER_LIGHTING_GRID_COLUMNS,
  CSSFLOWER_LIGHTING_GRID_DECODED_BYTES,
  CSSFLOWER_LIGHTING_GRID_HEIGHT,
  CSSFLOWER_LIGHTING_GRID_ROWS,
  CSSFLOWER_LIGHTING_GRID_WIDTH,
  CSSFLOWER_LIGHTING_ALPHA_COVERAGE,
  CSSFLOWER_LIGHTING_LAYOUT,
  CSSFLOWER_LIGHTING_RASTER_MODE,
  CSSFLOWER_LIGHTING_SAMPLING,
  CSSFLOWER_LIGHTING_SCHEMA,
  CSSFLOWER_SEAM_BLEED,
  CSSFLOWER_SEAM_BLEED_POLICY,
} from "../../cssflower/renderContract.mjs";
import {
  buildPreparedFullRotationCycle,
  buildPreparedRoundedProductCycle,
} from "./bloomCycle.mjs";
import {
  buildCubeTopology,
  buildSideSiblingSeamPlan,
  computeSmoothPointNormals,
  deformCubePoints,
  trianglePolygon,
} from "./cubeTopology.mjs";
import { CSSFLOWER_CAMERA, CSSFLOWER_SOURCE_PROFILE } from "./sourceProfile.mjs";
import { auditPreparedQuadMergeEligibility } from "./quadMergeAudit.mjs";
import {
  CSSFLOWER_LEAF_RASTER_PAGE_ROWS,
  buildPreparedLeafRasterLayout,
  writePreparedLeafRasterLightingTile,
} from "./leafRasterLighting.mjs";

const MATRIX_COMPONENTS = 16;
const MINIMUM_RASTER_LEAF_SIZE = 4;
export const CSSFLOWER_LIGHTING_PAGE_ROWS = CSSFLOWER_LEAF_RASTER_PAGE_ROWS;

export async function compilePreparedCssflowerCycle({
  nativeAuthorityStatus = "missing",
  readLightingPage,
  writeLightingPage,
} = {}) {
  if (typeof readLightingPage !== "function" || typeof writeLightingPage !== "function") {
    throw new TypeError("cssFlower production compilation requires a streaming cached lighting-page store");
  }
  assertLittleEndian();
  const topology = buildCubeTopology();
  const siblingSeamPlan = buildSideSiblingSeamPlan(topology);
  if (siblingSeamPlan.policy !== CSSFLOWER_SEAM_BLEED_POLICY) {
    throw new Error("cssFlower prepared seam policy drifted");
  }
  const seamEdgesByMask = buildSeamEdgesByMask();
  const sourceCycle = buildPreparedFullRotationCycle();
  const cycle = attachPreparedLightingRows(buildPreparedRoundedProductCycle());
  const quadMergeAudit = auditPreparedQuadMergeEligibility(topology, sourceCycle);
  const rasterFaces = selectPreparedRasterFaces(topology, sourceCycle, siblingSeamPlan, seamEdgesByMask);
  const rasterLayout = buildPreparedLeafRasterLayout(rasterFaces);
  const sourceMatrixValues = new Float32Array(sourceCycle.geometryStateCount * topology.triangleCount * MATRIX_COMPONENTS);
  const atlasWidth = rasterLayout.atlasWidth;
  const atlasHeight = rasterLayout.atlasHeight;
  const stateEvidence = [];
  const geometryByState = new Array(sourceCycle.geometryStateCount);
  const sourceCanonicalPointIndices = new Uint16Array(sourceCycle.geometryStateCount * topology.triangleCount * 3);
  let initialPolygons = null;

  for (const geometryState of sourceCycle.geometryStates) {
    const positions = deformCubePoints(topology, geometryState.sf);
    const normals = computeSmoothPointNormals(topology, positions);
    geometryByState[geometryState.index] = Object.freeze({ positions, normals });
    const transformStateOffset = geometryState.index * topology.triangleCount * MATRIX_COMPONENTS;

    for (const triangle of topology.triangles) {
      const polygon = trianglePolygon(topology, triangle, positions);
      const rasterFace = rasterFaces[triangle.index];
      const seamEdgeMask = siblingSeamPlan.edgeMasks[triangle.index];
      const seamEdges = seamEdgesByMask[seamEdgeMask];
      const texturePlan = computeTextureAtlasPlanPublic(polygon, triangle.index, {
        seamBleed: rasterFace.seamBleed,
        seamEdges,
      });
      const solidPlan = computeSolidTrianglePlan(polygon, triangle.index, {
        seamBleed: rasterFace.seamBleed,
        seamEdges,
        stableTriangleMatrixDecimals: 6,
        textureLighting: "baked",
      }, {
        primitive: "corner",
        includeColor: false,
        matrixDecimals: 6,
      });
      if (!texturePlan || texturePlan.bleedRatio !== rasterFace.seamBleed ||
          !sameEdgeSet(texturePlan.seamBleedEdges, seamEdges) ||
          texturePlan.projectiveMatrix !== null || !solidPlan?.transformText) {
        throw new Error(`cssFlower state ${geometryState.index} triangle ${triangle.index} lost its prepared seam-bleed triangle plan`);
      }
      sourceMatrixValues.set(
        fitCanonicalTransformToRasterLeaf(
          parseMatrix3d(solidPlan.transformText),
          rasterFace.leafWidth,
          rasterFace.leafHeight,
        ),
        transformStateOffset + triangle.index * MATRIX_COMPONENTS,
      );
      const { a, b, c } = solidPlan.basis;
      sourceCanonicalPointIndices.set([
        triangle.pointIndices[c],
        triangle.pointIndices[a],
        triangle.pointIndices[b],
      ], (geometryState.index * topology.triangleCount + triangle.index) * 3);
    }

    if (geometryState.index === sourceCycle.states[0].geometryStateIndex) {
      initialPolygons = topology.triangles.map((triangle) => trianglePolygon(topology, triangle, positions));
    }
    const transformStart = transformStateOffset * Float32Array.BYTES_PER_ELEMENT;
    const transformEnd = transformStart + topology.triangleCount * MATRIX_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;
    stateEvidence.push(Object.freeze({
      geometryStateIndex: geometryState.index,
      firstTick: geometryState.firstTick,
      sf: geometryState.sf,
      sfHex: geometryState.sfHex,
      positionsSha256: sha256(typedArrayBytes(positions)),
      normalsSha256: sha256(typedArrayBytes(normals)),
      transformsSha256: sha256(Buffer.from(sourceMatrixValues.buffer, transformStart, transformEnd - transformStart)),
    }));
  }

  if (!initialPolygons || initialPolygons.length !== 1200) {
    throw new Error("cssFlower initial 1,200-triangle product was not compiled");
  }
  const matrixValues = new Float32Array(cycle.geometryStateCount * topology.triangleCount * MATRIX_COMPONENTS);
  const canonicalPointIndices = new Uint16Array(cycle.geometryStateCount * topology.triangleCount * 3);
  const productGeometryByState = new Array(cycle.geometryStateCount);
  for (const geometryState of cycle.geometryStates) {
    const sourceGeometryStateIndex = geometryState.sourceGeometryStateIndex ?? geometryState.index;
    const sourceGeometryState = sourceCycle.geometryStates[sourceGeometryStateIndex];
    const geometry = geometryByState[sourceGeometryStateIndex];
    if (!sourceGeometryState || !geometry || sourceGeometryState.sfHex !== geometryState.sfHex) {
      throw new Error(`cssFlower product geometry ${geometryState.index} lost its source-derived binding`);
    }
    productGeometryByState[geometryState.index] = geometry;
    const sourceTransformStart = sourceGeometryStateIndex * topology.triangleCount * MATRIX_COMPONENTS;
    const productTransformStart = geometryState.index * topology.triangleCount * MATRIX_COMPONENTS;
    matrixValues.set(
      sourceMatrixValues.subarray(
        sourceTransformStart,
        sourceTransformStart + topology.triangleCount * MATRIX_COMPONENTS,
      ),
      productTransformStart,
    );
    const sourceCanonicalStart = sourceGeometryStateIndex * topology.triangleCount * 3;
    const productCanonicalStart = geometryState.index * topology.triangleCount * 3;
    canonicalPointIndices.set(
      sourceCanonicalPointIndices.subarray(
        sourceCanonicalStart,
        sourceCanonicalStart + topology.triangleCount * 3,
      ),
      productCanonicalStart,
    );
  }
  const transformBytes = Buffer.from(matrixValues.buffer);
  const vertexLightingByState = Object.freeze(cycle.states.map((state) => {
    const geometry = productGeometryByState[state.geometryStateIndex];
    if (!geometry) throw new Error(`cssFlower lighting state ${state.tick} has no prepared geometry`);
    return computePreparedVertexLightingUnquantized(
      topology,
      geometry.positions,
      geometry.normals,
      state,
    );
  }));
  const lightingAddressSchedule = buildPreparedLightingAddressSchedule({
    topology,
    cycle,
    canonicalPointIndices,
    vertexLightingByState,
  });
  const lightingPreparation = await prepareLightingPages({
    topology,
    cycle,
    canonicalPointIndices,
    atlasWidth,
    atlasHeight,
    rasterFaces,
    rasterLayout,
    vertexLightingByState,
    readLightingPage,
    writeLightingPage,
  });
  const lightingPages = lightingPreparation.pages;
  const firstLightingPage = lightingPages[0];
  const topologyEvidence = topologyEvidenceFor(topology);
  const evidence = Object.freeze({
    schema: "cssflower-prepared-state-evidence@1",
    profileId: CSSFLOWER_SOURCE_PROFILE.id,
    implementation: "independently-authored-cssflower-preparer",
    nativeAuthorityStatus,
    engineIndependence: Object.freeze({
      status: "pass",
      preparedInputReadsNativeReplay: false,
      preparedInputReadsNativeState: false,
      browserReadsNativeReplay: false,
    }),
    topology: topologyEvidence,
    update: Object.freeze({
      stateCount: sourceCycle.stateCount,
      geometryStateCount: sourceCycle.geometryStateCount,
      cycleStartState: sourceCycle.cycleStartState,
      cycleLength: sourceCycle.cycleLength,
      bloomTraceStateCount: sourceCycle.bloomTraceStateCount,
      bloomCycleLength: sourceCycle.bloomCycleLength,
      rootStateCount: sourceCycle.rootStateCount,
      productStateCount: cycle.stateCount,
      productGeometryStateCount: cycle.geometryStateCount,
      productCycleLength: cycle.cycleLength,
      productBloomCycleLength: cycle.bloomCycleLength,
      productBloomPeakSf: cycle.bloomPeakSf,
    }),
    camera: CSSFLOWER_CAMERA,
    light: CSSFLOWER_SOURCE_PROFILE.light,
    materials: topologyEvidence.materials,
    rasterAtlas: Object.freeze({
      leafSizing: "raster",
      seamBleed: CSSFLOWER_SEAM_BLEED,
      boundarySeamBleed: CSSFLOWER_BOUNDARY_SEAM_BLEED,
      seamBleedPolicy: siblingSeamPlan.policy,
      boundaryVertexCount: siblingSeamPlan.boundaryVertexCount,
      boundaryAdjacentTriangleCount: siblingSeamPlan.boundaryAdjacentTriangleCount,
      sharedEdgeCount: siblingSeamPlan.sharedEdgeCount,
      sharedEdgeIncidenceCount: siblingSeamPlan.sharedEdgeIncidenceCount,
      boundaryEdgeCount: siblingSeamPlan.boundaryEdgeCount,
      boundaryEdgeIncidenceCount: siblingSeamPlan.boundaryEdgeIncidenceCount,
      canonicalSize: SOLID_TRIANGLE_CANONICAL_SIZE,
      sampling: rasterLayout.sampling,
      gutter: rasterLayout.gutter,
      gutterPolicy: rasterLayout.gutterPolicy,
      packing: rasterLayout.packing,
      packingEfficiency: rasterLayout.packingEfficiency,
      stateSliceHeight: rasterLayout.stateSliceHeight,
      atlasWidth,
      atlasHeight,
      selection: "per-face maximum PolyCSS raster leaf box across every prepared geometry state",
      faceCount: rasterFaces.length,
      minimumLeafWidth: Math.min(...rasterFaces.map((face) => face.leafWidth)),
      maximumLeafWidth: Math.max(...rasterFaces.map((face) => face.leafWidth)),
      minimumLeafHeight: Math.min(...rasterFaces.map((face) => face.leafHeight)),
      maximumLeafHeight: Math.max(...rasterFaces.map((face) => face.leafHeight)),
      pageRows: CSSFLOWER_LIGHTING_PAGE_ROWS,
      pageCount: lightingPages.length,
      gridColumns: CSSFLOWER_LIGHTING_GRID_COLUMNS,
      gridRows: CSSFLOWER_LIGHTING_GRID_ROWS,
      gridWidth: CSSFLOWER_LIGHTING_GRID_WIDTH,
      gridHeight: CSSFLOWER_LIGHTING_GRID_HEIGHT,
      gridDecodedBytes: CSSFLOWER_LIGHTING_GRID_DECODED_BYTES,
    }),
    quadMergeAudit,
    geometryStates: Object.freeze(stateEvidence),
    ticks: Object.freeze(sourceCycle.states.map((state) => Object.freeze({
      tick: state.tick,
      sf: state.sf,
      sfHex: state.sfHex,
      sfi: state.sfi,
      sfiHex: state.sfiHex,
      rotationXDegrees: state.rotationXDegrees,
      rotationYDegrees: state.rotationYDegrees,
      rotationZDegrees: state.rotationZDegrees,
      rootStateIndex: state.rootStateIndex,
      geometryStateIndex: state.geometryStateIndex,
    }))),
  });

  return Object.freeze({
    topology,
    cycle,
    sourceCycle,
    initialPolygons: Object.freeze(initialPolygons),
    transformBytes,
    transformSha256: sha256(transformBytes),
    lightingSha256: firstLightingPage.sha256,
    lightingPages,
    lightingPageCache: Object.freeze({
      hitCount: lightingPreparation.cacheHitCount,
      missCount: lightingPreparation.cacheMissCount,
    }),
    lighting: Object.freeze({
      schema: CSSFLOWER_LIGHTING_SCHEMA,
      techniqueReference: "cssGraphics Mario prepared space-time texel seam with per-leaf raster-sized fields",
      topology: "stable PolyCSS triangles select opaque endpoint-aligned leaf-resolution lighting rasters from bounded prepared timeline pages",
      physicalLayout: CSSFLOWER_LIGHTING_LAYOUT,
      assetUrl: firstLightingPage.assetUrl,
      assetSha256: firstLightingPage.sha256,
      rasterMode: CSSFLOWER_LIGHTING_RASTER_MODE,
      sampling: CSSFLOWER_LIGHTING_SAMPLING,
      gutter: rasterLayout.gutter,
      gutterPolicy: rasterLayout.gutterPolicy,
      packing: rasterLayout.packing,
      packingEfficiency: rasterLayout.packingEfficiency,
      stateSliceHeight: rasterLayout.stateSliceHeight,
      minimumTileWidth: Math.min(...rasterFaces.map((face) => face.leafWidth)),
      maximumTileWidth: Math.max(...rasterFaces.map((face) => face.leafWidth)),
      minimumTileHeight: Math.min(...rasterFaces.map((face) => face.leafHeight)),
      maximumTileHeight: Math.max(...rasterFaces.map((face) => face.leafHeight)),
      minimumLeafWidth: Math.min(...rasterFaces.map((face) => face.leafWidth)),
      maximumLeafWidth: Math.max(...rasterFaces.map((face) => face.leafWidth)),
      minimumLeafHeight: Math.min(...rasterFaces.map((face) => face.leafHeight)),
      maximumLeafHeight: Math.max(...rasterFaces.map((face) => face.leafHeight)),
      leafSizing: "raster",
      seamBleed: CSSFLOWER_SEAM_BLEED,
      boundarySeamBleed: CSSFLOWER_BOUNDARY_SEAM_BLEED,
      seamBleedPolicy: siblingSeamPlan.policy,
      boundaryVertexCount: siblingSeamPlan.boundaryVertexCount,
      boundaryAdjacentTriangleCount: siblingSeamPlan.boundaryAdjacentTriangleCount,
      sharedEdgeCount: siblingSeamPlan.sharedEdgeCount,
      sharedEdgeIncidenceCount: siblingSeamPlan.sharedEdgeIncidenceCount,
      boundaryEdgeCount: siblingSeamPlan.boundaryEdgeCount,
      boundaryEdgeIncidenceCount: siblingSeamPlan.boundaryEdgeIncidenceCount,
      canonicalLeafSize: SOLID_TRIANGLE_CANONICAL_SIZE,
      rasterSelection: "per-face maximum resolveAtlasLeafBox(..., raster) across every prepared geometry state",
      faceCount: topology.triangleCount,
      timelineRowCount: cycle.stateCount,
      geometryStateCount: cycle.geometryStateCount,
      atlasWidth,
      atlasHeight,
      gridColumns: CSSFLOWER_LIGHTING_GRID_COLUMNS,
      gridRows: CSSFLOWER_LIGHTING_GRID_ROWS,
      gridWidth: CSSFLOWER_LIGHTING_GRID_WIDTH,
      gridHeight: CSSFLOWER_LIGHTING_GRID_HEIGHT,
      pageRowCount: CSSFLOWER_LIGHTING_PAGE_ROWS,
      pageCount: lightingPages.length,
      pages: lightingPages,
      totalEncodedBytes: lightingPages.reduce((sum, page) => sum + page.byteLength, 0),
      decodedBytesPerFullPage: atlasWidth * atlasHeight * 4,
      decodedGridBytes: CSSFLOWER_LIGHTING_GRID_DECODED_BYTES,
      addressSchedule: lightingAddressSchedule,
      backgroundPositionXs: Object.freeze(Array.from(
        { length: lightingPages.length },
        (_, pageIndex) => `${-pageIndex * atlasWidth}px`,
      )),
      backgroundPositionYs: Object.freeze(Array.from(
        { length: CSSFLOWER_LIGHTING_PAGE_ROWS },
        (_, rowIndex) => `${-rowIndex * rasterLayout.stateSliceHeight}px`,
      )),
      faces: Object.freeze(rasterFaces.map((face, faceIndex) => {
        const placement = rasterLayout.placements[faceIndex];
        return Object.freeze({
          ...face,
          tileWidth: face.leafWidth,
          tileHeight: face.leafHeight,
          slotX: placement.slotX,
          slotY: placement.slotY,
          slotWidth: placement.slotWidth,
          slotHeight: placement.slotHeight,
          contentX: placement.contentX,
          contentY: placement.contentY,
          backgroundSize: `${CSSFLOWER_LIGHTING_GRID_WIDTH}px ${CSSFLOWER_LIGHTING_GRID_HEIGHT}px`,
          backgroundPositionX: `${-placement.contentX}px`,
          backgroundPositionY: `${-placement.contentY}px`,
        });
      })),
      rowSelection: "prepared-exact-rgb8-sparse-leaf-address-schedule",
      temporalInterpolation: false,
      sourceModelviewLighting: "identity-set-positional-light-then-Rx-Ry-Rz-with-normalize-and-infinite-viewer",
      rotationAware: true,
      runtimeRootFrameVariables: 1,
      runtimePreparedPagePreload: false,
      runtimeLightingAssetCount: 1,
      runtimeLightingCalculations: 0,
      runtimeAtlasConstruction: 0,
    }),
    evidence,
    quadMergeAudit,
    siblingSeamPlan,
  });
}

function attachPreparedLightingRows(sourceCycle) {
  return Object.freeze({
    ...sourceCycle,
    states: Object.freeze(sourceCycle.states.map((state) => Object.freeze({
      ...state,
      lightingPageIndex: Math.floor(state.tick / CSSFLOWER_LIGHTING_PAGE_ROWS),
      lightingPageRowIndex: state.tick % CSSFLOWER_LIGHTING_PAGE_ROWS,
    }))),
  });
}

async function prepareLightingPages({
  topology,
  cycle,
  canonicalPointIndices,
  atlasWidth,
  atlasHeight,
  rasterFaces,
  rasterLayout,
  vertexLightingByState,
  readLightingPage,
  writeLightingPage,
}) {
  const pageCount = Math.ceil(cycle.stateCount / CSSFLOWER_LIGHTING_PAGE_ROWS);
  const pages = [];
  let cacheHitCount = 0;
  let cacheMissCount = 0;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const startStateIndex = pageIndex * CSSFLOWER_LIGHTING_PAGE_ROWS;
    const usedRowCount = Math.min(CSSFLOWER_LIGHTING_PAGE_ROWS, cycle.stateCount - startStateIndex);
    const expectedPage = Object.freeze({
      index: pageIndex,
      startStateIndex,
      usedRowCount,
      rowCount: CSSFLOWER_LIGHTING_PAGE_ROWS,
      assetUrl: lightingPageAssetUrl(pageIndex),
      role: "cssflower-prepared-full-rotation-leaf-raster-space-time-page",
      encoding: "PNG-RGBA8",
      opaqueUsedRows: false,
      alphaCoverage: CSSFLOWER_LIGHTING_ALPHA_COVERAGE,
      width: atlasWidth,
      height: atlasHeight,
      decodedBytes: atlasWidth * atlasHeight * 4,
    });
    const cachedPage = await readLightingPage(expectedPage);
    if (cachedPage) {
      assertPreparedLightingPageDescriptor(cachedPage, expectedPage);
      pages.push(Object.freeze(cachedPage));
      cacheHitCount += 1;
      continue;
    }
    cacheMissCount += 1;
    const atlas = new PNG({ width: atlasWidth, height: atlasHeight, colorType: 6 });
    const atlasPixels = new Uint32Array(
      atlas.data.buffer,
      atlas.data.byteOffset,
      atlas.data.byteLength / Uint32Array.BYTES_PER_ELEMENT,
    );
    for (let rowIndex = 0; rowIndex < usedRowCount; rowIndex += 1) {
      const state = cycle.states[startStateIndex + rowIndex];
      const vertexColors = vertexLightingByState[startStateIndex + rowIndex];
      if (!(vertexColors instanceof Float64Array)) {
        throw new Error(`cssFlower lighting state ${state.tick} has no prepared vertex colors`);
      }
      for (const triangle of topology.triangles) {
        writePreparedLeafRasterLightingTile({
          atlasData: atlas.data,
          atlasPixels,
          atlasWidth,
          rowIndex,
          faceIndex: triangle.index,
          layout: rasterLayout,
          canonicalPointIndices,
          canonicalPointOffset: (state.geometryStateIndex * topology.triangleCount + triangle.index) * 3,
          seamEdgeMask: rasterFaces[triangle.index].seamEdgeMask,
          vertexColors,
        });
      }
    }
    const bytes = PNG.sync.write(atlas, { colorType: 6, inputColorType: 6 });
    const pageWithBytes = Object.freeze({
      ...expectedPage,
      byteLength: bytes.length,
      sha256: sha256(bytes),
      bytes,
    });
    await writeLightingPage(pageWithBytes);
    const { bytes: _bytes, ...page } = pageWithBytes;
    pages.push(Object.freeze(page));
  }
  return Object.freeze({
    pages: Object.freeze(pages),
    cacheHitCount,
    cacheMissCount,
  });
}

function buildPreparedLightingAddressSchedule({
  topology,
  cycle,
  canonicalPointIndices,
  vertexLightingByState,
}) {
  const faceCount = topology.triangleCount;
  const signatureStride = 9;
  if (cycle?.stateCount !== 360 || vertexLightingByState?.length !== cycle.stateCount ||
      !(canonicalPointIndices instanceof Uint16Array) ||
      canonicalPointIndices.length < cycle.geometryStateCount * faceCount * 3) {
    throw new Error("cssFlower sparse lighting preparation inputs are incomplete");
  }
  const selectedSignatures = new Uint8Array(faceCount * signatureStride);
  const currentSignature = new Uint8Array(signatureStride);
  const updateOffsets = new Uint32Array(cycle.stateCount + 1);
  const updatedFaceIndices = [];
  for (let stateIndex = 0; stateIndex < cycle.stateCount; stateIndex += 1) {
    const state = cycle.states[stateIndex];
    const vertexColors = vertexLightingByState[stateIndex];
    updateOffsets[stateIndex] = updatedFaceIndices.length;
    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
      preparedFaceLightingSignature(
        currentSignature,
        canonicalPointIndices,
        (state.geometryStateIndex * faceCount + faceIndex) * 3,
        vertexColors,
      );
      const selectedOffset = faceIndex * signatureStride;
      let changed = stateIndex === 0;
      for (let channel = 0; channel < signatureStride && !changed; channel += 1) {
        changed = selectedSignatures[selectedOffset + channel] !== currentSignature[channel];
      }
      if (!changed) continue;
      selectedSignatures.set(currentSignature, selectedOffset);
      updatedFaceIndices.push(faceIndex);
    }
  }
  updateOffsets[cycle.stateCount] = updatedFaceIndices.length;
  if (updateOffsets[1] !== faceCount || updatedFaceIndices.length < faceCount) {
    throw new Error("cssFlower sparse lighting schedule did not bind the complete retained target");
  }
  const indices = new Uint16Array(updatedFaceIndices);
  const indexBytes = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
  const counts = Array.from(
    { length: cycle.stateCount },
    (_, stateIndex) => updateOffsets[stateIndex + 1] - updateOffsets[stateIndex],
  );
  const sortedCounts = [...counts].sort((left, right) => left - right);
  return Object.freeze({
    schema: "cssflower-prepared-exact-sparse-lighting-address-schedule@1",
    stateCount: cycle.stateCount,
    faceCount,
    selectionDomain: "prepared-source-vertex-lighting-rgb8",
    comparison: "exact-three-canonical-point-rgb8-signature-per-retained-triangle",
    threshold: 0,
    cycleBoundaryPolicy: "force-all-faces-to-state-zero-on-each-360-state-wrap",
    updateCount: indices.length,
    meanUpdatesPerState: indices.length / cycle.stateCount,
    p95UpdatesPerState: sortedCounts[Math.ceil(sortedCounts.length * 0.95) - 1],
    maximumUpdatesPerState: sortedCounts.at(-1),
    offsets: Object.freeze(Array.from(updateOffsets)),
    faceIndicesEncoding: "base64-u16le-state-major-updated-face-indices",
    faceIndicesByteLength: indexBytes.length,
    faceIndicesSha256: sha256(indexBytes),
    faceIndicesBase64: indexBytes.toString("base64"),
    runtimeSelection: "prepared-state-range-only-no-lighting-or-geometry-calculation",
    visualEquivalence: "source-rgb8-exact-with-bounded-location-dependent-lossy-atlas-raster-drift",
  });
}

function preparedFaceLightingSignature(
  output,
  canonicalPointIndices,
  canonicalPointOffset,
  vertexColors,
) {
  if (!(output instanceof Uint8Array) || output.length !== 9 ||
      !(vertexColors instanceof Float64Array)) {
    throw new TypeError("cssFlower prepared lighting signature buffers are invalid");
  }
  for (let vertex = 0; vertex < 3; vertex += 1) {
    const pointIndex = canonicalPointIndices[canonicalPointOffset + vertex];
    for (let channel = 0; channel < 3; channel += 1) {
      output[vertex * 3 + channel] = clampByte(vertexColors[pointIndex * 3 + channel]);
    }
  }
  return output;
}

function assertPreparedLightingPageDescriptor(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual?.[key] !== value) {
      throw new Error(`cssFlower cached lighting page ${expected.index} drifted at ${key}`);
    }
  }
  if (!Number.isSafeInteger(actual.byteLength) || actual.byteLength < 1 ||
      !/^[a-f0-9]{64}$/u.test(actual.sha256 ?? "") || "bytes" in actual) {
    throw new Error(`cssFlower cached lighting page ${expected.index} has an invalid identity`);
  }
}

function lightingPageAssetUrl(pageIndex) {
  return pageIndex === 0
    ? "/cssflower/assets/flower-box-space-texels.png"
    : `/cssflower/assets/flower-box-space-texels-page-${String(pageIndex).padStart(3, "0")}.png`;
}

function selectPreparedRasterFaces(topology, cycle, siblingSeamPlan, seamEdgesByMask) {
  const faces = topology.triangles.map((triangle) => ({
    sourceOrder: triangle.index,
    triangleId: triangle.id,
    seamEdgeMask: siblingSeamPlan.edgeMasks[triangle.index],
    seamBleed: siblingSeamPlan.boundaryAdjacentTriangles[triangle.index]
      ? CSSFLOWER_BOUNDARY_SEAM_BLEED
      : CSSFLOWER_SEAM_BLEED,
    boundaryAdjacent: siblingSeamPlan.boundaryAdjacentTriangles[triangle.index],
    leafWidth: MINIMUM_RASTER_LEAF_SIZE,
    leafHeight: MINIMUM_RASTER_LEAF_SIZE,
  }));
  for (const geometryState of cycle.geometryStates) {
    const positions = deformCubePoints(topology, geometryState.sf);
    for (const triangle of topology.triangles) {
      const polygon = trianglePolygon(topology, triangle, positions);
      const face = faces[triangle.index];
      const seamEdges = seamEdgesByMask[siblingSeamPlan.edgeMasks[triangle.index]];
      const plan = computeTextureAtlasPlanPublic(polygon, triangle.index, {
        seamBleed: face.seamBleed,
        seamEdges,
      });
      if (!plan || plan.bleedRatio !== face.seamBleed ||
          !sameEdgeSet(plan.seamBleedEdges, seamEdges) || plan.projectiveMatrix !== null) {
        throw new Error(`cssFlower raster state ${geometryState.index} triangle ${triangle.index} lost its prepared seam-bleed affine atlas plan`);
      }
      const box = resolveAtlasLeafBox(plan, 1, "raster", SOLID_TRIANGLE_CANONICAL_SIZE);
      if (box.sizing !== "raster" || !Number.isFinite(box.width) || !Number.isFinite(box.height)) {
        throw new Error(`cssFlower raster state ${geometryState.index} triangle ${triangle.index} has no PolyCSS raster leaf box`);
      }
      face.leafWidth = Math.max(face.leafWidth, Math.ceil(box.width));
      face.leafHeight = Math.max(face.leafHeight, Math.ceil(box.height));
    }
  }
  return Object.freeze(faces.map((face) => Object.freeze(face)));
}

function buildSeamEdgesByMask() {
  return Object.freeze(Array.from({ length: 8 }, (_, mask) => new Set(
    [0, 1, 2].filter((edgeIndex) => (mask & (1 << edgeIndex)) !== 0),
  )));
}

function sameEdgeSet(actual, expected) {
  return actual?.size === expected.size && [...expected].every((edgeIndex) => actual.has(edgeIndex));
}

function fitCanonicalTransformToRasterLeaf(values, leafWidth, leafHeight) {
  const fitted = [...values];
  const xScale = SOLID_TRIANGLE_CANONICAL_SIZE / leafWidth;
  const yScale = SOLID_TRIANGLE_CANONICAL_SIZE / leafHeight;
  for (const index of [0, 1, 2]) fitted[index] *= xScale;
  for (const index of [4, 5, 6]) fitted[index] *= yScale;
  return fitted;
}

function topologyEvidenceFor(topology) {
  return Object.freeze({
    schema: topology.schema,
    subdivision: topology.subdivision,
    sideCount: topology.sideCount,
    sideLocalPointCount: topology.sideLocalPointCount,
    triangleCount: topology.triangleCount,
    topology: topology.topology,
    merge: topology.merge,
    pointIdsSha256: sha256(Buffer.from(topology.points.map((point) => point.id).join("\n"))),
    triangleIdsSha256: sha256(Buffer.from(topology.triangles.map((triangle) => triangle.id).join("\n"))),
    trianglePointIndicesSha256: sha256(Buffer.from(new Uint16Array(topology.triangles.flatMap((triangle) => triangle.pointIndices)).buffer)),
    materials: Object.freeze([...new Map(topology.triangles.map((triangle) => [
      triangle.material.id,
      Object.freeze({ id: triangle.material.id, color: triangle.material.color }),
    ])).values()]),
  });
}

export function computePreparedVertexLighting(topology, positions, normals, state) {
  const unquantized = computePreparedVertexLightingUnquantized(topology, positions, normals, state);
  return Uint8ClampedArray.from(unquantized, clampByte);
}

export function computePreparedVertexLightingUnquantized(topology, positions, normals, state) {
  if (!state || ![state.rotationXDegrees, state.rotationYDegrees, state.rotationZDegrees].every(Number.isFinite)) {
    throw new TypeError("Prepared cssFlower lighting requires one source rotation state");
  }
  const out = new Float64Array(topology.points.length * 3);
  const light = CSSFLOWER_SOURCE_PROFILE.light;
  const rotation = sourceModelRotation(state);
  for (const point of topology.points) {
    const offset = point.index * 3;
    const position = rotateSourceVector(rotation, [positions[offset], positions[offset + 1], positions[offset + 2]]);
    const normal = normalize(rotateSourceVector(rotation, [normals[offset], normals[offset + 1], normals[offset + 2]]));
    const toLight = normalize([light.position[0] - position[0], light.position[1] - position[1], light.position[2] - position[2]]);
    const halfway = normalize([toLight[0], toLight[1], toLight[2] + 1]);
    const diffuse = Math.max(0, dot(normal, toLight));
    const specular = diffuse > 0 ? light.specular[0] * Math.pow(Math.max(0, dot(normal, halfway)), light.shininess) : 0;
    const base = topology.triangles[point.side * 200].material.rgb;
    for (let channel = 0; channel < 3; channel += 1) {
      const ambient = 255 * light.globalAmbient[channel] * light.materialAmbient[channel];
      out[offset + channel] = Math.max(0, Math.min(255,
        ambient + base[channel] * diffuse + 255 * specular,
      ));
    }
  }
  return out;
}

function sourceModelRotation(state) {
  const radians = Math.PI / 180;
  const physicalRootState = Number.isInteger(state.rootStateIndex) ? state.rootStateIndex : null;
  const x = (physicalRootState === null
    ? state.rotationXDegrees
    : physicalRootState * CSSFLOWER_SOURCE_PROFILE.rotation.xDegreesPerUpdate) * radians;
  const y = (physicalRootState === null
    ? state.rotationYDegrees
    : physicalRootState * CSSFLOWER_SOURCE_PROFILE.rotation.yDegreesPerUpdate) * radians;
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

function parseMatrix3d(value) {
  const match = /^matrix3d\(([^)]+)\)$/u.exec(value);
  if (!match) throw new Error(`Invalid prepared cssFlower transform ${value}`);
  const values = match[1].split(",").map(Number);
  if (values.length !== MATRIX_COMPONENTS || values.some((component) => !Number.isFinite(component))) {
    throw new Error(`Invalid prepared cssFlower matrix component count in ${value}`);
  }
  return values;
}

function typedArrayBytes(value) {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalize(value) {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function assertLittleEndian() {
  const bytes = new Uint8Array(new Uint32Array([0x01020304]).buffer);
  if (bytes[0] !== 0x04) throw new Error("cssFlower transform asset requires little-endian Float32");
}
