import {
  gdIdentityMatrix,
  gdLookAt,
  gdProjectWorldToScreen,
  gdTranslateMatrix,
  gdVectorMagnitude,
  type GoddardMat4,
  type GoddardVec3,
} from "./math.js";
import {
  array,
  fail,
  finite,
  integer,
  matrix,
  record,
  string,
  vec3,
} from "./contract.js";

export const TITLE_HEAD_PICKING_RUNTIME_SCHEMA = "cssgraphics.title-head-picking-runtime.v1" as const;

export const TITLE_HEAD_CAMERA_CONTRACT = Object.freeze({
  worldPosition: Object.freeze([0, 200, 2000] as const),
  lookAt: Object.freeze([0, 200, 0] as const),
  rollDegrees: 0,
  viewport: Object.freeze({ width: 320, height: 240 }),
});

export interface TitleHeadGrabberInput {
  readonly id: string;
  readonly role: string;
  readonly sourceOrder: number;
  readonly sourcePosition: readonly number[];
  readonly grabbable: boolean;
  readonly attachmentIds?: readonly string[];
}

interface NormalizedGrabber {
  readonly id: string;
  readonly role: string;
  readonly sourceOrder: number;
  readonly sourcePosition: GoddardVec3;
  readonly initialRotationMatrix: GoddardMat4;
  readonly grabbable: true;
  readonly attachmentIds: readonly string[];
}

export interface TitleHeadPickingRuntime {
  readonly schema: typeof TITLE_HEAD_PICKING_RUNTIME_SCHEMA;
  readonly camera: Readonly<{
    worldPosition: GoddardVec3;
    lookAt: GoddardVec3;
    rollDegrees: number;
    viewMatrix: GoddardMat4;
  }>;
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly grabbers: readonly NormalizedGrabber[];
}

export interface ProjectedTitleHeadGrabber {
  readonly id: string;
  readonly role: string;
  readonly sourceOrder: number;
  readonly worldPosition: GoddardVec3;
  readonly screenPosition: GoddardVec3;
  readonly projected: boolean;
  readonly cameraDepth: number;
  readonly cameraDistance: number;
  readonly attachmentIds: readonly string[];
}

const f32 = Math.fround;
function normalizeGrabber(value: TitleHeadGrabberInput, index: number): NormalizedGrabber | null {
  if (!value.grabbable) return null;
  const id = string(value.id, `grabbers[${index}].id`);
  const sourcePosition = vec3(value.sourcePosition, `${id}.sourcePosition`);
  const attachmentIds = Object.freeze((value.attachmentIds ?? []).map((attachmentId, attachmentIndex) => (
    string(attachmentId, `${id}.attachmentIds[${attachmentIndex}]`)
  )));
  return Object.freeze({
    id,
    role: string(value.role, `${id}.role`),
    sourceOrder: integer(value.sourceOrder, `${id}.sourceOrder`),
    sourcePosition,
    initialRotationMatrix: gdTranslateMatrix(gdIdentityMatrix(), sourcePosition),
    grabbable: true as const,
    attachmentIds,
  });
}

export function createTitleHeadPickingRuntime({
  grabbers: grabberInputs,
  cameraWorldPosition = TITLE_HEAD_CAMERA_CONTRACT.worldPosition,
  cameraLookAt = TITLE_HEAD_CAMERA_CONTRACT.lookAt,
  cameraRollDegrees = TITLE_HEAD_CAMERA_CONTRACT.rollDegrees,
  viewport = TITLE_HEAD_CAMERA_CONTRACT.viewport,
}: {
  readonly grabbers: readonly TitleHeadGrabberInput[];
  readonly cameraWorldPosition?: readonly number[];
  readonly cameraLookAt?: readonly number[];
  readonly cameraRollDegrees?: number;
  readonly viewport?: Readonly<{ width: number; height: number }>;
}): TitleHeadPickingRuntime {
  if (!Array.isArray(grabberInputs) || grabberInputs.length === 0) fail("Picking requires source grabbers.");
  const worldPosition = vec3(cameraWorldPosition, "cameraWorldPosition");
  const lookAt = vec3(cameraLookAt, "cameraLookAt");
  const rollDegrees = finite(cameraRollDegrees, "cameraRollDegrees");
  const width = finite(viewport.width, "viewport.width");
  const height = finite(viewport.height, "viewport.height");
  if (width <= 0 || height <= 0) fail("Picking viewport must be positive.");
  const grabbers = Object.freeze(grabberInputs
    .map(normalizeGrabber)
    .filter((grabber): grabber is NormalizedGrabber => grabber !== null)
    .sort((left, right) => left.sourceOrder - right.sourceOrder));
  if (grabbers.length === 0) fail("Picking requires at least one grabbable control.");
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const grabber of grabbers) {
    if (ids.has(grabber.id)) fail(`Grabber ${grabber.id} is duplicated.`);
    if (orders.has(grabber.sourceOrder)) fail(`Grabber source order ${grabber.sourceOrder} is duplicated.`);
    ids.add(grabber.id);
    orders.add(grabber.sourceOrder);
  }
  return Object.freeze({
    schema: TITLE_HEAD_PICKING_RUNTIME_SCHEMA,
    camera: Object.freeze({
      worldPosition,
      lookAt,
      rollDegrees,
      viewMatrix: gdLookAt(worldPosition, lookAt, rollDegrees),
    }),
    viewport: Object.freeze({ width, height }),
    grabbers,
  });
}

