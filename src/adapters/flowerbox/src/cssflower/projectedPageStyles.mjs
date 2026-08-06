const COMPONENTS_PER_LEAF = 6;

export function applyPreparedProjectedLeafLayout({ leaves, layoutValues, atlas }) {
  const frameOffsetAxis = preparedFrameOffsetAxis(atlas);
  if (!Array.isArray(leaves) || leaves.length !== 1_200 ||
      !(layoutValues instanceof Int16Array) || layoutValues.length !== leaves.length * COMPONENTS_PER_LEAF ||
      !Number.isSafeInteger(atlas?.width) || atlas.width < 1 ||
      !Number.isSafeInteger(atlas?.height) || atlas.height < 1) {
    throw new TypeError("Complete prepared projected leaf layout is required");
  }
  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex += 1) {
    const offset = leafIndex * COMPONENTS_PER_LEAF;
    const width = layoutValues[offset];
    const height = layoutValues[offset + 1];
    const dx = layoutValues[offset + 2];
    const dy = layoutValues[offset + 3];
    const backgroundX = layoutValues[offset + 4];
    const backgroundY = layoutValues[offset + 5];
    leaves[leafIndex].style.cssText = width === 0
      ? hiddenProjectedLeafCss()
      : visibleProjectedLeafCss({ width, height, dx, dy, backgroundX, backgroundY, atlas, frameOffsetAxis });
  }
  return leaves.length;
}

function visibleProjectedLeafCss({ width, height, dx, dy, backgroundX, backgroundY, atlas, frameOffsetAxis }) {
  const backgroundPosition = frameOffsetAxis === "x"
    ? `calc(${backgroundX}px + var(--cssflower-projected-frame-offset)) ${backgroundY}px`
    : `${backgroundX}px calc(${backgroundY}px + var(--cssflower-projected-frame-offset))`;
  return [
    "position:absolute",
    "display:block",
    "left:0",
    "top:0",
    `width:${width}px`,
    `height:${height}px`,
    "box-sizing:content-box",
    "margin:0",
    "padding:0",
    "border:0",
    "border-radius:0",
    "corner-top-left-shape:initial",
    "corner-top-right-shape:initial",
    "corner-bottom-right-shape:initial",
    "corner-bottom-left-shape:initial",
    "transform-origin:0 0",
    "transform-style:preserve-3d",
    "backface-visibility:visible",
    `transform:translate3d(${dx}px,${dy}px,0px)`,
    "background-image:var(--cssflower-projected-atlas)",
    "background-color:transparent",
    "background-repeat:no-repeat",
    `background-position:${backgroundPosition}`,
    `background-size:${atlas.width}px ${atlas.height}px`,
    "image-rendering:auto",
    "color:transparent",
    "line-height:0",
    "text-decoration:none",
  ].join(";");
}

function preparedFrameOffsetAxis(atlas) {
  if (atlas?.packing === "horizontal-union") return "x";
  if (atlas?.packing === "vertical-union") return "y";
  throw new TypeError("Prepared projected atlas packing is invalid");
}

function hiddenProjectedLeafCss() {
  return "position:absolute;display:none;left:0;top:0;width:0;height:0;transform:none;background:none;border:0";
}
