let mountedStyle = null;

export function mountPreparedSolitaireSnapshot({ host, manifest, snapshotHtml }) {
  if (!(host instanceof HTMLElement)) throw new Error("Missing cssSolitaire host");
  if (typeof snapshotHtml !== "string") throw new Error("Prepared cssSolitaire snapshot is required");
  const snapshot = new DOMParser().parseFromString(snapshotHtml, "text/html");
  if (snapshot.querySelector("script,canvas,svg,[style]") ||
      snapshot.querySelectorAll("style").length !== 1 || hasPreparedMetadata(snapshot)) {
    throw new Error("Prepared cssSolitaire snapshot contains a forbidden or incomplete graph");
  }
  const style = snapshot.querySelector("style");
  const camera = snapshot.querySelector(".solitaire-prepared-camera");
  const scene = camera?.querySelector(":scope > .solitaire-prepared-scene");
  const leaves = [...(scene?.querySelectorAll(":scope > s") ?? [])];
  if (!(style instanceof HTMLStyleElement) || !(camera instanceof HTMLElement) ||
      !(scene instanceof HTMLElement) || scene.childElementCount !== manifest.metrics.retainedLeafCount ||
      leaves.length !== manifest.metrics.retainedLeafCount ||
      leaves.some((leaf) => !(leaf instanceof HTMLElement) || leaf.localName !== "s" || leaf.style.length !== 0)) {
    throw new Error("Prepared cssSolitaire retained DOM census drifted");
  }

  mountedStyle?.remove();
  mountedStyle = document.importNode(style, true);
  document.head.append(mountedStyle);
  const ruleBank = collectPreparedRuleBank(mountedStyle, manifest.metrics.retainedLeafCount);
  const mountedCamera = document.importNode(camera, true);
  host.replaceChildren(mountedCamera);
  const mountedScene = mountedCamera.querySelector(":scope > .solitaire-prepared-scene");
  const mountedLeaves = [...(mountedScene?.querySelectorAll(":scope > s") ?? [])];
  if (!(mountedScene instanceof HTMLElement) ||
      mountedScene.childElementCount !== manifest.metrics.retainedLeafCount ||
      mountedLeaves.length !== manifest.metrics.retainedLeafCount ||
      mountedLeaves.some((leaf) => leaf.style.length !== 0)) {
    throw new Error("Mounted cssSolitaire retained DOM census drifted");
  }
  const stableNodes = Object.freeze([mountedCamera, mountedScene, ...mountedLeaves]);
  let presentationScale = 1;
  let presentationScaleWrites = 0;

  function updatePresentation() {
    const width = host.clientWidth || manifest.renderer.landscapePresentationBase[0];
    const height = host.clientHeight || manifest.renderer.landscapePresentationBase[1];
    presentationScale = height >= width
      ? Math.min(
        width / manifest.renderer.portraitPresentationBase[0],
        height / manifest.renderer.portraitPresentationBase[1],
      )
      : Math.min(
        manifest.renderer.landscapeCardMaximumWidthCssPixels / manifest.renderer.cardSourceSize[0],
        manifest.renderer.landscapePresentationBaseScale * Math.min(
          width / manifest.renderer.landscapePresentationBase[0],
          height / manifest.renderer.landscapePresentationBase[1],
        ),
      );
    const serialized = String(Number(presentationScale.toFixed(8)));
    if (ruleBank.presentation.style.getPropertyValue("--csssolitaire-presentation-scale") !== serialized) {
      ruleBank.presentation.style.setProperty("--csssolitaire-presentation-scale", serialized);
      presentationScaleWrites += 1;
    }
  }
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(updatePresentation) : null;
  resizeObserver?.observe(host);
  globalThis.addEventListener?.("resize", updatePresentation);
  updatePresentation();

  function assertStableDomIdentity() {
    const current = [
      host.querySelector(":scope > .solitaire-prepared-camera"),
      host.querySelector(":scope > .solitaire-prepared-camera > .solitaire-prepared-scene"),
      ...host.querySelectorAll(":scope > .solitaire-prepared-camera > .solitaire-prepared-scene > s"),
    ];
    if (current.length !== stableNodes.length || current.some((node, index) => node !== stableNodes[index]) ||
        mountedLeaves.some((leaf) => leaf.style.length !== 0)) {
      throw new Error("Prepared cssSolitaire retained DOM identity changed");
    }
    return true;
  }

  return Object.freeze({
    camera: mountedCamera,
    scene: mountedScene,
    leaves: Object.freeze(mountedLeaves),
    layoutRulesByProfile: ruleBank.layouts,
    assertStableDomIdentity,
    stats() {
      assertStableDomIdentity();
      return Object.freeze({
        mode: "prepared-snapshot",
        retainedCameraRootCount: 1,
        retainedSceneRootCount: 1,
        retainedBoardRootCount: 0,
        retainedRenderWrapperCount: 2,
        retainedPolygonLeafCount: mountedLeaves.length,
        retainedLeafInlineStyleDeclarationCount: 0,
        retainedDataAttributeCount: 0,
        runtimeDomCreationCount: 0,
        runtimeDomRemovalCount: 0,
        runtimeDomMutationCount: 0,
        runtimeDomMutationObserverInstalled: false,
        runtimeDomGrowth: false,
        runtimeFitCalculationPurpose: "single-root-presentation-scale-only",
        runtimePresentationScale: presentationScale,
        runtimePresentationScaleWrites: presentationScaleWrites,
        runtimeGeometryBoundsCalculationCount: 0,
      });
    },
    destroy() {
      resizeObserver?.disconnect();
      globalThis.removeEventListener?.("resize", updatePresentation);
      host.replaceChildren();
      mountedStyle?.remove();
      mountedStyle = null;
    },
  });
}

function collectPreparedRuleBank(style, retainedLeafCount) {
  const sheet = style.sheet;
  if (!(sheet instanceof CSSStyleSheet)) throw new Error("Prepared cssSolitaire stylesheet did not mount");
  const topLevelRules = [...sheet.cssRules];
  const presentation = topLevelRules.find((rule) =>
    rule.selectorText === ".polycss-camera.solitaire-prepared-camera");
  const mediaRules = topLevelRules.filter((rule) => rule.type === CSSRule.MEDIA_RULE);
  const layouts = [
    collectLayoutRules(topLevelRules, retainedLeafCount),
    ...mediaRules.map((rule) => collectLayoutRules([...rule.cssRules], retainedLeafCount)),
  ];
  if (!presentation || layouts.length !== 5 || layouts.some((rules) => rules.some((rule) => !rule))) {
    throw new Error("Prepared cssSolitaire stylesheet rule bank drifted");
  }
  return Object.freeze({
    presentation,
    layouts: Object.freeze(layouts.map((rules) => Object.freeze(rules))),
  });
}

function collectLayoutRules(rules, retainedLeafCount) {
  const result = Array(retainedLeafCount).fill(null);
  for (const rule of rules) {
    const match = rule.selectorText?.match(/^\.solitaire-prepared-scene\s*>\s*s\.l([0-9a-z]+)$/u);
    if (!match) continue;
    const index = Number.parseInt(match[1], 36);
    if (!Number.isSafeInteger(index) || index < 0 || index >= retainedLeafCount || result[index]) {
      throw new Error("Prepared cssSolitaire leaf rule index drifted");
    }
    result[index] = rule;
  }
  return result;
}

function hasPreparedMetadata(doc) {
  return [...doc.querySelectorAll("*")].some((element) =>
    [...element.attributes].some((attribute) => attribute.name.startsWith("data-")));
}
