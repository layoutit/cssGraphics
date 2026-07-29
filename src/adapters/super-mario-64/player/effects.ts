import { cssNumber } from "../runtime/polycssRoot.js";
import type {
  MarioEffectCell,
  MarioEffectEmitter,
  MarioEffects,
} from "./model.js";

export interface MarioGrabEffectState {
  readonly selectedId: string | null;
  readonly grabbers: readonly Readonly<{
    readonly id: string;
    readonly matrix: readonly number[];
  }>[];
}

export interface MarioEffectsPlayer {
  readonly root: HTMLDivElement;
  readonly sourceFrame: number;
  publish(sourceFrame: number, grab?: MarioGrabEffectState | null): void;
  destroy(): void;
}

interface EffectLeaf {
  readonly element: HTMLElement;
  readonly positions: readonly string[];
}

interface Particle {
  readonly leaf: EffectLeaf;
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  timeout: number;
  visible: boolean;
}

interface Emitter {
  readonly definition: MarioEffectEmitter;
  readonly particles: readonly Particle[];
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  active: number;
  armed: boolean;
  emitted: boolean;
}

interface StarState {
  x: number;
  y: number;
  z: number;
}

const f32 = Math.fround;

function cellPosition(cell: MarioEffectCell): string {
  return `${cssNumber(-cell.x * cell.sourceToDisplayScale)}px ${
    cssNumber(-cell.y * cell.sourceToDisplayScale)
  }px`;
}

function mountLeaf(
  parent: HTMLElement,
  cells: readonly MarioEffectCell[],
  assetUrl: string,
  visible: boolean,
): EffectLeaf {
  const element = parent.ownerDocument.createElement("s");
  element.style.backgroundPosition = cellPosition(cells[0]!);
  element.style.backgroundImage = `url("${assetUrl}")`;
  if (!visible) {
    element.style.visibility = "hidden";
    element.style.opacity = "0";
  }
  element.style.transform = "translate3d(0px, 0px, 0px)";
  parent.appendChild(element);
  return Object.freeze({
    element,
    positions: Object.freeze(cells.map(cellPosition)),
  });
}

function sparkleTransform(x: number, y: number, z: number): string {
  return "matrix3d(0,1,0,0,0,0,-1,0,1,0,0,0,"
    + `${cssNumber(z)},${cssNumber(x - 32)},${cssNumber(y + 64)},1)`;
}

