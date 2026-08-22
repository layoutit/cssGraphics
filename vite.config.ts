import { resolve } from "node:path";

import { defineConfig } from "vite";

const repositoryRoot = import.meta.dirname;

export default defineConfig({
  build: {
    outDir: resolve(repositoryRoot, "dist/runtime"),
    emptyOutDir: true,
    lib: {
      entry: resolve(repositoryRoot, "src/bundle.ts"),
      formats: ["es"],
      fileName: "cssgraphics",
      cssFileName: "cssgraphics",
    },
    rollupOptions: {
      external: ["@layoutit/polycss", "@layoutit/polycss-morph"],
    },
  },
});
