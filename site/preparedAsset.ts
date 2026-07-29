import {
  createPolyOrthographicCamera,
  createPolyPerspectiveCamera,
} from "@layoutit/polycss";
import {
  createPolyMorphAnimationRuntime,
  createPolyMorphDeformationRuntime,
  mountPolyMorphModel,
  validatePolyMorphModel,
  type PolyMorphLoadedResource,
  type PolyMorphMat4,
  type PolyMorphModel,
  type PolyMorphMountedModel,
} from "@layoutit/polycss-morph";

import {
  distributionResource,
  distributionResourceUrl,
  type DistributedAsset,
  type DistributionResource,
} from "./catalog";
import {
  createMorphStressRenderer,
  validateMorphStressPlan,
  type MorphStressAnimationPlan,
} from "./morphStress";

interface CameraContract {
  readonly projection: "orthographic" | "perspective";
  readonly distance: number;
  readonly fovDegrees?: number;
  readonly rotXDegrees: number;
  readonly rotYDegrees: number;
  readonly target: readonly [number, number, number];
  readonly zoom: number;
  readonly viewportZoom?: {
    readonly factor: number;
    readonly minimum: number;
    readonly maximum: number;
  };
}

interface OrbitContract {
  readonly initialAzimuthRadians: number;
  readonly initialPolarRadians: number;
  readonly minPolarRadians: number;
  readonly maxPolarRadians: number;
  readonly rotateSpeed: number;
}

interface PresentationContract {
  readonly animation?: {
    readonly morphClipId: string;
    readonly shapeClipId?: string;
  };
  readonly camera: CameraContract;
  readonly controls: OrbitContract;
}

interface LoadedPreparedAsset {
  readonly model: PolyMorphModel;
  readonly morphStressPlan: MorphStressAnimationPlan | null;
  readonly presentation: PresentationContract;
  readonly resources: ReadonlyMap<string, PolyMorphLoadedResource>;
}

export interface PreparedAssetMount {
  readonly leafCount: number;
  destroy(): void;
  render(timeMs: number): void;
}

export interface PreparedAssetMountOptions {
  readonly animate?: boolean;
  readonly initialTimeMs?: number;
  readonly zoomMultiplier?: number;
}

const packageCache = new Map<string, Promise<LoadedPreparedAsset>>();
const styleCache = new Map<string, Promise<void>>();

function responseError(response: Response): Error {
  return new Error(`Could not load ${response.url}: ${response.status}.`);
}

async function fetchJson<T>(
  asset: DistributedAsset,
  resource: DistributionResource,
): Promise<T> {
  const url = distributionResourceUrl(asset, resource);
  const response = await fetch(url);
  if (!response.ok) throw responseError(response);
  return response.json() as Promise<T>;
}

async function loadStyles(asset: DistributedAsset): Promise<void> {
  const existing = styleCache.get(asset.id);
  if (existing) return existing;

  const loading = new Promise<void>((resolve, reject) => {
    const resource = distributionResource(asset, "stylesheet");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = distributionResourceUrl(asset, resource);
    link.dataset.preparedAssetStyle = asset.id;
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error(`Could not load ${link.href}.`)),
      { once: true },
    );
    document.head.appendChild(link);
  });
  styleCache.set(asset.id, loading);
  return loading;
}

function imagePaths(model: PolyMorphModel): readonly string[] {
  return [...new Set(model.render.leaves.flatMap((leaf) => [
    ...(leaf.atlas ? [leaf.atlas.resourcePath] : []),
    ...(leaf.fallback ? [leaf.fallback.atlas.resourcePath] : []),
  ]))];
}

