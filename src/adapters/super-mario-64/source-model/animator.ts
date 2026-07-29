import {
  gdIdentityMatrix,
  gdRotateMatrixEuler,
  gdScaleMatrix,
  gdTranslateMatrix,
  type GoddardMat4,
  type GoddardVec3,
} from "./math.js";
import {
  array,
  fail,
  finite,
  integer,
  record,
  string,
  vec3,
} from "./contract.js";

export const TITLE_HEAD_ANIMATOR_RUNTIME_SCHEMA = "cssgraphics.title-head-animator-runtime.v1" as const;
export const TITLE_HEAD_ANIMATOR_STATE_SCHEMA = "cssgraphics.title-head-animator-state.v1" as const;

export type RegularTitleHeadStateId = 0 | 2 | 3 | 4 | 5 | 6 | 7;
export type TitleHeadAnimationType = 6 | 8;
export type TitleHeadAnimationTargetType = "joint" | "root-net" | "light";

export interface RegularTitleHeadAnimatorState {
  readonly schema: typeof TITLE_HEAD_ANIMATOR_STATE_SCHEMA;
  readonly tick: number;
  readonly state: RegularTitleHeadStateId;
  readonly frame: number;
  readonly animSeqNum: 0;
  readonly nods: number;
  readonly stillTimer: number;
}

export interface RegularTitleHeadControl {
  readonly dragging: boolean | 0 | 1;
}

export interface TitleHeadAnimationChannelInput {
  readonly id: string;
  readonly sourceOrder: number;
  readonly targetId: string;
  readonly targetType: TitleHeadAnimationTargetType;
  readonly type: TitleHeadAnimationType;
  readonly samples: readonly (readonly number[])[];
  readonly componentScale: number | readonly number[];
  readonly targetScale: readonly number[];
  readonly targetInitialPosition: readonly number[];
}

interface NormalizedChannel {
  readonly id: string;
  readonly sourceOrder: number;
  readonly targetId: string;
  readonly targetType: TitleHeadAnimationTargetType;
  readonly type: TitleHeadAnimationType;
  readonly samples: readonly (readonly number[])[];
  readonly componentScale: readonly number[];
  readonly targetScale: GoddardVec3;
  readonly targetInitialPosition: GoddardVec3;
}

export interface TitleHeadAnimatorRuntime {
  readonly schema: typeof TITLE_HEAD_ANIMATOR_RUNTIME_SCHEMA;
  readonly channels: readonly NormalizedChannel[];
  readonly frameCount: number;
  readonly objectTargetIds: readonly string[];
  readonly lightTargetIds: readonly string[];
}

export interface TitleHeadChannelTransform {
  readonly id: string;
  readonly sourceOrder: number;
  readonly targetId: string;
  readonly targetType: TitleHeadAnimationTargetType;
  readonly type: TitleHeadAnimationType;
  readonly sampledFrame: number;
  readonly currentFrame: number;
  readonly nextFrame: number;
  readonly interpolation: number;
  readonly rotationDegrees: GoddardVec3;
  readonly position: GoddardVec3;
  readonly scale: GoddardVec3;
  readonly localMatrix: GoddardMat4;
}

export interface TitleHeadAnimatorSample {
  readonly sampledFrame: number;
  readonly channels: readonly TitleHeadChannelTransform[];
  readonly objectMatrixOverrides: Readonly<Record<string, GoddardMat4>>;
  readonly lights: readonly {
    readonly id: string;
    readonly position: GoddardVec3;
    readonly rotationDegrees: GoddardVec3;
    readonly localMatrix: GoddardMat4;
  }[];
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

function interpolate(left: number, right: number, amount: number): number {
  return add(left, multiply(subtract(right, left), amount));
}

function stateId(value: unknown): RegularTitleHeadStateId {
  if (value !== 0 && value !== 2 && value !== 3 && value !== 4 && value !== 5 && value !== 6 && value !== 7) {
    fail(`Unsupported regular-head state ${String(value)}.`);
  }
  return value;
}

function normalizedState(value: RegularTitleHeadAnimatorState): RegularTitleHeadAnimatorState {
  if (value.schema !== TITLE_HEAD_ANIMATOR_STATE_SCHEMA) fail("Unexpected animator state schema.");
  const tick = integer(value.tick, "state.tick");
  const frame = finite(value.frame, "state.frame");
  const nods = integer(value.nods, "state.nods");
  const stillTimer = integer(value.stillTimer, "state.stillTimer");
  if (tick < 0 || frame <= 0 || frame > 820 || nods < 0 || stillTimer < 0 || value.animSeqNum !== 0) {
    fail("Regular-head animator state is outside its source bounds.");
  }
  return Object.freeze({
    schema: TITLE_HEAD_ANIMATOR_STATE_SCHEMA,
    tick,
    state: stateId(value.state),
    frame,
    animSeqNum: 0 as const,
    nods,
    stillTimer,
  });
}

export function createRegularTitleHeadAnimatorState(
  overrides: Partial<Omit<RegularTitleHeadAnimatorState, "schema">> = Object.freeze({}),
): RegularTitleHeadAnimatorState {
  return normalizedState({
    schema: TITLE_HEAD_ANIMATOR_STATE_SCHEMA,
    tick: overrides.tick ?? 0,
    state: overrides.state ?? 0,
    frame: overrides.frame ?? 1,
    animSeqNum: 0,
    nods: overrides.nods ?? 0,
    stillTimer: overrides.stillTimer ?? 0,
  });
}

function dragging(value: boolean | 0 | 1): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  fail("dragging must be boolean or integer 0/1.");
}

