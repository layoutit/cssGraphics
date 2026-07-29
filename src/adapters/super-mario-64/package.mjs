import {
  encodeCursorWebp,
  encodeLosslessWebp,
  writeCssGraphicsModelPackage,
} from "../../prepare/shared/modelPackage.mjs";
import {
  titleHeadSha256,
} from "./stages/contract.mjs";

const MODEL_ID = "mario";

function packageGenerationHash({
  effects,
  interaction,
  lighting,
  playback,
  trianglePlan,
  assets,
}) {
  return titleHeadSha256(Buffer.from(JSON.stringify({
    schema: "cssgraphics-super-mario-64-package-generation@1",
    contracts: [
      effects.contentHash,
      interaction.contentHash,
      lighting.contentHash,
      playback.contentHash,
      trianglePlan.contentHash,
    ],
    assets: assets.map(({ role, bytes }) => [role, titleHeadSha256(bytes)]),
  })));
}

function cssNumber(value) {
  return String(Object.is(value, -0) ? 0 : value);
}

function domShapeId(sourceId) {
  const id = sourceId.startsWith("mario-") ? sourceId.slice(6) : sourceId;
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) {
    throw new Error(`Mario shape ${sourceId} cannot be used as a structural selector.`);
  }
  return id;
}

function modelCss(trianglePlan, lighting) {
  const page = lighting.surface.pages[0];
  const faces = lighting.surface.faces;
  if (!page || lighting.surface.pages.length !== 1
    || !Array.isArray(faces) || faces.length !== trianglePlan.leaves.length) {
    throw new Error("Mario cssGraphics packaging requires one prepared texel atlas.");
  }
  const scope = "[data-cssgraphics-model=\"mario\"]";
  const rows = [
    `${scope},`,
    `${scope} * {`,
    "  box-sizing: border-box;",
    "}",
    `${scope} {`,
    "  position: absolute;",
    "  inset: 0;",
    "  width: 100%;",
    "  height: 100%;",
    "  overflow: hidden;",
    "  isolation: isolate;",
    "  color: #fff;",
    "  touch-action: none;",
    "  user-select: none;",
    "  contain: strict;",
    "  cursor: default;",
    "}",
    `${scope}:has([data-cssgraphics-control="experience-mode"] input[value="interaction"]:checked) {`,
    "  cursor: url(\"./assets/cursor-open.webp\") 4 2, grab;",
    "}",
    `${scope}.polycss-camera {`,
    "  position: absolute;",
    "  left: 50%;",
    "  top: 50%;",
    "  width: 320px;",
    "  height: 240px;",
    "  overflow: visible;",
    "  background: transparent;",
    "  transform-origin: center;",
    "  transform-style: preserve-3d;",
    "}",
    `${scope} > [data-title-head-cursor-layer=\"source-viewport\"] {`,
    "  position: fixed;",
    "  inset: 0 auto auto 0;",
    "  z-index: 2147483647;",
    "  width: 32px;",
    "  height: 32px;",
    "  pointer-events: none;",
    "  transform-origin: 0 0;",
    "  will-change: transform;",
    "}",
    `${scope} > [data-title-head-cursor-layer=\"source-viewport\"] > [data-title-head-cursor-state] {`,
    "  position: absolute;",
    "  inset: 0;",
    "  display: block;",
    "  width: 32px;",
    "  height: 32px;",
    "  max-width: none;",
    "  border: 0;",
    "  pointer-events: none;",
    "  image-rendering: auto;",
    "  content: url(\"./assets/cursor.webp\");",
    "  object-fit: none;",
    "  object-position: left top;",
    "}",
    `${scope} > [data-title-head-cursor-layer=\"source-viewport\"] > [data-title-head-cursor-state=\"closed\"] {`,
    "  object-position: right top;",
    "}",
    `${scope},`,
    `${scope} :is(.polycss-scene, [data-poly-mesh-id], [data-shape], [data-shape] > :is(s, u, i), [data-star-effects], [data-star-effects] > div, [data-star-effects] s) {`,
    "  transform-style: preserve-3d;",
    "  backface-visibility: visible;",
    "  -webkit-backface-visibility: visible;",
    "}",
    `${scope} [data-shape] {`,
    "  visibility: visible;",
    "}",
    `${scope} [data-shape] > :is(s, u, i) {`,
    "  box-sizing: border-box;",
    "  margin: 0;",
    "  padding: 0;",
    "  border: 0;",
    "  opacity: 1;",
    "  background-color: transparent;",
    "  background-image: url(\"./assets/texels.webp\");",
    "  background-repeat: no-repeat;",
    "  backface-visibility: visible;",
    "  -webkit-backface-visibility: visible;",
    "  transform-style: preserve-3d;",
    "}",
    `${scope} [data-shape] > u {`,
    "  border-top-left-radius: 50% 100%;",
    "  border-top-right-radius: 50% 100%;",
    "  corner-top-left-shape: bevel;",
    "  corner-top-right-shape: bevel;",
    "}",
    `${scope} [data-shape] > i {`,
    "  border-shape: polygon(50% 0, 100% 100%, 0 100%) circle(0);",
    "  background-clip: border-area;",
    "}",
    `${scope} [data-star-effects],`,
    `${scope} [data-star-effects] > div,`,
    `${scope} [data-star-effects] s {`,
    "  position: absolute;",
    "  inset: 0 auto auto 0;",
    "  pointer-events: none;",
    "}",
    `${scope} [data-star-effects],`,
    `${scope} [data-star-effects] > div {`,
    "  width: 0;",
    "  height: 0;",
    "}",
    `${scope} [data-star-effects] s {`,
    "  display: block;",
    "  margin: 0;",
    "  padding: 0;",
    "  border: 0;",
    "  background-image: url(\"./assets/effects.webp\");",
    "  background-repeat: no-repeat;",
    "  transform-origin: 0 0;",
    "  backface-visibility: visible;",
    "  transform-style: preserve-3d;",
    "}",
    `${scope} [data-star-effects] > s {`,
    "  width: 128px;",
    "  height: 128px;",
    "  opacity: 1;",
    "  visibility: visible;",
    "  background-size: 1088px 544px;",
    "}",
    `${scope} [data-star-effects] > div > s {`,
    "  width: 64px;",
    "  height: 64px;",
    "  background-size: 544px 272px;",
    "}",
  ];
  const childrenByShape = new Map();
  for (const leaf of trianglePlan.leaves) {
    const face = faces[leaf.sourceOrder];
    if (!face || face.faceId !== leaf.faceId || face.sourceOrder !== leaf.sourceOrder) {
      throw new Error(`Mario face ${leaf.faceId} has no stable texel location.`);
    }
    const shapeId = domShapeId(leaf.shapeId);
    const childIndex = (childrenByShape.get(shapeId) ?? 0) + 1;
    childrenByShape.set(shapeId, childIndex);
    rows.push(
      `${scope} [data-shape="${shapeId}"] > :nth-child(${childIndex}) {`,
      `  width: ${cssNumber(face.leafWidth)}px;`,
      `  height: ${cssNumber(face.leafHeight)}px;`,
      `  background-position-x: ${face.backgroundPositionX};`,
      `  background-size: ${face.backgroundSize};`,
      "}",
    );
  }
  return `${rows.join("\n")}\n`;
}

