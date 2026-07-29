import Prism from "prismjs";
import {
  DISTRIBUTED_ASSETS,
  DISTRIBUTION_CATALOG,
  type DistributedAsset,
} from "./catalog";
import {
  mountPreparedAsset,
  type PreparedAssetMount,
} from "./preparedAsset";
import "./site.css";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}.`);
  return element;
}

const filter = required<HTMLInputElement>("#filter");
const panel = required<HTMLElement>("#panel");
const codePanel = required<HTMLElement>(".code-panel");
const list = required<HTMLElement>("#asset-list");
const noResults = required<HTMLElement>(".no-results");
const assetName = required<HTMLElement>("#asset-name");
const assetHost = required<HTMLElement>("#asset-scene");
const assetSource = required<HTMLAnchorElement>("#asset-source");
const assetLicense = required<HTMLAnchorElement>("#asset-license");
const assetPolygons = required<HTMLElement>("#asset-polygons");
const codeSource = required<HTMLElement>("#code-source");
const panelOpen = required<HTMLButtonElement>(".panel-open");
const panelClose = required<HTMLButtonElement>(".panel-close");
const scrim = required<HTMLButtonElement>(".scrim");
const viewer = required<HTMLElement>("#viewer");

let selectedId = "";
let menuOpen = false;
let selectionRevision = 0;
let mountedAsset: PreparedAssetMount | null = null;

function compact(): boolean {
  return matchMedia("(max-width: 720px)").matches;
}

function setMenu(open: boolean): void {
  menuOpen = open;
  const overlay = compact();
  document.documentElement.classList.toggle("menu-open", open);
  panelOpen.setAttribute("aria-expanded", String(open));
  panel.inert = overlay && !open;
  panel.toggleAttribute("aria-hidden", overlay && !open);
  codePanel.inert = overlay && open;
  viewer.inert = overlay && open;
}

function randomAsset(): DistributedAsset {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return DISTRIBUTED_ASSETS[values[0] % DISTRIBUTED_ASSETS.length]
    ?? DISTRIBUTED_ASSETS[0];
}

function assetFromUrl(): DistributedAsset {
  const id = new URL(location.href).searchParams.get("asset");
  return DISTRIBUTED_ASSETS.find((asset) => asset.id === id) ?? randomAsset();
}

function previewForAsset(asset: DistributedAsset): HTMLElement {
  const preview = document.createElement("span");
  preview.className = "asset-preview";
  preview.setAttribute("aria-hidden", "true");

  const image = document.createElement("img");
  image.src = `/${asset.preview.path}`;
  image.alt = "";
  image.width = 168;
  image.height = 168;
  image.loading = "lazy";
  image.decoding = "async";
  preview.appendChild(image);
  return preview;
}

function assetButton(asset: DistributedAsset): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "asset-item";
  button.type = "button";
  button.setAttribute("aria-label", asset.name);
  button.dataset.asset = asset.id;
  button.dataset.search = `${asset.id} ${asset.name}`.toLowerCase();

  button.append(previewForAsset(asset));
  button.addEventListener("click", () => selectAsset(asset, true));
  return button;
}

function fillAssetStrip(visibleAssets?: number): void {
  const slotWidth = 128;
  const gap = 8;
  const visible = visibleAssets
    ?? list.querySelectorAll<HTMLButtonElement>(".asset-item:not([hidden])").length;
  const columns = Math.max(1, Math.floor((list.clientWidth + gap) / (slotWidth + gap)));
  const count = Math.max(0, columns - visible);
  const placeholders = Array.from(
    list.querySelectorAll<HTMLElement>(".asset-placeholder"),
  );

  placeholders.slice(count).forEach((placeholder) => placeholder.remove());
  for (let index = placeholders.length; index < count; index += 1) {
    const placeholder = document.createElement("span");
    placeholder.className = "asset-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    list.appendChild(placeholder);
  }
}

function canonicalExample(asset: DistributedAsset): string {
  const runtime = DISTRIBUTION_CATALOG.runtime;
  const packageUrl = `https://css.graphics/${asset.root}`;
  const imports = asset.mode === "animated-clips"
    ? "createPolyMorphAnimationRuntime,createPolyMorphDeformationRuntime,mountPolyMorphModel"
    : asset.mode === "morph-targets"
      ? "createPolyMorphDeformationRuntime,mountPolyMorphModel"
      : "mountPolyMorphModel";
  const setup = `<link rel="stylesheet" href="${packageUrl}/model.css">
<div id="asset"></div>

<script type="module">
import{${imports}}from"https://esm.sh/${runtime.package}@${runtime.version}";

const model=await fetch("${packageUrl}/runtime.json").then(r=>r.json());
const view=mountPolyMorphModel(document.querySelector("#asset"),model);`;

  if (asset.mode === "animated-clips") {
    return `${setup}
const animation=createPolyMorphAnimationRuntime(model);
const deformation=createPolyMorphDeformationRuntime(model);
let tick=0;
function draw(time){
  const morph=animation.sample("example-blob",time);
  const spin=animation.sample("example-spin",time);
  view.apply({
    shapes:[...spin.shapeMatrices].map(([shapeId,matrix])=>({shapeId,matrix})),
    leaves:deformation.sample({tick:tick++,morphWeights:morph.morphWeights}).leafUpdates
  });
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
</script>`;
  }

  if (asset.mode === "animation-clip") {
    return `${setup}
</script>`;
  }

  return `${setup}
const deformation=createPolyMorphDeformationRuntime(model);
let tick=0;
function draw(time){
  const phase=(time%6000)/1500;
  const target=phase<2?"spherify":"twist";
  const weight=Math.sin(Math.PI*(phase%2)/2);
  view.apply({leaves:deformation.sample({
    tick:tick++,
    morphWeights:{[target]:weight}
  }).leafUpdates});
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
</script>`;
}

