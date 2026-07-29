import type { MarioPresentation } from "./presentation.js";

export const MARIO_BUTTON = Object.freeze({
  A: 0x8000,
  R: 0x0010,
});

export interface MarioInputSample {
  readonly stickX: number;
  readonly stickY: number;
  readonly buttonMask: number;
  readonly cursor: Readonly<{ x: number; y: number }> | null;
}

export interface MarioInput {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
  sample(): MarioInputSample;
  destroy(): void;
}

type KeyControl = "left" | "right" | "up" | "down" | "grab" | "hold";

const KEY: Readonly<Record<string, KeyControl>> = Object.freeze({
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  Space: "grab",
  KeyR: "hold",
});

function editableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof Element
      && target.closest("[contenteditable='true']") !== null);
}

function interfaceControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest(
      "a[href],button,input,select,textarea,[role='button'],[role='radio'],[data-cssgraphics-control]",
    ) !== null;
}

export function createMarioInput(
  host: HTMLElement,
  presentation: MarioPresentation,
): MarioInput {
  const win = host.ownerDocument.defaultView;
  if (!win) throw new TypeError("Mario input requires a browser window.");
  const keys = new Set<KeyControl>();
  let enabled = false;
  let pointerId: number | null = null;
  let pointerHeld = false;
  let cursor: Readonly<{ x: number; y: number }> | null = null;
  let cursorDirty = false;
  let destroyed = false;

  const updatePointer = (event: PointerEvent): void => {
    const mapped = presentation.mapPointer(event.clientX, event.clientY);
    if (!mapped) return;
    cursor = Object.freeze({
      x: Math.max(16, Math.min(272, Math.trunc(mapped.x))),
      y: Math.max(16, Math.min(208, Math.trunc(mapped.y))),
    });
    cursorDirty = true;
  };
  const keydown = (event: KeyboardEvent): void => {
    const control = KEY[event.code];
    if (!enabled || !control || editableTarget(event.target)) return;
    event.preventDefault();
    keys.add(control);
  };
  const keyup = (event: KeyboardEvent): void => {
    const control = KEY[event.code];
    if (!enabled || !control) return;
    const wasHeld = keys.delete(control);
    if (wasHeld && !editableTarget(event.target)) event.preventDefault();
  };
  const pointermove = (event: PointerEvent): void => {
    if (!enabled || event.isPrimary === false) return;
    updatePointer(event);
  };
  const pointerleave = (event: PointerEvent): void => {
    if (!enabled || event.isPrimary === false) return;
    if (pointerId === null) cursorDirty = false;
  };
  const pointerdown = (event: PointerEvent): void => {
    if (
      !enabled
      || event.isPrimary === false
      || event.button !== 0
      || interfaceControlTarget(event.target)
    ) return;
    event.preventDefault();
    updatePointer(event);
    pointerHeld = true;
    pointerId = event.pointerId;
    host.setPointerCapture?.(event.pointerId);
  };
  const releaseCapture = (): void => {
    if (pointerId !== null && host.hasPointerCapture?.(pointerId)) {
      host.releasePointerCapture?.(pointerId);
    }
  };
  const pointerup = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    updatePointer(event);
    pointerHeld = false;
    releaseCapture();
    pointerId = null;
  };
  const blur = (): void => {
    keys.clear();
    pointerHeld = false;
    releaseCapture();
    pointerId = null;
  };

  win.addEventListener("keydown", keydown);
  win.addEventListener("keyup", keyup);
  win.addEventListener("blur", blur);
  host.addEventListener("pointerleave", pointerleave);
  host.addEventListener("pointermove", pointermove);
  host.addEventListener("pointerdown", pointerdown);
  host.addEventListener("pointerup", pointerup);
  host.addEventListener("pointercancel", pointerup);
  host.addEventListener("lostpointercapture", pointerup);

  return Object.freeze({
    get enabled(): boolean { return enabled; },
    setEnabled(next: boolean): void {
      if (destroyed) throw new Error("Mario input is destroyed.");
      if (enabled === next) return;
      enabled = next;
      if (!enabled) {
        keys.clear();
        pointerHeld = false;
        releaseCapture();
        pointerId = null;
        cursor = null;
        cursorDirty = false;
      }
    },
    sample(): MarioInputSample {
      if (destroyed) throw new Error("Mario input is destroyed.");
      const x = Number(keys.has("right")) - Number(keys.has("left"));
      const y = Number(keys.has("up")) - Number(keys.has("down"));
      const absolutePointer = cursorDirty ? cursor : null;
      const sample = Object.freeze({
        stickX: absolutePointer ? 0 : x < 0 ? -128 : x > 0 ? 127 : 0,
        stickY: absolutePointer ? 0 : y < 0 ? -128 : y > 0 ? 127 : 0,
        buttonMask:
          (keys.has("grab") || pointerHeld ? MARIO_BUTTON.A : 0)
          | (keys.has("hold") ? MARIO_BUTTON.R : 0),
        cursor: absolutePointer,
      });
      cursorDirty = false;
      return sample;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      releaseCapture();
      win.removeEventListener("keydown", keydown);
      win.removeEventListener("keyup", keyup);
      win.removeEventListener("blur", blur);
      host.removeEventListener("pointerleave", pointerleave);
      host.removeEventListener("pointermove", pointermove);
      host.removeEventListener("pointerdown", pointerdown);
      host.removeEventListener("pointerup", pointerup);
      host.removeEventListener("pointercancel", pointerup);
      host.removeEventListener("lostpointercapture", pointerup);
      keys.clear();
    },
  });
}
