#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPolyMorphCatalog,
  buildPolyMorphPackage,
} from "@layoutit/polycss-morph";
import { formatMatrix3dValues } from "@layoutit/polycss";
import {
  buildGridClosingSegments,
  buildGridSegments,
  buildPreparedGridSegments,
  buildPreparedGravityWellBankStates,
  buildPreparedGravityWellTimeline,
  CSSGRAVITYWELL_SEEDS,
  PREPARED_MAX_BANK_FRAME_COUNT,
  preparedFoggedColorIndex,
  preparedFoggedColorPalette,
  preparedGridLineQuads,
} from "../src/prepare/cssgravitywell/sourceModel.mjs";
import {
  inspectCssgravitywellProductBank,
  writeCssgravitywellProductBankDescriptor,
} from "./productBank.mjs";
import {
  CSSGRAVITYWELL_VIEWPORT_DILATION_FRAMES,
  CSSGRAVITYWELL_VIEWPORT_MARGIN_PIXELS,
  CSSGRAVITYWELL_VISIBILITY_ENCODING,
  CSSGRAVITYWELL_VISIBILITY_SCHEMA,
  encodeGravityWellViewportVisibility,
  prepareGravityWellViewportVisibility,
} from "../src/prepare/cssgravitywell/visibilitySchedule.mjs";
import { CSSGRAVITYWELL_TRANSFORM_BLOCK_COUNT } from "../src/cssgravitywell/renderContract.mjs";

const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const outputRoot = join(repositoryRoot, "build/generated/public/cssgravitywell");
const stagingRoot = join(repositoryRoot, `build/generated/.cssgravitywell-${process.pid}`);
const MATRIX_DECIMAL_PLACES = 2;
const MATRIX_SCALE = 10 ** MATRIX_DECIMAL_PLACES;
const MATRIX_COMPONENTS = Object.freeze([0, 1, 2, 4, 5, 8, 9, 10, 12, 13, 14]);
const MATRIX_DATA_STREAM_COUNT = MATRIX_COMPONENTS.length * 2 + 1;
const MATRIX_STREAM_COUNT = MATRIX_DATA_STREAM_COUNT + 3;
const COLOR_ROWS_STREAM_INDEX = MATRIX_DATA_STREAM_COUNT;
const TRANSFORM_INDICES_STREAM_INDEX = COLOR_ROWS_STREAM_INDEX + 1;
const COLOR_INDICES_STREAM_INDEX = TRANSFORM_INDICES_STREAM_INDEX + 1;
const MATRIX_BLOCK_MAGIC = "CGWM";
const sourceRoot = process.env.CSSGRAVITYWELL_SOURCE_ROOT;
if (!sourceRoot) {
  throw new Error("Set CSSGRAVITYWELL_SOURCE_ROOT to the pinned XScreenSaver source checkout");
}

const sourceCommit = await readText(join(resolve(sourceRoot), ".git/HEAD"))
  .then(async (head) => head.startsWith("ref: ")
    ? readText(join(resolve(sourceRoot), ".git", head.slice(5).trim()))
    : head.trim())
  .catch(() => "");
const expectedCommit = "906693799e4fb7581436590cf84ecb2d3c9186ba";
if (sourceCommit.trim() !== expectedCommit) {
  throw new Error(`Gravity Well source commit drifted: expected ${expectedCommit}, received ${sourceCommit.trim() || "unknown"}`);
}

