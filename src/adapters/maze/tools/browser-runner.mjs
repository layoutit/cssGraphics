import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { adapterRoot, repositoryRoot } from "../src/prepare/cssmaze/paths.mjs";

export async function withCssmazeBrowser(callback, { deploy = false, path } = {}) {
  const port = await freePort();
  const routePath = path ?? (deploy ? "/maze/" : "/");
  let output = "";
  const server = spawn("pnpm", deploy ? [
    "exec", "vite", "preview",
    "--host", "127.0.0.1", "--port", String(port), "--strictPort",
    "--outDir", `${repositoryRoot}/dist/site`,
  ] : [
    "exec", "vite", "--config", `${adapterRoot}/vite.config.mjs`,
    "--host", "127.0.0.1", "--port", String(port), "--strictPort",
  ], {
    cwd: repositoryRoot,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  try {
    await waitFor(() => output.includes("Local:") || output.includes(`127.0.0.1:${port}`), 20_000, () => {
      if (server.exitCode !== null) throw new Error(`Vite exited early:\n${output}`);
    });
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}${routePath}`, { waitUntil: "networkidle" });
      await page.waitForFunction(
        () => window.__cssMazeDebug?.ready === true || window.__cssMazeDebug?.errors?.length > 0,
        null,
        { timeout: 60_000 },
      );
      const errors = await page.evaluate(() => window.__cssMazeDebug.errors);
      if (errors.length > 0 || consoleErrors.length > 0) {
        throw new Error(`cssMaze browser errors:\n${[...errors, ...consoleErrors].join("\n")}`);
      }
      return await callback({ page, port });
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
    server.on("error", reject);
  });
}

async function waitFor(predicate, timeoutMilliseconds, onPoll) {
  const started = Date.now();
  while (Date.now() - started < timeoutMilliseconds) {
    onPoll();
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for cssMaze Vite server");
}
