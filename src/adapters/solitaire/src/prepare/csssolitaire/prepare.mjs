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
const PORTRAIT_WIDTH = SOURCE_HEIGHT;
const PORTRAIT_HEIGHT = 720;
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
const STARTING_CARDS = Object.freeze([
  Object.freeze({ id: "king-of-spades", rank: 13, suit: 0, slot: 3, velocityY: -70 }),
  Object.freeze({ id: "queen-of-hearts", rank: 12, suit: 1, slot: 4, velocityY: -50 }),
  Object.freeze({ id: "jack-of-diamonds", rank: 11, suit: 2, slot: 5, velocityY: -30 }),
  Object.freeze({ id: "ace-of-clubs", rank: 1, suit: 3, slot: 6, velocityY: -10 }),
].map((card) => Object.freeze({
  ...card,
  x: FOUNDATION_GAP + card.slot * (CARD_WIDTH + FOUNDATION_GAP),
})));
const FOUNDATION_COUNT = STARTING_CARDS.length;
const PORTRAIT_CARD_COUNTS = Object.freeze([1, 2, 3, 4]);
const PORTRAIT_CARD_BREAKPOINTS = Object.freeze([520, 720, 920]);
const PORTRAIT_HORIZONTAL_DISTANCE_SCALE = 2;
const LAUNCH_CYCLE_COUNT = 3;
const RANK_NAMES = Object.freeze([
  null, "ace", "two", "three", "four", "five", "six", "seven",
  "eight", "nine", "ten", "jack", "queen", "king",
]);
const SUIT_NAMES = Object.freeze(["spades", "hearts", "diamonds", "clubs"]);
const LAUNCH_CARDS = Object.freeze(Array.from(
  { length: LAUNCH_CYCLE_COUNT },
  (_, cycleIndex) => STARTING_CARDS.map((startingCard, foundationIndex) => {
    const rank = ((startingCard.rank - cycleIndex + 12) % 13) + 1;
    return Object.freeze({
      id: `${RANK_NAMES[rank]}-of-${SUIT_NAMES[startingCard.suit]}`,
      rank,
      suit: startingCard.suit,
      x: startingCard.x,
      velocityY: startingCard.velocityY,
      cycleIndex,
      foundationIndex,
    });
  }),
).flat());
const TRAIL_SAMPLE_DISTANCE = 2;
const PREPARED_PATTERN_COUNT = 24;
const PREPARED_PATTERN_SEEDS = Object.freeze(Array.from(
  { length: PREPARED_PATTERN_COUNT },
  (_, index) => 1 + index * 9_973,
));
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

function reflectBetween(value, minimum, maximum) {
  const range = maximum - minimum;
  const period = range * 2;
  const offset = ((value - minimum) % period + period) % period;
  return offset <= range ? minimum + offset : maximum - (offset - range);
}

function portraitCardPosition(left, top, foundationIndex, cardCount) {
  if (foundationIndex >= cardCount) return null;
  const gap = (PORTRAIT_WIDTH - cardCount * CARD_WIDTH) / (cardCount + 1);
  const startLeft = gap + foundationIndex * (CARD_WIDTH + gap);
  const sourceStartLeft = STARTING_CARDS[foundationIndex].x;
  return Object.freeze({
    left: reflectBetween(
      startLeft + (left - sourceStartLeft) * PORTRAIT_HORIZONTAL_DISTANCE_SCALE,
      0,
      PORTRAIT_WIDTH - CARD_WIDTH,
    ),
    top: (top + CARD_HEIGHT / 2) * PORTRAIT_HEIGHT / SOURCE_HEIGHT - CARD_HEIGHT / 2,
  });
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
  return `matrix(${[value[0], value[1], value[4], value[5], value[12], value[13]].join(",")})`;
}

function snapshotId(index) {
  return `trail-${String(index).padStart(5, "0")}`;
}

