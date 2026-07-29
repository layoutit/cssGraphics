import { resolve } from "node:path";

import { defineConfig } from "vite";

const repoRoot = import.meta.dirname;

export default defineConfig({
  root: resolve(repoRoot, "app"),
  publicDir: resolve(
    repoRoot,
    process.env.CSSGRAPHICS_PREPARED_PUBLIC_DIR ?? "build/generated/public",
  ),
  server: {
    host: "127.0.0.1",
  },
  preview: {
    host: "127.0.0.1",
  },
  build: {
    outDir: resolve(repoRoot, "dist/app"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(repoRoot, "app/index.html"),
    },
  },
});
