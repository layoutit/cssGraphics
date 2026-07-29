import {
  TITLE_HEAD_ANIMATOR_STATE_SCHEMA,
  type RegularTitleHeadAnimatorState,
} from "./animator.js";
import {
  gdIdentityMatrix,
  gdLookAt,
  gdNormalizeVector,
  gdProjectWorldToScreen,
  gdTranslateMatrix,
  gdVectorMagnitude,
  type GoddardMat4,
  type GoddardVec3,
} from "./math.js";
import { TITLE_HEAD_CAMERA_CONTRACT } from "./picking.js";
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

export const TITLE_HEAD_EYE_FOLLOW_RUNTIME_SCHEMA = "cssgraphics.title-head-eye-follow-runtime.v1" as const;
export const TITLE_HEAD_EYE_FOLLOW_SNAPSHOT_SCHEMA = "cssgraphics.title-head-eye-follow-snapshot.v1" as const;
export const GODDARD_CONTROL_SCHEMA = "cssgraphics.goddard-control-state.v1" as const;

const GODDARD_CURSOR_BOUNDS = Object.freeze({
  minX: 16,
  maxX: 272,
  minY: 16,
  maxY: 208,
});

export interface GoddardControlState {
  readonly schema: typeof GODDARD_CONTROL_SCHEMA;
  readonly csrX: number;
  readonly csrY: number;
}

export function createGoddardControlState(): GoddardControlState {
  return Object.freeze({
    schema: GODDARD_CONTROL_SCHEMA,
    csrX: 160,
    csrY: 120,
  });
}

export const TITLE_HEAD_EYE_FOLLOW_CONSTANTS = Object.freeze({
  activeAnimatorState: 7,
  screenDeltaScale: 2,
  maximumOffsetMagnitude: 30,
});

export interface TitleHeadEyeFollowInput {
  readonly id: string;
  readonly role: string;
  readonly sourceOrder: number;
  readonly sourcePosition: readonly number[];
  readonly attachmentIds: readonly string[];
}

interface RuntimeEye {
  readonly id: string;
  readonly role: string;
  readonly sourceOrder: number;
  readonly initialRotationMatrix: GoddardMat4;
  readonly attachmentIds: readonly string[];
}

export interface TitleHeadEyeFollowRuntime {
  readonly schema: typeof TITLE_HEAD_EYE_FOLLOW_RUNTIME_SCHEMA;
  readonly camera: Readonly<{
    worldPosition: GoddardVec3;
    lookAt: GoddardVec3;
    rollDegrees: number;
    viewMatrix: GoddardMat4;
  }>;
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly eyes: readonly RuntimeEye[];
  readonly attachmentIds: readonly string[];
}

export interface TitleHeadEyeFollowValue {
  readonly id: string;
  readonly role: string;
  readonly sourceOrder: number;
  readonly active: boolean;
  readonly worldPosition: GoddardVec3;
  readonly screenPosition: GoddardVec3;
  readonly rawOffset: GoddardVec3;
  readonly offset: GoddardVec3;
  readonly clamped: boolean;
  readonly attachmentIds: readonly string[];
}

export interface TitleHeadEyeFollowSnapshot {
  readonly schema: typeof TITLE_HEAD_EYE_FOLLOW_SNAPSHOT_SCHEMA;
  readonly tick: number;
  readonly animatorState: number;
  readonly active: boolean;
  readonly eyes: readonly TitleHeadEyeFollowValue[];
  readonly attachmentWorldOffsets: Readonly<Record<string, GoddardVec3>>;
  readonly attachmentRotationMatrixOverrides: Readonly<Record<string, GoddardMat4>>;
}

export interface TitleHeadEyeFollowStep {
  readonly animatorState: RegularTitleHeadAnimatorState;
  readonly control: GoddardControlState;
  readonly attachmentRotationBaseMatrices: Readonly<Record<string, readonly number[]>>;
  readonly eyeRotationMatrixOverrides?: Readonly<Record<string, readonly number[]>>;
}