async function loadPackage(asset: DistributedAsset): Promise<LoadedPreparedAsset> {
  const existing = packageCache.get(asset.id);
  if (existing) return existing;

  const loading = (async (): Promise<LoadedPreparedAsset> => {
    const [presentation, runtimeModel, planInput] = await Promise.all([
      fetchJson<PresentationContract>(
        asset,
        distributionResource(asset, "presentation"),
      ),
      fetchJson<unknown>(asset, distributionResource(asset, "runtime")),
      asset.mode === "animation-clip"
        ? fetchJson<unknown>(
          asset,
          distributionResource(asset, "animation-plan"),
        )
        : Promise.resolve(null),
      loadStyles(asset),
    ]);
    const model = validatePolyMorphModel(runtimeModel);
    const morphStressPlan = planInput
      ? validateMorphStressPlan(planInput, model)
      : null;
    const descriptors = new Map(
      asset.resources
        .filter((resource) => resource.role === "image")
        .map((resource) => [
          resource.path,
          resource,
        ]),
    );
    const resources = new Map<string, PolyMorphLoadedResource>();

    await Promise.all(imagePaths(model).map(async (path) => {
      const resource = descriptors.get(path);
      if (!resource) throw new Error(`Prepared asset is missing ${path}.`);
      const response = await fetch(distributionResourceUrl(asset, resource));
      if (!response.ok) throw responseError(response);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== resource.bytes) {
        throw new Error(`Prepared asset has stale bytes for ${path}.`);
      }
      resources.set(path, {
        descriptor: {
          path,
          role: "image",
          mediaType: resource.mediaType,
          bytes: resource.bytes,
          sha256: resource.sha256,
        },
        bytes,
      });
    }));

    return Object.freeze({
      model,
      morphStressPlan,
      presentation,
      resources,
    });
  })();
  packageCache.set(asset.id, loading);
  return loading;
}

function perspectivePixels(height: number, fovDegrees: number): number {
  return height / (2 * Math.tan((fovDegrees * Math.PI) / 360));
}

function multiply(left: PolyMorphMat4, right: PolyMorphMat4): PolyMorphMat4 {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let axis = 0; axis < 4; axis += 1) {
        output[(column * 4) + row] +=
          left[(axis * 4) + row]! * right[(column * 4) + axis]!;
      }
    }
  }
  return output as unknown as PolyMorphMat4;
}

function threeOrbitMatrix(
  azimuthRadians: number,
  polarRadians: number,
): PolyMorphMat4 {
  const sinTheta = Math.sin(azimuthRadians);
  const cosTheta = Math.cos(azimuthRadians);
  const sinPhi = Math.sin(polarRadians);
  const cosPhi = Math.cos(polarRadians);
  return [
    cosTheta, cosPhi * sinTheta, sinPhi * sinTheta, 0,
    0, -sinPhi, cosPhi, 0,
    -sinTheta, cosPhi * cosTheta, sinPhi * cosTheta, 0,
    0, 0, 0, 1,
  ];
}

function inverseRotation(matrix: PolyMorphMat4): PolyMorphMat4 {
  return [
    matrix[0], matrix[4], matrix[8], 0,
    matrix[1], matrix[5], matrix[9], 0,
    matrix[2], matrix[6], matrix[10], 0,
    0, 0, 0, 1,
  ];
}

function createOrbit(
  host: HTMLElement,
  contract: OrbitContract,
  onChange: () => void,
): { compose(matrix: PolyMorphMat4): PolyMorphMat4; destroy(): void } {
  const initial = threeOrbitMatrix(
    contract.initialAzimuthRadians,
    contract.initialPolarRadians,
  );
  const initialInverse = inverseRotation(initial);
  let delta: PolyMorphMat4 | null = null;
  let azimuth = contract.initialAzimuthRadians;
  let polar = contract.initialPolarRadians;
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const release = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    if (host.hasPointerCapture(pointerId)) host.releasePointerCapture(pointerId);
    pointerId = null;
    delete host.dataset.polyMorphDragging;
  };
  const down = (event: PointerEvent): void => {
    if (event.button !== 0 || pointerId !== null) return;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    host.dataset.polyMorphDragging = "true";
    host.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const move = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    const height = host.clientHeight || 1;
    const radiansPerPixel = Math.PI * 2 * contract.rotateSpeed / height;
    azimuth -= (event.clientX - lastX) * radiansPerPixel;
    polar = Math.max(
      contract.minPolarRadians + 1e-6,
      Math.min(
        contract.maxPolarRadians - 1e-6,
        polar - ((event.clientY - lastY) * radiansPerPixel),
      ),
    );
    lastX = event.clientX;
    lastY = event.clientY;
    delta = multiply(threeOrbitMatrix(azimuth, polar), initialInverse);
    onChange();
    event.preventDefault();
  };

  host.dataset.polyMorphOrbit = "ready";
  host.addEventListener("pointerdown", down, { passive: false });
  host.addEventListener("pointermove", move, { passive: false });
  host.addEventListener("pointerup", release);
  host.addEventListener("pointercancel", release);

  return {
    compose(matrix: PolyMorphMat4): PolyMorphMat4 {
      return delta ? multiply(delta, matrix) : matrix;
    },
    destroy(): void {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", release);
      host.removeEventListener("pointercancel", release);
      delete host.dataset.polyMorphOrbit;
      delete host.dataset.polyMorphDragging;
    },
  };
}

