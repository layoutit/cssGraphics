import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  generatedProductRoot,
  generatedScenePath,
  generatedSceneUrl,
  generatedSnapshotUrl,
  manifestPath,
} from "./paths.mjs";
import { assertNoBrowserPathLeaks } from "./provenance.mjs";

export async function writeCssmazePreparedOutput({ scenes, defaultSceneId = "default-maze", preparedBank } = {}) {
  if (!Array.isArray(scenes) || scenes.length < 1 ||
      preparedBank?.schema !== "cssmaze-prepared-bank@1" ||
      preparedBank.sceneIds?.length !== scenes.length ||
      preparedBank.seeds?.length !== scenes.length ||
      preparedBank.rotationScores?.length !== scenes.length) {
    throw new Error("cssMaze preparation requires a complete prepared scene bank");
  }
  await rm(dirname(generatedScenePath(scenes[0].id)), { recursive: true, force: true });
  await mkdir(generatedProductRoot(), { recursive: true });
  for (const scene of scenes) await writeJsonAtomic(generatedScenePath(scene.id), scene);
  const scene = scenes.find((candidate) => candidate.id === defaultSceneId);
  if (!scene) throw new Error(`cssMaze default prepared scene is missing: ${defaultSceneId}`);
  const manifest = Object.freeze({
    schema: "cssmaze-manifest@3",
    status: "ready",
    scope: "public-prepared-product",
    release: Object.freeze({
      status: "ready",
      noticePath: "debian/copyright",
      noticeSha256: "354d67dfdb520f9e133102881e7bce90b48ca95aea0ef37042d8af4cfe48f8e9",
    }),
    parity: Object.freeze({
      status: "unqualified",
      reason: "native pixel capture and A/A-calibrated visual comparison are pending",
    }),
    title: "cssMaze — XScreenSaver Maze3D",
    artifactMode: "prepared-polycss-snapshot",
    scaffoldMode: "map-scene",
    generatedAssetRoot: "/cssmaze/",
    defaultScene: Object.freeze({ id: defaultSceneId }),
    preparedBank,
    scenes: Object.freeze(scenes.map((candidate, rank) => Object.freeze({
      id: candidate.id,
      label: candidate.label,
      nativeSeed: candidate.sourceProfile.seed,
      bankRank: rank,
      rotationScore: candidate.sourceProfile.rotationScore,
      sceneUrl: generatedSceneUrl(candidate.id),
      sceneEncoding: "gzip",
      snapshotUrl: generatedSnapshotUrl(candidate.id),
      snapshotEncoding: "gzip",
      snapshotKind: "polycss-exported-html",
      artifactKind: "prepared-polycss-snapshot",
      metrics: candidate.metrics,
      oracle: candidate.oracle,
      warnings: candidate.warnings,
    }))),
    source: scene.source,
    renderer: scene.renderer,
    metrics: scene.metrics,
    warnings: scene.warnings,
    transport: Object.freeze({
      schema: "cssmaze-prepared-transport@1",
      encoding: "gzip",
      startup: "selected-scene-and-snapshot-first",
      selection: "page-load-only",
      runtimeArchiveDownload: false,
      runtimeGeometryPayload: false,
    }),
    runtime: Object.freeze({
      debugApi: "window.__cssMazeDebug",
      routeContract: "/ randomly selects one low-rotation prepared scene per page load; ?scene=<manifest-scene-id> pins one prepared scene",
      startupSelection: "crypto-random-prepared-bank-entry",
      sceneChangeControl: false,
      runtimeSceneGenerationCount: 0,
      runtimeRotationScoringCount: 0,
      runtimeGeometryConstructionCount: 0,
      runtimeCameraCalculationCount: 0,
      runtimeDomGrowth: false,
    }),
  });
  await writeJsonAtomic(manifestPath(), manifest);
  return Object.freeze({ manifestPath: manifestPath(), manifest });
}

async function writeJsonAtomic(path, value) {
  assertNoBrowserPathLeaks(value);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}
