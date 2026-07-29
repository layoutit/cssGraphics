import {
  buildPolyCameraSceneTransform,
  capturePolyCameraSnapshot,
  createPolyPerspectiveCamera,
  injectPolyBaseStyles,
  type PolyPerspectiveCameraHandle,
} from "@layoutit/polycss";

export interface HeadModelPolyCssRoot {
  readonly camera: PolyPerspectiveCameraHandle;
  readonly sceneElement: HTMLDivElement;

  updateProjection(projection: HeadModelPolyCssProjection): void;
  updateViewportComposition(composition: HeadModelPolyCssViewportComposition): void;
  updatePreparedModelTransform(transform: string): boolean;
  destroy(): void;
}

export interface HeadModelPolyCssViewportComposition {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly sourceScale: number;
  readonly appearanceScale: number;
  readonly translateYSourcePx: number;
  readonly appearanceId: string;
}

export interface HeadModelPolyCssProjection {
  readonly perspectivePx: number;
  readonly originX: number;
  readonly originY: number;
  readonly screenRollDegrees: number;
  readonly near: number;
  readonly far: number;
}

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return Object.is(value, -0) ? 0 : value;
}

function positiveNumber(value: number, label: string): number {
  const result = finiteNumber(value, label);
  if (!(result > 0)) throw new TypeError(`${label} must be positive.`);
  return result;
}

export function cssNumber(value: number): string {
  const normalized = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(normalized, -0) ? 0 : normalized);
}

type WritableCameraStyle = "left" | "top" | "width" | "height" | "transform";

function writeStyle(element: HTMLElement, property: WritableCameraStyle, value: string): void {
  if (element.style[property] !== value) element.style[property] = value;
}

function validateProjection(input: HeadModelPolyCssProjection): HeadModelPolyCssProjection {
  const perspectivePx = finiteNumber(input.perspectivePx, "PolyCSS camera perspective");
  const originX = finiteNumber(input.originX, "PolyCSS camera projection origin X");
  const originY = finiteNumber(input.originY, "PolyCSS camera projection origin Y");
  const screenRollDegrees = finiteNumber(input.screenRollDegrees, "PolyCSS camera screen roll");
  const near = finiteNumber(input.near, "PolyCSS camera near plane");
  const far = finiteNumber(input.far, "PolyCSS camera far plane");
  if (!(perspectivePx > 0) || !(near > 0 && near < far)) {
    throw new TypeError("PolyCSS camera perspective and source frustum must be positive and ordered.");
  }
  return Object.freeze({ perspectivePx, originX, originY, screenRollDegrees, near, far });
}

const SOURCE_TO_POLYCSS_ORDER = Object.freeze([2, 0, 1, 3] as const);
export function sourceMatrixToPolyCssTransform(value: ArrayLike<number>, offset = 0): string {
  if (!value || !Number.isSafeInteger(offset) || offset < 0 || value.length - offset < 16) {
    throw new TypeError("The source model transform must contain 16 row-major values.");
  }
  const source = Array.from({ length: 16 }, (_, index) => (
    finiteNumber(value[offset + index], `Source model transform ${index}`)
  ));
  const identity = source.every((entry, index) => entry === (index % 5 === 0 ? 1 : 0));
  if (identity) return "";
  const values = SOURCE_TO_POLYCSS_ORDER.flatMap((row) => (
    SOURCE_TO_POLYCSS_ORDER.map((column) => source[row * 4 + column])
  ));
  return `matrix3d(${values.join(",")})`;
}

