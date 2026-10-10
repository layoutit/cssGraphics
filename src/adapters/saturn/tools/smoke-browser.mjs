import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "playwright";

const repositoryRoot = resolve(import.meta.dirname, "..", "..", "..", "..");
const port = await freePort();
const route = `http://127.0.0.1:${port}/`;
let output = "";
const server = spawn(process.execPath, [
  resolve(repositoryRoot, "node_modules/vite/bin/vite.js"),
  "--config", "src/adapters/saturn/vite.config.mjs",
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  await waitForServer(server, () => output.includes("Local:"));
  for (const viewport of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => errors.push(`failed ${request.url()}`));
    await page.route("**/favicon.ico", (request) => request.fulfill({ status: 204 }));
    await page.goto(route, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__cssSaturnDebug?.ready === true);
    const before = await page.evaluate(() => globalThis.__cssSaturnDebug.stats());
    const scene = () => page.evaluate(() => {
      const zoom = document.querySelector(".csssaturn-stage .zoom");
      const timed = document.getAnimations().filter(({ timeline }) => timeline === document.timeline);
      return {
        opening: zoom.firstElementChild.offsetTop,
        scrollTop: zoom.scrollTop,
        cameraScale: getComputedStyle(document.querySelector(".csssaturn-stage main")).scale,
        running: timed.filter(({ playState }) => playState === "running").length,
        paused: timed.filter(({ playState }) => playState === "paused").length,
      };
    });
    const opened = await scene();
    await page.evaluate(() => { document.querySelector(".csssaturn-stage .zoom").scrollTop = 0; });
    await page.waitForTimeout(200);
    const zoomedIn = await scene();
    await page.evaluate(() => globalThis.__cssSaturnDebug.pause());
    const held = await scene();
    await page.evaluate(() => globalThis.__cssSaturnDebug.resume());
    const resumed = await scene();
    const after = await page.evaluate(() => globalThis.__cssSaturnDebug.stats());
    const failed = Object.entries({
      "page errors": errors.length > 0,
      "globe face count": before.retainedGlobeFaceCount !== 448,
      "moon count": before.retainedMoonCount !== 5,
      "scroll surface did not open on its marker": opened.opening !== 1200 || opened.scrollTop !== 1200,
      "opening view is zoomed": opened.cameraScale !== "1" && opened.cameraScale !== "none",
      "scroll did not zoom": zoomedIn.cameraScale !== "2.2506",
      "animations not running": opened.running !== 19 || opened.paused !== 0,
      "pause did not hold the animations": held.running !== 0 || held.paused !== 19,
      "resume did not restart the animations": resumed.running !== 19,
      "retained DOM changed": after.runtimeDomGrowth || after.runtimeFrameConstruction ||
        after.retainedElementCount !== before.retainedElementCount,
    }).filter(([, bad]) => bad).map(([name]) => name);
    if (failed.length > 0) {
      throw new Error(`Saturn ${viewport.name} smoke failed: ${failed.join(", ")}\n${JSON.stringify({ opened, zoomedIn, held, resumed })}\n${errors.join("\n")}`);
    }
    await page.close();
  }
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    browser: { name: "Google Chrome", version: browser.version(), channel: "chrome" },
    route,
    viewports: ["1280x800", "390x844"],
    retainedGlobeFaceCount: 448,
    retainedMoonCount: 5,
    timedAnimationCount: 19,
    zoomAndPauseObserved: true,
  }, null, 2)}\n`);
} finally {
  await browser.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolveExit) => server.once("exit", resolveExit));
  }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const socket = createNetServer();
    socket.unref();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      socket.close(() => resolvePort(address.port));
    });
  });
}

async function waitForServer(process, ready) {
  const started = Date.now();
  while (!ready()) {
    if (process.exitCode !== null) throw new Error(`Saturn server exited early:\n${output}`);
    if (Date.now() - started > 20_000) throw new Error(`Saturn server did not start:\n${output}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}
