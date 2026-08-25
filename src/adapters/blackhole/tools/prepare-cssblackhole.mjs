#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { endianness } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import sourceLock from "../notes/references/source-lock.json" with { type: "json" };
import {
  CSSBLACKHOLE_BANK_ENCODING,
  CSSBLACKHOLE_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS,
  CSSBLACKHOLE_OPACITY_ENCODING,
  CSSBLACKHOLE_OPACITY_PALETTE,
  encodeBlackHolePreparedBank,
  formatBlackHolePreparedTransform,
  quantizeBlackHolePreparedOpacityIndex,
} from "../src/shared/cssblackhole/preparedBlockTransport.mjs";
import {
  CSSBLACKHOLE_DIRECT_IMAGE_DOT_COLORS,
  CSSBLACKHOLE_GALACTIC_DOT_COLORS,
  CSSBLACKHOLE_GHOST_IMAGE_DOT_COLORS,
  preparedBlackHoleColorAt,
} from "../src/shared/cssblackhole/preparedColorPresentation.mjs";
import { selectNonOverlappingLuminetPointFrames } from "./select-luminet-points.mjs";
import { prepareBlackHoleSpaceContext } from "./prepare-space-context.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const generatedPublicDir = resolve(process.env.CSSBLACKHOLE_GENERATED_PUBLIC_DIR ??
  resolve(repositoryRoot, "build/generated/public"));
const outputRoot = resolve(generatedPublicDir, "cssblackhole");
const stagingRoot = resolve(generatedPublicDir, `.cssblackhole-${process.pid}`);
const banksRoot = resolve(stagingRoot, "banks");
const sourceRoot = resolve(repositoryRoot, `.local/sources/luminet-${sourceLock.commit.slice(0, 7)}`);
const venvRoot = resolve(repositoryRoot, `.local/venvs/luminet-${sourceLock.commit.slice(0, 7)}`);
const pythonPath = process.env.CSSBLACKHOLE_PYTHON || resolve(venvRoot, "bin/python");
const coordinatePath = resolve(repositoryRoot, ".local/cache/cssblackhole-luminet-coordinates.bin");
const luminancePath = resolve(repositoryRoot, ".local/cache/cssblackhole-luminet-luminance.bin");
const stateMetadataPath = resolve(repositoryRoot, ".local/cache/cssblackhole-luminet-state.json");
const oraclePpmPath = resolve(repositoryRoot, "build/oracle/cssblackhole/luminet-frame-0000.ppm");
const transportSeed = 6477;
const sourcePointCount = 3000;
const sourceDirectPointCount = 2000;
const sourceGhostPointCount = 1000;
const starCount = 1979;
const directPointCount = 1319;
const ghostPointCount = 660;
const expectedPeriodicOrbitCounts = Object.freeze([
  9, 10, 11, 12, 13, 14, 16, 19, 22, 25, 29, 35, 43, 54, 70, 97,
]);
const configurationCount = 3;
const presentationConfigurationCount = 4;
const sourceFramesPerSecond = 60;
const framesPerSecond = 60;
const sourceFrameStep = sourceFramesPerSecond / framesPerSecond;
const frameMilliseconds = 1000 / framesPerSecond;
const blockFrameCount = 300 / sourceFrameStep;
const blocksPerBank = 1;
const bankFrameCount = blockFrameCount * blocksPerBank;
const bankCount = 36;
const blockCount = bankCount * blocksPerBank;
const streamFrameCount = bankCount * bankFrameCount;
const preparedOpacityPalette = CSSBLACKHOLE_OPACITY_PALETTE;

