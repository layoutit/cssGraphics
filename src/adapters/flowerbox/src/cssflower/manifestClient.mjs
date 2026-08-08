import {
  sceneEntryForRoute,
  routeSceneLabel,
} from "./routeState.mjs";
import {
  createPreparedLightingPageLoader,
  createPreparedTransformBlockLoader,
  validatePreparedMorphAssets,
} from "./preparedAssetLoaders.mjs";
import {
  CSSFLOWER_BOUNDARY_SEAM_BLEED,
  CSSFLOWER_LIGHTING_ATLAS_HEIGHT,
  CSSFLOWER_LIGHTING_ATLAS_WIDTH,
  CSSFLOWER_LIGHTING_GUTTER,
  CSSFLOWER_LIGHTING_GRID_COLUMNS,
  CSSFLOWER_LIGHTING_GRID_HEIGHT,
  CSSFLOWER_LIGHTING_GRID_ROWS,
  CSSFLOWER_LIGHTING_GRID_WIDTH,
  CSSFLOWER_LIGHTING_LAYOUT,
  CSSFLOWER_LIGHTING_PAGE_COUNT,
  CSSFLOWER_LIGHTING_PAGE_ROWS,
  CSSFLOWER_LIGHTING_RASTER_MODE,
  CSSFLOWER_LIGHTING_SAMPLING,
  CSSFLOWER_LIGHTING_SCHEMA,
  CSSFLOWER_LIGHTING_STATE_SLICE_HEIGHT,
  CSSFLOWER_FRONT_FACE_DILATION_TICKS,
  CSSFLOWER_FRONT_FACE_SCHEDULE_ENCODING,
  CSSFLOWER_FRONT_FACE_SCHEDULE_SCHEMA,
  CSSFLOWER_SEAM_BLEED,
  CSSFLOWER_SEAM_BLEED_POLICY,
  CSSFLOWER_VISIBILITY_POLICY,
} from "./renderContract.mjs";

export async function loadPreparedManifest(routeState) {
  const manifest = await fetchJson(routeState.manifestUrl, {
    notFoundMessage: "Missing generated cssFlower — Microsoft Flower Box manifest at " + routeState.manifestUrl + ". Run pnpm prepare:cssflower first.",
  });
  if (manifest?.schema !== "cssflower-manifest@1" || manifest?.status !== "ready") {
    throw new Error("Generated cssFlower — Microsoft Flower Box manifest is not ready (" + (manifest?.status ?? "missing status") + "). Run pnpm prepare:cssflower first.");
  }
  return manifest;
}

