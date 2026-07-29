import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import {
  createPreparePaths,
  repoRelativePath,
} from "./paths.mjs";
import { qualifyRom, resolveRomPath } from "./romSource.mjs";
import {
  inspectUpstreamCheckout,
  SM64_UPSTREAMS,
  synchronizeAllUpstreams,
} from "./upstreams.mjs";
import { loadTitleHeadDynlistGraph } from "./stages/dynlistLoader.mjs";
import {
  buildTitleHeadAnimationGraph,
  buildTitleHeadDeformationGraph,
  buildTitleHeadGeometry,
  buildTitleHeadMaterials,
  buildTitleHeadTextures,
} from "./stages/baseModel.mjs";
import {
  buildTitleHeadLightingTimeline,
  buildTitleHeadLightingTimelineReport,
  prepareTitleHeadLightingAtlases,
  prepareTitleHeadSpaceTimeTexels,
} from "./stages/lighting.mjs";
import {
  buildTitleHeadTrianglePlan,
  buildTitleHeadSourceLightingTrianglePlan,
  encodeTitleHeadSurfaceAtlas,
} from "./stages/trianglePlan.mjs";
import { prepareTitleHeadStarEffects } from "./stages/effects.mjs";
import { prepareTitleHeadInteractionClosure } from "./stages/interaction.mjs";
import {
  prepareTitleHeadFootprintReport,
  prepareTitleHeadMotion,
  prepareTitleHeadRetainedVisibility,
} from "./stages/motion.mjs";
import { prepareTitleHeadPlaybackPacket } from "./stages/playbackPacket.mjs";
import {
  serializeTitleHeadContract,
  titleHeadSha256,
} from "./stages/contract.mjs";
import {
  prepareTitleHeadTransformAudit,
  prepareTitleHeadVisibilityAudit,
} from "./stages/visibilityAudit.mjs";
import { prepareTitleHeadVisibilityCulling } from "./stages/visibilityCulling.mjs";
import { fileURLToPath } from "node:url";
import { resolvePreparationCode } from "./codeLayout.mjs";
import {
  assertEmptyOutputRoot,
  writePreparedFile,
} from "../../prepare/shared/files.mjs";

function resolvePolyCssRoot() {
  let current = dirname(fileURLToPath(import.meta.resolve("@layoutit/polycss")));
  for (;;) {
    const metadataPath = resolve(current, "package.json");
    if (existsSync(metadataPath)) {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      if (metadata.name === "@layoutit/polycss") return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Could not resolve the installed @layoutit/polycss package root.");
    }
    current = parent;
  }
}

const POLYCSS_ROOT = resolvePolyCssRoot();
const DEFAULT_REPO_ROOT = resolve(import.meta.dirname, "../../..");
const EXPECTED_CANONICAL_SIZING_SIGNATURE =
  "4fbb3d57913a1c9dfdbbff6f48f73caa531a3f025ce70231148be75982914d72";
const EXPECTED_TRANSFORM_SAMPLING_SIGNATURE =
  "3bac6823fe495377853e4fc3da9f115b50b45384c558be99e9f1bc47c37f5cea";
const EXPECTED_ATLAS_WIDTH = 4852;
const EXPECTED_ATLAS_HEIGHT = 3280;
const EXPECTED_FIELD_SIZE = 4;
const EXPECTED_FACE_COUNT = 1213;
const EXPECTED_FRAME_COUNT = 820;
const TITLE_HEAD_ACCEPTED_TEXELS_SHA256 =
  "cb3cbaedb6a0a6680652640210df470f48b4d92f1896a35e816851379b91f5ca";

function readText(path) {
  return readFileSync(path, "utf8");
}

function revision(sources, id) {
  const source = sources.find((entry) => entry.id === id);
  if (!source) throw new Error(`Missing title-head source revision: ${id}`);
  return source.revision;
}

