import {
  createPolyMorphPreparedDomTarget,
  type PolyMorphPreparedDomTarget,
} from "@layoutit/polycss-morph";

import {
  createHeadModelPolyCssRoot,
  sourceMatrixToPolyCssTransform,
  type HeadModelPolyCssRoot,
} from "../runtime/polycssRoot.js";

export interface HeadModelTriangleHandle {
  readonly faceId: string;
  readonly shapeId: string;
  readonly element: HTMLElement;
}

export interface HeadModelPreparedVisibilityFrame {
  readonly visibleFaces: Uint8Array;
  readonly changedFaceIndices: Uint16Array;
}

export interface HeadModelPreparedAffineStates {
  readonly faceCount: number;
  readonly stateCount: number;
  readonly leafSizing: "prepared-raster";
  transform(faceIndex: number, stateIndex: number): string;
}

export interface HeadModelPreparedMotionFrame {
  readonly tick: number;
  readonly profileIndex: number;
  readonly dirtyFromProfileIndex: number;
  readonly sampledFrame: number;
  readonly changedShapeMask: number;
  readonly dirtyFaceIndices: Uint16Array;
  readonly transformStateIndices: Uint16Array;
  readonly faceTransformStateIndices: Uint16Array;
  readonly affineStates: HeadModelPreparedAffineStates;
  readonly values: Float32Array;
  readonly modelMatrixOffset: number;
  readonly shapeMatricesOffset: number;
  readonly visibility?: HeadModelPreparedVisibilityFrame;
}

interface PreparedHeadRenderLeaf {
  readonly id: string;
  readonly sourceOrder: number;
  readonly shapeId: string;
  readonly faceId: string;
  readonly materialId: string;
  readonly polycss: Readonly<{
    transform: string;
    paint: Readonly<{
      path: string;
      backgroundPosition: string;
      backgroundSize: string;
      leafWidth: number;
      leafHeight: number;
    }>;
    update: Readonly<{
      canonicalSize: number;
      matrixDecimals: number;
    }>;
  }>;
}

interface PreparedHeadRenderPlan {
  readonly shapes: readonly Readonly<{
    id: string;
  }>[];
  readonly materials: readonly Readonly<{
    id: string;
    sourceAlpha: number;
  }>[];
  readonly leaves: readonly PreparedHeadRenderLeaf[];
  readonly totals: Readonly<{
    shapeRoots: number;
    faceLeaves: number;
  }>;
}

interface TitleHeadTriangleDriver {
  applyPreparedMotion(frame: HeadModelPreparedMotionFrame): void;
  synchronizePreparedVisibility(
    visibility: HeadModelPreparedVisibilityFrame,
    full?: boolean,
  ): void;
}

export interface TitleHeadRetainedScene {
  readonly plan: PreparedHeadRenderPlan;
  readonly root: HeadModelPolyCssRoot;
  readonly triangleHandles: ReadonlyMap<string, HeadModelTriangleHandle>;
  tickPreparedMotion(frame: HeadModelPreparedMotionFrame): void;
  synchronizePreparedVisibility(
    visibility: HeadModelPreparedVisibilityFrame,
    full?: boolean,
  ): void;
}

export interface TitleHeadRetainedSceneOptions {
  readonly assetBase: string;
  readonly initialVisibleFaces: Uint8Array;
}

interface CompiledTriangleUpdate {
  readonly leaf: PreparedHeadRenderLeaf;
  readonly handle: HeadModelTriangleHandle;
  readonly writeTransform: (transform: string) => boolean;
  readonly writeVisibility: (visible: boolean) => boolean;
  lastTransform: string;
  lastVisible: boolean;
  culled: boolean;
}

