import { applyCssPipesAttributes } from "./devtoolsAttrs.mjs";
import { CssPipesContractError } from "./types.mjs";
import { readPreparedText } from "./preparedResponse.mjs";

const ALLOWED_SNAPSHOT_TAGS = new Set([
  "html", "head", "meta", "title", "style", "body", "div", "b", "i",
]);
const FORBIDDEN_SNAPSHOT_ATTRIBUTES = new Set([
  "action", "formaction", "href", "src", "srcdoc",
]);

function assertSafePreparedCss(css) {
  if (/@import\b/i.test(css)) {
    throw new CssPipesContractError("Prepared snapshot CSS contains an external import");
  }
  for (const match of css.matchAll(/url\(\s*([^)]+?)\s*\)/giu)) {
    const value = match[1].replace(/^["']|["']$/gu, "");
    if (!value.startsWith("data:image/png;base64,")) {
      throw new CssPipesContractError("Prepared snapshot CSS contains an external URL");
    }
  }
}

function importedSnapshot(documentNode) {
  for (const element of documentNode.querySelectorAll("*")) {
    if (!ALLOWED_SNAPSHOT_TAGS.has(element.localName)) {
      throw new CssPipesContractError(`Prepared snapshot contains forbidden <${element.localName}>`);
    }
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || FORBIDDEN_SNAPSHOT_ATTRIBUTES.has(name)) {
        throw new CssPipesContractError(`Prepared snapshot contains forbidden ${name} attribute`);
      }
      if (name === "style") assertSafePreparedCss(attribute.value);
    }
  }
  const cameras = documentNode.querySelectorAll(".polycss-camera");
  const scenes = documentNode.querySelectorAll(".polycss-scene");
  const camera = cameras[0];
  const scene = scenes[0];
  if (cameras.length !== 1 || scenes.length !== 1 || !camera.contains(scene)) {
    throw new CssPipesContractError("Prepared snapshot is missing one PolyCSS camera/scene");
  }
  const styles = [...documentNode.querySelectorAll("style")];
  if (styles.length === 0) throw new CssPipesContractError("Prepared snapshot has no retained PolyCSS styles");
  for (const style of styles) assertSafePreparedCss(style.textContent ?? "");
  return { camera, styles };
}

export async function mountPreparedPolyCssSnapshot(host, sceneContract, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(sceneContract.snapshotUrl, { cache: "no-store" });
  if (!response?.ok) throw new CssPipesContractError(`Snapshot request failed (${response?.status ?? "network"})`);
  const html = await readPreparedText(response);
  if (/\/(?:Users|home)\//.test(html) || /<script\b/i.test(html)) {
    throw new CssPipesContractError("Prepared snapshot failed path/script sanitization");
  }
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const snapshot = importedSnapshot(parsed);
  const fragment = document.createDocumentFragment();
  for (const style of snapshot.styles) fragment.append(document.importNode(style, true));
  const viewport = document.createElement("div");
  viewport.dataset.csspipesViewport = "true";
  const camera = document.importNode(snapshot.camera, true);
  viewport.append(camera);
  fragment.append(viewport);
  host.replaceChildren(fragment);
  applyCssPipesAttributes(host, { scene: sceneContract.id, snapshot: "prepared" });
  return Object.freeze({
    viewport,
    camera,
    scene: camera.querySelector(".polycss-scene"),
  });
}
