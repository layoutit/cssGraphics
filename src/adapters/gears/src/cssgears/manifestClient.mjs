import {
  sceneEntryForRoute,
  routeSceneLabel,
} from "./routeState.mjs";

export async function loadPreparedManifest(routeState) {
  const manifest = await fetchJson(routeState.manifestUrl, {
    notFoundMessage: "Missing generated cssGears — XScreenSaver Gears manifest at " + routeState.manifestUrl + ". Run pnpm prepare:cssgears first.",
  });
  if (manifest?.status !== "ready") {
    throw new Error("Generated cssGears — XScreenSaver Gears manifest is not ready (" + (manifest?.status ?? "missing status") + "). Run pnpm prepare:cssgears first.");
  }
  const sceneIds = Array.isArray(manifest.scenes) ? manifest.scenes.map((scene) => scene?.id) : [];
  const bank = manifest.preparedBank;
  const showreel = manifest.showreel;
  if (manifest.schema !== "cssgears-manifest@3" || manifest.defaultScene?.id !== sceneIds[0] ||
      bank?.schema !== "cssgears-prepared-bank@2" || bank.selection !== "crypto-random-shuffled-bag-no-immediate-repeat" ||
      bank.runtimeSceneGeneration !== false || bank.runtimeGeometryConstruction !== false ||
      bank.mountedSceneCount !== 1 || bank.retainedSceneBankCount !== sceneIds.length ||
      showreel?.schema !== "cssgears-prepared-showreel-bank@2" || showreel.endless !== true ||
      showreel.selection !== "crypto-random-shuffled-bag-no-immediate-repeat" ||
      showreel.retainedSceneBankCount !== sceneIds.length || showreel.activeSceneCount !== 1 ||
      showreel.retainedGearRootCount !== 3 || showreel.runtimeDomGrowth !== false ||
      showreel.runtimeGeometryConstruction !== false || showreel.runtimeInterpolation !== false ||
      showreel.runtimeEasingCalculation !== false || showreel.preparedEdgeSelection !== true ||
      showreel.edgeSelectionPolicy !== "three-distinct-viewport-edges-no-pair-closer-than-locked-spacing" ||
      showreel.runtimeEdgeSelection !== false || showreel.runtimeRootClassWritesPerSwitch !== 3 ||
      showreel.runtimeRandomSelectionOnly !== true || typeof showreel.snapshotUrl !== "string" ||
      !Array.isArray(showreel.sceneTokens) || showreel.sceneTokens.length !== sceneIds.length ||
      showreel.sceneTokens.some(({ sceneId, token }, index) =>
        sceneId !== sceneIds[index] || !/^[a-z]$/u.test(token) || token === "d" || token === "g") ||
      !Array.isArray(bank.sceneIds) || !Array.isArray(bank.seeds) ||
      bank.sceneIds.length !== sceneIds.length || bank.seeds.length !== sceneIds.length ||
      bank.sceneIds.some((id, index) => id !== sceneIds[index]) ||
      !manifest.scenes.every((scene, index) => scene?.nativeSeed === bank.seeds[index])) {
    throw new Error("Generated cssGears manifest contract is invalid. Run pnpm prepare:cssgears first.");
  }
  return manifest;
}

export async function loadPreparedScene(manifest, routeState, options = {}) {
  const randomUint32 = routeState.scene ? 0 : (options.randomUint32 ?? startupRandomUint32)();
  const entry = sceneEntryForRoute(manifest, routeState, randomUint32);
  if (!entry || typeof entry.sceneUrl !== "string") {
    throw new Error("Generated cssGears — XScreenSaver Gears manifest does not include " + routeSceneLabel(routeState) + ". Run pnpm prepare:cssgears first.");
  }
  const entries = routeState.scene ? [entry] : manifest.scenes;
  if (entries.some((candidate) => !candidate || typeof candidate.sceneUrl !== "string")) {
    throw new Error("Generated cssGears showreel does not match its prepared bank.");
  }
  const scenes = await Promise.all(entries.map((candidate) => fetchJson(candidate.sceneUrl, {
    notFoundMessage: "Missing generated cssGears — XScreenSaver Gears scene at " + candidate.sceneUrl + ". Run pnpm prepare:cssgears first.",
  })));
  const snapshotUrl = routeState.scene ? entry.snapshotUrl : manifest.showreel.snapshotUrl;
  const snapshotHtml = typeof snapshotUrl === "string" && snapshotUrl
    ? await fetchText(snapshotUrl, {
      notFoundMessage: "Missing generated cssGears — XScreenSaver Gears PolyCSS snapshot at " + snapshotUrl + ". Run pnpm prepare:cssgears first.",
    })
    : null;
  if (scenes.some((sceneData, index) =>
    sceneData?.id !== entries[index].id || sceneData?.sourceProfile?.seed !== entries[index].nativeSeed ||
    sceneData?.showreel?.edgeSelection?.seed !== entries[index].nativeSeed ||
    sceneData?.showreel?.edgeSelection?.crossingPairCount !== 0 ||
    sceneData?.showreel?.edgeSelection?.continuousPathQualification !== true ||
    sceneData?.showreel?.runtimeEdgeSelection !== false ||
    new Set(sceneData?.showreel?.entryEdges).size !== 3)) {
    throw new Error("Generated cssGears scene does not match its prepared bank entry.");
  }
  return {
    entry,
    entries: Object.freeze(entries),
    sceneData: scenes[entries.indexOf(entry)],
    scenes: Object.freeze(scenes),
    bankTokens: Object.freeze(routeState.scene
      ? [null]
      : manifest.showreel.sceneTokens.map(({ token }) => token)),
    snapshotHtml,
    selection: Object.freeze({
      mode: routeState.scene ? "explicit-prepared-scene" : "random-prepared-shuffled-bank",
      sceneId: entry.id,
      nativeSeed: entry.nativeSeed,
      bankIndex: entries.indexOf(entry),
    }),
  };
}

function startupRandomUint32() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0];
}

async function fetchJson(url, { notFoundMessage = "" } = {}) {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404 && notFoundMessage) throw new Error(notFoundMessage);
    throw new Error("Failed to load " + url + ": " + response.status);
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
  return response.text();
}
