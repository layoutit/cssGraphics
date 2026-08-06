import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CSSPIPES_ADAPTER_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)), "..", "..", "..",
);
export const CSSPIPES_REPO_ROOT = resolve(
  CSSPIPES_ADAPTER_ROOT, "..", "..", "..",
);
const CSSPIPES_GENERATED_PUBLIC_DIR = resolve(
  process.env.CSSPIPES_GENERATED_PUBLIC_DIR ??
    resolve(CSSPIPES_REPO_ROOT, "build/generated/public"),
);
export const CSSPIPES_GENERATED_PUBLIC_ROOT = resolve(
  CSSPIPES_GENERATED_PUBLIC_DIR, "csspipes",
);
export const CSSPIPES_SCENE_PATH = resolve(
  CSSPIPES_GENERATED_PUBLIC_ROOT, "scenes/pipes-clips.scene.json.gz",
);
export const CSSPIPES_PREPARE_SCENE_PATH = resolve(
  CSSPIPES_GENERATED_PUBLIC_ROOT, "scenes/pipes-clips.scene.prepare.json",
);
export const CSSPIPES_CLIPS_ROOT = resolve(
  CSSPIPES_GENERATED_PUBLIC_ROOT, "clips",
);
export const CSSPIPES_SNAPSHOT_PATH = resolve(
  CSSPIPES_GENERATED_PUBLIC_ROOT, "scenes/pipes-clips.polycss.html.gz",
);
export const CSSPIPES_PREPARE_SNAPSHOT_PATH = resolve(
  CSSPIPES_GENERATED_PUBLIC_ROOT, "scenes/pipes-clips.polycss.prepare.html",
);
export const CSSPIPES_MANIFEST_PATH = resolve(
  CSSPIPES_GENERATED_PUBLIC_ROOT, "manifest.json",
);
