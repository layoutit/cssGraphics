// SPDX-License-Identifier: MIT

export const CSSBLACKHOLE_LOCAL_SIDE_TILT_MODE = "side-tilt";

export function resolveBlackHoleLocalPlaybackMode(location) {
  const hostname = location?.hostname;
  const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  if (!isLoopback) return null;
  return new URLSearchParams(location.search).get("topdown") === "0"
    ? CSSBLACKHOLE_LOCAL_SIDE_TILT_MODE
    : null;
}