function projectedGrabbers(
  runtime: TitleHeadPickingRuntime,
  overrides: Readonly<Record<string, readonly number[]>> = Object.freeze({}),
): readonly ProjectedTitleHeadGrabber[] {
  const knownIds = new Set(runtime.grabbers.map((grabber) => grabber.id));
  for (const id of Object.keys(overrides)) {
    if (!knownIds.has(id)) fail(`Grabber matrix override ${id} is unknown.`);
  }
  return Object.freeze(runtime.grabbers.map((grabber) => {
    const rotationMatrix = overrides[grabber.id] === undefined
      ? grabber.initialRotationMatrix
      : matrix(overrides[grabber.id], `grabberMatrixOverrides.${grabber.id}`);
    const worldPosition = Object.freeze([
      rotationMatrix[12],
      rotationMatrix[13],
      rotationMatrix[14],
    ]) as GoddardVec3;
    const projection = gdProjectWorldToScreen(worldPosition, runtime.camera.viewMatrix, runtime.viewport);
    const difference = Object.freeze([
      f32(worldPosition[0] - runtime.camera.worldPosition[0]),
      f32(worldPosition[1] - runtime.camera.worldPosition[1]),
      f32(worldPosition[2] - runtime.camera.worldPosition[2]),
    ]) as GoddardVec3;
    return Object.freeze({
      id: grabber.id,
      role: grabber.role,
      sourceOrder: grabber.sourceOrder,
      worldPosition,
      screenPosition: projection.position,
      projected: projection.projected,
      cameraDepth: f32(-projection.position[2]),
      cameraDistance: gdVectorMagnitude(difference),
      attachmentIds: grabber.attachmentIds,
    });
  }));
}

export function projectTitleHeadGrabbers(
  runtime: TitleHeadPickingRuntime,
  grabberMatrixOverrides: Readonly<Record<string, readonly number[]>> = Object.freeze({}),
): readonly ProjectedTitleHeadGrabber[] {
  if (runtime.schema !== TITLE_HEAD_PICKING_RUNTIME_SCHEMA) fail("Unexpected picking runtime schema.");
  return projectedGrabbers(runtime, grabberMatrixOverrides);
}

export function createPreparedTitleHeadPickingRuntime(deformation: unknown): TitleHeadPickingRuntime {
  const prepared = record(deformation, "deformation");
  if (prepared.schema !== "cssgraphics-title-head-deformation@1") fail("Unexpected deformation schema.");
  const controls = array(prepared.controls, "deformation.controls");
  const grabbers: TitleHeadGrabberInput[] = controls.map((entry, index) => {
    const control = record(entry, `deformation.controls[${index}]`);
    const attachments = array(control.attachments, `deformation.controls[${index}].attachments`);
    return {
      id: string(control.id, `deformation.controls[${index}].id`),
      role: string(control.role, `deformation.controls[${index}].role`),
      sourceOrder: integer(control.sourceOrder, `deformation.controls[${index}].sourceOrder`),
      sourcePosition: array(control.sourcePosition, `deformation.controls[${index}].sourcePosition`) as readonly number[],
      grabbable: control.grabbable === true,
      attachmentIds: attachments.map((attachment, attachmentIndex) => string(
        record(attachment, `deformation.controls[${index}].attachments[${attachmentIndex}]`).objectId,
        `deformation.controls[${index}].attachments[${attachmentIndex}].objectId`,
      )),
    };
  });
  const runtime = createTitleHeadPickingRuntime({ grabbers });
  if (runtime.grabbers.length !== 7 || runtime.grabbers.some((grabber, index) => grabber.sourceOrder !== index)) {
    fail("Regular title-head picking requires the seven source-ordered grabbable controls.");
  }
  return runtime;
}
