import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/runtime",
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/bundle.ts"),
      formats: ["es"],
      fileName: "cssgraphics",
      cssFileName: "cssgraphics",
    },
    rollupOptions: {
      external: ["@layoutit/polycss", "@layoutit/polycss-morph"],
    },
  },
});