const primaryPath = join(resolve(sourceRoot), "hacks/glx/gravitywell.c");
const configPath = join(resolve(sourceRoot), "hacks/config/gravitywell.xml");
const primaryBytes = await readFile(primaryPath);
const configBytes = await readFile(configPath);
const primarySha256 = sha256(primaryBytes);
const configSha256 = sha256(configBytes);
if (primarySha256 !== "c41da7ba2ef0a1a2a4961f77a67103a744080961e8bff6caf1a36281a3523aef" ||
    configSha256 !== "d62de252e1b28babf1bfab0767c06b39734129ab2532643b1e87f94393610525") {
  throw new Error("Gravity Well source bytes drifted from the pinned source lock");
}

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
const canonicalStates = buildPreparedGravityWellBankStates({ seed: CSSGRAVITYWELL_SEEDS[0] });
const canonicalTimeline = buildPreparedGravityWellTimeline(canonicalStates);
const fixedViewQuaternion = canonicalStates.trackballQuaternion;
const fixedViewState = Object.freeze({ ...canonicalStates, trackballQuaternion: fixedViewQuaternion });
const nativeSegments = buildGridSegments(canonicalStates.gridWidth);
const closingSegments = buildGridClosingSegments(canonicalStates.gridWidth);
const segments = buildPreparedGridSegments(canonicalStates.gridWidth);
const flatDepths = Object.freeze(Array(canonicalStates.gridWidth ** 2).fill(0));
const baseQuads = preparedGridLineQuads(fixedViewState, flatDepths);
const preparedLeafCount = segments.length;
if (nativeSegments.length !== 1_922 || closingSegments.length !== 62 ||
    segments.length !== 1_984 || baseQuads.length !== preparedLeafCount) {
  throw new Error("Gravity Well prepared closed grid topology drifted");
}
const topologyVertices = baseQuads.flatMap((quad) => quad.points);
const topologyPolygons = baseQuads.map((quad, index) => ({
  id: `grid-line-${String(index).padStart(4, "0")}`,
  vertexIndices: [index * 4, index * 4 + 1, index * 4 + 2, index * 4 + 3],
  normalIndices: [0, 0, 0, 0],
}));
const shapeId = "shape-0000-gravitywell-grid";
const materialId = "material-0000-gravity-grid";
const staticModel = Object.freeze({
  schema: "polycss-morph.model@1",
  identity: Object.freeze({ id: "gravitywell", name: "Gravity Well", revision: "1.2.0" }),
  profile: "static-prepared",
  capabilities: Object.freeze(["retained-render"]),
  budgets: Object.freeze({
    maxVertices: topologyVertices.length,
    maxPolygons: preparedLeafCount,
    maxLeaves: preparedLeafCount,
    maxFrames: PREPARED_MAX_BANK_FRAME_COUNT,
    maxJoints: 0,
    maxResources: 1,
    maxBytes: 256 * 1024 * 1024,
  }),
  topology: Object.freeze({
    vertices: Object.freeze(topologyVertices),
    normals: Object.freeze([Object.freeze([0, 0, 1])]),
    polygons: Object.freeze(topologyPolygons),
  }),
  materials: Object.freeze([Object.freeze({ id: materialId, color: Object.freeze([0, 1, 0, 1]) })]),
  render: Object.freeze({
    modelMatrix: Object.freeze(identity()),
    shapes: Object.freeze([Object.freeze({ id: shapeId, matrix: Object.freeze(identity()) })]),
    leaves: Object.freeze(baseQuads.map((quad, index) => Object.freeze({
      id: `leaf-grid-line-${String(index).padStart(4, "0")}`,
      polygonId: topologyPolygons[index].id,
      shapeId,
      materialId,
      strategy: "solid-quad",
      width: quad.width,
      height: quad.height,
      matrix: Object.freeze(quadMatrix(quad, index)),
      atlas: null,
      fallback: null,
    }))),
  }),
  deformation: Object.freeze({ kind: "none" }),
  controls: Object.freeze([]),
  springs: Object.freeze([]),
  animations: Object.freeze([]),
  playback: null,
  provenance: Object.freeze({
    generator: "cssgravitywell-preparer",
    generatorVersion: "1.0.0",
    sources: Object.freeze([Object.freeze({
      id: "xscreensaver-gravitywell",
      kind: "open-data",
      uri: "https://github.com/Zygo/xscreensaver/blob/906693799e4fb7581436590cf84ecb2d3c9186ba/hacks/glx/gravitywell.c",
      sha256: primarySha256,
      license: "XScreenSaver gravitywell.c permissive notice",
    })]),
  }),
});
const palette = preparedFoggedColorPalette();
const paletteDecoded = Buffer.from(`${palette.join("\n")}\n`);
const paletteEncoded = gzipSync(paletteDecoded, { level: 9, mtime: 0 });
const modelRoot = join(stagingRoot, "model");
const packageRoot = join(modelRoot, "gravitywell");
await mkdir(packageRoot, { recursive: true });
const builtPackage = await buildPolyMorphPackage(staticModel, []);
const sourceModelPath = builtPackage.manifest.modelPath;
const sourceModelBytes = builtPackage.files.get(sourceModelPath);
if (!(sourceModelBytes instanceof Uint8Array) || builtPackage.files.size !== 1) {
  throw new Error("Gravity Well prepared model package closure drifted");
}
const packedModelPath = `${sourceModelPath}.br`;
const packedModelBytes = brotliCompressSync(sourceModelBytes, {
  params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
});
const packedManifest = Object.freeze({
  ...builtPackage.manifest,
  modelPath: packedModelPath,
  resources: Object.freeze(builtPackage.manifest.resources.map((resource) => Object.freeze({
    ...resource,
    path: resource.path === sourceModelPath ? packedModelPath : resource.path,
  }))),
});
const packedManifestBytes = Buffer.from(`${JSON.stringify(packedManifest)}\n`);
const packedManifestSha256 = sha256(packedManifestBytes);
await writeBytes(join(packageRoot, packedModelPath), packedModelBytes);
await writeBytes(join(packageRoot, "manifest.json"), packedManifestBytes);
const modelCatalog = await buildPolyMorphCatalog("gravitywell", [{
  manifest: packedManifest,
  manifestPath: "gravitywell/manifest.json",
  manifestSha256: packedManifestSha256,
}]);
await writeBytes(join(modelRoot, "catalog.json"), modelCatalog.bytes);

