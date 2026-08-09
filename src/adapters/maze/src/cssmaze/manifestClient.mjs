import { readPreparedJson, readPreparedText } from "./preparedResponse.mjs";

const MANIFEST_URL = "/cssmaze/manifest.json";
const preparedSceneCache = new Map();

export async function loadPreparedManifest(route, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const manifest = await fetchJson(fetchImpl, MANIFEST_URL, "cssMaze manifest");
  const bank = manifest?.preparedBank;
  if (manifest?.schema !== "cssmaze-manifest@3" ||
      manifest.artifactMode !== "prepared-polycss-snapshot" ||
      manifest.defaultScene?.id !== "default-maze" ||
      !Array.isArray(manifest.scenes) || manifest.scenes.length !== 24 ||
      bank?.schema !== "cssmaze-prepared-bank@1" ||
      bank.selection !== "startup-crypto-random-common-loop-low-consecutive-turn-prepared-scene" ||
      bank.ranking?.algorithm !== "common-loop-orientation-then-lowest-maximum-consecutive-quarter-turns" ||
      bank.ranking?.maximumConsecutiveQuarterTurnCount !== 2 ||
      bank.ranking?.maximumLoopOrientationChangeDegrees !== 0 ||
      bank.ranking?.requiredLoopOrientationDegrees !== 180 ||
      bank.ranking?.loopTexturePhaseAligned !== true ||
      bank.ranking?.selectedSceneCount !== 24 || bank.ranking?.runtimeScoring !== false ||
      bank.runtimeSceneGeneration !== false || bank.runtimeGeometryConstruction !== false ||
      bank.runtimeRotationScoring !== false || bank.mountedSceneCount !== 1 ||
      manifest.transport?.schema !== "cssmaze-prepared-transport@1" ||
      manifest.transport.encoding !== "gzip" ||
      manifest.transport.startup !== "selected-scene-and-snapshot-first" ||
      manifest.transport.selection !== "page-load-only" ||
      manifest.transport.runtimeArchiveDownload !== false ||
      manifest.transport.runtimeGeometryPayload !== false ||
      !validSharedSnapshotAtlases(manifest.transport.sharedSnapshotAtlases) ||
      !Array.isArray(bank.sceneIds) || bank.sceneIds.length !== 24 ||
      !Array.isArray(bank.seeds) || bank.seeds.length !== 24 ||
      !Array.isArray(bank.rotationScores) || bank.rotationScores.length !== 24 ||
      manifest.scenes.some((entry, index) => entry?.id !== bank.sceneIds[index] ||
        entry?.nativeSeed !== bank.seeds[index] || entry?.rotationScore?.seed !== bank.seeds[index] ||
        entry?.rotationScore?.schema !== "cssmaze-prepared-rotation-score@2" ||
        !Number.isSafeInteger(entry?.rotationScore?.maximumConsecutiveQuarterTurnCount) ||
        entry.rotationScore.maximumConsecutiveQuarterTurnCount < 0 ||
        entry.rotationScore.maximumConsecutiveQuarterTurnCount >
          bank.ranking.maximumConsecutiveQuarterTurnCount ||
        !Number.isFinite(entry?.rotationScore?.loopOrientationChangeDegrees) ||
        entry.rotationScore.loopOrientationChangeDegrees < 0 ||
        entry.rotationScore.loopOrientationChangeDegrees >
          bank.ranking.maximumLoopOrientationChangeDegrees ||
        entry.rotationScore.loopOrientationQuarterTurnCount !== 0 ||
        entry.rotationScore.loopOrientationDegrees !== bank.ranking.requiredLoopOrientationDegrees ||
        !Number.isFinite(entry?.rotationScore?.longestTurningRunDegrees) ||
        entry.rotationScore.longestTurningRunDegrees < 0 ||
        !Number.isSafeInteger(entry?.rotationScore?.longestTurningRunFrameCount) ||
        entry.rotationScore.longestTurningRunFrameCount < 0 ||
        !Number.isSafeInteger(entry?.rotationScore?.quarterTurnCount) ||
        !(entry?.rotationScore?.fullRotationEquivalentCount >= 0) ||
        !validPreparedUrl(entry.sceneUrl, ".json.gz") || entry.sceneEncoding !== "gzip" ||
        !validPreparedUrl(entry.snapshotUrl, ".html.gz") || entry.snapshotEncoding !== "gzip")) {
    throw new Error("Generated cssMaze manifest is invalid. Run pnpm prepare:cssmaze.");
  }
  if (route.requestedScene && !manifest.scenes.some((entry) => entry.id === route.requestedScene)) {
    throw new Error(`Unknown prepared cssMaze scene: ${route.requestedScene}`);
  }
  return manifest;
}

