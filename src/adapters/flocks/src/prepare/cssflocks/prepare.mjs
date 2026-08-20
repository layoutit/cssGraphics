// SPDX-License-Identifier: GPL-2.0-or-later
import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { buildPolyMorphCatalog, buildPolyMorphPackage } from "@layoutit/polycss-morph/prepare";
import { verifyFlocksSourceIdentity } from "./dataSource.mjs";
import { CSSFLOCKS_FACE_INDICES, buildFlocksPreparedModel } from "./modelBuilder.mjs";
import { resolveFlocksGeneratedPublicRoot, resolveFlocksOutputRoot } from "./paths.mjs";
import { CSSFLOCKS_PROVENANCE } from "./provenance.mjs";
import { CSSFLOCKS_SLICE_PLAN } from "./slicePlan.mjs";
import {
  CSSFLOCKS_PRODUCT_PROFILES,
  CSSFLOCKS_PREPARED_CADENCE,
  CSSFLOCKS_PREPARED_LOADER,
  CSSFLOCKS_SOURCE,
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceBlocks,
  selectFlocksProductPrefix,
} from "./sourceModel.mjs";
import {
  buildFlocksTerminalBridge,
  buildFlocksTerminalCorrespondence,
} from "./terminalSeam.mjs";
import {
  CSSFLOCKS_BLOCK_ENCODING,
  CSSFLOCKS_PLAYBACK_SCHEMA,
  encodeFlocksPreparedBlock,
} from "../../shared/cssflocks/preparedBlockTransport.mjs";
import { writeFlocksJson } from "./writeManifest.mjs";
import { CSSFLOCKS_STARTUP_WINDOWS } from "../../shared/cssflocks/startupWindows.mjs";

