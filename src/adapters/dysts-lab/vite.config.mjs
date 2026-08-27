// SPDX-License-Identifier: MIT
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { createExamplesShellPlugin } from "../../../site/examples-shell-plugin.mjs";

const adapterRoot = import.meta.dirname;
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const generatedPublicDir = resolve(repositoryRoot, "build/generated/public");
const deployBuild = process.env.CSSCHAOS_DEPLOY_BUILD === "1";

function createPreparedBrotliPlugin() {
  const serve = (server) => {
    server.middlewares.use(async (request, response, next) => {
      if (!request.url || !["GET", "HEAD"].includes(request.method ?? "GET")) return next();
      const pathname = new URL(request.url, "http://css.graphics").pathname;
      if (!/^\/csschaos\/[a-z0-9-]+-[a-f0-9]{64}\.bin\.br$/u.test(pathname)) return next();
      try {
        const bytes = await readFile(resolve(generatedPublicDir, pathname.slice(1)));
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader("Content-Encoding", "br");
        response.setHeader("Content-Length", bytes.byteLength);
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        response.end(request.method === "HEAD" ? undefined : bytes);
      } catch (error) {
        next(error);
      }
    });
  };
  return {
    name: "csschaos-prepared-brotli-assets",
    configureServer: serve,
    configurePreviewServer: serve,
  };
}

export default defineConfig({
  base: deployBuild ? "/chaos/" : "/",
  root: adapterRoot,
  publicDir: deployBuild ? false : generatedPublicDir,
  plugins: [
    ...(deployBuild ? [{
      name: "csschaos-netlify-assets",
      async closeBundle() {
        const deployAssets = resolve(repositoryRoot, "dist/site/csschaos");
        await mkdir(resolve(repositoryRoot, "dist/site"), { recursive: true });
        await rm(deployAssets, { recursive: true, force: true });
        await cp(resolve(generatedPublicDir, "csschaos"), deployAssets, {
          recursive: true,
          force: true,
        });
      },
    }] : [createPreparedBrotliPlugin()]),
    createExamplesShellPlugin("chaos"),
  ],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: resolve(repositoryRoot, deployBuild ? "dist/site/chaos" : "dist/chaos-local"),
    emptyOutDir: true,
  },
});