const entries = [];
const bankMetrics = [];
for (let bankIndex = 0; bankIndex < CSSGRAVITYWELL_SEEDS.length; bankIndex += 1) {
  const seed = CSSGRAVITYWELL_SEEDS[bankIndex];
  const result = await prepareBank({ bankIndex, seed, fixedViewQuaternion });
  entries.push(result.entry);
  bankMetrics.push(result.metrics);
}
const flatStateSha256 = entries[0].flatStateSha256;
if (entries.some((entry) => entry.flatStateSha256 !== flatStateSha256)) {
  throw new Error("Gravity Well prepared banks do not share an exact flat boundary");
}
const bankCatalog = Object.freeze({
  schema: "cssgravitywell-prepared-bank-catalog@1",
  bankCount: entries.length,
  selection: "crypto-random-initial-then-shuffle-without-replacement",
  modelPackageRoot: "/cssgravitywell/model/",
  fixedViewSeed: CSSGRAVITYWELL_SEEDS[0],
  flatStateSha256,
  colorPaletteAsset: Object.freeze({
    distribution: "embedded-prepared-bank-catalog",
    byteLength: paletteEncoded.byteLength,
    sha256: sha256(paletteEncoded),
    decodedByteLength: paletteDecoded.byteLength,
    entryCount: palette.length,
    encodedBase64: paletteEncoded.toString("base64"),
    encoding: "gzip-newline-utf8-prepared-css-colors",
  }),
  source: Object.freeze({
    project: "XScreenSaver Gravity Well",
    commit: expectedCommit,
    primaryPath: "hacks/glx/gravitywell.c",
    primarySha256,
    configPath: "hacks/config/gravitywell.xml",
    configSha256,
  }),
  entries: Object.freeze(entries),
});
await writeFile(join(stagingRoot, "catalog.json"), `${JSON.stringify(bankCatalog)}\n`);
const productBank = await inspectCssgravitywellProductBank(stagingRoot, { verifyDescriptor: false });
await writeCssgravitywellProductBankDescriptor(stagingRoot, productBank);
await inspectCssgravitywellProductBank(stagingRoot);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(dirname(outputRoot), { recursive: true });
await rename(stagingRoot, outputRoot);
console.log(JSON.stringify({
  status: "prepared",
  outputRoot,
  bankCount: entries.length,
  seedCount: CSSGRAVITYWELL_SEEDS.length,
  minimumFrameCountPerBank: Math.min(...bankMetrics.map((metrics) => metrics.frameCount)),
  maximumFrameCountPerBank: Math.max(...bankMetrics.map((metrics) => metrics.frameCount)),
  leafCount: preparedLeafCount,
  transformBlockCount: bankMetrics.reduce((sum, metrics) => sum + metrics.transformBlockCount, 0),
  transformEncodedBytes: bankMetrics.reduce((sum, metrics) => sum + metrics.transformEncodedBytes, 0),
  transformDecodedBytes: bankMetrics.reduce((sum, metrics) => sum + metrics.transformDecodedBytes, 0),
  sparseColorValueBytes: bankMetrics.reduce((sum, metrics) => sum + metrics.sparseColorValueBytes, 0),
  deltaIndexBytes: bankMetrics.reduce((sum, metrics) => sum + metrics.deltaIndexBytes, 0),
  meanSequentialTransformWriteCount: bankMetrics.reduce((sum, metrics) => sum + metrics.meanTransformWrites, 0) / bankMetrics.length,
  meanSequentialColorWriteCount: bankMetrics.reduce((sum, metrics) => sum + metrics.meanColorWrites, 0) / bankMetrics.length,
  viewportVisibilityEncodedBytes: bankMetrics.reduce((sum, metrics) => sum + metrics.viewportVisibilityEncodedBytes, 0),
  modelManifestSha256: packedManifestSha256,
  productClosureSha256: productBank.closureSha256,
  productClosureBytes: productBank.closureBytes,
  productFileCount: productBank.fileCount,
}, null, 2));