export async function loadPreparedScene(manifest, routeState) {
  const entry = sceneEntryForRoute(manifest, routeState);
  if (!entry || typeof entry.sceneUrl !== "string") {
    throw new Error("Generated cssFlower — Microsoft Flower Box manifest does not include " + routeSceneLabel(routeState) + ". Run pnpm prepare:cssflower first.");
  }
  const sceneData = await fetchJson(entry.sceneUrl, {
    notFoundMessage: "Missing generated cssFlower — Microsoft Flower Box scene at " + entry.sceneUrl + ". Run pnpm prepare:cssflower first.",
  });
  const snapshotHtml = typeof entry.snapshotUrl === "string" && entry.snapshotUrl
    ? await fetchText(entry.snapshotUrl, {
      notFoundMessage: "Missing generated cssFlower — Microsoft Flower Box PolyCSS snapshot at " + entry.snapshotUrl + ". Run pnpm prepare:cssflower first.",
    })
    : null;
  if (sceneData?.schema !== "cssflower-prepared-scene@1" ||
      sceneData?.playback?.schema !== "cssflower-prepared-playback@1" ||
      sceneData?.renderer?.morphTarget !== "createPolyMorphPreparedDomTarget" ||
      sceneData?.renderer?.stableDom !== true ||
      sceneData?.renderer?.seamBleed !== CSSFLOWER_SEAM_BLEED ||
      sceneData?.renderer?.boundarySeamBleed !== CSSFLOWER_BOUNDARY_SEAM_BLEED ||
      sceneData?.renderer?.seamBleedPolicy !== CSSFLOWER_SEAM_BLEED_POLICY ||
      sceneData?.renderer?.seamBleedSharedEdgeCount !== 1680 ||
      sceneData?.renderer?.seamBleedBoundaryEdgeCount !== 240 ||
      sceneData?.renderer?.seamBleedBoundaryVertexCount !== 240 ||
      sceneData?.renderer?.seamBleedBoundaryAdjacentTriangleCount !== 432 ||
      sceneData?.renderer?.merge !== false ||
      sceneData?.lighting?.schema !== CSSFLOWER_LIGHTING_SCHEMA ||
      sceneData?.lighting?.physicalLayout !== CSSFLOWER_LIGHTING_LAYOUT ||
      sceneData?.lighting?.rasterMode !== CSSFLOWER_LIGHTING_RASTER_MODE ||
      sceneData?.lighting?.sampling !== CSSFLOWER_LIGHTING_SAMPLING ||
      sceneData?.lighting?.gutter !== CSSFLOWER_LIGHTING_GUTTER ||
      sceneData?.lighting?.stateSliceHeight !== CSSFLOWER_LIGHTING_STATE_SLICE_HEIGHT ||
      sceneData?.lighting?.atlasWidth !== CSSFLOWER_LIGHTING_ATLAS_WIDTH ||
      sceneData?.lighting?.atlasHeight !== CSSFLOWER_LIGHTING_ATLAS_HEIGHT ||
      sceneData?.lighting?.gridColumns !== CSSFLOWER_LIGHTING_GRID_COLUMNS ||
      sceneData?.lighting?.gridRows !== CSSFLOWER_LIGHTING_GRID_ROWS ||
      sceneData?.lighting?.gridWidth !== CSSFLOWER_LIGHTING_GRID_WIDTH ||
      sceneData?.lighting?.gridHeight !== CSSFLOWER_LIGHTING_GRID_HEIGHT ||
      sceneData?.lighting?.faceCount !== 1200 ||
      sceneData?.lighting?.timelineRowCount !== 360 ||
      sceneData?.lighting?.pageRowCount !== CSSFLOWER_LIGHTING_PAGE_ROWS ||
      sceneData?.lighting?.pageCount !== CSSFLOWER_LIGHTING_PAGE_COUNT ||
      sceneData?.lighting?.pages?.length !== CSSFLOWER_LIGHTING_PAGE_COUNT ||
      sceneData?.lighting?.leafSizing !== "raster" ||
      sceneData?.lighting?.boundarySeamBleed !== CSSFLOWER_BOUNDARY_SEAM_BLEED ||
      sceneData?.lighting?.seamBleedPolicy !== CSSFLOWER_SEAM_BLEED_POLICY ||
      sceneData?.lighting?.boundaryVertexCount !== 240 ||
      sceneData?.lighting?.boundaryAdjacentTriangleCount !== 432 ||
      sceneData?.lighting?.sharedEdgeIncidenceCount !== 3360 ||
      sceneData?.lighting?.boundaryEdgeIncidenceCount !== 240 ||
      sceneData?.lighting?.faces?.length !== 1200 ||
      !sceneData?.lighting?.faces?.every((face, index) =>
        face?.sourceOrder === index &&
        Number.isSafeInteger(face.leafWidth) && face.leafWidth >= 2 &&
        Number.isSafeInteger(face.leafHeight) && face.leafHeight >= 2 &&
        face.tileWidth === face.leafWidth &&
        face.tileHeight === face.leafHeight &&
        Number.isSafeInteger(face.contentX) && Number.isSafeInteger(face.contentY) &&
        face.contentX >= CSSFLOWER_LIGHTING_GUTTER &&
        face.contentX + face.tileWidth <= CSSFLOWER_LIGHTING_ATLAS_WIDTH - CSSFLOWER_LIGHTING_GUTTER &&
        face.contentY >= CSSFLOWER_LIGHTING_GUTTER &&
        face.contentY + face.tileHeight <= CSSFLOWER_LIGHTING_STATE_SLICE_HEIGHT - CSSFLOWER_LIGHTING_GUTTER &&
        typeof face.backgroundSize === "string" &&
        face.backgroundPositionX === `${-face.contentX}px` &&
        face.backgroundPositionY === `${-face.contentY}px` &&
        Number.isSafeInteger(face?.seamEdgeMask) && face.seamEdgeMask >= 1 && face.seamEdgeMask <= 7 &&
        (face.boundaryAdjacent === true
          ? face.seamBleed === CSSFLOWER_BOUNDARY_SEAM_BLEED
          : face.boundaryAdjacent === false && face.seamBleed === CSSFLOWER_SEAM_BLEED)) ||
      sceneData?.lighting?.backgroundPositionYs?.length !== CSSFLOWER_LIGHTING_PAGE_ROWS ||
      sceneData?.lighting?.backgroundPositionXs?.length !== CSSFLOWER_LIGHTING_PAGE_COUNT ||
      !validPreparedLightingAddressSchedule(sceneData?.lighting?.addressSchedule) ||
      sceneData?.lighting?.rowSelection !== "prepared-exact-rgb8-sparse-leaf-address-schedule" ||
      sceneData?.lighting?.temporalInterpolation !== false ||
      sceneData?.lighting?.runtimeRootFrameVariables !== 1 ||
      !validPreparedFrontFacingSchedule(sceneData?.playback?.frontFacingSchedule) ||
      sceneData?.metrics?.preparedLeafCount !== 1200 ||
      sceneData?.metrics?.preparedRootCount !== 1 ||
      sceneData?.metrics?.runtimePolygonConstructionCount !== 0 ||
      sceneData?.metrics?.runtimeRadialProjectionCount !== 0 ||
      sceneData?.metrics?.runtimeNormalCalculationCount !== 0 ||
      sceneData?.metrics?.runtimeLightingCalculationCount !== 0 ||
      sceneData?.metrics?.runtimeDomGrowth !== false) {
    throw new Error("Generated cssFlower scene is not the retained default-cube contract.");
  }
  if (!snapshotHtml || entry.snapshot?.schema !== "cssflower-retained-snapshot-contract@1") {
    throw new Error("Generated cssFlower retained snapshot binding is missing. Run pnpm prepare:cssflower first.");
  }
  const addressBytes = decodePreparedLightingAddressBytes(sceneData.lighting.addressSchedule);
  const frontFacingBytes = decodePreparedFrontFacingBytes(sceneData.playback.frontFacingSchedule);
  await assertSha256(
    addressBytes,
    sceneData.lighting.addressSchedule.faceIndicesSha256,
    "exact sparse-lighting address schedule",
  );
  await assertSha256(
    frontFacingBytes,
    sceneData.playback.frontFacingSchedule.dataSha256,
    "front-face transform schedule",
  );
  await assertSha256(new TextEncoder().encode(snapshotHtml), entry.snapshot.sha256, "snapshot");
  validatePreparedMorphAssets(sceneData.playback, sceneData.lighting);
  const transformBlocks = createPreparedTransformBlockLoader(sceneData.playback.transformAsset);
  const lightingPages = createPreparedLightingPageLoader(sceneData.lighting);
  const initialState = sceneData.playback.cycle.states[0];
  try {
    await Promise.all([
      transformBlocks.prime(
        initialState.geometryStateIndex,
        initialState.nextTransformBlockGeometryStateIndex,
      ),
      lightingPages.prime(initialState.lightingPageIndex, initialState.nextLightingPageIndex),
    ]);
  } catch (error) {
    transformBlocks.destroy();
    lightingPages.destroy();
    throw error;
  }
  return {
    entry,
    sceneData,
    snapshotHtml,
    preparedAssets: Object.freeze({ transformBlocks, lightingPages }),
  };
}