function fittedAtlasTransform(
  transform: string,
  leaf: PreparedHeadRenderLeaf,
): string {
  const canonicalSize = leaf.polycss.update.canonicalSize;
  const width = leaf.polycss.paint.leafWidth;
  const height = leaf.polycss.paint.leafHeight;
  if (width === canonicalSize && height === canonicalSize) return transform;
  const match = /^matrix3d\(([^)]+)\)$/u.exec(transform);
  if (!match) fail(`${leaf.faceId} has no prepared matrix3d sizing bypass.`);
  const values = match[1].split(",").map((entry) => Number(entry));
  if (values.length !== 16 || values.some((entry) => !Number.isFinite(entry))) {
    fail(`${leaf.faceId} has an invalid prepared matrix3d sizing bypass.`);
  }
  const xScale = canonicalSize / width;
  const yScale = canonicalSize / height;
  for (const index of [0, 1, 2]) values[index] *= xScale;
  for (const index of [4, 5, 6]) values[index] *= yScale;
  const decimals = Math.max(6, Math.min(12, leaf.polycss.update.matrixDecimals));
  const factor = 10 ** decimals;
  const formatted = values.map((value) => {
    const rounded = Math.round(value * factor) / factor;
    return String(Object.is(rounded, -0) ? 0 : rounded);
  });
  return `matrix3d(${formatted.join(",")})`;
}

function fail(message: string): never {
  throw new TypeError(message);
}

function normalizedAssetBase(value: string): string {
  if (!value.startsWith("/") || value.includes(":") || value.includes("\\")
    || value.includes("?") || value.includes("#") || value.split("/").includes("..")) {
    throw new TypeError("The prepared head-model asset base must be root-relative and normalized.");
  }
  return value.endsWith("/") ? value : `${value}/`;
}

function compileUpdateRow(
  leaf: PreparedHeadRenderLeaf,
  handle: HeadModelTriangleHandle | undefined,
  target: PolyMorphPreparedDomTarget["leaves"][number],
): CompiledTriangleUpdate {
  if (!handle || handle.faceId !== leaf.faceId || handle.shapeId !== leaf.shapeId) {
    fail(`${leaf.faceId} has no exact retained DOM handle.`);
  }
  return {
    leaf,
    handle,
    writeTransform: target.writeTransform,
    writeVisibility: target.writeVisibility,
    lastTransform: fittedAtlasTransform(leaf.polycss.transform, leaf),
    lastVisible: true,
    culled: false,
  };
}