export function createHeadModelPolyCssRoot(
  host: HTMLElement,
): HeadModelPolyCssRoot {
  const camera = createPolyPerspectiveCamera({ perspective: 32000 });
  const doc = host.ownerDocument;
  injectPolyBaseStyles(doc);
  const cameraElement = doc.createElement("div");
  const sceneElement = doc.createElement("div");
  cameraElement.classList.add("polycss-camera");
  sceneElement.className = "polycss-scene";
  cameraElement.appendChild(sceneElement);
  cameraElement.setAttribute("aria-hidden", "true");
  cameraElement.style.position = "absolute";
  cameraElement.style.transformOrigin = "0 0";
  cameraElement.style.transformStyle = "preserve-3d";
  host.appendChild(cameraElement);

  let projection: HeadModelPolyCssProjection | null = null;
  let modelTransform = "";
  let destroyed = false;
  const updateCamera = (): void => {
    if (destroyed) throw new Error("The head-model PolyCSS root is destroyed.");
    const perspectiveStyle = projection ? `${projection.perspectivePx}px` : camera.perspectiveStyle;
    const snapshot = capturePolyCameraSnapshot(camera, { perspectiveStyle });
    cameraElement.style.perspective = snapshot.appliedPerspectiveStyle;
    const sceneTransform = buildPolyCameraSceneTransform(camera.state)
      .replace(/^scale\(1\) /u, "");
    if (projection) {
      cameraElement.style.perspectiveOrigin = `${projection.originX}px ${projection.originY}px`;
      const cameraTransform = projection.screenRollDegrees === 0
        ? sceneTransform
        : `rotateZ(${projection.screenRollDegrees}deg) ${sceneTransform}`;
      sceneElement.style.transform = modelTransform === "" ? cameraTransform : `${cameraTransform} ${modelTransform}`;
    } else {
      sceneElement.style.transform = modelTransform === "" ? sceneTransform : `${sceneTransform} ${modelTransform}`;
    }
  };
  updateCamera();

  return Object.freeze({
    camera,
    sceneElement,
    updateProjection(next: HeadModelPolyCssProjection): void {
      projection = validateProjection(next);
      updateCamera();
    },
    updateViewportComposition(next: HeadModelPolyCssViewportComposition): void {
      if (destroyed) throw new Error("The head-model PolyCSS root is destroyed.");
      const viewportWidth = positiveNumber(next.viewportWidth, "PolyCSS viewport width");
      const viewportHeight = positiveNumber(next.viewportHeight, "PolyCSS viewport height");
      const sourceWidth = positiveNumber(next.sourceWidth, "PolyCSS source camera width");
      const sourceHeight = positiveNumber(next.sourceHeight, "PolyCSS source camera height");
      const sourceScale = positiveNumber(next.sourceScale, "PolyCSS source camera scale");
      const appearanceScale = positiveNumber(next.appearanceScale, "PolyCSS appearance scale");
      const translateYSourcePx = finiteNumber(next.translateYSourcePx, "PolyCSS appearance translation");
      if (typeof next.appearanceId !== "string" || next.appearanceId.length === 0) {
        throw new TypeError("PolyCSS appearance id must be non-empty.");
      }
      const scale = sourceScale * appearanceScale;
      const left = viewportWidth / 2 - sourceWidth * scale / 2;
      const top = viewportHeight / 2 - sourceHeight * scale / 2 + translateYSourcePx * sourceScale;
      writeStyle(cameraElement, "left", `${cssNumber(left)}px`);
      writeStyle(cameraElement, "top", `${cssNumber(top)}px`);
      writeStyle(cameraElement, "width", `${cssNumber(sourceWidth)}px`);
      writeStyle(cameraElement, "height", `${cssNumber(sourceHeight)}px`);
      writeStyle(cameraElement, "transform", `scale(${cssNumber(scale)})`);
    },
    updatePreparedModelTransform(next: string): boolean {
      if (destroyed) throw new Error("The head-model PolyCSS root is destroyed.");
      if (typeof next !== "string" || (next !== "" && !next.startsWith("matrix3d("))) {
        throw new TypeError("The prepared model transform is not a CSS matrix.");
      }
      if (next === modelTransform) return false;
      modelTransform = next;
      updateCamera();
      return true;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      cameraElement.remove();
    },
  });
}
