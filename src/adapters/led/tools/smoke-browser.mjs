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
  "--config", "src/adapters/led/vite.config.mjs",
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
    await page.route("**/favicon.ico", (request) => request.fulfill({ status: 204 }));
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => globalThis.__cssLedDebug?.ready === true);
    const before = await page.evaluate(() => globalThis.__cssLedDebug.stats());
    await page.waitForTimeout(9_450);
    const after = await page.evaluate(() => globalThis.__cssLedDebug.stats());
    await page.evaluate(() => globalThis.__cssLedDebug.seek(4_700));
    const darkLedCount = await page.locator(".cssled-cell.is-active > b").evaluateAll(
      (leds) => leds.filter((led) =>
        getComputedStyle(led, "::before").visibility === "visible").length,
    );
    if (errors.length > 0 || before.retainedLedCount !== 243 ||
        before.retainedFaceCount !== 3 || before.retainedRoomLightCount !== 36 ||
        before.handoffDarkMilliseconds !== 400 || darkLedCount !== 0 ||
        after.loopCount < 1 || after.runtimeDomGrowth || after.runtimeFrameConstruction) {
      throw new Error(`LED ${viewport.name} smoke failed: ${errors.join("\n")}`);
    }
    const liveCount = await page.locator(".cssled-cell").count();
    if (liveCount !== before.retainedLedCount) {
      throw new Error(`LED ${viewport.name} retained DOM changed`);
    }
    await page.close();
  }
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    browser: { name: "Google Chrome", version: browser.version(), channel: "chrome" },
    route,
    viewports: ["1280x800", "390x844"],
    retainedLedCount: 243,
    loopObserved: true,
    handoffDarkMilliseconds: 400,
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
    if (process.exitCode !== null) throw new Error(`LED server exited early:\n${output}`);
    if (Date.now() - started > 20_000) throw new Error(`LED server did not start:\n${output}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}