function createTitleHeadTriangleDriver(
  plan: PreparedHeadRenderPlan,
  shapeElements: ReadonlyMap<string, HTMLElement>,
  triangleHandles: ReadonlyMap<string, HeadModelTriangleHandle>,
  morphTarget: PolyMorphPreparedDomTarget,
  initialVisibleFaces: Uint8Array,
): TitleHeadTriangleDriver {
  if (shapeElements.size !== plan.shapes.length || triangleHandles.size !== plan.leaves.length) {
    fail("The triangle driver requires the complete retained prepared mount.");
  }
  const shapeTargets = Object.freeze(plan.shapes.map((shape, index) => {
    const element = shapeElements.get(shape.id);
    const target = morphTarget.shapes[index];
    if (!element || target?.element !== element) fail(`${shape.id} has no retained shape root.`);
    return {
      writeTransform: target.writeTransform,
      lastTransform: "",
    };
  }));
  const rows = Object.freeze(plan.leaves.map((leaf, index) => compileUpdateRow(
    leaf,
    triangleHandles.get(leaf.faceId),
    morphTarget.leaves[index],
  )));
  if (initialVisibleFaces.length !== rows.length
    || initialVisibleFaces.some((value) => value !== 0 && value !== 1)) {
    fail("The initial prepared visibility row does not cover the topology.");
  }
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (initialVisibleFaces[rowIndex] !== 0) continue;
    const row = rows[rowIndex];
    row.culled = true;
    row.lastVisible = false;
    row.writeVisibility(false);
  }
  let lastTick = -1;
  let hasProfile = false;
  let lastProfileIndex = -1;

  const validateOrderedFaceIndices = (
    values: Uint16Array,
    label: string,
  ): void => {
    let previous = -1;
    for (const faceIndex of values) {
      if (faceIndex <= previous || faceIndex >= rows.length) {
        fail(`${label} is outside source order.`);
      }
      previous = faceIndex;
    }
  };

  return Object.freeze({
    synchronizePreparedVisibility(
      visibility: HeadModelPreparedVisibilityFrame,
      full = false,
    ): void {
      if (!(visibility?.visibleFaces instanceof Uint8Array)
        || visibility.visibleFaces.length !== rows.length
        || !(visibility.changedFaceIndices instanceof Uint16Array)) {
        fail("Prepared visibility synchronization is invalid.");
      }
      validateOrderedFaceIndices(visibility.changedFaceIndices, "Prepared visibility changes");
      const indices: Iterable<number> = full
        ? rows.keys()
        : visibility.changedFaceIndices;
      let previousFaceIndex = -1;
      for (const faceIndex of indices) {
        const row = rows[faceIndex];
        const target = visibility.visibleFaces[faceIndex];
        if (!row || (target !== 0 && target !== 1)
          || (!full && faceIndex <= previousFaceIndex)) {
          fail("Prepared visibility synchronization is outside source order.");
        }
        previousFaceIndex = faceIndex;
        const targetCulled = target === 0;
        if (row.culled === targetCulled) {
          if (targetCulled) {
            if (row.lastVisible || row.handle.element.style.visibility !== "hidden") {
              row.writeVisibility(false);
            }
            row.lastVisible = false;
          }
          continue;
        }
        row.culled = targetCulled;
        if (targetCulled) {
          if (row.lastVisible || row.handle.element.style.visibility !== "hidden") {
            row.writeVisibility(false);
          }
          row.lastVisible = false;
        }
      }
    },
    applyPreparedMotion(frame: HeadModelPreparedMotionFrame): void {
      if (!frame || !Number.isSafeInteger(frame.tick) || frame.tick < 0 || frame.tick <= lastTick) {
        fail("Prepared motion frames must advance in strict tick order.");
      }
      if (!Number.isSafeInteger(frame.profileIndex) || frame.profileIndex < 0
        || !Number.isSafeInteger(frame.dirtyFromProfileIndex) || frame.dirtyFromProfileIndex < -1
        || !Number.isSafeInteger(frame.sampledFrame) || frame.sampledFrame < 1
        || !(frame.values instanceof Float32Array) || !(frame.dirtyFaceIndices instanceof Uint16Array)
        || !(frame.transformStateIndices instanceof Uint16Array)
        || frame.transformStateIndices.length !== frame.dirtyFaceIndices.length
        || !(frame.faceTransformStateIndices instanceof Uint16Array)
        || frame.faceTransformStateIndices.length !== rows.length
        || !frame.affineStates || frame.affineStates.faceCount !== rows.length
        || !Number.isSafeInteger(frame.affineStates.stateCount) || frame.affineStates.stateCount < rows.length
        || frame.affineStates.leafSizing !== "prepared-raster"
        || typeof frame.affineStates.transform !== "function"
        || frame.shapeMatricesOffset < 0) {
        fail("Prepared motion frame metadata is invalid.");
      }
      const visibility = frame.visibility;
      if (visibility !== undefined
        && (!(visibility.visibleFaces instanceof Uint8Array)
          || visibility.visibleFaces.length !== rows.length
          || !(visibility.changedFaceIndices instanceof Uint16Array))) {
        fail("Prepared motion visibility metadata is invalid.");
      }
      const repeatedProfile = hasProfile && lastProfileIndex === frame.profileIndex;
      const sequentialProfile = hasProfile
        && lastProfileIndex === frame.dirtyFromProfileIndex;
      const forceAll = !repeatedProfile && !sequentialProfile;
      if (visibility) {
        let previousFaceIndex = -1;
        for (const faceIndex of visibility.changedFaceIndices) {
          const row = rows[faceIndex];
          if (!row || faceIndex <= previousFaceIndex) {
            fail("Prepared visibility changes are outside source order.");
          }
          const targetVisible = visibility.visibleFaces[faceIndex] === 1;
          if (targetVisible === !row.culled) {
            fail("Prepared visibility change did not toggle its retained leaf.");
          }
          if (!targetVisible) {
            row.culled = true;
            if (row.lastVisible) {
              row.lastVisible = false;
              row.writeVisibility(false);
            }
          }
          previousFaceIndex = faceIndex;
        }
      }

      let shapeMask = repeatedProfile ? 0 : forceAll
        ? (2 ** shapeTargets.length - 1) >>> 0
        : frame.changedShapeMask >>> 0;
      while (shapeMask !== 0) {
        const bit = shapeMask & -shapeMask;
        const shapeIndex = 31 - Math.clz32(bit);
        const target = shapeTargets[shapeIndex];
        if (!target) fail("Prepared shape mask is outside the mounted topology.");
        const transform = sourceMatrixToPolyCssTransform(
          frame.values,
          frame.shapeMatricesOffset + shapeIndex * 16,
        );
        if (target.lastTransform !== transform) {
          target.lastTransform = transform;
          target.writeTransform(transform);
        }
        shapeMask = (shapeMask ^ bit) >>> 0;
      }

      const applyRow = (
        row: CompiledTriangleUpdate,
        faceIndex: number,
        transformStateIndex: number,
      ): void => {
        if (row.culled) return;
        const transform = frame.affineStates.transform(faceIndex, transformStateIndex);
        const nextDegenerate = transform === "";
        const visible = !nextDegenerate && !row.culled;
        if (row.lastVisible !== visible) {
          row.lastVisible = visible;
          row.writeVisibility(visible);
        }
        if (!nextDegenerate && row.lastTransform !== transform) {
          row.lastTransform = transform;
          row.writeTransform(transform);
        }
      };
      if (!repeatedProfile) {
        if (forceAll) {
          for (let faceIndex = 0; faceIndex < rows.length; faceIndex += 1) {
            applyRow(rows[faceIndex], faceIndex, frame.faceTransformStateIndices[faceIndex]);
          }
        } else {
          for (let index = 0; index < frame.dirtyFaceIndices.length; index += 1) {
            const faceIndex = frame.dirtyFaceIndices[index];
            const row = rows[faceIndex];
            if (!row) fail("Prepared dirty face is outside the mounted topology.");
            applyRow(row, faceIndex, frame.transformStateIndices[index]);
          }
        }
      }
      if (visibility) {
        for (const faceIndex of visibility.changedFaceIndices) {
          if (visibility.visibleFaces[faceIndex] === 0) continue;
          const row = rows[faceIndex];
          row.culled = false;
          applyRow(row, faceIndex, frame.faceTransformStateIndices[faceIndex]);
        }
      }

      lastTick = frame.tick;
      hasProfile = true;
      lastProfileIndex = frame.profileIndex;
    },
  });
}

