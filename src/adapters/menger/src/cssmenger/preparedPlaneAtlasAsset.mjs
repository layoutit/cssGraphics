export async function loadPreparedMengerPlaneAtlasAsset(atlas) {
  if (atlas?.schema !== "cssmenger-prepared-sparse-leaf-lighting-atlas@1" ||
      !/^\/cssmenger\/assets\/lighting-grid-[a-f0-9]{64}\.avif$/u.test(atlas.assetUrl) ||
      !/^[a-f0-9]{64}$/u.test(atlas.assetSha256) ||
      atlas.encoding !== "AVIF-lossy-q83-alpha-lossless-yuv444" ||
      atlas.quality !== 83 || atlas.alphaQuality !== 100 || atlas.chromaSubsampling !== "4:4:4" ||
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
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/avif" }));
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
    if (image.naturalWidth !== atlas.width || image.naturalHeight !== atlas.height) {
      throw new Error(`Prepared cssMenger plane atlas dimensions drifted (${image.naturalWidth}x${image.naturalHeight})`);
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  let destroyed = false;
  return Object.freeze({
    url,
    byteLength: bytes.byteLength,
    sha256: actualSha256,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      URL.revokeObjectURL(url);
    },
  });
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