const f32 = Math.fround;
function immutableVec(x: number, y: number, z: number): GoddardVec3 {
  return Object.freeze([f32(x), f32(y), f32(z)]);
}

function add(left: number, right: number): number {
  return f32(f32(left) + f32(right));
}

function subtract(left: number, right: number): number {
  return f32(f32(left) - f32(right));
}

function multiply(left: number, right: number): number {
  return f32(f32(left) * f32(right));
}

function addOffset(value: GoddardMat4, offset: GoddardVec3): GoddardMat4 {
  const output = [...value];
  output[12] = add(output[12], offset[0]);
  output[13] = add(output[13], offset[1]);
  output[14] = add(output[14], offset[2]);
  return Object.freeze(output);
}

function normalizeEye(value: TitleHeadEyeFollowInput, index: number): RuntimeEye {
  const id = string(value.id, `eyes[${index}].id`);
  const sourcePosition = vec3(value.sourcePosition, `${id}.sourcePosition`);
  return Object.freeze({
    id,
    role: string(value.role, `${id}.role`),
    sourceOrder: integer(value.sourceOrder, `${id}.sourceOrder`),
    initialRotationMatrix: gdTranslateMatrix(gdIdentityMatrix(), sourcePosition),
    attachmentIds: Object.freeze(value.attachmentIds.map((attachmentId, attachmentIndex) => (
      string(attachmentId, `${id}.attachmentIds[${attachmentIndex}]`)
    ))),
  });
}

export function createTitleHeadEyeFollowRuntime({
  eyes: eyeInputs,
  cameraWorldPosition = TITLE_HEAD_CAMERA_CONTRACT.worldPosition,
  cameraLookAt = TITLE_HEAD_CAMERA_CONTRACT.lookAt,
  cameraRollDegrees = TITLE_HEAD_CAMERA_CONTRACT.rollDegrees,
  viewport = TITLE_HEAD_CAMERA_CONTRACT.viewport,
}: {
  readonly eyes: readonly TitleHeadEyeFollowInput[];
  readonly cameraWorldPosition?: readonly number[];
  readonly cameraLookAt?: readonly number[];
  readonly cameraRollDegrees?: number;
  readonly viewport?: Readonly<{ width: number; height: number }>;
}): TitleHeadEyeFollowRuntime {
  if (!Array.isArray(eyeInputs) || eyeInputs.length === 0) fail("Eye-follow requires source controls.");
  const worldPosition = vec3(cameraWorldPosition, "cameraWorldPosition");
  const lookAt = vec3(cameraLookAt, "cameraLookAt");
  const rollDegrees = finite(cameraRollDegrees, "cameraRollDegrees");
  const width = finite(viewport.width, "viewport.width");
  const height = finite(viewport.height, "viewport.height");
  if (width <= 0 || height <= 0) fail("Eye-follow viewport must be positive.");
  const eyes = Object.freeze(eyeInputs.map(normalizeEye).sort((left, right) => left.sourceOrder - right.sourceOrder));
  const ids = new Set<string>();
  const orders = new Set<number>();
  const attachmentIds: string[] = [];
  const attachments = new Set<string>();
  for (const eye of eyes) {
    if (ids.has(eye.id)) fail(`Eye ${eye.id} is duplicated.`);
    if (orders.has(eye.sourceOrder)) fail(`Eye source order ${eye.sourceOrder} is duplicated.`);
    if (eye.attachmentIds.length === 0) fail(`Eye ${eye.id} has no attachment.`);
    ids.add(eye.id);
    orders.add(eye.sourceOrder);
    for (const attachmentId of eye.attachmentIds) {
      if (attachments.has(attachmentId)) fail(`Attachment ${attachmentId} has multiple eye owners.`);
      attachments.add(attachmentId);
      attachmentIds.push(attachmentId);
    }
  }
  return Object.freeze({
    schema: TITLE_HEAD_EYE_FOLLOW_RUNTIME_SCHEMA,
    camera: Object.freeze({
      worldPosition,
      lookAt,
      rollDegrees,
      viewMatrix: gdLookAt(worldPosition, lookAt, rollDegrees),
    }),
    viewport: Object.freeze({ width, height }),
    eyes,
    attachmentIds: Object.freeze(attachmentIds),
  });
}

