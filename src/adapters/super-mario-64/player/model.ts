import {
  CssGraphicsPackageError,
  type CssGraphicsModelData,
} from "../../../model-package/modelPackage.mjs";
import type {
  LoadedCssGraphicsModel,
  LoadedModelAsset,
} from "../../../runtime/shared/loader.js";

export const SUPER_MARIO_64_PROFILE = "super-mario-64" as const;
export const MARIO_FRAME_COUNT = 820 as const;
export const MARIO_SHAPE_COUNT = 6 as const;
export const MARIO_LEAF_COUNT = 1213 as const;

type JsonObject = Record<string, unknown>;

export type MarioFrameRow = readonly [
  sourceFrame: number,
  appearance: number,
  lighting: number,
  modelTransform: number,
  shapeOffset: number,
  shapeCount: number,
  leafOffset: number,
  leafCount: number,
];

export interface MarioShape {
  readonly id: string;
  readonly sourceOrder: number;
  readonly vertexIds: readonly string[];
}

export interface MarioLeaf {
  readonly id: string;
  readonly faceId: string;
  readonly shapeId: string;
  readonly materialId: string;
  readonly sourceOrder: number;
  readonly vertexIds: readonly [string, string, string];
  readonly polycss: Readonly<{
    readonly element: "s" | "u" | "i";
    readonly transform: string;
    readonly basis: Readonly<{ readonly a: 0 | 1 | 2; readonly b: 0 | 1 | 2; readonly c: 0 | 1 | 2 }>;
    readonly color: string;
    readonly vertices: readonly (
      readonly [number, number, number]
    )[];
    readonly update: Readonly<{
      readonly canonicalSize: number;
      readonly coordinateOrder: "source-zxy";
      readonly materialStateIndex: number;
      readonly matrixDecimals: number;
      readonly pointOrder: "source-0-2-1";
      readonly seamEdgeMask: number;
      readonly shapeStateIndex: number;
      readonly vertexIndices: readonly [number, number, number];
    }>;
  }>;
}

export interface MarioPlan {
  readonly schema: string;
  readonly contentHash: string;
  readonly materialsHash: string;
  readonly topology: Readonly<{
    readonly id: string;
    readonly contentHash: string;
    readonly shapes: readonly MarioShape[];
  }>;
  readonly leaves: readonly MarioLeaf[];
  readonly mount: Readonly<{
    readonly seamRepair: Readonly<{
      readonly fallbackAmount: number;
      readonly sharedEdgeAmount: number;
    }>;
  }>;
}

export interface MarioPlayback {
  readonly schema: "cssgraphics-title-head-playback-packet@1";
  readonly layout: "flat-delta-index-v1";
  readonly sourceFrames: Readonly<{
    readonly first: 1;
    readonly last: 820;
    readonly count: 820;
    readonly wrapTo: 1;
  }>;
  readonly timeline: Readonly<{
    readonly introTicks: number;
    readonly loopTicks: number;
    readonly frames: readonly number[];
  }>;
  readonly shapeCount: 6;
  readonly leafCount: 1213;
  readonly transforms: readonly string[];
  readonly appearances: readonly (readonly [
    id: string,
    scale: number,
    translateY: number,
  ])[];
  readonly initial: Readonly<{
    readonly sourceFrame: 1;
    readonly appearance: number;
    readonly lightingRow: number;
    readonly modelTransform: number;
    readonly shapes: readonly number[];
    readonly leaves: readonly number[];
  }>;
  readonly frameRows: readonly MarioFrameRow[];
  readonly shapeChanges: readonly number[];
  readonly leafChanges: readonly number[];
}

export interface MarioLightingFace {
  readonly faceId: string;
  readonly sourceOrder: number;
  readonly stateOffset: number;
  readonly stateCount: number;
  readonly leafWidth: number;
  readonly leafHeight: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly backgroundPositionX: string;
  readonly backgroundPositionY: string;
  readonly backgroundSize: string;
}

export interface MarioLighting {
  readonly schema: "cssgraphics-title-head-lighting-atlases@9";
  readonly trianglePlanHash: string;
  readonly materialsHash: string;
  readonly frameCount: 820;
  readonly surface: Readonly<{
    readonly faces: readonly MarioLightingFace[];
    readonly statePacking: Readonly<{
      readonly stateCount: number;
      readonly sourceFramesBase64: string;
      readonly backgroundPositionYs: readonly string[];
    }>;
  }>;
  readonly transitions: Readonly<{
    readonly initialFrame: 1;
    readonly sequential: Readonly<{
      readonly offsetsBase64: string;
      readonly faceIndicesBase64: string;
      readonly stateIndicesBase64: string;
    }>;
    readonly nonInteractiveJumps: readonly Readonly<{
      readonly fromFrame: number;
      readonly toFrame: number;
      readonly faceIndicesBase64: string;
      readonly stateIndicesBase64: string;
    }>[];
  }>;
  readonly visibilityCulling: Readonly<{
    readonly initialFrame: 1;
    readonly initialVisibleBitsBase64: string;
    readonly sequential: Readonly<{
      readonly offsetsBase64: string;
      readonly faceIndicesBase64: string;
    }>;
    readonly nonInteractiveJumps: readonly Readonly<{
      readonly fromFrame: number;
      readonly toFrame: number;
      readonly faceIndicesBase64: string;
    }>[];
  }>;
}

