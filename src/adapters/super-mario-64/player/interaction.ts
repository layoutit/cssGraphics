import type {
  MarioInteraction,
  MarioInteractionClosure,
} from "./model.js";
import {
  MARIO_BUTTON,
  type MarioInputSample,
} from "./input.js";

const f32 = Math.fround;
const add = (left: number, right: number): number => f32(f32(left) + f32(right));
const sub = (left: number, right: number): number => f32(f32(left) - f32(right));
const mul = (left: number, right: number): number => f32(f32(left) * f32(right));
const div = (left: number, right: number): number => f32(f32(left) / f32(right));

type Vec3 = readonly [number, number, number];
type Mat4 = readonly number[];
type MutableVec3 = [number, number, number];
type MutableMat4 = number[];

export interface MarioControl {
  readonly frame: number;
  readonly buttonMask: number;
  readonly stickX: number;
  readonly stickY: number;
  readonly csrX: number;
  readonly csrY: number;
  readonly dragStartX: number;
  readonly dragStartY: number;
  readonly dragStartFrame: number;
  readonly trgR: 0 | 1;
  readonly dragging: 0 | 1;
  readonly startedDragging: 0 | 1;
  readonly cursorVisible: 0 | 1;
}

export interface MarioSparseVertex {
  readonly row: number;
  readonly shapeIndex: number;
  readonly sourceVertexIndex: number;
  readonly position: MutableVec3;
}

export interface MarioSparsePublication {
  readonly controlId: string;
  readonly closure: MarioInteractionClosure;
  readonly vertices: readonly MarioSparseVertex[];
  readonly shapeMatrices: readonly Readonly<{
    readonly shapeIndex: number;
    readonly matrix: MutableMat4;
  }>[];
}

export interface MarioInteractionFrame {
  readonly sourceFrame: number;
  readonly control: MarioControl;
  readonly selectedId: string | null;
  readonly selectedMatrix: Mat4 | null;
  readonly publications: readonly MarioSparsePublication[];
  readonly safeVisibleLeaves: Uint16Array;
}

export interface MarioInteractionPlayer {
  readonly control: MarioControl;
  readonly playback: boolean;
  readonly settling: boolean;
  step(input: MarioInputSample): MarioInteractionFrame;
}

interface Grab {
  readonly index: number;
  readonly selected: boolean;
  readonly matrix: Mat4;
  readonly velocity: Vec3;
  readonly flags: number;
}

interface Movement {
  readonly index: number;
  readonly control: MarioControl;
  readonly matrix: Mat4;
  readonly velocity: Vec3;
  readonly flags: number;
  readonly snapped: boolean;
  readonly offset: Vec3;
}

interface PublicationBuffer {
  readonly publication: MarioSparsePublication;
}

type AnimatorState = 0 | 2 | 3 | 4 | 5 | 6 | 7;

interface Animator {
  readonly state: AnimatorState;
  readonly frame: number;
  readonly nods: number;
  readonly stillTimer: number;
}

function vec(x: number, y: number, z: number): Vec3 {
  return Object.freeze([f32(x), f32(y), f32(z)]);
}

function matrix(values: ArrayLike<number>, offset = 0): Mat4 {
  return Object.freeze(Array.from(
    { length: 16 },
    (_, index) => f32(values[offset + index]!),
  ));
}

function position(value: Mat4): Vec3 {
  return vec(value[12]!, value[13]!, value[14]!);
}

function withPosition(value: Mat4, next: Vec3): Mat4 {
  const output = [...value];
  output[12] = next[0];
  output[13] = next[1];
  output[14] = next[2];
  return Object.freeze(output);
}

function transform(value: Vec3, source: Mat4, translate: boolean): Vec3 {
  const component = (column: number): number => {
    let result = mul(source[column]!, value[0]);
    result = add(result, mul(source[4 + column]!, value[1]));
    result = add(result, mul(source[8 + column]!, value[2]));
    if (translate) result = add(result, source[12 + column]!);
    return result;
  };
  return vec(component(0), component(1), component(2));
}

