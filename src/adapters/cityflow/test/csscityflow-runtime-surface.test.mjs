// SPDX-License-Identifier: HPND
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("publishes every prepared box automatically with a fixed source camera", async () => {
  const [client, dom, player, profileSelection, projection, styles, scheduler, tracePerformance] = await Promise.all([
    readFile(new URL("../src/csscityflow/client.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/csscityflow/preparedDom.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/csscityflow/preparedPlayback.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/csscityflow/profileSelection.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/csscityflow/sourceProjection.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/csscityflow/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/csscityflow/deadlineScheduler.mjs", import.meta.url), "utf8"),
    readFile(new URL("../tools/trace-performance.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(client, /mountPolyMorphModel/u);
  assert.match(client, /const stagingHost = host\.ownerDocument\.createElement\("div"\)/u);
  assert.match(client, /mountPolyMorphModel\(stagingHost,/u);
  assert.match(client, /host\.append\(cameraElement\)/u);
  assert.match(client, /cleanCityflowPreparedDom/u);
  assert.match(client, /createCityflowPreparedPlayer\(\{ playback, dom \}\)/u);
  assert.doesNotMatch(client, /classList\.add\("csscityflow-box"\)/u);
  assert.match(dom, /modelElement\.remove\(\)/u);
  assert.match(dom, /cameraElement\.className = "polycss-camera"/u);
  assert.match(dom, /sceneElement\.className = "polycss-scene"/u);
  assert.match(dom, /element\.removeAttribute\("data-poly-morph-shape"\)/u);
  assert.match(dom, /leaf\.removeAttribute\("data-poly-morph-leaf"\)/u);
  assert.match(dom, /leaf\.style\.removeProperty\("backface-visibility"\)/u);
  assert.match(dom, /leaf\.style\.removeProperty\("width"\)/u);
  assert.match(dom, /retainedModelRootCount:\s*0/u);
  assert.match(dom, /retainedDomAriaAttributeCount/u);
  assert.match(dom, /retainedCameraInlineStyleAttributeCount/u);
  assert.match(dom, /retainedSceneInlineStyleAttributeCount/u);
  assert.match(dom, /retainedSceneInlineTransformCount/u);
  assert.match(dom, /runtimeDomMutationCount/u);
  assert.match(client, /selectCityflowPreparedBank/u);
  assert.ok(client.indexOf("selectCityflowPreparedBank({") <
    client.indexOf("await Promise.all(["), "prepared bank selection must precede all bank fetches");
  assert.match(client, /loadPolyMorphPackage\("\/csscityflow\/", \{ modelId \}\)/u);
  assert.match(client,
    /loadCityflowPreparedPlayback\(`\/csscityflow\/\$\{modelId\}\.playback\.json`\)/u);
  assert.match(client, /loadPreparedStylesheet\(`\/csscityflow\/\$\{modelId\}\.css`\)/u);
  assert.doesNotMatch(client,
    /addEventListener\([^\n]*resize[^\n]*selectCityflowPreparedBank/u);
  assert.match(profileSelection, /width < CSSCITYFLOW_MOBILE_BREAKPOINT_WIDTH/u);
  assert.match(profileSelection, /\(hover: none\) and \(pointer: coarse\)/u);
  assert.doesNotMatch(client, /bindCityflowSourceProjection|ResizeObserver|style\.setProperty/u);
  assert.match(client, /resume\(\)\s*\{\s*if \(!destroyed\) return state\.player\?\.resume\(\)/u);
  assert.match(client,
    /player\.resume\(\);\s*await waitForPaint\(\);[\s\S]*dom\.finalizePreparedTarget\(\);[\s\S]*performance\.mark\("csscityflow-ready"\)/u);
  assert.doesNotMatch(client, /orbitControls|bindCityflowOrbitControls|state\.orbit|animationFrozen/u);
  assert.doesNotMatch(client, /mounted\.updateCamera\(\)/u);
  assert.match(dom, /sceneElement\.removeAttribute\("aria-hidden"\)/u);
  assert.match(dom, /sceneElement\.style\.removeProperty\("transform"\)/u);
  assert.match(dom, /cameraElement\.removeAttribute\("style"\)/u);
  assert.match(dom, /sceneElement\.removeAttribute\("style"\)/u);
  assert.match(client, /dom\.finalizePreparedTarget\(\)/u);
  assert.match(dom, /stylesheet-owned model transform drifted/u);
  assert.match(styles, /container-type:\s*size/u);
  assert.match(styles, /perspective:\s*186\.60254037844388cqh/u);
  assert.match(styles, /transform: translateZ\(186\.60254037844388cqh\)[\s\S]*matrix3d\(/u);
  assert.match(styles, /@container \(min-aspect-ratio:\s*2 \/ 1\)/u);
  assert.match(styles, /top:\s*calc\(100cqh - 50cqw\)/u);
  assert.match(styles, /perspective:\s*186\.60254037844388cqw/u);
  assert.match(client, /rotX:\s*0,\s*rotY:\s*0,\s*zoom:\s*50,/u);
  assert.match(projection, /width > height \* 2/u);
  assert.match(projection, /height - viewportHeight \/ 2/u);
  assert.doesNotMatch(`${client}\n${projection}\n${styles}`, /--csscityflow-camera-|ResizeObserver/u);
  assert.doesNotMatch(styles,
    /data-csscityflow-(?:orbit|dragging)|cursor:\s*(?:grab|grabbing)|touch-action|pointer-events:\s*auto|transform-origin:\s*0 0 -30px/u);
  assert.match(player, /domformat@0\/polycss-playback@0@cc8da736/u);
  assert.match(player,
    /shapeElements\[boxIndex\]\.style\.transform\s*=\s*[\s\S]*transforms\[transformOffsets\[boxIndex\] \+ transformIndex\]/u);
  assert.match(player, /const flatLeafElements = leafElements\.flat\(\)/u);
  assert.match(player, /presentationTransitionColors\[[\s\S]*presentationColorTransitionColorIndices\[cursor\]/u);
  assert.doesNotMatch(player, /publishPreparedBoxState|currentMaterialIndices/u);
  assert.doesNotMatch(player, /setProperty\("--z"/u);
  assert.match(player, /\.style\.backgroundColor = color/u);
  assert.doesNotMatch(player, /data-csscityflow-(?:opacity|base|overlay)/u);
  assert.match(player, /leaf\.style\.visibility = "hidden"/u);
  assert.doesNotMatch(player, /selectVisibilityVariant/u);
  assert.doesNotMatch(player, /shapeElements\[boxIndex\]\.classList\.toggle/u);
  assert.match(player,
    /prepared-viewport-independent-whole-box-direct-leaf-visibility-no-face-culling/u);
  assert.doesNotMatch(player, /style\.backgroundPosition/u);
  assert.match(player, /leaf\.style\.visibility = visible \? "" : "hidden"/u);
  assert.doesNotMatch(player, /shapeElements\[boxIndex\]\.style\.(?:display|visibility)/u);
  assert.doesNotMatch(player, /(?:flatLeafElements|leafElements)[^\n]*style\.display/u);
  assert.match(player, /seekSourceFrame/u);
  assert.match(player, /prepared-periodic-source-sample-reconstruction/u);
  assert.match(player,
    /prepared-packed-transform-components-expanded-once-plus-sparse-final-face-color-and-whole-box-leaf-visibility-publication/u);
  assert.match(player, /pseudoElementSideFacePublication: false/u);
  assert.match(player, /pseudoElementFaceColorOverlay: false/u);
  assert.match(player, /retainedSideLeafPaintOwners: 1/u);
  assert.match(player, /sideLeafPreparedHeight: 1/u);
  assert.match(player, /sideLeafPreparedDefaultDepthScale: playback\.sideDepth\.defaultDepthScale/u);
  assert.match(player, /sideLeafPreparedMaximumDepthScale: playback\.sideDepth\.maximumDepthScale/u);
  assert.match(player, /sideLeafPreparedOverrideCount: playback\.sideDepth\.overrideCount/u);
  assert.match(player, /sideLeafPreparedDefaultTopOffset: 1 - playback\.sideDepth\.defaultDepthScale/u);
  assert.match(player, /sideLeafPreparedMinimumTopOffset: 1 - playback\.sideDepth\.maximumDepthScale/u);
  assert.match(player, /sideLeafLayoutSubpixelFree: true/u);
  assert.match(player, /preparedTimelineAuthority: "sequential-prepared-state-index"/u);
  assert.doesNotMatch(player, /transformAnimations/u);
  assert.doesNotMatch(player, /element\.animate/u);
  assert.match(player, /adjacent-state-late-deadline-reset/u);
  assert.match(scheduler, /requestAnimationFrame/u);
  assert.match(scheduler,
    /schedulerTimeSource: "maximum-animation-frame-timestamp-and-callback-delivery"/u);
  assert.match(scheduler, /publicationPacingTimeSource: "adjacent-state-deadline-schedule"/u);
  assert.match(scheduler, /minimumDistinctPublicationSpacingMilliseconds/u);
  assert.match(scheduler, /displayPhaseResyncCount/u);
  assert.match(scheduler,
    /resumePublicationPolicy: "first-animation-frame-immediate-then-deadline-paced"/u);
  assert.match(scheduler, /Math\.max\(timestamp, deliveredAt\)/u);
  assert.match(scheduler, /publishDue\(tick, 1\)/u);
  assert.match(scheduler, /tick \+= 1/u);
  assert.match(scheduler, /nextFrameAt = publicationTime \+ frameMilliseconds/u);
  assert.doesNotMatch(scheduler, /targetTick|collapsedResyncCount|skippedPresentationFrameCount/u);
  assert.match(tracePerformance, /AnimationFrame::Presentation/u);
  assert.match(tracePerformance, /activatePage:\s*async/u);
  assert.match(tracePerformance, /__csscityflow\.player\.resume\(\)/u);
  assert.match(tracePerformance, /noPresentedThirtyThreeMillisecondHolds/u);
  assert.match(tracePerformance, /noSmoothnessAffectingPipelineDrops/u);
  assert.doesNotMatch(tracePerformance, /color-mix|data-csscityflow-|PERF_EXPERIMENT/u);
  assert.doesNotMatch(tracePerformance, /presentationCadenceP95: draw\.p95Ms/u);
  assert.doesNotMatch(`${client}\n${player}\n${scheduler}`, /setTimeout|setInterval|canvas|getContext/u);
  assert.doesNotMatch(`${client}\n${dom}\n${player}`, /csscityflow-box/u);
});

test("owns project 12 and the shared css.graphics route shell", async () => {
  const adapterRoot = resolve(import.meta.dirname, "..");
  const repositoryRoot = resolve(adapterRoot, "../../..");
  const [html, main, config, projects, sceneRouter, packageJson, notice] = await Promise.all([
    readFile(resolve(adapterRoot, "index.html"), "utf8"),
    readFile(resolve(adapterRoot, "src/main.mjs"), "utf8"),
    readFile(resolve(adapterRoot, "vite.config.mjs"), "utf8"),
    readFile(resolve(repositoryRoot, "site/public/projects.json"), "utf8"),
    readFile(resolve(repositoryRoot, "site/scene-router.mjs"), "utf8"),
    readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    readFile(resolve(adapterRoot, "NOTICE.md"), "utf8"),
  ]);
  const project = JSON.parse(projects).projects.find(({ id }) => id === "cityflow");
  assert.equal(project?.number, 12);
  assert.equal(project?.route, "/cityflow/");
  assert.equal(project?.preview, "/landing/cityflow.webp");
  assert.match(project?.credits?.[0]?.url ?? "", /906693799e4fb7581436590cf84ecb2d3c9186ba\/hacks\/glx\/cityflow\.c$/u);
  assert.match(html, /<!-- cssgraphics-examples-sidebar -->/u);
  assert.match(html, /<main class="example-stage"/u);
  assert.match(html, /<link rel="stylesheet" href="\/site\.css"/u);
  assert.match(main, /mountCityflow\(requireExamplesStage\(\)\)/u);
  assert.match(config, /createExamplesShellPlugin\("cityflow"\)/u);
  assert.match(config, /deployBuild \? "\/cityflow\/" : "\/"/u);
  assert.match(sceneRouter, /mountCityflow\(host\)/u);
  assert.match(packageJson, /CSSCITYFLOW_DEPLOY_BUILD=1 pnpm build:cityflow/u);
  assert.match(notice, /Copyright \(c\) 2014-2017 Jamie Zawinski/u);
  assert.equal((html.match(/<header\b/gu) ?? []).length, 0);
  assert.equal((html.match(/<main\b/gu) ?? []).length, 1);
  assert.equal((html.match(/<canvas\b/gu) ?? []).length, 0);
});
