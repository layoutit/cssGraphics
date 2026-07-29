import { closeSync, constants as fsConstants, openSync, readSync } from "node:fs";

import {
  computeShapeLighting,
  formatColor as formatPolyCssColor,
  parsePureColor,
  worldDirectionToPolyCss,
} from "@layoutit/polycss";

import { encodePngRgba8 } from "../../../prepare/shared/png.mjs";
import { createUvProof, decodeIa8, decodeRgba16 } from "../n64TextureDecode.mjs";
import { SM64_US_ROM } from "../romSource.mjs";
import {
  titleHeadContentHash,
  titleHeadSha256,
} from "./contract.mjs";
import { TITLE_HEAD_DYNLIST_GRAPH_SCHEMA } from "./dynlistLoader.mjs";

// headGeometry
const TITLE_HEAD_GEOMETRY_SCHEMA = "cssgraphics-title-head-geometry@1";

const TITLE_HEAD_SHAPE_SOURCES = Object.freeze([
  Object.freeze({
    id: "mario-face",
    role: "face",
    module: "dynlists/dynlist_mario_face.js",
    list: "dynlist_mario_face",
  }),
  Object.freeze({
    id: "mario-eye-right",
    role: "eye-right",
    module: "dynlists/dynlist_mario_eyes.js",
    list: "dynlist_mario_eye_right",
  }),
  Object.freeze({
    id: "mario-eye-left",
    role: "eye-left",
    module: "dynlists/dynlist_mario_eyes.js",
    list: "dynlist_mario_eye_left",
  }),
  Object.freeze({
    id: "mario-eyebrow-right",
    role: "eyebrow-right",
    module: "dynlists/dynlist_mario_eyebrows_mustache.js",
    list: "dynlist_mario_eyebrow_right",
  }),
  Object.freeze({
    id: "mario-eyebrow-left",
    role: "eyebrow-left",
    module: "dynlists/dynlist_mario_eyebrows_mustache.js",
    list: "dynlist_mario_eyebrow_left",
  }),
  Object.freeze({
    id: "mario-mustache",
    role: "mustache",
    module: "dynlists/dynlist_mario_eyebrows_mustache.js",
    list: "dynlist_mario_mustache",
  }),
]);

const HEAD_GEOMETRY_COMMAND = Object.freeze({
  START_LIST: 0xD1D4,
  STOP_LIST: 58,
  MAKE_DYNOBJ: 15,
  LINK_WITH_PTR: 29,
  START_GROUP: 16,
  END_GROUP: 17,
  SET_ID: 35,
  SET_AMBIENT: 33,
  SET_DIFFUSE: 34,
  SET_NODE_GROUP: 21,
  SET_PLANE_GROUP: 23,
  SET_MATERIAL_GROUP: 20,
  JUMP_TO_LIST: 12,
});

function geometryFail(message, source = null) {
  throw new TypeError(source ? `${source}: ${message}` : message);
}

function geometryInteger(value, label, source) {
  if (!Number.isSafeInteger(value)) geometryFail(`${label} must be a safe integer`, source);
  return value;
}

function finiteNumber(value, label, source) {
  if (typeof value !== "number" || !Number.isFinite(value)) geometryFail(`${label} must be finite`, source);
  return value;
}

function rgb(command, label, source) {
  const vec = command?.args?.vec;
  const value = [vec?.r, vec?.g, vec?.b].map((component, index) => (
    finiteNumber(component, `${label}[${index}]`, source)
  ));
  if (value.some((component) => component < 0 || component > 1)) {
    geometryFail(`${label} components must remain in source range 0..1`, source);
  }
  return value;
}

function buildGraphIndex(graph) {
  if (graph?.schema !== TITLE_HEAD_DYNLIST_GRAPH_SCHEMA) {
    geometryFail(`expected dynlist graph schema ${TITLE_HEAD_DYNLIST_GRAPH_SCHEMA}`);
  }
  const modules = new Map();
  const nodes = new Map();
  for (const module of graph.modules ?? []) {
    if (modules.has(module.path)) geometryFail(`duplicate graph module ${module.path}`);
    modules.set(module.path, module);
    for (const node of module.nodes ?? []) {
      if (nodes.has(node.id)) geometryFail(`duplicate graph node ${node.id}`);
      nodes.set(node.id, node);
    }
  }
  return { modules, nodes };
}

function geometryRequireNode(index, id, source) {
  const node = index.nodes.get(id);
  if (!node) geometryFail(`unresolved graph reference ${id}`, source);
  return node;
}

function refId(value, label, source) {
  if (
    !value
    || typeof value !== "object"
    || typeof value.$ref !== "string"
    || Object.keys(value).length !== 1
  ) geometryFail(`${label} must be one graph reference`, source);
  return value.$ref;
}

function requireListNode(index, descriptor) {
  const module = index.modules.get(descriptor.module);
  if (!module) geometryFail("source module is absent from graph", `${descriptor.module}#${descriptor.list}`);
  const id = `${descriptor.module}#${descriptor.list}`;
  const node = geometryRequireNode(index, id, id);
  if (!node.exported || node.kind !== "array" || !Array.isArray(node.value)) {
    geometryFail("shape list must be an exported array node", id);
  }
  return node;
}

function dynlistConstants(index) {
  const module = index.modules.get("DynlistProc.js");
  if (!module || module.kind !== "constants") geometryFail("DynlistProc constants module is absent");
  for (const name of ["D_DATA_GRP", "D_MATERIAL", "D_SHAPE"]) {
    if (!Number.isSafeInteger(module.constants?.[name])) geometryFail(`missing DynlistProc constant ${name}`);
  }
  return module.constants;
}

function completeMaterial(material, source) {
  if (!material) return;
  geometryInteger(material.sourceMaterialId, "material id", source);
  if (!material.ambient || !material.diffuse) geometryFail("material is missing ambient or diffuse source state", source);
}

function parseShapeCommands(commands, constants, source) {
  if (!Array.isArray(commands) || commands.length < 2) geometryFail("dynlist is empty", source);
  if (commands[0]?.cmd !== HEAD_GEOMETRY_COMMAND.START_LIST) geometryFail("dynlist does not start with StartList", source);
  if (commands.at(-1)?.cmd !== HEAD_GEOMETRY_COMMAND.STOP_LIST) geometryFail("dynlist does not end with StopList", source);

  const dataGroups = new Map();
  const materials = [];
  let currentObject = null;
  let materialGroupId = null;
  let currentMaterial = null;
  let shape = null;

  for (let commandIndex = 1; commandIndex < commands.length - 1; commandIndex += 1) {
    const command = commands[commandIndex];
    const location = `${source}:command-${commandIndex}`;
    switch (command?.cmd) {
      case HEAD_GEOMETRY_COMMAND.MAKE_DYNOBJ: {
        const type = geometryInteger(command.args?.w2, "dynamic object type", location);
        const id = geometryInteger(command.args?.w1, "dynamic object id", location);
        if (type === constants.D_DATA_GRP) {
          if (dataGroups.has(id)) geometryFail(`duplicate data-group id ${id}`, location);
          currentObject = { kind: "data-group", id, ref: null };
          dataGroups.set(id, currentObject);
        } else if (type === constants.D_MATERIAL) {
          if (materialGroupId === null) geometryFail("material object is outside its source group", location);
          completeMaterial(currentMaterial, location);
          currentMaterial = { sourceMaterialId: null, ambient: null, diffuse: null };
          materials.push(currentMaterial);
          currentObject = { kind: "material" };
        } else if (type === constants.D_SHAPE) {
          if (shape) geometryFail("dynlist declares more than one shape", location);
          shape = {
            shapeObjectId: id,
            vertexGroupId: null,
            faceGroupId: null,
            materialGroupId: null,
          };
          currentObject = { kind: "shape" };
        } else {
          geometryFail(`unsupported dynamic object type ${type}`, location);
        }
        break;
      }
      case HEAD_GEOMETRY_COMMAND.LINK_WITH_PTR: {
        if (currentObject?.kind !== "data-group") geometryFail("LinkWithPtr is not attached to a data group", location);
        if (currentObject.ref) geometryFail(`data-group ${currentObject.id} has multiple pointers`, location);
        currentObject.ref = refId(command.args?.w1, "data-group pointer", location);
        break;
      }
      case HEAD_GEOMETRY_COMMAND.START_GROUP: {
        if (materialGroupId !== null) geometryFail("nested material groups are not allowed", location);
        materialGroupId = geometryInteger(command.args, "material group id", location);
        currentObject = null;
        currentMaterial = null;
        break;
      }
      case HEAD_GEOMETRY_COMMAND.SET_ID: {
        if (currentObject?.kind !== "material" || !currentMaterial) geometryFail("SetId is not attached to a material", location);
        if (currentMaterial.sourceMaterialId !== null) geometryFail("material id is assigned twice", location);
        const id = geometryInteger(command.args?.id, "material id", location);
        if (materials.slice(0, -1).some((material) => material.sourceMaterialId === id)) {
          geometryFail(`duplicate material id ${id}`, location);
        }
        currentMaterial.sourceMaterialId = id;
        break;
      }
      case HEAD_GEOMETRY_COMMAND.SET_AMBIENT:
        if (!currentMaterial || currentMaterial.ambient) geometryFail("unexpected duplicate ambient state", location);
        currentMaterial.ambient = rgb(command, "ambient", location);
        break;
      case HEAD_GEOMETRY_COMMAND.SET_DIFFUSE:
        if (!currentMaterial || currentMaterial.diffuse) geometryFail("unexpected duplicate diffuse state", location);
        currentMaterial.diffuse = rgb(command, "diffuse", location);
        break;
      case HEAD_GEOMETRY_COMMAND.END_GROUP: {
        if (geometryInteger(command.args, "material group id", location) !== materialGroupId) {
          geometryFail("material group close id does not match its open id", location);
        }
        completeMaterial(currentMaterial, location);
        currentMaterial = null;
        currentObject = null;
        break;
      }
      case HEAD_GEOMETRY_COMMAND.SET_NODE_GROUP:
        if (!shape || currentObject?.kind !== "shape" || shape.vertexGroupId !== null) {
          geometryFail("unexpected shape node-group binding", location);
        }
        shape.vertexGroupId = geometryInteger(command.args?.w1, "vertex group id", location);
        break;
      case HEAD_GEOMETRY_COMMAND.SET_PLANE_GROUP:
        if (!shape || currentObject?.kind !== "shape" || shape.faceGroupId !== null) {
          geometryFail("unexpected shape plane-group binding", location);
        }
        shape.faceGroupId = geometryInteger(command.args?.w1, "face group id", location);
        break;
      case HEAD_GEOMETRY_COMMAND.SET_MATERIAL_GROUP:
        if (!shape || currentObject?.kind !== "shape" || shape.materialGroupId !== null) {
          geometryFail("unexpected shape material-group binding", location);
        }
        shape.materialGroupId = geometryInteger(command.args?.w1, "shape material group id", location);
        break;
      default:
        geometryFail(`unsupported shape-list command ${command?.cmd}`, location);
    }
  }

  completeMaterial(currentMaterial, source);
  if (!shape) geometryFail("dynlist did not create a shape", source);
  if (dataGroups.size !== 2) geometryFail(`expected two data groups, received ${dataGroups.size}`, source);
  for (const group of dataGroups.values()) {
    if (!group.ref) geometryFail(`data-group ${group.id} has no pointer`, source);
  }
  if (!dataGroups.has(shape.vertexGroupId)) geometryFail("shape vertex group does not resolve", source);
  if (!dataGroups.has(shape.faceGroupId)) geometryFail("shape face group does not resolve", source);
  if (shape.vertexGroupId === shape.faceGroupId) geometryFail("shape vertex and face groups alias", source);
  if (shape.materialGroupId !== materialGroupId) geometryFail("shape material group does not resolve", source);
  if (materials.length === 0) geometryFail("shape has no materials", source);

  return {
    ...shape,
    vertexInfoRef: dataGroups.get(shape.vertexGroupId).ref,
    faceInfoRef: dataGroups.get(shape.faceGroupId).ref,
    materials,
  };
}

function resolveDataArray(index, infoRef, label, source) {
  const infoNode = geometryRequireNode(index, infoRef, source);
  if (infoNode.kind !== "object" || infoNode.value?.type !== 1) {
    geometryFail(`${label} info must be a type-1 object node`, source);
  }
  const dataRef = refId(infoNode.value.data, `${label} data`, source);
  const dataNode = geometryRequireNode(index, dataRef, source);
  if (dataNode.kind !== "array" || !Array.isArray(dataNode.value)) {
    geometryFail(`${label} data must resolve to an array node`, source);
  }
  return { dataRef, value: dataNode.value };
}

function normalizeVertices(rows, source) {
  return rows.map((row, vertexIndex) => {
    const location = `${source}:vertex-${vertexIndex}`;
    if (!Array.isArray(row) || row.length !== 3) geometryFail("vertex must have exactly three components", location);
    return row.map((component, axis) => {
      const value = geometryInteger(component, `vertex axis ${axis}`, location);
      if (value < -32768 || value > 32767) geometryFail("vertex component is outside signed 16-bit source range", location);
      return value;
    });
  });
}

function crossForFace(vertices, indices) {
  const [a, b, c] = indices.map((index) => vertices[index]);
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [
    (ab[1] * ac[2]) - (ab[2] * ac[1]),
    (ab[2] * ac[0]) - (ab[0] * ac[2]),
    (ab[0] * ac[1]) - (ab[1] * ac[0]),
  ];
}

function normalizeFaces(rows, vertices, materials, shapeId, source) {
  const materialIds = new Set(materials.map((material) => material.sourceMaterialId));
  return rows.map((row, faceIndex) => {
    const location = `${source}:face-${faceIndex}`;
    if (!Array.isArray(row) || row.length !== 4) geometryFail("face must contain material plus three indices", location);
    const sourceMaterialId = geometryInteger(row[0], "face material id", location);
    if (!materialIds.has(sourceMaterialId)) geometryFail(`face material ${sourceMaterialId} is undefined`, location);
    const indices = row.slice(1).map((value, corner) => {
      const index = geometryInteger(value, `face index ${corner}`, location);
      if (index < 0 || index >= vertices.length) geometryFail(`face index ${index} is outside 0..${vertices.length - 1}`, location);
      return index;
    });
    if (new Set(indices).size !== 3) geometryFail("face repeats a vertex index", location);
    if (crossForFace(vertices, indices).every((component) => component === 0)) {
      geometryFail("face has zero source area", location);
    }
    return {
      id: `${shapeId}:face:${faceIndex}`,
      sourceIndex: faceIndex,
      materialId: `${shapeId}:material:${sourceMaterialId}`,
      sourceMaterialId,
      indices,
    };
  });
}