function cursorBinding(textures) {
  const cursor = textures.sourceState?.cursor;
  if (!cursor) throw new Error("Mario cursor source state is absent.");
  return {
    asset: "cursor",
    closedWhen: cursor.closedWhen,
    states: {
      closed: { height: 32, width: 32, x: 32, y: 0 },
      open: { height: 32, width: 32, x: 0, y: 0 },
    },
  };
}

function runtimeEffectsPacket(packet) {
  return {
    atlas: {
      path: packet.atlas.path,
      width: packet.atlas.width,
      height: packet.atlas.height,
    },
    billboardGeometry: packet.billboardGeometry,
    camera: { matrix: packet.camera.matrix },
    emitters: packet.emitters.map(({
      sourceId: _sourceId,
      type: _type,
      attachment: _attachment,
      ...emitter
    }) => emitter),
    particle: {
      cameraBias: packet.particle.cameraBias,
      damping: packet.particle.damping,
      gravityY: packet.particle.gravityY,
      sparkleFrameTable: packet.particle.sparkleFrameTable,
    },
    sourceFrames: { count: packet.sourceFrames.count },
    spawnStream: {
      count: packet.spawnStream.count,
      tuples: packet.spawnStream.tuples,
    },
    stars: packet.stars.map(({
      targetId: _targetId,
      animatorId: _animatorId,
      pathLayout: _pathLayout,
      ...star
    }) => star),
    totals: { effectLeaves: packet.totals.effectLeaves },
  };
}

function runtimeInteractionPacket(packet) {
  const {
    bindings: _bindings,
    proof: _proof,
    ...runtime
  } = packet;
  return runtime;
}

function runtimePlaybackPacket(packet) {
  const {
    bindings: _bindings,
    contentHash: _contentHash,
    proof: _proof,
    ...runtime
  } = packet;
  const {
    legacyAffineEvaluations: _legacyAffineEvaluations,
    legacyTransformWrites: _legacyTransformWrites,
    ...totals
  } = packet.totals;
  return { ...runtime, totals };
}