function validPreparedLightingAddressSchedule(schedule) {
  return schedule?.schema === "cssflower-prepared-exact-sparse-lighting-address-schedule@1" &&
    schedule.stateCount === 360 && schedule.faceCount === 1_200 && schedule.threshold === 0 &&
    schedule.selectionDomain === "prepared-source-vertex-lighting-rgb8-canonical-alpha-edge-mask-and-side-boundary-clip-geometry" &&
    schedule.comparison === "exact-three-canonical-point-rgb8-plus-remapped-edge-mask-and-side-boundary-clip-geometry-per-retained-triangle" &&
    schedule.cycleBoundaryPolicy === "force-all-faces-to-state-zero-on-each-360-state-wrap" &&
    Number.isSafeInteger(schedule.updateCount) && schedule.updateCount >= 1_200 &&
    Number.isFinite(schedule.meanUpdatesPerState) && schedule.meanUpdatesPerState > 0 &&
    Number.isSafeInteger(schedule.p95UpdatesPerState) && schedule.p95UpdatesPerState >= 0 &&
    Number.isSafeInteger(schedule.maximumUpdatesPerState) && schedule.maximumUpdatesPerState === 1_200 &&
    schedule.offsets?.length === 361 && schedule.offsets[0] === 0 && schedule.offsets[1] === 1_200 &&
    schedule.offsets.at(-1) === schedule.updateCount && schedule.offsets.every((value, index) =>
      Number.isSafeInteger(value) && value >= 0 && (index === 0 || value >= schedule.offsets[index - 1])) &&
    schedule.faceIndicesEncoding === "base64-u16le-state-major-updated-face-indices" &&
    schedule.faceIndicesByteLength === schedule.updateCount * 2 &&
    /^[a-f0-9]{64}$/u.test(schedule.faceIndicesSha256 ?? "") &&
    typeof schedule.faceIndicesBase64 === "string" && schedule.faceIndicesBase64.length > 0 &&
    schedule.runtimeSelection === "prepared-state-range-only-no-lighting-or-geometry-calculation";
}