function boundsFor(vertices) {
  const min = [...vertices[0]];
  const max = [...vertices[0]];
  for (const vertex of vertices.slice(1)) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  return { min, max };
}

function normalizeShape(graphIndex, constants, descriptor) {
  const list = requireListNode(graphIndex, descriptor);
  const source = list.id;
  const parsed = parseShapeCommands(list.value, constants, source);
  const vertexData = resolveDataArray(graphIndex, parsed.vertexInfoRef, "vertex", source);
  const faceData = resolveDataArray(graphIndex, parsed.faceInfoRef, "face", source);
  const vertices = normalizeVertices(vertexData.value, source);
  if (vertices.length === 0) geometryFail("shape has no vertices", source);
  const materials = parsed.materials.map((material) => ({
    id: `${descriptor.id}:material:${material.sourceMaterialId}`,
    sourceMaterialId: material.sourceMaterialId,
    ambient: [...material.ambient],
    diffuse: [...material.diffuse],
  }));
  const faces = normalizeFaces(faceData.value, vertices, materials, descriptor.id, source);
  if (faces.length === 0) geometryFail("shape has no faces", source);
  for (const material of materials) {
    material.usedByFaceCount = faces.filter((face) => face.sourceMaterialId === material.sourceMaterialId).length;
  }

  const payload = {
    id: descriptor.id,
    role: descriptor.role,
    source: {
      module: descriptor.module,
      list: descriptor.list,
      listRef: list.id,
      shapeObjectId: parsed.shapeObjectId,
      vertexGroupId: parsed.vertexGroupId,
      faceGroupId: parsed.faceGroupId,
      materialGroupId: parsed.materialGroupId,
      vertexInfoRef: parsed.vertexInfoRef,
      vertexDataRef: vertexData.dataRef,
      faceInfoRef: parsed.faceInfoRef,
      faceDataRef: faceData.dataRef,
    },
    topology: {
      primitive: "triangle",
      winding: "source-i0-i1-i2",
      productBackfacePolicy: "visible",
      runtimeCulling: "forbidden",
    },
    bounds: boundsFor(vertices),
    counts: {
      vertices: vertices.length,
      faces: faces.length,
      materials: materials.length,
    },
    vertices,
    faces,
    materials,
  };
  return {
    ...payload,
    hashes: {
      vertices: titleHeadContentHash(vertices),
      orderedFaces: titleHeadContentHash(faces.map((face) => [face.sourceMaterialId, ...face.indices])),
      materials: titleHeadContentHash(materials),
      shape: titleHeadContentHash(payload),
    },
  };
}

function validateMasterShapeLinks(graphIndex) {
  const descriptor = {
    module: "dynlists/dynlist_mario_master.js",
    list: "dynlist_mario_master",
  };
  const master = requireListNode(graphIndex, descriptor);
  const actual = master.value
    .filter((command) => command?.cmd === HEAD_GEOMETRY_COMMAND.JUMP_TO_LIST)
    .map((command) => refId(command.args?.list, "JumpToList target", master.id));
  const expected = TITLE_HEAD_SHAPE_SOURCES.map(({ module, list }) => `${module}#${list}`);
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    geometryFail("master shape-list order does not match the six regular-head shapes", master.id);
  }
  return { listRef: master.id, shapeListRefs: actual };
}

function normalizeProvenance(graph, provenance) {
  if (!provenance || typeof provenance !== "object") geometryFail("geometry provenance is required");
  const sm64jsRevision = String(provenance.sm64jsRevision ?? "");
  const authoritativeRevision = String(provenance.authoritativeRevision ?? "");
  const rom = provenance.rom;
  if (!/^[a-f0-9]{40}$/.test(sm64jsRevision)) geometryFail("sm64js revision must be a full SHA-1");
  if (!/^[a-f0-9]{40}$/.test(authoritativeRevision)) geometryFail("authoritative revision must be a full SHA-1");
  if (!rom || !/^[a-f0-9]{40}$/.test(String(rom.sha1 ?? ""))) geometryFail("qualified ROM SHA-1 is required");
  if (!Number.isSafeInteger(rom.size) || rom.size <= 0) geometryFail("qualified ROM size is required");
  return {
    authority: "user-rom-local-prepare",
    sm64js: { revision: sm64jsRevision, role: "ignored-dynlist-data-input" },
    n64decompSm64: { revision: authoritativeRevision, role: "authoritative-source-reference" },
    rom: {
      region: String(rom.region),
      byteOrder: String(rom.byteOrder),
      size: rom.size,
      sha1: rom.sha1,
      copied: false,
      retainedInOutput: false,
    },
    sourceFiles: graph.sources.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
    dynlistGraphHash: titleHeadContentHash(graph),
  };
}

function buildTitleHeadGeometry({ graph, provenance } = {}) {
  const graphIndex = buildGraphIndex(graph);
  const constants = dynlistConstants(graphIndex);
  const master = validateMasterShapeLinks(graphIndex);
  const shapes = TITLE_HEAD_SHAPE_SOURCES.map((descriptor) => (
    normalizeShape(graphIndex, constants, descriptor)
  ));
  const shapeIds = new Set(shapes.map((shape) => shape.id));
  const shapeObjectIds = new Set(shapes.map((shape) => shape.source.shapeObjectId));
  if (shapeIds.size !== shapes.length) geometryFail("prepared shape ids are not unique");
  if (shapeObjectIds.size !== shapes.length) geometryFail("source shape object ids are not unique");

  const totals = shapes.reduce((result, shape) => ({
    shapes: result.shapes + 1,
    vertices: result.vertices + shape.counts.vertices,
    faces: result.faces + shape.counts.faces,
    materials: result.materials + shape.counts.materials,
  }), { shapes: 0, vertices: 0, faces: 0, materials: 0 });
  const payload = {
    schema: TITLE_HEAD_GEOMETRY_SCHEMA,
    slice: "sm64-regular-interactive-title-head",
    coordinateSystem: {
      source: "goddard-s16-xyz",
      vertexComponents: "signed-source-integers",
      triangleWinding: "source-i0-i1-i2",
      modelBackfaces: "visible",
    },
    master,
    totals,
    provenance: normalizeProvenance(graph, provenance),
    shapes,
  };
  return { ...payload, contentHash: titleHeadContentHash(payload) };
}

// deformationGraph
const TITLE_HEAD_DEFORMATION_SCHEMA = "cssgraphics-title-head-deformation@1";

const DEFORMATION_COMMAND = Object.freeze({
  MAKE_DYNOBJ: 15,
  SET_TYPE: 19,
  SET_FLAG: 8,
  SET_SHAPE_PTR: 25,
  SET_SCALE: 5,
  SET_ROTATION: 6,
  SET_ATTACH_OFFSET: 41,
  MAKE_NET_WITH_SUBGROUP: 46,
  ATTACH_TO: 40,
  SET_SKIN_SHAPE: 22,
  ATTACH_NET_TO_JOINT: 47,
  SET_SKIN_WEIGHT: 32,
  END_NET_SUBGROUP: 48,
});

const CONTROL_CONTRACT = Object.freeze([
  Object.freeze({ id: "grab-left-ear", role: "left-ear", mode: "grab", attachments: [167] }),
  Object.freeze({ id: "grab-right-ear", role: "right-ear", mode: "grab", attachments: [176] }),
  Object.freeze({ id: "grab-cap", role: "cap", mode: "grab", attachments: [131, 206, 215, 31, 65] }),
  Object.freeze({ id: "grab-nose", role: "nose", mode: "grab", attachments: [185] }),
  Object.freeze({ id: "grab-jaw", role: "jaw", mode: "grab", attachments: [194] }),
  Object.freeze({ id: "grab-right-lip-corner", role: "right-lip-corner", mode: "grab", attachments: [158, 15] }),
  Object.freeze({ id: "grab-left-lip-corner", role: "left-lip-corner", mode: "grab", attachments: [149, 6] }),
  Object.freeze({ id: "eye-follow-left", role: "left-eye-follow", mode: "eye-follow", attachments: [112] }),
  Object.freeze({ id: "eye-follow-right", role: "right-eye-follow", mode: "eye-follow", attachments: [96] }),
]);

function deformationFail(message, source = null) {
  throw new TypeError(source ? `${source}: ${message}` : message);
}

function finite(value, label, source) {
  if (typeof value !== "number" || !Number.isFinite(value)) deformationFail(`${label} must be finite`, source);
  return value;
}

function deformationInteger(value, label, source) {
  if (!Number.isSafeInteger(value)) deformationFail(`${label} must be a safe integer`, source);
  return value;
}

function vector(command, label, source) {
  const vec = command?.args?.vec;
  return [
    finite(vec?.x, `${label}.x`, source),
    finite(vec?.y, `${label}.y`, source),
    finite(vec?.z, `${label}.z`, source),
  ];
}

function graphModule(graph, path) {
  const module = graph.modules?.find((candidate) => candidate.path === path);
  if (!module) deformationFail(`missing graph module ${path}`);
  return module;
}

function deformationGraphNode(graph, id) {
  const node = graph.modules
    ?.flatMap((module) => module.nodes ?? [])
    .find((candidate) => candidate.id === id);
  if (!node) deformationFail(`missing graph node ${id}`);
  return node;
}

function parseTitleHeadDynobjNames(source) {
  const marker = source.indexOf("// Dynamic Object names");
  if (marker < 0) deformationFail("dynamic-object enum marker was not found", "src/goddard/dynlists/dynlists.h");
  const enumStart = source.indexOf("enum", marker);
  const bodyStart = source.indexOf("{", enumStart);
  const bodyEnd = source.indexOf("};", bodyStart);
  if (enumStart < 0 || bodyStart < 0 || bodyEnd < 0) {
    deformationFail("dynamic-object enum body was not found", "src/goddard/dynlists/dynlists.h");
  }
  const entries = new Map();
  const names = new Set();
  for (const line of source.slice(bodyStart + 1, bodyEnd).split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(0x[\da-f]+|\d+)\s*,?/iu);
    if (!match) continue;
    const name = match[1];
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value)) deformationFail(`invalid dynamic-object value for ${name}`);
    if (entries.has(value)) deformationFail(`duplicate dynamic-object value ${value}`);
    if (names.has(name)) deformationFail(`duplicate dynamic-object name ${name}`);
    entries.set(value, name);
    names.add(name);
  }
  if (entries.size < 70) deformationFail(`dynamic-object enum is unexpectedly short (${entries.size})`);
  return entries;
}

function deformationFunctionBody(source, signature, path) {
  const signatureIndex = source.indexOf(signature);
  if (signatureIndex < 0) deformationFail(`${signature} was not found`, path);
  const start = source.indexOf("{", signatureIndex);
  if (start < 0) deformationFail(`${signature} has no body`, path);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  deformationFail(`${signature} body is unterminated`, path);
}

function parseNumberLiteral(value, label) {
  const parsed = Number(value.replace(/f$/u, ""));
  if (!Number.isFinite(parsed)) deformationFail(`invalid ${label} literal ${value}`);
  return parsed;
}

function parseLoadMarioHeadControls(source, dynobjNames) {
  const path = "src/goddard/shape_helper.c";
  const body = deformationFunctionBody(source, "s32 load_mario_head(", path);
  const start = body.indexOf("// Make grabbers to move the face with the cursor");
  const end = body.indexOf("sp48 = make_group_of_type", start);
  if (start < 0 || end < 0) deformationFail("load_mario_head grabber block was not found", path);

  const controls = [];
  let current = null;
  let pendingAttachment = null;
  const finish = () => {
    if (!current) return;
    if (pendingAttachment) deformationFail("faceJoint source lookup was not attached", path);
    if (current.attachments.length === 0) deformationFail("grabber has no source attachment", path);
    controls.push(current);
    current = null;
  };

  const numeric = "([-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)f?)";
  const makePattern = new RegExp(
    `grabberJoint\\s*=\\s*make_grabber_joint\\(sGrabJointTestShape,\\s*0,\\s*${numeric},\\s*${numeric},\\s*${numeric}\\);`,
    "u",
  );
  for (const line of body.slice(start, end).split(/\r?\n/u)) {
    const make = line.match(makePattern);
    if (make) {
      finish();
      current = {
        sourceOrder: controls.length,
        position: [
          parseNumberLiteral(make[1], "grabber x"),
          parseNumberLiteral(make[2], "grabber y"),
          parseNumberLiteral(make[3], "grabber z"),
        ],
        attachments: [],
        updateFunction: "default-grabber",
        rootAnimator: false,
        grabbable: true,
      };
      continue;
    }

    const lookup = line.match(/faceJoint\s*=\s*d_use_obj\("N(\d+)l"\);\s*\/\/\s*([A-Z0-9_]+)/u);
    if (lookup) {
      if (!current) deformationFail("faceJoint lookup appears before a grabber", path);
      if (pendingAttachment) deformationFail("faceJoint lookup was replaced before attachment", path);
      const sourceObjectId = Number(lookup[1]);
      const sourceName = lookup[2];
      if (dynobjNames.get(sourceObjectId) !== sourceName) {
        deformationFail(`faceJoint N${sourceObjectId} comment disagrees with dynlists.h (${sourceName})`, path);
      }
      pendingAttachment = { sourceObjectId, sourceName };
      continue;
    }

    if (
      /grabberJoint->attachedObjsGrp\s*=\s*make_group\(1,\s*faceJoint\);/u.test(line)
      || /addto_group\(grabberJoint->attachedObjsGrp,\s*faceJoint\);/u.test(line)
    ) {
      if (!current || !pendingAttachment) deformationFail("attachment statement has no faceJoint lookup", path);
      current.attachments.push(pendingAttachment);
      pendingAttachment = null;
      continue;
    }
    if (/grabberJoint->updateFunc\s*=\s*eye_joint_update_func;/u.test(line)) {
      if (!current) deformationFail("eye update assignment has no grabber", path);
      current.updateFunction = "eye_joint_update_func";
      continue;
    }
    if (/grabberJoint->rootAnimator\s*=\s*animator;/u.test(line)) {
      if (!current) deformationFail("root animator assignment has no grabber", path);
      current.rootAnimator = true;
      continue;
    }
    if (/grabberJoint->header\.drawFlags\s*&=\s*~OBJ_IS_GRABBABLE;/u.test(line)) {
      if (!current) deformationFail("grabbable flag update has no grabber", path);
      current.grabbable = false;
    }
  }
  finish();

  if (controls.length !== CONTROL_CONTRACT.length) {
    deformationFail(`expected ${CONTROL_CONTRACT.length} source controls, received ${controls.length}`, path);
  }
  return controls.map((control, index) => {
    const contract = CONTROL_CONTRACT[index];
    const actualIds = control.attachments.map((attachment) => attachment.sourceObjectId);
    if (
      actualIds.length !== contract.attachments.length
      || actualIds.some((value, attachmentIndex) => value !== contract.attachments[attachmentIndex])
    ) deformationFail(`control ${index} attachment order no longer matches the regular-head contract`, path);
    const isEye = control.updateFunction === "eye_joint_update_func";
    if ((contract.mode === "eye-follow") !== isEye) deformationFail(`control ${index} mode no longer matches source`, path);
    if (isEye && (control.grabbable || !control.rootAnimator)) {
      deformationFail(`eye-follow control ${index} is missing its source flags`, path);
    }
    if (!isEye && (!control.grabbable || control.rootAnimator)) {
      deformationFail(`grab control ${index} has unexpected eye-follow flags`, path);
    }
    return { ...contract, ...control };
  });
}

