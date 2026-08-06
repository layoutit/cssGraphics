function validateMaterialIndices(indices, pipeCount, materialCount, label) {
  if (!Array.isArray(indices) || indices.length !== pipeCount ||
      indices.some((index) => !Number.isInteger(index) ||
        index < 0 || index >= materialCount)) {
    throw new TypeError(`${label} must bind one prepared material per pipe`);
  }
}

export function buildPreparedMaterialBindings(scene) {
  const playback = scene?.playback;
  const lighting = scene?.lighting;
  const pipeCount = playback?.pipeCount;
  const retainedBankCount = playback?.retainedBankCount;
  const materialCount = lighting?.materialColors?.length;
  if (!Number.isInteger(pipeCount) || pipeCount < 1 ||
      !Number.isInteger(retainedBankCount) || retainedBankCount < 1 ||
      !Number.isInteger(materialCount) || materialCount < pipeCount ||
      playback.materials?.materialCount !== materialCount ||
      lighting.materialFieldStride !== playback.radialSegments ||
      lighting.faces?.length !== materialCount * playback.radialSegments ||
      playback.clips?.length !== playback.clipCount) {
    throw new Error("Prepared clip material bindings are incomplete");
  }

  const rows = [];
  const usage = new Uint32Array(materialCount);
  const fallback = playback.clips[0]?.materialIndicesByPipe;
  validateMaterialIndices(fallback, pipeCount, materialCount, "Fallback clip");
  for (let materialIndex = 0; materialIndex < materialCount; materialIndex += 1) {
    for (let side = 0; side < playback.radialSegments; side += 1) {
      const field = lighting.faces[materialIndex * lighting.materialFieldStride + side];
      if (field?.materialIndex !== materialIndex || field?.side !== side ||
          typeof field.backgroundPositionX !== "string") {
        throw new Error(`Prepared material ${materialIndex}:${side} has no atlas field`);
      }
      rows.push(
        `.m${materialIndex} > .${String.fromCharCode(97 + side)} { ` +
        `background-position-x: ${field.backgroundPositionX}; }`,
      );
    }
  }

  for (let clipIndex = 0; clipIndex < playback.clips.length; clipIndex += 1) {
    const indices = playback.clips[clipIndex].materialIndicesByPipe;
    validateMaterialIndices(
      indices,
      pipeCount,
      materialCount,
      `Prepared clip ${clipIndex}`,
    );
    for (const materialIndex of indices) usage[materialIndex] += 1;
  }

  return Object.freeze({
    schema: "csspipes-prepared-material-classes@1",
    bindingCount: materialCount * playback.radialSegments,
    fallbackBindingCount: 0,
    materialUsage: Object.freeze([...usage]),
    css: `${rows.join("\n")}\n`,
    runtimeRandomness: false,
    runtimePerLeafColorWrites: 0,
  });
}