function runtimeLightingContract(contract) {
  const surface = contract.surface;
  const visibility = contract.visibilityCulling;
  return {
    schema: contract.schema,
    trianglePlanHash: contract.trianglePlanHash,
    materialsHash: contract.materialsHash,
    canonicalFaceSize: contract.canonicalFaceSize,
    frameCount: contract.frameCount,
    surface: {
      storage: surface.storage,
      leafSizing: surface.leafSizing,
      rasterDensity: {
        kind: surface.rasterDensity.kind,
        targetMaximumTransformStretch:
          surface.rasterDensity.targetMaximumTransformStretch,
        measuredMaximumTransformStretch:
          surface.rasterDensity.measuredMaximumTransformStretch,
        sourceFrameSamples: surface.rasterDensity.sourceFrameSamples,
        runtimeWork: surface.rasterDensity.runtimeWork,
      },
      cssMask: surface.cssMask,
      cssFilter: surface.cssFilter,
      cssBlend: surface.cssBlend,
      cssPseudoElements: surface.cssPseudoElements,
      nativeShape: {
        storage: surface.nativeShape.storage,
        encoding: surface.nativeShape.encoding,
        alphaChannel: surface.nativeShape.alphaChannel,
        runtimeWork: surface.nativeShape.runtimeWork,
        topologyMutation: surface.nativeShape.topologyMutation,
      },
      statePacking: {
        stateCount: surface.statePacking.stateCount,
        maximumColumns: surface.statePacking.maximumColumns,
        sourceFrameCount: surface.statePacking.sourceFrameCount,
        sourceFramesEncoding: surface.statePacking.sourceFramesEncoding,
        backgroundPositionYsEncoding:
          surface.statePacking.backgroundPositionYsEncoding,
        sourceFramesBase64: surface.statePacking.sourceFramesBase64,
        backgroundPositionYs: surface.statePacking.backgroundPositionYs,
      },
      pages: surface.pages.map((page) => ({
        path: page.path,
        width: page.width,
        height: page.height,
        native: {
          path: page.native.path,
          encoding: page.native.encoding,
          opaque: page.native.opaque,
          width: page.native.width,
          height: page.native.height,
        },
      })),
      faces: surface.faces.map(({
        temporalMaxRgbDelta: _temporalMaxRgbDelta,
        ...face
      }) => face),
    },
    transitions: {
      initialFrame: contract.transitions.initialFrame,
      sequential: contract.transitions.sequential,
      nonInteractiveJumps: contract.transitions.nonInteractiveJumps,
    },
    visibilityCulling: {
      schema: visibility.schema,
      trianglePlanHash: visibility.trianglePlanHash,
      frameCount: visibility.frameCount,
      faceCount: visibility.faceCount,
      atlasAlphaConsulted: visibility.atlasAlphaConsulted,
      safety: visibility.safety,
      faceBitOrder: visibility.faceBitOrder,
      policy: {
        minimumHiddenRun: visibility.policy.minimumHiddenRun,
        transitionWindow: visibility.policy.transitionWindow,
        transitionCap: visibility.policy.transitionCap,
        topologyMutation: visibility.policy.topologyMutation,
        runtimeOcclusionMath: visibility.policy.runtimeOcclusionMath,
        runtimeFaceScan: visibility.policy.runtimeFaceScan,
      },
      initialFrame: visibility.initialFrame,
      initialVisibleBitsBase64: visibility.initialVisibleBitsBase64,
      sequential: visibility.sequential,
      nonInteractiveJumps: visibility.nonInteractiveJumps,
    },
  };
}

async function packageAdapter({
  prepared,
  outputRoot,
} = {}) {
  if (!prepared?.contracts || !prepared.assets) {
    throw new TypeError(
      "Mario packaging requires the package input returned by preparation.",
    );
  }
  const {
    effects,
    interaction,
    lighting,
    playback,
    trianglePlan,
    textures,
  } = prepared.contracts;
  const {
    backgroundPng,
    cursorClosedPng,
    cursorOpenPng,
    effectsPng,
    texelsWebp: texels,
  } = prepared.assets;

  // The prepared native atlas is already the accepted lossless WebP. Package
  // those exact bytes: decoding and re-encoding would silently replace the
  // performance baseline that the runtime was tuned against.
  const effectsImage = await encodeLosslessWebp(effectsPng);
  const cursor = await encodeCursorWebp(cursorOpenPng, cursorClosedPng);
  const cursorOpen = await encodeLosslessWebp(cursorOpenPng);
  const background = await encodeLosslessWebp(backgroundPng);
  const assets = [
    { role: "background", bytes: background },
    { role: "cursor", bytes: cursor },
    { role: "cursor-open", bytes: cursorOpen },
    { role: "effects", bytes: effectsImage },
    { role: "texels", bytes: texels },
  ];

  return writeCssGraphicsModelPackage({
    outputRoot,
    id: MODEL_ID,
    name: "Mario",
    profile: "super-mario-64",
    features: [
      "animation",
      "background",
      "cursor",
      "cursor-open",
      "effects",
      "interaction",
      "lighting",
      "texels",
    ],
    generationHash: packageGenerationHash({
      effects,
      interaction,
      lighting,
      playback,
      trianglePlan,
      assets,
    }),
    sections: {
      effects: {
        asset: "effects",
        packet: runtimeEffectsPacket(effects),
      },
      interaction: {
        cursor: cursorBinding(textures),
        packet: runtimeInteractionPacket(interaction),
      },
      lighting: {
        asset: "texels",
        contract: runtimeLightingContract(lighting),
      },
      playback: {
        packet: runtimePlaybackPacket(playback),
      },
      presentation: {
        background: {
          asset: "background",
          opacity: 0.75,
          position: "center",
          repeat: "no-repeat",
          size: "cover",
        },
        sourceViewport: { height: 240, width: 320 },
      },
      structure: {
        trianglePlan,
      },
    },
    css: modelCss(trianglePlan, lighting),
    assets,
  });
}

export { packageAdapter as package };
