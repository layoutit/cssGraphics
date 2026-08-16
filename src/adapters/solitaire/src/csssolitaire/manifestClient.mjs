const MANIFEST_URL = "/csssolitaire/manifest.json";

export async function loadPreparedSolitaire() {
  const manifest = await fetchJson(MANIFEST_URL);
  validateManifest(manifest);
  const [snapshotHtml, playback] = await Promise.all([
    fetchText(manifest.transport.snapshotUrl),
    fetchJson(manifest.transport.playbackUrl),
    decodeImage(manifest.transport.cardAtlasUrl),
  ]);
  validatePlayback(playback, manifest);
  return Object.freeze({ manifest, snapshotHtml, playback });
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Prepared cssSolitaire resource failed: ${url} (${response.status})`);
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function decodeImage(url) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  if (image.naturalWidth !== 1920 || image.naturalHeight !== 4160) {
    throw new Error("Prepared cssSolitaire card atlas dimensions drifted");
  }
  return image;
}

function validateManifest(manifest) {
  if (manifest?.schema !== "csssolitaire-manifest@1" || manifest.status !== "ready" ||
      manifest.scope !== "public-prepared-product" ||
      manifest.identity?.id !== "solitaire-victory" ||
      manifest.renderer?.morphTarget !== "createPolyMorphPreparedDomTarget" ||
      manifest.renderer?.profile !== "prepared-playback" ||
      manifest.renderer?.retainedDom !== true ||
      manifest.renderer?.textureBackend !== "atlas" ||
      manifest.renderer?.textureLeafSizing !== "raster" ||
      manifest.renderer?.seamBleed !== 0.2 ||
      manifest.renderer?.runtimeCanvasCount !== 0 ||
      manifest.renderer?.runtimeAtlasRasterization !== false ||
      manifest.renderer?.runtimeGeometryCalculation !== false ||
      manifest.renderer?.runtimeTrajectoryCalculation !== false ||
      manifest.renderer?.runtimeDomGrowth !== false ||
      manifest.transport?.runtimeModelPayload !== false ||
      manifest.metrics?.retainedLeafCount !== 8839 ||
      manifest.metrics?.foundationLeafCount !== 4 ||
      manifest.metrics?.preparedFrameCount !== 1647 ||
      manifest.metrics?.durationMs !== 70475) {
    throw new Error("Prepared cssSolitaire manifest drifted");
  }
}

function validatePlayback(playback, manifest) {
  if (playback?.schema !== "csssolitaire-prepared-playback@1" ||
      playback.durationMs !== manifest.metrics.durationMs || playback.loop !== true ||
      playback.sourceStepMilliseconds !== 7.5 || playback.initialHoldMilliseconds !== 500 ||
      playback.foundationLeafCount !== manifest.metrics.foundationLeafCount ||
      playback.retainedLeafCount !== manifest.metrics.retainedLeafCount ||
      !Array.isArray(playback.frameTimesMs) ||
      playback.frameTimesMs.length !== manifest.metrics.preparedFrameCount ||
      playback.frameTimesMs[0] !== 0 ||
      playback.frameTimesMs.some((time, index, times) =>
        !Number.isFinite(time) || time < 0 || (index > 0 && time <= times[index - 1])) ||
      !Array.isArray(playback.visibilityRows) ||
      playback.visibilityRows.length !== playback.frameTimesMs.length ||
      playback.visibilityRows.some((row) => !Array.isArray(row) || row.some((operation) =>
        !Number.isSafeInteger(operation) ||
        Math.abs(operation) <= playback.foundationLeafCount ||
        Math.abs(operation) > playback.retainedLeafCount)) ||
      playback.runtimeGeometryCalculation !== false ||
      playback.runtimeTrajectoryCalculation !== false ||
      playback.runtimeAtlasRasterization !== false ||
      playback.runtimeDomGrowth !== false) {
    throw new Error("Prepared cssSolitaire playback drifted");
  }
}