export async function prepareFlocks({ env = process.env } = {}) {
  const sourceLock = await verifyFlocksSourceIdentity();
  const generatedPublicRoot = resolveFlocksGeneratedPublicRoot(env);
  const outputRoot = resolveFlocksOutputRoot(env);
  const stagingRoot = join(generatedPublicRoot, `.cssflocks-${process.pid}`);
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  try {
    const states = new Map(Object.values(CSSFLOCKS_PRODUCT_PROFILES).map((profile) => [profile.id, {
      profile,
      model: null,
      entries: [],
      encodedBytes: 0,
      decodedBytes: 0,
      initialFrame: null,
      terminalFrame: null,
      terminalSeam: null,
    }]));
    const writePreparedBlock = async ({ state, frames, index, startFrameIndex, continuityKind, sourceContinuousFromPrevious }) => {
      const decoded = Buffer.from(encodeFlocksPreparedBlock({
        frames,
        bugCount: state.profile.bugCount,
        framesPerSecond: CSSFLOCKS_SOURCE_BANK.framesPerSecond,
      }));
      const encoded = gzipSync(decoded, { level: 9 });
      const encodedSha256 = sha256(encoded);
      const decodedSha256 = sha256(decoded);
      const assetUrl = `/cssflocks/${state.profile.id}/blocks/block-${String(index).padStart(3, "0")}-${encodedSha256}.bin`;
      await writeBytes(join(stagingRoot, assetUrl.replace(/^\/cssflocks\//u, "")), encoded);
      state.entries.push(Object.freeze({
        index,
        startFrameIndex,
        frameCount: frames.length,
        sourceContinuousFromPrevious,
        continuityKind,
        assetUrl,
        encoding: CSSFLOCKS_BLOCK_ENCODING,
        byteLength: encoded.byteLength,
        sha256: encodedSha256,
        decodedByteLength: decoded.byteLength,
        decodedSha256,
      }));
      state.encodedBytes += encoded.byteLength;
      state.decodedBytes += decoded.byteLength;
    };
    for (const sourceBlock of buildFlocksSourceBlocks({ bank: CSSFLOCKS_SOURCE_BANK })) {
      for (const state of states.values()) {
        const selected = selectFlocksProductPrefix(sourceBlock, state.profile);
        if (state.model === null) state.model = buildFlocksPreparedModel({ source: selected });
        state.initialFrame ??= selected.frames[0];
        state.terminalFrame = selected.frames.at(-1);
        await writePreparedBlock({
          state,
          frames: selected.frames,
          startFrameIndex: sourceBlock.bank.startFrameIndex,
          index: sourceBlock.bank.blockIndex,
          continuityKind: "exact-source-adjacent",
          sourceContinuousFromPrevious: sourceBlock.bank.blockIndex > 0,
        });
      }
    }
    const sourceBlockCount = CSSFLOCKS_SOURCE_BANK.frameCount / CSSFLOCKS_SOURCE_BANK.blockFrameCount;
    const bridgeFrameCount = CSSFLOCKS_PREPARED_CADENCE.terminalBridgeSeconds * CSSFLOCKS_SOURCE_BANK.framesPerSecond;
    for (const state of states.values()) {
      const viewport = state.profile.id === "desktop" ? [1280, 800] : [390, 844];
      const correspondence = buildFlocksTerminalCorrespondence(
        state.terminalFrame.bugs,
        state.initialFrame.bugs,
        viewport,
        state.profile.leaderCount,
      );
      const bridge = buildFlocksTerminalBridge({
        finalFrame: state.terminalFrame,
        initialFrame: state.initialFrame,
        correspondence: correspondence.permutation,
        frameCount: bridgeFrameCount,
        framesPerSecond: CSSFLOCKS_SOURCE_BANK.framesPerSecond,
      });
      state.terminalSeam = Object.freeze({
        strategy: bridge.strategy,
        sourceBehaviorDeviation: bridge.sourceBehaviorDeviation,
        sourceFrameCount: CSSFLOCKS_SOURCE_BANK.frameCount,
        bridgeFrameCount,
        bridgeDurationMilliseconds: bridge.durationMilliseconds,
        interpolationDurationMilliseconds: bridge.interpolationDurationMilliseconds,
        correspondence: bridge.correspondence,
        correspondenceMetrics: correspondence.metrics,
        naturalWindowSearch: Object.freeze({
          horizonSeconds: 3_600,
          candidatePairCount: 77_602,
          qualifiedNaturalSeamFound: false,
        }),
      });
      for (let bridgeBlockIndex = 0; bridgeBlockIndex < bridgeFrameCount / CSSFLOCKS_SOURCE_BANK.blockFrameCount; bridgeBlockIndex += 1) {
        const index = sourceBlockCount + bridgeBlockIndex;
        const startFrameIndex = CSSFLOCKS_SOURCE_BANK.frameCount + bridgeBlockIndex * CSSFLOCKS_SOURCE_BANK.blockFrameCount;
        const frameStart = bridgeBlockIndex * CSSFLOCKS_SOURCE_BANK.blockFrameCount;
        await writePreparedBlock({
          state,
          frames: bridge.frames.slice(frameStart, frameStart + CSSFLOCKS_SOURCE_BANK.blockFrameCount),
          index,
          startFrameIndex,
          continuityKind: "prepare-only-hermite-terminal-bridge",
          sourceContinuousFromPrevious: false,
        });
      }
    }

    const profileMetadata = {};
    const builtModels = [];
    for (const state of states.values()) {
      if (state.model === null) throw new Error(`Flocks ${state.profile.id} produced no prepared model`);
      const catalog = Object.freeze({
        schema: "cssflocks-prepared-stream-catalog@1",
        streamId: state.profile.id,
        modelId: state.profile.modelId,
        sourceDefaultBugCount: CSSFLOCKS_SOURCE_BANK.bugCount,
        sourceDefaultLeaderCount: CSSFLOCKS_SOURCE_BANK.leaderCount,
        sourceDefaultFollowerCount: CSSFLOCKS_SOURCE_BANK.followerCount,
        productSelection: "source-ordered-prefix-after-full-source-simulation",
        bugCount: state.profile.bugCount,
        leaderCount: state.profile.leaderCount,
        followerCount: state.profile.followerCount,
        facesPerBug: CSSFLOCKS_FACE_INDICES.length,
        leafCount: state.profile.bugCount * CSSFLOCKS_FACE_INDICES.length,
        playbackSchema: CSSFLOCKS_PLAYBACK_SCHEMA,
        seed: CSSFLOCKS_SOURCE_BANK.seed,
        framesPerSecond: CSSFLOCKS_SOURCE_BANK.framesPerSecond,
        frameMilliseconds: CSSFLOCKS_SOURCE_BANK.frameMilliseconds,
        warmupFrames: CSSFLOCKS_SOURCE_BANK.warmupFrames,
        sourceFrameCount: CSSFLOCKS_SOURCE_BANK.frameCount,
        sourceDurationMilliseconds: CSSFLOCKS_SOURCE_BANK.frameCount / CSSFLOCKS_SOURCE_BANK.framesPerSecond * 1_000,
        streamFrameCount: CSSFLOCKS_SOURCE_BANK.frameCount + bridgeFrameCount,
        streamDurationMilliseconds: (CSSFLOCKS_SOURCE_BANK.frameCount + bridgeFrameCount) / CSSFLOCKS_SOURCE_BANK.framesPerSecond * 1_000,
        blockCount: state.entries.length,
        blockFrameCount: CSSFLOCKS_SOURCE_BANK.blockFrameCount,
        runtimeLookaheadBlockCount: CSSFLOCKS_PREPARED_LOADER.runtimeLookaheadBlockCount,
        runtimeMaterializedLookaheadBlockCount:
          CSSFLOCKS_PREPARED_LOADER.runtimeMaterializedLookaheadBlockCount,
        startupMaterializedLookaheadBlockCount:
          CSSFLOCKS_PREPARED_LOADER.startupMaterializedLookaheadBlockCount,
        loop: true,
        terminalSeam: state.terminalSeam,
        startupWindows: CSSFLOCKS_STARTUP_WINDOWS,
        entries: Object.freeze(state.entries),
      });
      const catalogBytes = Buffer.from(`${JSON.stringify(catalog)}\n`);
      const catalogPath = join(stagingRoot, state.profile.id, "catalog.json");
      await writeBytes(catalogPath, catalogBytes);
      const built = await buildPolyMorphPackage(state.model.model);
      const packageRoot = join(stagingRoot, "model", state.profile.modelId);
      for (const [path, bytes] of built.files) await writeBytes(join(packageRoot, path), bytes);
      await writeBytes(join(packageRoot, "manifest.json"), built.manifestBytes);
      builtModels.push({ state, built });
      profileMetadata[state.profile.id] = Object.freeze({
        id: state.profile.id,
        model: Object.freeze({
          id: state.profile.modelId,
          manifestSha256: built.manifestSha256,
          ...state.model.metrics,
        }),
        playback: Object.freeze({
          catalogUrl: `/cssflocks/${state.profile.id}/catalog.json`,
          catalogSha256: sha256(catalogBytes),
          catalogBytes: catalogBytes.byteLength,
          blockCount: state.entries.length,
          preparedFrameCount: CSSFLOCKS_SOURCE_BANK.frameCount + bridgeFrameCount,
          sourceFrameCount: CSSFLOCKS_SOURCE_BANK.frameCount,
          terminalBridgeFrameCount: bridgeFrameCount,
          preparedBlockEncodedBytes: state.encodedBytes,
          preparedBlockDecodedBytes: state.decodedBytes,
          transportEncoding: CSSFLOCKS_BLOCK_ENCODING,
        }),
        presentation: Object.freeze({
          sourceDefaultBugCount: CSSFLOCKS_SOURCE_BANK.bugCount,
          productBugCount: state.profile.bugCount,
          productLeaderCount: state.profile.leaderCount,
          productFollowerCount: state.profile.followerCount,
          fieldOfViewDegrees: CSSFLOCKS_SOURCE.fieldOfViewDegrees,
          startupWarmupMilliseconds: CSSFLOCKS_SOURCE_BANK.warmupFrames / CSSFLOCKS_SOURCE_BANK.framesPerSecond * 1_000,
          lighting: "fixed-flat-face-factors-currentColor",
        }),
      });
    }
    const modelCatalog = await buildPolyMorphCatalog("flocks", builtModels.map(({ state, built }) => ({
      manifest: built.manifest,
      manifestPath: `${state.profile.modelId}/manifest.json`,
      manifestSha256: built.manifestSha256,
    })));
    await writeBytes(join(stagingRoot, "model/catalog.json"), modelCatalog.bytes);

    const scene = Object.freeze({
      schema: "cssflocks-scene@1",
      id: CSSFLOCKS_SLICE_PLAN.id,
      label: "Flocks",
      source: sourceLock,
      camera: Object.freeze({ fieldOfViewDegrees: CSSFLOCKS_SOURCE.fieldOfViewDegrees, referenceAspectRatio: CSSFLOCKS_SOURCE_BANK.aspectRatio }),
      profiles: profileMetadata,
      metrics: Object.freeze({
        sourceTriangleCount: CSSFLOCKS_PRODUCT_PROFILES.desktop.bugCount * CSSFLOCKS_FACE_INDICES.length,
        preparedPolygonCount: CSSFLOCKS_PRODUCT_PROFILES.desktop.bugCount * CSSFLOCKS_FACE_INDICES.length,
        renderLeafCount: CSSFLOCKS_PRODUCT_PROFILES.desktop.bugCount * CSSFLOCKS_FACE_INDICES.length,
        atlasCount: 0,
        unresolvedTextureCount: 0,
        mergeCandidateCount: 0,
        mergeOutputCount: 0,
      }),
      warnings: Object.freeze([
        "Native/source GL lighting and accepted fixed flat lighting differ; RGB comparison is diagnostic while prepared state, projection, and continuity gates are strict.",
        "The final eight-second cubic-Hermite terminal bridge is a documented prepare-only source-behavior deviation.",
      ]),
    });
    await writeFlocksJson(join(stagingRoot, "scenes/flocks-default.json"), scene);
    const prepared = Object.freeze({
      schema: "cssflocks-prepared-scene@1",
      status: "ready",
      source: sourceLock,
      renderer: Object.freeze({
        package: "@layoutit/polycss-morph",
        profile: "static-prepared",
        representation: "retained-six-solid-triangle-bug-roots",
        runtimeGeometryConstruction: false,
        runtimeAtlasRasterization: false,
        runtimeDomGrowth: false,
        runtimePreparedStateMaterialization: true,
        runtimeFrameMatrixFormatting: false,
        runtimeFrameColorFormatting: false,
      }),
      defaultScene: CSSFLOCKS_SLICE_PLAN.id,
      sceneUrl: "/cssflocks/scenes/flocks-default.json",
      profileSelection: Object.freeze({
        startupOnly: true,
        desktopProfileId: "desktop",
        mobileProfileId: "mobile",
        mobileCapabilityQuery: "(hover: none) and (pointer: coarse)",
        mobileMaximumViewportWidth: 599,
      }),
      profiles: Object.freeze(profileMetadata),
      oracle: CSSFLOCKS_PROVENANCE,
    });
    await writeFlocksJson(join(stagingRoot, "prepared.json"), prepared);
    await writeFlocksJson(join(stagingRoot, "manifest.json"), {
      schema: "cssflocks-manifest@1",
      status: "ready",
      title: "Flocks",
      source: sourceLock,
      scaffoldMode: CSSFLOCKS_SLICE_PLAN.scaffoldMode,
      artifactMode: CSSFLOCKS_SLICE_PLAN.artifactMode,
      generatedAssetRoot: "/cssflocks/",
      defaultScene: CSSFLOCKS_SLICE_PLAN.id,
      scenes: [{ id: CSSFLOCKS_SLICE_PLAN.id, url: "/cssflocks/scenes/flocks-default.json" }],
      modelCount: 2,
      sourceTriangleCount: scene.metrics.sourceTriangleCount,
      preparedPolygonCount: scene.metrics.preparedPolygonCount,
      renderLeafCount: scene.metrics.renderLeafCount,
      atlasCount: 0,
      unresolvedTextureCount: 0,
      mergeCandidateCount: 0,
      mergeOutputCount: 0,
      debugApi: "window.__cssFlocksDebug",
      warnings: scene.warnings,
    });

    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(dirname(outputRoot), { recursive: true });
    await rename(stagingRoot, outputRoot);
    return Object.freeze({
      outputRoot,
      sourceDefaultBugCount: CSSFLOCKS_SOURCE_BANK.bugCount,
      profiles: Object.freeze(Object.values(profileMetadata).map((profile) => Object.freeze({
        id: profile.id,
        productBugCount: profile.presentation.productBugCount,
        retainedPolygonLeafCount: profile.model.retainedPolygonLeafCount,
        preparedBlockEncodedBytes: profile.playback.preparedBlockEncodedBytes,
        preparedBlockDecodedBytes: profile.playback.preparedBlockDecodedBytes,
      }))),
    });
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

async function writeBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
