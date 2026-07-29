const TITLE_HEAD_LEAF_STYLES_SCHEMA =
  "cssgraphics-title-head-leaf-styles@1";
export const TITLE_HEAD_LEAF_STYLES_PATH =
  "model/title-head-leaves.css";

function fail(message) {
  throw new TypeError(`Title-head leaf stylesheet: ${message}`);
}

function normalizedPath(value, label) {
  if (typeof value !== "string" || !value || value.startsWith("/")
    || value.includes("\\") || value.includes("?") || value.includes("#")
    || value.split("/").includes("..")) {
    fail(`${label} is not a normalized prepared path`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} is invalid`);
  return value;
}

function backgroundSize(value, label) {
  if (typeof value !== "string"
    || !/^(?:0|[1-9]\d*)(?:\.\d+)?px (?:0|[1-9]\d*)(?:\.\d+)?px$/u.test(value)) {
    fail(`${label} is not a literal pixel size`);
  }
  return value;
}

function assetUrl(assetBase, path) {
  if (typeof assetBase !== "string" || !assetBase.startsWith("/")
    || assetBase.includes("\\") || assetBase.includes("?")
    || assetBase.includes("#") || assetBase.split("/").includes("..")) {
    fail("asset base is invalid");
  }
  return `${assetBase.endsWith("/") ? assetBase : `${assetBase}/`}${path}`;
}

function domShapeId(sourceId) {
  const id = sourceId.startsWith("mario-") ? sourceId.slice(6) : sourceId;
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) {
    fail("shape id cannot be used as a structural selector");
  }
  return id;
}

function shapeSelector(shapeId, childIndex) {
  if (typeof shapeId !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(shapeId)) {
    fail("shape id cannot be used as a structural selector");
  }
  return `[data-shape="${shapeId}"]>:nth-child(${childIndex})`;
}

export function buildTitleHeadLeafStyles({
  trianglePlan,
  lighting,
  assetBase = "/title-head/",
} = {}) {
  if (trianglePlan?.schema !== "cssgraphics-title-head-triangle-plan@2"
    || !Array.isArray(trianglePlan.leaves)
    || trianglePlan.leaves.length !== 1213
    || lighting?.schema !== "cssgraphics-title-head-lighting-atlases@9"
    || lighting.trianglePlanHash !== trianglePlan.contentHash
    || !Array.isArray(lighting.surface?.pages)
    || !Array.isArray(lighting.surface?.faces)
    || lighting.surface.faces.length !== trianglePlan.leaves.length) {
    fail("triangle plan and compact lighting matrix do not match");
  }

  if (lighting.surface.pages.length !== 1) {
    fail("compact lighting must use one atlas page");
  }
  const page = lighting.surface.pages[0];
  const fallbackPath = normalizedPath(page.path, "surface.pages[0].path");
  const nativePath = normalizedPath(page.native?.path, "surface.pages[0].native.path");
  const rules = [
    `/* ${TITLE_HEAD_LEAF_STYLES_SCHEMA}; generated, do not edit. */`,
  ];
  const childrenByShape = new Map();

  for (let faceIndex = 0; faceIndex < trianglePlan.leaves.length; faceIndex += 1) {
    const leaf = trianglePlan.leaves[faceIndex];
    const face = lighting.surface.faces[faceIndex];
    if (face.pageIndex !== 0 || leaf.sourceOrder !== faceIndex || face.sourceOrder !== faceIndex
      || leaf.faceId !== face.faceId) {
      fail(`face ${faceIndex} is reordered or is not on atlas page 0`);
    }
    const childIndex = (childrenByShape.get(leaf.shapeId) ?? 0) + 1;
    childrenByShape.set(leaf.shapeId, childIndex);
    const selectorShapeId = domShapeId(leaf.shapeId);
    const selector = shapeSelector(selectorShapeId, childIndex);
    rules.push(
      `${selector}{`
      + `width:${positiveInteger(face.leafWidth, `surface.faces[${faceIndex}].leafWidth`)}px;`
      + `height:${positiveInteger(face.leafHeight, `surface.faces[${faceIndex}].leafHeight`)}px;`
      + `background-size:${backgroundSize(face.backgroundSize, `surface.faces[${faceIndex}].backgroundSize`)}`
      + "}",
    );
  }

  rules.push(
    `.polycss-scene [data-shape]>:is(u,i){background-image:url("${assetUrl(assetBase, nativePath)}")}`,
    `.polycss-scene [data-shape]>s{background-image:url("${assetUrl(assetBase, fallbackPath)}")}`,
  );

  return `${rules.join("\n")}\n`;
}