async function prepareBank({ bankIndex, seed, fixedViewQuaternion }) {
  const bankId = `seed-${String(bankIndex).padStart(2, "0")}`;
  const bankRoot = join(stagingRoot, "banks", bankId);
  const assetUrlRoot = `/cssgravitywell/banks/${bankId}`;
  await mkdir(bankRoot, { recursive: true });
  const sourceStates = buildPreparedGravityWellBankStates({ seed });
  const timeline = buildPreparedGravityWellTimeline(sourceStates);
  const renderState = Object.freeze({ ...sourceStates, trackballQuaternion: fixedViewQuaternion });
  const quadsByFrame = timeline.frames.map((frame) => preparedGridLineQuads(
    renderState,
    frame.depths,
    2,
    frame.opacityDepths,
  ));
  if (quadsByFrame.some((quads) => quads.length !== preparedLeafCount)) {
    throw new Error(`Gravity Well bank ${bankId} topology drifted`);
  }
  const viewportVisibility = prepareGravityWellViewportVisibility(quadsByFrame, {
    gridWidth: sourceStates.gridWidth,
  });
  const viewportVisibilityDecoded = encodeGravityWellViewportVisibility(viewportVisibility);
  const viewportVisibilityEncoded = gzipSync(viewportVisibilityDecoded, { level: 9, mtime: 0 });
  const formattedTransformsByFrame = quadsByFrame.map((quads, frameIndex) => quads.map((quad, index) =>
    `matrix3d(${formatMatrix3dValues(quadMatrix(quad, index, frameIndex), MATRIX_DECIMAL_PLACES)})`));
  const colorRows = new Uint16Array(timeline.frameCount * preparedLeafCount);
  for (let frameIndex = 0; frameIndex < timeline.frameCount; frameIndex += 1) {
    for (let leafIndex = 0; leafIndex < preparedLeafCount; leafIndex += 1) {
      const quad = quadsByFrame[frameIndex][leafIndex];
      colorRows[frameIndex * preparedLeafCount + leafIndex] = preparedFoggedColorIndex(
        quad.colorDepth,
        quad.opacityDepth,
        quad.eyeDepth,
      );
    }
  }
  const frameStateSha256 = (frameIndex) => sha256(Buffer.concat([
    Buffer.from(`${formattedTransformsByFrame[frameIndex].join("\n")}\n`),
    Buffer.from(
      colorRows.buffer,
      colorRows.byteOffset + frameIndex * preparedLeafCount * Uint16Array.BYTES_PER_ELEMENT,
      preparedLeafCount * Uint16Array.BYTES_PER_ELEMENT,
    ),
  ]));
  const flatStateSha256 = frameStateSha256(0);
  if (frameStateSha256(timeline.terminalFlatFrameIndex) !== flatStateSha256) {
    throw new Error(`Gravity Well bank ${bankId} does not close on its opening flat state`);
  }
  const transformChangeOffsets = new Uint32Array(timeline.frameCount + 1);
  const colorChangeOffsets = new Uint32Array(timeline.frameCount + 1);
  const changedTransformLeafIndices = [];
  const changedColorLeafIndices = [];
  for (let frameIndex = 0; frameIndex < timeline.frameCount; frameIndex += 1) {
    const previousFrameIndex = (frameIndex + timeline.frameCount - 1) % timeline.frameCount;
    const currentTransforms = formattedTransformsByFrame[frameIndex];
    const previousTransforms = formattedTransformsByFrame[previousFrameIndex];
    const currentColorOffset = frameIndex * preparedLeafCount;
    const previousColorOffset = previousFrameIndex * preparedLeafCount;
    transformChangeOffsets[frameIndex] = changedTransformLeafIndices.length;
    colorChangeOffsets[frameIndex] = changedColorLeafIndices.length;
    for (let leafIndex = 0; leafIndex < preparedLeafCount; leafIndex += 1) {
      if (currentTransforms[leafIndex] !== previousTransforms[leafIndex]) changedTransformLeafIndices.push(leafIndex);
      if (colorRows[currentColorOffset + leafIndex] !== colorRows[previousColorOffset + leafIndex]) {
        changedColorLeafIndices.push(leafIndex);
      }
    }
  }
  transformChangeOffsets[timeline.frameCount] = changedTransformLeafIndices.length;
  colorChangeOffsets[timeline.frameCount] = changedColorLeafIndices.length;
  const transformChangeIndices = Uint16Array.from(changedTransformLeafIndices);
  const colorChangeIndices = Uint16Array.from(changedColorLeafIndices);
  const changeIndices = new Uint16Array(transformChangeIndices.length + colorChangeIndices.length);
  changeIndices.set(transformChangeIndices, 0);
  changeIndices.set(colorChangeIndices, transformChangeIndices.length);
  const changeBytes = new Uint8Array(changeIndices.buffer, changeIndices.byteOffset, changeIndices.byteLength);
  const encodedTransformIndices = encodePreparedIndexRows(transformChangeIndices, transformChangeOffsets);
  const encodedColorIndices = encodePreparedIndexRows(colorChangeIndices, colorChangeOffsets);

  // Match the sibling adapters' prepared transport boundary: content-addressed
  // chunks contain one local keyframe plus sparse prepared deltas. Unlike the
  // old textual rows, this packet stores the already-rounded matrix components
  // as field-major fixed-point varints. The loader expands the final CSS strings
  // once per block; the frame loop still performs selection and publication only.
  const blockCount = CSSGRAVITYWELL_TRANSFORM_BLOCK_COUNT;
  const blockFrameCount = Math.ceil(timeline.frameCount / blockCount);
  const blocks = [];
  const transformAssetRoot = join(stagingRoot, "assets/transforms");
  await mkdir(transformAssetRoot, { recursive: true });
  for (let startFrameIndex = 0, blockIndex = 0; startFrameIndex < timeline.frameCount;
    startFrameIndex += blockFrameCount, blockIndex += 1) {
    const endFrameIndex = Math.min(timeline.frameCount, startFrameIndex + blockFrameCount);
    const transformChangeStart = transformChangeOffsets[startFrameIndex];
    const transformChangeEnd = transformChangeOffsets[endFrameIndex];
    const colorChangeStart = colorChangeOffsets[startFrameIndex];
    const colorChangeEnd = colorChangeOffsets[endFrameIndex];
    const keyframeTransforms = formattedTransformsByFrame[startFrameIndex];
    const deltaTransforms = [];
    const deltaLeafIndices = [];
    for (let frameIndex = startFrameIndex; frameIndex < endFrameIndex; frameIndex += 1) {
      for (let changeIndex = transformChangeOffsets[frameIndex];
        changeIndex < transformChangeOffsets[frameIndex + 1]; changeIndex += 1) {
        const leafIndex = transformChangeIndices[changeIndex];
        deltaLeafIndices.push(leafIndex);
        deltaTransforms.push(formattedTransformsByFrame[frameIndex][leafIndex]);
      }
    }
    const colorValues = new Uint16Array(preparedLeafCount + colorChangeEnd - colorChangeStart);
    colorValues.set(colorRows.subarray(
      startFrameIndex * preparedLeafCount,
      (startFrameIndex + 1) * preparedLeafCount,
    ));
    let colorValueIndex = preparedLeafCount;
    for (let frameIndex = startFrameIndex; frameIndex < endFrameIndex; frameIndex += 1) {
      for (let changeIndex = colorChangeOffsets[frameIndex];
        changeIndex < colorChangeOffsets[frameIndex + 1]; changeIndex += 1) {
        colorValues[colorValueIndex] = colorRows[
          frameIndex * preparedLeafCount + colorChangeIndices[changeIndex]
        ];
        colorValueIndex += 1;
      }
    }
    const decoded = encodePreparedTransformBlock({
      keyframeTransforms,
      deltaTransforms,
      deltaLeafIndices,
      blockData: {
        colorValues,
        transformIndexBytes: blockIndex === 0 ? encodedTransformIndices : null,
        colorIndexBytes: blockIndex === 0 ? encodedColorIndices : null,
      },
    });
    const encoded = gzipSync(decoded, { level: 9, mtime: 0 });
    const digest = sha256(encoded);
    const assetName = `block-${digest}.matrix3d.pack`;
    await writeFile(join(transformAssetRoot, assetName), encoded);
    blocks.push(Object.freeze({
      schema: "cssgravitywell-sparse-transform-block@1",
      index: blockIndex,
      startFrameIndex,
      frameCount: endFrameIndex - startFrameIndex,
      keyframeTransformCount: preparedLeafCount,
      deltaTransformCount: transformChangeEnd - transformChangeStart,
      transformChangeStart,
      transformChangeEnd,
      colorChangeStart,
      colorChangeEnd,
      colorValueCount: colorValues.length,
      transformCount: keyframeTransforms.length + deltaTransforms.length,
      assetUrl: `/cssgravitywell/assets/transforms/${assetName}`,
      byteLength: encoded.byteLength,
      sha256: digest,
      decodedByteLength: decoded.byteLength,
      preparedCssStringByteLength: [...keyframeTransforms, ...deltaTransforms]
        .reduce((sum, transform) => sum + Buffer.byteLength(transform), 0),
      matrixDecimalPlaces: MATRIX_DECIMAL_PLACES,
      matrixVariableComponents: MATRIX_COMPONENTS,
      encoding: "gzip-field-major-delta-varint-fixed2-matrix-and-bank-schedule@2",
    }));
  }

  const scene = Object.freeze({
    schema: "cssgravitywell-prepared-bank@1",
    bankIndex,
    bankId,
    seed,
    source: bankCatalogSource(seed, sourceStates.sourceFrameCount),
    profile: sourceStates.sourceProfile,
    view: Object.freeze({ fixedAcrossBanks: true, sourceSeed: CSSGRAVITYWELL_SEEDS[0], trackballQuaternion: fixedViewQuaternion }),
    timeline: Object.freeze({
      schema: timeline.schema,
      frameCount: timeline.frameCount,
      sourceFrameStartIndex: timeline.sourceFrameStartIndex,
      sourceFrameEndIndex: timeline.sourceFrameEndIndex,
      drainFrameStartIndex: timeline.drainFrameStartIndex,
      allWellsCompleteFrameIndex: timeline.allWellsCompleteFrameIndex,
      terminalFlatFrameIndex: timeline.terminalFlatFrameIndex,
      transitionFrameCount: timeline.transitionFrameCount,
      flatHoldFrameCount: timeline.flatHoldFrameCount,
      firstAndLastGroundFlat: timeline.firstAndLastGroundFlat,
      allWellsCompleteBeforeSwitch: timeline.allWellsCompleteBeforeSwitch,
      switchPreparedBankAtEnd: timeline.switchPreparedBankAtEnd,
      drainFrameCount: sourceStates.drainFrameCount,
      drainFrameBudget: sourceStates.drainFrameBudget,
      drainMode: sourceStates.drainMode,
      wellDrainFrameCounts: sourceStates.wellDrainFrameCounts,
      maximumWellDrainFrameCount: sourceStates.maximumWellDrainFrameCount,
      flatStateSha256,
    }),
    playback: Object.freeze({
      schema: "cssgravitywell-sparse-transform-block-playback@1",
      frameCount: timeline.frameCount,
      sourceTicksPerSecond: sourceStates.sourceTicksPerSecond,
      frameMilliseconds: 1_000 / sourceStates.sourceTicksPerSecond,
      loop: false,
      leafCount: preparedLeafCount,
      blockFrameCount,
      blockCount: blocks.length,
      runtimeLookaheadBlockCount: 1,
      blocks: Object.freeze(blocks),
      colorAsset: Object.freeze({
        distribution: "prepared-transform-blocks",
        decodedByteLength: blocks.reduce((sum, block) => sum + block.colorValueCount * 2, 0),
        encoding: "uint16le-block-keyframe-then-frame-major-sparse-fogged-palette-index",
        paletteSource: "prepared-bank-catalog",
      }),
      changeAsset: Object.freeze({
        distribution: "prepared-transform-block-0",
        decodedByteLength: changeBytes.byteLength,
        encoding: "frame-major-reset-delta-varint-transform-indices-then-color-indices",
        transformOffsets: Object.freeze(Array.from(transformChangeOffsets)),
        colorOffsets: Object.freeze(Array.from(colorChangeOffsets)),
        transformChangedLeafIndexCount: transformChangeIndices.length,
        colorChangedLeafIndexCount: colorChangeIndices.length,
      }),
      visibilityAsset: Object.freeze({
        schema: CSSGRAVITYWELL_VISIBILITY_SCHEMA,
        distribution: "embedded-prepared-bank-scene",
        byteLength: viewportVisibilityEncoded.byteLength,
        sha256: sha256(viewportVisibilityEncoded),
        decodedByteLength: viewportVisibilityDecoded.byteLength,
        encodedBase64: viewportVisibilityEncoded.toString("base64"),
        encoding: CSSGRAVITYWELL_VISIBILITY_ENCODING,
        selection: viewportVisibility.selection,
        frameCount: viewportVisibility.frameCount,
        leafCount: viewportVisibility.leafCount,
        marginPixels: CSSGRAVITYWELL_VIEWPORT_MARGIN_PIXELS,
        dilationFrames: CSSGRAVITYWELL_VIEWPORT_DILATION_FRAMES,
        profileDimensions: Object.freeze(viewportVisibility.profiles.map((profile) => Object.freeze({
          width: profile.width,
          height: profile.height,
        }))),
        profiles: Object.freeze(viewportVisibility.profiles.map((profile) => Object.freeze({
          width: profile.width,
          height: profile.height,
          initialVisibleCount: profile.initialVisibleIndices.length,
          visibilityChangeCount: profile.assignments.length,
          meanVisibleCount: profile.meanVisibleCount,
          minimumVisibleCount: profile.minimumVisibleCount,
          maximumVisibleCount: profile.maximumVisibleCount,
        }))),
      }),
    }),
    metrics: Object.freeze({
      sourceVertexCount: sourceStates.gridWidth ** 2,
      sourceCellCount: sourceStates.gridCellCount ** 2,
      sourceCoarseGridSegmentCount: nativeSegments.length,
      preparedClosingEdgeSegmentCount: closingSegments.length,
      preparedSolidQuadCount: preparedLeafCount,
      preparedLeafCount,
      preparedFrameCount: timeline.frameCount,
      runtimeGeometryConstructionCount: 0,
      runtimeTopologyConstructionCount: 0,
      runtimeColorCalculationCount: 0,
      runtimeAffineEvaluationCount: 0,
      runtimeDomGrowth: false,
      preparedViewportProfileCount: viewportVisibility.profiles.length,
      preparedMinimumMeanVisibleLeafCount: Math.min(...viewportVisibility.profiles.map((profile) => profile.meanVisibleCount)),
      preparedMaximumMeanVisibleLeafCount: Math.max(...viewportVisibility.profiles.map((profile) => profile.meanVisibleCount)),
    }),
    proof: Object.freeze({
      stableTopology: true,
      sourceOrderedGridSegments: true,
      preparedGridClosesSourceOuterEdges: true,
      retainedSolidQuadLines: true,
      fixedPreparedCameraAcrossBanks: true,
      firstAndLastGroundFlat: true,
      allWellsCompleteBeforeSwitch: true,
      perWellPreparedDrainAfterNativeSourceWindow: true,
      sequentialPublicationUsesSeparatePreparedWriteIndices: true,
      transformBlocksUsePreparedKeyframesAndSparseDeltas: true,
      transformBlocksAreContentAddressed: true,
      transformBlocksExpandFinalCssStringsOnlyAtBlockLoad: true,
      colorAndChangeAssetsShareSelectedBankTransformBlockZero: true,
      colorsPreparedBySourceDepth: true,
      viewportVisibilityIsPrepared: true,
      viewportVisibilityHasNoRuntimeProjection: true,
    }),
  });
  const sceneBytes = Buffer.from(`${JSON.stringify(scene)}\n`);
  await writeFile(join(bankRoot, "scene.json"), sceneBytes);
  return Object.freeze({
    entry: Object.freeze({
      index: bankIndex,
      id: bankId,
      seed,
      sceneUrl: `${assetUrlRoot}/scene.json`,
      sceneByteLength: sceneBytes.byteLength,
      sceneSha256: sha256(sceneBytes),
      flatStateSha256,
    }),
    metrics: Object.freeze({
      frameCount: timeline.frameCount,
      transformBlockCount: blocks.length,
      transformEncodedBytes: blocks.reduce((sum, block) => sum + block.byteLength, 0),
      transformDecodedBytes: blocks.reduce((sum, block) => sum + block.decodedByteLength, 0),
      sparseColorValueBytes: blocks.reduce((sum, block) => sum + block.colorValueCount * 2, 0),
      deltaIndexBytes: encodedTransformIndices.byteLength + encodedColorIndices.byteLength,
      meanTransformWrites: transformChangeIndices.length / timeline.frameCount,
      meanColorWrites: colorChangeIndices.length / timeline.frameCount,
      viewportVisibilityEncodedBytes: viewportVisibilityEncoded.byteLength,
    }),
  });
}

