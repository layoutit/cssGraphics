#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
import {
  CSSFLOCKS_PRODUCT_PROFILES,
  CSSFLOCKS_SOURCE_BANK,
  buildFlocksSourceBlocks,
} from "../src/prepare/cssflocks/sourceModel.mjs";
import { buildFlocksTerminalCorrespondence } from "../src/prepare/cssflocks/terminalSeam.mjs";

const streamSeconds = Number.parseInt(process.env.CSSFLOCKS_SEAM_SECONDS ?? "216", 10);
if (!Number.isSafeInteger(streamSeconds) || streamSeconds < 216) throw new RangeError("CSSFLOCKS_SEAM_SECONDS must be at least 216");
const bank = Object.freeze({
  ...CSSFLOCKS_SOURCE_BANK,
  frameCount: streamSeconds * CSSFLOCKS_SOURCE_BANK.framesPerSecond,
});
let firstFrame = null;
let lastFrame = null;
for (const block of buildFlocksSourceBlocks({ bank })) {
  firstFrame ??= block.frames[0];
  lastFrame = block.frames.at(-1);
  if (block.bank.blockIndex % 30 === 0) process.stderr.write(`source block ${block.bank.blockIndex + 1}/${block.bank.blockCount}\n`);
}
const profiles = {};
for (const profile of Object.values(CSSFLOCKS_PRODUCT_PROFILES)) {
  const firstBugs = firstFrame.bugs.slice(0, profile.bugCount);
  const lastBugs = lastFrame.bugs.slice(0, profile.bugCount);
  profiles[profile.id] = buildFlocksTerminalCorrespondence(lastBugs, firstBugs,
    profile.id === "desktop" ? [1280, 800] : [390, 844], profile.leaderCount);
}
console.log(JSON.stringify({
  schema: "cssflocks-terminal-seam-analysis@1",
  bank: { warmupFrames: bank.warmupFrames, frameCount: bank.frameCount, streamSeconds },
  profiles,
}, null, 2));
