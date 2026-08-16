import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  generatedProductRoot,
  referencePath,
  sourceRoot,
} from "./paths.mjs";

const SOURCE_WIDTH = 585;
const SOURCE_HEIGHT = 384;
const SOURCE_WAIT_MS = 5;
const GDI_PLAYBACK_SCALE = 1.5;
const SOURCE_STEP_MS = SOURCE_WAIT_MS * GDI_PLAYBACK_SCALE;
const PLAYBACK_FPS = 24;
const INITIAL_HOLD_MS = 500;
const CLEAR_DELAY_MS = 500;
const CLEAR_HOLD_MS = 1_000;
const CARD_ATLAS_WIDTH = 960;
const CARD_ATLAS_HEIGHT = 2_080;
const CARD_SOURCE_WIDTH = 240;
const CARD_SOURCE_HEIGHT = 160;
const CARD_WIDTH = 71;
const CARD_HEIGHT = 96;
const FLOOR_Y = SOURCE_HEIGHT - CARD_HEIGHT;
const FOUNDATION_Y = 4;
const FOUNDATION_GAP = (SOURCE_WIDTH - CARD_WIDTH * 7) / 8;
const FOUNDATION_X = Object.freeze(Array.from(
  { length: 4 },
  (_, index) => FOUNDATION_GAP + (index + 3) * (CARD_WIDTH + FOUNDATION_GAP),
));
const TRAIL_SAMPLE_DISTANCE = 2;
const ANIMATION_RNG_STATE = 1;
const CARD_SOURCE_FILE = "card-faces-english-pattern-cc0.png";
const EXPECTED_CARD_SHA256 = "e782179fb60932722548e3e6b46038a2df16d15001d3ea8cbdd22cc005f2841d";

function rounded(value) {
  const next = Math.round(value * 1e6) / 1e6;
  return Object.is(next, -0) ? 0 : next;
}

function matrix(values) {
  return values.map(rounded);
}

function multiply(left, right) {
  const output = Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let axis = 0; axis < 4; axis += 1) {
        output[column * 4 + row] += left[axis * 4 + row] * right[column * 4 + axis];
      }
    }
  }
  return matrix(output);
}

function identity() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

function compose(...values) {
  return values.reduce((result, value) => multiply(result, value), identity());
}