if (endianness() !== "LE") throw new Error("Luminet preparation requires little endian");
await ensurePinnedSource();
await mkdir(resolve(repositoryRoot, ".local/cache"), { recursive: true });
await mkdir(resolve(repositoryRoot, "build/oracle/cssblackhole"), { recursive: true });
let cached = await readPreparedSourceState();
let reusedPreparedSourceCache = cached !== null && process.env.CSSBLACKHOLE_FORCE_SOURCE !== "1";
if (process.env.CSSBLACKHOLE_FORCE_SOURCE === "1" || cached === null) {
  await ensurePythonEnvironment();
  await runPythonPreparation();
  cached = await readPreparedSourceState();
  reusedPreparedSourceCache = false;
}
if (cached === null) throw new Error("Pinned Luminet source preparation did not produce valid state");
const { sourceState, coordinateBytes, luminanceBytes } = cached;
const coordinates = new Int32Array(
  coordinateBytes.buffer, coordinateBytes.byteOffset, coordinateBytes.byteLength / 4);
const luminances = new Uint8Array(
  luminanceBytes.buffer, luminanceBytes.byteOffset, luminanceBytes.byteLength);
const pointSelectionResult = selectNonOverlappingLuminetPointFrames({
  coordinates,
  frameCount: sourceState.frameCount,
  sourcePointCount,
  sourceDirectPointCount,
  sourceGhostPointCount,
  selectedDirectPointCount: directPointCount,
  selectedGhostPointCount: ghostPointCount,
});
const selectedSourcePointIndices = pointSelectionResult.sourcePointIndices;
const selectedDirectOrbitCounts = selectedSourcePointIndices.slice(0, directPointCount)
  .map((sourceIndex) => sourceState.particlePeriodicOrbitCounts[sourceIndex]);
const selectedGhostOrbitCounts = selectedSourcePointIndices.slice(directPointCount)
  .map((sourceIndex) => sourceState.particlePeriodicOrbitCounts[sourceIndex]);
const selectedCoordinates = pointSelectionResult.selectedCoordinates;
const selectedLuminances = selectSourcePoints(
  luminances, sourceState.frameCount, sourcePointCount, 1, selectedSourcePointIndices);

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(banksRoot, { recursive: true });
const spaceContext = await prepareBlackHoleSpaceContext(stagingRoot, {
  selectedCoordinates,
  starCount,
  sourceState,
});
const banks = [];
for (let bankIndex = 0; bankIndex < bankCount; bankIndex += 1) {
  const sourceBankFrameCount = bankFrameCount * sourceFrameStep;
  const sourceLoopStartFrameIndex = bankIndex * sourceBankFrameCount % sourceState.frameCount;
  const bankCoordinates = selectSourceFrames(
    selectedCoordinates, sourceLoopStartFrameIndex, bankFrameCount, starCount * 2, sourceFrameStep,
    sourceState.frameCount);
  const bankLuminances = selectSourceFrames(
    selectedLuminances, sourceLoopStartFrameIndex, bankFrameCount, starCount, sourceFrameStep,
    sourceState.frameCount);
  const decoded = encodeBlackHolePreparedBank({
    transportSeed,
    starCount,
    configurationCount,
    bankIndex,
    startFrameIndex: bankIndex * bankFrameCount,
    frameCount: bankFrameCount,
    blockFrameCount,
    coordinates: bankCoordinates,
    luminances: bankLuminances,
  });
  const decodedView = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  const compressed = brotliCompressSync(decoded, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: decoded.byteLength,
    },
  });
  const hash = sha256(compressed);
  const filename = `bank-${String(bankIndex).padStart(2, "0")}-${hash}.bin.br`;
  await writeFile(resolve(banksRoot, filename), compressed);
  banks.push(Object.freeze({
    index: bankIndex,
    startFrameIndex: bankIndex * bankFrameCount,
    frameCount: bankFrameCount,
    sourceLoopStartFrameIndex,
    sourceContinuousFromPrevious: true,
    presentationContinuousFromPrevious: true,
    assetUrl: `/cssblackhole/banks/${filename}`,
    byteLength: compressed.byteLength,
    sha256: hash,
    decodedByteLength: decoded.byteLength,
    decodedSha256: sha256(decoded),
    contentEncoding: "br",
    maximumCoordinateQuantizationErrorPixels:
      CSSBLACKHOLE_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS,
    blockCount: blocksPerBank,
    visibleSampleCount: decodedView.getUint32(40, true),
    sourceSampleCount: bankFrameCount * starCount,
    coordinateEncoding:
      "leaf-major-axis-split-signed-zigzag-varint-second-difference-decimal1",
    opacityAssignmentCount: decodedView.getUint32(44, true),
    sourceLuminanceSampleCount: bankFrameCount * starCount,
    opacityEncoding: CSSBLACKHOLE_OPACITY_ENCODING,
  }));
}