export function stepRegularTitleHeadAnimatorState(
  inputState: RegularTitleHeadAnimatorState,
  control: RegularTitleHeadControl,
): RegularTitleHeadAnimatorState {
  const input = normalizedState(inputState);
  const aBtnPressed = dragging(control.dragging);
  let nextState: RegularTitleHeadStateId | 0 = 0;
  let frame = input.frame;
  let animSeqNum: 0 = input.animSeqNum;
  let nods = input.nods;
  let stillTimer = input.stillTimer;

  switch (input.state) {
    case 0:
      frame = 1;
      animSeqNum = 0;
      nextState = 2;
      nods = 5;
      break;
    case 2:
      if (aBtnPressed) nextState = 5;
      frame = add(frame, 1);
      if (frame === 810) {
        frame = 750;
        nods -= 1;
        if (nods === 0) nextState = 3;
      }
      break;
    case 3:
      frame = add(frame, 1);
      if (frame === 820) {
        frame = 69;
        nextState = 4;
      }
      break;
    case 4:
      frame = add(frame, 1);
      if (frame === 660) {
        frame = 661;
        nextState = 2;
        nods = 5;
      }
      break;
    case 5:
      if (frame === 660) nextState = 7;
      else if (frame > 660) frame = subtract(frame, 1);
      else frame = add(frame, 1);
      stillTimer = 150;
      break;
    case 7:
      if (aBtnPressed) stillTimer = 300;
      else {
        stillTimer -= 1;
        if (stillTimer === 0) nextState = 6;
      }
      frame = 660;
      break;
    case 6:
      nextState = 2;
      nods = 5;
      break;
  }

  return normalizedState({
    schema: TITLE_HEAD_ANIMATOR_STATE_SCHEMA,
    tick: input.tick + 1,
    state: nextState === 0 ? input.state : nextState,
    frame,
    animSeqNum,
    nods,
    stillTimer,
  });
}

function normalizeChannel(input: TitleHeadAnimationChannelInput, index: number): NormalizedChannel {
  const id = string(input.id, `channels[${index}].id`);
  const sourceOrder = integer(input.sourceOrder, `${id}.sourceOrder`);
  if (sourceOrder < 0) fail(`${id} has a negative source order.`);
  if (input.type !== 6 && input.type !== 8) fail(`${id} has type ${String(input.type)}.`);
  if (input.targetType !== "joint" && input.targetType !== "root-net" && input.targetType !== "light") {
    fail(`${id} has target type ${String(input.targetType)}.`);
  }
  const width = input.type === 6 ? 3 : 6;
  if (!Array.isArray(input.samples) || input.samples.length < 2) fail(`${id} needs at least two frames.`);
  const samples = Object.freeze(input.samples.map((row, frameIndex) => {
    if (!Array.isArray(row) || row.length !== width) fail(`${id} frame ${frameIndex + 1} must have ${width} values.`);
    return Object.freeze(row.map((entry, componentIndex) => {
      const value = integer(entry, `${id}.samples[${frameIndex}][${componentIndex}]`);
      if (value < -32768 || value > 32767) fail(`${id} has a component outside s16.`);
      return value;
    }));
  }));
  let componentScale: readonly number[];
  if (typeof input.componentScale === "number") {
    const value = finite(input.componentScale, `${id}.componentScale`);
    componentScale = Object.freeze(new Array(width).fill(value));
  } else {
    if (!Array.isArray(input.componentScale) || input.componentScale.length !== width) {
      fail(`${id} needs ${width} component scales.`);
    }
    componentScale = Object.freeze(input.componentScale.map((value, componentIndex) => finite(value, `${id}.componentScale[${componentIndex}]`)));
  }
  return Object.freeze({
    id,
    sourceOrder,
    targetId: string(input.targetId, `${id}.targetId`),
    targetType: input.targetType,
    type: input.type,
    samples,
    componentScale,
    targetScale: vec3(input.targetScale, `${id}.targetScale`),
    targetInitialPosition: vec3(input.targetInitialPosition, `${id}.targetInitialPosition`),
  });
}