export function createPreparedTitleHeadEyeFollowRuntime(deformation: unknown): TitleHeadEyeFollowRuntime {
  const prepared = record(deformation, "deformation");
  if (prepared.schema !== "cssgraphics-title-head-deformation@1") fail("Unexpected deformation schema.");
  const controls = array(prepared.controls, "deformation.controls");
  const eyeInputs: TitleHeadEyeFollowInput[] = [];
  for (let index = 0; index < controls.length; index += 1) {
    const control = record(controls[index], `deformation.controls[${index}]`);
    if (control.mode !== "eye-follow") continue;
    if (control.grabbable !== false || control.rootAnimator !== true || control.updateFunction !== "eye_joint_update_func") {
      fail(`Prepared eye control ${index} has drifted from source flags.`);
    }
    eyeInputs.push({
      id: string(control.id, `deformation.controls[${index}].id`),
      role: string(control.role, `deformation.controls[${index}].role`),
      sourceOrder: integer(control.sourceOrder, `deformation.controls[${index}].sourceOrder`),
      sourcePosition: array(control.sourcePosition, `deformation.controls[${index}].sourcePosition`) as readonly number[],
      attachmentIds: array(control.attachments, `deformation.controls[${index}].attachments`).map((attachment, attachmentIndex) => string(
        record(attachment, `deformation.controls[${index}].attachments[${attachmentIndex}]`).objectId,
        `deformation.controls[${index}].attachments[${attachmentIndex}].objectId`,
      )),
    });
  }
  const runtime = createTitleHeadEyeFollowRuntime({ eyes: eyeInputs });
  if (runtime.eyes.length !== 2
    || runtime.eyes[0].sourceOrder !== 7
    || runtime.eyes[1].sourceOrder !== 8
    || runtime.attachmentIds.join(",") !== "N112,N96") {
    fail("Regular title-head eye-follow closure drifted.");
  }
  return runtime;
}