function canonicalSizingSignature(lighting) {
  return titleHeadSha256(Buffer.from(JSON.stringify(lighting.surface.faces.map(
    (face) => [
      face.faceId,
      face.tileWidth,
      face.tileHeight,
      face.leafWidth,
      face.leafHeight,
      face.stateCount,
    ],
  ))));
}

function transformSamplingSignature(report) {
  return titleHeadSha256(Buffer.from(JSON.stringify({
    sourceViewport: report.sourceViewport,
    sourceFrames: report.sourceFrames,
    sampledFrameMinimum: report.sampledFrameMinimum,
    sampledFrameMaximum: report.sampledFrameMaximum,
    method: report.method,
    interpretation: report.interpretation,
    summary: report.summary,
    byShape: report.byShape,
    byMaterial: report.byMaterial,
    offenders: report.offenders,
    faces: report.faces,
  })));
}

function copyExactFile(sourceRoot, outputRoot, path, outputPath = path) {
  copyFileSync(resolve(sourceRoot, path), resolve(outputRoot, outputPath));
}

function preparedFileBytes(files, path) {
  const file = files.find((entry) => entry.path === path);
  if (!file || !Buffer.isBuffer(file.bytes)) {
    throw new Error(`Prepared package input ${path} is absent.`);
  }
  return file.bytes;
}

function completeSources(paths) {
  const sourceIds = new Set(["n64decomp-sm64", "sm64js"]);
  const sources = SM64_UPSTREAMS
    .filter(({ id }) => sourceIds.has(id))
    .map((source) => {
      const state = inspectUpstreamCheckout(source, paths.upstream.absolute);
      if (!state.ok) {
        throw new Error(
          `${source.id} is not pinned and clean; run sync-sm64-upstreams first.`,
        );
      }
      return Object.freeze({
        id: source.id,
        revision: source.revision,
        role: source.role,
      });
    });
  if (sources.length !== sourceIds.size) {
    throw new Error("The title-head source closure is incomplete.");
  }
  return Object.freeze(sources);
}

