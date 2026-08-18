import { createPolyMorphPreparedDomTarget } from "@layoutit/polycss-morph";

const MATRIX_PATTERN = /^matrix3d\(-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?){15}\)$/u;
const decodedPackets = new WeakMap();

export function createCityflowPreparedPlayer({ playback, mounted, shapeElements, ...overrides }) {
  const decoded = validatePlayback(playback, mounted, shapeElements);
  const transforms = playback.transforms;
  const transformIndices = decoded.transformIndices;
  const colorIndices = decoded.colorIndices;
  const frameCount = playback.frameCount;
  const boxCount = playback.boxCount;
  const frameMilliseconds = playback.tickIntervalUs[0] / playback.tickIntervalUs[1] / 1_000;
  const requestFrame = overrides.requestFrame ?? globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame = overrides.cancelFrame ?? globalThis.cancelAnimationFrame.bind(globalThis);
  const requestDelay = overrides.requestDelay ?? globalThis.setTimeout.bind(globalThis);
  const cancelDelay = overrides.cancelDelay ?? globalThis.clearTimeout.bind(globalThis);
  const readNow = overrides.readNow ?? globalThis.performance.now.bind(globalThis.performance);
  const target = createPolyMorphPreparedDomTarget({
    model: {
      element: mounted.modelElement,
      writeTransform(transform) {
        if (mounted.modelElement.style.transform === transform) return false;
        mounted.modelElement.style.transform = transform;
        return true;
      },
    },
    shapes: shapeElements.map((element) => ({ element })),
    leaves: [],
  });
  const currentTransformIndices = transformIndices.slice(0, boxCount);
  const currentColorIndices = colorIndices.slice(0, boxCount);
  const colorClasses = Array.from({ length: 256 }, (_, index) => `csscityflow-color-${index}`);
  let paused = true;
  let timer = null;
  let request = null;
  let clockOrigin = readNow();
  let tick = 0;
  let frameIndex = 0;
  let timerCallbackCount = 0;
  let animationFrameCallbackCount = 0;
  let transformWrites = 0;
  let colorWrites = 0;
  let collapsedTickCount = 0;
  let publicationCount = 0;
  let lastTransformWrites = 0;
  let lastColorWrites = 0;

  for (let index = 0; index < boxCount; index += 1) {
    shapeElements[index].classList.add(colorClasses[currentColorIndices[index]]);
    target.shapes[index].writeTransform(transforms[currentTransformIndices[index]]);
  }
  target.assertStableDomIdentity();

  function publishFrame(nextFrameIndex) {
    const offset = nextFrameIndex * boxCount;
    let nextColorWrites = 0;
    let nextTransformWrites = 0;
    for (let index = 0; index < boxCount; index += 1) {
      const nextColorIndex = colorIndices[offset + index];
      if (currentColorIndices[index] === nextColorIndex) continue;
      shapeElements[index].classList.replace(
        colorClasses[currentColorIndices[index]],
        colorClasses[nextColorIndex],
      );
      currentColorIndices[index] = nextColorIndex;
      nextColorWrites += 1;
    }
    for (let index = 0; index < boxCount; index += 1) {
      const nextTransformIndex = transformIndices[offset + index];
      if (currentTransformIndices[index] === nextTransformIndex) continue;
      target.shapes[index].writeTransform(transforms[nextTransformIndex]);
      currentTransformIndices[index] = nextTransformIndex;
      nextTransformWrites += 1;
    }
    frameIndex = nextFrameIndex;
    publicationCount += 1;
    transformWrites += nextTransformWrites;
    colorWrites += nextColorWrites;
    lastTransformWrites = nextTransformWrites;
    lastColorWrites = nextColorWrites;
    return frameIndex;
  }

  function cancelScheduled() {
    if (timer !== null) cancelDelay(timer);
    if (request !== null) cancelFrame(request);
    timer = null;
    request = null;
  }

  function schedule() {
    if (paused || timer !== null || request !== null) return;
    const delay = Math.max(0, clockOrigin + frameMilliseconds - readNow() - 1);
    timer = requestDelay(wake, delay);
  }

  function wake() {
    timer = null;
    timerCallbackCount += 1;
    if (!paused) request = requestFrame(loop);
  }

  function loop(timestamp) {
    request = null;
    if (paused) return;
    animationFrameCallbackCount += 1;
    const due = Math.floor(Math.max(0, timestamp - clockOrigin + 0.5) / frameMilliseconds);
    if (due > 0) {
      tick += due;
      collapsedTickCount += Math.max(0, due - 1);
      publishFrame(tick % frameCount);
      clockOrigin += due * frameMilliseconds;
    }
    schedule();
  }

  function snapshot() {
    target.assertStableDomIdentity();
    mounted.assertStableDomIdentity();
    return Object.freeze({
      schema: "csscityflow-prepared-player-stats@1",
      ready: true,
      paused,
      tick,
      frameIndex,
      frameCount,
      boxCount,
      frameMilliseconds,
      catchUpPolicy: playback.catchUpPolicy,
      timerCallbackCount,
      animationFrameCallbackCount,
      collapsedTickCount,
      publicationCount,
      transformWrites,
      colorWrites,
      initialTransformWrites: boxCount,
      lastPublication: Object.freeze({
        frameIndex,
        transformWrites: lastTransformWrites,
        colorWrites: lastColorWrites,
      }),
      identityStable: true,
      runtimeGeometryCalculationCount: 0,
      runtimeAtlasRasterizationCount: 0,
      runtimeDomGrowth: false,
    });
  }

  return Object.freeze({
    get paused() { return paused; },
    get frameIndex() { return frameIndex; },
    pause() {
      paused = true;
      cancelScheduled();
      return snapshot();
    },
    resume() {
      if (!paused) return snapshot();
      paused = false;
      clockOrigin = readNow();
      schedule();
      return snapshot();
    },
    seekFrame(value) {
      if (!Number.isSafeInteger(value) || value < 0 || value >= frameCount) {
        throw new RangeError("Cityflow prepared frame is out of range");
      }
      cancelScheduled();
      tick = value;
      publishFrame(value);
      clockOrigin = readNow();
      if (!paused) schedule();
      return snapshot();
    },
    assertStableDomIdentity() {
      target.assertStableDomIdentity();
      mounted.assertStableDomIdentity();
      return true;
    },
    stats: snapshot,
    destroy() {
      paused = true;
      cancelScheduled();
      target.destroy();
    },
  });
}

