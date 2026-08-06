import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const adapterRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");

export default defineConfig({
  root: adapterRoot,
  publicDir: resolve(
    process.env.CSSPIPES_GENERATED_PUBLIC_DIR ??
      resolve(repositoryRoot, "build/generated/public"),
  ),
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: resolve(repositoryRoot, "dist/3dpipes"),
    emptyOutDir: true,
  },
});
