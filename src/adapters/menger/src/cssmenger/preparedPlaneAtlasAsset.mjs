export async function loadPreparedMengerPlaneAtlasAsset(atlas) {
  if ((!validLightingAtlas(atlas) && !validCssOpacityAtlas(atlas)) ||
      !/^[a-f0-9]{64}$/u.test(atlas?.assetSha256) ||
      !Number.isSafeInteger(atlas.byteLength) || atlas.byteLength <= 0 ||
      !Number.isSafeInteger(atlas.width) || !Number.isSafeInteger(atlas.height)) {
    throw new Error("Prepared cssMenger plane atlas contract is invalid");
  }
  let retained = true;
  return Object.freeze({
    url: atlas.assetUrl,
    byteLength: atlas.byteLength,
    sha256: atlas.assetSha256,
    contractSchema: atlas.schema,
    paletteRole: atlas.paletteRole ?? null,
    cssImageBinding: "prepared-direct-stylesheet-url",
    destroy() {
      if (!retained) return;
      retained = false;
    },
    get retained() { return retained; },
  });
}

function validLightingAtlas(atlas) {
  if (atlas?.schema !== "cssmenger-prepared-sparse-leaf-lighting-atlas@1" ||
      !["desktop", "mobile"].includes(atlas.profile) || atlas.quality !== 83 ||
      atlas.alphaQuality !== 100 || atlas.chromaSubsampling !== "4:4:4") return false;
  if (atlas.presentation === "source-rgb") {
    return /^\/cssmenger\/assets\/lighting-grid(?:-mobile)?-[a-f0-9]{64}\.webp$/u.test(atlas.assetUrl) &&
      atlas.encoding === "WebP-lossless-transcode-of-AVIF-q83-alpha-lossless-yuv444" &&
      atlas.mimeType === "image/webp" && atlas.lossless === true;
  }
  return atlas.presentation === "css-black-alpha" &&
    /^\/cssmenger\/assets\/lighting-shadow-grid-[a-f0-9]{64}\.avif$/u.test(atlas.assetUrl) &&
    atlas.encoding === "AVIF-lossy-q83-alpha-lossless-yuv444" && atlas.mimeType === "image/avif";
}

function validCssOpacityAtlas(atlas) {
  return atlas?.schema === "cssmenger-prepared-coplanar-plane-atlas@1" &&
    atlas.paletteRole === "css-opacity-base" &&
    atlas.rgbScale === 0.75 &&
    /^\/cssmenger\/assets\/planes-opacity-base-[a-f0-9]{64}\.png$/u.test(atlas.assetUrl) &&
    atlas.encoding === "PNG-RGBA8";
}
