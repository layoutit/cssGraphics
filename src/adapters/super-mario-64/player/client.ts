import {
  wrapCssGraphicsClient,
  type CssGraphicsExperienceMode,
  type CssGraphicsDriver,
} from "../../../runtime/shared/driver.js";
import { mountMarioEffects, type MarioEffectsPlayer } from "./effects.js";
import {
  createMarioInput,
  MARIO_BUTTON,
  type MarioInput,
} from "./input.js";
import {
  createMarioControl,
  createMarioInteraction,
  stepMarioControl,
  type MarioControl,
  type MarioInteractionFrame,
  type MarioInteractionPlayer,
} from "./interaction.js";
import type { MarioProgram } from "./model.js";
import {
  createMarioPlaybackPlayer,
  type MarioPlaybackPlayer,
} from "./playback.js";
import {
  mountMarioPresentation,
  type MarioPresentation,
} from "./presentation.js";
import { mountMarioScene, type MarioScene } from "./scene.js";

const SOURCE_TICK_MS = 1000 / 30;

export interface MarioPlayerClient {
  readonly scene: MarioScene;
  readonly presentation: MarioPresentation;
  readonly effects: MarioEffectsPlayer;
  readonly playback: MarioPlaybackPlayer;
  readonly input: MarioInput;
  readonly experienceMode: CssGraphicsExperienceMode;
  readonly tick: number;
  setExperienceMode(mode: CssGraphicsExperienceMode): void;
  stop(): void;
}