export async function loadPreparedScene(manifest, route, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const entry = selectPreparedSceneEntry(manifest, route, options);
  if (!entry || typeof entry.sceneUrl !== "string" || typeof entry.snapshotUrl !== "string") {
    throw new Error("Generated cssMaze prepared scene is missing. Run pnpm prepare:cssmaze.");
  }
  const cacheKey = `${entry.sceneUrl}\n${entry.snapshotUrl}`;
  let prepared = preparedSceneCache.get(cacheKey);
  if (!prepared) {
    prepared = Promise.all([
      fetchPreparedJson(fetchImpl, entry.sceneUrl, `cssMaze scene ${entry.id}`),
      fetchPreparedText(fetchImpl, entry.snapshotUrl, `cssMaze snapshot ${entry.id}`),
    ]);
    preparedSceneCache.set(cacheKey, prepared);
  }
  const [sceneData, snapshotHtml] = await prepared;
  if (sceneData?.schema !== "cssmaze-prepared-scene@1" || sceneData.id !== entry.id ||
      sceneData.sourceProfile?.seed !== entry.nativeSeed ||
      sceneData.sourceProfile?.rotationScore?.seed !== entry.nativeSeed ||
      sceneData.playback?.schema !== "cssmaze-prepared-playback@1" ||
      sceneData.playback.preparedCompositorInterpolation !== true ||
      sceneData.playback.preparedCompositorInterpolationMilliseconds !==
        sceneData.playback.sourceFrameDelayMilliseconds ||
      sceneData.playback.preparedCompositorTimingFunction !== "linear" ||
      sceneData.playback.preparedLoopResetTransition !== "instant" ||
      !Array.isArray(sceneData.playback.initialLeafVisibilityChanges) ||
      !Array.isArray(sceneData.playback.leafVisibilityChangeRows) ||
      sceneData.playback.leafVisibilityChangeRows.length !== sceneData.playback.stateCount ||
      sceneData.renderer?.textureBackend !== "atlas" ||
      sceneData.renderer?.textureLeafSizing !== "raster" ||
      sceneData.renderer?.textureProjection !== "affine") {
    throw new Error("Generated cssMaze scene contract drifted. Run pnpm prepare:cssmaze.");
  }
  return Object.freeze({ entry, sceneData, snapshotHtml });
}

export function selectPreparedSceneEntry(manifest, route, options = {}) {
  if (route.requestedScene) {
    return manifest.scenes.find((candidate) => candidate.id === route.requestedScene) ?? null;
  }
  const ids = manifest.preparedBank.sceneIds;
  if (ids.length < 1) return null;
  const randomUint32 = options.randomUint32 ?? startupRandomUint32();
  if (!Number.isSafeInteger(randomUint32) || randomUint32 < 0 || randomUint32 > 0xffffffff) {
    throw new RangeError("cssMaze prepared-bank random value must be uint32");
  }
  const selectedId = ids[randomUint32 % ids.length];
  return manifest.scenes.find((candidate) => candidate.id === selectedId) ?? null;
}

function startupRandomUint32() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}

async function fetchJson(fetchImpl, url, label) {
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${label}: ${response.status}. Run pnpm prepare:cssmaze.`);
  return response.json();
}

async function fetchPreparedJson(fetchImpl, url, label) {
  const response = await fetchPrepared(fetchImpl, url, label);
  return readPreparedJson(response);
}

async function fetchPreparedText(fetchImpl, url, label) {
  const response = await fetchPrepared(fetchImpl, url, label);
  return readPreparedText(response);
}

async function fetchPrepared(fetchImpl, url, label) {
  const response = await fetchImpl(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Failed to load ${label}: ${response.status}. Run pnpm prepare:cssmaze.`);
  return response;
}

function validPreparedUrl(url, suffix) {
  return typeof url === "string" && url.startsWith("/cssmaze/") &&
    url.endsWith(suffix) && !url.includes("..");
}

function validSharedSnapshotAtlases(atlases) {
  return Array.isArray(atlases) && atlases.length === 2 &&
    atlases.map((atlas) => atlas?.id).sort().join("\n") === "snapshot-atlas:surfaces\nsnapshot-atlas:walls" &&
    atlases.every((atlas) => atlas.encoding === "identity" &&
      validPreparedUrl(atlas.url, ".png") &&
      Number.isSafeInteger(atlas.byteLength) && atlas.byteLength > 0 &&
      /^[a-f0-9]{64}$/u.test(atlas.sha256));
}
