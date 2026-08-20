import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const adapterRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const generatedPublicDir = resolve(
  process.env.CSSFLOCKS_GENERATED_PUBLIC_DIR ?? resolve(repositoryRoot, "build/generated/public"),
);
const deployBuild = process.env.CSSFLOCKS_DEPLOY_BUILD === "1";

export default defineConfig({
  base: deployBuild ? "/flocks/" : "/",
  root: adapterRoot,
  publicDir: deployBuild ? false : generatedPublicDir,
  plugins: deployBuild ? [{
    name: "cssflocks-netlify-assets",
    async closeBundle() {
      const deployAssets = resolve(repositoryRoot, "dist/site/cssflocks");
      await mkdir(resolve(repositoryRoot, "dist/site"), { recursive: true });
      await rm(deployAssets, { recursive: true, force: true });
      await cp(resolve(generatedPublicDir, "cssflocks"), deployAssets, { recursive: true, force: true });
    },
  }] : [],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: resolve(repositoryRoot, deployBuild ? "dist/site/flocks" : "dist/flocks"),
    emptyOutDir: true,
  },
});