function newTransform() {
  return { scale: null, rotationDegrees: null, attachOffset: null };
}

function stableObjectId(sourceObjectId) {
  return `N${sourceObjectId}`;
}

function assignTransform(object, field, value, source) {
  if (object.transform[field]) deformationFail(`${field} is assigned more than once`, source);
  object.transform[field] = value;
}

function parseMasterObjects(graph, geometry, dynobjNames) {
  if (graph?.schema !== TITLE_HEAD_DYNLIST_GRAPH_SCHEMA) deformationFail("invalid dynlist graph schema");
  if (geometry?.schema !== TITLE_HEAD_GEOMETRY_SCHEMA) deformationFail("invalid title-head geometry schema");
  const constants = graphModule(graph, "DynlistProc.js").constants;
  const master = deformationGraphNode(graph, "dynlists/dynlist_mario_master.js#dynlist_mario_master");
  if (!Array.isArray(master.value)) deformationFail("master dynlist is not an array");
  const commands = master.value;
  const start = commands.findIndex((command) => (
    command?.cmd === DEFORMATION_COMMAND.MAKE_DYNOBJ
    && command.args?.w2 === constants.D_NET
    && command.args?.w1 === 221
  ));
  const end = commands.findIndex((command, index) => (
    index > start
    && command?.cmd === DEFORMATION_COMMAND.MAKE_DYNOBJ
    && command.args?.w2 === constants.D_DATA_GRP
  ));
  if (start < 0 || end < 0 || end <= start) deformationFail("master net/joint command range was not found", master.id);

  const nets = [];
  const joints = [];
  const objects = new Map();
  let current = null;
  let subgroup = null;

  const addObject = (object, location) => {
    const sourceName = dynobjNames.get(object.sourceObjectId)
      ?? (object.kind === "net" && object.sourceObjectId === 0x8F ? "DYNOBJ_LITERAL_0x8F" : null);
    if (!sourceName) deformationFail(`N${object.sourceObjectId} is absent from dynlists.h`, location);
    if (objects.has(object.sourceObjectId)) deformationFail(`duplicate dynamic object N${object.sourceObjectId}`, location);
    object.id = stableObjectId(object.sourceObjectId);
    object.sourceName = sourceName;
    object.sourceNameAuthority = dynobjNames.has(object.sourceObjectId)
      ? "dynlists.h-enum"
      : "master-literal-0x8f";
    object.sourceCommandIndex = object.sourceCommandIndex ?? Number(location.split("-").at(-1));
    objects.set(object.sourceObjectId, object);
    return object;
  };

  for (let commandIndex = start; commandIndex < end; commandIndex += 1) {
    const command = commands[commandIndex];
    const location = `${master.id}:command-${commandIndex}`;
    switch (command?.cmd) {
      case DEFORMATION_COMMAND.MAKE_DYNOBJ: {
        if (command.args?.w2 !== constants.D_NET) deformationFail("non-net object entered deformation prefix", location);
        if (subgroup) deformationFail("explicit net is nested inside a skin subgroup", location);
        current = addObject({
          kind: "net",
          constructor: "d_makeobj",
          sourceObjectId: deformationInteger(command.args?.w1, "net id", location),
          sourceCommandIndex: commandIndex,
          parentSourceObjectId: null,
          attachFlags: null,
          objectType: null,
          flagMask: 0,
          displayShapeObjectId: null,
          skinShapeObjectId: null,
          transform: newTransform(),
          jointSourceObjectIds: [],
        }, location);
        nets.push(current);
        break;
      }
      case DEFORMATION_COMMAND.MAKE_NET_WITH_SUBGROUP: {
        if (subgroup) deformationFail("skin net subgroups may not nest", location);
        current = addObject({
          kind: "net",
          constructor: "d_add_net_with_subgroup",
          sourceObjectId: deformationInteger(command.args?.w1, "skin net id", location),
          sourceCommandIndex: commandIndex,
          parentSourceObjectId: null,
          attachFlags: null,
          objectType: 4,
          flagMask: 0,
          implicitInvisible: true,
          displayShapeObjectId: null,
          skinShapeObjectId: null,
          transform: newTransform(),
          jointSourceObjectIds: [],
        }, location);
        nets.push(current);
        subgroup = { net: current, parent: current };
        break;
      }
      case DEFORMATION_COMMAND.ATTACH_NET_TO_JOINT: {
        if (!subgroup) deformationFail("joint is outside a skin net subgroup", location);
        const joint = addObject({
          kind: "joint",
          constructor: "d_attach_joint_to_net",
          sourceObjectId: deformationInteger(command.args?.w1, "joint id", location),
          sourceCommandIndex: commandIndex,
          parentSourceObjectId: subgroup.parent.sourceObjectId,
          attachFlags: 0xD,
          objectType: 3,
          transform: newTransform(),
          skinNetSourceObjectId: subgroup.net.sourceObjectId,
          weights: [],
        }, location);
        joints.push(joint);
        subgroup.net.jointSourceObjectIds.push(joint.sourceObjectId);
        subgroup.parent = joint;
        current = joint;
        break;
      }
      case DEFORMATION_COMMAND.END_NET_SUBGROUP:
        if (!subgroup) deformationFail("skin net subgroup close has no open subgroup", location);
        if (deformationInteger(command.args?.w1, "skin net close id", location) !== subgroup.net.sourceObjectId) {
          deformationFail("skin net subgroup closes a different net", location);
        }
        if (subgroup.net.jointSourceObjectIds.length === 0) deformationFail("skin net has no joints", location);
        current = subgroup.net;
        subgroup = null;
        break;
      case DEFORMATION_COMMAND.ATTACH_TO:
        if (!current || current.kind !== "net") deformationFail("AttachTo is not applied to a net", location);
        if (current.parentSourceObjectId !== null) deformationFail("net parent is assigned more than once", location);
        current.parentSourceObjectId = deformationInteger(command.args?.w1, "parent object id", location);
        current.attachFlags = deformationInteger(command.args?.w2, "attach flags", location);
        break;
      case DEFORMATION_COMMAND.SET_SKIN_SHAPE:
        if (!current || current.kind !== "net" || current.skinShapeObjectId !== null) {
          deformationFail("unexpected SetSkinShape", location);
        }
        current.skinShapeObjectId = deformationInteger(command.args?.w1, "skin shape id", location);
        break;
      case DEFORMATION_COMMAND.SET_SHAPE_PTR:
        if (!current || current.kind !== "net" || current.displayShapeObjectId !== null) {
          deformationFail("unexpected SetShapePtr", location);
        }
        current.displayShapeObjectId = deformationInteger(command.args?.w1, "display shape id", location);
        break;
      case DEFORMATION_COMMAND.SET_TYPE:
        if (!current || current.kind !== "net" || current.constructor !== "d_makeobj" || current.objectType !== null) {
          deformationFail("unexpected SetType", location);
        }
        current.objectType = deformationInteger(command.args?.w2, "net type", location);
        break;
      case DEFORMATION_COMMAND.SET_FLAG:
        if (!current || current.kind !== "net") deformationFail("unexpected SetFlag", location);
        current.flagMask |= deformationInteger(command.args?.w2, "net flag mask", location);
        break;
      case DEFORMATION_COMMAND.SET_SCALE:
        if (!current) deformationFail("SetScale has no active net or joint", location);
        assignTransform(current, "scale", vector(command, "scale", location), location);
        break;
      case DEFORMATION_COMMAND.SET_ROTATION:
        if (!current) deformationFail("SetRotation has no active net or joint", location);
        assignTransform(current, "rotationDegrees", vector(command, "rotation", location), location);
        break;
      case DEFORMATION_COMMAND.SET_ATTACH_OFFSET:
        if (!current) deformationFail("SetAttachOffset has no active net or joint", location);
        assignTransform(current, "attachOffset", vector(command, "attach offset", location), location);
        break;
      case DEFORMATION_COMMAND.SET_SKIN_WEIGHT: {
        if (!current || current.kind !== "joint" || !subgroup) deformationFail("skin weight has no active subgroup joint", location);
        const vertexIndex = deformationInteger(command.args?.w2, "skin vertex index", location);
        const percent = finite(command.args?.vec?.x, "skin weight percent", location);
        if (vertexIndex < 0 || percent <= 0 || percent > 100) deformationFail("skin weight is outside source bounds", location);
        if (current.weights.some((weight) => weight.vertexIndex === vertexIndex)) {
          deformationFail(`joint repeats skin vertex ${vertexIndex}`, location);
        }
        current.weights.push({
          sourceOrder: current.weights.length,
          sourceCommandIndex: commandIndex,
          vertexIndex,
          percent,
          scalar: percent / 100,
        });
        break;
      }
      default:
        deformationFail(`unsupported deformation command ${command?.cmd}`, location);
    }
  }
  if (subgroup) deformationFail("master deformation prefix ends inside a skin subgroup", master.id);

  const shapeByObjectId = new Map(geometry.shapes.map((shape) => [shape.source.shapeObjectId, shape]));
  if (shapeByObjectId.size !== geometry.shapes.length) deformationFail("geometry shape object ids are ambiguous");
  for (const object of objects.values()) {
    for (const [field, value] of Object.entries(object.transform)) {
      if (!value) deformationFail(`${object.id} has no source ${field}`);
    }
    if (object.sourceObjectId !== 221 && object.parentSourceObjectId === null) {
      deformationFail(`${object.id} has no parent`);
    }
    if (object.sourceObjectId === 221 && object.parentSourceObjectId !== null) {
      deformationFail("main net unexpectedly has a parent");
    }
    if (object.parentSourceObjectId !== null && !objects.has(object.parentSourceObjectId)) {
      deformationFail(`${object.id} has unresolved parent N${object.parentSourceObjectId}`);
    }
  }

  for (const net of nets) {
    const shapeObjectId = net.skinShapeObjectId ?? net.displayShapeObjectId;
    if (shapeObjectId !== null && !shapeByObjectId.has(shapeObjectId)) {
      deformationFail(`${net.id} references unresolved shape N${shapeObjectId}`);
    }
    if (net.constructor === "d_add_net_with_subgroup" && net.skinShapeObjectId === null) {
      deformationFail(`${net.id} skin subgroup has no skin shape`);
    }
  }

  for (const joint of joints) {
    const skinNet = objects.get(joint.skinNetSourceObjectId);
    if (!skinNet || skinNet.kind !== "net" || skinNet.skinShapeObjectId === null) {
      deformationFail(`${joint.id} has unresolved skin net`);
    }
    const shape = shapeByObjectId.get(skinNet.skinShapeObjectId);
    for (const weight of joint.weights) {
      if (weight.vertexIndex >= shape.counts.vertices) {
        deformationFail(`${joint.id} weight vertex ${weight.vertexIndex} is outside ${shape.id}`);
      }
      weight.id = `${joint.id}:weight:${weight.sourceOrder}`;
      weight.vertexId = `${shape.id}:vertex:${weight.vertexIndex}`;
    }
  }

  const visitState = new Map();
  const reachesRoot = (object) => {
    if (visitState.get(object.id) === "visiting") deformationFail(`object parent cycle reaches ${object.id}`);
    if (visitState.get(object.id) === "complete") return true;
    visitState.set(object.id, "visiting");
    if (object.sourceObjectId !== 221) reachesRoot(objects.get(object.parentSourceObjectId));
    visitState.set(object.id, "complete");
    return true;
  };
  for (const object of objects.values()) reachesRoot(object);

  for (const object of objects.values()) object.childIds = [];
  for (const object of objects.values()) {
    if (object.parentSourceObjectId !== null) {
      objects.get(object.parentSourceObjectId).childIds.push(object.id);
    }
    object.parentId = object.parentSourceObjectId === null ? null : stableObjectId(object.parentSourceObjectId);
  }

  const normalizedNets = nets.map((net) => {
    const skinShape = net.skinShapeObjectId === null ? null : shapeByObjectId.get(net.skinShapeObjectId);
    const displayShape = net.displayShapeObjectId === null ? null : shapeByObjectId.get(net.displayShapeObjectId);
    const jointIds = net.jointSourceObjectIds.map(stableObjectId);
    const weightEntries = joints
      .filter((joint) => joint.skinNetSourceObjectId === net.sourceObjectId)
      .flatMap((joint) => joint.weights);
    return {
      id: net.id,
      sourceObjectId: net.sourceObjectId,
      sourceName: net.sourceName,
      sourceNameAuthority: net.sourceNameAuthority,
      sourceCommandIndex: net.sourceCommandIndex,
      constructor: net.constructor,
      objectType: net.objectType,
      flagMask: net.flagMask,
      implicitInvisible: Boolean(net.implicitInvisible),
      parentId: net.parentId,
      attachFlags: net.attachFlags,
      childIds: net.childIds,
      jointIds,
      displayShapeId: displayShape?.id ?? null,
      displayShapeObjectId: net.displayShapeObjectId,
      skinShapeId: skinShape?.id ?? null,
      skinShapeObjectId: net.skinShapeObjectId,
      transform: {
        ...net.transform,
        matrixContract: "source-f32-scale-rotation-attach-offset-runtime-order",
      },
      weightEntryCount: weightEntries.length,
      referencedVertexCount: new Set(weightEntries.map((weight) => weight.vertexId)).size,
    };
  });
  const normalizedJoints = joints.map((joint) => ({
    id: joint.id,
    sourceObjectId: joint.sourceObjectId,
    sourceName: joint.sourceName,
    sourceNameAuthority: joint.sourceNameAuthority,
    sourceCommandIndex: joint.sourceCommandIndex,
    constructor: joint.constructor,
    objectType: joint.objectType,
    parentId: joint.parentId,
    attachFlags: joint.attachFlags,
    childIds: joint.childIds,
    skinNetId: stableObjectId(joint.skinNetSourceObjectId),
    transform: {
      ...joint.transform,
      matrixContract: "source-f32-scale-rotation-attach-offset-runtime-order",
    },
    weights: joint.weights,
  }));

  return {
    sourceRange: { listRef: master.id, firstCommand: start, endCommandExclusive: end },
    rootNetId: "N221",
    nets: normalizedNets,
    joints: normalizedJoints,
    objectMap: objects,
  };
}