function magnitude(value: Vec3): number {
  let squared = mul(value[0], value[0]);
  squared = add(squared, mul(value[1], value[1]));
  squared = add(squared, mul(value[2], value[2]));
  const input = f32(squared);
  return input < 1e-7 ? 0 : f32(Math.sqrt(input));
}

function normalize(value: Vec3): Vec3 {
  const size = magnitude(value);
  return size === 0
    ? vec(0, 0, 0)
    : vec(div(value[0], size), div(value[1], size), div(value[2], size));
}

function multiplyMatrices(left: Mat4, right: Mat4): Mat4 {
  const output = new Array<number>(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let value = mul(left[row * 4]!, right[column]!);
      value = add(value, mul(left[row * 4 + 1]!, right[4 + column]!));
      value = add(value, mul(left[row * 4 + 2]!, right[8 + column]!));
      value = add(value, mul(left[row * 4 + 3]!, right[12 + column]!));
      output[row * 4 + column] = value;
    }
  }
  return Object.freeze(output);
}

function translated(source: Mat4, offset: Vec3): Mat4 {
  const output = [...source];
  output[12] = add(output[12]!, offset[0]);
  output[13] = add(output[13]!, offset[1]);
  output[14] = add(output[14]!, offset[2]);
  return Object.freeze(output);
}

function projected(value: Vec3, view: Mat4): Vec3 {
  const camera = transform(value, view, true);
  const xScale = f32(256 / f32(-camera[2]));
  const yScale = f32(256 / camera[2]);
  return vec(
    add(mul(camera[0], xScale), 160),
    add(mul(camera[1], yScale), 120),
    camera[2],
  );
}

