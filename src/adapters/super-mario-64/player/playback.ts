import {
  MARIO_FRAME_COUNT,
  type MarioFrameRow,
  type MarioPlayback,
} from "./model.js";
import type { MarioScene } from "./scene.js";

export interface MarioPlaybackPlayer {
  readonly sourceFrame: number;
  readonly appearance: readonly [id: string, scale: number, translateY: number];
  readonly tick: number;
  advance(): number;
  seek(sourceFrame: number, restoreShapes?: Uint16Array, restoreLeaves?: Uint16Array): void;
  restart(restoreShapes?: Uint16Array, restoreLeaves?: Uint16Array): void;
}

function loadTriples(
  source: readonly number[],
  transforms: Uint32Array,
  visibility: Uint8Array,
): void {
  for (let offset = 0; offset < source.length; offset += 3) {
    const index = source[offset]!;
    transforms[index] = source[offset + 1]!;
    visibility[index] = source[offset + 2]!;
  }
}

function timelineFrame(packet: MarioPlayback, tick: number): number {
  const index = tick < packet.timeline.frames.length
    ? tick
    : packet.timeline.introTicks
      + ((tick - packet.timeline.introTicks) % packet.timeline.loopTicks);
  return packet.timeline.frames[index]!;
}

export function createMarioPlaybackPlayer(
  packet: MarioPlayback,
  scene: MarioScene,
  onAppearance: (
    appearance: readonly [id: string, scale: number, translateY: number],
  ) => void,
): MarioPlaybackPlayer {
  const shapeTransforms = new Uint32Array(packet.shapeCount);
  const shapeVisibility = new Uint8Array(packet.shapeCount);
  const leafTransforms = new Uint32Array(packet.leafCount);
  const leafVisibility = new Uint8Array(packet.leafCount);
  loadTriples(packet.initial.shapes, shapeTransforms, shapeVisibility);
  loadTriples(packet.initial.leaves, leafTransforms, leafVisibility);

  let sourceFrame: number = packet.initial.sourceFrame;
  let appearanceIndex = packet.initial.appearance;
  let modelTransform = packet.initial.modelTransform;
  let tick = 0;

  const row = (frame: number): MarioFrameRow => {
    const result = packet.frameRows[frame - 1];
    if (!result || result[0] !== frame) {
      throw new TypeError(`Mario playback frame ${frame} is not directly indexed.`);
    }
    return result;
  };
  const setAppearance = (index: number): void => {
    if (index === appearanceIndex) return;
    appearanceIndex = index;
    onAppearance(packet.appearances[index]!);
  };
  const applyRow = (
    next: MarioFrameRow,
    publish: boolean,
    dirtyShapes?: Set<number>,
    dirtyLeaves?: Set<number>,
  ): void => {
    sourceFrame = next[0];
    setAppearance(next[1]);
    if (next[3] !== -1) {
      modelTransform = next[3];
      if (publish) scene.writeModelTransform(packet.transforms[modelTransform]!);
    }
    for (let index = 0; index < next[5]; index += 1) {
      const base = (next[4] + index) * 3;
      const shape = packet.shapeChanges[base]!;
      shapeTransforms[shape] = packet.shapeChanges[base + 1]!;
      shapeVisibility[shape] = packet.shapeChanges[base + 2]!;
      dirtyShapes?.add(shape);
      if (publish) {
        scene.writeShape(
          shape,
          packet.transforms[shapeTransforms[shape]!]!,
          shapeVisibility[shape] === 1,
        );
      }
    }
    for (let index = 0; index < next[7]; index += 1) {
      const base = (next[6] + index) * 3;
      const leaf = packet.leafChanges[base]!;
      leafTransforms[leaf] = packet.leafChanges[base + 1]!;
      leafVisibility[leaf] = packet.leafChanges[base + 2]!;
      dirtyLeaves?.add(leaf);
      if (publish) {
        scene.writeLeafTransform(leaf, packet.transforms[leafTransforms[leaf]!]!);
      }
    }
    if (publish) scene.applySurfaceFrame(sourceFrame);
  };
  const seek = (
    target: number,
    restoreShapes = new Uint16Array(0),
    restoreLeaves = new Uint16Array(0),
  ): void => {
    if (
      !Number.isSafeInteger(target)
      || target < 1
      || target > MARIO_FRAME_COUNT
    ) {
      throw new RangeError(`Mario playback frame ${target} is outside 1..820.`);
    }
    if (target === sourceFrame && restoreShapes.length === 0 && restoreLeaves.length === 0) {
      scene.applySurfaceFrame(sourceFrame);
      return;
    }
    const dirtyShapes = new Set<number>(restoreShapes);
    const dirtyLeaves = new Set<number>(restoreLeaves);
    let next = sourceFrame;
    while (next !== target) {
      next = next === MARIO_FRAME_COUNT ? 1 : next + 1;
      applyRow(row(next), false, dirtyShapes, dirtyLeaves);
    }
    scene.writeModelTransform(packet.transforms[modelTransform]!);
    for (const index of [...dirtyShapes].sort((left, right) => left - right)) {
      scene.writeShape(
        index,
        packet.transforms[shapeTransforms[index]!]!,
        shapeVisibility[index] === 1,
      );
    }
    for (const index of [...dirtyLeaves].sort((left, right) => left - right)) {
      scene.writeLeafTransform(index, packet.transforms[leafTransforms[index]!]!);
    }
    scene.applySurfaceFrame(sourceFrame);
  };

  return Object.freeze({
    get sourceFrame(): number { return sourceFrame; },
    get appearance(): readonly [string, number, number] {
      return packet.appearances[appearanceIndex]!;
    },
    get tick(): number { return tick; },
    advance(): number {
      tick += 1;
      const target = timelineFrame(packet, tick);
      if (target === sourceFrame) return target;
      const expected = sourceFrame === MARIO_FRAME_COUNT ? 1 : sourceFrame + 1;
      if (target === expected) applyRow(row(target), true);
      else seek(target);
      return target;
    },
    seek,
    restart(
      restoreShapes = new Uint16Array(0),
      restoreLeaves = new Uint16Array(0),
    ): void {
      tick = 0;
      seek(timelineFrame(packet, 0), restoreShapes, restoreLeaves);
    },
  });
}
