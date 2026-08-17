import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import sharp from "sharp";

import {
  generatedProductRoot,
  referencePath,
  sourceRoot,
} from "./paths.mjs";

const SOURCE_WIDTH = 585;
const SOURCE_HEIGHT = 384;
const LANDSCAPE_PLAYFIELD = Object.freeze([960, 540]);
const LANDSCAPE_PRESENTATION_SCALE = Math.min(
  LANDSCAPE_PLAYFIELD[0] / SOURCE_WIDTH,
  LANDSCAPE_PLAYFIELD[1] / SOURCE_HEIGHT,
);
const FOUNDATION_PRESENTATION_TOP = 80;
const ARCH_PRESENTATION_TOP = 8;
const SOURCE_ARCH_TOP = -71;
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
const CARD_ATLAS_PIXEL_SCALE = 2;
const CARD_BORDER_COLOR = Object.freeze([69, 72, 77]);
const CARD_RED_SOURCE = Object.freeze([255, 85, 85]);
const CARD_RED_COLOR = Object.freeze([230, 24, 10]);
const CARD_WIDTH = 71;
const CARD_HEIGHT = 96;
const LANDSCAPE_CARD_MAXIMUM_WIDTH = 200;
const FLOOR_Y = SOURCE_HEIGHT - CARD_HEIGHT;
const SOURCE_BOUNCE_BOTTOM = 299;
const FOUNDATION_Y = 4;
const SOLITAIRE_SLOT_COUNT = 7;
const MINIMUM_SLOT_GAP = Math.trunc(CARD_WIDTH / 8) + 3;
const STARTING_CARDS = Object.freeze([
  Object.freeze({ id: "king-of-spades", rank: 13, suit: 0, slot: 3, velocityY: -70 }),
  Object.freeze({ id: "queen-of-hearts", rank: 12, suit: 1, slot: 4, velocityY: -50 }),
  Object.freeze({ id: "jack-of-diamonds", rank: 11, suit: 2, slot: 5, velocityY: -30 }),
  Object.freeze({ id: "ace-of-clubs", rank: 1, suit: 3, slot: 6, velocityY: -10 }),
].map((card) => Object.freeze({
  ...card,
  x: solitaireSlotLeft(SOURCE_WIDTH, card.slot),
})));
const FOUNDATION_COUNT = STARTING_CARDS.length;
const PORTRAIT_PROFILES = Object.freeze([
  Object.freeze({ cardCount: 1, playfield: Object.freeze([384, 720]) }),
  Object.freeze({ cardCount: 2, playfield: Object.freeze([600, 900]) }),
  Object.freeze({ cardCount: 3, playfield: Object.freeze([800, 1_000]) }),
  Object.freeze({ cardCount: 4, playfield: Object.freeze([960, 1_200]) }),
]);
const PORTRAIT_CARD_COUNTS = Object.freeze(PORTRAIT_PROFILES.map(({ cardCount }) => cardCount));
const PORTRAIT_CARD_BREAKPOINTS = Object.freeze([520, 720, 920]);
const PORTRAIT_HORIZONTAL_DISTANCE_SCALE = 2;
const PHONE_HORIZONTAL_DISTANCE_SCALE = 8;
const PHONE_LAUNCH_CARD_COUNT = 3;
const PHONE_PLAYBACK_TIME_SCALE = 3;
const PHONE_PROFILE_INDEX = 1;
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
const HORIZONTAL_VELOCITY_BIAS_EXPONENT = 1.1;
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

function cardLayout({ xViewport, xCardWidthFactor, yViewport, yPixels, yCardHeightFactor }) {
  return Object.freeze([
    xViewport,
    xCardWidthFactor,
    yViewport,
    yPixels,
    yCardHeightFactor,
  ].map(rounded));
}

