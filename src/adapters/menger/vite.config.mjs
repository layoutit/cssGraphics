import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const adapterRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
const generatedPublicDir = resolve(
  process.env.CSSMENGER_GENERATED_PUBLIC_DIR ??
    (process.env.CSSMENGER_GENERATED_ROOT
      ? join(process.env.CSSMENGER_GENERATED_ROOT, "public")
      : join(repositoryRoot, "build/generated/public")),
);
const deployBuild = process.env.CSSMENGER_DEPLOY_BUILD === "1";

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

function polycssVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(
      join(repositoryRoot, "node_modules/@layoutit/polycss/package.json"),
      "utf8",
    ));
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export default defineConfig({
  base: deployBuild ? "/menger/" : "/",
  root: adapterRoot,
  define: {
    __CSSMENGER_VERSION__: JSON.stringify(repoVersion()),
    __POLYCSS_VERSION__: JSON.stringify(polycssVersion()),
  },
  publicDir: deployBuild ? false : generatedPublicDir,
  plugins: deployBuild ? [{
    name: "cssmenger-netlify-assets",
    async closeBundle() {
      await mkdir(resolve(repositoryRoot, "dist/site"), { recursive: true });
      await cp(
        resolve(generatedPublicDir, "cssmenger"),
        resolve(repositoryRoot, "dist/site/cssmenger"),
        { recursive: true, force: true },
      );
    },
  }] : [],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: resolve(repositoryRoot, deployBuild ? "dist/site/menger" : "dist/menger"),
    emptyOutDir: true,
  },
});