function animatedRenderer(
  mounted: PolyMorphMountedModel,
  model: PolyMorphModel,
  presentation: PresentationContract,
  compose: (matrix: PolyMorphMat4) => PolyMorphMat4,
): (timeMs: number) => void {
  const clips = presentation.animation;
  const shapeClipId = clips?.shapeClipId;
  if (!clips || !shapeClipId) {
    throw new Error("Animated prepared asset has no shape-clip binding.");
  }
  const animation = createPolyMorphAnimationRuntime(model);
  const deformation = createPolyMorphDeformationRuntime(model);
  let tick = 0;

  return (timeMs: number): void => {
    const morph = animation.sample(clips.morphClipId, timeMs);
    const shapes = animation.sample(shapeClipId, timeMs);
    const frame = deformation.sample({
      tick,
      morphWeights: morph.morphWeights,
      controlValues: morph.controlValues,
    });
    mounted.apply({
      shapes: [...shapes.shapeMatrices].map(([shapeId, matrix]) => ({
        shapeId,
        matrix: compose(matrix),
      })),
      leaves: frame.leafUpdates,
    });
    tick += 1;
  };
}

function animationClipRenderer(
  mounted: PolyMorphMountedModel,
  model: PolyMorphModel,
  presentation: PresentationContract,
  compose: (matrix: PolyMorphMat4) => PolyMorphMat4,
): (timeMs: number) => void {
  const clipId = presentation.animation?.morphClipId;
  if (!clipId) throw new Error("Prepared asset has no animation-clip binding.");
  const animation = createPolyMorphAnimationRuntime(model);
  const deformation = createPolyMorphDeformationRuntime(model);
  let tick = 0;

  return (timeMs: number): void => {
    const sample = animation.sample(clipId, timeMs);
    const frame = deformation.sample({
      tick,
      morphWeights: sample.morphWeights,
      controlValues: sample.controlValues,
    });
    mounted.apply({
      shapes: model.render.shapes.map(({ id, matrix }) => ({
        shapeId: id,
        matrix: compose(matrix),
      })),
      leaves: frame.leafUpdates,
    });
    tick += 1;
  };
}

function morphTargetRenderer(
  mounted: PolyMorphMountedModel,
  model: PolyMorphModel,
  compose: (matrix: PolyMorphMat4) => PolyMorphMat4,
): (timeMs: number) => void {
  const deformation = createPolyMorphDeformationRuntime(model);
  let tick = 0;

  return (timeMs: number): void => {
    const phase = (timeMs % 6000) / 1500;
    const weight = Math.max(
      0,
      Math.min(1, Math.sin(Math.PI * ((phase % 2) / 2))),
    );
    const target = phase < 2 ? "spherify" : "twist";
    const frame = deformation.sample({
      tick,
      morphWeights: { [target]: weight },
    });
    mounted.apply({
      shapes: model.render.shapes.map(({ id, matrix }) => ({
        shapeId: id,
        matrix: compose(matrix),
      })),
      leaves: frame.leafUpdates,
    });
    tick += 1;
  };
}