function cardMatrix(layout, viewportWidth, viewportHeight, presentationScale) {
  const [xViewport, xCardWidthFactor, yViewport, yPixels, yCardHeightFactor] = layout;
  const scaleX = CARD_HEIGHT / CARD_SOURCE_WIDTH * presentationScale;
  const scaleY = CARD_WIDTH / CARD_SOURCE_HEIGHT * presentationScale;
  const x = xViewport / 100 * viewportWidth + xCardWidthFactor * CARD_WIDTH * presentationScale;
  const y = yViewport / 100 * viewportHeight + yPixels +
    yCardHeightFactor * CARD_HEIGHT * presentationScale;
  return `matrix(0,${rounded(scaleX)},${rounded(-scaleY)},0,${rounded(x)},${rounded(y)})`;
}

function reflectBetween(value, minimum, maximum) {
  const range = maximum - minimum;
  const period = range * 2;
  const offset = ((value - minimum) % period + period) % period;
  return offset <= range ? minimum + offset : maximum - (offset - range);
}

function solitaireSlotGap(width, cardWidth = CARD_WIDTH) {
  return Math.max(
    (width - cardWidth * SOLITAIRE_SLOT_COUNT) / (SOLITAIRE_SLOT_COUNT + 1),
    Math.trunc(cardWidth / 8) + 3,
  );
}

function solitaireSlotLeft(width, slot, cardWidth = CARD_WIDTH) {
  const gap = solitaireSlotGap(width, cardWidth);
  return gap + slot * (cardWidth + gap);
}

function verticalCardPosition(top) {
  const archWeight = (top - FOUNDATION_Y) * (top - SOURCE_BOUNCE_BOTTOM) /
    ((SOURCE_ARCH_TOP - FOUNDATION_Y) * (SOURCE_ARCH_TOP - SOURCE_BOUNCE_BOTTOM));
  const foundationWeight = (top - SOURCE_ARCH_TOP) * (top - SOURCE_BOUNCE_BOTTOM) /
    ((FOUNDATION_Y - SOURCE_ARCH_TOP) * (FOUNDATION_Y - SOURCE_BOUNCE_BOTTOM));
  const floorWeight = (top - SOURCE_ARCH_TOP) * (top - FOUNDATION_Y) /
    ((SOURCE_BOUNCE_BOTTOM - SOURCE_ARCH_TOP) * (SOURCE_BOUNCE_BOTTOM - FOUNDATION_Y));
  return Object.freeze({
    yViewport: floorWeight * 100,
    yPixels: archWeight * ARCH_PRESENTATION_TOP +
      foundationWeight * FOUNDATION_PRESENTATION_TOP,
    yCardHeightFactor: -floorWeight,
  });
}

function landscapeCardPosition(left, top, foundationIndex, horizontalDirection) {
  const sourceStartLeft = STARTING_CARDS[foundationIndex].x;
  const slot = STARTING_CARDS[foundationIndex].slot;
  const slotFraction = (slot + 1) / (SOLITAIRE_SLOT_COUNT + 1);
  const horizontalPosition = horizontalDirection > 0
    ? slotFraction + (1 - slotFraction) * (left - sourceStartLeft) / (SOURCE_WIDTH - sourceStartLeft)
    : slotFraction * (1 - (sourceStartLeft - left) / (sourceStartLeft + CARD_WIDTH));
  return Object.freeze({
    xViewport: horizontalPosition * 100,
    xCardWidthFactor: horizontalPosition,
    ...verticalCardPosition(top),
  });
}

