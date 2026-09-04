// SPDX-License-Identifier: HPND
// Expanded only during preparation or loading, never in the animation callback.
export function mobileFaceTransforms(heightUnits, width, depth, heightScale) {
  const height = heightUnits * heightScale / 1000;
  return [
    `matrix(${width},${width * 0.22},${-depth * 0.36},${depth * 0.6},0,${-height})`,
    `matrix(${width},${width * 0.22},0,${height},${-depth * 0.36},${depth * 0.6 - height})`,
    `matrix(${depth * 0.36},${-depth * 0.6},0,${height},${width - depth * 0.36},${width * 0.22 + depth * 0.6 - height})`,
  ];
}

export function decodeMobileHeights(playback) {
  if (playback?.schema !== "csscityflow-mobile-playback@1" ||
      !Number.isSafeInteger(playback.boxCount) || playback.boxCount < 1 || playback.boxCount > 100 ||
      playback.footprints?.length !== playback.boxCount || playback.facesPerBox !== 3 ||
      playback.frameCount !== 360 || playback.framesPerSecond !== 60 ||
      !Number.isFinite(playback.heightScale) || playback.heightScale <= 0 || playback.heightScale > 2 ||
      playback.heightEncoding !== "uint16-le-millipixels-base64" ||
      typeof playback.heightsBase64 !== "string") {
    throw new Error("Cityflow mobile playback contract drifted");
  }
  for (const footprint of playback.footprints) {
    if (!Array.isArray(footprint) || footprint.length !== 2 ||
        footprint.some((value) => !Number.isFinite(value) || value < 28 || value > 120)) {
      throw new Error("Cityflow mobile footprint is out of bounds");
    }
  }
  const bytes = Uint8Array.from(atob(playback.heightsBase64), (char) => char.charCodeAt(0));
  if (bytes.length !== playback.boxCount * playback.frameCount * 2) {
    throw new Error("Cityflow mobile height stream is incomplete");
  }
  const view = new DataView(bytes.buffer);
  const heights = new Uint16Array(bytes.length / 2);
  for (let index = 0; index < heights.length; index += 1) {
    const value = view.getUint16(index * 2, true);
    if (value < 18000 || value > 62000) throw new Error("Cityflow mobile height is out of bounds");
    heights[index] = value;
  }
  return heights;
}