function validateControls(controls, objectMap) {
  return controls.map((control) => ({
    id: control.id,
    role: control.role,
    mode: control.mode,
    sourceOrder: control.sourceOrder,
    sourcePosition: control.position,
    grabbable: control.grabbable,
    updateFunction: control.updateFunction,
    rootAnimator: control.rootAnimator,
    attachments: control.attachments.map((attachment, index) => {
      const object = objectMap.get(attachment.sourceObjectId);
      if (!object) deformationFail(`${control.id} references unresolved ${stableObjectId(attachment.sourceObjectId)}`);
      if (object.sourceName !== attachment.sourceName) deformationFail(`${control.id} attachment name is ambiguous`);
      return {
        sourceOrder: index,
        objectId: object.id,
        sourceObjectId: object.sourceObjectId,
        sourceName: object.sourceName,
        objectType: object.kind,
      };
    }),
  }));
}

function buildTitleHeadDeformationGraph({
  graph,
  geometry,
  dynlistsHeaderSource,
  shapeHelperSource,
} = {}) {
  if (typeof dynlistsHeaderSource !== "string" || typeof shapeHelperSource !== "string") {
    deformationFail("authoritative dynlists.h and shape_helper.c source text are required");
  }
  const dynobjNames = parseTitleHeadDynobjNames(dynlistsHeaderSource);
  const parsed = parseMasterObjects(graph, geometry, dynobjNames);
  const controls = validateControls(
    parseLoadMarioHeadControls(shapeHelperSource, dynobjNames),
    parsed.objectMap,
  );
  const weightEntries = parsed.joints.reduce((total, joint) => total + joint.weights.length, 0);
  const payload = {
    schema: TITLE_HEAD_DEFORMATION_SCHEMA,
    slice: "sm64-regular-interactive-title-head",
    rootNetId: parsed.rootNetId,
    sourceRange: parsed.sourceRange,
    geometryHash: geometry.contentHash,
    totals: {
      nets: parsed.nets.length,
      joints: parsed.joints.length,
      weightEntries,
      controls: controls.length,
      grabbableControls: controls.filter((control) => control.grabbable).length,
      eyeFollowControls: controls.filter((control) => control.mode === "eye-follow").length,
    },
    sourceFiles: [
      {
        path: "src/goddard/dynlists/dynlists.h",
        role: "authoritative-dynobj-identities",
        sha256: titleHeadSha256(dynlistsHeaderSource),
      },
      {
        path: "src/goddard/shape_helper.c",
        role: "authoritative-grabber-attachment-order",
        sha256: titleHeadSha256(shapeHelperSource),
      },
    ],
    matrixContract: {
      stored: "source scale rotation-degrees attach-offset triples",
      evaluation: "deferred-to-source-order-f32-runtime",
      identity: "one retained transform per source net or joint",
    },
    nets: parsed.nets,
    joints: parsed.joints,
    controls,
  };
  return { ...payload, contentHash: titleHeadContentHash(payload) };
}

// animationGraph
const TITLE_HEAD_ANIMATION_SCHEMA = "cssgraphics-title-head-animation@1";

const ANIMATION_COMMAND = Object.freeze({
  MAKE_DYNOBJ: 15,
  LINK_WITH_PTR: 29,
  ATTACH_TO: 40,
  SET_NODE_GROUP: 21,
  LINK_WITH: 28,
  END_GROUP: 17,
  USE_OBJ: 30,
  USE_INT_ID: 0,
  STOP_LIST: 58,
});

const TYPE = Object.freeze({
  EMPTY: 0,
  ROT3S: 6,
  ROT3S_POS3S: 8,
});

const TYPE_INFO = Object.freeze({
  [TYPE.ROT3S]: Object.freeze({
    name: "GD_ANIM_ROT3S",
    components: Object.freeze(["rotation-x", "rotation-y", "rotation-z"]),
    componentScale: 0.1,
  }),
  [TYPE.ROT3S_POS3S]: Object.freeze({
    name: "GD_ANIM_ROT3S_POS3S",
    components: Object.freeze([
      "rotation-x",
      "rotation-y",
      "rotation-z",
      "position-x",
      "position-y",
      "position-z",
    ]),
    componentScale: Object.freeze([0.1, 0.1, 0.1, 1, 1, 1]),
  }),
});

const LITERAL_ANIMATION_OBJECT_IDS = new Set([
  32, 33, 41, 42, 50, 51, 63, 64, 66, 67, 72, 73, 75, 76, 84, 85,
]);

function animationFail(message, source = null) {
  throw new TypeError(source ? `${source}: ${message}` : message);
}

function animationInteger(value, label, source) {
  if (!Number.isSafeInteger(value)) animationFail(`${label} must be a safe integer`, source);
  return value;
}

function oneRef(value, label, source) {
  if (
    !value
    || typeof value !== "object"
    || typeof value.$ref !== "string"
    || Object.keys(value).length !== 1
  ) animationFail(`${label} must be one graph reference`, source);
  return value.$ref;
}

function moduleByPath(graph, path) {
  const module = graph.modules?.find((candidate) => candidate.path === path);
  if (!module) animationFail(`missing graph module ${path}`);
  return module;
}

function nodeIndex(graph) {
  const nodes = new Map();
  for (const module of graph.modules ?? []) {
    for (const node of module.nodes ?? []) {
      if (nodes.has(node.id)) animationFail(`duplicate graph node ${node.id}`);
      nodes.set(node.id, node);
    }
  }
  return nodes;
}

function animationRequireNode(nodes, id, source) {
  const node = nodes.get(id);
  if (!node) animationFail(`unresolved animation node ${id}`, source);
  return node;
}

function animationFunctionBody(source, signature, path) {
  const signatureIndex = source.indexOf(signature);
  if (signatureIndex < 0) animationFail(`${signature} was not found`, path);
  const start = source.indexOf("{", signatureIndex);
  if (start < 0) animationFail(`${signature} has no body`, path);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  animationFail(`${signature} body is unterminated`, path);
}

function validateSequenceContract(shapeHelperSource) {
  const path = "src/goddard/shape_helper.c";
  const normal = animationFunctionBody(shapeHelperSource, "void animate_mario_head_normal(", path);
  const gameover = animationFunctionBody(shapeHelperSource, "void animate_mario_head_gameover(", path);
  for (const signature of [
    /animSeqNum\s*=\s*0/u,
    /frame\s*==\s*810\.0f/u,
    /frame\s*=\s*750\.0f/u,
    /frame\s*==\s*820\.0f/u,
    /frame\s*=\s*69\.0f/u,
    /frame\s*==\s*660\.0f/u,
    /frame\s*=\s*661\.0f/u,
  ]) {
    if (!signature.test(normal)) animationFail(`normal animator lost source signature ${signature}`, path);
  }
  for (const signature of [/animSeqNum\s*=\s*1/u, /frame\s*==\s*166\.0f/u]) {
    if (!signature.test(gameover)) animationFail(`game-over animator lost source signature ${signature}`, path);
  }
  return {
    regular: {
      sequenceIndex: 0,
      frameRange: { first: 1, last: 820, wrapTo: 1 },
      stateMilestones: [69, 660, 661, 750, 810, 820],
      productStatus: "included",
    },
    gameOver: {
      sequenceIndex: 1,
      frameRange: { first: 1, last: 166, wrapTo: 1 },
      productStatus: "deferred-first-slice",
    },
  };
}

function parseChannelCommands(graph, deformation, dynobjNames) {
  if (graph?.schema !== TITLE_HEAD_DYNLIST_GRAPH_SCHEMA) animationFail("invalid dynlist graph schema");
  if (deformation?.schema !== TITLE_HEAD_DEFORMATION_SCHEMA) animationFail("invalid deformation graph schema");
  const constants = moduleByPath(graph, "DynlistProc.js").constants;
  const master = nodeIndex(graph).get("dynlists/dynlist_mario_master.js#dynlist_mario_master");
  if (!master || !Array.isArray(master.value)) animationFail("master dynlist is absent");
  const commands = master.value;
  const start = commands.findIndex((command) => (
    command?.cmd === ANIMATION_COMMAND.MAKE_DYNOBJ && command.args?.w2 === constants.D_DATA_GRP
  ));
  const end = commands.findIndex((command, index) => (
    index > start && command?.cmd === ANIMATION_COMMAND.END_GROUP && command.args === 1
  ));
  if (start < 0 || end < 0 || (end - start) % 6 !== 0) animationFail("animation command block is not six-command channels", master.id);
  if (
    commands[end + 1]?.cmd !== ANIMATION_COMMAND.USE_OBJ
    || commands[end + 1]?.args?.w1 !== 1
    || commands[end + 2]?.cmd !== ANIMATION_COMMAND.USE_INT_ID
    || commands[end + 2]?.args !== false
    || commands[end + 3]?.cmd !== ANIMATION_COMMAND.STOP_LIST
    || end + 3 !== commands.length - 1
  ) animationFail("animation block terminal contract drifted", master.id);

  const knownTargets = new Map();
  for (const object of [...deformation.nets, ...deformation.joints]) {
    knownTargets.set(object.sourceObjectId, { id: object.id, type: object.id === "N221" ? "root-net" : object.constructor.includes("joint") ? "joint" : "net" });
  }
  const lights = commands.slice(0, start)
    .filter((command) => command?.cmd === ANIMATION_COMMAND.MAKE_DYNOBJ && command.args?.w2 === constants.D_LIGHT)
    .map((command) => animationInteger(command.args.w1, "light id", master.id));
  if (lights.length !== 2 || lights[0] !== 228 || lights[1] !== 231) {
    animationFail("regular title light target identities drifted", master.id);
  }
  for (const lightId of lights) knownTargets.set(lightId, { id: `N${lightId}`, type: "light" });
  if (dynobjNames.get(1001) !== "DYNOBJ_MARIO_MAIN_ANIMATOR") animationFail("root animator N1001 is missing from dynlists.h");
  const animationObjectIdentity = (sourceObjectId, role, source) => {
    const sourceName = dynobjNames.get(sourceObjectId);
    if (sourceName) return { sourceName, sourceNameAuthority: "dynlists.h-enum" };
    if (LITERAL_ANIMATION_OBJECT_IDS.has(sourceObjectId)) {
      return {
        sourceName: `DYNOBJ_LITERAL_N${sourceObjectId}`,
        sourceNameAuthority: "master-literal",
      };
    }
    animationFail(`${role} N${sourceObjectId} is absent from dynlists.h and the bounded literal set`, source);
  };

  const channels = [];
  const dataGroupIds = new Set();
  const animatorIds = new Set();
  for (let index = start; index < end; index += 6) {
    const source = `${master.id}:commands-${index}-${index + 5}`;
    const [makeGroup, linkData, makeAnimator, attachRoot, setGroup, linkTarget] = commands.slice(index, index + 6);
    if (makeGroup?.cmd !== ANIMATION_COMMAND.MAKE_DYNOBJ || makeGroup.args?.w2 !== constants.D_DATA_GRP) {
      animationFail("channel does not start with a data group", source);
    }
    if (linkData?.cmd !== ANIMATION_COMMAND.LINK_WITH_PTR) animationFail("channel data group has no pointer", source);
    if (makeAnimator?.cmd !== ANIMATION_COMMAND.MAKE_DYNOBJ || makeAnimator.args?.w2 !== constants.D_ANIMATOR) {
      animationFail("channel has no animator object", source);
    }
    if (attachRoot?.cmd !== ANIMATION_COMMAND.ATTACH_TO || attachRoot.args?.w1 !== 1001 || attachRoot.args?.w2 !== 0) {
      animationFail("channel is not attached to root animator N1001", source);
    }
    const dataGroupSourceObjectId = animationInteger(makeGroup.args.w1, "animation data-group id", source);
    const animatorSourceObjectId = animationInteger(makeAnimator.args.w1, "animator id", source);
    if (setGroup?.cmd !== ANIMATION_COMMAND.SET_NODE_GROUP || setGroup.args?.w1 !== dataGroupSourceObjectId) {
      animationFail("animator data-group binding disagrees", source);
    }
    if (linkTarget?.cmd !== ANIMATION_COMMAND.LINK_WITH) animationFail("animator target link is absent", source);
    const targetSourceObjectId = animationInteger(linkTarget.args?.w1, "animation target id", source);
    const target = knownTargets.get(targetSourceObjectId);
    if (!target) animationFail(`animation target N${targetSourceObjectId} does not resolve once`, source);
    if (dataGroupIds.has(dataGroupSourceObjectId)) animationFail(`duplicate animation data group N${dataGroupSourceObjectId}`, source);
    if (animatorIds.has(animatorSourceObjectId)) animationFail(`duplicate animator N${animatorSourceObjectId}`, source);
    dataGroupIds.add(dataGroupSourceObjectId);
    animatorIds.add(animatorSourceObjectId);
    const dataGroupIdentity = animationObjectIdentity(dataGroupSourceObjectId, "data group", source);
    const animatorIdentity = animationObjectIdentity(animatorSourceObjectId, "animator", source);
    const targetIdentity = animationObjectIdentity(targetSourceObjectId, "target", source);
    channels.push({
      sourceOrder: channels.length,
      sourceCommandRange: { first: index, last: index + 5 },
      dataGroupId: `N${dataGroupSourceObjectId}`,
      dataGroupSourceObjectId,
      dataGroupSourceName: dataGroupIdentity.sourceName,
      dataGroupSourceNameAuthority: dataGroupIdentity.sourceNameAuthority,
      animatorId: `N${animatorSourceObjectId}`,
      animatorSourceObjectId,
      animatorSourceName: animatorIdentity.sourceName,
      animatorSourceNameAuthority: animatorIdentity.sourceNameAuthority,
      rootAnimatorId: "N1001",
      targetId: target.id,
      targetType: target.type,
      targetSourceObjectId,
      targetSourceName: targetIdentity.sourceName,
      targetSourceNameAuthority: targetIdentity.sourceNameAuthority,
      animationListRef: oneRef(linkData.args?.w1, "animation list", source),
    });
  }
  if (channels.length !== 25) animationFail(`expected 25 regular-head channels, received ${channels.length}`, master.id);
  return { channels, sourceRange: { listRef: master.id, firstCommand: start, endCommandExclusive: end } };
}

