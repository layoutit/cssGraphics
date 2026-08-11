#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildMengerPreparedGeometry } from "../../src/prepare/cssmenger/mengerGeometry.mjs";
import { prepareMengerSourceProjectedFrame } from "../../src/prepare/cssmenger/sourceProjectedFrame.mjs";
import { buildPreparedMengerPlayback } from "../../src/prepare/cssmenger/sourcePlayback.mjs";

const outputDir = resolve(process.argv[2] ?? ".local/cssmenger/source-projected-diagnostic");
const ticks = (process.env.CSSMENGER_ORACLE_TICKS ?? "0,1,5,20,45")
  .split(",")
  .map((value) => Number(value.trim()));
const playback = buildPreparedMengerPlayback({ stateCount: Math.max(...ticks) + 1 });
const initialColorRow = playback.colorRows[0];
const geometry = buildMengerPreparedGeometry({
  depth: 3,
  axisColors: initialColorRow.map((index) => playback.palette[index].material),
});
await mkdir(outputDir, { recursive: true });
for (let index = 0; index < ticks.length; index += 1) {
  const frame = await prepareMengerSourceProjectedFrame({ geometry, playback, stateIndex: ticks[index] });
  await writeFile(`${outputDir}/frame_${String(index).padStart(4, "0")}.png`, frame.pngBytes);
  console.log(JSON.stringify({
    index,
    tick: ticks[index],
    bounds: frame.bounds,
    candidateFragmentCount: frame.candidateFragmentCount,
    depthAcceptedFragmentCount: frame.depthAcceptedFragmentCount,
  }));
}