async function prepareBaseArtifacts({
  upstreamRoot,
  outputRoot,
  emit,
  romPath,
  qualifiedRom,
  sources,
  polycssRoot,
}) {
  const root = outputRoot;
  const authoritativeRoot = resolve(upstreamRoot, "sm64");
  const candidateRoot = resolve(upstreamRoot, "sm64js");
  const candidateGoddardRoot = resolve(candidateRoot, "src/goddard");
  const authoritativeRevision = revision(sources, "n64decomp-sm64");
  const candidateRevision = revision(sources, "sm64js");
  const polycssPackageJson = JSON.parse(
    readText(resolve(polycssRoot, "package.json")),
  );
  const polycssPackage = Object.freeze({
    name: polycssPackageJson.name,
    version: polycssPackageJson.version,
  });

  const graph = loadTitleHeadDynlistGraph({ goddardRoot: candidateGoddardRoot });
  const geometry = buildTitleHeadGeometry({
    graph,
    provenance: {
      sm64jsRevision: candidateRevision,
      authoritativeRevision,
      rom: qualifiedRom,
    },
  });
  const dynlistsHeaderSource = readText(
    resolve(authoritativeRoot, "src/goddard/dynlists/dynlists.h"),
  );
  const shapeHelperSource = readText(
    resolve(authoritativeRoot, "src/goddard/shape_helper.c"),
  );
  const deformation = buildTitleHeadDeformationGraph({
    graph,
    geometry,
    dynlistsHeaderSource,
    shapeHelperSource,
  });
  const animation = buildTitleHeadAnimationGraph({
    graph,
    deformation,
    dynlistsHeaderSource,
    shapeHelperSource,
  });
  const authoritativeRendererSource = readText(
    resolve(authoritativeRoot, "src/goddard/renderer.c"),
  );
  const candidateRendererSource = readText(
    resolve(candidateGoddardRoot, "GoddardRenderer.js"),
  );
  const materials = buildTitleHeadMaterials({
    graph,
    geometry,
    animation,
    authoritativeSources: {
      renderer: authoritativeRendererSource,
      drawObjects: readText(resolve(authoritativeRoot, "src/goddard/draw_objects.c")),
      objects: readText(resolve(authoritativeRoot, "src/goddard/objects.c")),
      shapeHelper: shapeHelperSource,
      gdTypes: readText(resolve(authoritativeRoot, "src/goddard/gd_types.h")),
      gbi: readText(resolve(authoritativeRoot, "include/PR/gbi.h")),
    },
    candidateSources: {
      renderer: candidateRendererSource,
      draw: readText(resolve(candidateGoddardRoot, "Draw.js")),
      objects: readText(resolve(candidateGoddardRoot, "Objects.js")),
      dynlistProc: readText(resolve(candidateGoddardRoot, "DynlistProc.js")),
    },
    polycssPackage,
  });
  const trianglePlan = buildTitleHeadTrianglePlan({
    geometry,
    deformation,
    animation,
    materials,
  });
  const textureBuild = buildTitleHeadTextures({
    romPath,
    qualifiedRom,
    authoritativeAssetsSource: readText(resolve(authoritativeRoot, "assets.json")),
    authoritativeRendererSource,
    candidateAssetsSource: readText(resolve(candidateRoot, "src/assets.js")),
    candidateRendererSource,
    authoritativeRevision,
    candidateRevision,
  });
  emit(
    "head-geometry.json",
    serializeTitleHeadContract(geometry),
    "title-head-geometry-contract",
  );
  emit(
    "deformation-graph.json",
    serializeTitleHeadContract(deformation),
    "title-head-deformation-contract",
  );
  emit(
    "animation-graph.json",
    serializeTitleHeadContract(animation),
    "title-head-animation-contract",
  );
  emit(
    "materials.json",
    serializeTitleHeadContract(materials),
    "title-head-material-contract",
  );
  emit(
    trianglePlan.atlas.path,
    encodeTitleHeadSurfaceAtlas(trianglePlan),
    trianglePlan.atlas.role,
  );
  emit(
    "triangle-plan.json",
    serializeTitleHeadContract(trianglePlan),
    "title-head-triangle-plan-contract",
  );
  const motionOutput = resolve(root, `.motion-frames-${process.pid}.bin`);
  let motion;
  try {
    motion = await prepareTitleHeadMotion({
      animation,
      deformation,
      geometry,
      materials,
      trianglePlan,
      output: motionOutput,
    });
    emit(
      "motion-frames.bin",
      motion.bytes,
      "title-head-prepared-motion",
    );
  } finally {
    rmSync(motionOutput, { force: true });
  }
  for (const file of textureBuild.files) {
    emit(file.path, file.bytes, file.role);
  }
  emit(
    "textures.json",
    serializeTitleHeadContract(textureBuild.contract),
    "title-head-texture-contract",
  );

  return Object.freeze({
    animation,
    deformation,
    geometry,
    materials,
    motionBytes: motion.bytes,
    motionPlayback: motion.playback,
    motionSampling: motion.sampling,
    textures: textureBuild.contract,
    textureFiles: textureBuild.files,
    shineTexture: textureBuild.workspace.shineTexture,
    trianglePlan,
  });
}