function normalizeSamples(nodes, dataRef, type, expectedFrames, source) {
  const dataNode = animationRequireNode(nodes, dataRef, source);
  if (dataNode.kind !== "array" || !Array.isArray(dataNode.value)) animationFail("animation data is not an array", source);
  const info = TYPE_INFO[type];
  if (!info) animationFail(`animation type ${type} is outside the regular-head closure`, source);
  if (dataNode.value.length !== expectedFrames) {
    animationFail(`animation has ${dataNode.value.length} frames; expected ${expectedFrames}`, source);
  }
  const samples = dataNode.value.map((row, frameIndex) => {
    const location = `${source}:frame-${frameIndex + 1}`;
    if (!Array.isArray(row) || row.length !== info.components.length) {
      animationFail(`animation row width must be ${info.components.length}`, location);
    }
    return row.map((component, componentIndex) => {
      const value = animationInteger(component, `component ${componentIndex}`, location);
      if (value < -32768 || value > 32767) animationFail("animation component is outside signed 16-bit range", location);
      return value;
    });
  });
  return { dataNode, info, samples };
}

function normalizeChannel(channel, nodes, contract) {
  const listNode = animationRequireNode(nodes, channel.animationListRef, channel.animatorId);
  if (!listNode.exported || listNode.kind !== "array" || !Array.isArray(listNode.value)) {
    animationFail("animation list must be an exported array", channel.animationListRef);
  }
  if (listNode.value.length !== 3) animationFail("animation list must contain two sequences plus terminator", listNode.id);
  const [regularEntry, gameOverEntry, terminator] = listNode.value;
  const terminatorRef = oneRef(terminator, "animation terminator", listNode.id);
  if (terminatorRef !== "gd_types.js#END_ANIMDATA_INFO_ARR") {
    animationFail(`unexpected animation terminator ${terminatorRef}`, listNode.id);
  }
  const terminatorNode = animationRequireNode(nodes, terminatorRef, listNode.id);
  if (terminatorNode.value?.type !== TYPE.EMPTY || Object.keys(terminatorNode.value).length !== 1) {
    animationFail("animation terminator is not the source empty sentinel", listNode.id);
  }

  const regularType = animationInteger(regularEntry?.type, "regular animation type", listNode.id);
  const regularDataRef = oneRef(regularEntry?.data, "regular animation data", listNode.id);
  const regular = normalizeSamples(
    nodes,
    regularDataRef,
    regularType,
    contract.regular.frameRange.last,
    listNode.id,
  );
  const regularSequence = {
    sourceSequenceIndex: contract.regular.sequenceIndex,
    status: "included-regular-title-head",
    type: regularType,
    typeName: regular.info.name,
    components: [...regular.info.components],
    componentScale: regular.info.componentScale,
    frameRange: { ...contract.regular.frameRange },
    frameCount: regular.samples.length,
    sourceDataRef: regularDataRef,
    dataHash: titleHeadContentHash(regular.samples),
    samples: regular.samples,
  };

  let deferredSequence;
  if (gameOverEntry?.type === TYPE.EMPTY && gameOverEntry.data === undefined) {
    deferredSequence = {
      sourceSequenceIndex: contract.gameOver.sequenceIndex,
      status: "empty-source-sequence",
      type: TYPE.EMPTY,
      typeName: "GD_ANIM_EMPTY",
      frameCount: 0,
      sourceDataRef: null,
      dataHash: null,
    };
  } else {
    const deferredType = animationInteger(gameOverEntry?.type, "game-over animation type", listNode.id);
    const deferredDataRef = oneRef(gameOverEntry?.data, "game-over animation data", listNode.id);
    const deferred = normalizeSamples(
      nodes,
      deferredDataRef,
      deferredType,
      contract.gameOver.frameRange.last,
      listNode.id,
    );
    deferredSequence = {
      sourceSequenceIndex: contract.gameOver.sequenceIndex,
      status: "deferred-game-over-first-slice",
      type: deferredType,
      typeName: deferred.info.name,
      components: [...deferred.info.components],
      componentScale: deferred.info.componentScale,
      frameRange: { ...contract.gameOver.frameRange },
      frameCount: deferred.samples.length,
      sourceDataRef: deferredDataRef,
      dataHash: titleHeadContentHash(deferred.samples),
    };
  }

  const payload = {
    ...channel,
    id: `animator:${channel.animatorId}`,
    animationListHash: titleHeadContentHash(listNode.value),
    regularSequence,
    deferredSequence,
  };
  return { ...payload, contentHash: titleHeadContentHash(payload) };
}

function buildTitleHeadAnimationGraph({
  graph,
  deformation,
  dynlistsHeaderSource,
  shapeHelperSource,
} = {}) {
  if (typeof dynlistsHeaderSource !== "string" || typeof shapeHelperSource !== "string") {
    animationFail("authoritative dynlists.h and shape_helper.c source text are required");
  }
  const dynobjNames = parseTitleHeadDynobjNames(dynlistsHeaderSource);
  const contract = validateSequenceContract(shapeHelperSource);
  const parsed = parseChannelCommands(graph, deformation, dynobjNames);
  const nodes = nodeIndex(graph);
  const channels = parsed.channels.map((channel) => normalizeChannel(channel, nodes, contract));
  const deferredGameOverChannels = channels.filter(
    (channel) => channel.deferredSequence.status === "deferred-game-over-first-slice",
  ).length;
  const regularSampleRows = channels.reduce(
    (total, channel) => total + channel.regularSequence.frameCount,
    0,
  );
  const regularScalarValues = channels.reduce(
    (total, channel) => total + (
      channel.regularSequence.frameCount * channel.regularSequence.components.length
    ),
    0,
  );
  const payload = {
    schema: TITLE_HEAD_ANIMATION_SCHEMA,
    slice: "sm64-regular-interactive-title-head",
    deformationHash: deformation.contentHash,
    sourceRange: parsed.sourceRange,
    sequenceContract: contract,
    dataTypes: Object.fromEntries(Object.entries(TYPE_INFO).map(([type, info]) => [type, info])),
    totals: {
      channels: channels.length,
      regularSampleRows,
      regularScalarValues,
      deferredGameOverChannels,
      emptyDeferredChannels: channels.length - deferredGameOverChannels,
      includedGameOverSampleRows: 0,
    },
    sourceFiles: [
      {
        path: "src/goddard/dynlists/dynlists.h",
        role: "authoritative-animation-object-identities",
        sha256: titleHeadSha256(dynlistsHeaderSource),
      },
      {
        path: "src/goddard/shape_helper.c",
        role: "authoritative-sequence-and-frame-state-contract",
        sha256: titleHeadSha256(shapeHelperSource),
      },
      ...graph.sources
        .filter(({ path }) => path.includes("anim_") || path.endsWith("dynlist_mario_master.js") || path === "gd_types.js")
        .map(({ path, sha256, bytes }) => ({ path, role: "ignored-animation-data-input", sha256, bytes })),
    ],
    channels,
  };
  return { ...payload, contentHash: titleHeadContentHash(payload) };
}

// materials
const TITLE_HEAD_MATERIALS_SCHEMA = "cssgraphics-title-head-materials@1";
const TITLE_HEAD_POLYCSS_AUTHORITY_REVISION = "37bfcd90c93f3832b2e7f22305e5e90e7f474ff7";

const MATERIALS_COMMAND = Object.freeze({
  MAKE_DYNOBJ: 15,
  SET_FLAG: 8,
  SET_ID: 35,
  SET_DIFFUSE: 34,
  SET_SHAPE_PTR_PTR: 24,
});

const MATERIALS_SOURCE_PATHS = Object.freeze({
  authoritative: Object.freeze({
    renderer: "src/goddard/renderer.c",
    drawObjects: "src/goddard/draw_objects.c",
    objects: "src/goddard/objects.c",
    shapeHelper: "src/goddard/shape_helper.c",
    gdTypes: "src/goddard/gd_types.h",
    gbi: "include/PR/gbi.h",
  }),
  candidate: Object.freeze({
    renderer: "src/goddard/GoddardRenderer.js",
    draw: "src/goddard/Draw.js",
    objects: "src/goddard/Objects.js",
    dynlistProc: "src/goddard/DynlistProc.js",
  }),
});

function materialsFail(message, source = null) {
  throw new TypeError(source ? `${source}: ${message}` : message);
}

function materialsSourceText(sources, key, path) {
  const source = sources?.[key];
  if (typeof source !== "string" || source.length === 0) materialsFail("source text is required", path);
  return source;
}

function materialsRequireSignature(source, signature, label, path) {
  if (!signature.test(source)) materialsFail(`lost authoritative signature: ${label}`, path);
}

function enumValue(source, name, path) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(0x[\\da-f]+|\\d+)`, "iu"));
  if (!match) materialsFail(`enum value ${name} was not found`, path);
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value)) materialsFail(`enum value ${name} is invalid`, path);
  return value;
}

function validateAuthoritativeSources(sources) {
  const renderer = materialsSourceText(sources, "renderer", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  const drawObjects = materialsSourceText(sources, "drawObjects", MATERIALS_SOURCE_PATHS.authoritative.drawObjects);
  const objects = materialsSourceText(sources, "objects", MATERIALS_SOURCE_PATHS.authoritative.objects);
  const shapeHelper = materialsSourceText(sources, "shapeHelper", MATERIALS_SOURCE_PATHS.authoritative.shapeHelper);
  const gdTypes = materialsSourceText(sources, "gdTypes", MATERIALS_SOURCE_PATHS.authoritative.gdTypes);
  const gbi = materialsSourceText(sources, "gbi", MATERIALS_SOURCE_PATHS.authoritative.gbi);

  const materialTypes = {
    stub: enumValue(gdTypes, "GD_MTL_STUB_DL", MATERIALS_SOURCE_PATHS.authoritative.gdTypes),
    break: enumValue(gdTypes, "GD_MTL_BREAK", MATERIALS_SOURCE_PATHS.authoritative.gdTypes),
    shine: enumValue(gdTypes, "GD_MTL_SHINE_DL", MATERIALS_SOURCE_PATHS.authoritative.gdTypes),
    textureOff: enumValue(gdTypes, "GD_MTL_TEX_OFF", MATERIALS_SOURCE_PATHS.authoritative.gdTypes),
    lights: enumValue(gdTypes, "GD_MTL_LIGHTS", MATERIALS_SOURCE_PATHS.authoritative.gdTypes),
  };
  const lightFlags = {
    newUncounted: enumValue(gdTypes, "LIGHT_NEW_UNCOUNTED", MATERIALS_SOURCE_PATHS.authoritative.gdTypes),
    phong: enumValue(gdTypes, "LIGHT_UNK20", MATERIALS_SOURCE_PATHS.authoritative.gdTypes),
  };
  if (
    materialTypes.stub !== 0x01
    || materialTypes.break !== 0x04
    || materialTypes.shine !== 0x10
    || materialTypes.textureOff !== 0x20
    || materialTypes.lights !== 0x40
  ) materialsFail("Goddard material enum values drifted", MATERIALS_SOURCE_PATHS.authoritative.gdTypes);
  if (lightFlags.newUncounted !== 0x10 || lightFlags.phong !== 0x20) {
    materialsFail("Goddard light flag values drifted", MATERIALS_SOURCE_PATHS.authoritative.gdTypes);
  }

  const defaultTypeMatch = objects.match(/newMtl->type\s*=\s*(0x[\da-f]+|\d+)\s*;/iu);
  if (!defaultTypeMatch) materialsFail("default material type assignment was not found", MATERIALS_SOURCE_PATHS.authoritative.objects);
  const defaultMaterialType = Number(defaultTypeMatch[1]);
  if (defaultMaterialType !== materialTypes.shine) {
    materialsFail(
      `unsupported default material type ${defaultMaterialType}; regular title head requires GD_MTL_SHINE_DL`,
      MATERIALS_SOURCE_PATHS.authoritative.objects,
    );
  }

  materialsRequireSignature(shapeHelper, /newShape->alpha\s*=\s*1\.0f\s*;/u, "opaque shape default", MATERIALS_SOURCE_PATHS.authoritative.shapeHelper);
  materialsRequireSignature(drawObjects, /set_light_num\(NUMLIGHTS_2\)/u, "two-light setup", MATERIALS_SOURCE_PATHS.authoritative.drawObjects);
  materialsRequireSignature(drawObjects, /GD_PROP_AMB_COLOUR,\s*0\.5f,\s*0\.5f,\s*0\.5f/u, "ambient scale 0.5", MATERIALS_SOURCE_PATHS.authoritative.drawObjects);
  materialsRequireSignature(drawObjects, /GD_PROP_CULLING,\s*1\.0f/u, "source back-face culling", MATERIALS_SOURCE_PATHS.authoritative.drawObjects);
  materialsRequireSignature(drawObjects, /if\s*\(gGdUseVtxNormal\)/u, "smooth vertex normals", MATERIALS_SOURCE_PATHS.authoritative.drawObjects);
  materialsRequireSignature(drawObjects, /gd_dl_material_lighting\(mtl->gddlNumber,\s*&mtl->Kd,\s*mtlType\)/u, "diffuse colour lighting input", MATERIALS_SOURCE_PATHS.authoritative.drawObjects);
  materialsRequireSignature(drawObjects, /light->colour\.r\s*=\s*light->diffuse\.r\s*\*\s*light->unk30/u, "light colour intensity", MATERIALS_SOURCE_PATHS.authoritative.drawObjects);
  materialsRequireSignature(drawObjects, /gd_normalize_vec3f\(&sLightPositionCache\[light->id\]\)/u, "normalized dynamic light direction", MATERIALS_SOURCE_PATHS.authoritative.drawObjects);

  materialsRequireSignature(renderer, /gsSPSetGeometryMode\(G_TEXTURE_GEN\)/u, "shine texture generation", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /gsSPTexture\(0x07C0,\s*0x07C0/u, "shine texture scale", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /gsDPSetTexturePersp\(G_TP_PERSP\)/u, "perspective texture correction", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /gsDPSetTextureFilter\(G_TF_BILERP\)/u, "bilinear shine filter", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /gsDPSetCombineMode\(G_CC_HILITERGBA,\s*G_CC_HILITERGBA\)/u, "highlight combine mode", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /G_IM_FMT_IA,\s*G_IM_SIZ_8b,\s*32,\s*32/u, "IA8 32x32 shine texture", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /G_TX_WRAP\s*\|\s*G_TX_NOMIRROR[\s\S]*G_TX_WRAP\s*\|\s*G_TX_NOMIRROR,\s*5,\s*5/u, "shine wrap and mask", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /sLightDirections\[sLightId\]\.x\s*=\s*\(s32\)\(f1\s*\*\s*120\.f\)/u, "light direction quantization", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /sVtxCvrtNormBuf\[0\]\s*=\s*\(s8\)\(norm->x\s*\*\s*127\.0f\)/u, "normal quantization", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /VIEW_ALLOC_ZBUF/u, "allocated title depth buffer", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /G_RM_AA_ZB_OPA_INTER/u, "opaque depth render mode", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /G_RM_AA_ZB_XLU_SURF/u, "translucent depth render mode", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /sAlpha\s*=\s*alpha\s*\*\s*255\.0f/u, "shape alpha conversion", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(renderer, /gDPSetPrimColor[\s\S]*colour->r\s*\*\s*255\.0f/u, "highlight primitive colour", MATERIALS_SOURCE_PATHS.authoritative.renderer);
  materialsRequireSignature(gbi, /#define\s+G_CC_HILITERGBA\s+PRIMITIVE,\s*SHADE,\s*TEXEL0,\s*SHADE,\s*PRIMITIVE,\s*SHADE,\s*TEXEL0,\s*SHADE/u, "highlight combiner equation", MATERIALS_SOURCE_PATHS.authoritative.gbi);

  return {
    materialTypes,
    lightFlags,
    defaultMaterialType,
    hashes: Object.entries(MATERIALS_SOURCE_PATHS.authoritative).map(([key, path]) => ({
      path,
      sha256: titleHeadSha256(materialsSourceText(sources, key, path)),
    })),
  };
}

function validateCandidateSources(sources) {
  const renderer = materialsSourceText(sources, "renderer", MATERIALS_SOURCE_PATHS.candidate.renderer);
  const draw = materialsSourceText(sources, "draw", MATERIALS_SOURCE_PATHS.candidate.draw);
  const objects = materialsSourceText(sources, "objects", MATERIALS_SOURCE_PATHS.candidate.objects);
  const dynlistProc = materialsSourceText(sources, "dynlistProc", MATERIALS_SOURCE_PATHS.candidate.dynlistProc);
  materialsRequireSignature(objects, /type:\s*16/u, "candidate material default", MATERIALS_SOURCE_PATHS.candidate.objects);
  materialsRequireSignature(draw, /sNumLights\s*=\s*2/u, "candidate two-light setup", MATERIALS_SOURCE_PATHS.candidate.draw);
  materialsRequireSignature(draw, /GD_PROP_AMB_COLOUR,\s*0\.5,\s*0\.5,\s*0\.5/u, "candidate ambient setup", MATERIALS_SOURCE_PATHS.candidate.draw);
  materialsRequireSignature(renderer, /G_TEXTURE_GEN/u, "candidate shine texgen", MATERIALS_SOURCE_PATHS.candidate.renderer);
  materialsRequireSignature(renderer, /G_TF_BILERP/u, "candidate bilinear shine filter", MATERIALS_SOURCE_PATHS.candidate.renderer);
  materialsRequireSignature(renderer, /G_IM_FMT_IA[\s\S]*32,\s*32/u, "candidate IA8 shine declaration", MATERIALS_SOURCE_PATHS.candidate.renderer);

  const materialSetTypeSupport = /case\s+GDTypes\.OBJ_TYPE_MATERIALS[\s\S]{0,180}\.type\s*=\s*type/u.test(dynlistProc);
  return {
    role: "immediate-webgl-clarifier-not-authority",
    explicitTexturePerspectiveCommand: /gsDPSetTexturePersp\([^)]*G_TP_PERSP/u.test(renderer),
    materialSetTypeSupport,
    knownGaps: [
      "regular-head interaction is not authority-qualified",
      "shine texture pixels are not populated by the candidate declaration",
      ...(/gsDPSetTexturePersp\([^)]*G_TP_PERSP/u.test(renderer) ? [] : ["shine display list omits the authoritative explicit texture-perspective command"]),
      ...(materialSetTypeSupport ? [] : ["candidate dynlist type setter does not support materials"]),
    ],
    hashes: Object.entries(MATERIALS_SOURCE_PATHS.candidate).map(([key, path]) => ({
      path,
      sha256: titleHeadSha256(materialsSourceText(sources, key, path)),
    })),
  };
}

function materialsGraphNode(graph, id) {
  return graph.modules?.flatMap((module) => module.nodes ?? []).find((node) => node.id === id) ?? null;
}

function symbolIdentity(value, source) {
  const symbol = value?.$symbol;
  if (!symbol || typeof symbol.module !== "string" || typeof symbol.export !== "string" || !Array.isArray(symbol.path)) {
    materialsFail("light shape pointer is not a bounded source symbol", source);
  }
  if (symbol.path.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    materialsFail("light shape symbol path is invalid", source);
  }
  return `${symbol.module}#${symbol.export}.${symbol.path.join(".")}`;
}