export function mountMarioEffects(
  scene: HTMLElement,
  packet: MarioEffects,
  assetUrl: string,
): MarioEffectsPlayer {
  const root = scene.ownerDocument.createElement("div");
  root.dataset.starEffects = "";
  scene.appendChild(root);
  const starLeaves = packet.stars.map((star) => (
    mountLeaf(root, star.textureCells, assetUrl, true)
  )) as [EffectLeaf, EffectLeaf];
  const pools = packet.emitters.map((definition) => {
    const element = scene.ownerDocument.createElement("div");
    element.dataset.emitter = definition.id.replace(/^star-effect:/u, "");
    root.appendChild(element);
    return definition.slotIds.map(() => (
      mountLeaf(element, definition.textureCells, assetUrl, false)
    ));
  }) as [EffectLeaf[], EffectLeaf[], EffectLeaf[]];
  const stars: [StarState, StarState] = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
  ];
  const emitters = packet.emitters.map((definition, index): Emitter => ({
    definition,
    particles: Object.freeze(pools[index]!.map((leaf): Particle => ({
      leaf,
      active: false,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      timeout: -1,
      visible: false,
    }))),
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    active: 0,
    armed: false,
    emitted: false,
  })) as [Emitter, Emitter, Emitter];
  const camera = packet.camera.matrix[2]!;
  const continuousBias = packet.particle.cameraBias.continuous.map(
    (value, index) => f32(camera[index]! * value),
  ) as [number, number, number];
  const pickedBias = packet.particle.cameraBias.picked.map(
    (value, index) => f32(camera[index]! * value),
  ) as [number, number, number];
  let sourceFrame = 0;
  let spawnCursor = 0;
  let destroyed = false;

  const publishStar = (starIndex: 0 | 1, frameIndex: number): void => {
    const definition = packet.stars[starIndex];
    const state = stars[starIndex];
    const leaf = starLeaves[starIndex];
    const path = frameIndex * 6;
    state.x = definition.path[path + 3]!;
    state.y = definition.path[path + 4]!;
    state.z = definition.path[path + 5]!;
    const transform = definition.preparedTransforms[frameIndex]!;
    if (leaf.element.style.transform !== transform) {
      leaf.element.style.transform = transform;
    }
    const position = leaf.positions[definition.frameIndices[frameIndex]!]!;
    if (leaf.element.style.backgroundPosition !== position) {
      leaf.element.style.backgroundPosition = position;
    }
  };
  const spawn = (
    emitter: Emitter,
    particle: Particle,
    bias: readonly [number, number, number],
  ): void => {
    const tuple = packet.spawnStream.tuples[spawnCursor]!;
    spawnCursor = (spawnCursor + 1) % packet.spawnStream.count;
    particle.x = emitter.x;
    particle.y = emitter.y;
    particle.z = emitter.z;
    particle.timeout = f32(tuple[0]);
    particle.vx = f32(tuple[1] + bias[0]);
    particle.vy = f32(tuple[2] + bias[1]);
    particle.vz = f32(tuple[3] + bias[2]);
    if (!particle.active) emitter.active += 1;
    particle.active = true;
  };
  const publishParticle = (particle: Particle): void => {
    if (!particle.active || !(particle.timeout > 0)) {
      if (particle.visible) {
        particle.visible = false;
        particle.leaf.element.style.visibility = "hidden";
      }
      return;
    }
    const displayList = Math.trunc(particle.timeout);
    const opacity = f32(particle.timeout / 10);
    if (displayList === 0) {
      if (particle.visible) {
        particle.visible = false;
        particle.leaf.element.style.visibility = "hidden";
      }
      return;
    }
    const transform = sparkleTransform(particle.x, particle.y, particle.z);
    if (particle.leaf.element.style.transform !== transform) {
      particle.leaf.element.style.transform = transform;
    }
    const frame = packet.particle.sparkleFrameTable[displayList - 1]!;
    const position = particle.leaf.positions[frame]!;
    if (particle.leaf.element.style.backgroundPosition !== position) {
      particle.leaf.element.style.backgroundPosition = position;
    }
    const opacityStyle = cssNumber(opacity);
    if (particle.leaf.element.style.opacity !== opacityStyle) {
      particle.leaf.element.style.opacity = opacityStyle;
    }
    if (!particle.visible) {
      particle.visible = true;
      particle.leaf.element.style.visibility = "visible";
    }
  };
  const advanceParticles = (emitter: Emitter): void => {
    for (const particle of emitter.particles) {
      if (particle.active) {
        particle.x = f32(particle.x + particle.vx);
        particle.y = f32(particle.y + particle.vy);
        particle.z = f32(particle.z + particle.vz);
        particle.vy = f32(particle.vy + packet.particle.gravityY);
        particle.vx = f32(particle.vx * packet.particle.damping);
        particle.vy = f32(particle.vy * packet.particle.damping);
        particle.vz = f32(particle.vz * packet.particle.damping);
        const timeout = particle.timeout;
        particle.timeout = f32(particle.timeout - 1);
        if (timeout <= 0) {
          particle.active = false;
          emitter.active -= 1;
        }
      }
      publishParticle(particle);
    }
  };
  const positionEmitter = (
    emitter: Emitter,
    x: number,
    y: number,
    z: number,
  ): void => {
    emitter.x = f32(x + emitter.vx);
    emitter.y = f32(y + emitter.vy);
    emitter.z = f32(z + emitter.vz);
    emitter.vx = f32(emitter.vx * packet.particle.damping);
    emitter.vy = f32(emitter.vy * packet.particle.damping);
    emitter.vz = f32(emitter.vz * packet.particle.damping);
  };
  const continuous = (emitter: Emitter, star: StarState): void => {
    positionEmitter(emitter, star.x, star.y, star.z);
    for (const particle of emitter.particles) {
      if (particle.timeout <= 0) spawn(emitter, particle, continuousBias);
    }
    advanceParticles(emitter);
  };
  const picked = (
    emitter: Emitter,
    grab: MarioGrabEffectState | null,
  ): void => {
    if (grab === null && emitter.active === 0) {
      emitter.armed = false;
      emitter.emitted = false;
      return;
    }
    let isPicked = false;
    let x = 0;
    let y = 0;
    let z = 0;
    if (grab?.selectedId !== null && grab?.selectedId !== undefined) {
      const selected = grab.grabbers.find(({ id }) => id === grab.selectedId);
      if (!selected) throw new TypeError("Mario selected grabber is absent.");
      x = selected.matrix[12]!;
      y = selected.matrix[13]!;
      z = selected.matrix[14]!;
      isPicked = true;
    }
    emitter.armed = isPicked;
    if (!isPicked) emitter.emitted = false;
    positionEmitter(emitter, x, y, z);
    if (emitter.armed && !emitter.emitted) {
      for (const particle of emitter.particles) {
        if (particle.timeout <= 0) spawn(emitter, particle, pickedBias);
      }
      emitter.emitted = true;
    }
    advanceParticles(emitter);
  };

  const player: MarioEffectsPlayer = Object.freeze({
    root,
    get sourceFrame(): number { return sourceFrame; },
    publish(nextFrame: number, grab: MarioGrabEffectState | null = null): void {
      if (
        destroyed
        || !Number.isSafeInteger(nextFrame)
        || nextFrame < 1
        || nextFrame > 820
      ) {
        throw new RangeError("Mario star-effects frame is invalid.");
      }
      const frameIndex = nextFrame - 1;
      publishStar(0, frameIndex);
      publishStar(1, frameIndex);
      picked(emitters[0], grab);
      continuous(emitters[1], stars[0]);
      continuous(emitters[2], stars[1]);
      sourceFrame = nextFrame;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      root.remove();
    },
  });
  player.publish(1);
  return player;
}
