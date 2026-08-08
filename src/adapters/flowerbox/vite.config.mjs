import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const adapterRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const generatedPublicDir = resolve(
  process.env.CSSFLOWER_GENERATED_PUBLIC_DIR ??
    resolve(repositoryRoot, "build/generated/public"),
);
const deployBuild = process.env.CSSFLOWER_DEPLOY_BUILD === "1";

export default defineConfig({
  base: deployBuild ? "/flowerbox/" : "/",
  root: adapterRoot,
  publicDir: deployBuild ? resolve(adapterRoot, "public") : generatedPublicDir,
  plugins: deployBuild ? [{
    name: "flowerbox-netlify-assets",
    async closeBundle() {
      await mkdir(resolve(repositoryRoot, "dist/site"), { recursive: true });
      await cp(
        resolve(generatedPublicDir, "cssflower"),
        resolve(repositoryRoot, "dist/site/cssflower"),
        { recursive: true, force: true },
      );
    },
  }] : [],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: resolve(repositoryRoot, deployBuild ? "dist/site/flowerbox" : "dist/flowerbox"),
    emptyOutDir: true,
  },
});