function colourFromCommand(command, source) {
  const vec = command?.args?.vec;
  const result = [vec?.r, vec?.g, vec?.b];
  if (result.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
    materialsFail("light diffuse colour must remain in range 0..1", source);
  }
  return result;
}

function parseLights(graph, animation, sourceContract) {
  if (graph?.schema !== TITLE_HEAD_DYNLIST_GRAPH_SCHEMA) materialsFail("invalid dynlist graph schema");
  if (animation?.schema !== TITLE_HEAD_ANIMATION_SCHEMA) materialsFail("invalid animation graph schema");
  const constants = graph.modules?.find((module) => module.path === "DynlistProc.js")?.constants;
  if (!Number.isSafeInteger(constants?.D_LIGHT)) materialsFail("D_LIGHT constant is absent from dynlist graph");
  const master = materialsGraphNode(graph, "dynlists/dynlist_mario_master.js#dynlist_mario_master");
  if (!master || !Array.isArray(master.value)) materialsFail("regular-head master dynlist is absent");
  const starts = master.value
    .map((command, index) => ({ command, index }))
    .filter(({ command }) => command?.cmd === MATERIALS_COMMAND.MAKE_DYNOBJ && command.args?.w2 === constants.D_LIGHT);
  if (starts.length !== 2) materialsFail(`expected two regular-head lights, received ${starts.length}`, master.id);

  const lights = starts.map(({ command, index }, sourceOrder) => {
    const end = master.value.findIndex((candidate, candidateIndex) => (
      candidateIndex > index && candidate?.cmd === MATERIALS_COMMAND.MAKE_DYNOBJ
    ));
    const commands = master.value.slice(index, end < 0 ? master.value.length : end);
    const source = `${master.id}:light-${sourceOrder}`;
    const sourceObjectId = command.args?.w1;
    if (!Number.isSafeInteger(sourceObjectId)) materialsFail("light source object id is invalid", source);
    const idCommands = commands.filter((candidate) => candidate?.cmd === MATERIALS_COMMAND.SET_ID);
    const diffuseCommands = commands.filter((candidate) => candidate?.cmd === MATERIALS_COMMAND.SET_DIFFUSE);
    const flagCommands = commands.filter((candidate) => candidate?.cmd === MATERIALS_COMMAND.SET_FLAG);
    const shapeCommands = commands.filter((candidate) => candidate?.cmd === MATERIALS_COMMAND.SET_SHAPE_PTR_PTR);
    if (idCommands.length !== 1 || diffuseCommands.length !== 1 || flagCommands.length > 1 || shapeCommands.length !== 1) {
      materialsFail("light command closure is not one id/diffuse/optional-flag/shape declaration", source);
    }
    const lightId = idCommands[0].args?.id;
    const authoredFlags = flagCommands[0]?.args?.w2 ?? 0;
    if (!Number.isSafeInteger(lightId) || !Number.isSafeInteger(authoredFlags)) materialsFail("light id or flags are invalid", source);
    return {
      id: `N${sourceObjectId}`,
      sourceOrder,
      sourceObjectId,
      lightSlot: lightId,
      diffuse: colourFromCommand(diffuseCommands[0], source),
      initialIntensity: 1,
      authoredFlags,
      runtimeInitialFlags: authoredFlags | sourceContract.lightFlags.newUncounted,
      phongHighlightSource: (authoredFlags & sourceContract.lightFlags.phong) !== 0,
      sourceShapeRef: symbolIdentity(shapeCommands[0].args?.w1, source),
      direction: {
        source: "normalize(animated-position - current-shape-offset)",
        displayListQuantization: "truncate-s32(normalized-component * 120), then cast-s8",
        dynamicPerTick: true,
      },
      animationChannelIds: animation.channels
        .filter((channel) => channel.targetId === `N${sourceObjectId}`)
        .map((channel) => channel.id),
    };
  });
  if (
    lights[0].id !== "N228"
    || lights[0].lightSlot !== 1
    || lights[0].phongHighlightSource !== true
    || lights[1].id !== "N231"
    || lights[1].lightSlot !== 0
    || lights[1].phongHighlightSource !== false
  ) materialsFail("regular-head light identities or roles drifted", master.id);
  if (new Set(lights.map((light) => light.lightSlot)).size !== lights.length) {
    materialsFail("regular-head light slots are not unique", master.id);
  }
  if (lights.some((light) => light.animationChannelIds.length !== 1)) {
    materialsFail("each regular-head light must resolve to one animation channel", master.id);
  }
  return lights;
}

const f32 = Math.fround;
const add = (left, right) => f32(f32(left) + f32(right));
const subtract = (left, right) => f32(f32(left) - f32(right));
const multiply = (left, right) => f32(f32(left) * f32(right));
const divide = (left, right) => f32(f32(left) / f32(right));

function faceNormal(vertices, indices, source) {
  const [p1, p2, p3] = indices.map((index) => vertices[index].map(f32));
  const e1 = p1.map((value, axis) => subtract(p2[axis], value));
  const e2 = p2.map((value, axis) => subtract(p3[axis], value));
  const normal = [
    multiply(subtract(multiply(e1[1], e2[2]), multiply(e1[2], e2[1])), 1000),
    multiply(subtract(multiply(e1[2], e2[0]), multiply(e1[0], e2[2])), 1000),
    multiply(subtract(multiply(e1[0], e2[1]), multiply(e1[1], e2[0])), 1000),
  ];
  const magnitudeSquared = add(add(multiply(normal[0], normal[0]), multiply(normal[1], normal[1])), multiply(normal[2], normal[2]));
  if (magnitudeSquared < 1.0e-7) materialsFail("source face normal reached zero/near-zero magnitude", source);
  const magnitude = f32(Math.sqrt(magnitudeSquared));
  if (magnitude === 0) materialsFail("source face normal failed normalization", source);
  return normal.map((component) => divide(component, magnitude));
}

function toSignedNormalByte(component) {
  const value = Math.trunc(multiply(component, 127));
  if (value < -128 || value > 127) materialsFail(`normal component ${component} overflows source s8 conversion`);
  return value;
}

function normalsForShape(shape) {
  if (!Array.isArray(shape.vertices) || !Array.isArray(shape.faces)) materialsFail("shape topology is missing", shape.id);
  const faceNormals = shape.faces.map((face) => faceNormal(shape.vertices, face.indices, face.id));
  const sums = shape.vertices.map(() => [f32(0), f32(0), f32(0)]);
  const faceCounts = shape.vertices.map(() => 0);
  for (const [faceIndex, face] of shape.faces.entries()) {
    for (const vertexIndex of face.indices) {
      for (let axis = 0; axis < 3; axis += 1) {
        sums[vertexIndex][axis] = add(sums[vertexIndex][axis], faceNormals[faceIndex][axis]);
      }
      faceCounts[vertexIndex] += 1;
    }
  }
  if (faceCounts.some((count) => count === 0)) materialsFail("shape contains an unreferenced vertex", shape.id);
  const vertexNormals = sums.map((sum, index) => sum.map((component) => divide(component, faceCounts[index])));
  const vertexNormalsS8 = vertexNormals.map((normal) => normal.map(toSignedNormalByte));
  return {
    shapeId: shape.id,
    sourceAlgorithm: {
      face: "normalize-f32(cross((p2-p1),(p3-p2))*1000)",
      vertex: "ordered-f32-average-of-adjacent-face-normals-without-renormalization",
      displayList: "truncate-s8(component*127)",
    },
    faceCounts,
    faceNormals,
    vertexNormals,
    vertexNormalsS8,
    hashes: {
      faceNormals: titleHeadContentHash(faceNormals),
      vertexNormals: titleHeadContentHash(vertexNormals),
      vertexNormalsS8: titleHeadContentHash(vertexNormalsS8),
    },
  };
}

function cssColour(colour) {
  const bytes = colour.map((component) => Math.max(0, Math.min(255, Math.trunc(component * 255))));
  const css = formatPolyCssColor({ rgb: bytes, alpha: 1 });
  const parsed = parsePureColor(css);
  if (!parsed || parsed.alpha !== 1 || parsed.rgb.some((value, index) => value !== bytes[index])) {
    materialsFail("PolyCSS colour formatter did not preserve source-quantized bytes");
  }
  return css;
}

function validatePolyCss(packageInfo) {
  const name = String(packageInfo?.name ?? "");
  const version = String(packageInfo?.version ?? "");
  if (name !== "@layoutit/polycss") materialsFail(`unexpected renderer package ${name || "<missing>"}`, "package.json");
  const directionProbe = worldDirectionToPolyCss([1, 2, 3]);
  if (directionProbe.length !== 3 || directionProbe.some((value, index) => value !== [2, 1, 3][index])) {
    materialsFail("PolyCSS world-direction axis conversion drifted", "@layoutit/polycss#worldDirectionToPolyCss");
  }
  const lambertProbe = computeShapeLighting(
    [0, 0, 1],
    "#ffffff",
    { direction: [0, 0, -1], color: "#ffffff", intensity: 1 },
    { color: "#ffffff", intensity: 0.5 },
  );
  if (!parsePureColor(lambertProbe)) {
    materialsFail("PolyCSS lighting helper returned an invalid CSS colour", "@layoutit/polycss#computeShapeLighting");
  }
  return {
    package: { name, version },
    localAuthorityRevision: TITLE_HEAD_POLYCSS_AUTHORITY_REVISION,
    publicTools: [
      "createPolyPerspectiveCamera",
      "worldDirectionToPolyCss",
      "worldPositionToPolyCss",
      "formatMatrix3d",
      "formatColor",
      "parsePureColor",
      "computeShapeLighting",
    ],
    verifiedProbes: {
      directionWorld123ToCss: directionProbe,
      singleLightLambertCss: lambertProbe,
    },
    adoptedCapabilities: [
      "public world-to-CSS direction conversion",
      "public CSS colour parsing and serialization",
      "retained camera and matrix formatting",
      "prepared source-lit smooth vertex atlas paint",
      "stable-DOM atlas-leaf transform update model",
    ],
    builtInLightingDisposition: "geometry-native-prepared-source-lighting-adapter",
    sourceDifferencesRequiringAdapter: [
      "Goddard has two independently coloured animated lights; the public scene model has one directional light",
      "Goddard shades three current vertex normals; built-in dynamic lighting uses one polygon normal",
      "Goddard uses N64 integer byte arithmetic; built-in lighting uses the PolyCSS/Three.js colour pipeline",
      "Goddard adds G_TEXTURE_GEN IA8 highlight combine state absent from generic Lambert lighting",
    ],
    exactAdapter: {
      directions: "sample and source-quantize both regular-loop Goddard light directions during prepare",
      colours: "bake source ambient plus white-key and red-fill byte lighting into the prepared s-tag atlas",
      smoothShade: "barycentrically interpolate three source-quantized vertex colours per prepared atlas tile",
      shine: "unmounted until generated-coordinate atlas mapping is source-qualified",
      fallback: "throw",
    },
  };
}

