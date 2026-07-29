import {
  formatAffineMatrix3dTransformScalars,
  formatMatrix3dValues,
} from "@layoutit/polycss";
import type {
  PolyMorphMat4,
  PolyMorphModel,
  PolyMorphMountedModel,
  PolyMorphVec3,
} from "@layoutit/polycss-morph";

interface MorphStressPlanClip {
  readonly clipId: string;
  readonly durationMs: number;
  readonly frames: readonly (readonly number[])[];
}

interface MorphStressPaintGroup {
  readonly targetId: string;
  readonly leafIds: readonly string[];
}

interface MorphStressPlanLeaf {
  readonly mode: "affine" | "projective";
  readonly leafId: string;
  readonly targetId: string;
  readonly states: readonly (readonly number[])[];
}

export interface MorphStressAnimationPlan {
  readonly schema: "polycss-morph-stress.animation-plan@7";
  readonly modelId: string;
  readonly targetIds: readonly string[];
  readonly paintGroups: readonly MorphStressPaintGroup[];
  readonly clips: readonly MorphStressPlanClip[];
  readonly leaves: readonly MorphStressPlanLeaf[];
}

interface PreparedPlaybackLeaf {
  readonly element: HTMLElement;
  readonly transforms: readonly string[];
}

const TARGET_COLORS: Readonly<Record<string, readonly [number, number, number]>> =
  Object.freeze({
    "key-1": [229, 177, 22],
    "key-2": [22, 229, 34],
    "key-3": [22, 137, 229],
    "key-4": [229, 22, 161],
    "key-5": [229, 89, 22],
    "key-6": [164, 229, 22],
    "key-7": [138, 22, 229],
    "key-8": [22, 229, 214],
  });
const BASE_COLOR = [40, 40, 40] as const;
const LIGHT = normalize([-0.35, -0.8, 0.48]);