function validPreparedFrontFacingSchedule(schedule) {
  return schedule?.schema === CSSFLOWER_FRONT_FACE_SCHEDULE_SCHEMA &&
    schedule.stateCount === 360 && schedule.faceCount === 1_200 &&
    schedule.dilationTicks === CSSFLOWER_FRONT_FACE_DILATION_TICKS &&
    schedule.selectionDomain === CSSFLOWER_VISIBILITY_POLICY.selectionDomain &&
    schedule.depthComparison === CSSFLOWER_VISIBILITY_POLICY.depthComparison &&
    schedule.minimumOwnedPixels === CSSFLOWER_VISIBILITY_POLICY.minimumOwnedPixels &&
    schedule.sampleGrid === CSSFLOWER_VISIBILITY_POLICY.sampleGrid &&
    schedule.adjacency === CSSFLOWER_VISIBILITY_POLICY.adjacency &&
    schedule.adjacencyRings === CSSFLOWER_VISIBILITY_POLICY.adjacencyRings &&
    schedule.dilationPolicy === CSSFLOWER_VISIBILITY_POLICY.dilationPolicy &&
    schedule.encoding === CSSFLOWER_FRONT_FACE_SCHEDULE_ENCODING &&
    schedule.bytesPerState === 150 && schedule.byteLength === schedule.stateCount * schedule.bytesPerState &&
    Number.isSafeInteger(schedule.selectedFaceCount) && schedule.selectedFaceCount > 0 &&
    schedule.selectedFaceCount < schedule.stateCount * schedule.faceCount &&
    schedule.suppressedFaceCount === schedule.stateCount * schedule.faceCount - schedule.selectedFaceCount &&
    schedule.meanSelectedFacesPerState === schedule.selectedFaceCount / schedule.stateCount &&
    Number.isSafeInteger(schedule.minimumSelectedFacesPerState) && schedule.minimumSelectedFacesPerState > 0 &&
    Number.isSafeInteger(schedule.maximumSelectedFacesPerState) &&
    schedule.maximumSelectedFacesPerState >= schedule.minimumSelectedFacesPerState &&
    schedule.maximumSelectedFacesPerState <= schedule.faceCount &&
    schedule.initialVisibilitySelectionCount === schedule.faceCount &&
    Number.isSafeInteger(schedule.visibilityChangeCount) && schedule.visibilityChangeCount > 0 &&
    /^[a-f0-9]{64}$/u.test(schedule.dataSha256 ?? "") &&
    typeof schedule.dataBase64 === "string" && schedule.dataBase64.length > 0 &&
    schedule.runtimeSelection === "prepared-bit-test-only-no-geometry-projection-normal-or-lighting-calculation";
}

function decodePreparedFrontFacingBytes(schedule) {
  let encoded;
  try {
    encoded = atob(schedule.dataBase64);
  } catch (error) {
    throw new Error(`Generated cssFlower front-face schedule encoding is invalid: ${error.message}`);
  }
  if (encoded.length !== schedule.byteLength) {
    throw new Error("Generated cssFlower front-face schedule byte length drifted.");
  }
  return Uint8Array.from(encoded, (character) => character.charCodeAt(0));
}

function decodePreparedLightingAddressBytes(schedule) {
  let encoded;
  try {
    encoded = atob(schedule.faceIndicesBase64);
  } catch (error) {
    throw new Error(`Generated cssFlower sparse-lighting address encoding is invalid: ${error.message}`);
  }
  if (encoded.length !== schedule.faceIndicesByteLength) {
    throw new Error("Generated cssFlower sparse-lighting address byte length drifted.");
  }
  return Uint8Array.from(encoded, (character) => character.charCodeAt(0));
}

async function fetchJson(url, { notFoundMessage = "" } = {}) {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404 && notFoundMessage) throw new Error(notFoundMessage);
    throw new Error("Failed to load " + url + ": " + response.status);
  }
  if (url.endsWith(".gz")) {
    const decoded = await decodedGzipResponseBytes(response);
    try {
      return JSON.parse(new TextDecoder().decode(decoded));
    } catch (error) {
      throw new Error(`Prepared cssFlower gzip JSON ${url} is invalid: ${error.message}`);
    }
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(notFoundMessage || ("Expected JSON from " + url + " but got " + (contentType || "unknown content type")));
  }
  return response.json();
}

async function fetchText(url, { notFoundMessage = "" } = {}) {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404 && notFoundMessage) throw new Error(notFoundMessage);
    throw new Error("Failed to load " + url + ": " + response.status);
  }
  if (url.endsWith(".gz")) {
    return new TextDecoder().decode(await decodedGzipResponseBytes(response));
  }
  return response.text();
}

async function decompressGzip(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot decode prepared cssFlower gzip assets.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodedGzipResponseBytes(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return (response.headers.get("content-encoding") ?? "").toLowerCase().includes("gzip")
    ? bytes
    : decompressGzip(bytes);
}

async function assertSha256(bytes, expected, label) {
  if (!/^[a-f0-9]{64}$/.test(expected ?? "")) throw new Error(`Generated cssFlower ${label} hash is missing.`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw new Error(`Generated cssFlower ${label} identity mismatch (${actual}).`);
}