function normalizeTitleHeadMaterialType(value, source = "title-head material") {
  if (value !== 0x10) materialsFail(`unsupported reachable Goddard material type ${value}`, source);
  return Object.freeze({ value, name: "GD_MTL_SHINE_DL" });
}

function normalizeMaterials(geometry, defaultMaterialType) {
  normalizeTitleHeadMaterialType(defaultMaterialType, MATERIALS_SOURCE_PATHS.authoritative.objects);
  const materials = [];
  const ids = new Set();
  for (const shape of geometry.shapes) {
    const shapeMaterialIds = new Set(shape.materials.map((material) => material.id));
    for (const face of shape.faces) {
      if (!shapeMaterialIds.has(face.materialId)) {
        materialsFail(`face references missing normalized material ${face.materialId}`, face.id);
      }
    }
    for (const material of shape.materials) {
      if (ids.has(material.id)) materialsFail(`duplicate material id ${material.id}`);
      ids.add(material.id);
      if (!Array.isArray(material.ambient) || !Array.isArray(material.diffuse)) {
        materialsFail("material colour state is missing", material.id);
      }
      if (material.ambient.length !== 3 || material.diffuse.length !== 3) {
        materialsFail("material colour state must have three components", material.id);
      }
      const usedByFaceCount = shape.faces.filter((face) => face.materialId === material.id).length;
      if (usedByFaceCount !== material.usedByFaceCount) materialsFail("material face coverage drifted", material.id);
      materials.push({
        id: material.id,
        shapeId: shape.id,
        sourceMaterialId: material.sourceMaterialId,
        usedByFaceCount,
        source: {
          ambientAuthoredKa: [...material.ambient],
          diffuseLightingKd: [...material.diffuse],
          type: { value: defaultMaterialType, name: "GD_MTL_SHINE_DL" },
          shapeAlpha: 1,
          sourceCull: "back",
        },
        render: {
          layer: "opaque-zbuffered-title-head",
          transparency: "opaque",
          opacity: 1,
          alphaCompare: "none",
          depthTest: true,
          depthWrite: true,
          smoothVertexLighting: true,
          combine: "(primitive - shade) * texel0 + shade",
          textureIdentity: "title-head:mario-face-shine",
          textureCoordinates: "dynamic-g-texture-gen",
        },
        polycss: {
          renderer: "@layoutit/polycss",
          stableFaceLeaf: true,
          leafElement: "s",
          preparedSurfaceAtlas: true,
          stableShineChild: false,
          leafStyle: {
            backgroundColor: cssColour(material.diffuse),
            opacity: "1",
            backfaceVisibility: "visible",
            transformStyle: "preserve-3d",
          },
          preparedPaint: {
            base: "Goddard two-light smooth vertex colour baked into a prepared deduplicated PolyCSS atlas tile",
            shine: "disabled until generated-coordinate atlas mapping is qualified",
            allowedRuntimeWrites: ["leaf transform", "leaf opacity", "leaf visibility"],
            forbiddenFallback: "throw",
          },
          sourceCullMetadataOnly: "back",
          runtimeCull: "forbidden",
        },
      });
    }
  }
  if (materials.length !== geometry.totals.materials) materialsFail("normalized material total does not match geometry");
  return materials;
}

function provenance(geometry, authoritative, candidate) {
  return {
    geometryContentHash: geometry.contentHash,
    authoritativeRevision: geometry.provenance?.n64decompSm64?.revision,
    candidateRevision: geometry.provenance?.sm64js?.revision,
    sourceFiles: {
      authoritative: authoritative.hashes,
      candidate: candidate.hashes,
    },
    generatedFromUserRomPrepare: true,
    absolutePathsRetained: false,
  };
}

function buildTitleHeadMaterials({
  graph,
  geometry,
  animation,
  authoritativeSources,
  candidateSources,
  polycssPackage,
} = {}) {
  if (geometry?.schema !== TITLE_HEAD_GEOMETRY_SCHEMA) materialsFail("invalid geometry schema");
  const authoritative = validateAuthoritativeSources(authoritativeSources);
  const candidate = validateCandidateSources(candidateSources);
  const polycss = validatePolyCss(polycssPackage);
  const lights = parseLights(graph, animation, authoritative);
  const normals = geometry.shapes.map(normalsForShape);
  const materials = normalizeMaterials(geometry, authoritative.defaultMaterialType);
  const payload = {
    schema: TITLE_HEAD_MATERIALS_SCHEMA,
    slice: "sm64-regular-interactive-title-head",
    sourceState: {
      material: {
        defaultType: { value: authoritative.defaultMaterialType, name: "GD_MTL_SHINE_DL" },
        authoredAmbientKaUsage: "retained-provenance-only",
        lightingColourInput: "diffuse-Kd",
      },
      lighting: {
        enabled: true,
        smoothShading: true,
        numberOfLights: 2,
        ambientScale: [0.5, 0.5, 0.5],
        ambientByteEquation: "truncate(Kd * 0.5 * 255)",
        diffuseByteEquation: "truncate(Kd * animated-light-diffuse * intensity * 255)",
        normalQuantization: "truncate-s8(current-normal * 127)",
        directionQuantization: "truncate-s32(normalized-direction * 120), then cast-s8",
        lights,
      },
      shine: {
        textureIdentity: "title-head:mario-face-shine",
        sourcePath: "textures/intro_raw/mario_face_shine.ia8.inc.c",
        format: "IA8",
        dimensions: [32, 32],
        textureScale: [0x07C0, 0x07C0],
        perspectiveCorrection: true,
        filter: "bilinear",
        wrap: { s: "wrap-no-mirror-mask-5", t: "wrap-no-mirror-mask-5" },
        combine: {
          name: "G_CC_HILITERGBA",
          rgb: "(primitive - shade) * texel0 + shade",
          alpha: "(primitive - shade) * texel0 + shade",
        },
        primitiveColour: "phong-light diffuse * current intensity",
        disabledWhen: "phong-light intensity <= 0",
        coordinateGeneration: {
          sourceMode: "G_TEXTURE_GEN",
          inputs: ["current vertex normal", "camera look-at basis", "phong light direction", "hilite tile offset"],
          dynamicPerTick: true,
          stableDomContract: "no shine child is mounted until generated-coordinate atlas mapping is qualified",
          imageOrTopologyReplacement: false,
        },
      },
      render: {
        titleView: "VIEW_ALLOC_ZBUF",
        opaqueMode: "G_RM_AA_ZB_OPA_INTER",
        translucentMode: "G_RM_AA_ZB_XLU_SURF",
        alphaCompare: "G_AC_NONE",
        shapeAlpha: 1,
        sourceCull: "G_CULL_BACK",
        productCull: "none",
        productBackfaceVisibility: "visible",
      },
      candidateClarifier: {
        role: candidate.role,
        explicitTexturePerspectiveCommand: candidate.explicitTexturePerspectiveCommand,
        materialSetTypeSupport: candidate.materialSetTypeSupport,
        knownGaps: candidate.knownGaps,
      },
      polycss,
    },
    totals: {
      materials: materials.length,
      shapes: normals.length,
      faces: geometry.totals.faces,
      vertices: geometry.totals.vertices,
      lights: lights.length,
      shineMaterials: materials.filter((material) => material.source.type.value === 0x10).length,
    },
    normals,
    materials,
    provenance: provenance(geometry, authoritative, candidate),
  };
  return { ...payload, contentHash: titleHeadContentHash(payload) };
}

// textures
const TITLE_HEAD_TEXTURES_SCHEMA = "cssgraphics-title-head-textures@1";

const TEXTURE_SOURCE_PATHS = Object.freeze({
  authoritativeAssets: "assets.json",
  authoritativeRenderer: "src/goddard/renderer.c",
  candidateAssets: "src/assets.js",
  candidateRenderer: "src/goddard/GoddardRenderer.js",
});

const TITLE_HEAD_TEXTURE_SPECS = Object.freeze([
  Object.freeze({
    id: "title-head:mario-face-shine",
    role: "model-shine",
    asset: "textures/intro_raw/mario_face_shine.ia8.png",
    include: "textures/intro_raw/mario_face_shine.ia8.inc.c",
    symbol: "gd_texture_mario_face_shine",
    encoding: "IA8",
    sourceBytes: 1024,
    outputPath: "textures/mario-face-shine.png",
  }),
  Object.freeze({
    id: "title-head:hand-open",
    role: "cursor-open",
    asset: "textures/intro_raw/hand_open.rgba16.png",
    include: "textures/intro_raw/hand_open.rgba16.inc.c",
    symbol: "gd_texture_hand_open",
    encoding: "RGBA16",
    sourceBytes: 2048,
    outputPath: "textures/hand-open.png",
  }),
  Object.freeze({
    id: "title-head:hand-closed",
    role: "cursor-closed",
    asset: "textures/intro_raw/hand_closed.rgba16.png",
    include: "textures/intro_raw/hand_closed.rgba16.inc.c",
    symbol: "gd_texture_hand_closed",
    encoding: "RGBA16",
    sourceBytes: 2048,
    outputPath: "textures/hand-closed.png",
  }),
]);

function texturesFail(message, source = null) {
  throw new TypeError(source ? `${source}: ${message}` : message);
}

function texturesSourceText(value, path) {
  if (typeof value !== "string" || value.length === 0) texturesFail("source text is required", path);
  return value;
}

function texturesRequireSignature(source, signature, label, path) {
  if (!signature.test(source)) texturesFail(`lost authoritative signature: ${label}`, path);
}

function parseCandidateAssets(source) {
  const text = texturesSourceText(source, TEXTURE_SOURCE_PATHS.candidateAssets);
  const start = text.indexOf("{");
  if (start < 0) texturesFail("asset map object literal is missing", TEXTURE_SOURCE_PATHS.candidateAssets);
  try {
    return JSON.parse(text.slice(start).trim().replace(/;\s*$/u, ""));
  } catch (error) {
    texturesFail(`asset map is not canonical JSON: ${error.message}`, TEXTURE_SOURCE_PATHS.candidateAssets);
  }
}

function parseAuthoritativeAssets(source) {
  try {
    return JSON.parse(texturesSourceText(source, TEXTURE_SOURCE_PATHS.authoritativeAssets));
  } catch (error) {
    texturesFail(`asset catalog is not canonical JSON: ${error.message}`, TEXTURE_SOURCE_PATHS.authoritativeAssets);
  }
}

function catalogEntry(catalog, spec, path) {
  const entry = catalog?.[spec.asset];
  if (!Array.isArray(entry) || entry.length !== 4) texturesFail(`selected asset is missing: ${spec.asset}`, path);
  const [width, height, bytes, regions] = entry;
  const us = regions?.us;
  if (width !== 32 || height !== 32 || bytes !== spec.sourceBytes) {
    texturesFail(`selected asset dimensions or byte length drifted: ${spec.asset}`, path);
  }
  if (!Array.isArray(us) || us.length !== 1 || !Number.isSafeInteger(us[0]) || us[0] < 0) {
    texturesFail(`selected US asset is no longer a direct ROM range: ${spec.asset}`, path);
  }
  return Object.freeze({ width, height, bytes, offset: us[0] });
}