function normalize(value: PolyMorphVec3): PolyMorphVec3 {
  const length = Math.hypot(...value) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function dot(left: PolyMorphVec3, right: PolyMorphVec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function multiply(
  left: PolyMorphMat4,
  right: PolyMorphMat4,
): PolyMorphMat4 {
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

function expandAffine(value: readonly number[]): PolyMorphMat4 {
  return [
    value[0]!, value[1]!, value[2]!, 0,
    value[3]!, value[4]!, value[5]!, 0,
    value[6]!, value[7]!, value[8]!, 0,
    value[9]!, value[10]!, value[11]!, 1,
  ];
}

function formatTransform(
  leaf: MorphStressPlanLeaf,
  value: readonly number[],
  fallbackMatrix: PolyMorphMat4 | null,
): string {
  if (leaf.mode === "projective") {
    return `matrix3d(${formatMatrix3dValues(value, 10)})`;
  }
  if (!fallbackMatrix) {
    return formatAffineMatrix3dTransformScalars(
      value[0]!, value[1]!, value[2]!,
      value[3]!, value[4]!, value[5]!,
      value[6]!, value[7]!, value[8]!,
      value[9]!, value[10]!, value[11]!,
      10,
    );
  }
  return `matrix3d(${formatMatrix3dValues(
    multiply(expandAffine(value), fallbackMatrix),
    10,
  )})`;
}

function sourceFrameAtTime(
  timesMs: readonly number[],
  elapsedMs: number,
): number {
  let low = 0;
  let high = timesMs.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (timesMs[middle]! <= elapsedMs) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

export function validateMorphStressPlan(
  input: unknown,
  model: PolyMorphModel,
): MorphStressAnimationPlan {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Morph Stress Test animation plan is missing.");
  }
  const plan = input as Partial<MorphStressAnimationPlan>;
  if (
    plan.schema !== "polycss-morph-stress.animation-plan@7"
    || plan.modelId !== model.identity.id
    || !Array.isArray(plan.targetIds)
    || !Array.isArray(plan.paintGroups)
    || !Array.isArray(plan.clips)
    || !Array.isArray(plan.leaves)
  ) {
    throw new TypeError("Morph Stress Test animation plan is incompatible.");
  }
  return plan as MorphStressAnimationPlan;
}

function configurePaint(
  mounted: PolyMorphMountedModel,
  model: PolyMorphModel,
  plan: MorphStressAnimationPlan,
): void {
  const polygons = new Map(
    model.topology.polygons.map((polygon) => [polygon.id, polygon]),
  );
  const targetByLeaf = new Map(plan.paintGroups.flatMap((group) =>
    group.leafIds.map((leafId) => [leafId, group.targetId] as const)));

  for (const handle of mounted.leafHandles.values()) {
    handle.element.style.backfaceVisibility = "hidden";
    const polygon = polygons.get(handle.plan.polygonId);
    if (!polygon) continue;
    const normal = normalize(polygon.normalIndices.reduce<PolyMorphVec3>(
      (sum, index) => {
        const value = model.topology.normals[index]!;
        return [sum[0] + value[0], sum[1] + value[1], sum[2] + value[2]];
      },
      [0, 0, 0],
    ));
    const targetId = targetByLeaf.get(handle.id);
    const source = targetId ? TARGET_COLORS[targetId] : BASE_COLOR;
    if (!source) continue;
    const light = Math.max(
      0.3,
      Math.min(1, 0.42 + Math.max(0, dot(normal, LIGHT)) * 0.58),
    );
    const [red, green, blue] = source.map((value) =>
      Math.round(value * light));
    handle.element.style.color = `rgb(${red} ${green} ${blue})`;
  }
}

export function createMorphStressRenderer(
  mounted: PolyMorphMountedModel,
  model: PolyMorphModel,
  plan: MorphStressAnimationPlan,
  clipId: string,
  compose: (matrix: PolyMorphMat4) => PolyMorphMat4,
): (timeMs: number) => void {
  const clip = plan.clips.find((candidate) => candidate.clipId === clipId);
  const modelClip = model.animations.find((candidate) => candidate.id === clipId);
  const timesMs = modelClip?.channels[0]?.timesMs;
  if (!clip || !timesMs) throw new Error(`Prepared clip ${clipId} is missing.`);

  configurePaint(mounted, model, plan);
  const targetIndex = new Map(
    plan.targetIds.map((targetId, index) => [targetId, index]),
  );
  const groups = plan.targetIds.map(() => [] as PreparedPlaybackLeaf[]);
  for (const leaf of plan.leaves) {
    const handle = mounted.leafHandles.get(leaf.leafId);
    const index = targetIndex.get(leaf.targetId);
    if (!handle || index === undefined) {
      throw new Error(`Prepared leaf ${leaf.leafId} is missing.`);
    }
    const fallbackMatrix =
      handle.element.dataset.polyMorphResolvedStrategy === "atlas-slice"
        ? handle.plan.fallback?.matrixFromLeaf ?? null
        : null;
    const transforms = leaf.states.map((state) =>
      formatTransform(leaf, state, fallbackMatrix));
    handle.element.style.transform = transforms[0]!;
    groups[index]!.push({ element: handle.element, transforms });
  }

  const publishedStates = new Int16Array(plan.targetIds.length);
  publishedStates.fill(-1);

  return (timeMs: number): void => {
    mounted.apply({
      shapes: model.render.shapes.map(({ id, matrix }) => ({
        shapeId: id,
        matrix: compose(matrix),
      })),
    });
    const elapsed = timeMs % clip.durationMs;
    const frameIndex = sourceFrameAtTime(timesMs, elapsed);
    const states = clip.frames[frameIndex]!;
    for (let index = 0; index < groups.length; index += 1) {
      const state = states[index]!;
      if (publishedStates[index] === state) continue;
      for (const leaf of groups[index]!) {
        leaf.element.style.transform = leaf.transforms[state]!;
      }
      publishedStates[index] = state;
    }
  };
}