function prepareLightingTimeline(paths, { animation, deformation, materials }) {
  const authoritativeRoot = resolve(paths.upstream.absolute, "sm64");
  const timeline = buildTitleHeadLightingTimeline({
    animation,
    deformation,
    materials,
    authoritativeSources: {
      drawObjects: readText(resolve(authoritativeRoot, "src/goddard/draw_objects.c")),
      renderer: readText(resolve(authoritativeRoot, "src/goddard/renderer.c")),
      gbi: readText(resolve(authoritativeRoot, "include/PR/gbi.h")),
      gdMath: readText(resolve(authoritativeRoot, "src/goddard/gd_math.c")),
      shapeHelper: readText(resolve(authoritativeRoot, "src/goddard/shape_helper.c")),
    },
  });
  const report = buildTitleHeadLightingTimelineReport(timeline);
  mkdirSync(paths.reports.absolute, { recursive: true });
  writeFileSync(
    resolve(paths.reports.absolute, "title-head-lighting-timeline-data.json"),
    serializeTitleHeadContract(timeline),
  );
  writeFileSync(
    resolve(paths.reports.absolute, "title-head-lighting-timeline.json"),
    serializeTitleHeadContract(report),
  );
  console.log(
    `Prepared title-head lighting timeline: ${timeline.frameCount} frames, `
    + `${timeline.states.combined.length} combined states, `
    + `${timeline.states.shine.length} shine states -> `
    + `${paths.reports.relative}/title-head-lighting-timeline-data.json`,
  );
  return timeline;
}