function portraitCardPosition(left, top, foundationIndex, horizontalDirection, profile) {
  const [width, height] = profile.playfield;
  const presentationScale = Math.min(width / 384, height / 720);
  const cardWidth = CARD_WIDTH * presentationScale;
  const displayFoundationIndex = foundationIndex % profile.cardCount;
  const startLeft = profile.cardCount === 1
    ? (width - cardWidth) / 2
    : solitaireSlotLeft(width, STARTING_CARDS[displayFoundationIndex].slot, cardWidth);
  const sourceStartLeft = STARTING_CARDS[foundationIndex].x;
  const horizontalDistanceScale = profile.cardCount === 1
    ? PHONE_HORIZONTAL_DISTANCE_SCALE
    : PORTRAIT_HORIZONTAL_DISTANCE_SCALE;
  const unboundedLeft = startLeft +
    (left - sourceStartLeft) * horizontalDistanceScale * presentationScale;
  const vertical = verticalCardPosition(top);
  if (profile.cardCount > 1) {
    const startProgress = startLeft / (width - cardWidth);
    if (horizontalDirection > 0) {
      const progress = (left - sourceStartLeft) / (SOURCE_WIDTH - sourceStartLeft);
      return Object.freeze({
        xViewport: (startProgress + (1 - startProgress) * progress) * 100,
        xCardWidthFactor: 1 - startProgress + startProgress * progress,
        ...vertical,
      });
    }
    const remainingHorizontalProgress = 1 - (sourceStartLeft - left) / (sourceStartLeft + CARD_WIDTH);
    return Object.freeze({
      xViewport: startProgress * remainingHorizontalProgress * 100,
      xCardWidthFactor: (1 - startProgress) * remainingHorizontalProgress,
      ...vertical,
    });
  }
  const reflectedLeft = reflectBetween(unboundedLeft, 0, width - cardWidth);
  const horizontalProgress = reflectedLeft / (width - cardWidth);
  return Object.freeze({
    xViewport: horizontalProgress * 100,
    xCardWidthFactor: 1 - horizontalProgress,
    ...vertical,
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

async function prepareCardAtlas(cardBytes) {
  const { data, info } = await sharp(cardBytes).raw().toBuffer({ resolveWithObject: true });
  const cellWidth = CARD_SOURCE_WIDTH * CARD_ATLAS_PIXEL_SCALE;
  const cellHeight = CARD_SOURCE_HEIGHT * CARD_ATLAS_PIXEL_SCALE;
  if (info.width !== CARD_ATLAS_WIDTH * CARD_ATLAS_PIXEL_SCALE ||
      info.height !== CARD_ATLAS_HEIGHT * CARD_ATLAS_PIXEL_SCALE || info.channels < 3) {
    throw new Error("cssSolitaire CC0 card atlas dimensions drifted");
  }
  let recoloredRedPixelCount = 0;
  const redChannelDeltas = CARD_RED_SOURCE.map((sourceChannel, index) =>
    sourceChannel - CARD_RED_COLOR[index]);
  for (let pixelIndex = 0; pixelIndex < data.length; pixelIndex += info.channels) {
    const red = data[pixelIndex];
    const green = data[pixelIndex + 1];
    const blue = data[pixelIndex + 2];
    const chroma = red - Math.max(green, blue);
    if (red <= 120 || chroma <= 24 || Math.abs(green - blue) > 32) continue;
    const strength = Math.min(1, chroma / (CARD_RED_SOURCE[0] - CARD_RED_SOURCE[1]));
    data[pixelIndex] = Math.round(red - redChannelDeltas[0] * strength);
    data[pixelIndex + 1] = Math.round(green - redChannelDeltas[1] * strength);
    data[pixelIndex + 2] = Math.round(blue - redChannelDeltas[2] * strength);
    recoloredRedPixelCount += 1;
  }
  let recoloredBorderPixelCount = 0;
  for (let row = 0; row < 13; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const visited = new Uint8Array(cellWidth * cellHeight);
      const queue = new Int32Array(cellWidth * cellHeight);
      let head = 0;
      let tail = 0;
      const enqueue = (x, y) => {
        const localIndex = y * cellWidth + x;
        if (visited[localIndex]) return;
        const pixelIndex = ((row * cellHeight + y) * info.width + column * cellWidth + x) * info.channels;
        if (data[pixelIndex] > 8 || data[pixelIndex + 1] > 8 || data[pixelIndex + 2] > 8) return;
        visited[localIndex] = 1;
        queue[tail] = localIndex;
        tail += 1;
      };
      for (let x = 0; x < cellWidth; x += 1) {
        enqueue(x, 0);
        enqueue(x, cellHeight - 1);
      }
      for (let y = 1; y < cellHeight - 1; y += 1) {
        enqueue(0, y);
        enqueue(cellWidth - 1, y);
      }
      while (head < tail) {
        const localIndex = queue[head];
        head += 1;
        const x = localIndex % cellWidth;
        const y = Math.floor(localIndex / cellWidth);
        const pixelIndex = ((row * cellHeight + y) * info.width + column * cellWidth + x) * info.channels;
        data[pixelIndex] = CARD_BORDER_COLOR[0];
        data[pixelIndex + 1] = CARD_BORDER_COLOR[1];
        data[pixelIndex + 2] = CARD_BORDER_COLOR[2];
        recoloredBorderPixelCount += 1;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const nextX = x + offsetX;
            const nextY = y + offsetY;
            if ((offsetX !== 0 || offsetY !== 0) && nextX >= 0 && nextX < cellWidth &&
                nextY >= 0 && nextY < cellHeight) enqueue(nextX, nextY);
          }
        }
      }
    }
  }
  const bytes = await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer();
  return Object.freeze({ bytes, recoloredBorderPixelCount, recoloredRedPixelCount });
}

