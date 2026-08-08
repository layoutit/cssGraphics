import {
  sceneEntryForRoute,
  routeSceneLabel,
} from "./routeState.mjs";

export async function loadPreparedManifest(routeState) {
  const manifest = await fetchJson(routeState.manifestUrl, {
    notFoundMessage: "Missing generated cssMenger — XScreenSaver Menger manifest at " + routeState.manifestUrl + ". Run pnpm prepare:cssmenger first.",
  });
  if (manifest?.status !== "ready") {
    throw new Error("Generated cssMenger — XScreenSaver Menger manifest is not ready (" + (manifest?.status ?? "missing status") + "). Run pnpm prepare:cssmenger first.");
  }
  return manifest;
}

export async function loadPreparedScene(manifest, routeState) {
  const entry = sceneEntryForRoute(manifest, routeState);
  if (!entry || typeof entry.sceneUrl !== "string") {
    throw new Error("Generated cssMenger — XScreenSaver Menger manifest does not include " + routeSceneLabel(routeState) + ". Run pnpm prepare:cssmenger first.");
  }
  const sceneData = await fetchJson(entry.sceneUrl, {
    notFoundMessage: "Missing generated cssMenger — XScreenSaver Menger scene at " + entry.sceneUrl + ". Run pnpm prepare:cssmenger first.",
  });
  const snapshotHtml = typeof entry.snapshotUrl === "string" && entry.snapshotUrl
    ? await fetchText(entry.snapshotUrl, {
      notFoundMessage: "Missing generated cssMenger — XScreenSaver Menger PolyCSS snapshot at " + entry.snapshotUrl + ". Run pnpm prepare:cssmenger first.",
    })
    : null;
  return { entry, sceneData, snapshotHtml };
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
