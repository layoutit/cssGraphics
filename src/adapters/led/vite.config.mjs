import { resolve } from "node:path";
import { defineConfig } from "vite";
import { createExamplesShellPlugin } from "../../../site/examples-shell-plugin.mjs";

const adapterRoot = import.meta.dirname;
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const deployBuild = process.env.CSSLED_DEPLOY_BUILD === "1";

export default defineConfig({
  base: deployBuild ? "/led/" : "/",
  root: adapterRoot,
  publicDir: false,
  plugins: [createExamplesShellPlugin("led")],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: resolve(repositoryRoot, deployBuild ? "build/generated/public/cssled" : "dist/led"),
    emptyOutDir: true,
  },
});
