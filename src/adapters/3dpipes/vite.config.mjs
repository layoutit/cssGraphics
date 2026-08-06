import { defineConfig } from "vite";
import { cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const adapterRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const generatedPublicDir = resolve(
  process.env.CSSPIPES_GENERATED_PUBLIC_DIR ??
    resolve(repositoryRoot, "build/generated/public"),
);
const deployBuild = process.env.CSSPIPES_DEPLOY_BUILD === "1";

export default defineConfig({
  base: deployBuild ? "/pipes/" : "/",
  root: adapterRoot,
  publicDir: deployBuild ? false : generatedPublicDir,
  plugins: deployBuild ? [{
    name: "csspipes-netlify-assets",
    async closeBundle() {
      await cp(
        resolve(generatedPublicDir, "csspipes"),
        resolve(repositoryRoot, "dist/site/csspipes"),
        { recursive: true, force: true },
      );
    },
  }] : [],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: resolve(repositoryRoot, deployBuild ? "dist/site/pipes" : "dist/3dpipes"),
    emptyOutDir: true,
  },
});