function translation(x, y, z) {
  return matrix([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

function rotationZ(degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return matrix([
    cosine, sine, 0, 0,
    -sine, cosine, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function scale(x, y, z) {
  return matrix([
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
  ]);
}

function cardMatrix(left, top, z) {
  return compose(
    translation(left + CARD_WIDTH, top, z),
    rotationZ(90),
    scale(CARD_HEIGHT / CARD_SOURCE_WIDTH, CARD_WIDTH / CARD_SOURCE_HEIGHT, 1),
  );
}

function atlasPosition(cardFace) {
  const index = cardFace - 1;
  return {
    x: Math.floor(index / 13) * CARD_SOURCE_WIDTH,
    y: (index % 13) * CARD_SOURCE_HEIGHT,
  };
}

function faceNumber(rank, suit) {
  return suit * 13 + rank;
}

function msvcRandom(initialState) {
  let state = initialState >>> 0;
  return () => {
    state = (Math.imul(state, 214013) + 2531011) >>> 0;
    return (state >>> 16) & 0x7fff;
  };
}

function matrixText(value) {
  return `matrix3d(${value.join(",")})`;
}

function snapshotId(index) {
  return `trail-${String(index).padStart(5, "0")}`;
}

function simulateSource() {
  const random = msvcRandom(ANIMATION_RNG_STATE);
  const snapshots = [];
  const cards = [];
  let sourceStep = 0;
  let sourceDraws = 0;
  for (let rank = 13; rank >= 1; rank -= 1) {
    for (let suit = 0; suit < 4; suit += 1) {
      let velocityX = random() % 110 - 65;
      if (Math.abs(velocityX) < 15) velocityX = -20;
      let velocityY = random() % 110 - 75;
      let x = FOUNDATION_X[suit];
      let y = FOUNDATION_Y;
      let lastKeptX = Number.NEGATIVE_INFINITY;
      let lastKeptY = Number.NEGATIVE_INFINITY;
      let retainedSnapshots = 0;
      while (-CARD_WIDTH < x && x < SOURCE_WIDTH) {
        if (retainedSnapshots === 0 || Math.hypot(x - lastKeptX, y - lastKeptY) >= TRAIL_SAMPLE_DISTANCE) {
          snapshots.push({
            id: snapshotId(snapshots.length),
            faceNumber: faceNumber(rank, suit),
            sourceStep,
            timeMs: INITIAL_HOLD_MS + sourceStep * SOURCE_STEP_MS,
            x,
            y,
          });
          lastKeptX = x;
          lastKeptY = y;
          retainedSnapshots += 1;
        }
        sourceDraws += 1;
        x += Math.trunc(velocityX / 10);
        y += Math.trunc(velocityY / 10);
        velocityY += 3;
        if (y > FLOOR_Y && velocityY > 0) velocityY = Math.trunc(-8 * velocityY / 10);
        sourceStep += 1;
      }
      cards.push({ rank, suit, velocityX, retainedSnapshots });
    }
  }
  return Object.freeze({ cards, snapshots, sourceDraws, sourceSteps: sourceStep });
}

function cardLeaf({ cardFace, left, top, z }) {
  return Object.freeze({
    matrix: cardMatrix(left, top, z),
    atlas: atlasPosition(cardFace),
  });
}

function buildPlayback(snapshots, retainedLeafCount) {
  const frameTimesMs = [0];
  const visibilityRows = [snapshots.map((_, index) => -(index + FOUNDATION_X.length + 1))];
  let snapshotIndex = 0;
  const lastRevealTimeMs = snapshots.at(-1)?.timeMs ?? INITIAL_HOLD_MS;
  const frameInterval = 1_000 / PLAYBACK_FPS;
  const revealFrameCount = Math.ceil(lastRevealTimeMs / frameInterval);
  for (let frameIndex = 1; frameIndex <= revealFrameCount; frameIndex += 1) {
    const timeMs = Math.round(frameIndex * frameInterval);
    const row = [];
    while (snapshotIndex < snapshots.length && snapshots[snapshotIndex].timeMs <= timeMs) {
      row.push(snapshotIndex + FOUNDATION_X.length + 1);
      snapshotIndex += 1;
    }
    if (row.length > 0) {
      frameTimesMs.push(timeMs);
      visibilityRows.push(row);
    }
  }
  const clearTimeMs = Math.ceil(lastRevealTimeMs + CLEAR_DELAY_MS);
  frameTimesMs.push(clearTimeMs);
  visibilityRows.push(snapshots.map((_, index) => -(index + FOUNDATION_X.length + 1)));
  return Object.freeze({
    schema: "csssolitaire-prepared-playback@1",
    durationMs: clearTimeMs + CLEAR_HOLD_MS,
    loop: true,
    sourceStepMilliseconds: SOURCE_STEP_MS,
    initialHoldMilliseconds: INITIAL_HOLD_MS,
    foundationLeafCount: FOUNDATION_X.length,
    retainedLeafCount,
    frameTimesMs,
    visibilityRows,
    runtimeGeometryCalculation: false,
    runtimeTrajectoryCalculation: false,
    runtimeAtlasRasterization: false,
    runtimeDomGrowth: false,
  });
}

function buildSnapshot(leaves, cardAssetUrl) {
  const cardNodes = leaves.map((leaf, index) => {
    const foundationClass = index < FOUNDATION_X.length ? ' class="foundation"' : "";
    return `<s${foundationClass} style="transform:${matrixText(leaf.matrix)};background-position:${-leaf.atlas.x}px ${-leaf.atlas.y}px"></s>`;
  }).join("");
  const css = [
    ".polycss-camera.solitaire-prepared-camera{position:relative;display:block;width:100%;height:100%;overflow:hidden}",
    ".polycss-scene.solitaire-prepared-scene{position:absolute;top:50%;left:50%;width:0;height:0;transform:scale(var(--csssolitaire-fit,1));transform-style:preserve-3d;transform-origin:0 0}",
    `.csssolitaire-board{position:absolute;transform:translate3d(${-SOURCE_WIDTH / 2}px,${-SOURCE_HEIGHT / 2}px,0);transform-style:preserve-3d;transform-origin:0 0}`,
    `.csssolitaire-board>s{position:absolute;display:block;width:${CARD_SOURCE_WIDTH}px;height:${CARD_SOURCE_HEIGHT}px;margin:0;padding:0;overflow:hidden;border:0;border-radius:14px;background-image:url('${cardAssetUrl}');background-repeat:no-repeat;background-size:${CARD_ATLAS_WIDTH}px ${CARD_ATLAS_HEIGHT}px;backface-visibility:hidden;transform-origin:0 0;visibility:hidden;pointer-events:none;text-decoration:none;font:normal normal normal 0/0 serif;image-rendering:auto}`,
    ".csssolitaire-board>s.foundation{visibility:visible}",
  ].join("");
  return `<!doctype html><html><head><style>${css}</style></head><body><div class="polycss-camera solitaire-prepared-camera"><div class="polycss-scene solitaire-prepared-scene"><div class="csssolitaire-board">${cardNodes}</div></div></div></body></html>\n`;
}

export async function prepareCsssolitaire({ outputRoot = generatedProductRoot() } = {}) {
  const [cardBytes, referenceBytes] = await Promise.all([
    readFile(join(sourceRoot, CARD_SOURCE_FILE)),
    readFile(referencePath),
  ]);
  const cardSha256 = sha256(cardBytes);
  if (cardSha256 !== EXPECTED_CARD_SHA256) throw new Error("cssSolitaire CC0 card atlas identity mismatch");

  const source = simulateSource();
  const foundationLeaves = FOUNDATION_X.map((left, suit) => cardLeaf({
    cardFace: faceNumber(13, suit),
    left,
    top: FOUNDATION_Y,
    z: -1 + suit * 0.001,
  }));
  const trailLeaves = source.snapshots.map((snapshot, index) => cardLeaf({
    cardFace: snapshot.faceNumber,
    left: snapshot.x,
    top: snapshot.y,
    z: index * 0.0001,
  }));
  const leaves = Object.freeze([...foundationLeaves, ...trailLeaves]);
  const playback = buildPlayback(source.snapshots, leaves.length);
  const cardAssetName = `card-faces-${cardSha256}.png`;
  const cardAssetUrl = `/csssolitaire/assets/${cardAssetName}`;
  const snapshotText = buildSnapshot(leaves, cardAssetUrl);
  const playbackText = `${JSON.stringify(playback)}\n`;
  const manifest = {
    schema: "csssolitaire-manifest@1",
    status: "ready",
    scope: "public-prepared-product",
    identity: {
      id: "solitaire-victory",
      name: "Solitaire Victory",
      revision: "1.0.0",
    },
    sourceProfile: {
      playfield: [SOURCE_WIDTH, SOURCE_HEIGHT],
      cardSize: [CARD_WIDTH, CARD_HEIGHT],
      preparedRng: "msvcrt-compatible-state-1",
      rankOrder: "king-to-ace",
      foundationCount: FOUNDATION_X.length,
      cards: source.cards.length,
      sourceDraws: source.sourceDraws,
      sourceSteps: source.sourceSteps,
      sourceStepMilliseconds: SOURCE_STEP_MS,
    },
    renderer: {
      engine: "PolyCSS",
      morphTarget: "createPolyMorphPreparedDomTarget",
      profile: "prepared-playback",
      retainedDom: true,
      leafTag: "s",
      textureBackend: "atlas",
      textureLeafSizing: "raster",
      textureImageRendering: "auto",
      seamBleed: 0.2,
      runtimeCanvasCount: 0,
      runtimeAtlasRasterization: false,
      runtimeGeometryCalculation: false,
      runtimeTrajectoryCalculation: false,
      runtimeDomGrowth: false,
    },
    transport: {
      snapshotUrl: "/csssolitaire/solitaire.polycss.html",
      playbackUrl: "/csssolitaire/solitaire-playback.json",
      cardAtlasUrl: cardAssetUrl,
      runtimeModelPayload: false,
      runtimeManifestRequired: true,
    },
    metrics: {
      retainedLeafCount: leaves.length,
      foundationLeafCount: FOUNDATION_X.length,
      trailLeafCount: source.snapshots.length,
      preparedFrameCount: playback.frameTimesMs.length,
      durationMs: playback.durationMs,
      preparedVisibilityOperationCount: playback.visibilityRows.reduce((sum, row) => sum + row.length, 0),
    },
    provenance: {
      referenceSha256: sha256(referenceBytes),
      cardAtlas: {
        id: "loren-osborn-english-pattern-playing-cards-deck-plus-cc0",
        uri: "https://commons.wikimedia.org/wiki/File:English_pattern_playing_cards_deck_PLUS_CC0.svg",
        license: "CC0-1.0",
        sha256: cardSha256,
      },
      proprietaryProductBytesIncluded: false,
      nativeCaptureIncluded: false,
      oraclePacketIncluded: false,
    },
  };

  const stagingRoot = `${outputRoot}.tmp-${process.pid}`;
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(join(stagingRoot, "assets"), { recursive: true });
  try {
    await Promise.all([
      copyFile(join(sourceRoot, CARD_SOURCE_FILE), join(stagingRoot, "assets", cardAssetName)),
      writeFile(join(stagingRoot, "solitaire.polycss.html"), snapshotText),
      writeFile(join(stagingRoot, "solitaire-playback.json"), playbackText),
    ]);
    manifest.assets = {
      snapshot: descriptor("solitaire.polycss.html", Buffer.from(snapshotText)),
      playback: descriptor("solitaire-playback.json", Buffer.from(playbackText)),
      cardAtlas: descriptor(`assets/${cardAssetName}`, cardBytes),
    };
    await writeFile(join(stagingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await mkdir(dirname(outputRoot), { recursive: true });
    await rm(outputRoot, { recursive: true, force: true });
    await rename(stagingRoot, outputRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({ outputRoot, manifest });
}

function descriptor(path, bytes) {
  return Object.freeze({ path, byteLength: bytes.length, sha256: sha256(bytes) });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