function mountShapeRoot(
  root: HeadModelPolyCssRoot,
): HTMLElement {
  const element = root.sceneElement.ownerDocument.createElement("div");
  element.className = "polycss-mesh head-model-shape";
  element.style.visibility = "visible";
  root.sceneElement.appendChild(element);
  return element;
}

function mountTriangle(
  shapeElement: HTMLElement,
  leaf: PreparedHeadRenderLeaf,
  sourceAlpha: number,
  assetBase: string,
): HeadModelTriangleHandle {
  const element = shapeElement.ownerDocument.createElement("u");
  element.className = "head-model-face";
  element.dataset.polyIndex = String(leaf.sourceOrder);
  element.style.transform = fittedAtlasTransform(leaf.polycss.transform, leaf);
  const paint = leaf.polycss.paint;
  const variableRaster = paint.leafWidth !== leaf.polycss.update.canonicalSize
    || paint.leafHeight !== leaf.polycss.update.canonicalSize;
  element.style.backgroundPosition = paint.backgroundPosition;
  element.style.backgroundImage = `url(${assetBase}${paint.path})`;
  element.style.backgroundSize = paint.backgroundSize;
  element.style.backgroundRepeat = "no-repeat";
  element.style.setProperty("--polycss-atlas-width", `${paint.leafWidth}px`);
  element.style.setProperty("--polycss-atlas-height", `${paint.leafHeight}px`);
  element.style.setProperty("--polycss-atlas-leaf-sizing", variableRaster ? "raster" : "canonical");
  element.style.width = `${paint.leafWidth}px`;
  element.style.height = `${paint.leafHeight}px`;
  element.style.backgroundColor = "transparent";
  element.style.border = "0";
  element.style.boxSizing = "border-box";
  element.style.borderTopLeftRadius = "50% 100%";
  element.style.borderTopRightRadius = "50% 100%";
  element.style.setProperty("corner-top-left-shape", "bevel");
  element.style.setProperty("corner-top-right-shape", "bevel");
  element.dataset.polycssTextureLeafWidth = String(paint.leafWidth);
  element.dataset.polycssTextureLeafHeight = String(paint.leafHeight);
  element.style.opacity = String(sourceAlpha);
  element.style.backfaceVisibility = "visible";
  element.style.transformStyle = "preserve-3d";
  element.style.visibility = "visible";
  shapeElement.appendChild(element);
  return Object.freeze({
    faceId: leaf.faceId,
    shapeId: leaf.shapeId,
    element,
  });
}

