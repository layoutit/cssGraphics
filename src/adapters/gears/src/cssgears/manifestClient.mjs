import {
  sceneEntryForRoute,
  routeSceneLabel,
} from "./routeState.mjs";
import { readPreparedJson, readPreparedText } from "./preparedResponse.mjs";

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
  if (manifest.schema !== "cssgears-manifest@4" || manifest.defaultScene?.id !== sceneIds[0] ||
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
      showreel.runtimeRandomSelectionOnly !== true || !isPreparedGzipUrl(showreel.snapshotUrl, ".html.gz") ||
      !Array.isArray(showreel.sceneTokens) || showreel.sceneTokens.length !== sceneIds.length ||
      showreel.sceneTokens.some(({ sceneId, token }, index) =>
        sceneId !== sceneIds[index] || !/^[a-z]$/u.test(token) || token === "d" || token === "g") ||
      !Array.isArray(bank.sceneIds) || !Array.isArray(bank.seeds) ||
      bank.sceneIds.length !== sceneIds.length || bank.seeds.length !== sceneIds.length ||
      bank.sceneIds.some((id, index) => id !== sceneIds[index]) ||
      !manifest.scenes.every((scene, index) => scene?.nativeSeed === bank.seeds[index] &&
        isPreparedGzipUrl(scene.sceneUrl, ".json.gz") &&
        isPreparedGzipUrl(scene.snapshotUrl, ".html.gz") &&
        validLightingDescriptor(scene.lighting))) {
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
  const sceneStore = createPreparedSceneStore(entries, options.fetchImpl);
  const selectedIndex = entries.indexOf(entry);
  const snapshotUrl = routeState.scene ? entry.snapshotUrl : manifest.showreel.snapshotUrl;
  const [sceneData, snapshotHtml] = await Promise.all([
    sceneStore.load(selectedIndex),
    typeof snapshotUrl === "string" && snapshotUrl
      ? fetchPreparedText(snapshotUrl, {
      notFoundMessage: "Missing generated cssGears — XScreenSaver Gears PolyCSS snapshot at " + snapshotUrl + ". Run pnpm prepare:cssgears first.",
      }, options.fetchImpl)
      : null,
  ]);
  return {
    entry,
    entries: Object.freeze(entries),
    sceneData,
    sceneStore,
    bankTokens: Object.freeze(routeState.scene
      ? [null]
      : manifest.showreel.sceneTokens.map(({ token }) => token)),
    snapshotHtml,
    selection: Object.freeze({
      mode: routeState.scene ? "explicit-prepared-scene" : "random-prepared-shuffled-bank",
      sceneId: entry.id,
      nativeSeed: entry.nativeSeed,
      bankIndex: selectedIndex,
    }),
  };
}

export function createPreparedSceneStore(entries, fetchImpl = globalThis.fetch) {
  const requests = new Map();
  const values = new Map();

  function load(index) {
    const entry = entries[index];
    if (!entry) throw new RangeError(`Prepared cssGears bank ${index} is out of range`);
    let request = requests.get(index);
    if (!request) {
      request = fetchPreparedJson(entry.sceneUrl, {
        notFoundMessage: "Missing generated cssGears — XScreenSaver Gears scene at " + entry.sceneUrl + ". Run pnpm prepare:cssgears first.",
      }, fetchImpl).then((scene) => {
        validatePreparedScene(scene, entry);
        values.set(index, scene);
        return scene;
      });
      requests.set(index, request);
    }
    return request;
  }

  return Object.freeze({
    load,
    loaded(index) {
      return values.get(index) ?? null;
    },
    async preload(indices, { concurrency = 4, onLoad = () => undefined } = {}) {
      const queue = [...new Set(indices)];
      if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
        throw new RangeError("Prepared cssGears preload concurrency must be positive");
      }
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (cursor < queue.length) {
          const index = queue[cursor];
          cursor += 1;
          const scene = await load(index);
          await onLoad(scene, index);
        }
      }));
    },
  });
}

function startupRandomUint32() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0];
}

async function fetchJson(url, { notFoundMessage = "" } = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { cache: "no-store" });
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

async function fetchPreparedJson(url, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchPrepared(url, options, fetchImpl);
  return readPreparedJson(response);
}

async function fetchPreparedText(url, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchPrepared(url, options, fetchImpl);
  return readPreparedText(response);
}

async function fetchPrepared(url, { notFoundMessage = "" } = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { cache: "force-cache" });
  if (!response.ok) {
    if (response.status === 404 && notFoundMessage) throw new Error(notFoundMessage);
    throw new Error("Failed to load " + url + ": " + response.status);
  }
  return response;
}

function validatePreparedScene(sceneData, entry) {
  if (sceneData?.id !== entry.id || sceneData?.sourceProfile?.seed !== entry.nativeSeed ||
      sceneData?.showreel?.edgeSelection?.seed !== entry.nativeSeed ||
      sceneData?.showreel?.edgeSelection?.crossingPairCount !== 0 ||
      sceneData?.showreel?.edgeSelection?.continuousPathQualification !== true ||
      sceneData?.showreel?.runtimeEdgeSelection !== false ||
      new Set(sceneData?.showreel?.entryEdges).size !== 3 ||
      sceneData?.lighting?.assetSha256 !== entry.lighting.assetSha256 ||
      sceneData?.metrics?.preparedLeafCount !== entry.metrics?.preparedLeafCount) {
    throw new Error("Generated cssGears scene does not match its prepared bank entry.");
  }
}

function validLightingDescriptor(lighting) {
  return lighting?.schema === "cssgears-prepared-lighting-descriptor@1" &&
    /^\/cssgears\/assets\/render-[a-f0-9]{64}\.png$/u.test(lighting.assetUrl ?? "") &&
    /^[a-f0-9]{64}$/u.test(lighting.assetSha256 ?? "") &&
    Number.isSafeInteger(lighting.assetByteLength) && lighting.assetByteLength > 0 &&
    Number.isSafeInteger(lighting.width) && lighting.width > 0 &&
    Number.isSafeInteger(lighting.height) && lighting.height > 0;
}

function isPreparedGzipUrl(url, suffix) {
  return typeof url === "string" && url.startsWith("/cssgears/") &&
    url.endsWith(suffix) && !url.includes("..");
}
