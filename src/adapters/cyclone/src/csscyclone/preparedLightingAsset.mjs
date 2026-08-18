export async function loadCyclonePreparedLightingAsset(lighting) {
  if (lighting?.schema !== "csscyclone-prepared-smooth-lighting-atlas@4" ||
      typeof lighting.assetUrl !== "string" ||
      !/^[a-f0-9]{64}$/u.test(lighting.assetSha256 ?? "") ||
      !Number.isSafeInteger(lighting.width) || lighting.width < 1 ||
      !Number.isSafeInteger(lighting.height) || lighting.height < 1) {
    throw new Error("Prepared Cyclone lighting asset contract is invalid");
  }
  const response = await fetch(lighting.assetUrl, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Prepared Cyclone lighting failed: ${response.status}`);
  const bytes = await response.arrayBuffer();
  const actualSha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (actualSha256 !== lighting.assetSha256) {
    throw new Error(`Prepared Cyclone lighting hash drifted (${actualSha256})`);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: lighting.mimeType }));
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
    if (image.naturalWidth !== lighting.width || image.naturalHeight !== lighting.height) {
      throw new Error(
        `Prepared Cyclone lighting dimensions drifted (${image.naturalWidth}x${image.naturalHeight})`,
      );
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
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