function simulateSource(seed) {
  const random = msvcRandom(seed);
  const snapshots = [];
  const cards = [];
  let sourceStep = 0;
  let sourceDraws = 0;
  for (const startingCard of LAUNCH_CARDS) {
    const startStep = sourceStep;
    const velocityX = -(20 + random() % 46);
    let velocityY = startingCard.velocityY;
    let x = startingCard.x;
    let y = FOUNDATION_Y;
    let lastKeptX = Number.NEGATIVE_INFINITY;
    let lastKeptY = Number.NEGATIVE_INFINITY;
    let retainedSnapshots = 0;
    while (-CARD_WIDTH < x && x < SOURCE_WIDTH) {
      if (retainedSnapshots === 0 || Math.hypot(x - lastKeptX, y - lastKeptY) >= TRAIL_SAMPLE_DISTANCE) {
        snapshots.push({
          id: snapshotId(snapshots.length),
          faceNumber: faceNumber(startingCard.rank, startingCard.suit),
          foundationIndex: startingCard.foundationIndex,
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
    cards.push({
      ...startingCard,
      velocityX,
      retainedSnapshots,
      startStep,
      timeMs: INITIAL_HOLD_MS + startStep * SOURCE_STEP_MS,
    });
  }
  return Object.freeze({ cards, snapshots, sourceDraws, sourceSteps: sourceStep });
}

function cardLeaf({ cardFace, foundationIndex, left, top, z }) {
  const portraitMatrices = PORTRAIT_CARD_COUNTS.map((cardCount) => {
    const portrait = portraitCardPosition(left, top, foundationIndex, cardCount);
    return portrait ? cardMatrix(portrait.left, portrait.top, z) : null;
  });
  return Object.freeze({
    foundationIndex,
    matrix: cardMatrix(left, top, z),
    portraitMatrices: Object.freeze(portraitMatrices),
    atlas: atlasPosition(cardFace),
  });
}

function buildPatternPlayback(snapshots, cards, sourceStepCount) {
  const frameTimesMs = [0];
  const visibilityRows = [snapshots.map((_, index) => -(index + FOUNDATION_COUNT + 1))];
  const foundationRows = [[]];
  const reverseFoundationRows = [[]];
  let snapshotIndex = 0;
  let cardIndex = 0;
  const lastRevealTimeMs = snapshots.at(-1)?.timeMs ?? INITIAL_HOLD_MS;
  const frameInterval = 1_000 / PLAYBACK_FPS;
  const revealFrameCount = Math.ceil(lastRevealTimeMs / frameInterval);
  for (let frameIndex = 1; frameIndex <= revealFrameCount; frameIndex += 1) {
    const timeMs = Math.round(frameIndex * frameInterval);
    const row = [];
    const foundationRow = [];
    const reverseFoundationRow = [];
    while (snapshotIndex < snapshots.length && snapshots[snapshotIndex].timeMs <= timeMs) {
      row.push(snapshotIndex + FOUNDATION_COUNT + 1);
      snapshotIndex += 1;
    }
    while (cardIndex < cards.length && cards[cardIndex].timeMs <= timeMs) {
      const card = cards[cardIndex];
      const nextCard = LAUNCH_CARDS[(card.cycleIndex + 1) * FOUNDATION_COUNT + card.foundationIndex];
      const currentAtlas = atlasPosition(faceNumber(card.rank, card.suit));
      if (nextCard) {
        const atlas = atlasPosition(faceNumber(nextCard.rank, nextCard.suit));
        foundationRow.push([card.foundationIndex, atlas.x, atlas.y]);
      } else {
        foundationRow.push([card.foundationIndex, -1, -1]);
      }
      reverseFoundationRow.push([card.foundationIndex, currentAtlas.x, currentAtlas.y]);
      cardIndex += 1;
    }
    if (row.length > 0 || foundationRow.length > 0) {
      frameTimesMs.push(timeMs);
      visibilityRows.push(row);
      foundationRows.push(foundationRow);
      reverseFoundationRows.push(reverseFoundationRow);
    }
  }
  const lastForwardTimeMs = frameTimesMs.at(-1);
  const rewindStartTimeMs = Math.ceil(lastRevealTimeMs + CLEAR_DELAY_MS);
  const forwardFrameCount = frameTimesMs.length;
  for (let index = forwardFrameCount - 1; index >= 1; index -= 1) {
    frameTimesMs.push(rewindStartTimeMs + lastForwardTimeMs - frameTimesMs[index]);
    visibilityRows.push(visibilityRows[index].map((operation) => -operation));
    foundationRows.push(reverseFoundationRows[index]);
  }
  const rewindEndTimeMs = frameTimesMs.at(-1);
  return Object.freeze({
    durationMs: rewindEndTimeMs + CLEAR_HOLD_MS,
    sourceStepCount,
    rewindStartMilliseconds: rewindStartTimeMs,
    rewindEndMilliseconds: rewindEndTimeMs,
    frameTimesMs,
    visibilityRows,
    foundationRows,
  });
}

function buildPreparedPattern(seed, index) {
  const source = simulateSource(seed);
  const trailLeaves = source.snapshots.map((snapshot, leafIndex) => cardLeaf({
    cardFace: snapshot.faceNumber,
    foundationIndex: snapshot.foundationIndex,
    left: snapshot.x,
    top: snapshot.y,
    z: leafIndex * 0.0001,
  }));
  const timeline = buildPatternPlayback(source.snapshots, source.cards, source.sourceSteps);
  const contentBounds = buildContentBounds(source.snapshots);
  return Object.freeze({
    id: `pattern-${String(index + 1).padStart(2, "0")}`,
    seed,
    source,
    trailLeaves,
    contentBounds,
    timeline,
    playback: Object.freeze({
      id: `pattern-${String(index + 1).padStart(2, "0")}`,
      seed,
      trailLeafCount: trailLeaves.length,
      sourceDrawCount: source.sourceDraws,
      sourceStepCount: source.sourceSteps,
      horizontalVelocities: source.cards.map(({ velocityX }) => velocityX),
      durationMs: timeline.durationMs,
      rewindStartMilliseconds: timeline.rewindStartMilliseconds,
      rewindEndMilliseconds: timeline.rewindEndMilliseconds,
      frameTimesMs: timeline.frameTimesMs,
      visibilityRows: timeline.visibilityRows,
      foundationRows: timeline.foundationRows,
      leafMatrices: trailLeaves.map(({ matrix: leafMatrix }) => matrixText(leafMatrix)),
      leafPortraitMatricesByCardCount: PORTRAIT_CARD_COUNTS.map((_, profileIndex) =>
        trailLeaves.map(({ portraitMatrices }) => {
          const portraitMatrix = portraitMatrices[profileIndex];
          return portraitMatrix ? matrixText(portraitMatrix) : null;
        })),
      leafAtlasIndices: source.snapshots.map(({ faceNumber: cardFace }) => cardFace - 1),
    }),
  });
}

function buildSnapshot(leaves, cardAssetUrl) {
  const cardNodes = leaves.map((leaf, index) => {
    const classes = [index < FOUNDATION_COUNT ? "foundation" : null, `lane-${leaf.foundationIndex}`]
      .filter(Boolean).join(" ");
    const portraitProperties = leaf.portraitMatrices.map((portraitMatrix, profileIndex) =>
      portraitMatrix
        ? `--csssolitaire-portrait-${profileIndex + 1}-transform:${matrixText(portraitMatrix)};`
        : "").join("");
    return `<s class="${classes}" style="--csssolitaire-landscape-transform:${matrixText(leaf.matrix)};${portraitProperties}background-position:${-leaf.atlas.x}px ${-leaf.atlas.y}px"></s>`;
  }).join("");
  const css = [
    ".polycss-camera.solitaire-prepared-camera{position:relative;display:block;width:100%;height:100%;overflow:hidden}",
    ".polycss-scene.solitaire-prepared-scene{position:absolute;top:50%;left:50%;width:0;height:0;transform:scale(var(--csssolitaire-fit,1));transform-origin:0 0}",
    `.csssolitaire-board{position:absolute;transform:translate(${-SOURCE_WIDTH / 2}px,${-SOURCE_HEIGHT / 2}px);transform-origin:0 0}`,
    `.csssolitaire-board>s{position:absolute;display:block;width:${CARD_SOURCE_WIDTH}px;height:${CARD_SOURCE_HEIGHT}px;margin:0;padding:0;overflow:hidden;border:0;border-radius:14px;background-image:url('${cardAssetUrl}');background-repeat:no-repeat;background-size:${CARD_ATLAS_WIDTH}px ${CARD_ATLAS_HEIGHT}px;transform:var(--csssolitaire-landscape-transform);transform-origin:0 0;visibility:hidden;pointer-events:none;text-decoration:none;font:normal normal normal 0/0 serif;image-rendering:auto}`,
    ".csssolitaire-board>s.foundation{visibility:visible}",
    `@media (orientation:portrait){.csssolitaire-board{transform:translate(${-PORTRAIT_WIDTH / 2}px,${-PORTRAIT_HEIGHT / 2}px)}}`,
    `@media (orientation:portrait) and (max-width:${PORTRAIT_CARD_BREAKPOINTS[0] - 1}px){.csssolitaire-board>s{transform:var(--csssolitaire-portrait-1-transform)}.csssolitaire-board>s:is(.lane-1,.lane-2,.lane-3){display:none}}`,
    `@media (orientation:portrait) and (min-width:${PORTRAIT_CARD_BREAKPOINTS[0]}px) and (max-width:${PORTRAIT_CARD_BREAKPOINTS[1] - 1}px){.csssolitaire-board>s{transform:var(--csssolitaire-portrait-2-transform)}.csssolitaire-board>s:is(.lane-2,.lane-3){display:none}}`,
    `@media (orientation:portrait) and (min-width:${PORTRAIT_CARD_BREAKPOINTS[1]}px) and (max-width:${PORTRAIT_CARD_BREAKPOINTS[2] - 1}px){.csssolitaire-board>s{transform:var(--csssolitaire-portrait-3-transform)}.csssolitaire-board>s.lane-3{display:none}}`,
    `@media (orientation:portrait) and (min-width:${PORTRAIT_CARD_BREAKPOINTS[2]}px){.csssolitaire-board>s{transform:var(--csssolitaire-portrait-4-transform)}}`,
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

  const preparedPatterns = PREPARED_PATTERN_SEEDS.map((seed, index) => buildPreparedPattern(seed, index));
  const initialPattern = preparedPatterns[0];
  const source = initialPattern.source;
  const contentBounds = initialPattern.contentBounds;
  const retainedTrailLeafCount = Math.max(...preparedPatterns.map(({ trailLeaves }) => trailLeaves.length));
  const foundationLeaves = STARTING_CARDS.map((card, foundationIndex) => cardLeaf({
    cardFace: faceNumber(card.rank, card.suit),
    foundationIndex,
    left: card.x,
    top: FOUNDATION_Y,
    z: -1,
  }));
  const trailLeaves = [...initialPattern.trailLeaves];
  while (trailLeaves.length < retainedTrailLeafCount) {
    trailLeaves.push(initialPattern.trailLeaves[trailLeaves.length % initialPattern.trailLeaves.length]);
  }
  const leaves = Object.freeze([...foundationLeaves, ...trailLeaves]);
  const playback = Object.freeze({
    schema: "csssolitaire-prepared-playback@2",
    loop: true,
    selection: "crypto-random-shuffled-bag-no-immediate-repeat",
    patternCount: preparedPatterns.length,
    initialPatternIndex: 0,
    sourceStepMilliseconds: SOURCE_STEP_MS,
    initialHoldMilliseconds: INITIAL_HOLD_MS,
    foundationLeafCount: FOUNDATION_COUNT,
    retainedLeafCount: leaves.length,
    retainedTrailLeafCount,
    atlasPositions: Array.from({ length: 52 }, (_, index) => {
      const atlas = atlasPosition(index + 1);
      return `${-atlas.x}px ${-atlas.y}px`;
    }),
    patterns: preparedPatterns.map(({ playback: patternPlayback }) => patternPlayback),
    runtimeSelectionOnly: true,
    runtimeGeometryCalculation: false,
    runtimeTrajectoryCalculation: false,
    runtimeAtlasRasterization: false,
    runtimeDomGrowth: false,
  });
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
      preparedRng: "msvcrt-compatible-24-pattern-bank-horizontal",
      patternSeeds: PREPARED_PATTERN_SEEDS,
      patternCount: preparedPatterns.length,
      patternSelection: playback.selection,
      horizontalVelocityRange: [-65, -20],
      initialVelocityY: STARTING_CARDS.map(({ velocityY }) => velocityY),
      rankOrder: "three-cycles-from-king-queen-jack-ace",
      startingCards: STARTING_CARDS.map(({ id }) => id),
      launchCycleCount: LAUNCH_CYCLE_COUNT,
      launchCards: LAUNCH_CARDS.map(({ id }) => id),
      foundationCount: FOUNDATION_COUNT,
      cards: source.cards.length,
      sourceDraws: source.sourceDraws,
      sourceSteps: source.sourceSteps,
      sourceStepMilliseconds: SOURCE_STEP_MS,
      patterns: preparedPatterns.map(({ id, seed, source: patternSource, trailLeaves: patternLeaves, timeline }) => ({
        id,
        seed,
        sourceDraws: patternSource.sourceDraws,
        sourceSteps: patternSource.sourceSteps,
        trailLeafCount: patternLeaves.length,
        preparedFrameCount: timeline.frameTimesMs.length,
        durationMs: timeline.durationMs,
      })),
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
      composition: "flat-2d-card-plane",
      contentBounds: [contentBounds.left, contentBounds.top, contentBounds.right, contentBounds.bottom],
      portraitPlayfield: [PORTRAIT_WIDTH, PORTRAIT_HEIGHT],
      responsiveProfiles: ["landscape", "portrait"],
      portraitMapping: "progressive-card-count-prepared-wall-reflection",
      portraitCardCounts: PORTRAIT_CARD_COUNTS,
      portraitCardBreakpoints: PORTRAIT_CARD_BREAKPOINTS,
      portraitHorizontalMotion: "prepared-reflected-wall-bounce",
      preparedPatternBankCount: preparedPatterns.length,
      runtimePatternSelectionOnly: true,
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
      foundationLeafCount: FOUNDATION_COUNT,
      retainedTrailLeafCount,
      preparedPatternCount: preparedPatterns.length,
      preparedFrameCount: playback.patterns.reduce((sum, pattern) => sum + pattern.frameTimesMs.length, 0),
      initialPatternDurationMs: playback.patterns[0].durationMs,
      minimumPatternDurationMs: Math.min(...playback.patterns.map(({ durationMs }) => durationMs)),
      maximumPatternDurationMs: Math.max(...playback.patterns.map(({ durationMs }) => durationMs)),
      preparedVisibilityOperationCount: playback.patterns.reduce((sum, pattern) =>
        sum + pattern.visibilityRows.reduce((patternSum, row) => patternSum + row.length, 0), 0),
      preparedFoundationOperationCount: playback.patterns.reduce((sum, pattern) =>
        sum + pattern.foundationRows.reduce((patternSum, row) => patternSum + row.length, 0), 0),
      preparedLeafLayoutCount: playback.patterns.reduce((sum, pattern) => sum + pattern.trailLeafCount, 0),
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

function buildContentBounds(snapshots) {
  const positions = [
    ...STARTING_CARDS.map(({ x }) => ({ x, y: FOUNDATION_Y })),
    ...snapshots,
  ];
  const left = Math.min(...positions.map(({ x }) => x));
  const top = Math.min(...positions.map(({ y }) => y));
  const right = Math.max(...positions.map(({ x }) => x + CARD_WIDTH));
  const bottom = Math.max(...positions.map(({ y }) => y + CARD_HEIGHT));
  return Object.freeze({
    left,
    top,
    right,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  });
}

function descriptor(path, bytes) {
  return Object.freeze({ path, byteLength: bytes.length, sha256: sha256(bytes) });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
