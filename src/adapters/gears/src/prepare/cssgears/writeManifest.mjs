import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  generatedPublicRoot,
  generatedScenePath,
  generatedSceneUrl,
  manifestPath,
} from "./paths.mjs";
import { assertNoBrowserPathLeaks } from "./provenance.mjs";
import { preparedLightingAssetBytes } from "./preparedLighting.mjs";

const BANK_TOKENS = "abcefhijklmnopqrstuvwxyz";

export async function writeCssgearsPreparedOutput({
  title = "cssGears — XScreenSaver Gears",
  scenes,
  defaultSceneId,
  preparedBank,
  warnings = [],
  debugApi = "window.__cssGearsDebug",
} = {}) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("writeCssgearsPreparedOutput requires at least one prepared scene.");
  }
  await mkdir(generatedPublicRoot, { recursive: true });
  const manifestScenes = [];
  for (const scene of scenes) {
    await writePreparedLightingAsset(scene.lighting);
    await writeJsonAtomic(generatedScenePath(scene.id), scene);
    const snapshot = snapshotEntryForScene(scene);
    manifestScenes.push({
      id: scene.id,
      label: scene.label,
      nativeSeed: scene.sourceProfile?.seed,
      sourceProfileId: scene.sourceProfile?.id,
      sceneUrl: generatedSceneUrl(scene.id),
      ...snapshot,
      metrics: scene.metrics ?? {},
      oracle: scene.oracle ?? {},
      warnings: scene.warnings ?? [],
    });
  }
  const defaultId = defaultSceneId ?? scenes[0].id;
  if (preparedBank?.schema !== "cssgears-prepared-bank@2" ||
      preparedBank.sceneIds?.length !== scenes.length ||
      preparedBank.sceneIds.some((id, index) => id !== scenes[index].id) ||
      preparedBank.seeds?.some((seed, index) => seed !== scenes[index].sourceProfile?.seed)) {
    throw new Error("Prepared cssGears bank does not match its prepared scenes");
  }
  const leafCounts = scenes.map((scene) => scene.metrics.preparedLeafCount);
  const sourceFaceCounts = scenes.map((scene) => scene.metrics.sourcePolygonCount);
  const bankTokens = scenes.map((scene, index) => ({
    sceneId: scene.id,
    token: BANK_TOKENS[index],
  }));
  if (bankTokens.some(({ token }) => !token)) {
    throw new Error("Prepared cssGears retained bank supports at most 24 short scene tokens");
  }
  const retainedLeafCount = leafCounts.reduce((total, count) => total + count, 0);
  const showreelEnabled = scenes.length > 1;
  const manifest = {
    schema: "cssgears-manifest@3",
    status: "ready",
    title,
    artifactMode: "prepared-polycss-snapshot",
    scaffoldMode: "model-viewer",
    generatedAssetRoot: "/cssgears/",
    defaultScene: { id: defaultId },
    scenes: manifestScenes,
    preparedBank,
    showreel: {
      schema: "cssgears-prepared-showreel-bank@2",
      enabledOnRootRoute: showreelEnabled,
      endless: showreelEnabled,
      selection: "crypto-random-shuffled-bag-no-immediate-repeat",
      snapshotUrl: showreelEnabled ? "/cssgears/scenes/bank.showreel.polycss.html" : null,
      sceneTokens: bankTokens,
      retainedLeafCount,
      retainedSceneBankCount: scenes.length,
      activeSceneCount: 1,
      retainedGearRootCount: 3,
      runtimeDomGrowth: false,
      runtimeGeometryConstruction: false,
      runtimeInterpolation: false,
      runtimeEasingCalculation: false,
      preparedEdgeSelection: true,
      edgeSelectionPolicy: "three-distinct-viewport-edges-no-pair-closer-than-locked-spacing",
      runtimeEdgeSelection: false,
      runtimeRootClassWritesPerSwitch: 3,
      runtimeRandomSelectionOnly: true,
      phases: scenes[0].showreel?.phases ?? null,
    },
    source: scenes[0].source,
    sourceProfileIds: scenes.map((scene) => scene.sourceProfile?.id),
    renderer: scenes[0].renderer,
    metrics: {
      preparedSceneCount: scenes.length,
      mountedSceneCount: 1,
      retainedSceneBankCount: scenes.length,
      minimumPreparedLeafCount: Math.min(...leafCounts),
      maximumPreparedLeafCount: Math.max(...leafCounts),
      maximumRetainedShowreelLeafCount: retainedLeafCount,
      minimumSourceFaceCount: Math.min(...sourceFaceCounts),
      maximumSourceFaceCount: Math.max(...sourceFaceCounts),
      runtimeSceneGenerationCount: 0,
      runtimeGeometryConstructionCount: 0,
      runtimeCameraCalculationCount: 0,
      runtimeDomGrowth: false,
    },
    oracle: {
      selection: "explicit-scene-route-required-for-seed-specific-oracle",
      defaultScene: scenes[0].oracle,
    },
    warnings,
    runtime: {
      debugApi,
      routeContract: "/ starts one random prepared scene and shuffles the full retained bank; ?scene=<scene-id> pins one source segment",
      startupRandomSelectionCount: 1,
      transitionSelection: "shuffled-bag-no-immediate-repeat",
      runtimeSceneGenerationCount: 0,
      runtimeCameraCalculationCount: 0,
    },
  };
  await writeJsonAtomic(manifestPath, manifest);
  return { manifestPath, manifest };
}

async function writePreparedLightingAsset(lighting) {
  const bytes = preparedLightingAssetBytes(lighting);
  if (!bytes) throw new Error("Prepared cssGears lighting bytes are missing");
  if (lighting?.schema !== "cssgears-prepared-opengl-static-render-atlas@1" ||
      !/^\/cssgears\/assets\/render-[a-f0-9]{64}\.png$/u.test(lighting.assetUrl)) {
    throw new Error("Prepared cssGears lighting contract is invalid");
  }
  const assetPath = join(generatedPublicRoot, lighting.assetUrl.replace(/^\/cssgears\//u, ""));
  await mkdir(dirname(assetPath), { recursive: true });
  const temporary = `${assetPath}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, assetPath);
}

function snapshotEntryForScene(scene) {
  if (scene.snapshotUrl) {
    return {
      snapshotUrl: scene.snapshotUrl,
      snapshotKind: scene.snapshotKind ?? "polycss-exported-html",
      artifactKind: "prepared-polycss-snapshot",
    };
  }
  if ("prepared-polycss-snapshot" !== "prepared-polycss-snapshot") return {};
  return {
    snapshotUrl: "/cssgears/scenes/" + scene.id + ".polycss.html",
    snapshotKind: "polycss-exported-html",
    artifactKind: "prepared-polycss-snapshot",
  };
}

async function writeJsonAtomic(path, value) {
  assertNoBrowserPathLeaks(value);
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n");
  await rename(tmp, path);
}