function msvcRandom(initialState) {
  let state = initialState >>> 0;
  return () => {
    state = (Math.imul(state, 214013) + 2531011) >>> 0;
    return (state >>> 16) & 0x7fff;
  };
}

function snapshotId(index) {
  return `trail-${String(index).padStart(5, "0")}`;
}

function biasedHorizontalVelocity(randomValue, allowRightward) {
  const normalized = (randomValue % 46) / 45;
  const magnitude = 20 + Math.round(45 * normalized ** HORIZONTAL_VELOCITY_BIAS_EXPONENT);
  return allowRightward && randomValue % 4 === 0 ? magnitude : -magnitude;
}

function nearestUnusedVelocity(velocity, usedVelocities) {
  if (!usedVelocities.has(velocity)) return velocity;
  const direction = Math.sign(velocity);
  for (let delta = 1; delta <= 45; delta += 1) {
    for (const candidate of [velocity - direction * delta, velocity + direction * delta]) {
      if (Math.abs(candidate) >= 20 && Math.abs(candidate) <= 65 && !usedVelocities.has(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error("Unable to prepare a unique same-lane Solitaire trajectory");
}

function simulateSource(seed) {
  const random = msvcRandom(seed);
  const snapshots = [];
  const cards = [];
  const laneVelocities = Array.from({ length: FOUNDATION_COUNT }, () => new Set());
  let sourceStep = 0;
  let sourceDraws = 0;
  for (const startingCard of LAUNCH_CARDS) {
    const startStep = sourceStep;
    const usedVelocities = laneVelocities[startingCard.foundationIndex];
    const velocityX = nearestUnusedVelocity(
      biasedHorizontalVelocity(random(), startingCard.foundationIndex < 2),
      usedVelocities,
    );
    usedVelocities.add(velocityX);
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
          horizontalDirection: Math.sign(velocityX),
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

function cardLeaf({ cardFace, foundationIndex, horizontalDirection, left, top }) {
  const landscapeLayout = cardLayout(
    landscapeCardPosition(left, top, foundationIndex, horizontalDirection),
  );
  const portraitLayouts = PORTRAIT_PROFILES.map((profile) => {
    const portrait = portraitCardPosition(left, top, foundationIndex, horizontalDirection, profile);
    return portrait ? cardLayout(portrait) : null;
  });
  return Object.freeze({
    foundationIndex,
    matrix: cardMatrix(
      landscapeLayout,
      LANDSCAPE_PLAYFIELD[0],
      LANDSCAPE_PLAYFIELD[1],
      LANDSCAPE_PRESENTATION_SCALE,
    ),
    layout: landscapeLayout,
    portraitLayouts: Object.freeze(portraitLayouts),
    atlas: atlasPosition(cardFace),
  });
}

function buildPatternPlayback(snapshots, cards, sourceStepCount, timeScale = 1) {
  const frameTimesMs = [0];
  const visibilityRows = [snapshots.map((_, index) => -(index + FOUNDATION_COUNT + 1))];
  const foundationRows = [[]];
  const reverseFoundationRows = [[]];
  let snapshotIndex = 0;
  let cardIndex = 0;
  const playbackTime = (timeMs) => INITIAL_HOLD_MS + (timeMs - INITIAL_HOLD_MS) * timeScale;
  const lastRevealTimeMs = playbackTime(snapshots.at(-1)?.timeMs ?? INITIAL_HOLD_MS);
  const frameInterval = 1_000 / PLAYBACK_FPS;
  const revealFrameCount = Math.ceil(lastRevealTimeMs / frameInterval);
  for (let frameIndex = 1; frameIndex <= revealFrameCount; frameIndex += 1) {
    const timeMs = Math.round(frameIndex * frameInterval);
    const row = [];
    const foundationRow = [];
    const reverseFoundationRow = [];
    while (snapshotIndex < snapshots.length && playbackTime(snapshots[snapshotIndex].timeMs) <= timeMs) {
      row.push(snapshotIndex + FOUNDATION_COUNT + 1);
      snapshotIndex += 1;
    }
    while (cardIndex < cards.length && playbackTime(cards[cardIndex].timeMs) <= timeMs) {
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
    sourceStepMilliseconds: SOURCE_STEP_MS * timeScale,
    sourceStepCount,
    launchCardCount: cards.length,
    trailLeafCount: snapshots.length,
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
    horizontalDirection: snapshot.horizontalDirection,
    left: snapshot.x,
    top: snapshot.y,
  }));
  const timeline = buildPatternPlayback(source.snapshots, source.cards, source.sourceSteps);
  const phoneCards = source.cards.slice(0, PHONE_LAUNCH_CARD_COUNT);
  const phoneTrailLeafCount = phoneCards.reduce((sum, card) => sum + card.retainedSnapshots, 0);
  const phoneSnapshots = source.snapshots.slice(0, phoneTrailLeafCount);
  const phoneSourceStepCount = phoneSnapshots.at(-1).sourceStep + 1;
  const phoneTimeline = buildPatternPlayback(
    phoneSnapshots,
    phoneCards,
    phoneSourceStepCount,
    PHONE_PLAYBACK_TIME_SCALE,
  );
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
      launchCardCount: source.cards.length,
      sourceDrawCount: source.sourceDraws,
      sourceStepCount: source.sourceSteps,
      sourceStepMilliseconds: SOURCE_STEP_MS,
      horizontalVelocities: source.cards.map(({ velocityX }) => velocityX),
      durationMs: timeline.durationMs,
      rewindStartMilliseconds: timeline.rewindStartMilliseconds,
      rewindEndMilliseconds: timeline.rewindEndMilliseconds,
      frameTimesMs: timeline.frameTimesMs,
      visibilityRows: timeline.visibilityRows,
      foundationRows: timeline.foundationRows,
      phoneTimeline,
      leafLayouts: trailLeaves.map(({ layout }) => layout),
      leafPortraitLayoutsByCardCount: PORTRAIT_CARD_COUNTS.map((_, profileIndex) =>
        trailLeaves.map(({ portraitLayouts }) => {
          const portraitLayout = portraitLayouts[profileIndex];
          return portraitLayout;
        })),
      leafAtlasIndices: source.snapshots.map(({ faceNumber: cardFace }) => cardFace - 1),
    }),
  });
}

function buildSnapshot(leaves, cardAssetUrl) {
  const cardNodes = leaves.map((leaf, index) => {
    const declarations = [
      `transform:${leaf.matrix}`,
      `background-position:${-leaf.atlas.x}px ${-leaf.atlas.y}px`,
    ];
    if (index < FOUNDATION_COUNT) declarations.push("visibility:visible");
    return `<b style="${declarations.join(";")}"></b>`;
  }).join("");
  const css = [
    ".polycss-camera{position:relative;display:block;width:100%;height:100%;overflow:hidden}",
    ".polycss-scene{position:absolute;inset:0}",
    `.polycss-scene>b{position:absolute;display:block;width:${CARD_SOURCE_WIDTH}px;height:${CARD_SOURCE_HEIGHT}px;margin:0;padding:0;overflow:hidden;border:0;border-radius:14px;background-image:url('${cardAssetUrl}');background-repeat:no-repeat;background-size:${CARD_ATLAS_WIDTH}px ${CARD_ATLAS_HEIGHT}px;transform-origin:0 0;visibility:hidden;pointer-events:none;text-decoration:none;font:normal normal normal 0/0 serif;image-rendering:auto}`,
    `@media (orientation:portrait) and (max-width:${PORTRAIT_CARD_BREAKPOINTS[0] - 1}px){.polycss-scene>b:nth-child(2),.polycss-scene>b:nth-child(3),.polycss-scene>b:nth-child(4){display:none}}`,
    `@media (orientation:portrait) and (min-width:${PORTRAIT_CARD_BREAKPOINTS[0]}px) and (max-width:${PORTRAIT_CARD_BREAKPOINTS[1] - 1}px){.polycss-scene>b:nth-child(3),.polycss-scene>b:nth-child(4){display:none}}`,
    `@media (orientation:portrait) and (min-width:${PORTRAIT_CARD_BREAKPOINTS[1]}px) and (max-width:${PORTRAIT_CARD_BREAKPOINTS[2] - 1}px){.polycss-scene>b:nth-child(4){display:none}}`,
  ].join("");
  return `<!doctype html><html><head><style>${css}</style></head><body><div class="polycss-camera"><div class="polycss-scene">${cardNodes}</div></div></body></html>\n`;
}

export async function prepareCsssolitaire({ outputRoot = generatedProductRoot() } = {}) {
  const [cardBytes, referenceBytes] = await Promise.all([
    readFile(join(sourceRoot, CARD_SOURCE_FILE)),
    readFile(referencePath),
  ]);
  const sourceCardSha256 = sha256(cardBytes);
  if (sourceCardSha256 !== EXPECTED_CARD_SHA256) throw new Error("cssSolitaire CC0 card atlas identity mismatch");
  const preparedCardAtlas = await prepareCardAtlas(cardBytes);
  const cardSha256 = sha256(preparedCardAtlas.bytes);

  const preparedPatterns = PREPARED_PATTERN_SEEDS.map((seed, index) => buildPreparedPattern(seed, index));
  const initialPattern = preparedPatterns[0];
  const source = initialPattern.source;
  const contentBounds = initialPattern.contentBounds;
  const retainedTrailLeafCount = Math.max(...preparedPatterns.map(({ trailLeaves }) => trailLeaves.length));
  const foundationLeaves = STARTING_CARDS.map((card, foundationIndex) => cardLeaf({
    cardFace: faceNumber(card.rank, card.suit),
    foundationIndex,
    horizontalDirection: -1,
    left: card.x,
    top: FOUNDATION_Y,
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
    phoneProfileIndex: PHONE_PROFILE_INDEX,
    sourceStepMilliseconds: SOURCE_STEP_MS,
    initialHoldMilliseconds: INITIAL_HOLD_MS,
    foundationLeafCount: FOUNDATION_COUNT,
    retainedLeafCount: leaves.length,
    retainedTrailLeafCount,
    layoutComponentOrder: [
      "xViewportPercent",
      "xCardWidthFactor",
      "yViewportPercent",
      "yPixels",
      "yCardHeightFactor",
    ],
    foundationLayouts: foundationLeaves.map(({ layout }) => layout),
    foundationPortraitLayoutsByCardCount: PORTRAIT_CARD_COUNTS.map((_, profileIndex) =>
      foundationLeaves.map(({ portraitLayouts }) => portraitLayouts[profileIndex])),
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
      horizontalVelocityRange: [-65, 65],
      minimumHorizontalSpeed: 20,
      horizontalVelocityDistribution: "mild-slow-bias-first-two-lanes-quarter-right-unique-per-lane-cycle",
      horizontalVelocityBiasExponent: HORIZONTAL_VELOCITY_BIAS_EXPONENT,
      rightwardFoundationIndices: [0, 1],
      rightwardSelection: "random-value-modulo-4-zero",
      exactSameLaneTrajectoryRepeats: false,
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
        rightwardLaunchCount: patternSource.cards.filter(({ velocityX }) => velocityX > 0).length,
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
      leafTag: "b",
      textureBackend: "atlas",
      textureLeafSizing: "raster",
      textureImageRendering: "auto",
      composition: "flat-2d-card-plane",
      transformPublication: "prepared-inline-style",
      contentBounds: [contentBounds.left, contentBounds.top, contentBounds.right, contentBounds.bottom],
      responsiveProfiles: ["landscape", "portrait"],
      viewportPositioning: "prepared-layout-resolved-inline-matrix-no-letterbox",
      viewportFill: true,
      verticalMapping: "foundation-and-retained-bounce-bottom-anchored",
      foundationTopCssPixels: FOUNDATION_PRESENTATION_TOP,
      archTopCssPixels: ARCH_PRESENTATION_TOP,
      sourceVerticalAnchors: [SOURCE_ARCH_TOP, FOUNDATION_Y, SOURCE_BOUNCE_BOTTOM],
      upwardArchMapping: "prepared-source-smooth-three-anchor-curve",
      cardSourceSize: [CARD_WIDTH, CARD_HEIGHT],
      cardPrimitiveSize: [CARD_SOURCE_WIDTH, CARD_SOURCE_HEIGHT],
      landscapePresentationBase: LANDSCAPE_PLAYFIELD,
      landscapePresentationBaseScale: LANDSCAPE_PRESENTATION_SCALE,
      landscapeCardMaximumWidthCssPixels: LANDSCAPE_CARD_MAXIMUM_WIDTH,
      portraitPresentationBase: PORTRAIT_PROFILES[0].playfield,
      portraitMapping: "progressive-card-count-prepared-source-lane-folding",
      portraitReflectionReferenceWidths: PORTRAIT_PROFILES.map(({ playfield }) => playfield[0]),
      portraitCardCounts: PORTRAIT_CARD_COUNTS,
      portraitCardBreakpoints: PORTRAIT_CARD_BREAKPOINTS,
      portraitHorizontalMotion: "phone-reflected-three-card-cycle-wider-multi-card-exit",
      portraitWallBounceCardCounts: [1],
      phoneLaunchCardCount: PHONE_LAUNCH_CARD_COUNT,
      phonePlaybackTimeScale: PHONE_PLAYBACK_TIME_SCALE,
      phoneHorizontalDistanceScale: PHONE_HORIZONTAL_DISTANCE_SCALE,
      phoneProfileIndex: PHONE_PROFILE_INDEX,
      preparedSlotLayout: "source-seven-slot-presentation-scaled-card-size",
      slotCount: SOLITAIRE_SLOT_COUNT,
      minimumSlotGap: MINIMUM_SLOT_GAP,
      presentationScaleMode: "single-root-contain-scale-viewport-positioned",
      preparedPatternBankCount: preparedPatterns.length,
      runtimePatternSelectionOnly: true,
      seamBleed: 0.2,
      runtimeCanvasCount: 0,
      runtimeAtlasRasterization: false,
      runtimeGeometryCalculation: false,
      runtimeTrajectoryCalculation: false,
      runtimeResizeCalculation: "prepared-layout-inline-matrix-resolution",
      runtimeDomGrowth: false,
    },
    transport: {
      snapshotUrl: "/csssolitaire/solitaire.polycss.txt",
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
      preparedPhoneFrameCount: playback.patterns.reduce(
        (sum, pattern) => sum + pattern.phoneTimeline.frameTimesMs.length,
        0,
      ),
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
        sourceSha256: sourceCardSha256,
        sha256: cardSha256,
        borderColor: "#45484d",
        borderPixelsRecolored: preparedCardAtlas.recoloredBorderPixelCount,
        redColor: "#e6180a",
        redPixelsRecolored: preparedCardAtlas.recoloredRedPixelCount,
        redPaletteReference: "https://github.com/htdebeer/SVG-cards",
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
      writeFile(join(stagingRoot, "assets", cardAssetName), preparedCardAtlas.bytes),
      writeFile(join(stagingRoot, "solitaire.polycss.txt"), snapshotText),
      writeFile(join(stagingRoot, "solitaire-playback.json"), playbackText),
    ]);
    manifest.assets = {
      snapshot: descriptor("solitaire.polycss.txt", Buffer.from(snapshotText)),
      playback: descriptor("solitaire-playback.json", Buffer.from(playbackText)),
      cardAtlas: descriptor(`assets/${cardAssetName}`, preparedCardAtlas.bytes),
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
