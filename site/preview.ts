import { DISTRIBUTED_ASSETS } from "./catalog";
import { mountPreparedAsset } from "./preparedAsset";
import "./preview.css";

const previews = document.querySelector<HTMLElement>("#previews");
if (!previews) throw new Error("Missing preview root.");

await Promise.all(DISTRIBUTED_ASSETS.map(async (asset) => {
  const preview = document.createElement("div");
  preview.className = "prepared-preview";
  preview.dataset.preview = asset.id;
  previews.appendChild(preview);
  await mountPreparedAsset(preview, asset, {
    animate: false,
    initialTimeMs: asset.previewTimeMs,
    zoomMultiplier: asset.previewZoom,
  });
  preview.dataset.ready = "true";
}));