export function stepTitleHeadEyeFollow(
  runtime: TitleHeadEyeFollowRuntime,
  step: TitleHeadEyeFollowStep,
): TitleHeadEyeFollowSnapshot {
  if (runtime?.schema !== TITLE_HEAD_EYE_FOLLOW_RUNTIME_SCHEMA) fail("Unexpected eye-follow runtime schema.");
  if (step.animatorState?.schema !== TITLE_HEAD_ANIMATOR_STATE_SCHEMA) fail("Unexpected animator state schema.");
  if (step.control?.schema !== GODDARD_CONTROL_SCHEMA) fail("Unexpected Goddard control schema.");
  if (!Number.isSafeInteger(step.animatorState.tick) || step.animatorState.tick < 0) fail("Animator tick is invalid.");
  if (![0, 2, 3, 4, 5, 6, 7].includes(step.animatorState.state)) fail("Animator state is outside the regular-head state machine.");
  if (!Number.isInteger(step.control.csrX) || !Number.isInteger(step.control.csrY)) fail("Cursor coordinates must be integers.");
  if (step.control.csrX < GODDARD_CURSOR_BOUNDS.minX || step.control.csrX > GODDARD_CURSOR_BOUNDS.maxX
    || step.control.csrY < GODDARD_CURSOR_BOUNDS.minY || step.control.csrY > GODDARD_CURSOR_BOUNDS.maxY) {
    fail("Cursor coordinates are outside the source title viewport bounds.");
  }

  const providedAttachments = Object.keys(step.attachmentRotationBaseMatrices).sort();
  const expectedAttachments = [...runtime.attachmentIds].sort();
  if (providedAttachments.join("\0") !== expectedAttachments.join("\0")) {
    fail("Eye attachment rotation bases must exactly cover the runtime attachments.");
  }
  const attachmentBases = new Map(runtime.attachmentIds.map((id) => [
    id,
    matrix(step.attachmentRotationBaseMatrices[id], `attachmentRotationBaseMatrices.${id}`),
  ]));
  const eyeOverrides: Readonly<Record<string, readonly number[]>> = step.eyeRotationMatrixOverrides ?? Object.freeze({});
  const knownEyes = new Set(runtime.eyes.map(({ id }) => id));
  for (const id of Object.keys(eyeOverrides)) {
    if (!knownEyes.has(id)) fail(`Eye matrix override ${id} is unknown.`);
  }
  const active = step.animatorState.state === TITLE_HEAD_EYE_FOLLOW_CONSTANTS.activeAnimatorState;
  const attachmentWorldOffsets: Record<string, GoddardVec3> = {};
  const attachmentRotationMatrixOverrides: Record<string, GoddardMat4> = {};
  const values: TitleHeadEyeFollowValue[] = [];

  for (const eye of runtime.eyes) {
    const eyeMatrix = eyeOverrides[eye.id] === undefined
      ? eye.initialRotationMatrix
      : matrix(eyeOverrides[eye.id], `eyeRotationMatrixOverrides.${eye.id}`);
    const worldPosition = immutableVec(eyeMatrix[12], eyeMatrix[13], eyeMatrix[14]);
    const projection = gdProjectWorldToScreen(worldPosition, runtime.camera.viewMatrix, runtime.viewport);
    let rawOffset = immutableVec(0, 0, 0);
    let offset = rawOffset;
    let clamped = false;
    if (active) {
      rawOffset = immutableVec(
        multiply(subtract(step.control.csrX, projection.position[0]), TITLE_HEAD_EYE_FOLLOW_CONSTANTS.screenDeltaScale),
        multiply(subtract(projection.position[1], step.control.csrY), TITLE_HEAD_EYE_FOLLOW_CONSTANTS.screenDeltaScale),
        0,
      );
      offset = rawOffset;
      if (gdVectorMagnitude(rawOffset) > TITLE_HEAD_EYE_FOLLOW_CONSTANTS.maximumOffsetMagnitude) {
        const normalized = gdNormalizeVector(rawOffset);
        if (!normalized.normalized) fail(`Eye ${eye.id} offset could not be normalized.`);
        offset = immutableVec(
          multiply(normalized.value[0], TITLE_HEAD_EYE_FOLLOW_CONSTANTS.maximumOffsetMagnitude),
          multiply(normalized.value[1], TITLE_HEAD_EYE_FOLLOW_CONSTANTS.maximumOffsetMagnitude),
          multiply(normalized.value[2], TITLE_HEAD_EYE_FOLLOW_CONSTANTS.maximumOffsetMagnitude),
        );
        clamped = true;
      }
    }
    for (const attachmentId of eye.attachmentIds) {
      attachmentWorldOffsets[attachmentId] = offset;
      attachmentRotationMatrixOverrides[attachmentId] = addOffset(
        attachmentBases.get(attachmentId) as GoddardMat4,
        offset,
      );
    }
    values.push(Object.freeze({
      id: eye.id,
      role: eye.role,
      sourceOrder: eye.sourceOrder,
      active,
      worldPosition,
      screenPosition: projection.position,
      rawOffset,
      offset,
      clamped,
      attachmentIds: eye.attachmentIds,
    }));
  }

  return Object.freeze({
    schema: TITLE_HEAD_EYE_FOLLOW_SNAPSHOT_SCHEMA,
    tick: step.animatorState.tick,
    animatorState: step.animatorState.state,
    active,
    eyes: Object.freeze(values),
    attachmentWorldOffsets: Object.freeze(attachmentWorldOffsets),
    attachmentRotationMatrixOverrides: Object.freeze(attachmentRotationMatrixOverrides),
  });
}