function resolveTexturePlan(authoritativeAssetsSource, candidateAssetsSource) {
  const authoritative = parseAuthoritativeAssets(authoritativeAssetsSource);
  const candidate = parseCandidateAssets(candidateAssetsSource);
  return TITLE_HEAD_TEXTURE_SPECS.map((spec) => {
    const authority = catalogEntry(authoritative, spec, TEXTURE_SOURCE_PATHS.authoritativeAssets);
    const candidateEntry = catalogEntry(candidate, spec, TEXTURE_SOURCE_PATHS.candidateAssets);
    if (JSON.stringify(authority) !== JSON.stringify(candidateEntry)) {
      texturesFail(`candidate and authoritative US ranges disagree: ${spec.asset}`);
    }
    return Object.freeze({ ...spec, ...authority });
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function validateRendererSources(authoritativeSource, candidateSource) {
  const renderer = texturesSourceText(authoritativeSource, TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  const candidate = texturesSourceText(candidateSource, TEXTURE_SOURCE_PATHS.candidateRenderer);
  for (const spec of TITLE_HEAD_TEXTURE_SPECS) {
    texturesRequireSignature(
      renderer,
      new RegExp(`Texture\\s+${escapeRegExp(spec.symbol)}\\s*\\[\\][\\s\\S]{0,120}#include\\s+"${escapeRegExp(spec.include)}"`, "u"),
      `${spec.symbol} source include`,
      TEXTURE_SOURCE_PATHS.authoritativeRenderer,
    );
  }

  texturesRequireSignature(renderer, /gsSPSetGeometryMode\(G_TEXTURE_GEN\)/u, "shine texture-coordinate generation", TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  texturesRequireSignature(renderer, /gsSPTexture\(0x07C0,\s*0x07C0/u, "shine texture scale", TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  texturesRequireSignature(renderer, /gsDPSetTexturePersp\(G_TP_PERSP\)/u, "shine perspective correction", TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  texturesRequireSignature(renderer, /gsDPSetTextureFilter\(G_TF_BILERP\)/u, "bilinear texture filtering", TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  texturesRequireSignature(renderer, /gsDPSetCombineMode\(G_CC_HILITERGBA,\s*G_CC_HILITERGBA\)/u, "shine combine mode", TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  texturesRequireSignature(renderer, /gsDPLoadTextureBlock\(gd_texture_mario_face_shine,\s*G_IM_FMT_IA,\s*G_IM_SIZ_8b,\s*32,\s*32,[\s\S]{0,180}G_TX_WRAP\s*\|\s*G_TX_NOMIRROR,[\s\S]{0,80}\b5,\s*5,/u, "shine IA8 wrap and masks", TEXTURE_SOURCE_PATHS.authoritativeRenderer);

  texturesRequireSignature(renderer, /gsDPSetAlphaCompare\(G_AC_THRESHOLD\)/u, "cursor alpha threshold", TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  texturesRequireSignature(renderer, /gsDPSetBlendColor\(0,\s*0,\s*0,\s*1\)/u, "cursor alpha threshold value", TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  texturesRequireSignature(renderer, /gsDPSetRenderMode\(G_RM_AA_ZB_TEX_EDGE,\s*G_RM_NOOP2\)/u, "cursor texture-edge render mode", TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  texturesRequireSignature(renderer, /gsDPSetCombineMode\(G_CC_DECALRGBA,\s*G_CC_DECALRGBA\)/u, "cursor decal combine mode", TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  texturesRequireSignature(renderer, /gsDPSetTexturePersp\(G_TP_NONE\)/u, "cursor affine texture coordinates", TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  texturesRequireSignature(renderer, /gDPLoadTextureBlock\(next_gfx\(\),[\s\S]{0,180}G_IM_FMT_RGBA,\s*G_IM_SIZ_16b,\s*32,\s*32,[\s\S]{0,180}G_TX_NOMASK,\s*G_TX_NOMASK/u, "cursor RGBA16 wrap and no-mask state", TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  texturesRequireSignature(renderer, /if\s*\(gGdCtrl\.dragging\)[\s\S]{0,180}gd_texture_hand_closed[\s\S]{0,180}else[\s\S]{0,180}gd_texture_hand_open/u, "dragging selects the closed hand", TEXTURE_SOURCE_PATHS.authoritativeRenderer);
  texturesRequireSignature(renderer, /gSPTextureRectangle\([^;]+1\s*<<\s*10,\s*1\s*<<\s*10\)/u, "cursor one-texel texture-rectangle step", TEXTURE_SOURCE_PATHS.authoritativeRenderer);

  texturesRequireSignature(candidate, /export\s+const\s+gd_texture_mario_face_shine\s*=\s*\[\s*\]/u, "candidate empty shine pixel declaration", TEXTURE_SOURCE_PATHS.candidateRenderer);
  texturesRequireSignature(candidate, /G_TEXTURE_GEN/u, "candidate shine texgen clarification", TEXTURE_SOURCE_PATHS.candidateRenderer);
  texturesRequireSignature(candidate, /G_CC_HILITERGBA/u, "candidate shine combine clarification", TEXTURE_SOURCE_PATHS.candidateRenderer);
  return Object.freeze({
    candidatePixelAuthority: false,
    candidateKnownGap: "gd_texture_mario_face_shine is empty; pixels come only from the qualified local ROM",
  });
}

function defaultReadRomRange({ romPath, offset, bytes, asset }) {
  let descriptor;
  try {
    descriptor = openSync(romPath, fsConstants.O_RDONLY);
  } catch (error) {
    texturesFail(`could not open qualified ROM read-only: ${error.message}`, asset);
  }
  const output = Buffer.alloc(bytes);
  let cursor = 0;
  try {
    while (cursor < bytes) {
      const count = readSync(descriptor, output, cursor, bytes - cursor, offset + cursor);
      if (count === 0) texturesFail(`ROM ended before exact range ${offset}+${bytes}`, asset);
      cursor += count;
    }
  } finally {
    closeSync(descriptor);
  }
  return output;
}

function decodeTexture(item, source) {
  if (!Buffer.isBuffer(source) || source.length !== item.bytes) {
    texturesFail(`exact ROM range returned ${source?.length ?? "no"} bytes; expected ${item.bytes}`, item.asset);
  }
  if (item.encoding === "IA8") return decodeIa8(source, item.width, item.height);
  if (item.encoding === "RGBA16") return decodeRgba16(source, item.width, item.height);
  texturesFail(`unsupported title-head texture encoding ${item.encoding}`, item.asset);
}

function channelStats(pixels, channel) {
  const values = [];
  const counts = new Map();
  for (let index = channel; index < pixels.length; index += 4) {
    const value = pixels[index];
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  for (const [value, count] of [...counts.entries()].sort(([left], [right]) => left - right)) {
    values.push({ value, pixels: count });
  }
  return Object.freeze({
    min: values[0].value,
    max: values.at(-1).value,
    uniqueValues: Object.freeze(values),
  });
}

function alphaContract(pixels, encoding, asset) {
  const stats = channelStats(pixels, 3);
  const values = stats.uniqueValues.map(({ value }) => value);
  if (encoding === "RGBA16" && values.some((value) => value !== 0 && value !== 255)) {
    texturesFail("RGBA16 alpha did not remain one-bit after decode", asset);
  }
  if (encoding === "IA8" && values.some((value) => value % 17 !== 0)) {
    texturesFail("IA8 alpha did not remain four-bit expanded by nibble replication", asset);
  }
  return Object.freeze({
    sourceBits: encoding === "RGBA16" ? 1 : 4,
    expansion: encoding === "RGBA16" ? "0-or-255" : "nibble-replication",
    ...stats,
    transparentPixels: stats.uniqueValues.find(({ value }) => value === 0)?.pixels ?? 0,
    opaquePixels: stats.uniqueValues.find(({ value }) => value === 255)?.pixels ?? 0,
    translucentPixels: stats.uniqueValues
      .filter(({ value }) => value > 0 && value < 255)
      .reduce((sum, { pixels: count }) => sum + count, 0),
  });
}

function samplerFor(item) {
  if (item.role === "model-shine") {
    return Object.freeze({
      filter: "G_TF_BILERP",
      productFilter: "bilinear",
      wrapS: "G_TX_WRAP|G_TX_NOMIRROR",
      wrapT: "G_TX_WRAP|G_TX_NOMIRROR",
      productWrapS: "repeat",
      productWrapT: "repeat",
      maskS: 5,
      maskT: 5,
      perspective: "G_TP_PERSP",
      textureScale: Object.freeze({ s: 0x07c0, t: 0x07c0, fractionBits: 16 }),
      combine: "G_CC_HILITERGBA",
      coordinateMode: "dynamic-g-texture-gen-from-current-normal-camera-and-light",
    });
  }
  return Object.freeze({
    filter: "G_TF_BILERP",
    productFilter: "bilinear",
    wrapS: "G_TX_WRAP|G_TX_NOMIRROR",
    wrapT: "G_TX_WRAP|G_TX_NOMIRROR",
    productWrapS: "repeat",
    productWrapT: "repeat",
    maskS: "G_TX_NOMASK",
    maskT: "G_TX_NOMASK",
    perspective: "G_TP_NONE",
    textureScale: Object.freeze({ s: 0x8000, t: 0x8000, fractionBits: 16 }),
    rectangleStep: Object.freeze({ s: 1 << 10, t: 1 << 10, fractionBits: 10 }),
    combine: "G_CC_DECALRGBA",
    alpha: Object.freeze({ compare: "G_AC_THRESHOLD", blendAlpha: 1, renderMode: "G_RM_AA_ZB_TEX_EDGE" }),
    coordinateMode: "fixed-full-32x32-sprite-rectangle",
  });
}

function assertQualifiedRom(rom) {
  if (!rom?.qualified || rom.region !== SM64_US_ROM.region || rom.byteOrder !== SM64_US_ROM.byteOrder
    || rom.size !== SM64_US_ROM.size || rom.sha1 !== SM64_US_ROM.sha1 || rom.copied !== false) {
    texturesFail("texture prepare requires the qualified user-owned US big-endian ROM");
  }
}

function buildTitleHeadTextures({
  romPath,
  qualifiedRom,
  authoritativeAssetsSource,
  authoritativeRendererSource,
  candidateAssetsSource,
  candidateRendererSource,
  authoritativeRevision,
  candidateRevision,
  readRomRange = defaultReadRomRange,
} = {}) {
  assertQualifiedRom(qualifiedRom);
  if (typeof romPath !== "string" || romPath.length === 0) texturesFail("qualified ROM path is required but is never retained");
  if (typeof authoritativeRevision !== "string" || typeof candidateRevision !== "string") texturesFail("pinned source revisions are required");
  const plan = resolveTexturePlan(authoritativeAssetsSource, candidateAssetsSource);
  const candidateClarifier = validateRendererSources(authoritativeRendererSource, candidateRendererSource);
  const files = [];
  let shineTexture = null;
  const textures = plan.map((item) => {
    const source = readRomRange({ romPath, offset: item.offset, bytes: item.bytes, asset: item.asset });
    const pixels = decodeTexture(item, source);
    if (item.role === "model-shine") {
      shineTexture = Object.freeze({
        width: item.width,
        height: item.height,
        pixels,
      });
    }
    const png = encodePngRgba8(pixels, item.width, item.height);
    const browserImage = Object.freeze({
      path: item.outputPath,
      role: `${item.role}-png`,
      encoding: "PNG-RGBA8",
      width: item.width,
      height: item.height,
      bytes: png.length,
      sha256: titleHeadSha256(png),
    });
    files.push(Object.freeze({ path: item.outputPath, role: browserImage.role, bytes: png }));
    const uv = createUvProof(item.width, item.height);
    return Object.freeze({
      id: item.id,
      role: item.role,
      source: Object.freeze({
        asset: item.asset,
        symbol: item.symbol,
        include: item.include,
        encoding: item.encoding,
        dimensions: Object.freeze([item.width, item.height]),
        range: Object.freeze({ offset: item.offset, bytes: item.bytes, endExclusive: item.offset + item.bytes }),
        rawSha256: titleHeadSha256(source),
        compression: "direct-rom",
        rawBytesRetained: false,
      }),
      decoded: Object.freeze({
        encoding: "RGBA8",
        bytes: pixels.length,
        sha256: titleHeadSha256(pixels),
        alpha: alphaContract(pixels, item.encoding, item.asset),
        intensity: item.encoding === "IA8" ? channelStats(pixels, 0) : null,
        conversion: item.encoding === "IA8"
          ? "I4 and A4 expanded independently by nibble replication"
          : "RGB5 expanded by bit replication; A1 expanded to 0 or 255",
      }),
      sampler: samplerFor(item),
      uv: Object.freeze({
        ...uv,
        staticAtRuntime: item.role !== "model-shine",
        coordinateMode: item.role === "model-shine"
          ? "generated-per-current-normal-with-stable-image-leaf"
          : "fixed-full-image",
      }),
      presentation: item.role === "model-shine"
        ? Object.freeze({ stableImageLeaf: true, runtimePixelReads: false, generatedCoordinateTransformMayUpdate: true })
        : Object.freeze({ stableImageLeaf: true, runtimePixelReads: false, cursorState: item.role === "cursor-closed" ? "dragging" : "not-dragging" }),
      browserImage,
    });
  });

  const payload = {
    schema: TITLE_HEAD_TEXTURES_SCHEMA,
    slice: "regular-interactive-title-head",
    policy: {
      selection: "exact-three-asset-allowlist",
      selectedAssets: TITLE_HEAD_TEXTURE_SPECS.length,
      decodedAtPrepare: true,
      rawRomBytesWritten: false,
      runtimePixelReads: false,
      runtimeRasterComposition: false,
      browserRasterSurfaceUsed: false,
      productRenderer: "PolyCSS/DOM/CSS",
      outputRoot: "ignored-build-generated-public-title-head",
    },
    sourceState: {
      shine: {
        materialIdentity: "GD_MTL_SHINE_DL",
        textureIdentity: "title-head:mario-face-shine",
        coordinates: "G_TEXTURE_GEN",
        topologyAndImageLeavesStable: true,
      },
      cursor: {
        openTextureIdentity: "title-head:hand-open",
        closedTextureIdentity: "title-head:hand-closed",
        closedWhen: "gGdCtrl.dragging",
        leavesStableAndVisibilityOnly: true,
      },
      candidateClarifier,
    },
    inputs: {
      rom: {
        source: "SM64_ROM",
        region: qualifiedRom.region,
        byteOrder: qualifiedRom.byteOrder,
        size: qualifiedRom.size,
        sha1: qualifiedRom.sha1,
        pathRetained: false,
        copied: false,
      },
      authoritativeAssets: {
        source: `n64decomp/sm64:${TEXTURE_SOURCE_PATHS.authoritativeAssets}`,
        revision: authoritativeRevision,
        sha256: titleHeadSha256(Buffer.from(authoritativeAssetsSource, "utf8")),
      },
      authoritativeRenderer: {
        source: `n64decomp/sm64:${TEXTURE_SOURCE_PATHS.authoritativeRenderer}`,
        revision: authoritativeRevision,
        sha256: titleHeadSha256(Buffer.from(authoritativeRendererSource, "utf8")),
      },
      candidateAssets: {
        source: `sm64js/sm64js:${TEXTURE_SOURCE_PATHS.candidateAssets}`,
        revision: candidateRevision,
        role: "range-cross-check-only",
        sha256: titleHeadSha256(Buffer.from(candidateAssetsSource, "utf8")),
      },
      candidateRenderer: {
        source: `sm64js/sm64js:${TEXTURE_SOURCE_PATHS.candidateRenderer}`,
        revision: candidateRevision,
        role: "state-clarifier-not-pixel-authority",
        sha256: titleHeadSha256(Buffer.from(candidateRendererSource, "utf8")),
      },
    },
    textures,
    totals: {
      textures: textures.length,
      sourceBytes: textures.reduce((sum, texture) => sum + texture.source.range.bytes, 0),
      decodedBytes: textures.reduce((sum, texture) => sum + texture.decoded.bytes, 0),
      pngBytes: textures.reduce((sum, texture) => sum + texture.browserImage.bytes, 0),
    },
  };
  if (shineTexture === null) {
    texturesFail("the prepared shine texture is absent");
  }
  const contract = Object.freeze({ ...payload, contentHash: titleHeadContentHash(payload) });
  return Object.freeze({
    contract,
    files: Object.freeze(files),
    workspace: Object.freeze({ shineTexture }),
  });
}
export {
  buildTitleHeadAnimationGraph,
  buildTitleHeadDeformationGraph,
  buildTitleHeadGeometry,
  buildTitleHeadMaterials,
  buildTitleHeadTextures,
};