export function startMarioPlayer(
  host: HTMLElement,
  program: MarioProgram,
): MarioPlayerClient {
  const scene = mountMarioScene(
    host,
    program.plan,
    program.lighting,
    program.assets.texels.url,
  );
  let effects: MarioEffectsPlayer;
  let presentation: MarioPresentation;
  try {
    effects = mountMarioEffects(
      scene.sceneElement,
      program.effects,
      program.assets.effects.url,
    );
    presentation = mountMarioPresentation(
      host,
      program.presentation,
      program.cursor,
      program.assets.background.url,
      program.assets.cursor.url,
      scene,
      program.playback.appearances[program.playback.initial.appearance]!,
    );
  } catch (error) {
    scene.destroy();
    throw error;
  }

  const playback = createMarioPlaybackPlayer(
    program.playback,
    scene,
    (appearance) => presentation.setAppearance(appearance),
  );
  const input = createMarioInput(host, presentation);
  const restoreShapeFlags = new Uint8Array(program.playback.shapeCount);
  const restoreLeafFlags = new Uint8Array(program.playback.leafCount);
  const restoreShapeIndices: number[] = [];
  const restoreLeafIndices: number[] = [];
  let tick = 0;
  let control: MarioControl = createMarioControl();
  let interaction: MarioInteractionPlayer | null = null;
  let experienceMode: CssGraphicsExperienceMode = "animation";
  let animationRestartPending = false;
  let request = 0;
  let nextTick: number | null = null;
  let stopped = false;

  const fail = (error: unknown): void => {
    stopped = true;
    request = 0;
    input.destroy();
    host.dataset.state = "runtime-error";
    globalThis.console.error(error);
  };
  const publishCursor = (forceVisible = false): void => {
    presentation.setCursor(
      control.csrX,
      control.csrY,
      forceVisible || control.cursorVisible === 1,
      control.dragging === 1,
    );
  };
  const publishEffects = (sourceFrame: number): void => {
    if (effects.sourceFrame !== sourceFrame) effects.publish(sourceFrame);
  };
  const rememberInteractionRows = (
    publications: MarioInteractionFrame["publications"],
  ): void => {
    for (const publication of publications) {
      for (const shape of publication.shapeMatrices) {
        if (restoreShapeFlags[shape.shapeIndex] === 0) {
          restoreShapeFlags[shape.shapeIndex] = 1;
          restoreShapeIndices.push(shape.shapeIndex);
        }
      }
      for (const leafIndex of publication.closure.faceIndices) {
        if (restoreLeafFlags[leafIndex] === 0) {
          restoreLeafFlags[leafIndex] = 1;
          restoreLeafIndices.push(leafIndex);
        }
      }
    }
  };
  const takeRestoreRows = (): readonly [Uint16Array, Uint16Array] => {
    restoreShapeIndices.sort((left, right) => left - right);
    restoreLeafIndices.sort((left, right) => left - right);
    const rows = [
      Uint16Array.from(restoreShapeIndices),
      Uint16Array.from(restoreLeafIndices),
    ] as const;
    for (const index of restoreShapeIndices) restoreShapeFlags[index] = 0;
    for (const index of restoreLeafIndices) restoreLeafFlags[index] = 0;
    restoreShapeIndices.length = 0;
    restoreLeafIndices.length = 0;
    return rows;
  };
  const advanceAnimation = (): void => {
    control = stepMarioControl(control, input.sample());
    if (animationRestartPending) {
      scene.forceVisible(new Uint16Array(0));
      playback.restart(...takeRestoreRows());
      publishEffects(playback.sourceFrame);
      interaction = null;
      animationRestartPending = false;
    } else {
      const before = playback.sourceFrame;
      const sourceFrame = playback.advance();
      if (sourceFrame !== before) effects.publish(sourceFrame);
    }
    publishCursor();
  };
  const advanceInteraction = (): void => {
    const sample = input.sample();
    if (interaction === null) {
      playback.seek(660);
      publishEffects(660);
      interaction = createMarioInteraction(program.interaction, control);
    } else if (
      interaction.settling
      && control.dragging === 0
      && (sample.buttonMask & MARIO_BUTTON.A) !== 0
    ) {
      scene.forceVisible(new Uint16Array(0));
      playback.seek(660, ...takeRestoreRows());
      publishEffects(660);
      interaction = createMarioInteraction(program.interaction, control);
    } else if (interaction.playback) {
      playback.seek(660);
      publishEffects(660);
      interaction = createMarioInteraction(program.interaction, control);
    }
    const frame = interaction.step(sample);
    scene.applySurfaceFrame(frame.sourceFrame, true);
    scene.forceVisible(frame.safeVisibleLeaves);
    scene.applyInteraction(frame.publications);
    rememberInteractionRows(frame.publications);
    effects.publish(
      frame.sourceFrame,
      frame.selectedId && frame.selectedMatrix
        ? Object.freeze({
            selectedId: frame.selectedId,
            grabbers: Object.freeze([
              Object.freeze({
                id: frame.selectedId,
                matrix: frame.selectedMatrix,
              }),
            ]),
          })
        : null,
    );
    control = frame.control;
    publishCursor(true);
  };
  const loop = (timestamp: number): void => {
    request = 0;
    if (stopped) return;
    try {
      if (nextTick === null) {
        nextTick = timestamp + SOURCE_TICK_MS;
      } else if (timestamp >= nextTick - 0.5) {
        tick += 1;
        if (experienceMode === "animation") advanceAnimation();
        else advanceInteraction();
        nextTick += SOURCE_TICK_MS;
        if (nextTick <= timestamp) nextTick = timestamp + SOURCE_TICK_MS;
      }
      request = requestAnimationFrame(loop);
    } catch (error) {
      fail(error);
    }
  };
  request = requestAnimationFrame(loop);

  return Object.freeze({
    scene,
    presentation,
    effects,
    playback,
    input,
    get experienceMode(): CssGraphicsExperienceMode { return experienceMode; },
    get tick(): number { return tick; },
    setExperienceMode(mode: CssGraphicsExperienceMode): void {
      if (stopped) throw new Error("The Mario player has stopped.");
      if (mode === experienceMode) return;
      experienceMode = mode;
      input.setEnabled(mode === "interaction");
      if (mode === "animation") animationRestartPending = true;
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (request !== 0) cancelAnimationFrame(request);
      request = 0;
      input.destroy();
    },
  });
}

export function startMarioPlayerDriver(
  host: HTMLElement,
  program: MarioProgram,
  onDestroy?: () => void,
): CssGraphicsDriver {
  const client = startMarioPlayer(host, program);
  return wrapCssGraphicsClient({
    modelId: program.id,
    kind: "prepared-playback",
    generationHash: program.generationHash,
    client,
    experienceModes: ["animation", "interaction"],
    getExperienceMode: () => client.experienceMode,
    setExperienceMode: (mode) => client.setExperienceMode(mode),
    onDestroy,
  });
}
