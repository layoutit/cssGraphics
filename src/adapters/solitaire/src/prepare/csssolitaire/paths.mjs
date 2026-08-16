import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const adapterRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const repositoryRoot = resolve(adapterRoot, "..", "..", "..");
export const sourceRoot = join(adapterRoot, "source");
export const referencePath = join(adapterRoot, "notes", "references", "source-lock.json");

export function generatedPublicRoot() {
  return resolve(
    process.env.CSSSOLITAIRE_GENERATED_PUBLIC_DIR ??
      join(repositoryRoot, "build", "generated", "public"),
  );
}

export function generatedProductRoot() {
  return join(generatedPublicRoot(), "csssolitaire");
}
