export async function loadFlocksManifest() {
  const response = await fetch("/cssflocks/manifest.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Flocks manifest failed: ${response.status}`);
  const manifest = await response.json();
  if (manifest?.schema !== "cssflocks-manifest@1" || manifest.status !== "ready") {
    throw new Error("Flocks manifest is not ready");
  }
  return Object.freeze(manifest);
}

export async function loadFlocksJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Flocks prepared asset failed: ${response.status} ${url}`);
  return response.json();
}