export async function mountPreparedAsset(
  host: HTMLElement,
  asset: DistributedAsset,
  options: PreparedAssetMountOptions = {},
): Promise<PreparedAssetMount> {
  const loaded = await loadPackage(asset);
  const binding = loaded.presentation.camera;
  const measuredHeight =
    host.getBoundingClientRect().height || host.clientHeight || innerHeight;
  const measuredWidth =
    host.getBoundingClientRect().width || host.clientWidth || innerWidth;
  const zoomMultiplier = options.zoomMultiplier ?? 1;
  const zoomForWidth = (width: number): number => {
    const viewportZoom = binding.viewportZoom;
    const zoom = viewportZoom
      ? Math.max(
        viewportZoom.minimum,
        Math.min(viewportZoom.maximum, width * viewportZoom.factor),
      )
      : binding.zoom;
    return zoom * zoomMultiplier;
  };
  const fovDegrees = binding.fovDegrees ?? 45;
  const initialPerspective = binding.projection === "perspective"
    ? perspectivePixels(measuredHeight, fovDegrees)
    : 0;
  const target: [number, number, number] = [
    binding.target[0],
    binding.target[1],
    binding.target[2],
  ];
  const camera = binding.projection === "perspective"
    ? createPolyPerspectiveCamera({
      distance: binding.distance - initialPerspective,
      perspective: initialPerspective,
      rotX: binding.rotXDegrees,
      rotY: binding.rotYDegrees,
      target,
      zoom: zoomForWidth(measuredWidth),
    })
    : createPolyOrthographicCamera({
      distance: binding.distance,
      rotX: binding.rotXDegrees,
      rotY: binding.rotYDegrees,
      target,
      zoom: zoomForWidth(measuredWidth),
    });
  host.classList.add("cssgraphics-poly-morph-host");
  const mounted = mountPolyMorphModel(host, loaded.model, {
    camera,
    resources: loaded.resources,
  });
  let renderFrame = (_timeMs: number): void => {};
  const orbit = createOrbit(host, loaded.presentation.controls, () => {
    renderFrame(Math.max(0, performance.now() - startedAt));
  });
  const compose = (matrix: PolyMorphMat4): PolyMorphMat4 =>
    orbit.compose(matrix);
  renderFrame = asset.mode === "animated-clips"
    ? animatedRenderer(mounted, loaded.model, loaded.presentation, compose)
    : asset.mode === "animation-clip"
      ? loaded.morphStressPlan
        ? createMorphStressRenderer(
          mounted,
          loaded.model,
          loaded.morphStressPlan,
          asset.clipId ?? loaded.presentation.animation?.morphClipId ?? "",
          compose,
        )
        : animationClipRenderer(
          mounted,
          loaded.model,
          loaded.presentation,
          compose,
        )
      : morphTargetRenderer(mounted, loaded.model, compose);
  const initialTimeMs = options.initialTimeMs ?? 0;
  let startedAt = performance.now() - initialTimeMs;
  let frameRequest = 0;
  let destroyed = false;

  const syncProjection = (): void => {
    const height =
      host.getBoundingClientRect().height || host.clientHeight || innerHeight;
    if (binding.projection === "perspective") {
      const perspective = perspectivePixels(height, fovDegrees);
      camera.update({ distance: binding.distance - perspective });
      mounted.cameraElement.style.perspective = `${perspective}px`;
    } else {
      const width =
        host.getBoundingClientRect().width || host.clientWidth || innerWidth;
      camera.update({ zoom: zoomForWidth(width) });
    }
    mounted.updateCamera();
  };
  const advance = (time: number): void => {
    if (destroyed) return;
    renderFrame(Math.max(0, time - startedAt));
    frameRequest = requestAnimationFrame(advance);
  };

  addEventListener("resize", syncProjection);
  host.dataset.publicAsset = asset.id;
  renderFrame(initialTimeMs);
  mounted.assertStableDomIdentity();
  if (options.animate !== false) frameRequest = requestAnimationFrame(advance);

  return {
    leafCount: mounted.leafHandles.size,
    render(timeMs: number): void {
      if (!destroyed) renderFrame(timeMs);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(frameRequest);
      removeEventListener("resize", syncProjection);
      orbit.destroy();
      mounted.destroy();
      host.classList.remove("cssgraphics-poly-morph-host");
      delete host.dataset.publicAsset;
    },
  };
}