function encodePreparedTransformBlock({ keyframeTransforms, deltaTransforms, deltaLeafIndices, blockData }) {
  if (keyframeTransforms.length !== preparedLeafCount ||
      deltaTransforms.length !== deltaLeafIndices.length) {
    throw new Error("Gravity Well prepared transform block rows drifted");
  }
  const componentCount = MATRIX_COMPONENTS.length;
  const streams = Array.from({ length: MATRIX_STREAM_COUNT }, () => []);
  const state = new Int32Array(preparedLeafCount * componentCount);
  const keyframes = keyframeTransforms.map(parsePreparedTransform);
  for (let component = 0; component < componentCount; component += 1) {
    let previous = 0;
    for (let leafIndex = 0; leafIndex < keyframes.length; leafIndex += 1) {
      const value = keyframes[leafIndex][component];
      appendSignedVarint(streams[component], value - previous);
      state[leafIndex * componentCount + component] = value;
      previous = value;
    }
  }
  const maskStream = streams[componentCount];
  for (let rowIndex = 0; rowIndex < deltaTransforms.length; rowIndex += 1) {
    const leafIndex = deltaLeafIndices[rowIndex];
    const values = parsePreparedTransform(deltaTransforms[rowIndex]);
    const stateOffset = leafIndex * componentCount;
    let mask = 0;
    for (let component = 0; component < componentCount; component += 1) {
      if (values[component] !== state[stateOffset + component]) mask |= 1 << component;
    }
    maskStream.push(mask & 0xff, mask >>> 8);
    for (let component = 0; component < componentCount; component += 1) {
      if ((mask & (1 << component)) === 0) continue;
      const value = values[component];
      appendSignedVarint(
        streams[componentCount + 1 + component],
        value - state[stateOffset + component],
      );
      state[stateOffset + component] = value;
    }
  }
  appendTypedArrayBytes(streams[COLOR_ROWS_STREAM_INDEX], blockData.colorValues);
  if (blockData.transformIndexBytes) appendBytes(streams[TRANSFORM_INDICES_STREAM_INDEX], blockData.transformIndexBytes);
  if (blockData.colorIndexBytes) appendBytes(streams[COLOR_INDICES_STREAM_INDEX], blockData.colorIndexBytes);
  const header = Buffer.alloc(8 + MATRIX_STREAM_COUNT * Uint32Array.BYTES_PER_ELEMENT);
  header.write(MATRIX_BLOCK_MAGIC, 0, "ascii");
  header[4] = 2;
  header[5] = MATRIX_DECIMAL_PLACES;
  header[6] = componentCount;
  header[7] = MATRIX_STREAM_COUNT;
  for (let streamIndex = 0; streamIndex < streams.length; streamIndex += 1) {
    header.writeUInt32LE(streams[streamIndex].length, 8 + streamIndex * 4);
  }
  return Buffer.concat([header, ...streams.map((stream) => Buffer.from(stream))]);
}