export function createTitleHeadAnimatorRuntime(
  channelsInput: readonly TitleHeadAnimationChannelInput[],
): TitleHeadAnimatorRuntime {
  if (!Array.isArray(channelsInput) || channelsInput.length === 0) fail("Animator runtime requires channels.");
  const channels = Object.freeze(channelsInput.map(normalizeChannel).sort((left, right) => left.sourceOrder - right.sourceOrder));
  const ids = new Set<string>();
  const orders = new Set<number>();
  const targets = new Set<string>();
  const frameCount = channels[0].samples.length;
  for (const channel of channels) {
    if (ids.has(channel.id)) fail(`Channel ${channel.id} is duplicated.`);
    if (orders.has(channel.sourceOrder)) fail(`Source order ${channel.sourceOrder} is duplicated.`);
    if (targets.has(channel.targetId)) fail(`Target ${channel.targetId} is linked by multiple channels.`);
    if (channel.samples.length !== frameCount) fail(`${channel.id} frame count differs.`);
    ids.add(channel.id);
    orders.add(channel.sourceOrder);
    targets.add(channel.targetId);
  }
  return Object.freeze({
    schema: TITLE_HEAD_ANIMATOR_RUNTIME_SCHEMA,
    channels,
    frameCount,
    objectTargetIds: Object.freeze(channels.filter((channel) => channel.targetType !== "light").map((channel) => channel.targetId)),
    lightTargetIds: Object.freeze(channels.filter((channel) => channel.targetType === "light").map((channel) => channel.targetId)),
  });
}

function sourceFrame(frameInput: number, count: number): Readonly<{
  frame: number;
  currentIndex: number;
  nextIndex: number;
  currentFrame: number;
  nextFrame: number;
  amount: number;
}> {
  let frame = finite(frameInput, "sample frame");
  if (frame > count) frame = 1;
  else if (frame < 0) frame = count;
  if (frame < 1) fail("Goddard frame zero would index before animation data.");
  const currentFrame = Math.trunc(frame);
  const amount = subtract(frame, currentFrame);
  const nextFrame = currentFrame + 1 > count ? 1 : currentFrame + 1;
  return Object.freeze({
    frame,
    currentIndex: currentFrame - 1,
    nextIndex: nextFrame - 1,
    currentFrame,
    nextFrame,
    amount,
  });
}

function scaledComponent(channel: NormalizedChannel, row: readonly number[], index: number): number {
  return multiply(row[index], channel.componentScale[index]);
}

function sampleChannel(channel: NormalizedChannel, frameInput: number): TitleHeadChannelTransform {
  const frame = sourceFrame(frameInput, channel.samples.length);
  const current = channel.samples[frame.currentIndex];
  const next = channel.samples[frame.nextIndex];
  const component = (index: number): number => {
    const left = scaledComponent(channel, current, index);
    if (frame.amount === 0) return left;
    return interpolate(left, scaledComponent(channel, next, index), frame.amount);
  };
  const rotationDegrees = immutableVec(component(0), component(1), component(2));
  const position = channel.type === 8
    ? immutableVec(component(3), component(4), component(5))
    : channel.targetInitialPosition;
  let localMatrix = gdIdentityMatrix();
  // interpolate_animation_transform includes target scale in the I-matrix only
  // on the fractional path. Integer frames instead publish scale separately.
  if (frame.amount !== 0) localMatrix = gdScaleMatrix(localMatrix, channel.targetScale);
  localMatrix = gdRotateMatrixEuler(localMatrix, rotationDegrees);
  localMatrix = gdTranslateMatrix(localMatrix, position);
  return Object.freeze({
    id: channel.id,
    sourceOrder: channel.sourceOrder,
    targetId: channel.targetId,
    targetType: channel.targetType,
    type: channel.type,
    sampledFrame: frame.frame,
    currentFrame: frame.currentFrame,
    nextFrame: frame.nextFrame,
    interpolation: frame.amount,
    rotationDegrees,
    position,
    scale: channel.targetScale,
    localMatrix,
  });
}