const snapshot = "<!doctype html><html><head><style>.polycss-scene>b{color:#fff}</style>" +
  "</head><body><main class=\"polycss-camera\" " +
  "aria-label=\"Prepared 1,979-photon Luminet black-hole field\">" +
  "<div class=\"polycss-scene\">" + Array.from({ length: starCount }, (_, leafIndex) =>
    `<b style=\"color:${preparedBlackHoleColorAt(leafIndex, directPointCount)};` +
    `transform:${formatBlackHolePreparedTransform(
      selectedCoordinates[leafIndex * 2], selectedCoordinates[leafIndex * 2 + 1])};` +
    `opacity:${preparedOpacityPalette[
      quantizeBlackHolePreparedOpacityIndex(selectedLuminances[leafIndex])]}\"></b>`).join("") +
  "</div></main></body></html>";
const snapshotBytes = new TextEncoder().encode(snapshot);
const snapshotHash = sha256(snapshotBytes);
await writeFile(resolve(stagingRoot, "snapshot.html"), snapshotBytes);

const presentationColors = Object.freeze({
  schema: "cssblackhole-galactic-color-source-luminance@4",
  mode: "prepared-source-image-color-with-source-luminance-opacity",
  palette: CSSBLACKHOLE_GALACTIC_DOT_COLORS,
  directImagePalette: CSSBLACKHOLE_DIRECT_IMAGE_DOT_COLORS,
  ghostImagePalette: CSSBLACKHOLE_GHOST_IMAGE_DOT_COLORS,
  paletteIntent: "direct-image-white-lavender-and-ghost-image-lavender-purple",
  colorAssignment: "source-image-class-palettes-across-stable-retained-leaf-identity",
  runtimeColorWrites: false,
  opacityPaletteEntryCount: preparedOpacityPalette.length,
  opacityDecimalPlaces: 1,
  opacityQuantization: "nearest-decile-at-prepare-time",
  dynamicObservedFluxParity: true,
  allConfigurationsObservedFluxParity: true,
  sourceDefaultExposureParity: false,
  sourceDefaultNormalization: sourceState.photometry.sourceDefaultNormalization,
  displayNormalization: sourceState.photometry.displayNormalization,
  displayPowerGamma: sourceState.photometry.displayPowerGamma,
  displayOpacityFloor: sourceState.photometry.displayOpacityFloor,
  exposureBounds: sourceState.photometry.exposureBounds,
  colormap: sourceState.photometry.colormap,
});
const configurationLoop = Object.freeze({
  schema: "cssblackhole-luminet-moving-configuration-loop@4",
  mode: "prepared-variable-dwell-side-angled-top-angled-luminet-photon-configuration-loop",
  sourceFrameStep,
  presentationSequenceSeconds: sourceState.configurationSequence.presentationSequenceSeconds,
  presentationSequenceFrameCount:
    sourceState.configurationSequence.presentationSequenceFrameCount / sourceFrameStep,
  presentationSlotHoldSeconds:
    sourceState.configurationSequence.presentationSlotHoldSeconds,
  presentationSlotDurationSeconds:
    sourceState.configurationSequence.presentationSlotDurationSeconds,
  presentationSlotFrameCounts:
    sourceState.configurationSequence.presentationSlotFrameCounts.map(
      (frameCount) => frameCount / sourceFrameStep),
  presentationSlotStartFrameIndices:
    sourceState.configurationSequence.presentationSlotStartFrameIndices.map(
      (frameIndex) => frameIndex / sourceFrameStep),
  transitionStartFrameIndices:
    sourceState.configurationSequence.transitionStartFrameIndices.map(
      (frameIndex) => frameIndex / sourceFrameStep),
  transitionFrameCount: sourceState.configurationSequence.transitionFrameCount / sourceFrameStep,
  transitionSeconds: sourceState.configurationSequence.transitionSeconds,
  configurationTransitionCount:
    streamFrameCount /
      (sourceState.configurationSequence.presentationSequenceFrameCount / sourceFrameStep) *
      presentationConfigurationCount,
  transitionCadenceSecondsBySlot:
    sourceState.configurationSequence.transitionCadenceSecondsBySlot,
  sourceMotionSecondsBeforeTransitionBySlot:
    sourceState.configurationSequence.sourceMotionSecondsBeforeTransitionBySlot,
  orbitalSpeedScale: sourceState.orbitalSpeedScale,
  sourceMotionReferenceSeconds: sourceState.sourceMotionReferenceSeconds,
  sourceLoopSeconds: sourceState.sourceLoopSeconds,
  sourceLoopFrameCount: sourceState.sourceLoopFrameCount / sourceFrameStep,
  combinedLoopSeconds: sourceState.combinedLoopSeconds,
  combinedLoopFrameCount: sourceState.combinedLoopFrameCount / sourceFrameStep,
  combinedSourceFrameCount: sourceState.combinedLoopFrameCount,
  configurationSequence: sourceState.configurationSequence.presentationSequence,
  presentationSlots: sourceState.configurationSequence.presentationSlots,
  transitionMotion: sourceState.configurationSequence.transition,
  particleIdentity: sourceState.configurationSequence.identityCorrespondence,
  opacityOwner: "prepared-decile-quantized-source-observed-flux-for-all-moving-configurations",
});
const pointSelection = Object.freeze({
  schema: "cssblackhole-source-point-selection@3",
  mode: "publication-year-count-proportional-non-overlapping-prepared-source-identity-subset",
  publicationYear: 1979,
  sourcePointCount,
  selectedPointCount: starCount,
  sourceDirectPointCount,
  selectedDirectPointCount: directPointCount,
  sourceGhostPointCount,
  selectedGhostPointCount: ghostPointCount,
  identityOrder: "selected-direct-source-indices-then-selected-ghost-source-indices",
  algorithm:
    "centered-stratified-source-identities-with-sparse-prepared-one-pixel-grid-separation",
  collisionDomain:
    "frame-local-exact-tenth-pixel-coordinate-over-complete-moving-configuration-loop",
  identityContinuity:
    "stable-source-emitter-leaf-identity-with-prepared-separation-only-at-exact-conflicts",
  runtimeSourceRepair: false,
  sourcePeriodicRadiusCount: sourceState.periodicRadiusCount,
  selectedDirectPeriodicRadiusCount: new Set(selectedDirectOrbitCounts).size,
  selectedGhostPeriodicRadiusCount: new Set(selectedGhostOrbitCounts).size,
  selectedDirectMaximumPointsPerRadius: maximumFrequency(selectedDirectOrbitCounts),
  selectedGhostMaximumPointsPerRadius: maximumFrequency(selectedGhostOrbitCounts),
  ...pointSelectionResult.report,
  sourcePointIndices: selectedSourcePointIndices,
});
const catalog = Object.freeze({
  schema: "cssblackhole-prepared-stream-catalog@1",
  starCount,
  configurationCount,
  presentationConfigurationCount,
  transportSeed,
  sourceFramesPerSecond,
  framesPerSecond,
  frameMilliseconds,
  blockFrameCount,
  blocksPerBank,
  bankFrameCount,
  bankSeconds: bankFrameCount / framesPerSecond,
  bankCount,
  blockCount,
  streamFrameCount,
  streamDurationMilliseconds: streamFrameCount * frameMilliseconds,
  runtimeLookaheadBankCount: 1,
  runtimeMaterializedLookaheadBlockCount: 1,
  startupMaterializedLookaheadBlockCount: 0,
  publication: Object.freeze({
    schema: "cssblackhole-prepared-useful-publication@1",
    mode: "complete-1979-point-state-at-sixty-hertz",
    sourceFrameStep,
    snapshotOwnsInitialFrame: true,
    runtimeIntermediateFrameGeneration: false,
    runtimeCatchupPublication: false,
  }),
  pointSelection,
  source: Object.freeze({
    classification: "source-backed-luminet-photon-geodesic-preparation",
    repository: sourceLock.repository,
    commit: sourceLock.commit,
    license: sourceLock.license.spdx,
    equations: Object.freeze([
      "Luminet impact-parameter root solve for direct and first-order ghost photon images",
      "source orbital angular rate omega=sqrt(M/r^3)",
      "source redshift factor and observed bolometric flux F_o=F_s/(1+z)^4",
    ]),
  }),
  camera: Object.freeze({
    mode: "fixed-retained-camera-prepared-point-transforms",
    viewport: Object.freeze({ width: 800, height: 600 }),
    center: Object.freeze({ x: 400, y: 300 }),
  }),
  presentationColors,
  spaceContext,
  preparedOpacityPalette,
  transport: Object.freeze({
    schema: "cssblackhole-prepared-bank-transport@1",
    encoding: CSSBLACKHOLE_BANK_ENCODING,
    contentEncoding: "br",
    bankSeconds: bankFrameCount / framesPerSecond,
    coordinateScale: 10,
    maximumCoordinateQuantizationErrorPixels:
      CSSBLACKHOLE_MAXIMUM_COORDINATE_QUANTIZATION_ERROR_PIXELS,
    predictor:
      "independent-five-second-coordinate-second-difference-plus-prepared-sparse-opacity-ranges",
  }),
  configurationLoop,
  luminetPreparedState: sourceState,
  snapshot: Object.freeze({
    schema: "cssblackhole-prepared-polycss-snapshot@1",
    url: `/cssblackhole/snapshot.html?sha256=${snapshotHash}`,
    sha256: snapshotHash,
    encoding: "identity",
    byteLength: snapshotBytes.byteLength,
    initialStreamFrame: 0,
    preparedTransformCount: starCount,
    preparedOpacityCount: starCount,
    retainedPointLeafCount: starCount,
    retainedPerPointWrapperCount: 0,
  }),
  banks: Object.freeze(banks),
});
const catalogBytes = new TextEncoder().encode(JSON.stringify(catalog));
const catalogHash = sha256(catalogBytes);
await writeFile(resolve(stagingRoot, "catalog.json"), catalogBytes);

