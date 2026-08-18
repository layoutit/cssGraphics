import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const adapterRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");

export default defineConfig({
  root: adapterRoot,
  publicDir: resolve(repositoryRoot, "build/generated/public"),
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: resolve(repositoryRoot, "dist/platonic-folding"),
    emptyOutDir: true,
  },
});