function updateCode(asset: DistributedAsset): void {
  codeSource.innerHTML = Prism.highlight(
    canonicalExample(asset),
    Prism.languages.markup,
    "markup",
  );
}

function selectAsset(asset: DistributedAsset, updateUrl: boolean): void {
  selectedId = asset.id;
  const revision = ++selectionRevision;
  mountedAsset?.destroy();
  mountedAsset = null;
  const surface = document.createElement("div");
  surface.className = "prepared-asset-surface";
  surface.dataset.state = "loading";
  assetHost.replaceChildren(surface);

  for (const button of list.querySelectorAll<HTMLButtonElement>(".asset-item")) {
    const selected = button.dataset.asset === asset.id;
    button.classList.toggle("is-selected", selected);
    button.toggleAttribute("aria-current", selected);
  }

  assetName.textContent = asset.name;
  assetSource.textContent = asset.source.authors.join(", ");
  assetSource.href = asset.source.url;
  assetSource.target = "_blank";
  assetSource.rel = "noreferrer";
  assetLicense.textContent = asset.source.license;
  assetLicense.href = asset.source.licenseUrl;
  assetLicense.target = "_blank";
  assetLicense.rel = "license noreferrer";
  assetPolygons.textContent = asset.polygons.toLocaleString();
  updateCode(asset);
  document.title = `${asset.name} — css.graphics`;

  if (updateUrl) {
    history.pushState({ asset: asset.id }, "", `?asset=${encodeURIComponent(asset.id)}`);
  } else {
    history.replaceState({ asset: asset.id }, "", `?asset=${encodeURIComponent(asset.id)}`);
  }

  void mountPreparedAsset(surface, asset).then((nextMount) => {
    if (revision !== selectionRevision) {
      nextMount.destroy();
      return;
    }
    mountedAsset = nextMount;
    surface.dataset.state = "ready";
  }).catch((error: unknown) => {
    if (revision !== selectionRevision) return;
    surface.dataset.state = "error";
    surface.textContent = "Could not load asset.";
    console.error(error);
  });

  if (compact()) setMenu(false);
}

function applyFilter(): void {
  const query = filter.value.trim().toLowerCase();
  let visible = 0;
  for (const button of list.querySelectorAll<HTMLButtonElement>(".asset-item")) {
    const matches = (button.dataset.search ?? "").includes(query);
    button.hidden = !matches;
    if (matches) visible += 1;
  }
  noResults.hidden = visible !== 0;
  fillAssetStrip(visible);
}

DISTRIBUTED_ASSETS.forEach((asset) => list.appendChild(assetButton(asset)));
fillAssetStrip();

filter.addEventListener("input", applyFilter);
panelOpen.addEventListener("click", () => setMenu(true));
panelClose.addEventListener("click", () => setMenu(false));
scrim.addEventListener("click", () => setMenu(false));

document.addEventListener("keydown", (event) => {
  const editing = event.target instanceof HTMLInputElement;
  if (event.key === "/" && !editing) {
    event.preventDefault();
    if (compact()) setMenu(true);
    filter.focus();
  } else if (event.key === "Escape") {
    if (filter.value) {
      filter.value = "";
      applyFilter();
    } else {
      setMenu(false);
    }
  }
});

addEventListener("resize", () => {
  setMenu(menuOpen);
});
addEventListener("popstate", () => {
  const id = new URL(location.href).searchParams.get("asset");
  const asset = DISTRIBUTED_ASSETS.find((candidate) => candidate.id === id);
  if (asset && asset.id !== selectedId) selectAsset(asset, false);
});

selectAsset(assetFromUrl(), false);
setMenu(false);

const stripObserver = new ResizeObserver(() => fillAssetStrip());
stripObserver.observe(list);