const prepared = Object.freeze({
  schema: "cssblackhole-prepared-scene@1",
  status: "ready",
  source: catalog.source,
  renderer: Object.freeze({
    kind: "retained-dom-polycss-prepared-playback",
    runtimePhysics: false,
    runtimeRasterization: false,
    retainedPointLeafCount: starCount,
  }),
  viewport: catalog.camera.viewport,
  cadence: Object.freeze({
    sourceFramesPerSecond,
    framesPerSecond,
    frameMilliseconds,
    blockSeconds: blockFrameCount / framesPerSecond,
    bankSeconds: bankFrameCount / framesPerSecond,
    bankCount,
    streamSeconds: streamFrameCount / framesPerSecond,
  }),
  presentation: Object.freeze({
    orbitalSpeedScale: sourceState.orbitalSpeedScale,
    slotHoldSeconds: sourceState.configurationSequence.presentationSlotHoldSeconds,
    slotDurationSeconds: sourceState.configurationSequence.presentationSlotDurationSeconds,
    transitionSeconds: sourceState.configurationSequence.transitionSeconds,
    palette: CSSBLACKHOLE_GALACTIC_DOT_COLORS,
    displayPowerGamma: sourceState.photometry.displayPowerGamma,
    displayOpacityFloor: sourceState.photometry.displayOpacityFloor,
    sourceDefaultExposureParity: false,
    publicationYearPointCount: starCount,
    spaceContext,
  }),
  catalog: Object.freeze({
    schema: "cssblackhole-prepared-catalog-descriptor@1",
    url: `/cssblackhole/catalog.json?sha256=${catalogHash}`,
    sha256: catalogHash,
    byteLength: catalogBytes.byteLength,
  }),
});
await writeFile(resolve(stagingRoot, "prepared.json"), JSON.stringify(prepared));
await rm(outputRoot, { recursive: true, force: true });
await rename(stagingRoot, outputRoot);

