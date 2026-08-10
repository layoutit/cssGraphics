// SPDX-License-Identifier: GPL-2.0-only
// Kent Rosenkoetter motion parameters and presentation order are adapted from
// srirangav/electropaintosx commit 3be67ea1562c0df573edc21e8bfa9f88e62b5b38
// and iamralpht/elektropaintjs commit 12d5f43ab34f26eb388651de3b870800972ac96c.
import { identity, multiply, rotationX, rotationY, rotationZ, translation } from "./math.mjs";

export const KENT_SEED = 0x45504a53;
export const KENT_HISTORY_LENGTH = 40;
export const KENT_SOURCE_TICKS_PER_SECOND = 60;
export const KENT_SOURCE_VIEWPORT = Object.freeze({ width: 960, height: 540 });
export const KENT_SQUARE_SIZE_PIXELS = 27;

export function createPreparedKentMotion(seed = KENT_SEED) {
  const random = new SeededRandom(seed);
  const red = new RandomWalk(random, { minimum: 0, maximum: 1, stability: 95 });
  const green = new RandomWalk(random, { minimum: 0, maximum: 1, stability: 40 });
  const blue = new RandomWalk(random, { minimum: 0, maximum: 1, stability: 70 });
  const roll = new RandomWalk(random, {
    minimum: 0, maximum: 360, stability: 80, wrap: true, maximumSpeed: 0.5, maximumAcceleration: 0.125,
  });
  const pitch = new RandomWalk(random, {
    minimum: 0, maximum: 360, stability: 40, wrap: true, maximumSpeed: 1, maximumAcceleration: 0.125,
  });
  const yaw = new RandomWalk(random, {
    minimum: 0, maximum: 360, stability: 50, wrap: true, maximumSpeed: 0.75, maximumAcceleration: 0.125,
  });
  const radius = new RandomWalk(random, {
    minimum: -15, maximum: 15, stability: 150, maximumSpeed: 0.05, maximumAcceleration: 0.005,
  });
  const angle = new RandomWalk(random, {
    minimum: 0, maximum: 360, stability: 120, wrap: true, maximumSpeed: 1, maximumAcceleration: 0.025,
  });
  const deltaAngle = new RandomWalk(random, {
    minimum: 0, maximum: 360, stability: 80, wrap: true, maximumSpeed: 0.1, maximumAcceleration: 0.01,
  });
  const zDelta = new RandomWalk(random, {
    minimum: 0.4, maximum: 0.7, stability: 200, maximumSpeed: 0.005, maximumAcceleration: 0.0005,
  });

  function newWing() {
    // Preserve the Kent/Ralph source call order.
    return Object.freeze({
      radius: radius.generate(),
      angle: angle.generate(),
      deltaAngle: deltaAngle.generate(),
      zDelta: zDelta.generate(),
      roll: roll.generate(),
      pitch: pitch.generate(),
      yaw: yaw.generate(),
      color: Object.freeze([red.generate(), green.generate(), blue.generate()]),
    });
  }

  let wings = Array.from({ length: KENT_HISTORY_LENGTH }, newWing);

  return Object.freeze({
    readFrame() {
      let chain = identity();
      const matrices = new Array(KENT_HISTORY_LENGTH);
      const colors = new Array(KENT_HISTORY_LENGTH);
      for (let index = 0; index < wings.length; index += 1) {
        const wing = wings[index];
        chain = multiply(chain, translation(0, 0, wing.zDelta * KENT_SOURCE_VIEWPORT.height * 0.02));
        let model = multiply(chain, rotationZ(wing.angle + index * wing.deltaAngle));
        model = multiply(model, translation(wing.radius * 10, 0, 0));
        model = multiply(model, rotationZ(-wing.yaw));
        model = multiply(model, rotationY(-wing.pitch));
        model = multiply(model, rotationX(wing.roll));
        matrices[index] = model;
        colors[index] = wing.color;
      }
      return Object.freeze({ matrices: Object.freeze(matrices), colors: Object.freeze(colors) });
    },
    step() {
      wings = Object.freeze([newWing(), ...wings.slice(0, -1)]);
    },
    randomState() { return random.capture(); },
  });
}

class SeededRandom {
  constructor(state) { this.state = state >>> 0; }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  capture() { return this.state; }
}

class RandomWalk {
  constructor(random, options = {}) {
    this.random = random;
    this.minimum = options.minimum ?? 0;
    this.maximum = options.maximum ?? 1;
    this.stability = options.stability ?? 50;
    this.wrap = options.wrap ?? false;
    this.maximumAcceleration = options.maximumAcceleration ?? 0.005;
    this.maximumSpeed = options.maximumSpeed ?? 0.02;
    this.value = 0;
    this.delta = 0;
    this.count = 1_000;
    this.acceleration = 0;
  }

  generate() {
    this.count += 1;
    if (this.count > this.stability) {
      this.acceleration = (this.random.next() - 0.5) * 2 * this.maximumAcceleration;
      this.count = 0;
    }
    this.delta = Math.min(this.maximumSpeed, Math.max(-this.maximumSpeed, this.delta + this.acceleration));
    this.value += this.delta;
    if (this.wrap) {
      this.value = ((this.value - this.minimum) % (this.maximum - this.minimum)) + this.minimum;
    } else {
      this.value = Math.min(this.maximum, Math.max(this.minimum, this.value));
    }
    return this.value;
  }
}
