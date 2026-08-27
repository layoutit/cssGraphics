// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Chaos source-locks the complete upstream model implementation", async () => {
  const lock = JSON.parse(await readFile(new URL("../notes/references/source-lock.json",
    import.meta.url), "utf8"));
  assert.equal(lock.upstream.commit, "2a03f1ae7b0680b0470458783dcb4664660e131a");
  assert.equal(lock.upstream.license, "Apache-2.0");
  const flows = lock.sources.find(({ path }) => path === "dysts/flows.py");
  assert.equal(flows.adaptedClasses.length, 50);
  assert.equal(new Set(flows.adaptedClasses).size, 50);
  assert.ok(lock.sources.some(({ path }) => path === "dysts/data/chaotic_attractors.json"));
  assert.deepEqual(lock.pythonDependencies, {
    numpy: "2.5.2",
    scipy: "1.18.1",
    tqdm: "4.70.0",
    Pillow: "12.3.0",
    Brotli: "1.2.0",
  });
});

test("ranking qualifies every continuous system and packages the visual shortlist", async () => {
  const [rankingSource, packagingSource, curationSource, motionAuditSource, motionToolSource,
    dotAuditSource, dotFidelitySource] =
    await Promise.all([
    readFile(new URL("../tools/rank-dysts-candidates.py", import.meta.url), "utf8"),
    readFile(new URL("../tools/prepare-chaos-assets.py", import.meta.url), "utf8"),
    readFile(new URL("../notes/curation/audition-2026-08-27.json", import.meta.url), "utf8"),
    readFile(new URL("../notes/curation/motion-interest-audit-2026-08-27.json",
      import.meta.url), "utf8"),
    readFile(new URL("../tools/audit-chaos-motion.py", import.meta.url), "utf8"),
    readFile(new URL("../tools/audit-chaos-dot-requirements.py", import.meta.url), "utf8"),
    readFile(new URL("../tools/chaos_dot_fidelity.py", import.meta.url), "utf8"),
  ]);
  const curation = JSON.parse(curationSource);
  const motionAudit = JSON.parse(motionAuditSource);
  assert.equal(curation.schema, "csschaos-audition@2");
  assert.equal(curation.reviewedSystemCount, 135);
  assert.equal(curation.markedForRemoval.length, 33);
  assert.equal(new Set(curation.markedForRemoval).size, 33);
  assert.equal(curation.similarityBias.auditedSystemCount, 102);
  assert.equal(curation.similarityBias.similarityThreshold, 0.91);
  assert.equal(curation.similarityBias.markedForRemoval.length, 7);
  assert.equal(new Set(curation.similarityBias.markedForRemoval).size, 7);
  assert.equal(curation.motionBias.schema, "csschaos-motion-curation@2");
  assert.equal(curation.motionBias.auditSchema, "csschaos-motion-interest-audit@2");
  assert.equal(curation.motionBias.auditedSystemCount, 94);
  assert.equal(curation.motionBias.keptSystemCount, 50);
  assert.equal(curation.motionBias.markedForRemoval.length, 45);
  assert.equal(new Set(curation.motionBias.markedForRemoval).size, 45);
  assert.equal(motionAudit.schema, "csschaos-motion-interest-audit@2");
  assert.equal(motionAudit.auditedSystemCount, 94);
  assert.equal(motionAudit.consideredSystemCount, 95);
  assert.equal(motionAudit.keptSystemCount, 50);
  assert.equal(motionAudit.removedSystemCount, 45);
  assert.equal(motionAudit.score.maximumMedianTravelPxPerSourceFrame, 6);
  assert.deepEqual(new Set(motionAudit.removedSystemIds),
    new Set(curation.motionBias.markedForRemoval));
  assert.equal(new Set(motionAudit.selectedSystemIds).size, 50);
  assert.deepEqual(motionAudit.systems.map(({ motionInterestRank }) => motionInterestRank),
    Array.from({ length: 94 }, (_, index) => index + 1));
  assert.ok(motionAudit.systems.every(({ decision }, index) =>
    decision === (index < 50 ? "keep" : "remove")));
  assert.ok(motionAudit.systems.every((system, index, systems) => index === 0 ||
    (systems[index - 1].motionQualityQualified === system.motionQualityQualified
      ? systems[index - 1].motionInterestScore >= system.motionInterestScore
      : systems[index - 1].motionQualityQualified && !system.motionQualityQualified)));
  assert.ok(motionAudit.systems.slice(0, 50).every(
    ({ motionQualityQualified }) => motionQualityQualified));
  assert.ok(motionAudit.systems.slice(0, 50).every(({ metrics }) =>
    metrics.preparedMedianTravelPxPer100ms / 6 <=
      motionAudit.score.maximumMedianTravelPxPerSourceFrame));
  assert.match(rankingSource, /get_attractor_list\("continuous"\)/u);
  assert.match(rankingSource, /heuristic-visual-coolness-not-source-authority/u);
  assert.match(packagingSource, /selected_systems = tuple\(candidates\)/u);
  assert.match(packagingSource, /expected_count = 50 if args\.selection_stage == "motion" else 95/u);
  assert.match(packagingSource, /len\(visual_removed_system_ids\) != 33/u);
  assert.match(packagingSource, /len\(similarity_removed_system_ids\) != 7/u);
  assert.match(packagingSource, /len\(motion_removed_system_ids\) != 45/u);
  assert.match(motionToolSource, /exact prepared final-camera retained-dot positions/u);
  assert.match(motionToolSource, /structuredNonRigidFlowPercentile/u);
  assert.match(motionToolSource, /REVIEW_FRAME_COUNT = 16/u);
  assert.match(motionToolSource,
    /system\["phases"\]\[system\["revealOrder"\]\] \+ source_frame/u);
  assert.match(dotAuditSource, /csschaos-dot-requirements-audit@1/u);
  assert.match(dotFidelitySource, /DENSITY_COSINE_GATE = 0\.97/u);
  assert.match(dotFidelitySource, /SUPPORT_RECALL_GATE = 0\.90/u);
  assert.match(dotFidelitySource, /P95_GAP_GATE_PIXELS = 6\.0/u);
  assert.match(dotFidelitySource, /prepare_coverage_phase_indices/u);
  assert.match(packagingSource, /STAR_COUNT = 2000/u);
  assert.match(packagingSource,
    /identityMatchingFrames": \[HANDOFF_TRANSITION_FRAME, HANDOFF_FRAME\]/u);
  assert.match(packagingSource, /linear_sum_assignment/u);
  assert.match(packagingSource, /route = list\(selected_systems\)/u);
  assert.match(rankingSource, /source 3D geometry with a rigid prepared PCA camera/u);
  assert.match(rankingSource, /unscaled PCA from source state space to prepared 3D geometry/u);
  assert.doesNotMatch(rankingSource, /camera_values = centered \/ scales/u);
  assert.match(packagingSource, /sourceAxisIndependentScaling/u);
  assert.match(packagingSource, /prepare_handoff_control_coordinates/u);
  assert.match(packagingSource,
    /prepare_handoff_control_coordinates\([\s\S]*name, coordinates, phase_indices\[name\], reveal_order/u);
  assert.match(packagingSource, /trajectory-wave-to-target-v6:\{target_name\}/u);
  assert.match(packagingSource,
    /target_phase_indices\[target_reveal_order\] \+ HANDOFF_TRANSITION_FRAME/u);
  assert.doesNotMatch(packagingSource,
    /scatter-to-target-v3|source_phase_indices\[source_reveal_order\]/u);
  assert.match(packagingSource, /HANDOFF_TRANSITION_FRAME/u);
  assert.match(packagingSource, /decode_final_camera_coordinates/u);
  assert.doesNotMatch(packagingSource, /fit_scatter_cloud_to_camera|project_scatter_positions/u);
  assert.match(packagingSource, /project_final_camera_positions/u);
  assert.match(packagingSource, /preparedFinalCameraProjection/u);
  assert.match(packagingSource, /runtimeThreeDimensionalTransform/u);
  assert.match(packagingSource, /prepare_camera_orientations/u);
  assert.match(packagingSource, /score_camera_geometry/u);
  assert.match(packagingSource, /render_camera_audit/u);
  assert.match(packagingSource, /ranked-shortlist-final-camera-identity-v10\.npz/u);
  assert.match(packagingSource, /final-camera-coverage-first-overlap-shared-reference-v10/u);
  assert.match(packagingSource, /prepare_distributed_phase_indices/u);
  assert.match(packagingSource, /prepare_phase_pattern_candidates/u);
  assert.match(packagingSource, /passes_dot_fidelity_gate/u);
  assert.match(packagingSource, /coverage-greedy/u);
  assert.match(packagingSource, /PHASE_DISTRIBUTION_MAX_GAP = 3/u);
  assert.match(packagingSource, /selectedPairOverlapPercent/u);
  assert.doesNotMatch(packagingSource, /prepare_handoff_phase_offsets/u);
  assert.match(packagingSource, /phase_offsets = \{name: 0 for name in route\}/u);
  assert.match(packagingSource,
    /incoming_positions = positions\[[\s\S]*HANDOFF_TRANSITION_FRAME[\s\S]*outgoing_positions = positions\[[\s\S]*HANDOFF_FRAME/u);
  assert.match(packagingSource, /PHASE_COLOR_STOPS/u);
  assert.match(packagingSource, /srgb8_to_oklab/u);
  assert.match(packagingSource, /gamut_map_oklab/u);
  assert.match(packagingSource, /oklab_to_linear_srgb/u);
  assert.match(packagingSource, /color = format_phase_color\(leaf_index\)/u);
  assert.match(packagingSource,
    /cyclic green-to-white-to-yellow-to-red source-phase gradient with perceptual OKLab interpolation, gamut-mapped sRGB output, and matching green endpoints/u);
  assert.doesNotMatch(packagingSource, /LAVENDER_ACCENT_STRIDE/u);
});

test("the audition advances through shuffled prepared handoffs and performs no runtime matching",
  async () => {
  const [clientSource, playerSource, stylesSource, transportSource, workerSource,
    sceneSource] = await Promise.all([
    readFile(new URL("../src/cssdysts/client.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/cssdysts/preparedPlayback.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/cssdysts/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/cssdysts/preparedRailTransport.mjs", import.meta.url),
      "utf8"),
    readFile(new URL("../src/cssdysts/preparedAssetWorker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/cssdysts/polycssScene.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(clientSource, /selectionTransition !== "instant"/u);
  assert.match(clientSource,
    /startHold\(index, state\.metadata\.sequence\[index\], prepared, playbackOptions\)/u);
  assert.doesNotMatch(clientSource, /morphTo|TRANSITION_SETTLE|nextPaint/u);
  assert.doesNotMatch(clientSource, /queueTransition|holdDeadline|phaseTimer/u);
  assert.match(clientSource, /advance !== "automatic-shuffled-handoff"/u);
  assert.match(clientSource, /prepareShuffledPlaybackOrder/u);
  assert.match(clientSource, /advancePlaybackIndex/u);
  assert.match(clientSource, /preparedPerSystemCamera !== true/u);
  assert.match(clientSource,
    /presentationOrientation\.selectedScore <[\s\S]*presentationOrientation\.baselineScore/u);
  assert.match(clientSource, /onCycleComplete/u);
  assert.match(clientSource, /handoff: true,[\s\S]*initialFrame: 0/u);
  assert.match(clientSource, /publishOpacity: scene\.publishOpacity/u);
  assert.doesNotMatch(clientSource + sceneSource, /setScatterPhase|scatter-out|scatter-in/u);
  assert.match(clientSource, /leafRevealOrder/u);
  assert.match(clientSource, /prepareRankToPhysical/u);
  assert.doesNotMatch(clientSource, /prepareIdentityToPhysical/u);
  assert.match(clientSource, /createPreparedAssetMaterializer/u);
  assert.match(clientSource, /workerStartCount/u);
  assert.match(clientSource, /pending\.set\(requestId/u);
  assert.doesNotMatch(clientSource, /worker\.terminate\(\);[\s\S]{0,160}resolve/u);
  assert.doesNotMatch(clientSource + playerSource, /rewind/iu);
  assert.match(playerSource, /publishScatterToTarget/u);
  assert.match(playerSource, /publishCurvedHandoffFrame/u);
  assert.match(playerSource, /controlWeight = 2 \* inverse \* progress/u);
  assert.doesNotMatch(playerSource, /HANDOFF_STAGGER_SPAN|waveStart/u);
  assert.match(playerSource, /const revealRank = handoff \? rank/u);
  assert.match(playerSource, /const logicalLeaf = leafRevealOrder\[revealRank\]/u);
  assert.match(playerSource,
    /leafPhaseIndices\[logicalLeaf\] \+ transitionFrameCount/u);
  assert.doesNotMatch(playerSource,
    /publishScatterOut|publishScatterIn|scatterFrameCount|setTimeout/u);
  assert.match(playerSource, /findInitialRevealStartRank/u);
  assert.match(playerSource, /phaseOffset = handoff \? 0 : -catalog\.sourcePhaseOffset/u);
  assert.doesNotMatch(clientSource + playerSource, /connector|continuous trail|trailAdvance/u);
  assert.doesNotMatch(clientSource + playerSource + stylesSource, /handoff-morphing/u);
  assert.doesNotMatch(stylesSource, /transition:/u);
  assert.match(playerSource, /prepared\.handoffControlCoordinates/u);
  assert.doesNotMatch(workerSource, /scatterTransforms/u);
  assert.match(playerSource, /cubicBezierProgress/u);
  assert.match(playerSource, /runtimeCoordinateFormattingCount/u);
  assert.match(playerSource, /captureTerminalPreparedComponents/u);
  assert.doesNotMatch(clientSource + playerSource + sceneSource,
    /captureTransforms|handoffStartTransforms|readTransformComponents/u);
  assert.doesNotMatch(playerSource,
    /elapsedFrame < handoffFrameCount && elapsedFrame > publishedFrame/u);
  assert.doesNotMatch(stylesSource, /will-change/u);
  assert.doesNotMatch(stylesSource, /perspective|preserve-3d/u);
  assert.doesNotMatch(stylesSource, /rotateX\(-40deg\) rotateY\(45deg\)/u);
  assert.match(transportSource, /translate[\s\S]*scale/u);
  assert.doesNotMatch(transportSource, /translate3d|rotateX|rotateY/u);
  assert.doesNotMatch(stylesSource, /\.polycss-scene > b::before/u);
  assert.equal((stylesSource.match(/width: 420px;/gu) ?? []).length, 3);
  assert.doesNotMatch(stylesSource, /chaos-horizontal-orbit|chaos-horizontal-billboard/u);
  assert.match(stylesSource, /\.axis-x[\s\S]*\.axis-y[\s\S]*\.axis-z/u);
  assert.match(stylesSource, /\.axis \{[\s\S]*?display: none;/u);
  assert.doesNotMatch(stylesSource, /repeating-linear-gradient/u);
  assert.doesNotMatch(stylesSource, /data-axis|attr\(data-axis\)/u);
});
