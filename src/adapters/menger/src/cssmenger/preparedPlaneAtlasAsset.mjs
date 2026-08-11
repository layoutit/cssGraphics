export async function loadPreparedMengerPlaneAtlasAsset(atlas) {
  if ((!validLightingAtlas(atlas) && !validCssOpacityAtlas(atlas)) ||
      !/^[a-f0-9]{64}$/u.test(atlas?.assetSha256) ||
      !Number.isSafeInteger(atlas.byteLength) || atlas.byteLength <= 0 ||
      !Number.isSafeInteger(atlas.width) || !Number.isSafeInteger(atlas.height)) {
    throw new Error("Prepared cssMenger plane atlas contract is invalid");
  }
  const response = await fetch(atlas.assetUrl, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Failed to load prepared cssMenger plane atlas: ${response.status}`);
  const bytes = await response.arrayBuffer();
  const actualSha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (bytes.byteLength !== atlas.byteLength || actualSha256 !== atlas.assetSha256) {
    throw new Error(`Prepared cssMenger plane atlas hash drifted (${actualSha256})`);
  }
  let retained = true;
  return Object.freeze({
    url: atlas.assetUrl,
    byteLength: bytes.byteLength,
    sha256: actualSha256,
    contractSchema: atlas.schema,
    paletteRole: atlas.paletteRole ?? null,
    decodedImageRetention: "css-background-lifetime",
    destroy() {
      retained = false;
    },
    get retained() { return retained; },
  });
}

function validLightingAtlas(atlas) {
  return atlas?.schema === "cssmenger-prepared-sparse-leaf-lighting-atlas@1" &&
    /^\/cssmenger\/assets\/lighting-(?:grid(?:-mobile)?|shadow-grid)-[a-f0-9]{64}\.avif$/u.test(atlas.assetUrl) &&
    ["desktop", "mobile"].includes(atlas.profile) &&
    atlas.encoding === "AVIF-lossy-q83-alpha-lossless-yuv444" &&
    atlas.quality === 83 && atlas.alphaQuality === 100 && atlas.chromaSubsampling === "4:4:4";
}

function validCssOpacityAtlas(atlas) {
  return atlas?.schema === "cssmenger-prepared-coplanar-plane-atlas@1" &&
    atlas.paletteRole === "css-opacity-base" &&
    /^\/cssmenger\/assets\/planes-opacity-base-[a-f0-9]{64}\.png$/u.test(atlas.assetUrl) &&
    atlas.encoding === "PNG-RGBA8";
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