export async function prepare({
  repoRoot: repoRootOption = DEFAULT_REPO_ROOT,
  romPath,
  outputRoot: outputRootOption,
  reportRoot: reportRootOption,
  upstreamRoot: upstreamRootOption,
  env = process.env,
  syncUpstreams = true,
} = {}) {
  const root = resolve(repoRootOption);
  const configuredEnv = {
    ...env,
    ...(romPath ? { SM64_ROM: resolve(romPath) } : {}),
    ...(outputRootOption
      ? { SM64_GENERATED_ROOT: repoRelativePath(root, outputRootOption, "outputRoot") }
      : {}),
    ...(reportRootOption
      ? { SM64_REPORT_ROOT: repoRelativePath(root, reportRootOption, "reportRoot") }
      : {}),
    ...(upstreamRootOption
      ? { SM64_UPSTREAM_ROOT: repoRelativePath(root, upstreamRootOption, "upstreamRoot") }
      : {}),
  };
  const paths = createPreparePaths({ cwd: root, env: configuredEnv });
  const repoRoot = paths.repoRoot;
  const outputRoot = paths.generated.absolute;
  if (existsSync(outputRoot) || existsSync(paths.reports.absolute)) {
    throw new Error(
      "The ROM-backed title-head prepare requires fresh ignored output and report roots.",
    );
  }
  if (syncUpstreams) {
    synchronizeAllUpstreams({ root: paths.upstream.absolute });
  }
  const qualifiedRom = qualifyRom({ cwd: repoRoot, env: configuredEnv });
  const rom = resolveRomPath(configuredEnv, repoRoot);
  const sources = completeSources(paths);
  mkdirSync(dirname(outputRoot), { recursive: true });
  const preparedRoot = assertEmptyOutputRoot(outputRoot);
  const writeOrder = [];
  const artifactLedger = [];
  const emittedPaths = new Set();
  const emit = (path, bytes, role) => {
    if (emittedPaths.has(path)) {
      throw new Error(`Prepared artifact ${path} has more than one writer.`);
    }
    const descriptor = writePreparedFile(
      preparedRoot,
      path,
      Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
      writeOrder,
      role,
    );
    emittedPaths.add(descriptor.path);
    artifactLedger.push(descriptor);
    return descriptor;
  };
  const baseArtifacts = await prepareBaseArtifacts({
    upstreamRoot: paths.upstream.absolute,
    outputRoot: preparedRoot,
    emit,
    romPath: rom.absolute,
    qualifiedRom,
    sources,
    polycssRoot: POLYCSS_ROOT,
  });
  const {
    animation,
    deformation,
    geometry,
    materials,
    motionBytes,
    motionPlayback,
    motionSampling,
    textures,
    textureFiles,
    shineTexture,
    trianglePlan: finalTrianglePlan,
  } = baseArtifacts;
  if (finalTrianglePlan?.leaves?.length !== EXPECTED_FACE_COUNT) {
    throw new Error("The final PolyCSS triangle plan is incomplete before lighting preparation.");
  }

  const childEnv = {
    ...configuredEnv,
    SM64_UPSTREAM_ROOT: paths.upstream.relative,
    SM64_GENERATED_ROOT: paths.generated.relative,
    SM64_REPORT_ROOT: paths.reports.relative,
  };
  const transformAuditRoot = `${outputRoot}-transform-audit-${process.pid}`;
  const footprintReport = resolve(
    paths.reports.absolute,
    "title-head-surface-footprints.json",
  );
  const rawVisibilityPath = resolve(
    paths.reports.absolute,
    "title-head-visibility-conservative.json",
  );
  const retainedVisibilityPath = resolve(
    paths.reports.absolute,
    "title-head-visibility-retained-safe.json",
  );
  const sourceLightingPath = resolve(
    paths.reports.absolute,
    "title-head-source-lighting.json",
  );
  const transformPath = resolve(
    paths.reports.absolute,
    "title-head-final-transform-sampling.json",
  );
  const spatialPath = resolve(
    paths.reports.absolute,
    "title-head-spatial-resolution.json",
  );
  try {
    const footprint = await prepareTitleHeadFootprintReport({
      geometry,
      deformation,
      animation,
      materials,
      motionSampling,
      reportPath: footprintReport,
    });
    const sourceTrianglePlan = buildTitleHeadSourceLightingTrianglePlan({
      geometry,
      deformation,
      animation,
      materials,
    });
    const sourceTrianglePlanBytes = Buffer.from(
      serializeTitleHeadContract(sourceTrianglePlan),
    );

    const lightingTimeline = prepareLightingTimeline(
      paths,
      { animation, deformation, materials },
    );
    const sourceLightingBuild = prepareTitleHeadLightingAtlases({
      timeline: lightingTimeline,
      trianglePlan: sourceTrianglePlan,
      materials,
      textures,
      shineTexture,
      footprintBuild: footprint,
    });
    mkdirSync(paths.reports.absolute, { recursive: true });
    writeFileSync(
      resolve(
        paths.reports.absolute,
        "title-head-lighting-atlas-plan.json",
      ),
      serializeTitleHeadContract(sourceLightingBuild.atlasPlan),
    );
    writeFileSync(
      resolve(
        paths.reports.absolute,
        "title-head-lighting-state-field.json",
      ),
      serializeTitleHeadContract(
        sourceLightingBuild.stateField.contract,
      ),
    );
    writeFileSync(
      resolve(
        paths.reports.absolute,
        "title-head-lighting-state-field.bin",
      ),
      sourceLightingBuild.stateField.bytes,
    );

    const sourceLighting = sourceLightingBuild.contract;
    const sourceLightingBytes = Buffer.from(
      serializeTitleHeadContract(sourceLighting),
    );
    if (sourceLighting?.schema !== "cssgraphics-title-head-lighting-atlases@7"
      || sourceLighting.trianglePlanHash !== sourceTrianglePlan.contentHash
      || sourceLighting.surface?.faces?.length !== EXPECTED_FACE_COUNT) {
      throw new Error(
        "The generated source lighting closure is incomplete.",
      );
    }
    writeFileSync(sourceLightingPath, sourceLightingBytes);

    mkdirSync(transformAuditRoot, { recursive: true });
    for (const path of ["animation-graph.json", "deformation-graph.json"]) {
      copyExactFile(outputRoot, transformAuditRoot, path);
    }
    writeFileSync(
      resolve(transformAuditRoot, "triangle-plan-footprint.json"),
      footprint.trianglePlanBytes,
    );
    writeFileSync(
      resolve(transformAuditRoot, "motion-frames-footprint.bin"),
      footprint.motionBytes,
    );
    writeFileSync(
      resolve(transformAuditRoot, "triangle-plan.json"),
      sourceTrianglePlanBytes,
    );

    const { createServer } = await import("vite");
    const server = await createServer({
      root: repoRoot,
      configFile: false,
      publicDir: false,
      logLevel: "error",
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    try {
      const address = server.httpServer.address();
      if (!address || typeof address === "string") {
        throw new Error("The prepare audit server did not expose a local port.");
      }
      const base = `http://127.0.0.1:${address.port}`;
      const auditRoot = resolvePreparationCode(
        "src/adapters/super-mario-64/audit/index.html",
      );
      const fixture = new URL(`/@fs/${auditRoot}`, base);
      fixture.searchParams.set(
        "root",
        `/${repoRelativePath(repoRoot, transformAuditRoot)}`,
      );
      fixture.searchParams.set(
        "footprints",
        `/${paths.reports.relative}/title-head-surface-footprints.json`,
      );
      fixture.searchParams.set("mode", "visibility");
      const rawVisibility = await prepareTitleHeadVisibilityAudit({
        url: fixture.href,
        reportPath: rawVisibilityPath,
        conservativeUnion: true,
        browserExecutable: childEnv.CSSGRAPHICS_BROWSER_EXECUTABLE ?? null,
        browserChannel: childEnv.CSSGRAPHICS_BROWSER_CHANNEL ?? null,
      });
      const rawVisibilityBytes = Buffer.from(
        `${JSON.stringify(rawVisibility, null, 2)}\n`,
      );
      const rawVisibilityBuild = Object.freeze({
        report: rawVisibility,
        bytes: rawVisibilityBytes,
      });
      const retainedVisibility = prepareTitleHeadRetainedVisibility({
        rawVisibility,
        rawVisibilityBytes,
        output: retainedVisibilityPath,
      });

      const canonicalCulling = prepareTitleHeadVisibilityCulling({
        visibilityBuild: rawVisibilityBuild,
        sourceLightingBuild,
        finalTrianglePlan,
        footprintBuild: footprint,
        motionBytes,
        canonicalBaseline: true,
      });
      if (canonicalSizingSignature(canonicalCulling.contract)
        !== EXPECTED_CANONICAL_SIZING_SIGNATURE) {
        throw new Error(
          "The canonical fresh-ROM title-head sizing baseline changed.",
        );
      }
      const canonicalLightingPath = resolve(
        transformAuditRoot,
        "lighting-atlases.json",
      );
      const canonicalSpatialPath = resolve(
        transformAuditRoot,
        "title-head-spatial-resolution.json",
      );
      writeFileSync(
        canonicalLightingPath,
        serializeTitleHeadContract(canonicalCulling.contract),
      );
      writeFileSync(
        canonicalSpatialPath,
        serializeTitleHeadContract(canonicalCulling.spatial.report),
      );

      fixture.searchParams.set(
        "sizing",
        `/${repoRelativePath(repoRoot, canonicalLightingPath)}`,
      );
      fixture.searchParams.set("mode", "transform");
      fixture.searchParams.set("raster", "leaf");
      const transformSampling = await prepareTitleHeadTransformAudit({
        url: fixture.href,
        reportPath: transformPath,
        trianglePlanPath: resolve(
          transformAuditRoot,
          "triangle-plan.json",
        ),
        lightingPath: canonicalLightingPath,
        footprintPath: footprintReport,
        spatialPath: canonicalSpatialPath,
        browserExecutable: childEnv.CSSGRAPHICS_BROWSER_EXECUTABLE ?? null,
        browserChannel: childEnv.CSSGRAPHICS_BROWSER_CHANNEL ?? null,
      });
      if (transformSamplingSignature(transformSampling)
        !== EXPECTED_TRANSFORM_SAMPLING_SIGNATURE) {
        throw new Error("The final title-head transform sampling changed.");
      }
      const finalCulling = prepareTitleHeadVisibilityCulling({
        visibilityBuild: retainedVisibility,
        sourceLightingBuild,
        sizingBaseline: canonicalCulling,
        finalTrianglePlan,
        footprintBuild: footprint,
        transformSamplingReport: transformSampling,
        motionBytes,
      });
      writeFileSync(
        spatialPath,
        serializeTitleHeadContract(finalCulling.spatial.report),
      );
      emit(
        finalCulling.motionTransformTable.contract.path,
        finalCulling.motionTransformTable.bytes,
        "title-head-prepared-motion-transform-table",
      );
      const spaceTime = await prepareTitleHeadSpaceTimeTexels({
        lightingBuild: finalCulling,
        sourceLightingBuild,
        trianglePlan: finalTrianglePlan,
      });
      for (const file of spaceTime.files) {
        emit(file.path, file.bytes, file.role);
      }
      const playback = await prepareTitleHeadPlaybackPacket({
        animation,
        deformation,
        geometry,
        materials,
        motionPlayback,
        motionTransformTable: finalCulling.motionTransformTable,
        trianglePlan: finalTrianglePlan,
        lighting: spaceTime.contract,
      });
      for (const file of playback.files) {
        emit(file.path, file.bytes, file.role);
      }
      const stars = prepareTitleHeadStarEffects({
        paths,
        env: childEnv,
        animation,
        baseTextures: textures,
        lightingTimeline,
        motionBytes,
      });
      for (const file of stars.files) {
        emit(file.path, file.bytes, file.role);
      }
      const lighting = spaceTime.contract;
      const page = lighting.surface?.pages?.[0];
      const atlasSha256 = spaceTime.nativeWebpSha256;
      if (lighting.surface?.pages?.length !== 1
        || page?.width !== EXPECTED_ATLAS_WIDTH
        || page.height !== EXPECTED_ATLAS_HEIGHT
        || lighting.approximation?.fieldWidth !== EXPECTED_FIELD_SIZE
        || lighting.approximation?.fieldHeight !== EXPECTED_FIELD_SIZE
        || finalTrianglePlan.leaves?.length !== EXPECTED_FACE_COUNT
        || playback.contract.sourceFrames?.count !== EXPECTED_FRAME_COUNT
        || playback.contract.leafCount !== EXPECTED_FACE_COUNT
        || !lighting.visibilityCulling
        || !lighting.motionTransforms
        || stars.contract.atlas?.path !== "textures/star-effects.png"
        || atlasSha256 !== TITLE_HEAD_ACCEPTED_TEXELS_SHA256) {
        throw new Error(
          "The completed one-page atlas, topology, playback, transforms, or stars changed.",
        );
      }
      const interaction = await prepareTitleHeadInteractionClosure({
        romPath: rom.absolute,
        qualifiedRom,
        contracts: Object.freeze({
          animation,
          deformation,
          geometry,
          materials,
          trianglePlan: finalTrianglePlan,
          lighting,
          playback: playback.contract,
          stars: stars.contract,
        }),
        artifactLedger: Object.freeze([...artifactLedger]),
      });
      for (const file of interaction.files) {
        emit(file.path, file.bytes, file.role);
      }
      return Object.freeze({
        root: outputRoot,
        reports: paths.reports.absolute,
        qualification: qualifiedRom,
        atlasSha256,
        packageInput: Object.freeze({
          contracts: Object.freeze({
            effects: stars.contract,
            interaction: interaction.contract,
            lighting,
            playback: playback.contract,
            trianglePlan: finalTrianglePlan,
            textures,
          }),
          assets: Object.freeze({
            backgroundPng: preparedFileBytes(
              interaction.files,
              "title-background.png",
            ),
            cursorClosedPng: preparedFileBytes(
              textureFiles,
              "textures/hand-closed.png",
            ),
            cursorOpenPng: preparedFileBytes(
              textureFiles,
              "textures/hand-open.png",
            ),
            effectsPng: preparedFileBytes(
              stars.files,
              "textures/star-effects.png",
            ),
            texelsWebp: preparedFileBytes(
              spaceTime.files,
              "model/title-head-lit-native.webp",
            ),
          }),
        }),
      });
    } finally {
      await server.close();
    }
  } finally {
    rmSync(transformAuditRoot, { recursive: true, force: true });
  }
}
