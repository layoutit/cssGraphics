#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createGunzip } from "node:zlib";

const tracePath = resolve(process.argv[2] ?? "");
const browserSummaryPath = resolve(process.argv[3] ?? "");
const outputPath = resolve(process.argv[4] ?? "csscloth-cadence-trace-analysis.json");
if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: analyze-csscloth-cadence-trace.mjs <Trace.json.gz> <browser-cadence.json> [output]");
}

const threadNames = new Map();
const marks = new Map();
const tasks = [];
const work = [];
const keptWork = new Set([
  "FireAnimationFrame",
  "FunctionCall",
  "RunMicrotasks",
  "UpdateLayoutTree",
  "Layout",
  "PrePaint",
  "Paint",
  "Commit",
  "MajorGC",
  "MinorGC",
  "V8.GCFinalizeMC",
  "V8.GCScavenger",
]);

await streamTraceEvents(tracePath, (event) => {
  if (event?.ph === "M" && event.name === "thread_name") {
    threadNames.set(`${event.pid}:${event.tid}`, event.args?.name ?? event.args?.data?.name ?? "");
    return;
  }
  if (typeof event?.name === "string" && event.name.startsWith("csscloth-") &&
      Number.isFinite(event.ts)) {
    const timestamps = marks.get(event.name) ?? [];
    timestamps.push(event.ts);
    marks.set(event.name, timestamps);
  }
  if (event?.ph !== "X" || !Number.isFinite(event.ts) || !Number.isFinite(event.dur)) return;
  const record = {
    name: event.name,
    pid: event.pid,
    tid: event.tid,
    startMicroseconds: event.ts,
    durationMilliseconds: event.dur / 1_000,
  };
  if (event.dur >= 1_000) tasks.push(record);
  if (keptWork.has(event.name) && event.dur >= 100) work.push(record);
});

const rendererMainKeys = [...threadNames.entries()]
  .filter(([, name]) => name === "CrRendererMain")
  .map(([key]) => key);
const handoffTimestamps = uniqueSorted(marks.get("csscloth-bank-handoff") ?? []);
const captureStarts = uniqueSorted(marks.get("csscloth-cadence-capture-start") ?? []);
const captureEnds = uniqueSorted(marks.get("csscloth-cadence-capture-end") ?? []);
const captureStart = captureStarts[0] ?? -Infinity;
const captureEnd = captureEnds.at(-1) ?? Infinity;
const mainEvents = tasks.filter((task) =>
  rendererMainKeys.includes(`${task.pid}:${task.tid}`) &&
  task.startMicroseconds >= captureStart - 250_000 &&
  task.startMicroseconds <= captureEnd + 250_000);
const mainTasks = mainEvents.filter((event) => /(?:^|::)RunTask$/u.test(event.name));
const mainWork = work.filter((event) => rendererMainKeys.includes(`${event.pid}:${event.tid}`));
const browserSummary = JSON.parse(await readFile(browserSummaryPath, "utf8"));
const handoffs = handoffTimestamps.map((timestamp, index) => {
  const nearTasks = mainTasks.filter((task) => overlapsWindow(task, timestamp, 250));
  const nearWork = mainWork.filter((event) => overlapsWindow(event, timestamp, 33));
  return {
    index,
    traceTimestampMicroseconds: timestamp,
    browserCadence: browserSummary.handoffs[index]?.cadence ?? null,
    maximumMainThreadTaskMilliseconds: maximumDuration(nearTasks),
    mainThreadTasksAbove20Milliseconds: nearTasks.filter((task) =>
      task.durationMilliseconds > 20),
    mainThreadWork: nearWork
      .sort((left, right) => right.durationMilliseconds - left.durationMilliseconds)
      .slice(0, 12),
  };
});
const analysis = {
  schema: "csscloth-cadence-trace-analysis@1",
  tracePath,
  browserSummaryPath,
  rendererMainThreads: rendererMainKeys.map((key) => ({ key, name: threadNames.get(key) })),
  capture: { startMicroseconds: captureStart, endMicroseconds: captureEnd },
  cadence: browserSummary.cadence,
  handoffs,
  maximumMainThreadTaskMilliseconds: maximumDuration(mainTasks),
  mainThreadTasksAbove20Milliseconds: mainTasks
    .filter((task) => task.durationMilliseconds > 20)
    .sort((left, right) => right.durationMilliseconds - left.durationMilliseconds),
  longestMainThreadEvents: mainEvents
    .sort((left, right) => right.durationMilliseconds - left.durationMilliseconds)
    .slice(0, 20),
  retainedLeafCount: browserSummary.stats?.retainedLeafCount ?? null,
  retainedDomStable: browserSummary.stats?.retainedDomStable ?? null,
  bankHandoffCount: browserSummary.stats?.bankHandoffCount ?? null,
  bankBoundaryWaitCount: browserSummary.stats?.bankBoundaryWaitCount ?? null,
  errors: browserSummary.errors,
};
await writeFile(outputPath, `${JSON.stringify(analysis, null, 2)}\n`);
console.log(JSON.stringify(analysis, null, 2));

function maximumDuration(events) {
  return Number(Math.max(0, ...events.map((event) => event.durationMilliseconds)).toFixed(3));
}

function overlapsWindow(event, timestamp, radiusMilliseconds) {
  const radiusMicroseconds = radiusMilliseconds * 1_000;
  const end = event.startMicroseconds + event.durationMilliseconds * 1_000;
  return event.startMicroseconds <= timestamp + radiusMicroseconds &&
    end >= timestamp - radiusMicroseconds;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}

async function streamTraceEvents(path, onEvent) {
  const input = createReadStream(path).pipe(createGunzip());
  let prefix = "";
  let inEvents = false;
  let object = "";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for await (const chunk of input) {
    const text = chunk.toString("utf8");
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (!inEvents) {
        prefix = `${prefix}${character}`.slice(-32);
        if (prefix.endsWith('"traceEvents":[')) inEvents = true;
        continue;
      }
      if (depth === 0) {
        if (character === "{") {
          object = character;
          depth = 1;
        } else if (character === "]") {
          return;
        }
        continue;
      }
      object += character;
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          onEvent(JSON.parse(object));
          object = "";
        }
      }
    }
  }
  throw new Error("Chrome trace ended before traceEvents closed");
}
