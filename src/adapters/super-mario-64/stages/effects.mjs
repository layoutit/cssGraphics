import {
  canonicalTitleHeadValue,
  serializeTitleHeadContract,
  titleHeadContentHash,
  titleHeadSha256,
} from "./contract.mjs";
import {
  closeSync,
  constants as fsConstants,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import {
  encodePngRgba8,
} from "../../../prepare/shared/png.mjs";
import {
  decodeRgba16,
} from "../n64TextureDecode.mjs";
import {
  SM64_US_ROM,
  qualifyRom,
  resolveRomPath,
} from "../romSource.mjs";
import {
  resolve,
} from "node:path";

// starEffectsSource
const TITLE_HEAD_STAR_EFFECT_SOURCE_SCHEMA =
  "cssgraphics-title-head-star-effect-source@1";

const TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS = Object.freeze({
  shapeHelper: "src/goddard/shape_helper.c",
  particles: "src/goddard/particles.c",
  renderer: "src/goddard/renderer.c",
  drawObjects: "src/goddard/draw_objects.c",
  debugUtils: "src/goddard/debug_utils.c",
  dynlistMaster: "src/goddard/dynlists/dynlist_mario_master.c",
  animationData: "src/goddard/dynlists/anim_group_1.c",
  introScript: "levels/intro/script.c",
  assets: "assets.json",
});

const STAR_FRAME_TABLE = Object.freeze([
  0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7,
]);
const SPARKLE_FRAME_TABLE = Object.freeze([
  4, 4, 3, 3, 2, 2, 1, 1, 0, 0, 4, 4,
]);
const TEXTURE_FAMILIES = Object.freeze([
  Object.freeze({ id: "red-star", prefix: "red_star", count: 8 }),
  Object.freeze({ id: "white-star", prefix: "white_star", count: 8 }),
  Object.freeze({ id: "sparkle", prefix: "sparkle", count: 6 }),
]);
const sourceF32 = Math.fround;

function starSourceFail(message, source = null) {
  throw new TypeError(source ? `${source}: ${message}` : message);
}

function sourceText(sources, key) {
  const path = TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS[key];
  const value = sources?.[key];
  if (typeof value !== "string" || value.length === 0) {
    starSourceFail("authoritative source text is required", path);
  }
  return value;
}

function requireSignature(source, signature, label, path) {
  if (!signature.test(source)) starSourceFail(`lost authoritative signature: ${label}`, path);
}

function requireOrderedSignatures(source, signatures, path) {
  let offset = 0;
  for (const [label, signature] of signatures) {
    const match = source.slice(offset).match(signature);
    if (!match || match.index === undefined) {
      starSourceFail(`lost authoritative order: ${label}`, path);
    }
    offset += match.index + match[0].length;
  }
}

function parsePointerFrameTable(source, arrayName, prefix, expected, path) {
  const array = source.match(
    new RegExp(`static\\s+Gfx\\s*\\*\\s*${arrayName}\\s*\\[\\]\\s*=\\s*\\{([\\s\\S]*?)\\};`, "u"),
  );
  if (!array) starSourceFail(`display-list table ${arrayName} was not found`, path);
  const frames = [...array[1].matchAll(new RegExp(`${prefix}_(\\d+)(?:_dup)?\\s*,`, "gu"))]
    .map((match) => Number(match[1]));
  if (
    frames.length !== expected.length
    || frames.some((frame, index) => frame !== expected[index])
  ) {
    starSourceFail(`display-list table ${arrayName} drifted`, path);
  }
  return frames;
}

function textureRows(renderer, assets) {
  const rows = [];
  for (const family of TEXTURE_FAMILIES) {
    for (let frame = 0; frame < family.count; frame += 1) {
      const symbol = `gd_texture_${family.prefix}_${frame}`;
      const path = `textures/intro_raw/${family.prefix}_${frame}.rgba16.png`;
      requireSignature(
        renderer,
        new RegExp(
          `(?:UNUSED\\s+)?ALIGNED8\\s+static\\s+Texture\\s+${symbol}\\[\\]\\s*=\\s*\\{\\s*#include\\s+"textures/intro_raw/${family.prefix}_${frame}\\.rgba16\\.inc\\.c"`,
          "u",
        ),
        `${symbol} declaration`,
        TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.renderer,
      );
      const asset = assets?.[path];
      if (
        !Array.isArray(asset)
        || asset.length < 4
        || asset[0] !== 32
        || asset[1] !== 32
        || asset[2] !== 2048
        || !Array.isArray(asset[3]?.us)
        || asset[3].us.length !== 1
        || !Number.isSafeInteger(asset[3].us[0])
        || asset[3].us[0] < 0
      ) {
        starSourceFail(`asset entry ${path} is not a US 32x32 RGBA16 range`, "assets.json");
      }
      rows.push(Object.freeze({
        id: `${family.id}-${frame}`,
        family: family.id,
        frame,
        sourcePath: path,
        width: 32,
        height: 32,
        bytes: 2048,
        usRomOffset: asset[3].us[0],
        referenced: family.id !== "sparkle" || frame !== 5,
      }));
    }
  }
  return rows;
}

function lightPath(animationGraph, targetId, animatorId) {
  if (
    animationGraph?.schema !== "cssgraphics-title-head-animation@1"
    || animationGraph.sequenceContract?.regular?.frameRange?.first !== 1
    || animationGraph.sequenceContract.regular.frameRange.last !== 820
    || animationGraph.sequenceContract.regular.frameRange.wrapTo !== 1
  ) {
    starSourceFail("final Build B animation graph is not the regular 820-frame loop");
  }
  const channel = animationGraph.channels?.find((candidate) => candidate.targetId === targetId);
  const sequence = channel?.regularSequence;
  if (
    !channel
    || channel.animatorId !== animatorId
    || channel.targetType !== "light"
    || sequence?.typeName !== "GD_ANIM_ROT3S_POS3S"
    || sequence.frameCount !== 820
    || !Array.isArray(sequence.samples)
    || sequence.samples.length !== 820
    || sequence.samples.some((row) => !Array.isArray(row) || row.length !== 6)
  ) {
    starSourceFail(`${targetId}/${animatorId} is not one exact regular light path`);
  }
  return Object.freeze({
    targetId,
    animatorId,
    sourceOrder: channel.sourceOrder,
    sourceDataRef: sequence.sourceDataRef,
    frameCount: 820,
    frameRange: Object.freeze({ first: 1, last: 820, wrapTo: 1 }),
    components: Object.freeze([...sequence.components]),
    componentScale: Object.freeze([...sequence.componentScale]),
    dataHash: sequence.dataHash,
    scaledPathHash: titleHeadContentHash(sequence.samples.map((row) => row.map(
      (value, index) => sourceF32(value * sequence.componentScale[index]),
    ))),
  });
}

function validateSources(sources) {
  const shapeHelper = sourceText(sources, "shapeHelper");
  const particles = sourceText(sources, "particles");
  const renderer = sourceText(sources, "renderer");
  const drawObjects = sourceText(sources, "drawObjects");
  const debugUtils = sourceText(sources, "debugUtils");
  const dynlistMaster = sourceText(sources, "dynlistMaster");
  sourceText(sources, "animationData");
  const introScript = sourceText(sources, "introScript");

  requireOrderedSignatures(shapeHelper, [
    ["picked sparkle emitter", /particle->unk64\s*=\s*3\s*;[\s\S]{0,180}particle->attachedToObj\s*=\s*&camera->header\s*;[\s\S]{0,160}particle->shapePtr\s*=\s*gShapeSilverSpark\s*;/u],
    ["silver continuous emitter", /particle->unk64\s*=\s*2\s*;[\s\S]{0,180}d_use_obj\("N228l"\)[\s\S]{0,160}particle->shapePtr\s*=\s*gShapeSilverSpark\s*;/u],
    ["red continuous emitter", /particle->unk64\s*=\s*2\s*;[\s\S]{0,180}d_use_obj\("N231l"\)[\s\S]{0,160}particle->shapePtr\s*=\s*gShapeRedSpark\s*;/u],
  ], TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.shapeHelper);

  requireOrderedSignatures(dynlistMaster, [
    ["silver light", /MakeDynObj\(D_LIGHT,\s*DYNOBJ_SILVER_STAR_LIGHT\)[\s\S]{0,180}SetShapePtrPtr\(&gShapeSilverStar\)/u],
    ["red light", /MakeDynObj\(D_LIGHT,\s*DYNOBJ_RED_STAR_LIGHT\)[\s\S]{0,180}SetShapePtrPtr\(&gShapeRedStar\)/u],
    ["silver animator", /MakeDynObj\(D_ANIMATOR,\s*DYNOBJ_SILVER_STAR_ANIMATOR\)[\s\S]{0,220}LinkWith\(DYNOBJ_SILVER_STAR_LIGHT\)/u],
    ["red animator", /MakeDynObj\(D_ANIMATOR,\s*DYNOBJ_RED_STAR_ANIMATOR\)[\s\S]{0,220}LinkWith\(DYNOBJ_RED_STAR_LIGHT\)/u],
  ], TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.dynlistMaster);

  for (const [signature, label] of [
    [/sp20->timeout\s*=\s*12\.0f\s*-\s*gd_rand_float\(\)\s*\*\s*5\.0f/u, "lifetime distribution"],
    [/gd_rand_float\(\)\s*\*\s*50\.0\s*-\s*25\.0/u, "continuous velocity distribution"],
    [/gd_vec3f_magnitude\(&sp20->unk38\)\s*>\s*30\.0/u, "continuous velocity rejection"],
    [/sp7C\s*=\s*-0\.4f/u, "gravity"],
    [/ptc->unk38\.x\s*\*=\s*0\.9/u, "x damping"],
    [/ptc->unk38\.y\s*\*=\s*0\.9/u, "y damping"],
    [/ptc->unk38\.z\s*\*=\s*0\.9/u, "z damping"],
    [/for\s*\(i\s*=\s*0;\s*i\s*<\s*30;\s*i\+\+\)/u, "30-slot type-2/type-3 pool"],
    [/\(ptc->flags\s*&\s*0x20\)\s*&&\s*!\(ptc->flags\s*&\s*0x10\)/u, "picked rising-edge gate"],
    [/ptc->flags\s*\|=\s*0x10/u, "picked emitted flag"],
    [/ptc->flags\s*&=\s*~0x10[\s\S]{0,80}ptc->flags\s*&=\s*~0x20/u, "picked release reset"],
    [/func_80182A08\(ptc,\s*&sp34\)/u, "continuous spawn order"],
    [/apply_to_obj_types_in_group\(OBJ_TYPE_PARTICLES,[\s\S]{0,80}ptc->subParticlesGrp\)/u, "child update after spawn"],
    [/if\s*\(ptc->timeout--\s*<=\s*0\)/u, "post-decrement expiry"],
  ]) {
    requireSignature(
      particles,
      signature,
      label,
      TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.particles,
    );
  }

  for (const [signature, label] of [
    [/\{\{\s*-64,\s*0,\s*0\}[\s\S]{0,300}\{\{\s*-64,\s*128,\s*0\}/u, "128x128 star billboard quad"],
    [/\{\{\s*-32,\s*0,\s*0\}[\s\S]{0,300}\{\{\s*-32,\s*64,\s*0\}/u, "64x64 sparkle billboard quad"],
    [/gd_texture_sparkle_4\),\s*\/\/ 4 again, correct texture would be 5/u, "unused sparkle frame 5 quirk"],
  ]) {
    requireSignature(
      renderer,
      signature,
      label,
      TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.renderer,
    );
  }

  requireSignature(
    drawObjects,
    /if\s*\(\+\+sLightDlCounter\s*>=\s*17\)[\s\S]{0,80}sLightDlCounter\s*=\s*1[\s\S]{0,100}shape->unk50\s*=\s*sLightDlCounter/u,
    "shared 1..16 star display-list counter",
    TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.drawObjects,
  );
  requireSignature(
    drawObjects,
    /ptc->shapePtr->unk50\s*=\s*ptc->timeout[\s\S]{0,320}draw_shape_2d/u,
    "sparkle timeout-to-display-list mapping",
    TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.drawObjects,
  );
  requireSignature(
    drawObjects,
    /gd_rotate_and_translate_vec3f\(&sp1C,\s*&gViewUpdateCamera->unkE8\)[\s\S]{0,100}gd_dl_load_trans_matrix/u,
    "camera-facing 2D draw path",
    TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.drawObjects,
  );
  requireSignature(
    debugUtils,
    /\(sPrimarySeed\s*\^=\s*gd_get_ostime\(\)\)\s*&\s*1/u,
    "OS-time-mixed RNG",
    TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.debugUtils,
  );
  requireSignature(
    introScript,
    /level_intro_mario_head_regular[\s\S]{0,500}LOAD_MARIO_HEAD\([^)]*REGULAR_FACE\)[\s\S]{0,800}CALL_LOOP\([^)]*LVL_INTRO_REGULAR/u,
    "regular intro dispatch",
    TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.introScript,
  );

  const redStarFrames = parsePointerFrameTable(
    renderer,
    "gd_red_star_dl_array",
    "gd_dl_red_star",
    STAR_FRAME_TABLE,
    TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.renderer,
  );
  const silverStarFrames = parsePointerFrameTable(
    renderer,
    "gd_silver_star_dl_array",
    "gd_dl_silver_star",
    STAR_FRAME_TABLE,
    TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.renderer,
  );
  const redSparkleFrames = parsePointerFrameTable(
    renderer,
    "gd_red_sparkle_dl_array",
    "gd_dl_red_sparkle",
    SPARKLE_FRAME_TABLE,
    TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.renderer,
  );
  const silverSparkleFrames = parsePointerFrameTable(
    renderer,
    "gd_silver_sparkle_dl_array",
    "gd_dl_silver_sparkle",
    SPARKLE_FRAME_TABLE,
    TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS.renderer,
  );

  return Object.freeze({
    redStarFrames: Object.freeze(redStarFrames),
    silverStarFrames: Object.freeze(silverStarFrames),
    redSparkleFrames: Object.freeze(redSparkleFrames),
    silverSparkleFrames: Object.freeze(silverSparkleFrames),
  });
}

function buildTitleHeadStarEffectSourceContract({
  sources,
  assets,
  animationGraph,
}) {
  const tables = validateSources(sources);
  const textures = textureRows(sourceText(sources, "renderer"), assets);
  const sourceFiles = Object.entries(TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS).map(([key, path]) => ({
    path,
    sha256: key === "assets"
      ? titleHeadSha256(JSON.stringify(canonicalTitleHeadValue(assets)))
      : titleHeadSha256(sourceText(sources, key)),
  }));
  const payload = {
    schema: TITLE_HEAD_STAR_EFFECT_SOURCE_SCHEMA,
    slice: "regular-interactive-title-head-recurring-star-effects",
    sourceFiles,
    lightStars: {
      drawOrder: ["silver-star", "red-star"],
      sharedDisplayListCounter: {
        first: 1,
        last: 16,
        wrapAtIncrementedValue: 17,
        table: tables.redStarFrames,
      },
      quad: {
        sourceBounds: { left: -64, right: 64, bottom: 0, top: 128, z: 0 },
        texturePixels: { width: 32, height: 32 },
        billboard: "camera-space translation with no source object rotation",
      },
      paths: [
        lightPath(animationGraph, "N228", "N230"),
        lightPath(animationGraph, "N231", "N233"),
      ],
    },
    emitters: [
      {
        id: "picked-silver-burst",
        sourceOrder: 0,
        type: 3,
        colour: "white",
        attachment: "camera-picked-object",
        shape: "silver-sparkle",
        poolSize: 30,
        spawnPolicy: "once-per-no-pick-to-picked-transition",
      },
      {
        id: "silver-star-trail",
        sourceOrder: 1,
        type: 2,
        colour: "white",
        attachment: "N228",
        shape: "silver-sparkle",
        poolSize: 30,
        spawnPolicy: "refill-every-expired-slot-before-child-update",
      },
      {
        id: "red-star-trail",
        sourceOrder: 2,
        type: 2,
        colour: "red",
        attachment: "N231",
        shape: "red-sparkle",
        poolSize: 30,
        spawnPolicy: "refill-every-expired-slot-before-child-update",
      },
    ],
    drawOrder: [
      "silver-star",
      "red-star",
      "picked-silver-burst",
      "silver-star-trail",
      "red-star-trail",
    ],
    particle: {
      poolCount: 3,
      slotsPerPool: 30,
      slotCount: 90,
      timeout: { minimum: 7, maximum: 12, formula: "f32(12 - random * 5)" },
      velocity: {
        componentMinimum: -25,
        componentMaximum: 25,
        formula: "f32(random * 50 - 25)",
        acceptedMagnitudeMaximum: 30,
        rejection: "repeat complete xyz tuple while magnitude > 30",
      },
      cameraBias: {
        continuous: "camera third row multiplied by -20 on xyz",
        picked: "camera third row multiplied by [-50,-50,+50]",
      },
      gravityY: -0.4,
      damping: 0.9,
      updateOrder: [
        "resolve emitter attachment and picked flags",
        "advance emitter position",
        "apply emitter gravity",
        "initialize fixed child pool once",
        "damp emitter velocity",
        "spawn eligible children",
        "advance children in stable slot order",
        "post-decrement child timeout and hide expired child",
      ],
      sparkleQuad: {
        sourceBounds: { left: -32, right: 32, bottom: 0, top: 64, z: 0 },
        texturePixels: { width: 32, height: 32 },
      },
      sparkleDisplayListTable: tables.redSparkleFrames,
      sparkleFrame5: "decoded-and-retained-but-unreferenced-source-quirk",
      brightness: "timeout / 10 while timeout > 0; black otherwise",
    },
    textures,
    randomness: {
      source: "gd_rand_float mixes mutable primary/secondary seeds with gd_get_ostime",
      exactProductPolicy:
        "prepare-generated hash-bound accepted spawn tuples consumed in stable order with deterministic wrap",
      proofBoundary:
        "exact states require injected RNG/time samples; uncontrolled native particle coordinates are visual/distribution evidence only",
    },
    proof: {
      directImplementationTruth: "pinned n64decomp/sm64 source closure",
      candidateRuntimeUsed: false,
      productRuntimeImported: false,
    },
  };
  return Object.freeze({ ...payload, contentHash: titleHeadContentHash(payload) });
}

// starEffectsAtlas
const TITLE_HEAD_STAR_EFFECT_ATLAS_PATH =
  "textures/star-effects.png";

const CELL_SIZE = 32;
const GUTTER = 1;
const STRIDE = CELL_SIZE + GUTTER * 2;
const COLUMNS = 8;
const ROWS = 4;

const TITLE_HEAD_STAR_EFFECT_TEXTURE_SPECS = Object.freeze([
  ...Array.from({ length: 8 }, (_, frame) => Object.freeze({
    id: `title-head:red-star:${frame}`,
    family: "red-star",
    frame,
    asset: `textures/intro_raw/red_star_${frame}.rgba16.png`,
  })),
  ...Array.from({ length: 8 }, (_, frame) => Object.freeze({
    id: `title-head:white-star:${frame}`,
    family: "white-star",
    frame,
    asset: `textures/intro_raw/white_star_${frame}.rgba16.png`,
  })),
  ...Array.from({ length: 6 }, (_, frame) => Object.freeze({
    id: `title-head:sparkle:${frame}`,
    family: "sparkle",
    frame,
    asset: `textures/intro_raw/sparkle_${frame}.rgba16.png`,
  })),
]);

function starAtlasFail(message) {
  throw new TypeError(`Title-head star-effect atlas: ${message}`);
}

function assets(value, label) {
  const source = typeof value === "string" ? value : "";
  try {
    if (label === "candidate") {
      const start = source.indexOf("{");
      if (start < 0) starAtlasFail("candidate asset map is missing");
      return JSON.parse(source.slice(start).trim().replace(/;\s*$/u, ""));
    }
    return JSON.parse(source);
  } catch (error) {
    starAtlasFail(`${label} asset map is invalid: ${error.message}`);
  }
}

function sourceRange(catalog, spec, label) {
  const entry = catalog?.[spec.asset];
  const regions = entry?.[3]?.us;
  if (!Array.isArray(entry) || entry[0] !== CELL_SIZE || entry[1] !== CELL_SIZE
    || entry[2] !== 2048 || !Array.isArray(regions) || regions.length !== 1
    || !Number.isSafeInteger(regions[0]) || regions[0] < 0) {
    starAtlasFail(`${label} range for ${spec.asset} is invalid`);
  }
  return regions[0];
}

function defaultReadRomRange({ romPath, offset, bytes, asset }) {
  let descriptor;
  try {
    descriptor = openSync(romPath, fsConstants.O_RDONLY);
  } catch (error) {
    starAtlasFail(`could not open the qualified ROM: ${error.message}`);
  }
  const output = Buffer.alloc(bytes);
  let cursor = 0;
  try {
    while (cursor < bytes) {
      const count = readSync(
        descriptor,
        output,
        cursor,
        bytes - cursor,
        offset + cursor,
      );
      if (count === 0) starAtlasFail(`ROM ended inside ${asset}`);
      cursor += count;
    }
  } finally {
    closeSync(descriptor);
  }
  return output;
}

function copyCell(atlas, atlasWidth, pixels, column, row) {
  const x = column * STRIDE + GUTTER;
  const y = row * STRIDE + GUTTER;
  for (let sourceY = 0; sourceY < CELL_SIZE; sourceY += 1) {
    pixels.copy(
      atlas,
      ((y + sourceY) * atlasWidth + x) * 4,
      sourceY * CELL_SIZE * 4,
      (sourceY + 1) * CELL_SIZE * 4,
    );
  }
  return Object.freeze({
    x,
    y,
    width: CELL_SIZE,
    height: CELL_SIZE,
    gutter: GUTTER,
  });
}

function redPrimModulate(pixels) {
  const output = Buffer.alloc(pixels.length);
  for (let index = 0; index < pixels.length; index += 4) {
    output[index] = pixels[index];
    output[index + 3] = pixels[index + 3];
  }
  return output;
}

function buildTitleHeadStarEffectAtlas({
  romPath,
  qualifiedRom,
  authoritativeAssetsSource,
  candidateAssetsSource,
  baseTexturesHash,
  readRomRange = defaultReadRomRange,
} = {}) {
  if (!qualifiedRom?.qualified || qualifiedRom.region !== SM64_US_ROM.region
    || qualifiedRom.byteOrder !== SM64_US_ROM.byteOrder
    || qualifiedRom.size !== SM64_US_ROM.size
    || qualifiedRom.sha1 !== SM64_US_ROM.sha1
    || qualifiedRom.copied !== false) {
    starAtlasFail("a qualified user-owned US big-endian ROM is required");
  }
  if (typeof romPath !== "string" || !romPath
    || typeof baseTexturesHash !== "string"
    || !/^[0-9a-f]{64}$/u.test(baseTexturesHash)) {
    starAtlasFail("ROM path and base texture binding are required");
  }
  const authoritative = assets(authoritativeAssetsSource, "authoritative");
  const candidate = assets(candidateAssetsSource, "candidate");
  const width = COLUMNS * STRIDE;
  const height = ROWS * STRIDE;
  const atlasPixels = Buffer.alloc(width * height * 4);
  const decodedById = new Map();
  const textures = TITLE_HEAD_STAR_EFFECT_TEXTURE_SPECS.map((spec) => {
    const offset = sourceRange(authoritative, spec, "authoritative");
    if (sourceRange(candidate, spec, "candidate") !== offset) {
      starAtlasFail(`candidate and authoritative ranges disagree for ${spec.asset}`);
    }
    const source = readRomRange({
      romPath,
      offset,
      bytes: 2048,
      asset: spec.asset,
    });
    if (!Buffer.isBuffer(source) || source.length !== 2048) {
      starAtlasFail(
        `exact ROM range returned ${source?.length ?? "no"} bytes; expected 2048 for ${spec.asset}`,
      );
    }
    const pixels = decodeRgba16(source, CELL_SIZE, CELL_SIZE);
    const row = spec.family === "red-star" ? 0
      : spec.family === "white-star" ? 1 : 2;
    const atlasCell = copyCell(
      atlasPixels,
      width,
      pixels,
      spec.frame,
      row,
    );
    decodedById.set(spec.id, pixels);
    return Object.freeze({
      ...spec,
      role: `${spec.family}-source-frame`,
      source: Object.freeze({
        asset: spec.asset,
        encoding: "RGBA16",
        range: Object.freeze({
          offset,
          bytes: 2048,
          endExclusive: offset + 2048,
        }),
        rawSha256: titleHeadSha256(source),
        rawBytesRetained: false,
      }),
      decoded: Object.freeze({
        encoding: "RGBA8",
        bytes: pixels.length,
        sha256: titleHeadSha256(pixels),
      }),
      atlasCell,
      referencedBySourceFrameTable:
        spec.family !== "sparkle" || spec.frame !== 5,
    });
  });
  const derivedPresentationCells = Object.freeze(
    Array.from({ length: 6 }, (_, frame) => {
      const sourceTextureId = `title-head:sparkle:${frame}`;
      const pixels = redPrimModulate(decodedById.get(sourceTextureId));
      return Object.freeze({
        id: `title-head:red-sparkle:${frame}`,
        sourceTextureId,
        frame,
        derivation:
          "prepare-time G_CC_MODULATERGBA_PRIM with source red prim colour 255,0,0,255",
        decodedSha256: titleHeadSha256(pixels),
        atlasCell: copyCell(atlasPixels, width, pixels, frame, 3),
        referencedBySourceFrameTable: frame !== 5,
      });
    }),
  );
  const png = encodePngRgba8(atlasPixels, width, height);
  const atlas = Object.freeze({
    path: TITLE_HEAD_STAR_EFFECT_ATLAS_PATH,
    role: "title-head-star-effects-atlas-png",
    encoding: "PNG-RGBA8",
    width,
    height,
    decodedBytes: atlasPixels.length,
    decodedSha256: titleHeadSha256(atlasPixels),
    bytes: png.length,
    sha256: titleHeadSha256(png),
    cell: Object.freeze({
      sourceWidth: CELL_SIZE,
      sourceHeight: CELL_SIZE,
      gutter: GUTTER,
      stride: STRIDE,
      columns: COLUMNS,
      rows: ROWS,
    }),
  });
  const starEffects = Object.freeze({
    policy: Object.freeze({
      selection: "exact-22-source-texture-allowlist",
      sourceTextureCount: 22,
      presentationCellCount: 28,
      decodedAtPrepare: true,
      primColourModulationAtPrepare: true,
      runtimePixelReads: false,
      runtimeRasterComposition: false,
      runtimeImageUrlChanges: false,
      rawRomBytesWritten: false,
    }),
    textures: Object.freeze(textures),
    derivedPresentationCells,
    atlas,
  });
  const texturePayload = {
    schema: "cssgraphics-title-head-textures@1",
    slice: "regular-interactive-title-head-star-effects",
    baseTexturesHash,
    starEffects,
  };
  const texturesContract = Object.freeze({
    ...texturePayload,
    contentHash: titleHeadContentHash(texturePayload),
  });
  return Object.freeze({
    texturesContract,
    file: Object.freeze({
      path: atlas.path,
      role: atlas.role,
      bytes: png,
    }),
  });
}

// starEffectsPacket
const TITLE_HEAD_STAR_EFFECTS_PACKET_SCHEMA =
  "cssgraphics-title-head-star-effects-packet@1";
const TITLE_HEAD_STAR_EFFECTS_PACKET_LAYOUT =
  "prepared-light-paths-and-spawn-tuples-v1";
const TITLE_HEAD_STAR_EFFECTS_SPAWN_TUPLE_COUNT = 4096;

const FRAME_COUNT = 820;
const SLOT_COUNT = 30;
const packetF32 = Math.fround;
const TITLE_HEAD_STAR_EFFECTS_ACCEPTED_SPAWN_SEED_HASH =
  "5aa40363c8dc92543204e9cf51ec1073c3667001027856f17988bff661e2ed8a";

function starPacketFail(message) {
  throw new TypeError(message);
}

function scaledPath(channel) {
  const sequence = channel.regularSequence;
  const values = [];
  for (const sample of sequence.samples) {
    for (let component = 0; component < 6; component += 1) {
      values.push(packetF32(sample[component] * sequence.componentScale[component]));
    }
  }
  return values;
}

function cssNumber(value) {
  const normalized = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(normalized, -0) ? 0 : normalized);
}

function preparedBillboardTransforms(path, width, height) {
  const transforms = [];
  for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
    const offset = frameIndex * 6;
    const x = path[offset + 3];
    const y = path[offset + 4];
    const z = path[offset + 5];
    transforms.push(
      "matrix3d(0,1,0,0,0,0,-1,0,1,0,0,0,"
      + `${cssNumber(z)},${cssNumber(x - width / 2)},${cssNumber(y + height)},1)`,
    );
  }
  return Object.freeze(transforms);
}

function lightChannel(animation, targetId, animatorId) {
  const channel = animation?.channels?.find((candidate) => candidate.targetId === targetId);
  if (
    animation?.schema !== "cssgraphics-title-head-animation@1"
    || !channel
    || channel.animatorId !== animatorId
    || channel.targetType !== "light"
    || channel.regularSequence?.frameCount !== FRAME_COUNT
    || channel.regularSequence.samples?.length !== FRAME_COUNT
    || channel.regularSequence.samples.some((row) => row.length !== 6)
  ) {
    starPacketFail(`${targetId}/${animatorId} is not one exact 820-frame light channel`);
  }
  return channel;
}

function xorshift32(seed) {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function buildSpawnTuples(seedHash) {
  const random = xorshift32(Number.parseInt(seedHash.slice(0, 8), 16));
  const rows = [];
  for (
    let tupleIndex = 0;
    tupleIndex < TITLE_HEAD_STAR_EFFECTS_SPAWN_TUPLE_COUNT;
    tupleIndex += 1
  ) {
    const timeout = packetF32(12 - packetF32(random()) * 5);
    let x;
    let y;
    let z;
    let attempts = 0;
    do {
      attempts += 1;
      x = packetF32(packetF32(random()) * 50 - 25);
      y = packetF32(packetF32(random()) * 50 - 25);
      z = packetF32(packetF32(random()) * 50 - 25);
    } while (Math.hypot(x, y, z) > 30);
    rows.push(Object.freeze([timeout, x, y, z, attempts]));
  }
  return Object.freeze(rows);
}

function stableSlots(emitterId) {
  return Object.freeze(
    Array.from({ length: SLOT_COUNT }, (_, sourceOrder) => (
      `star-effect:${emitterId}:slot:${String(sourceOrder).padStart(2, "0")}`
    )),
  );
}

function atlasCell(source, scale) {
  return Object.freeze({
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
    gutter: source.gutter,
    sourceToDisplayScale: scale,
  });
}

function textureCell(textures, id, scale) {
  const source = textures.starEffects?.textures?.find((entry) => entry.id === id);
  if (!source) starPacketFail(`prepared texture cell ${id} is absent`);
  return atlasCell(source.atlasCell, scale);
}

function derivedCell(textures, id, scale) {
  const source = textures.starEffects?.derivedPresentationCells?.find(
    (entry) => entry.id === id,
  );
  if (!source) starPacketFail(`prepared derived texture cell ${id} is absent`);
  return atlasCell(source.atlasCell, scale);
}

function packetDependencies({
  animation,
  playback,
  textures,
  lightingTimeline,
  sourceContract,
}) {
  const camera = lightingTimeline.camera;
  const sourceViewport = Object.freeze({ width: 320, height: 240 });
  return Object.freeze({
    animationHash: animation.contentHash,
    playbackHash: playback.contentHash,
    texturesHash: textures.contentHash,
    lightingTimelineHash: lightingTimeline.contentHash,
    sourceContractHash: sourceContract.contentHash,
    cameraHash: titleHeadContentHash(camera),
    sourceViewportHash: titleHeadContentHash(sourceViewport),
    atlasSha256: textures.starEffects.atlas.sha256,
  });
}

function buildTitleHeadStarEffectsPacket({
  animation,
  playback,
  textures,
  lightingTimeline,
  sourceContract,
} = {}) {
  if (
    playback?.schema !== "cssgraphics-title-head-playback-packet@1"
    || playback.sourceFrames?.count !== FRAME_COUNT
    || playback.bindings?.animationHash !== animation?.contentHash
  ) {
    starPacketFail("star effects require the final 820-frame prepared playback packet");
  }
  if (
    sourceContract?.schema !== "cssgraphics-title-head-star-effect-source@1"
    || sourceContract.lightStars?.paths?.length !== 2
    || sourceContract.emitters?.length !== 3
  ) {
    starPacketFail("star effects require the validated authoritative source contract");
  }
  if (
    textures?.schema !== "cssgraphics-title-head-textures@1"
    || textures.starEffects?.textures?.length !== 22
    || textures.starEffects.atlas?.path !== "textures/star-effects.png"
  ) {
    starPacketFail("star effects require the prepared 22-source-texture atlas");
  }
  if (
    lightingTimeline?.schema !== "cssgraphics-title-head-lighting-timeline@1"
    || lightingTimeline.frameCount !== FRAME_COUNT
  ) {
    starPacketFail("star effects require the exact prepared camera and lighting timeline");
  }

  const bindings = packetDependencies({
    animation,
    playback,
    textures,
    lightingTimeline,
    sourceContract,
  });
  const spawnSeedHash = TITLE_HEAD_STAR_EFFECTS_ACCEPTED_SPAWN_SEED_HASH;
  const spawnTuples = buildSpawnTuples(spawnSeedHash);
  const starFrames = Object.freeze(
    Array.from({ length: FRAME_COUNT }, (_, frameIndex) => frameIndex % 8),
  );
  const silverChannel = lightChannel(animation, "N228", "N230");
  const redChannel = lightChannel(animation, "N231", "N233");
  const silverPath = Object.freeze(scaledPath(silverChannel));
  const redPath = Object.freeze(scaledPath(redChannel));
  const atlas = textures.starEffects.atlas;
  const stars = Object.freeze([
    Object.freeze({
      id: "star-effect:silver-star",
      sourceOrder: 0,
      targetId: "N228",
      animatorId: "N230",
      colour: "white",
      pathLayout: "frame-major-rx-ry-rz-x-y-z",
      path: silverPath,
      preparedTransforms: preparedBillboardTransforms(silverPath, 128, 128),
      frameIndices: starFrames,
      textureCells: Object.freeze(
        Array.from({ length: 8 }, (_, frame) => (
          textureCell(textures, `title-head:white-star:${frame}`, 4)
        )),
      ),
    }),
    Object.freeze({
      id: "star-effect:red-star",
      sourceOrder: 1,
      targetId: "N231",
      animatorId: "N233",
      colour: "red",
      pathLayout: "frame-major-rx-ry-rz-x-y-z",
      path: redPath,
      preparedTransforms: preparedBillboardTransforms(redPath, 128, 128),
      frameIndices: starFrames,
      textureCells: Object.freeze(
        Array.from({ length: 8 }, (_, frame) => (
          textureCell(textures, `title-head:red-star:${frame}`, 4)
        )),
      ),
    }),
  ]);
  const emitterDefinitions = [
    ["picked-silver-burst", 3, "white", "picked-object", "silver"],
    ["silver-star-trail", 2, "white", "N228", "silver"],
    ["red-star-trail", 2, "red", "N231", "red"],
  ];
  const emitters = Object.freeze(
    emitterDefinitions.map(([id, type, colour, attachment, presentation], sourceOrder) => (
      Object.freeze({
        id: `star-effect:${id}`,
        sourceId: id,
        sourceOrder,
        type,
        colour,
        attachment,
        poolSize: SLOT_COUNT,
        slotIds: stableSlots(id),
        textureCells: Object.freeze(
          Array.from({ length: 6 }, (_, frame) => (
            presentation === "red"
              ? derivedCell(textures, `title-head:red-sparkle:${frame}`, 2)
              : textureCell(textures, `title-head:sparkle:${frame}`, 2)
          )),
        ),
      })
    )),
  );
  const measuredCore = {
    starPathsUtf8Bytes: Buffer.byteLength(JSON.stringify([silverPath, redPath])),
    starTransformsUtf8Bytes: Buffer.byteLength(JSON.stringify(
      stars.map(({ preparedTransforms }) => preparedTransforms),
    )),
    spawnTuplesUtf8Bytes: Buffer.byteLength(JSON.stringify(spawnTuples)),
    identityUtf8Bytes: Buffer.byteLength(JSON.stringify({ stars, emitters })),
  };
  const payload = {
    schema: TITLE_HEAD_STAR_EFFECTS_PACKET_SCHEMA,
    layout: TITLE_HEAD_STAR_EFFECTS_PACKET_LAYOUT,
    slice: "regular-interactive-title-head-recurring-star-effects",
    bindings,
    sourceFiles: sourceContract.sourceFiles,
    sourceFrames: Object.freeze({
      first: 1,
      last: FRAME_COUNT,
      count: FRAME_COUNT,
      wrapTo: 1,
      directIndex: "sourceFrame-1",
    }),
    camera: lightingTimeline.camera,
    sourceViewport: Object.freeze({ width: 320, height: 240 }),
    atlas: Object.freeze({
      path: atlas.path,
      sha256: atlas.sha256,
      width: atlas.width,
      height: atlas.height,
      immutableImageIdentity: true,
    }),
    billboardGeometry: Object.freeze({
      star: Object.freeze({
        left: -64,
        right: 64,
        bottom: 0,
        top: 128,
        z: 0,
        width: 128,
        height: 128,
      }),
      sparkle: Object.freeze({
        left: -32,
        right: 32,
        bottom: 0,
        top: 64,
        z: 0,
        width: 64,
        height: 64,
      }),
      composition: "camera-space billboard translation",
    }),
    drawOrder: Object.freeze([
      "star-effect:silver-star",
      "star-effect:red-star",
      "star-effect:picked-silver-burst",
      "star-effect:silver-star-trail",
      "star-effect:red-star-trail",
    ]),
    stars,
    emitters,
    particle: Object.freeze({
      gravityY: -0.4,
      damping: 0.9,
      lifetime: Object.freeze({ base: 12, randomScale: 5, minimum: 7, maximum: 12 }),
      velocity: Object.freeze({
        randomScale: 50,
        offset: -25,
        componentMinimum: -25,
        componentMaximum: 25,
        acceptedMagnitudeMaximum: 30,
      }),
      cameraBias: Object.freeze({
        continuous: Object.freeze([-20, -20, -20]),
        picked: Object.freeze([-50, -50, 50]),
      }),
      sparkleFrameTable: Object.freeze([4, 4, 3, 3, 2, 2, 1, 1, 0, 0, 4, 4]),
      inactiveTimeoutMaximum: 0,
      drawTimeoutMinimum: 1,
      pickedFlags: Object.freeze({ present: 0x20, emitted: 0x10 }),
      updateOrder: sourceContract.particle.updateOrder,
    }),
    spawnStream: Object.freeze({
      policy: "prepare-generated-hash-bound-accepted-tuples",
      seedHash: spawnSeedHash,
      tupleLayout: "timeout-vx-vy-vz-rejection-attempts",
      count: spawnTuples.length,
      wrap: "increment modulo tuple count after every activated slot",
      tuples: spawnTuples,
      contentHash: titleHeadContentHash(spawnTuples),
      sourceDeviation:
        "replaces gd_rand_float OS-time mixing while preserving source ranges and rejection acceptance",
    }),
    totals: Object.freeze({
      starLeaves: 2,
      emitterPools: 3,
      slotsPerPool: SLOT_COUNT,
      sparkleLeaves: 90,
      effectLeaves: 92,
      starPathRows: FRAME_COUNT * 2,
      starPathScalars: FRAME_COUNT * 2 * 6,
      starFrameIndices: FRAME_COUNT * 2,
      preparedStarTransforms: FRAME_COUNT * 2,
      spawnTupleRows: spawnTuples.length,
      spawnTupleScalars: spawnTuples.length * 5,
      measuredCoreUtf8Bytes:
        measuredCore.starPathsUtf8Bytes
        + measuredCore.starTransformsUtf8Bytes
        + measuredCore.spawnTuplesUtf8Bytes
        + measuredCore.identityUtf8Bytes,
      measured: Object.freeze(measuredCore),
    }),
    runtimePolicy: Object.freeze({
      sourceParsing: false,
      romReads: false,
      randomness: false,
      particleTransformTimeline: false,
      imageUrlChanges: false,
      stableLeavesRequired: true,
    }),
  };
  const packet = Object.freeze({ ...payload, contentHash: titleHeadContentHash(payload) });
  return packet;
}

function prepareTitleHeadStarEffects({
  paths,
  env,
  animation,
  baseTextures,
  lightingTimeline,
  motionBytes,
}) {
  const authoritativeRoot = resolve(paths.upstream.absolute, "sm64");
  const candidateRoot = resolve(paths.upstream.absolute, "sm64js");
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  const qualifiedRom = qualifyRom({ cwd: paths.repoRoot, env });
  const atlasBuild = buildTitleHeadStarEffectAtlas({
    romPath: resolveRomPath(env, paths.repoRoot).absolute,
    qualifiedRom,
    authoritativeAssetsSource: readFileSync(
      resolve(authoritativeRoot, "assets.json"),
      "utf8",
    ),
    candidateAssetsSource: readFileSync(
      resolve(candidateRoot, "src/assets.js"),
      "utf8",
    ),
    baseTexturesHash: baseTextures.contentHash,
  });
  const sources = Object.fromEntries(
    Object.entries(TITLE_HEAD_STAR_EFFECT_SOURCE_PATHS)
      .filter(([key]) => key !== "assets")
      .map(([key, path]) => [
        key,
        readFileSync(resolve(authoritativeRoot, path), "utf8"),
      ]),
  );
  const sourceContract = buildTitleHeadStarEffectSourceContract({
    sources,
    assets: readJson(resolve(authoritativeRoot, "assets.json")),
    animationGraph: animation,
  });
  const playback = Object.freeze({
    schema: "cssgraphics-title-head-playback-packet@1",
    sourceFrames: Object.freeze({ count: 820 }),
    bindings: Object.freeze({ animationHash: animation.contentHash }),
    contentHash: titleHeadSha256(motionBytes),
  });
  const packet = buildTitleHeadStarEffectsPacket({
    animation,
    playback,
    textures: atlasBuild.texturesContract,
    lightingTimeline,
    sourceContract,
  });
  const files = Object.freeze([
    atlasBuild.file,
    Object.freeze({
      path: "star-effects-packet.json",
      role: "title-head-star-effects-packet-contract",
      bytes: Buffer.from(serializeTitleHeadContract(packet)),
    }),
  ]);
  return Object.freeze({ contract: packet, files });
}
export {
  prepareTitleHeadStarEffects,
};