const compressedBytes = banks.reduce((total, bank) => total + bank.byteLength, 0);
process.stdout.write(`${JSON.stringify({
  status: "ready",
  outputRoot,
  sourceCommit: sourceLock.commit,
  reusedPreparedSourceCache,
  retainedPointLeaves: starCount,
  configurationCount,
  presentationConfigurationCount,
  spaceContextSourceStarCountPerPlate: spaceContext.sourceStarCountPerPlate,
  framesPerSecond,
  orbitalSpeedScale: sourceState.orbitalSpeedScale,
  transitionCadenceSecondsBySlot:
    sourceState.configurationSequence.transitionCadenceSecondsBySlot,
  bankCount,
  compressedBytes,
}, null, 2)}\n`);

async function readPreparedSourceState() {
  try {
    const [metadataSource, coordinateBytes, luminanceBytes] = await Promise.all([
      readFile(stateMetadataPath, "utf8"), readFile(coordinatePath), readFile(luminancePath),
    ]);
    const sourceState = JSON.parse(metadataSource);
    if (sourceState?.schema !== "cssblackhole-luminet-prepared-state@9" ||
        sourceState.sourceCommit !== sourceLock.commit || sourceState.pointCount !== sourcePointCount ||
        sourceState.directPointCount !== sourceDirectPointCount ||
        sourceState.ghostPointCount !== sourceGhostPointCount ||
        sourceState.frameCount !== streamFrameCount ||
        sourceState.framesPerSecond !== sourceFramesPerSecond ||
        sourceState.orbitalSpeedScale !== 0.5 ||
        sourceState.sourceMotionReferenceSeconds !== 10 ||
        sourceState.naturalTimePerSourceMotionReference !== 1000 ||
        JSON.stringify(sourceState.naturalTimePerPresentationSlot) !==
          JSON.stringify([800, 450, 300, 450]) ||
        JSON.stringify(sourceState.naturalTimePerPresentationHold) !==
          JSON.stringify([600, 250, 100, 250]) ||
        sourceState.naturalTimePerSourceLoop !== 9000 ||
        sourceState.sourceLoopSeconds !== 90 || sourceState.sourceLoopFrameCount !== 5400 ||
        sourceState.combinedLoopSeconds !== 180 || sourceState.combinedLoopFrameCount !== 10800 ||
        sourceState.availablePeriodicRadiusCount !== 89 ||
        sourceState.periodicRadiusCount !== expectedPeriodicOrbitCounts.length ||
        sourceState.periodicOrbitCounts?.length !== expectedPeriodicOrbitCounts.length ||
        sourceState.periodicOrbitCounts.some(
          (turns, index) => turns !== expectedPeriodicOrbitCounts[index]) ||
        sourceState.periodicRadiusSelection !==
          "source-valid-greedy-maximin-radius-coverage" ||
        sourceState.particlePeriodicOrbitCounts?.length !== sourcePointCount ||
        sourceState.radialSampling !==
          "deterministic-jittered-uniform-radius-then-nearest-selected-periodic-source-loop-radius" ||
        sourceState.emitterPhaseCount !== 5400 ||
        sourceState.emitterPhaseQuantization !== "one-prepared-source-loop-frame" ||
        sourceState.coordinateByteLength !== coordinateBytes.byteLength ||
        sourceState.coordinateSha256 !== sha256(coordinateBytes) ||
        sourceState.luminanceByteLength !== luminanceBytes.byteLength ||
        sourceState.luminanceSha256 !== sha256(luminanceBytes) ||
        sourceState.photometry?.colormap !== "Greys_r" ||
        sourceState.photometry?.colormapLibraryVersion !== sourceLock.pythonDependencies.matplotlib ||
        sourceState.photometry?.displayPowerGamma !== 0.35 ||
        sourceState.photometry?.displayOpacityFloor !== 0.22 ||
        sourceState.configurationSequence?.schema !==
          "cssblackhole-luminet-moving-configuration-sequence@3" ||
        sourceState.configurationSequence.distinctConfigurationCount !== configurationCount ||
        sourceState.configurationSequence.presentationConfigurationCount !==
          presentationConfigurationCount ||
        sourceState.configurationSequence.presentationSequenceSeconds !== 20 ||
        sourceState.configurationSequence.presentationSequenceFrameCount !== 1200 ||
        JSON.stringify(sourceState.configurationSequence.presentationSlotHoldSeconds) !==
          JSON.stringify([6, 2.5, 1, 2.5]) ||
        JSON.stringify(sourceState.configurationSequence.presentationSlotDurationSeconds) !==
          JSON.stringify([8, 4.5, 3, 4.5]) ||
        JSON.stringify(sourceState.configurationSequence.presentationSlotFrameCounts) !==
          JSON.stringify([480, 270, 180, 270]) ||
        JSON.stringify(sourceState.configurationSequence.presentationSlotStartFrameIndices) !==
          JSON.stringify([0, 480, 750, 930]) ||
        JSON.stringify(sourceState.configurationSequence.transitionCadenceSecondsBySlot) !==
          JSON.stringify([8, 4.5, 3, 4.5]) ||
        JSON.stringify(sourceState.configurationSequence.sourceMotionSecondsBeforeTransitionBySlot) !==
          JSON.stringify([6, 2.5, 1, 2.5]) ||
        JSON.stringify(sourceState.configurationSequence.sourceMotionFrameCountsBeforeTransition) !==
          JSON.stringify([360, 150, 60, 150]) ||
        JSON.stringify(sourceState.configurationSequence.transitionStartFrameIndices) !==
          JSON.stringify([360, 150, 60, 150]) ||
        sourceState.configurationSequence.transitionSeconds !== 2 ||
        sourceState.configurationSequence.transitionFrameCount !== 120 ||
        sourceState.configurationSequence.states?.length !== configurationCount ||
        sourceState.configurationSequence.states.some((state) => state.dynamic !== true) ||
        JSON.stringify(sourceState.configurationSequence.presentationStateIndices) !==
          JSON.stringify([0, 1, 2, 1]) ||
        JSON.stringify(sourceState.configurationSequence.presentationSequence) !== JSON.stringify([
          "luminet-inclination-85deg",
          "luminet-inclination-60deg",
          "luminet-inclination-0deg",
          "luminet-inclination-60deg",
        ]) ||
        JSON.stringify(sourceState.configurationSequence.presentationSlots?.map(
          ({ stateIndex, view, holdSeconds, durationSeconds, frameCount, startFrameIndex,
            transitionStartFrameIndex, transitionFrameCount }) => ({
            stateIndex, view, holdSeconds, durationSeconds, frameCount, startFrameIndex,
            transitionStartFrameIndex, transitionFrameCount,
          }))) !== JSON.stringify([
          { stateIndex: 0, view: "side", holdSeconds: 6, durationSeconds: 8, frameCount: 480,
            startFrameIndex: 0, transitionStartFrameIndex: 360, transitionFrameCount: 120 },
          { stateIndex: 1, view: "angled", holdSeconds: 2.5, durationSeconds: 4.5,
            frameCount: 270, startFrameIndex: 480, transitionStartFrameIndex: 150,
            transitionFrameCount: 120 },
          { stateIndex: 2, view: "top", holdSeconds: 1, durationSeconds: 3, frameCount: 180,
            startFrameIndex: 750, transitionStartFrameIndex: 60, transitionFrameCount: 120 },
          { stateIndex: 1, view: "angled", holdSeconds: 2.5, durationSeconds: 4.5,
            frameCount: 270, startFrameIndex: 930, transitionStartFrameIndex: 150,
            transitionFrameCount: 120 },
        ])) return null;
    return Object.freeze({ sourceState, coordinateBytes, luminanceBytes });
  } catch {
    return null;
  }
}