function appendTypedArrayBytes(target, values) {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  for (const byte of bytes) target.push(byte);
}

function appendBytes(target, bytes) {
  for (const byte of bytes) target.push(byte);
}

function encodePreparedIndexRows(indices, offsets) {
  const bytes = [];
  for (let frameIndex = 0; frameIndex < offsets.length - 1; frameIndex += 1) {
    let previous = 0;
    for (let index = offsets[frameIndex]; index < offsets[frameIndex + 1]; index += 1) {
      const value = indices[index];
      appendUnsignedVarint(bytes, value - previous);
      previous = value;
    }
  }
  return Uint8Array.from(bytes);
}

function appendUnsignedVarint(target, value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError("Gravity Well prepared leaf-index delta is outside uint16");
  }
  while (value >= 0x80) {
    target.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  target.push(value);
}

function parsePreparedTransform(transform) {
  if (typeof transform !== "string" || !transform.startsWith("matrix3d(") || !transform.endsWith(")")) {
    throw new Error("Gravity Well prepared matrix string drifted");
  }
  const values = transform.slice(9, -1).split(",");
  if (values.length !== 16 || values.some((value) => !Number.isFinite(Number(value))) ||
      values[3] !== "0" || values[6] !== "0" || values[7] !== "0" ||
      values[11] !== "0" || values[15] !== "1") {
    throw new Error("Gravity Well prepared matrix affine constants drifted");
  }
  return Int32Array.from(MATRIX_COMPONENTS, (component) => {
    const scaled = Math.round(Number(values[component]) * MATRIX_SCALE);
    return Object.is(scaled, -0) ? 0 : scaled;
  });
}

