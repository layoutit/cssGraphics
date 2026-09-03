// SPDX-License-Identifier: HPND
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { createExamplesShellPlugin } from "../../../site/examples-shell-plugin.mjs";

const adapterRoot = import.meta.dirname;
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const generatedPublicDir = resolve(repositoryRoot, "build/generated/public");
const deployBuild = process.env.CSSCITYFLOW_DEPLOY_BUILD === "1";

export default defineConfig({
  base: deployBuild ? "/cityflow/" : "/",
  root: adapterRoot,
  publicDir: deployBuild ? false : generatedPublicDir,
  plugins: [createExamplesShellPlugin("cityflow"), ...(deployBuild ? [{
    name: "csscityflow-netlify-assets",
    async closeBundle() {
      const deployAssets = resolve(repositoryRoot, "dist/site/csscityflow");
      await mkdir(resolve(repositoryRoot, "dist/site"), { recursive: true });
      await rm(deployAssets, { recursive: true, force: true });
      await cp(resolve(generatedPublicDir, "csscityflow"), deployAssets, {
        recursive: true,
        force: true,
      });
    },
  }] : [])],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: resolve(repositoryRoot, deployBuild ? "dist/site/cityflow" : "dist/cityflow-local"),
    emptyOutDir: true,
  },
});
