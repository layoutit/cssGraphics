const MATERIAL_OFFSET_PROPERTY = "--csspipes-material-offset";
const MATERIAL_COLOR_PROPERTY = "--csspipes-material-color";

function validateMaterialIndices(indices, pipeCount, materialCount, label) {
  if (!Array.isArray(indices) || indices.length !== pipeCount ||
      indices.some((index) => !Number.isInteger(index) ||
        index < 0 || index >= materialCount)) {
    throw new TypeError(`${label} must bind one prepared material per pipe`);
  }
}

function materialDeclaration(lighting, materialIndex) {
  const color = lighting.materialColors[materialIndex];
  const field = lighting.faces[materialIndex * lighting.materialFieldStride];
  if (!/^#[0-9a-f]{6}$/iu.test(color) ||
      field?.materialIndex !== materialIndex || field?.side !== 0 ||
      typeof field.backgroundPositionX !== "string") {
    throw new Error(`Prepared material ${materialIndex} has no stable atlas origin`);
  }
  return `${MATERIAL_OFFSET_PROPERTY}: ${field.backgroundPositionX}; ` +
    `${MATERIAL_COLOR_PROPERTY}: ${color};`;
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
  for (let side = 0; side < playback.radialSegments; side += 1) {
    rows.push(
      `[data-csspipes-pipe-root] [data-csspipes-surface="wall"]` +
      `[data-csspipes-cylinder-side="${side}"] { ` +
      `background-position-x: calc(var(${MATERIAL_OFFSET_PROPERTY}) - ` +
      `${side * lighting.leafWidth}px) !important; }`,
    );
  }
  rows.push(
    `[data-csspipes-pipe-root] [data-csspipes-surface="end-cap"] { ` +
    `color: var(${MATERIAL_COLOR_PROPERTY}) !important; }`,
  );
  const fallback = playback.clips[0]?.materialIndicesByPipe;
  validateMaterialIndices(fallback, pipeCount, materialCount, "Fallback clip");
  for (let bank = 0; bank < retainedBankCount; bank += 1) {
    for (let pipe = 0; pipe < pipeCount; pipe += 1) {
      rows.push(
        `[data-csspipes-playback-root] > ` +
        `[data-csspipes-bank-index="${bank}"]` +
        `[data-csspipes-pipe-root="${pipe}"] { ` +
        `${materialDeclaration(lighting, fallback[pipe])} }`,
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
    for (let bank = 0; bank < retainedBankCount; bank += 1) {
      for (let pipe = 0; pipe < pipeCount; pipe += 1) {
        const materialIndex = indices[pipe];
        if (bank === 0) usage[materialIndex] += 1;
        rows.push(
          `[data-csspipes-playback-root] > ` +
          `[data-csspipes-bank-index="${bank}"]` +
          `[data-csspipes-pipe-root="${pipe}"]` +
          `[data-csspipes-material-clip="${clipIndex}"] { ` +
          `${materialDeclaration(lighting, materialIndex)} }`,
        );
      }
    }
  }

  return Object.freeze({
    schema: "csspipes-prepared-material-bindings@2",
    selectorAttribute: "data-csspipes-material-clip",
    bindingCount: playback.clipCount * pipeCount * retainedBankCount,
    fallbackBindingCount: pipeCount * retainedBankCount,
    materialUsage: Object.freeze([...usage]),
    css: `${rows.join("\n")}\n`,
    runtimeRandomness: false,
    runtimePerLeafColorWrites: 0,
  });
}