export async function loadCityflowPreparedPlayback(url, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Cityflow prepared playback failed to load: ${response.status}`);
  const playback = await response.json();
  validatePacket(playback);
  return playback;
}

function validatePlayback(playback, mounted, shapeElements) {
  const decoded = validatePacket(playback);
  if (!mounted?.modelElement || typeof mounted.assertStableDomIdentity !== "function" ||
      !Array.isArray(shapeElements) || shapeElements.length !== playback.boxCount ||
      shapeElements.some((element) => !(element instanceof HTMLElement))) {
    throw new Error("Cityflow retained playback targets drifted");
  }
  return decoded;
}

function validatePacket(playback) {
  if (playback?.schema !== "csscityflow-prepared-playback@1" ||
      playback.precedent !== "domformat@0/polycss-playback@0@cc8da736" ||
      playback.catchUpPolicy !== "elapsed" || playback.frameCount !== 252 ||
      !Number.isSafeInteger(playback.boxCount) || playback.boxCount < 1 ||
      !Array.isArray(playback.tickIntervalUs) || playback.tickIntervalUs.length !== 2 ||
      playback.tickIntervalUs[0] !== 20_000 || playback.tickIntervalUs[1] !== 1 ||
      !Array.isArray(playback.transforms) || playback.transforms.length < playback.boxCount ||
      playback.transforms.some((transform) => typeof transform !== "string" || !MATRIX_PATTERN.test(transform)) ||
      typeof playback.transformIndicesBase64 !== "string" ||
      typeof playback.colorIndicesBase64 !== "string") {
    throw new Error("Cityflow prepared playback packet drifted");
  }
  const cached = decodedPackets.get(playback);
  if (cached) return cached;
  const expectedCells = playback.frameCount * playback.boxCount;
  const transformIndices = decodeUint32(playback.transformIndicesBase64);
  const colorIndices = decodeUint8(playback.colorIndicesBase64);
  if (transformIndices.length !== expectedCells || colorIndices.length !== expectedCells ||
      transformIndices.some((index) => index >= playback.transforms.length)) {
    throw new Error("Cityflow prepared playback table drifted");
  }
  const decoded = Object.freeze({ transformIndices, colorIndices });
  decodedPackets.set(playback, decoded);
  return decoded;
}

function decodeUint8(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeUint32(value) {
  const bytes = decodeUint8(value);
  if (bytes.byteLength % 4 !== 0) throw new Error("Cityflow uint32 playback table is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Uint32Array(bytes.byteLength / 4);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getUint32(index * 4, true);
  }
  return values;
}