export interface MarioEffectCell {
  readonly x: number;
  readonly y: number;
  readonly sourceToDisplayScale: number;
}

export interface MarioEffectStar {
  readonly id: string;
  readonly sourceOrder: 0 | 1;
  readonly colour: "white" | "red";
  readonly textureCells: readonly MarioEffectCell[];
  readonly path: readonly number[];
  readonly preparedTransforms: readonly string[];
  readonly frameIndices: readonly number[];
}

export interface MarioEffectEmitter {
  readonly id: string;
  readonly sourceOrder: 0 | 1 | 2;
  readonly colour: "white" | "red";
  readonly poolSize: 30;
  readonly slotIds: readonly string[];
  readonly textureCells: readonly MarioEffectCell[];
}

export interface MarioEffects {
  readonly atlas: Readonly<{ readonly path: string; readonly width: number; readonly height: number }>;
  readonly billboardGeometry: Readonly<{
    readonly star: Readonly<{ readonly width: 128; readonly height: 128 }>;
    readonly sparkle: Readonly<{ readonly width: 64; readonly height: 64 }>;
  }>;
  readonly camera: Readonly<{ readonly matrix: readonly (readonly number[])[] }>;
  readonly stars: readonly [MarioEffectStar, MarioEffectStar];
  readonly emitters: readonly [MarioEffectEmitter, MarioEffectEmitter, MarioEffectEmitter];
  readonly particle: Readonly<{
    readonly damping: number;
    readonly gravityY: number;
    readonly sparkleFrameTable: readonly number[];
    readonly cameraBias: Readonly<{
      readonly continuous: readonly [number, number, number];
      readonly picked: readonly [number, number, number];
    }>;
  }>;
  readonly spawnStream: Readonly<{
    readonly count: number;
    readonly tuples: readonly (readonly [number, number, number, number])[];
  }>;
  readonly sourceFrames: Readonly<{ readonly count: 820 }>;
  readonly totals: Readonly<{ readonly effectLeaves: 92 }>;
}

export interface MarioPresentation {
  readonly background: Readonly<{
    readonly asset: "background";
    readonly opacity: number;
    readonly position: string;
    readonly repeat: string;
    readonly size: string;
  }>;
  readonly sourceViewport: Readonly<{ readonly width: 320; readonly height: 240 }>;
}

export interface MarioCursor {
  readonly asset: "cursor";
  readonly closedWhen: string;
  readonly states: Readonly<Record<"open" | "closed", Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>>>;
}

export interface MarioInteractionClosure {
  readonly shapeIndices: readonly number[];
  readonly vertexRows: readonly number[];
  readonly vertexPositions: readonly number[];
  readonly weightActiveFlags: readonly number[];
  readonly weightScalars: readonly number[];
  readonly weightLinearContributions: readonly number[];
  readonly weightBaseTranslations: readonly number[];
  readonly faceIndices: readonly number[];
  readonly leafRows: readonly number[];
  readonly safeVisibleLeafIndices: readonly number[];
  readonly rigidRootInverseMatrix: readonly number[];
}

export interface MarioInteractionControl {
  readonly id: string;
  readonly role: string;
  readonly mode: "grab" | "eye-follow";
  readonly sourceOrder: number;
  readonly sourcePosition: readonly [number, number, number];
  readonly screenPosition: readonly [number, number];
  readonly cameraDistance: number;
  readonly attachmentObjectIndices: readonly number[];
  readonly closure: MarioInteractionClosure;
}

export interface MarioInteraction {
  readonly schema: "cssgraphics-title-head-interaction-packet@1";
  readonly layout: "direct-sparse-closures-v1";
  readonly contentHash: string;
  readonly source: Readonly<{
    readonly frame: 660;
    readonly animatorState: 7;
    readonly cameraViewMatrix: readonly number[];
    readonly cameraWorldPosition: readonly [number, number, number];
    readonly inverseCameraMatrix: readonly number[];
    readonly displacementMagnitude: number;
    readonly eyeMaximumOffset: number;
    readonly spring: Readonly<{
      readonly pickedResistance: number;
      readonly releaseAcceleration: number;
      readonly velocityDecay: number;
      readonly snapVelocityL1: number;
      readonly snapOffsetL1: number;
      readonly cursorResistance: number;
      readonly grabbedFlag: number;
    }>;
  }>;
  readonly objects: Readonly<{
    readonly rotationMatrices: readonly number[];
  }>;
  readonly shapes: Readonly<{
    readonly baseMatrices: readonly number[];
  }>;
  readonly controls: readonly MarioInteractionControl[];
}

