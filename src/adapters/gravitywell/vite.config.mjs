import { execSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const adapterRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const generatedPublicDir = resolve(
  process.env.CSSGRAVITYWELL_GENERATED_PUBLIC_DIR ?? resolve(repositoryRoot, "build/generated/public"),
);
const deployBuild = process.env.CSSGRAVITYWELL_DEPLOY_BUILD === "1";

function repoVersion() {
  try {
    return "0." + execSync("git rev-list --count HEAD", {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "0.0";
  }
}

export default defineConfig({
  base: deployBuild ? "/gravitywell/" : "/",
  root: adapterRoot,
  define: { __CSSGRAVITYWELL_VERSION__: JSON.stringify(repoVersion()) },
  publicDir: deployBuild ? false : generatedPublicDir,
  plugins: deployBuild ? [{
    name: "cssgravitywell-netlify-assets",
    async closeBundle() {
      const deployAssets = resolve(repositoryRoot, "dist/site/cssgravitywell");
      await mkdir(resolve(repositoryRoot, "dist/site"), { recursive: true });
      await rm(deployAssets, { recursive: true, force: true });
      await cp(
        resolve(generatedPublicDir, "cssgravitywell"),
        deployAssets,
        { recursive: true, force: true },
      );
    },
  }] : [],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: resolve(repositoryRoot, deployBuild ? "dist/site/gravitywell" : "dist/gravitywell"),
    emptyOutDir: true,
  },
});