export function sampleTitleHeadAnimator(
  runtime: TitleHeadAnimatorRuntime,
  frame: number,
): TitleHeadAnimatorSample {
  if (runtime.schema !== TITLE_HEAD_ANIMATOR_RUNTIME_SCHEMA) fail("Unexpected animator runtime schema.");
  const channels = Object.freeze(runtime.channels.map((channel) => sampleChannel(channel, frame)));
  const objectMatrixOverrides = Object.freeze(Object.fromEntries(
    channels
      .filter((channel) => channel.targetType !== "light")
      .map((channel) => [channel.targetId, channel.localMatrix]),
  ));
  const lights = Object.freeze(channels
    .filter((channel) => channel.targetType === "light")
    .map((channel) => Object.freeze({
      id: channel.targetId,
      position: channel.position,
      rotationDegrees: channel.rotationDegrees,
      localMatrix: channel.localMatrix,
    })));
  return Object.freeze({ sampledFrame: channels[0].sampledFrame, channels, objectMatrixOverrides, lights });
}

export function createPreparedTitleHeadAnimatorRuntime({
  animation,
  deformation,
}: {
  readonly animation: unknown;
  readonly deformation: unknown;
}): TitleHeadAnimatorRuntime {
  const animationRecord = record(animation, "animation");
  const deformationRecord = record(deformation, "deformation");
  if (animationRecord.schema !== "cssgraphics-title-head-animation@1") fail("Unexpected animation schema.");
  if (deformationRecord.schema !== "cssgraphics-title-head-deformation@1") fail("Unexpected deformation schema.");
  if (animationRecord.deformationHash !== deformationRecord.contentHash) {
    fail("Animation channels are not bound to this deformation graph.");
  }
  const deformationObjects = [
    ...array(deformationRecord.nets, "deformation.nets"),
    ...array(deformationRecord.joints, "deformation.joints"),
  ].map((entry, index) => record(entry, `deformation.objects[${index}]`));
  const objectById = new Map(deformationObjects.map((object, index) => [
    string(object.id, `deformation.objects[${index}].id`),
    object,
  ]));
  const rootNetId = string(deformationRecord.rootNetId, "deformation.rootNetId");
  const channelEntries = array(animationRecord.channels, "animation.channels");
  if (channelEntries.length !== 25) fail("Regular title-head preparation must contain 25 channels.");
  const channels: TitleHeadAnimationChannelInput[] = channelEntries.map((entry, index) => {
    const channel = record(entry, `animation.channels[${index}]`);
    const id = string(channel.id, `animation.channels[${index}].id`);
    const sourceOrder = integer(channel.sourceOrder, `${id}.sourceOrder`);
    if (sourceOrder !== index) fail(`${id} no longer has contiguous source order.`);
    if (channel.rootAnimatorId !== "N1001") fail(`${id} is not linked to N1001.`);
    const targetId = string(channel.targetId, `${id}.targetId`);
    const targetType = string(channel.targetType, `${id}.targetType`);
    if (targetType !== "joint" && targetType !== "root-net" && targetType !== "light") {
      fail(`${id} has target type ${targetType}.`);
    }
    const sequence = record(channel.regularSequence, `${id}.regularSequence`);
    if (sequence.status !== "included-regular-title-head" || integer(sequence.frameCount, `${id}.frameCount`) !== 820) {
      fail(`${id} is not the complete regular 820-frame sequence.`);
    }
    const type = integer(sequence.type, `${id}.type`);
    if (type !== 6 && type !== 8) fail(`${id} has type ${type}.`);
    let targetScale: GoddardVec3 = immutableVec(1, 1, 1);
    let targetInitialPosition: GoddardVec3 = immutableVec(0, 0, 0);
    if (targetType !== "light") {
      const target = objectById.get(targetId);
      if (!target) fail(`${id} target ${targetId} is absent.`);
      if (targetType === "root-net" && targetId !== rootNetId) fail(`${id} targets a non-root net.`);
      if (targetType === "joint" && target["constructor"] !== "d_attach_joint_to_net") {
        fail(`${id} target ${targetId} is not a source joint.`);
      }
      const transform = record(target.transform, `${targetId}.transform`);
      targetScale = vec3(array(transform.scale, `${targetId}.transform.scale`) as readonly number[], `${targetId}.transform.scale`);
      targetInitialPosition = vec3(
        array(transform.attachOffset, `${targetId}.transform.attachOffset`) as readonly number[],
        `${targetId}.transform.attachOffset`,
      );
    } else if (targetId !== "N228" && targetId !== "N231") {
      fail(`${id} targets unexpected title light ${targetId}.`);
    }
    return {
      id,
      sourceOrder,
      targetId,
      targetType,
      type,
      samples: array(sequence.samples, `${id}.samples`) as readonly (readonly number[])[],
      componentScale: sequence.componentScale as number | readonly number[],
      targetScale,
      targetInitialPosition,
    };
  });
  const runtime = createTitleHeadAnimatorRuntime(channels);
  if (runtime.frameCount !== 820 || runtime.objectTargetIds.length !== 23 || runtime.lightTargetIds.length !== 2) {
    fail("Prepared animator target closure drifted.");
  }
  return runtime;
}