export function mountTitleHeadRetainedScene(
  host: HTMLElement,
  plan: PreparedHeadRenderPlan,
  options: TitleHeadRetainedSceneOptions,
): TitleHeadRetainedScene {
  if (!host || typeof host.appendChild !== "function" || !host.ownerDocument) {
    throw new TypeError("The retained title-head PolyCSS scene requires an HTMLElement host.");
  }
  const assetBase = normalizedAssetBase(options.assetBase);
  host.replaceChildren();
  const root = createHeadModelPolyCssRoot(host);

  const shapeElements = new Map<string, HTMLElement>();
  for (const shape of plan.shapes) {
    if (shapeElements.has(shape.id)) throw new TypeError(`Duplicate prepared shape root ${shape.id}.`);
    shapeElements.set(shape.id, mountShapeRoot(root));
  }
  const materialById = new Map(plan.materials.map((material) => [material.id, material]));
  const triangleHandles = new Map<string, HeadModelTriangleHandle>();
  for (const leaf of plan.leaves) {
    const shape = shapeElements.get(leaf.shapeId);
    const material = materialById.get(leaf.materialId);
    if (!shape || !material) throw new TypeError(`${leaf.id} has incomplete prepared mount identity.`);
    if (triangleHandles.has(leaf.faceId)) throw new TypeError(`Duplicate mounted face ${leaf.faceId}.`);
    triangleHandles.set(leaf.faceId, mountTriangle(shape, leaf, material.sourceAlpha, assetBase));
  }
  if (triangleHandles.size !== plan.totals.faceLeaves || shapeElements.size !== plan.totals.shapeRoots) {
    root.destroy();
    throw new TypeError("The mounted head model does not cover its prepared topology.");
  }

  const stableShapes = Object.freeze([...shapeElements.entries()]);
  const stableTriangles = Object.freeze([...triangleHandles.entries()]);
  const morphTarget = createPolyMorphPreparedDomTarget({
    model: {
      element: root.sceneElement,
      writeTransform: (transform) => root.updatePreparedModelTransform(transform),
    },
    shapes: plan.shapes.map((shape) => ({
      element: shapeElements.get(shape.id)!,
    })),
    leaves: plan.leaves.map((leaf) => ({
      element: triangleHandles.get(leaf.faceId)!.element,
    })),
  });
  const triangleDriver = createTitleHeadTriangleDriver(
    plan,
    shapeElements,
    triangleHandles,
    morphTarget,
    options.initialVisibleFaces,
  );
  const assertStableDomIdentity = (): void => {
    morphTarget.assertStableDomIdentity();
    const drifted = shapeElements.size !== stableShapes.length
      || triangleHandles.size !== stableTriangles.length
      || stableShapes.some(([id, element]) => shapeElements.get(id) !== element || element.parentElement !== root.sceneElement)
      || stableTriangles.some(([id, handle]) => (
        triangleHandles.get(id) !== handle || handle.element.parentElement !== shapeElements.get(handle.shapeId)
    ));
    if (drifted) throw new Error("Stable head-model DOM identity changed after mount.");
  };
  const scene = {
    plan,
    root,
    triangleHandles,
    tickPreparedMotion(frame: HeadModelPreparedMotionFrame): void {
      morphTarget.model.writeTransform(
        sourceMatrixToPolyCssTransform(frame.values, frame.modelMatrixOffset),
      );
      triangleDriver.applyPreparedMotion(frame);
    },
    synchronizePreparedVisibility(
      visibility: HeadModelPreparedVisibilityFrame,
      full = false,
    ): void {
      triangleDriver.synchronizePreparedVisibility(
        visibility,
        full,
      );
    },
  } satisfies TitleHeadRetainedScene;
  assertStableDomIdentity();
  return Object.freeze(scene);
}
