import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const adapterRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const generatedPublicDir = resolve(
  process.env.CSSPLATONICFOLDING_GENERATED_PUBLIC_DIR ?? resolve(repositoryRoot, "build/generated/public"),
);
const deployBuild = process.env.CSSPLATONICFOLDING_DEPLOY_BUILD === "1";

export default defineConfig({
  base: deployBuild ? "/platonic-folding/" : "/",
  root: adapterRoot,
  publicDir: deployBuild ? false : generatedPublicDir,
  plugins: deployBuild ? [{
    name: "cssplatonicfolding-netlify-assets",
    async closeBundle() {
      await mkdir(resolve(repositoryRoot, "dist/site"), { recursive: true });
      await rm(resolve(repositoryRoot, "dist/site/cssplatonicfolding"), { recursive: true, force: true });
      await cp(
        resolve(generatedPublicDir, "cssplatonicfolding"),
        resolve(repositoryRoot, "dist/site/cssplatonicfolding"),
        { recursive: true, force: true },
      );
    },
  }] : [],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: resolve(repositoryRoot, deployBuild ? "dist/site/platonic-folding" : "dist/platonic-folding"),
    emptyOutDir: true,
  },
});
