import { CssPipesContractError } from "./types.mjs";

const CSSPIPES_TOP_GAP = 0;
const CSSPIPES_VERTICAL_BIAS_RATIO = -0.06;

const dimension = (value, label) => {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new CssPipesContractError(`${label} must be a positive finite number`);
  }
  return value;
};

function profiles(width, height, contract) {
  return contract?.profiles ?? {
    desktop: {
      id: "desktop",
      quarterTurns: 0,
      rotationDegrees: 0,
      projectedViewport: { width, height },
    },
    mobile: {
      id: "mobile",
      quarterTurns: 1,
      rotationDegrees: 90,
      projectedViewport: { width: height, height: width },
    },
  };
}

function chooseProfile(width, height, sourceWidth, sourceHeight, contract) {
  const id = Math.max(width / sourceHeight, height / sourceWidth) <
    Math.max(width / sourceWidth, height / sourceHeight) ? "mobile" : "desktop";
  const profile = profiles(sourceWidth, sourceHeight, contract)[id];
  const quarterTurns = profile.quarterTurns;
  const bounds = [
    [0, 0],
    [-sourceHeight, 0],
    [-sourceWidth, -sourceHeight],
    [0, -sourceWidth],
  ][quarterTurns];
  return {
    id,
    quarterTurns,
    rotationDegrees: profile.rotationDegrees,
    projectedWidth: profile.projectedViewport.width,
    projectedHeight: profile.projectedViewport.height,
    rotatedLeft: bounds[0],
    rotatedTop: bounds[1],
  };
}

function calculateCssPipesPresentation(
  hostWidth,
  hostHeight,
  sourceViewport,
  topGap = CSSPIPES_TOP_GAP,
  responsivePresentation,
) {
  const width = dimension(hostWidth, "presentation host width");
  const height = dimension(hostHeight, "presentation host height");
  const sourceWidth = dimension(sourceViewport?.width, "presentation source width");
  const sourceHeight = dimension(sourceViewport?.height, "presentation source height");
  if (topGap < 0 || topGap >= height) {
    throw new CssPipesContractError("presentation top gap must leave a positive scene viewport");
  }
  const viewportHeight = height - topGap;
  const verticalOffset = viewportHeight * CSSPIPES_VERTICAL_BIAS_RATIO;
  const profile = chooseProfile(
    width,
    viewportHeight + 2 * Math.abs(verticalOffset),
    sourceWidth,
    sourceHeight,
    responsivePresentation,
  );
  const scale = Math.max(
    width / profile.projectedWidth,
    (viewportHeight + 2 * Math.abs(verticalOffset)) / profile.projectedHeight,
  );
  const visualLeft = (width - profile.projectedWidth * scale) / 2;
  const visualTop = (viewportHeight - profile.projectedHeight * scale) / 2 + verticalOffset;
  return {
    sourceWidth,
    sourceHeight,
    hostWidth: width,
    hostHeight: height,
    viewportWidth: width,
    viewportHeight,
    topGap,
    verticalOffset,
    viewportProfile: profile.id,
    quarterTurns: profile.quarterTurns,
    rotationDegrees: profile.rotationDegrees,
    projectedSourceWidth: profile.projectedWidth,
    projectedSourceHeight: profile.projectedHeight,
    scale,
    left: visualLeft - profile.rotatedLeft * scale,
    top: visualTop - profile.rotatedTop * scale,
  };
}

export function mountCssPipesPresentation({
  host,
  camera,
  sourceViewport,
  responsivePresentation,
  topGap = CSSPIPES_TOP_GAP,
  ResizeObserverImpl = globalThis.ResizeObserver,
  windowImpl = host?.ownerDocument?.defaultView ?? globalThis.window,
}) {
  let current;
  const listeners = new Set();
  const refresh = () => {
    current = calculateCssPipesPresentation(
      host.clientWidth,
      host.clientHeight,
      sourceViewport,
      topGap,
      responsivePresentation,
    );
    Object.assign(camera.style, {
      left: `${current.left}px`,
      top: `${current.top}px`,
      transform: [
        current.rotationDegrees && `rotate(${current.rotationDegrees}deg)`,
        current.scale !== 1 && `scale(${current.scale})`,
      ].filter(Boolean).join(" "),
    });
    for (const listener of listeners) listener(current);
    return current;
  };
  refresh();
  const observer = typeof ResizeObserverImpl === "function"
    ? new ResizeObserverImpl(refresh)
    : null;
  observer?.observe(host);
  if (!observer) windowImpl?.addEventListener?.("resize", refresh, { passive: true });
  return {
    refresh,
    get viewportProfile() { return current.viewportProfile; },
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    destroy() {
      observer?.disconnect();
      if (!observer) windowImpl?.removeEventListener?.("resize", refresh);
      listeners.clear();
    },
  };
}
