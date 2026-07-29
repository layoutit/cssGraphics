import { cssNumber } from "../runtime/polycssRoot.js";
import type {
  MarioCursor,
  MarioPresentation as MarioPresentationContract,
} from "./model.js";
import type { MarioScene } from "./scene.js";

const SOURCE_WIDTH = 320;
const SOURCE_HEIGHT = 240;
const FIT_WIDTH = 200;
const FIT_HEIGHT = 260;

export interface MarioViewport {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface MarioPresentation {
  readonly root: HTMLElement;
  readonly cursorLayer: HTMLDivElement;
  readonly viewport: MarioViewport;
  setAppearance(
    appearance: readonly [id: string, scale: number, translateY: number],
  ): void;
  setCursor(x: number, y: number, visible: boolean, closed: boolean): void;
  mapPointer(clientX: number, clientY: number): Readonly<{ x: number; y: number }> | null;
  destroy(): void;
}

function viewport(width: number, height: number): MarioViewport {
  const scale = Math.min(width / FIT_WIDTH, height / FIT_HEIGHT);
  return Object.freeze({
    width,
    height,
    scale,
    offsetX: (width - SOURCE_WIDTH * scale) / 2,
    offsetY: (height - SOURCE_HEIGHT * scale) / 2,
  });
}

function cursorTransform(layout: MarioViewport, x: number, y: number): string {
  return `translate3d(${cssNumber(layout.offsetX + x * layout.scale)}px, ${
    cssNumber(layout.offsetY + y * layout.scale)
  }px, 0) scale(${cssNumber(layout.scale)})`;
}

function cursorImage(
  layer: HTMLDivElement,
  cursor: MarioCursor,
  url: string,
  state: "open" | "closed",
): HTMLImageElement {
  const cell = cursor.states[state];
  const image = layer.ownerDocument.createElement("img");
  image.className = `title-head-hand title-head-hand-${state}`;
  image.dataset.titleHeadCursorState = state;
  image.alt = "";
  image.draggable = false;
  image.decoding = "async";
  image.src = url;
  image.width = cell.width;
  image.height = cell.height;
  image.style.objectFit = "none";
  image.style.objectPosition = state === "open" ? "left top" : "right top";
  image.style.visibility = "hidden";
  layer.appendChild(image);
  return image;
}

export function mountMarioPresentation(
  host: HTMLElement,
  contract: MarioPresentationContract,
  cursor: MarioCursor,
  backgroundUrl: string,
  cursorUrl: string,
  scene: MarioScene,
  initialAppearance: readonly [id: string, scale: number, translateY: number],
): MarioPresentation {
  const previousBackground = Object.freeze({
    color: host.style.backgroundColor,
    image: host.style.backgroundImage,
    position: host.style.backgroundPosition,
    repeat: host.style.backgroundRepeat,
    size: host.style.backgroundSize,
  });
  const overlay = 1 - contract.background.opacity;
  host.style.backgroundColor = "#000";
  host.style.backgroundImage = overlay === 0
    ? `url("${backgroundUrl}")`
    : `linear-gradient(rgba(0,0,0,${cssNumber(overlay)}),rgba(0,0,0,${
      cssNumber(overlay)
    })),url("${backgroundUrl}")`;
  host.style.backgroundPosition = contract.background.position;
  host.style.backgroundRepeat = contract.background.repeat;
  host.style.backgroundSize = contract.background.size;

  const cursorLayer = host.ownerDocument.createElement("div");
  cursorLayer.className = "title-head-cursor";
  cursorLayer.dataset.titleHeadCursorLayer = "source-viewport";
  const open = cursorImage(cursorLayer, cursor, cursorUrl, "open");
  const closed = cursorImage(cursorLayer, cursor, cursorUrl, "closed");
  host.appendChild(cursorLayer);

  let appearance = initialAppearance;
  let layout = viewport(SOURCE_WIDTH, SOURCE_HEIGHT);
  let cursorX = 160;
  let cursorY = 120;
  let cursorVisible = false;
  let cursorClosed = false;
  let destroyed = false;

  const resize = (): void => {
    const bounds = host.getBoundingClientRect();
    if (!(bounds.width > 0) || !(bounds.height > 0)) return;
    layout = viewport(bounds.width, bounds.height);
    scene.setAppearance(
      layout.width,
      layout.height,
      layout.scale,
      appearance,
    );
    cursorLayer.style.transform = cursorTransform(layout, cursorX, cursorY);
  };
  resize();
  const observer = typeof ResizeObserver === "function"
    ? new ResizeObserver(resize)
    : null;
  if (observer) observer.observe(host);
  else window.addEventListener("resize", resize, { passive: true });

  const publishCursor = (): void => {
    cursorLayer.style.transform = cursorTransform(layout, cursorX, cursorY);
    open.style.visibility =
      cursorVisible && !cursorClosed ? "visible" : "hidden";
    closed.style.visibility =
      cursorVisible && cursorClosed ? "visible" : "hidden";
  };

  return Object.freeze({
    root: host,
    cursorLayer,
    get viewport(): MarioViewport { return layout; },
    setAppearance(
      next: readonly [id: string, scale: number, translateY: number],
    ): void {
      appearance = next;
      scene.setAppearance(
        layout.width,
        layout.height,
        layout.scale,
        appearance,
      );
    },
    setCursor(
      x: number,
      y: number,
      visible: boolean,
      isClosed: boolean,
    ): void {
      cursorX = x;
      cursorY = y;
      cursorVisible = visible;
      cursorClosed = isClosed;
      publishCursor();
    },
    mapPointer(
      clientX: number,
      clientY: number,
    ): Readonly<{ x: number; y: number }> | null {
      const bounds = host.getBoundingClientRect();
      if (
        destroyed
        || !Number.isFinite(clientX)
        || !Number.isFinite(clientY)
        || !(bounds.width > 0)
        || !(bounds.height > 0)
      ) {
        return null;
      }
      return Object.freeze({
        x: (clientX - bounds.left - layout.offsetX) / layout.scale,
        y: (clientY - bounds.top - layout.offsetY) / layout.scale,
      });
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (observer) observer.disconnect();
      else window.removeEventListener("resize", resize);
      cursorLayer.remove();
      host.style.backgroundColor = previousBackground.color;
      host.style.backgroundImage = previousBackground.image;
      host.style.backgroundPosition = previousBackground.position;
      host.style.backgroundRepeat = previousBackground.repeat;
      host.style.backgroundSize = previousBackground.size;
    },
  });
}