function bool(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function stepAnimator(previous: Animator, control: MarioControl): Animator {
  let state: AnimatorState | null = null;
  let frame = previous.frame;
  let nods = previous.nods;
  let stillTimer = previous.stillTimer;
  switch (previous.state) {
    case 0:
      frame = 1;
      state = 2;
      nods = 5;
      break;
    case 2:
      if (control.dragging === 1) state = 5;
      frame = add(frame, 1);
      if (frame === 810) {
        frame = 750;
        nods -= 1;
        if (nods === 0) state = 3;
      }
      break;
    case 3:
      frame = add(frame, 1);
      if (frame === 820) {
        frame = 69;
        state = 4;
      }
      break;
    case 4:
      frame = add(frame, 1);
      if (frame === 660) {
        frame = 661;
        state = 2;
        nods = 5;
      }
      break;
    case 5:
      if (frame === 660) state = 7;
      else if (frame > 660) frame = sub(frame, 1);
      else frame = add(frame, 1);
      stillTimer = 150;
      break;
    case 7:
      if (control.dragging === 1) stillTimer = 300;
      else {
        stillTimer -= 1;
        if (stillTimer === 0) state = 6;
      }
      frame = 660;
      break;
    case 6:
      state = 2;
      nods = 5;
      break;
  }
  return Object.freeze({
    state: state ?? previous.state,
    frame,
    nods,
    stillTimer,
  });
}

export function createMarioControl(): MarioControl {
  return Object.freeze({
    frame: 0,
    buttonMask: 0,
    stickX: 0,
    stickY: 0,
    csrX: 160,
    csrY: 120,
    dragStartX: 0,
    dragStartY: 0,
    dragStartFrame: (-1000) >>> 0,
    trgR: 0,
    dragging: 0,
    startedDragging: 0,
    cursorVisible: 0,
  });
}

export function stepMarioControl(
  previous: MarioControl,
  input: MarioInputSample,
): MarioControl {
  const positioned = input.cursor
    ? { ...previous, csrX: input.cursor.x, csrY: input.cursor.y }
    : previous;
  const dragging = bool((input.buttonMask & MARIO_BUTTON.A) !== 0);
  const startedDragging = bool(dragging === 1 && positioned.dragging === 0);
  let dragStartX = positioned.dragStartX;
  let dragStartY = positioned.dragStartY;
  let dragStartFrame = positioned.dragStartFrame;
  if (startedDragging) {
    dragStartX = positioned.csrX;
    dragStartY = positioned.csrY;
  }
  if (dragging) dragStartFrame = positioned.frame;
  const frame = (positioned.frame + 1) >>> 0;
  let csrX = positioned.csrX;
  let csrY = positioned.csrY;
  if (Math.abs(input.stickX) >= 6) {
    csrX = Math.trunc(csrX + input.stickX * 0.1);
  }
  if (Math.abs(input.stickY) >= 6) {
    csrY = Math.trunc(csrY - input.stickY * 0.1);
  }
  csrX = Math.max(16, Math.min(272, csrX));
  csrY = Math.max(16, Math.min(208, csrY));
  return Object.freeze({
    frame,
    buttonMask: input.buttonMask,
    stickX: input.stickX,
    stickY: input.stickY,
    csrX,
    csrY,
    dragStartX,
    dragStartY,
    dragStartFrame,
    trgR: bool((input.buttonMask & MARIO_BUTTON.R) !== 0),
    dragging,
    startedDragging,
    cursorVisible: bool(((frame - dragStartFrame) >>> 0) < 300),
  });
}

function mirrorStick(value: number): number {
  if (value === -128) return 127;
  if (value === 127) return -128;
  return -value;
}

function mirrorControl(value: MarioControl): MarioControl {
  const x = (input: number): number => Math.max(16, Math.min(272, 320 - input));
  return Object.freeze({
    ...value,
    stickX: mirrorStick(value.stickX),
    csrX: x(value.csrX),
    dragStartX: x(value.dragStartX),
  });
}

function sourceInput(input: MarioInputSample): MarioInputSample {
  return Object.freeze({
    stickX: Math.max(-128, Math.min(127, -input.stickX)),
    stickY: input.stickY,
    buttonMask: input.buttonMask,
    cursor: input.cursor
      ? Object.freeze({
          x: Math.max(16, Math.min(272, 320 - input.cursor.x)),
          y: input.cursor.y,
        })
      : null,
  });
}

function initialMatrix(packet: MarioInteraction, index: number): Mat4 {
  const source = packet.controls[index]!.sourcePosition;
  return Object.freeze([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    f32(source[0]), f32(source[1]), f32(source[2]), 1,
  ]);
}

function offsetFrom(packet: MarioInteraction, index: number, value: Mat4): Vec3 {
  const start = packet.controls[index]!.sourcePosition;
  return vec(
    sub(value[12]!, start[0]),
    sub(value[13]!, start[1]),
    sub(value[14]!, start[2]),
  );
}

function moveGrab(
  packet: MarioInteraction,
  active: Grab,
  parsed: MarioControl,
): Movement {
  const spring = packet.source.spring;
  const start = packet.controls[active.index]!.sourcePosition;
  let current = active.matrix;
  let currentPosition = position(current);
  let offset = offsetFrom(packet, active.index, current);
  let velocity = active.velocity;
  let flags = active.flags;
  let snapped = false;
  if (active.selected) {
    velocity = vec(
      mul(offset[0], spring.pickedResistance),
      mul(offset[1], spring.pickedResistance),
      mul(offset[2], spring.pickedResistance),
    );
    flags |= spring.grabbedFlag;
  } else if (parsed.trgR === 0) {
    velocity = vec(
      mul(sub(velocity[0], mul(offset[0], spring.releaseAcceleration)), spring.velocityDecay),
      mul(sub(velocity[1], mul(offset[1], spring.releaseAcceleration)), spring.velocityDecay),
      mul(sub(velocity[2], mul(offset[2], spring.releaseAcceleration)), spring.velocityDecay),
    );
    const speed = add(add(Math.abs(velocity[0]), Math.abs(velocity[1])), Math.abs(velocity[2]));
    const distance = add(add(Math.abs(offset[0]), Math.abs(offset[1])), Math.abs(offset[2]));
    if (speed < spring.snapVelocityL1 && distance < spring.snapOffsetL1) {
      velocity = vec(0, 0, 0);
      currentPosition = vec(start[0], start[1], start[2]);
      current = withPosition(current, currentPosition);
      offset = vec(0, 0, 0);
      snapped = true;
    }
    flags &= ~spring.grabbedFlag;
  } else {
    velocity = vec(0, 0, 0);
  }
  currentPosition = vec(
    add(currentPosition[0], velocity[0]),
    add(currentPosition[1], velocity[1]),
    add(currentPosition[2], velocity[2]),
  );
  current = withPosition(current, currentPosition);
  const control = active.selected
    ? Object.freeze({
        ...parsed,
        csrX: Math.trunc(
          parsed.csrX
          - (parsed.csrX - parsed.dragStartX) * spring.cursorResistance,
        ),
        csrY: Math.trunc(
          parsed.csrY
          - (parsed.csrY - parsed.dragStartY) * spring.cursorResistance,
        ),
      })
    : parsed;
  offset = offsetFrom(packet, active.index, current);
  return Object.freeze({
    index: active.index,
    control,
    matrix: current,
    velocity,
    flags,
    snapped,
    offset,
  });
}

function pick(
  packet: MarioInteraction,
  control: MarioControl,
  movement: Movement | null,
): Readonly<{ index: number | null; snap: Vec3 | null }> {
  const view = matrix(packet.source.cameraViewMatrix);
  const camera = packet.source.cameraWorldPosition;
  const hits: { index: number; screen: Vec3; distance: number }[] = [];
  for (let index = 0; index < 7; index += 1) {
    const definition = packet.controls[index]!;
    let screen = vec(definition.screenPosition[0], definition.screenPosition[1], 0);
    let distance = definition.cameraDistance;
    if (movement?.index === index) {
      const world = position(movement.matrix);
      screen = projected(world, view);
      distance = magnitude(vec(
        sub(world[0], camera[0]),
        sub(world[1], camera[1]),
        sub(world[2], camera[2]),
      ));
    }
    if (
      Math.abs(control.csrX - screen[0]) < 20
      && Math.abs(control.csrY - screen[1]) < 20
    ) {
      hits.push({ index, screen, distance });
    }
  }
  let selected: number | null = null;
  let nearest = f32(10_000_000);
  for (const hit of hits) {
    if (hit.distance < nearest) {
      nearest = hit.distance;
      selected = hit.index;
    }
  }
  return Object.freeze({
    index: selected,
    snap: hits.at(-1)?.screen ?? null,
  });
}

function applyGrab(
  packet: MarioInteraction,
  previous: Grab | null,
  movement: Movement | null,
  input: MarioControl,
): Readonly<{
  control: MarioControl;
  active: Grab | null;
  picked: number | null;
}> {
  let control = input;
  let selected = previous?.selected ? previous.index : null;
  let picked: number | null = null;
  if (control.dragging === 0) {
    selected = null;
  } else if (control.startedDragging === 1) {
    const hit = pick(packet, control, movement);
    selected = hit.index;
    picked = hit.index;
    if (selected !== null && hit.snap) {
      const x = Math.trunc(hit.snap[0]);
      const y = Math.trunc(hit.snap[1]);
      control = Object.freeze({
        ...control,
        csrX: x,
        csrY: y,
        dragStartX: x,
        dragStartY: y,
      });
    }
  }

  let nextMatrix: Mat4 | null = null;
  if (selected !== null) {
    nextMatrix = movement?.index === selected
      ? movement.matrix
      : initialMatrix(packet, selected);
    const displacement = transform(
      vec(
        mul(control.csrX - control.dragStartX, packet.source.displacementMagnitude),
        mul(-(control.csrY - control.dragStartY), packet.source.displacementMagnitude),
        0,
      ),
      matrix(packet.source.inverseCameraMatrix),
      false,
    );
    nextMatrix = withPosition(nextMatrix, vec(
      add(nextMatrix[12]!, displacement[0]),
      add(nextMatrix[13]!, displacement[1]),
      add(nextMatrix[14]!, displacement[2]),
    ));
  }

  let active: Grab | null = null;
  if (selected !== null && nextMatrix) {
    active = Object.freeze({
      index: selected,
      selected: true,
      matrix: nextMatrix,
      velocity: movement?.index === selected ? movement.velocity : vec(0, 0, 0),
      flags: movement?.index === selected ? movement.flags : 0,
    });
  } else if (movement && !movement.snapped) {
    active = Object.freeze({
      index: movement.index,
      selected: false,
      matrix: movement.matrix,
      velocity: movement.velocity,
      flags: movement.flags,
    });
  }
  return Object.freeze({ control, active, picked });
}

function createBuffer(
  packet: MarioInteraction,
  controlIndex: number,
): PublicationBuffer {
  const definition = packet.controls[controlIndex]!;
  const closure = definition.closure;
  const vertices = Object.freeze(Array.from(
    { length: closure.vertexRows.length / 4 },
    (_, row): MarioSparseVertex => Object.freeze({
      row,
      shapeIndex: closure.vertexRows[row * 4]!,
      sourceVertexIndex: closure.vertexRows[row * 4 + 1]!,
      position: [0, 0, 0] as MutableVec3,
    }),
  ));
  const shapeMatrices = Object.freeze(closure.shapeIndices.map((shapeIndex) => (
    Object.freeze({
      shapeIndex,
      matrix: new Array<number>(16).fill(0),
    })
  )));
  return Object.freeze({
    publication: Object.freeze({
      controlId: definition.id,
      closure,
      vertices,
      shapeMatrices,
    }),
  });
}

function reconstruct(
  closure: MarioInteractionClosure,
  row: number,
  offset: Vec3,
  target: MutableVec3,
): void {
  const weightOffset = closure.vertexRows[row * 4 + 2]!;
  const weightCount = closure.vertexRows[row * 4 + 3]!;
  target[0] = f32(closure.vertexPositions[row * 3]!);
  target[1] = f32(closure.vertexPositions[row * 3 + 1]!);
  target[2] = f32(closure.vertexPositions[row * 3 + 2]!);
  for (let index = weightOffset; index < weightOffset + weightCount; index += 1) {
    const active = closure.weightActiveFlags[index] === 1;
    for (let component = 0; component < 3; component += 1) {
      const translation = add(
        closure.weightBaseTranslations[index * 3 + component]!,
        active ? offset[component]! : 0,
      );
      const contribution = add(
        closure.weightLinearContributions[index * 3 + component]!,
        translation,
      );
      target[component] = add(
        target[component]!,
        mul(contribution, closure.weightScalars[index]!),
      );
    }
  }
}

function publish(
  packet: MarioInteraction,
  buffers: readonly PublicationBuffer[],
  controlIndex: number,
  offset: Vec3,
): MarioSparsePublication {
  const definition = packet.controls[controlIndex]!;
  const value = buffers[controlIndex]!.publication;
  for (const vertex of value.vertices) {
    reconstruct(value.closure, vertex.row, offset, vertex.position);
  }
  for (const output of value.shapeMatrices) {
    let source = matrix(packet.shapes.baseMatrices, output.shapeIndex * 16);
    if (definition.mode === "eye-follow") {
      const objectIndex = definition.attachmentObjectIndices[0]!;
      const rotation = matrix(packet.objects.rotationMatrices, objectIndex * 16);
      source = multiplyMatrices(
        translated(rotation, offset),
        matrix(value.closure.rigidRootInverseMatrix),
      );
    }
    for (let index = 0; index < 16; index += 1) {
      output.matrix[index] = source[index]!;
    }
  }
  return value;
}

export function createMarioInteraction(
  packet: MarioInteraction,
  displayControl: MarioControl,
): MarioInteractionPlayer {
  if (
    packet.schema !== "cssgraphics-title-head-interaction-packet@1"
    || packet.layout !== "direct-sparse-closures-v1"
    || packet.controls.length !== 9
    || packet.source.frame !== 660
    || packet.source.animatorState !== 7
  ) {
    throw new TypeError("The prepared Mario interaction program is invalid.");
  }
  const buffers = Object.freeze(packet.controls.map((_, index) => (
    createBuffer(packet, index)
  )));
  const view = matrix(packet.source.cameraViewMatrix);
  const empty = new Uint16Array(0);
  let control = mirrorControl(displayControl);
  let active: Grab | null = null;
  let animator: Animator = Object.freeze({
    state: packet.source.animatorState,
    frame: packet.source.frame,
    nods: 5,
    stillTimer: 300,
  });

  return Object.freeze({
    get control(): MarioControl { return mirrorControl(control); },
    get playback(): boolean {
      return active === null && control.dragging === 0;
    },
    get settling(): boolean {
      return active !== null && !active.selected && control.dragging === 0;
    },
    step(input: MarioInputSample): MarioInteractionFrame {
      const parsed = stepMarioControl(control, sourceInput(input));
      const sourceFrame = animator.frame;
      animator = stepAnimator(animator, parsed);
      const movement = active ? moveGrab(packet, active, parsed) : null;
      const movedControl = movement?.control ?? parsed;
      const eyeControl = movedControl;
      const grab = applyGrab(packet, active, movement, movedControl);
      active = grab.active;

      const publications: MarioSparsePublication[] = [];
      const grabIndex = movement?.index ?? grab.picked;
      if (grabIndex !== null) {
        publications.push(publish(
          packet,
          buffers,
          grabIndex,
          movement?.index === grabIndex
            ? movement.offset
            : vec(0, 0, 0),
        ));
      }
      for (let index = 7; index < 9; index += 1) {
        const eye = packet.controls[index]!;
        const screen = projected(vec(...eye.sourcePosition), view);
        let eyeOffset = vec(0, 0, 0);
        if (animator.state === packet.source.animatorState) {
          eyeOffset = vec(
            mul(sub(eyeControl.csrX, screen[0]), 2),
            mul(sub(screen[1], eyeControl.csrY), 2),
            0,
          );
          if (magnitude(eyeOffset) > packet.source.eyeMaximumOffset) {
            const direction = normalize(eyeOffset);
            eyeOffset = vec(
              mul(direction[0], packet.source.eyeMaximumOffset),
              mul(direction[1], packet.source.eyeMaximumOffset),
              mul(direction[2], packet.source.eyeMaximumOffset),
            );
          }
        }
        publications.push(publish(packet, buffers, index, eyeOffset));
      }
      control = grab.control;
      const selectedId = active?.selected
        ? packet.controls[active.index]!.id
        : null;
      const grabPublication = grabIndex === null
        ? null
        : packet.controls[grabIndex]!;
      return Object.freeze({
        sourceFrame,
        control: mirrorControl(control),
        selectedId,
        selectedMatrix: grabIndex === null
          ? null
          : movement?.index === grabIndex
            ? movement.matrix
            : initialMatrix(packet, grabIndex),
        publications: Object.freeze(publications),
        safeVisibleLeaves: grabPublication
          && grabPublication.mode === "grab"
          && (movement?.offset.some((value) => value !== 0) ?? false)
            ? Uint16Array.from(grabPublication.closure.safeVisibleLeafIndices)
            : empty,
      });
    },
  });
}
