import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { defineConfig, type Plugin, type UserConfig } from "vite";

import {
  DISTRIBUTION_CATALOG,
  type DistributionMediaType,
} from "./site/catalog";

const repoRoot = import.meta.dirname;
const publicRoot = resolve(repoRoot, "site/public");

interface DistributionFile {
  readonly path: string;
  readonly mediaType: DistributionMediaType;
}

function distributionFiles(): readonly DistributionFile[] {
  const files: DistributionFile[] = [
    { path: "catalog.json", mediaType: "application/json" },
    { path: "robots.txt", mediaType: "text/plain" },
    { path: "sitemap.xml", mediaType: "application/xml" },
  ];
  for (const asset of DISTRIBUTION_CATALOG.assets) {
    files.push(asset.preview);
    files.push(...asset.resources.map((resource) => ({
      path: `${asset.root}/${resource.path}`,
      mediaType: resource.mediaType,
    })));
  }
  const paths = files.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    throw new Error("The css.graphics distribution contains duplicate paths.");
  }
  return files;
}

function distributionPlugin(): Plugin {
  const files = distributionFiles();
  const byPath = new Map(files.map((file) => [file.path, file]));

  return {
    name: "cssgraphics-distribution",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url || !["GET", "HEAD"].includes(request.method ?? "GET")) {
          next();
          return;
        }
        let path: string;
        try {
          path = decodeURIComponent(
            new URL(request.url, "http://css.graphics").pathname,
          ).replace(/^\//u, "");
        } catch {
          next();
          return;
        }
        const file = byPath.get(path);
        if (!file) {
          next();
          return;
        }
        try {
          const bytes = await readFile(resolve(publicRoot, path));
          response.statusCode = 200;
          response.setHeader("Content-Type", file.mediaType);
          response.setHeader("Content-Length", bytes.byteLength);
          response.end(request.method === "HEAD" ? undefined : bytes);
        } catch (error) {
          next(error);
        }
      });
    },
    async buildStart() {
      await Promise.all(files.map(async (file) => {
        this.emitFile({
          type: "asset",
          fileName: file.path,
          source: await readFile(resolve(publicRoot, file.path)),
        });
      }));
    },
  };
}

function siteConfig(): UserConfig {
  return {
    root: resolve(repoRoot, "site"),
    publicDir: false,
    plugins: [distributionPlugin()],
    server: {
      host: "127.0.0.1",
    },
    preview: {
      host: "127.0.0.1",
    },
    build: {
      outDir: resolve(repoRoot, "dist/site"),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(repoRoot, "site/index.html"),
      },
    },
  };
}

function libraryConfig(): UserConfig {
  return {
    build: {
      outDir: resolve(repoRoot, "dist/runtime"),
      emptyOutDir: true,
      lib: {
        entry: resolve(repoRoot, "src/bundle.ts"),
        formats: ["es"],
        fileName: "cssgraphics",
        cssFileName: "cssgraphics",
      },
      rollupOptions: {
        external: ["@layoutit/polycss", "@layoutit/polycss-morph"],
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  if (mode === "library") return libraryConfig();
  return siteConfig();
});