export interface MarioProgram {
  readonly id: string;
  readonly generationHash: string;
  readonly plan: MarioPlan;
  readonly playback: MarioPlayback;
  readonly lighting: MarioLighting;
  readonly effects: MarioEffects;
  readonly interaction: MarioInteraction;
  readonly presentation: MarioPresentation;
  readonly cursor: MarioCursor;
  readonly assets: Readonly<{
    readonly background: LoadedModelAsset;
    readonly cursor: LoadedModelAsset;
    readonly effects: LoadedModelAsset;
    readonly texels: LoadedModelAsset;
  }>;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CssGraphicsPackageError(
      "adapter-binding-mismatch",
      `${label} is missing from the Mario program.`,
    );
  }
  return value as JsonObject;
}

function section(
  sections: CssGraphicsModelData["sections"],
  name: string,
): JsonObject {
  return object(sections[name], `model.sections.${name}`);
}

function exactCount(value: unknown, count: number, label: string): void {
  if (!Array.isArray(value) || value.length !== count) {
    throw new CssGraphicsPackageError(
      "adapter-binding-mismatch",
      `${label} must contain exactly ${count} rows.`,
    );
  }
}

export function decodeMarioProgram(loaded: LoadedCssGraphicsModel): MarioProgram {
  if (loaded.manifest.profile !== SUPER_MARIO_64_PROFILE) {
    throw new CssGraphicsPackageError(
      "adapter-binding-mismatch",
      `The Super Mario 64 player cannot bind ${loaded.manifest.profile}.`,
    );
  }
  const sections = loaded.model.sections;
  const structure = section(sections, "structure");
  const playbackSection = section(sections, "playback");
  const lightingSection = section(sections, "lighting");
  const effectsSection = section(sections, "effects");
  const interactionSection = section(sections, "interaction");
  const presentation = section(sections, "presentation");

  const plan = object(structure.trianglePlan, "model.sections.structure.trianglePlan");
  const topology = object(plan.topology, "Mario topology");
  const playback = object(playbackSection.packet, "Mario playback");
  const lighting = object(lightingSection.contract, "Mario lighting");
  const effects = object(effectsSection.packet, "Mario effects");
  const interaction = object(interactionSection.packet, "Mario interaction");
  const cursor = object(interactionSection.cursor, "Mario cursor");

  if (
    playback.schema !== "cssgraphics-title-head-playback-packet@1"
    || playback.layout !== "flat-delta-index-v1"
    || playback.shapeCount !== MARIO_SHAPE_COUNT
    || playback.leafCount !== MARIO_LEAF_COUNT
    || lighting.schema !== "cssgraphics-title-head-lighting-atlases@9"
    || lighting.trianglePlanHash !== plan.contentHash
    || lighting.materialsHash !== plan.materialsHash
    || lighting.frameCount !== MARIO_FRAME_COUNT
  ) {
    throw new CssGraphicsPackageError(
      "adapter-binding-mismatch",
      "The Mario program contracts do not describe the retained title head.",
    );
  }

  exactCount(topology.shapes, MARIO_SHAPE_COUNT, "Mario topology shapes");
  exactCount(plan.leaves, MARIO_LEAF_COUNT, "Mario topology leaves");
  exactCount(object(lighting.surface, "Mario lighting surface").faces, MARIO_LEAF_COUNT, "Mario lighting faces");
  exactCount(playback.frameRows, MARIO_FRAME_COUNT, "Mario playback frames");
  exactCount(effects.stars, 2, "Mario effect stars");
  exactCount(effects.emitters, 3, "Mario effect emitters");
  if (object(effects.totals, "Mario effect totals").effectLeaves !== 92) {
    throw new CssGraphicsPackageError(
      "adapter-binding-mismatch",
      "The Mario effect pool must contain 92 retained leaves.",
    );
  }

  return Object.freeze({
    id: loaded.manifest.id,
    generationHash: loaded.manifest.generationHash,
    plan: plan as unknown as MarioPlan,
    playback: playback as unknown as MarioPlayback,
    lighting: lighting as unknown as MarioLighting,
    effects: effects as unknown as MarioEffects,
    interaction: interaction as unknown as MarioInteraction,
    presentation: presentation as unknown as MarioPresentation,
    cursor: cursor as unknown as MarioCursor,
    assets: Object.freeze({
      background: loaded.assetOwner.get("background"),
      cursor: loaded.assetOwner.get("cursor"),
      effects: loaded.assetOwner.get("effects"),
      texels: loaded.assetOwner.get("texels"),
    }),
  });
}