function maximumFrequency(values) {
  const frequencies = new Map();
  let maximum = 0;
  for (const value of values) {
    const frequency = (frequencies.get(value) ?? 0) + 1;
    frequencies.set(value, frequency);
    maximum = Math.max(maximum, frequency);
  }
  return maximum;
}

async function ensurePinnedSource() {
  if (!await exists(resolve(sourceRoot, ".git"))) {
    await mkdir(resolve(sourceRoot, ".."), { recursive: true });
    await execFileAsync("git", ["clone", "--filter=blob:none", sourceLock.repository, sourceRoot]);
  }
  await execFileAsync("git", ["-C", sourceRoot, "checkout", "--detach", sourceLock.commit]);
  const { stdout } = await execFileAsync("git", ["-C", sourceRoot, "rev-parse", "HEAD"]);
  if (stdout.trim() !== sourceLock.commit) throw new Error("Luminet source commit drifted");
  for (const [path, expectedHash] of Object.entries({
    [sourceLock.license.path]: sourceLock.license.sha256, ...sourceLock.files,
  })) {
    if (sha256(await readFile(resolve(sourceRoot, path))) !== expectedHash) {
      throw new Error(`Luminet source hash drifted: ${path}`);
    }
  }
}

async function ensurePythonEnvironment() {
  if (!process.env.CSSBLACKHOLE_PYTHON && !await exists(pythonPath)) {
    await mkdir(resolve(venvRoot, ".."), { recursive: true });
    await execFileAsync("python3", ["-m", "venv", venvRoot]);
  }
  try {
    await execFileAsync(pythonPath, ["-c",
      `import matplotlib,numpy,scipy;` +
      `assert matplotlib.__version__==\"${sourceLock.pythonDependencies.matplotlib}\";` +
      `assert numpy.__version__==\"${sourceLock.pythonDependencies.numpy}\";` +
      `assert scipy.__version__==\"${sourceLock.pythonDependencies.scipy}\"`]);
  } catch {
    await execFileAsync(pythonPath, ["-m", "pip", "install", "--disable-pip-version-check",
      `numpy==${sourceLock.pythonDependencies.numpy}`,
      `scipy==${sourceLock.pythonDependencies.scipy}`,
      `matplotlib==${sourceLock.pythonDependencies.matplotlib}`], { maxBuffer: 20_000_000 });
  }
}

