// SPDX-License-Identifier: GPL-2.0-only
import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createExamplesShellPlugin } from "../../../site/examples-shell-plugin.mjs";

const adapterRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const generatedPublicDir = resolve(repositoryRoot, "build", "generated", "public");
const deployBuild = process.env.CSSSELECTROPAINT_DEPLOY_BUILD === "1";

export default defineConfig({
  base: deployBuild ? "/electropaint/" : "/",
  root: adapterRoot,
  publicDir: deployBuild ? false : generatedPublicDir,
  plugins: [createExamplesShellPlugin("electropaint"), ...(deployBuild ? [{
    name: "cssselectropaint-netlify-assets",
    async closeBundle() {
      await mkdir(resolve(repositoryRoot, "dist", "site"), { recursive: true });
      await cp(
        resolve(generatedPublicDir, "cssselectropaint"),
        resolve(repositoryRoot, "dist", "site", "cssselectropaint"),
        { recursive: true, force: true },
      );
    },
  }] : [])],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: resolve(repositoryRoot, deployBuild ? "dist/site/electropaint" : "dist/electropaint"),
    emptyOutDir: true,
  },
});