function appendSignedVarint(target, value) {
  if (!Number.isSafeInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new RangeError("Gravity Well prepared fixed-point matrix delta is outside int32");
  }
  let encoded = value >= 0 ? value * 2 : (-value * 2) - 1;
  while (encoded >= 0x80) {
    target.push((encoded % 0x80) | 0x80);
    encoded = Math.floor(encoded / 0x80);
  }
  target.push(encoded);
}

function bankCatalogSource(seed, frameCount) {
  return Object.freeze({
    project: "XScreenSaver Gravity Well",
    commit: expectedCommit,
    primaryPath: "hacks/glx/gravitywell.c",
    primarySha256,
    configPath: "hacks/config/gravitywell.xml",
    configSha256,
    seed,
    frameCount,
  });
}

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function quadMatrix(quad, index = -1, frameIndex = 0) {
  const [origin, along, opposite, across] = quad.points;
  const xVector = subtract(along, origin);
  const yVector = subtract(across, origin);
  const xLength = Math.hypot(...xVector);
  const yLength = Math.hypot(...yVector);
  const xAxis = xVector.map((value) => value / xLength);
  const yAxis = yVector.map((value) => value / yLength);
  const normal = normalize(cross(xAxis, yAxis));
  const planarDelta = [opposite[0] - origin[0], opposite[1] - origin[1], opposite[2] - origin[2]];
  const nonPlanarity = Math.abs(dot(normal, planarDelta));
  const maximumSpan = Math.max(xLength, yLength, Math.hypot(...planarDelta));
  if (!Number.isFinite(nonPlanarity) || nonPlanarity / maximumSpan > 1e-6) {
    throw new Error("Prepared Gravity Well line quad is not planar");
  }
  return [
    xVector[0] / quad.width, xVector[1] / quad.width, xVector[2] / quad.width, 0,
    yVector[0] / quad.height, yVector[1] / quad.height, yVector[2] / quad.height, 0,
    normal[0], normal[1], normal[2], 0,
    origin[0], origin[1], origin[2], 1,
  ];
}

function subtract(left, right) {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length <= 1e-12) throw new Error("Prepared Gravity Well line quad is degenerate");
  return vector.map((value) => value / length);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function readText(path) {
  return readFile(path, "utf8");
}