async function runPythonPreparation() {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pythonPath, [resolve(import.meta.dirname, "prepare-luminet-state.py"),
      "--source-root", sourceRoot, "--source-commit", sourceLock.commit,
      "--output", coordinatePath, "--luminance-output", luminancePath,
      "--metadata", stateMetadataPath, "--oracle", oraclePpmPath,
    ], { stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => code === 0 ? resolvePromise() :
      rejectPromise(new Error(`Luminet preparation failed: code=${code} signal=${signal}`)));
  });
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function selectSourceFrames(
  source, startFrame, frameCount, valuesPerFrame, frameStep, sourceFrameCount,
) {
  const selected = source instanceof Int32Array
    ? new Int32Array(frameCount * valuesPerFrame)
    : new Uint8Array(frameCount * valuesPerFrame);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const sourceFrameIndex = (startFrame + frameIndex * frameStep) % sourceFrameCount;
    const sourceStart = sourceFrameIndex * valuesPerFrame;
    selected.set(source.subarray(sourceStart, sourceStart + valuesPerFrame),
      frameIndex * valuesPerFrame);
  }
  return selected;
}

function selectSourcePoints(source, frameCount, sourceCount, valuesPerPoint, pointIndices) {
  const selected = source instanceof Int32Array
    ? new Int32Array(frameCount * pointIndices.length * valuesPerPoint)
    : new Uint8Array(frameCount * pointIndices.length * valuesPerPoint);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let selectedIndex = 0; selectedIndex < pointIndices.length; selectedIndex += 1) {
      const sourcePointIndex = pointIndices[selectedIndex];
      const sourceOffset = (frameIndex * sourceCount + sourcePointIndex) * valuesPerPoint;
      const selectedOffset = (frameIndex * pointIndices.length + selectedIndex) * valuesPerPoint;
      selected.set(source.subarray(sourceOffset, sourceOffset + valuesPerPoint), selectedOffset);
    }
  }
  return selected;
}
