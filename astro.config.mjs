import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import { defineConfig } from "astro/config";

const repositoryRoot = import.meta.dirname;
const generatedPublicRoot = resolve(repositoryRoot, "build/generated/public");
const generatedAssetRoots = [
  "csscloth/",
  "csssolitaire/",
  "cssselectropaint/",
  "cssmenger/",
  "cssmaze/",
  "cssgears/",
  "csspipes/",
];

function generatedAssetsPlugin() {
  return {
    name: "cssgraphics-generated-assets",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url || !["GET", "HEAD"].includes(request.method ?? "GET")) {
          next();
          return;
        }
        const pathname = decodeURIComponent(
          new URL(request.url, "http://css.graphics").pathname,
        ).replace(/^\//u, "");
        const siteStylesheet = pathname === "site.css";
        if (!siteStylesheet && !generatedAssetRoots.some((root) => pathname.startsWith(root))) {
          next();
          return;
        }
        const path = siteStylesheet
          ? resolve(repositoryRoot, "site/site.css")
          : resolve(generatedPublicRoot, pathname);
        if (!siteStylesheet && !path.startsWith(`${generatedPublicRoot}${sep}`)) {
          next();
          return;
        }
        try {
          const bytes = await readFile(path);
          response.statusCode = 200;
          response.setHeader("Content-Type", siteStylesheet ? "text/css" : mediaTypeForPath(pathname));
          response.setHeader("Content-Length", bytes.byteLength);
          response.end(request.method === "HEAD" ? undefined : bytes);
        } catch (error) {
          next(error);
        }
      });
    },
    async buildStart() {
      if (this.meta.watchMode) return;
      this.emitFile({
        type: "asset",
        fileName: "site.css",
        source: await readFile(resolve(repositoryRoot, "site/site.css")),
      });
    },
  };
}

function mediaTypeForPath(path) {
  return ({
    ".avif": "image/avif",
    ".gz": "application/gzip",
    ".json": "application/json",
    ".png": "image/png",
    ".webp": "image/webp",
  })[extname(path)] ?? "application/octet-stream";
}

function repositoryVersion() {
  try {
    return `0.${execSync("git rev-list --count HEAD", {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()}`;
  } catch {
    return "0.0";
  }
}

function polycssVersion() {
  try {
    return JSON.parse(readFileSync(
      resolve(repositoryRoot, "node_modules/@layoutit/polycss/package.json"),
      "utf8",
    )).version;
  } catch {
    return "0.0.0";
  }
}

export default defineConfig({
  srcDir: "./site",
  publicDir: "./site/public",
  outDir: "./dist/site",
  output: "static",
  devToolbar: { enabled: false },
  vite: {
    define: {
      __CSSMENGER_VERSION__: JSON.stringify(repositoryVersion()),
      __CSSCSSGEARS_VERSION__: JSON.stringify(repositoryVersion()),
      __POLYCSS_VERSION__: JSON.stringify(polycssVersion()),
    },
    plugins: [generatedAssetsPlugin()],
    build: {
      emptyOutDir: process.env.CSSGRAPHICS_DEPLOY_BUILD !== "1",
    },
  },
});
