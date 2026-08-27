// SPDX-License-Identifier: MIT
import { decodeChaosTrajectoryAsset, formatChaosTransform } from
  "../shared/cssdysts/preparedRailTransport.mjs";

self.addEventListener("message", async ({ data }) => {
  const requestId = data?.requestId;
  try {
    if (data?.type !== "materialize" || !Number.isSafeInteger(requestId) || requestId < 1 ||
        !(data.bytes instanceof ArrayBuffer)) {
      throw new Error("Chaos worker request drifted");
    }
    const startedAt = performance.now();
    const asset = decodeChaosTrajectoryAsset(new Uint8Array(data.bytes), data.descriptor);
    const transforms = new Array(data.descriptor.sampleCount);
    let maximumSliceMilliseconds = 0;
    let sliceStartedAt = performance.now();
    for (let index = 0; index < transforms.length; index += 1) {
      transforms[index] = formatChaosTransform(
        asset.coordinates[index * 3], asset.coordinates[index * 3 + 1],
        asset.coordinates[index * 3 + 2]);
      if ((index & 0x3ff) === 0 && performance.now() - sliceStartedAt >= 4) {
        maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
          performance.now() - sliceStartedAt);
        await new Promise((resolve) => setTimeout(resolve, 0));
        sliceStartedAt = performance.now();
      }
    }
    maximumSliceMilliseconds = Math.max(maximumSliceMilliseconds,
      performance.now() - sliceStartedAt);
    self.postMessage({
      type: "ready",
      requestId,
      transforms,
      coordinates: asset.coordinates,
      handoffControlCoordinates: asset.handoffControlCoordinates,
      leafPhaseIndices: asset.leafPhaseIndices,
      leafRevealOrder: asset.leafRevealOrder,
      workerDurationMilliseconds: performance.now() - startedAt,
      workerMaximumSliceMilliseconds: maximumSliceMilliseconds,
    }, [asset.coordinates.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", requestId, message: String(error?.stack || error) });
  }
});
