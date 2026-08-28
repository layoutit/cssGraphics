#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Prepare the ranked, visually curated Chaos trajectory shortlist."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
from pathlib import Path

import brotli
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree
from scipy.spatial.distance import cdist

from chaos_dot_fidelity import (
    COVERAGE_RADIUS_PIXELS,
    DENSITY_COSINE_GATE,
    P95_GAP_GATE_PIXELS,
    SUPPORT_RECALL_GATE,
    SUPPORT_SEED_COUNTS,
    measure_candidate as measure_dot_fidelity,
    measure_retained_spacing,
    measure_temporal_neighbor_spacing_proxy,
    passes_gate as passes_dot_fidelity_gate,
    prepare_audit_frames as prepare_dot_audit_frames,
    prepare_coverage_phase_indices,
    prepare_reference as prepare_dot_reference,
    prepare_support_phase_indices,
)
from chaos_prepared_transport import TRANSPORT_ENCODING, encode_asset


SOURCE_COMMIT = "2a03f1ae7b0680b0470458783dcb4664660e131a"
RANKING_ROOT = Path("output/dysts-ranking")
OUTPUT_ROOT = Path("build/generated/public/csschaos")
MORPH_CACHE_PATH = RANKING_ROOT / "ranked-shortlist-final-camera-identity-v17.npz"
CAMERA_AUDIT_ROOT = RANKING_ROOT / "camera-audit"
PHASE_DISTRIBUTION_AUDIT_PATH = RANKING_ROOT / "phase-distribution-audit.json"
CURATION_PATH = Path("src/adapters/dysts-lab/notes/curation/audition-2026-08-27.json")
SOURCE_LOCK_PATH = Path("src/adapters/dysts-lab/notes/references/source-lock.json")
UPSTREAM_METADATA_PATH = Path(os.environ.get(
    "CSSCHAOS_SOURCE_ROOT", ".local/upstreams/dysts")) / \
    "dysts/data/chaotic_attractors.json"
STAR_COUNT = 2000
SOURCE_SAMPLE_COUNT = 2880
PREPARED_SAMPLE_FACTOR = 2
SAMPLE_COUNT = SOURCE_SAMPLE_COUNT * PREPARED_SAMPLE_FACTOR
SOURCE_FRAME_STEP = PREPARED_SAMPLE_FACTOR
SAMPLES_PER_CHARACTERISTIC_PERIOD = 240
FRAMES_PER_SECOND = 60
REVEAL_SECONDS = 3
HANDOFF_SECONDS = 2
DISPLAY_HOLD_SECONDS = 3
HANDOFF_TRANSITION_FRAME = HANDOFF_SECONDS * FRAMES_PER_SECOND
HANDOFF_FRAME = (HANDOFF_SECONDS + DISPLAY_HOLD_SECONDS) * FRAMES_PER_SECOND
VIEWPORT_WIDTH = 800
VIEWPORT_HEIGHT = 600
VIEWPORT_DEPTH = 600
PERSPECTIVE_DISTANCE = 900
FINAL_CAMERA_SAFE_MARGIN = 48
COORDINATE_SCALE = 10
PREPARED_POSITION_BIAS = 120
PREPARED_DEPTH_BIAS = 500
REFERENCE_COLUMNS = 20
REFERENCE_ROWS = 10
REFERENCE_DEPTHS = 10
CAMERA_GRID_WIDTH = 64
CAMERA_GRID_HEIGHT = 48
CAMERA_SAMPLE_COUNT = 2000
CAMERA_COARSE_YAWS = tuple(range(0, 360, 45))
CAMERA_COARSE_PITCHES = (-60, -30, 0, 30, 60)
CAMERA_COARSE_ROLLS = (0, 45, 90, 135)
CAMERA_REFINEMENT_OFFSETS = (-15, 0, 15)
PHASE_DISTRIBUTION_BASE_STRIDE = 223
PHASE_DISTRIBUTION_FRAME_STEP = 6
PHASE_DISTRIBUTION_MAX_GAP = 4
SPACING_PATTERN_SHORTLIST_COUNT = 24
SPACING_AUDIT_FIRST_FRAME = HANDOFF_TRANSITION_FRAME
SPACING_P95_PARETO_TOLERANCE_PIXELS = 0.5

# Editorial presentation chapters derived from upstream descriptions and citations.
# Playback order is computed independently from prepared geometric similarity.
CHAPTERS = (
    ("foundations", "Foundations", (
        "Lorenz", "Rossler", "Aizawa",
    )),
    ("fluids-climate", "Fluids & climate", (
        "ArnoldBeltramiChildress", "Rucklidge", "BickleyJet",
    )),
    ("mechanics-oscillators", "Mechanics & oscillators", (
        "GuckenheimerHolmes", "StickSlipOscillator", "SwingingAtwood",
    )),
    ("circuits-chemistry", "Circuits & chemistry", (
        "YuWang2", "MultiChua", "BelousovZhabotinsky",
    )),
    ("biology-ecology-neural", "Biology, ecology & neural", (
        "SaltonSea", "Hopfield", "HastingsPowell",
    )),
    ("constructed-algebraic", "Constructed algebraic", (
        "DequanLi", "SprottD", "Arneodo",
    )),
    ("delay-high-dimensional", "Delay & high-dimensional", (
        "IkedaDelay", "VossDelay", "HyperJha",
    )),
)
# Familiar attractor colors, interpolated perceptually during preparation.
# Source trajectory phase rank remains the data authority for leaf assignment.
PHASE_COLOR_STOPS = (
    (0.00, (0x42, 0xFF, 0x8A)),
    (0.28, (0xFF, 0xFF, 0xFF)),
    (0.36, (0xFF, 0xFF, 0xFF)),
    (0.52, (0xFF, 0xE0, 0x66)),
    (0.76, (0xFF, 0x5C, 0x5C)),
    (0.86, (0xFF, 0x5C, 0x5C)),
    (0.94, (0xFF, 0xE0, 0x66)),
    (1.00, (0x42, 0xFF, 0x8A)),
)
GAMUT_SEARCH_STEPS = 24


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--selection-stage", choices=("similarity", "motion"), default="motion",
        help="prepare the 95-system pre-motion bank or final 50-system bank")
    parser.add_argument("--output-root", type=Path, default=OUTPUT_ROOT)
    return parser.parse_args()


def prepared_source_frame(display_frame: int) -> int:
    return display_frame * SOURCE_FRAME_STEP


def main() -> None:
    args = parse_args()
    ranking = json.loads((RANKING_ROOT / "ranking.json").read_text())
    if ranking.get("qualification", {}).get("sampleCount") != SOURCE_SAMPLE_COUNT or \
            ranking["qualification"].get("samplesPerCharacteristicPeriod") != \
            SAMPLES_PER_CHARACTERISTIC_PERIOD:
        raise RuntimeError("Chaos source trajectory density drifted")
    upstream_metadata = json.loads(UPSTREAM_METADATA_PATH.read_text())
    curation = json.loads(CURATION_PATH.read_text())
    source_lock = json.loads(SOURCE_LOCK_PATH.read_text())
    visual_removed_system_ids = frozenset(curation["markedForRemoval"])
    similarity_curation = curation.get("similarityBias", {})
    similarity_removed_system_ids = frozenset(similarity_curation.get("markedForRemoval", ()))
    motion_curation = curation.get("motionBias", {})
    motion_removed_system_ids = frozenset(motion_curation.get("markedForRemoval", ()))
    motion_audit_path = CURATION_PATH.parent / motion_curation.get("auditRecord", "")
    motion_audit = json.loads(motion_audit_path.read_text()) if motion_audit_path.is_file() else {}
    pre_motion_removed_system_ids = visual_removed_system_ids | similarity_removed_system_ids
    removed_system_ids = pre_motion_removed_system_ids | (
        motion_removed_system_ids if args.selection_stage == "motion" else frozenset())
    base_curation_invalid = (
        curation.get("schema") != "csschaos-audition@2" or
            curation.get("reviewedSystemCount") != 135 or \
            len(visual_removed_system_ids) != 33 or \
            similarity_curation.get("schema") != "csschaos-similarity-curation@1" or \
            similarity_curation.get("auditSchema") != "csschaos-shape-similarity-audit@1" or \
            similarity_curation.get("auditedSystemCount") != 102 or \
            similarity_curation.get("similarityThreshold") != 0.91 or \
            len(similarity_removed_system_ids) != 7 or \
            visual_removed_system_ids & similarity_removed_system_ids or
            len(pre_motion_removed_system_ids) != 40)
    motion_curation_invalid = (
            motion_curation.get("schema") != "csschaos-motion-curation@2" or
            motion_curation.get("auditSchema") != "csschaos-motion-interest-audit@2" or \
            motion_curation.get("auditedSystemCount") != 94 or \
            motion_curation.get("keptSystemCount") != 50 or \
            len(motion_removed_system_ids) != 45 or \
            (visual_removed_system_ids | similarity_removed_system_ids) & \
            motion_removed_system_ids or \
            motion_audit.get("schema") != motion_curation.get("auditSchema") or \
            motion_audit.get("auditedSystemCount") != 94 or \
            motion_audit.get("consideredSystemCount") != 95 or \
            motion_audit.get("keptSystemCount") != 50 or \
            frozenset(motion_audit.get("removedSystemIds", ())) != \
            motion_removed_system_ids)
    if base_curation_invalid or \
            (args.selection_stage == "motion" and motion_curation_invalid) or \
            len(removed_system_ids) != (85 if args.selection_stage == "motion" else 40):
        raise RuntimeError("Chaos visual-audition curation drifted")
    all_candidates = {item["name"]: item for item in ranking["ranked"]
                      if item["status"] == "ready"}
    candidates = {name: item for name, item in all_candidates.items()
                  if item["slug"] not in removed_system_ids}
    flow_source = next(
        source for source in source_lock["sources"] if source["path"] == "dysts/flows.py")
    selected_systems = (tuple(flow_source["adaptedClasses"])
                        if args.selection_stage == "motion" else tuple(candidates))
    expected_count = 50 if args.selection_stage == "motion" else 95
    selected_ids = {candidates[name]["slug"] for name in selected_systems}
    if len(selected_systems) != expected_count or set(selected_systems) != set(candidates) or (
            args.selection_stage == "motion" and
            selected_ids != set(motion_audit.get("selectedSystemIds", ()))):
        raise RuntimeError(
            f"Chaos {args.selection_stage} stage requires {expected_count} systems, "
            f"got {len(selected_systems)}")

    baseline_geometries = load_geometries(candidates, selected_systems)
    source_geometries, camera_orientations = prepare_camera_orientations(
        baseline_geometries, selected_systems)
    render_camera_audit(baseline_geometries, source_geometries, camera_orientations,
                        selected_systems)
    geometries = {
        name: prepare_dense_source_trajectory(source_geometries[name])
        for name in selected_systems
    }
    coordinates_by_name = {}
    for name in selected_systems:
        coordinates, safe_area = quantize(geometries[name])
        coordinates_by_name[name] = coordinates
        camera_orientations[name]["screenSafeArea"] = safe_area
    presentation = prepare_presentation(
        geometries, coordinates_by_name, selected_systems,
        allow_fidelity_rejections=args.selection_stage == "similarity")
    route = presentation["route"]
    fidelity_rejected_systems = presentation["fidelityRejectedSystems"]
    if args.selection_stage == "motion" and fidelity_rejected_systems:
        raise RuntimeError("Final Chaos selection contains a dot-fidelity rejection")
    if len(route) < 50:
        raise RuntimeError(
            f"Chaos {args.selection_stage} preparation retained only {len(route)} systems")
    phase_indices = presentation["phaseIndices"]
    phase_distribution = presentation["phaseDistribution"]
    phase_offsets = {name: 0 for name in route}
    reveal_orders = {name: prepare_reveal_order(phase_indices[name]) for name in route}
    output_root = args.output_root
    if output_root.exists():
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True)

    chapter_by_name = {
        name: (chapter_index, chapter_id, chapter_title, chapter_position)
        for chapter_index, (chapter_id, chapter_title, systems) in enumerate(CHAPTERS)
        for chapter_position, name in enumerate(systems)
    }

    sequence = []
    for system_index, name in enumerate(route):
        candidate = candidates[name]
        source_record = upstream_metadata[name]
        chapter = chapter_by_name.get(name)
        chapter_index, chapter_id, chapter_title, chapter_position = chapter or (
            None, None, None, None)
        coordinates = coordinates_by_name[name]
        reveal_order = reveal_orders[name]
        handoff_control_coordinates = prepare_handoff_control_coordinates(
            name, coordinates, phase_indices[name], reveal_order)
        decoded = encode_asset(system_index, coordinates, phase_indices[name], reveal_order,
                               handoff_control_coordinates)
        digest = hashlib.sha256(decoded).hexdigest()
        asset_name = f"{candidate['slug']}-{digest}.bin.br"
        encoded = brotli.compress(decoded, quality=11, mode=brotli.MODE_GENERIC)
        (output_root / asset_name).write_bytes(encoded)
        sequence.append({
            "id": candidate["slug"],
            "name": name,
            "systemIndex": system_index,
            "chapterIndex": chapter_index,
            "chapterId": chapter_id,
            "chapterTitle": chapter_title,
            "chapterPosition": chapter_position,
            "score": candidate["score"],
            "dimension": candidate["dimension"],
            "delaySystem": candidate["delaySystem"],
            "period": candidate["period"],
            "description": candidate["description"],
            "citation": candidate["citation"],
            "doi": candidate["doi"],
            "sourceBadges": {
                "embeddingDimension": source_record.get("embedding_dimension"),
                "delay": source_record.get("delay"),
                "hamiltonian": source_record.get("hamiltonian"),
                "nonautonomous": source_record.get("nonautonomous"),
                "correlationDimension": source_record.get("correlation_dimension"),
                "kaplanYorkeDimension": source_record.get("kaplan_yorke_dimension"),
                "maximumLyapunov": source_record.get("maximum_lyapunov_estimated"),
            },
            "sourceBadgeLabel": format_source_badges(source_record),
            "projection": candidate["representation"],
            "presentationOrientation": camera_orientations[name],
            "starCount": STAR_COUNT,
            "asset": asset_name,
            "sha256": digest,
            "encodedByteLength": len(encoded),
            "decodedByteLength": len(decoded),
            "materializedByteLength": (
                SAMPLE_COUNT * 3 * np.dtype("<u2").itemsize +
                STAR_COUNT * 2 * np.dtype("<u2").itemsize +
                STAR_COUNT * 3 * np.dtype("<u2").itemsize),
            "contentEncoding": "br",
            "transportEncoding": TRANSPORT_ENCODING,
            "sampleCount": SAMPLE_COUNT,
            "sourceFrameStep": SOURCE_FRAME_STEP,
            "framesPerSecond": FRAMES_PER_SECOND,
            "revealSeconds": REVEAL_SECONDS,
            "handoffSeconds": HANDOFF_SECONDS,
            "holdSeconds": DISPLAY_HOLD_SECONDS,
            "preparedHandoffControlSeedFrom": candidate["slug"],
            "handoffControlPointCount": STAR_COUNT,
            "sourcePhaseOffset": phase_offsets[name],
        })
        print(f"{system_index + 1:02d}/{len(route)} {name}: {len(encoded) / 1024:.1f} KiB")

    leaf_colors = [format_leaf_color(index) for index in range(STAR_COUNT)]
    snapshot_html = prepare_snapshot()
    snapshot_sha256 = hashlib.sha256(snapshot_html.encode()).hexdigest()
    snapshot_asset = f"snapshot-{snapshot_sha256}.html"
    metadata = {
        "schema": "csschaos-prepared-sequence@15",
        "status": "ready",
        "adapterId": "chaos",
        "title": "Chaos",
        "source": {
            "repository": "https://github.com/GilpinLab/dysts",
            "commit": SOURCE_COMMIT,
            "integrationSampleCount": SOURCE_SAMPLE_COUNT,
            "samplesPerCharacteristicPeriod": SAMPLES_PER_CHARACTERISTIC_PERIOD,
            "preparedSampleCount": SAMPLE_COUNT,
            "preparedInterpolationFactor": PREPARED_SAMPLE_FACTOR,
            "implementedContinuousSystemCount": 135,
            "qualifiedSystemCount": ranking["qualification"]["readyCount"],
            "selection": ("50 distinct systems kept after a complete 135-system visual "
                          "audition, a measured 102-system similarity audit, one prepared "
                          "dot-fidelity rejection, and a measured 94-system motion audit") if
                         args.selection_stage == "motion" else
                         ("95 distinct systems kept after a complete 135-system visual "
                          "audition and a measured 102-system similarity audit for the "
                          "prepared motion-interest audit"),
            "ranking": ("complete pinned continuous-system audition; 33 user-marked "
                        "systems, 7 measured lookalikes, 1 dot-fidelity rejection, and "
                        "44 lower-motion-quality systems removed") if
                       args.selection_stage == "motion" else
                       ("pre-motion audit bank; 33 user-marked systems and 7 measured "
                        "lookalikes removed"),
            "taxonomyAuthority": "PolyCSS editorial chapters derived from pinned upstream descriptions and citations; source badges are copied from upstream metadata",
        },
        "renderer": {
            "kind": "retained-dom-polycss-prepared-chaotic-attractor-sequence",
            "runtimePhysics": False,
            "runtimeCoordinateFormatting": True,
            "runtimeSourceCoordinateFormatting": False,
            "runtimeHandoffInterpolation": True,
            "runtimeRasterization": False,
            "runtimePointMatching": False,
            "runtimeRevealSorting": False,
            "runtimeHandoffCalculation": False,
            "preparedSourcePhaseReveal": True,
            "preparedSpatialHandoff": True,
            "preparedForwardHandoff": True,
            "preparedSinglePassScatterHandoff": True,
            "preparedThreeDimensionalGeometry": True,
            "preparedPerSystemCamera": True,
            "preparedFinalCameraProjection": True,
            "preparedDepthScale": True,
            "preparedDenseSourceInterpolation": True,
            "runtimeSourceInterpolation": False,
            "runtimeThreeDimensionalTransform": False,
            "sourceAxisIndependentScaling": False,
            "retainedCameraRootCount": 1,
            "retainedSceneRootCount": 1,
            "retainedPointWrapperCount": 0,
            "retainedPointLeafCount": STAR_COUNT,
            "retainedPointIdCount": 0,
            "retainedPointDataAttributeCount": 0,
        },
        "viewport": {"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT,
                     "depth": VIEWPORT_DEPTH, "perspective": PERSPECTIVE_DISTANCE},
        "starCount": STAR_COUNT,
        "snapshot": {
            "asset": snapshot_asset,
            "sha256": snapshot_sha256,
            "byteLength": len(snapshot_html.encode()),
        },
        "sampleCount": SAMPLE_COUNT,
        "sourceFrameStep": SOURCE_FRAME_STEP,
        "framesPerSecond": FRAMES_PER_SECOND,
        "preparedRevealSeconds": REVEAL_SECONDS,
        "preparedHandoffSeconds": HANDOFF_SECONDS,
        "preparedHoldSeconds": DISPLAY_HOLD_SECONDS,
        "identityMatchingFrames": [HANDOFF_TRANSITION_FRAME, HANDOFF_FRAME],
        "audition": {
            "candidateCount": len(route),
            "preMotionCandidateCount": len(selected_systems),
            "fidelityRejectedSystemIds": sorted(
                candidates[name]["slug"] for name in fidelity_rejected_systems),
            "reviewedCandidateCount": curation["reviewedSystemCount"],
            "removedSystemIds": sorted(removed_system_ids),
            "visualRemovedSystemIds": sorted(visual_removed_system_ids),
            "similarityRemovedSystemIds": sorted(similarity_removed_system_ids),
            "motionRemovedSystemIds": sorted(
                motion_removed_system_ids if args.selection_stage == "motion" else ()),
            "similarityThreshold": similarity_curation["similarityThreshold"],
            "similarityRepresentativeRule": similarity_curation["representativeRule"],
            "motionAuditSchema": motion_audit["schema"],
            "motionSelectionRule": motion_curation["selectionRule"],
            "reviewState": "published-motion-curated-shortlist",
            "advance": "automatic-shuffled-handoff",
            "selectionTransition": "instant",
        },
        "chapters": [{
            "id": chapter_id,
            "title": chapter_title,
            "systemIds": [candidates[name]["slug"] for name in systems if name in candidates],
        } for chapter_id, chapter_title, systems in CHAPTERS],
        "preparedPresentation": {
            "authority": "PolyCSS prepared presentation",
            "routeMethod": "descending pinned visual coolness ranking",
            "geometryMethod": "source dimensions without independent axis scaling",
            "cameraMethod": "deterministic per-system rigid orientation audition followed by a prepared fixed-camera perspective projection, uniform 48px screen-safe fit with minimal translation, and billboard depth scale; unscaled PCA to 3D only above three dimensions",
            "colorMethod": "cyclic green-to-white-to-yellow-to-red source-phase gradient with perceptual OKLab interpolation, gamut-mapped sRGB output, and matching green endpoints",
            "identityMethod": "fidelity-and-spacing-qualified phase selection followed by minimum-cost assignment to one shared 20-by-10-by-10 spatial reference",
            "distributionMethod": "prepare-time two-times source-derived trajectory densification followed by a per-attractor 2000-dot allocation that preserves full-trajectory density and support, bounds overlap, and minimizes retained-dot neighbor gaps across the visible hold; deterministic spatial and exact support-raster fallbacks remain available",
            "handoffMethod": "the same 2000 retained dots follow one continuous target-biased curved path directly into the next source trajectory",
            "matchingFrames": [HANDOFF_TRANSITION_FRAME, HANDOFF_FRAME],
            "edges": presentation["edges"],
        },
        "leafColors": leaf_colors,
        "sequence": sequence,
    }
    (output_root / "prepared.json").write_text(
        json.dumps(metadata, separators=(",", ":")) + "\n")
    (output_root / "snapshot.html").unlink(missing_ok=True)
    for stale_snapshot in output_root.glob("snapshot-*.html"):
        if stale_snapshot.name != snapshot_asset:
            stale_snapshot.unlink()
    (output_root / snapshot_asset).write_text(snapshot_html)
    write_phase_distribution_audit(route, phase_distribution)
    print("route=" + " -> ".join(route))
    print(f"sequence={len(route)} advance=automatic-shuffled-handoff")


def load_geometries(candidates: dict, selected_systems: tuple[str, ...]) -> dict[str, np.ndarray]:
    geometries = {}
    for name in selected_systems:
        with np.load(RANKING_ROOT / candidates[name]["cache"]) as cache:
            geometry = np.asarray(cache["geometry"], dtype=np.float64)
        if geometry.shape != (SOURCE_SAMPLE_COUNT, 3) or not np.isfinite(geometry).all():
            raise RuntimeError(f"{name} prepared 3D geometry drifted: {geometry.shape}")
        geometries[name] = geometry
    return geometries


def prepare_dense_source_trajectory(geometry: np.ndarray) -> np.ndarray:
    """Insert source-derived midpoints without changing the 60 Hz source cadence."""
    if geometry.shape != (SOURCE_SAMPLE_COUNT, 3) or \
            PREPARED_SAMPLE_FACTOR != 2:
        raise RuntimeError("Chaos dense source trajectory contract drifted")
    dense = np.empty((SAMPLE_COUNT, 3), dtype=np.float64)
    dense[::PREPARED_SAMPLE_FACTOR] = geometry
    dense[1::PREPARED_SAMPLE_FACTOR] = (
        geometry + np.roll(geometry, -1, axis=0)) / 2
    return dense


def prepare_camera_orientations(
        baseline_geometries: dict[str, np.ndarray],
        selected_systems: tuple[str, ...],
) -> tuple[dict[str, np.ndarray], dict[str, dict]]:
    geometries = {}
    orientations = {}
    coarse_angles = tuple(
        (yaw, pitch, roll)
        for yaw in CAMERA_COARSE_YAWS
        for pitch in CAMERA_COARSE_PITCHES
        for roll in CAMERA_COARSE_ROLLS
    )
    for index, name in enumerate(selected_systems, start=1):
        baseline = baseline_geometries[name]
        baseline_score = score_camera_geometry(baseline)
        best_score = baseline_score
        best_angles = (0, 0, 0)
        best_geometry = baseline
        for angles in coarse_angles:
            candidate = orient_and_fit_geometry(baseline, *angles)
            candidate_score = score_camera_geometry(candidate)
            if camera_candidate_is_better(candidate_score, angles, best_score, best_angles):
                best_score = candidate_score
                best_angles = angles
                best_geometry = candidate
        coarse_winner = best_angles
        refinement_angles = tuple({
            (coarse_winner[0] + yaw_offset,
             max(-75, min(75, coarse_winner[1] + pitch_offset)),
             coarse_winner[2] + roll_offset)
            for yaw_offset in CAMERA_REFINEMENT_OFFSETS
            for pitch_offset in CAMERA_REFINEMENT_OFFSETS
            for roll_offset in CAMERA_REFINEMENT_OFFSETS
        })
        for angles in sorted(refinement_angles):
            candidate = orient_and_fit_geometry(baseline, *angles)
            candidate_score = score_camera_geometry(candidate)
            if camera_candidate_is_better(candidate_score, angles, best_score, best_angles):
                best_score = candidate_score
                best_angles = angles
                best_geometry = candidate
        geometries[name] = best_geometry
        orientations[name] = {
            "method": "prepared deterministic rigid orientation audition",
            "yawDegrees": normalize_angle(best_angles[0]),
            "pitchDegrees": best_angles[1],
            "rollDegrees": normalize_angle(best_angles[2]),
            "baselineScore": round(baseline_score, 3),
            "selectedScore": round(best_score, 3),
            "candidateCount": len(coarse_angles) + len(refinement_angles),
        }
        print(f"camera {index:02d}/{len(selected_systems)} {name}: "
              f"{baseline_score:.2f} -> {best_score:.2f} "
              f"at {best_angles}")
    return geometries, orientations


def orient_and_fit_geometry(geometry: np.ndarray, yaw_degrees: int,
                            pitch_degrees: int, roll_degrees: int) -> np.ndarray:
    centered = geometry - np.median(geometry, axis=0)
    rotated = centered @ camera_rotation(yaw_degrees, pitch_degrees, roll_degrees).T
    low = np.quantile(rotated, 0.003, axis=0)
    high = np.quantile(rotated, 0.997, axis=0)
    span = high - low
    limits = np.asarray((640, 440, 420), dtype=np.float64)
    valid = span > 1e-12
    if np.sum(valid) < 2:
        raise RuntimeError("Chaos camera candidate collapsed")
    scale = float(np.min(limits[valid] / span[valid]))
    fitted = (rotated - (low + high) / 2) * scale
    fitted[:, 0] += VIEWPORT_WIDTH / 2
    fitted[:, 1] += VIEWPORT_HEIGHT / 2
    return fitted


def camera_rotation(yaw_degrees: int, pitch_degrees: int,
                    roll_degrees: int) -> np.ndarray:
    yaw = np.deg2rad(yaw_degrees)
    pitch = np.deg2rad(pitch_degrees)
    roll = np.deg2rad(roll_degrees)
    rotate_y = np.asarray((
        (np.cos(yaw), 0, np.sin(yaw)),
        (0, 1, 0),
        (-np.sin(yaw), 0, np.cos(yaw)),
    ))
    rotate_x = np.asarray((
        (1, 0, 0),
        (0, np.cos(pitch), -np.sin(pitch)),
        (0, np.sin(pitch), np.cos(pitch)),
    ))
    rotate_z = np.asarray((
        (np.cos(roll), -np.sin(roll), 0),
        (np.sin(roll), np.cos(roll), 0),
        (0, 0, 1),
    ))
    return rotate_z @ rotate_x @ rotate_y


def score_camera_geometry(geometry: np.ndarray) -> float:
    phase_indices = (np.arange(CAMERA_SAMPLE_COUNT, dtype=np.int32) * 223) % \
        SOURCE_SAMPLE_COUNT
    projected = project_geometry_positions(geometry)
    normalized = projected / np.asarray((VIEWPORT_WIDTH, VIEWPORT_HEIGHT))
    preview = normalized[phase_indices]
    clipped_fraction = float(np.mean(np.any((preview < 0.01) | (preview > 0.99), axis=1)))
    preview = np.clip(preview, 0.01, 0.99)
    grid_x = np.clip((preview[:, 0] * CAMERA_GRID_WIDTH).astype(int),
                     0, CAMERA_GRID_WIDTH - 1)
    grid_y = np.clip((preview[:, 1] * CAMERA_GRID_HEIGHT).astype(int),
                     0, CAMERA_GRID_HEIGHT - 1)
    counts = np.zeros((CAMERA_GRID_HEIGHT, CAMERA_GRID_WIDTH), dtype=np.float64)
    np.add.at(counts, (grid_y, grid_x), 1)
    occupied = counts > 0
    dilated = ndimage.binary_dilation(occupied, iterations=1)
    filled = ndimage.binary_fill_holes(dilated)
    holes = filled & ~dilated
    labelled_holes, hole_count = ndimage.label(holes)
    meaningful_holes = [int(np.sum(labelled_holes == hole_index))
                        for hole_index in range(1, hole_count + 1)
                        if np.sum(labelled_holes == hole_index) >= 5]
    probabilities = counts[counts > 0] / np.sum(counts)
    entropy = float(-np.sum(probabilities * np.log(probabilities)) /
                    np.log(len(preview)))
    occupancy = float(np.mean(dilated))
    hole_fraction = float(sum(meaningful_holes) / holes.size)
    boxes = []
    for divisor in (4, 2, 1):
        height = CAMERA_GRID_HEIGHT // divisor
        width = CAMERA_GRID_WIDTH // divisor
        sample_x = np.clip((preview[:, 0] * width).astype(int), 0, width - 1)
        sample_y = np.clip((preview[:, 1] * height).astype(int), 0, height - 1)
        boxes.append(len(set(zip(sample_x.tolist(), sample_y.tolist()))))
    fractal_dimension = float(np.polyfit(
        np.log([16, 32, 64]), np.log(np.maximum(boxes, 1)), 1)[0])
    point_span = np.quantile(preview, 0.98, axis=0) - np.quantile(preview, 0.02, axis=0)
    aspect_ratio = float(point_span[0] / max(point_span[1], 1e-12))
    future = normalized[(phase_indices + 60) % SOURCE_SAMPLE_COUNT]
    median_motion = float(np.median(np.linalg.norm(future - preview, axis=1)))
    edge_fraction = float(np.mean(np.any((preview < 0.03) | (preview > 0.97), axis=1)))
    entropy_score = smooth_target(entropy, 0.78, 0.18)
    occupancy_score = smooth_target(occupancy, 0.32, 0.20)
    fractal_score = smooth_target(fractal_dimension, 1.55, 0.42)
    balance_score = np.exp(-(np.log(max(aspect_ratio, 1e-6)) / 1.0) ** 2)
    motion_score = smooth_log_target(median_motion, 0.095, 0.9)
    hole_score = min(1.0, hole_fraction / 0.12) * 0.7 + min(
        1.0, len(meaningful_holes) / 3) * 0.3
    penalty = 34 * edge_fraction + 30 * clipped_fraction
    return float(max(0.0, min(100.0,
        22 * entropy_score + 18 * occupancy_score + 16 * fractal_score +
        12 * balance_score + 17 * motion_score + 15 * hole_score - penalty)))


def smooth_target(value: float, target: float, width: float) -> float:
    return float(np.exp(-((value - target) / width) ** 2))


def smooth_log_target(value: float, target: float, width: float) -> float:
    if value <= 1e-12:
        return 0.0
    return float(np.exp(-(np.log(value / target) / width) ** 2))


def camera_candidate_is_better(candidate_score: float, candidate_angles: tuple[int, int, int],
                               best_score: float, best_angles: tuple[int, int, int]) -> bool:
    return candidate_score > best_score + 1e-9 or (
        abs(candidate_score - best_score) <= 1e-9 and
        tuple(map(abs, candidate_angles)) < tuple(map(abs, best_angles)))


def normalize_angle(angle: int) -> int:
    return int(angle % 360)


def project_geometry_positions(geometry: np.ndarray) -> np.ndarray:
    positions = geometry + np.asarray((0, 0, VIEWPORT_DEPTH / 2))
    return project_final_camera_positions(positions)[:, :2]


def render_camera_audit(baseline_geometries: dict[str, np.ndarray],
                        selected_geometries: dict[str, np.ndarray],
                        orientations: dict[str, dict],
                        selected_systems: tuple[str, ...]) -> None:
    CAMERA_AUDIT_ROOT.mkdir(parents=True, exist_ok=True)
    page_size = 36
    systems_per_row = 6
    cell_width = 320
    cell_height = 180
    heading_height = 50
    for page_index, page_start in enumerate(range(0, len(selected_systems), page_size), start=1):
        page_systems = selected_systems[page_start:page_start + page_size]
        row_count = int(np.ceil(len(page_systems) / systems_per_row))
        image = Image.new("RGB", (systems_per_row * cell_width,
                                  heading_height + row_count * cell_height), (0, 0, 0))
        draw = ImageDraw.Draw(image)
        font = load_audit_font(13)
        small_font = load_audit_font(10)
        draw.text((14, 14),
                  f"Chaos prepared camera audit {page_index} · left current / right selected",
                  fill=(238, 238, 238), font=font)
        for item_index, name in enumerate(page_systems):
            column = item_index % systems_per_row
            row = item_index // systems_per_row
            left = column * cell_width
            top = heading_height + row * cell_height
            render_camera_thumbnail(draw, baseline_geometries[name], left, top + 28,
                                    cell_width // 2, cell_height - 30)
            render_camera_thumbnail(draw, selected_geometries[name], left + cell_width // 2,
                                    top + 28, cell_width // 2, cell_height - 30)
            orientation = orientations[name]
            label = (f"{name}  {orientation['baselineScore']:.1f}→"
                     f"{orientation['selectedScore']:.1f}  "
                     f"{orientation['yawDegrees']}/{orientation['pitchDegrees']}/"
                     f"{orientation['rollDegrees']}")
            draw.text((left + 5, top + 6), label, fill=(220, 220, 220), font=small_font)
        image.save(CAMERA_AUDIT_ROOT / f"camera-audit-{page_index:02d}.png", optimize=True)


def render_camera_thumbnail(draw: ImageDraw.ImageDraw, geometry: np.ndarray,
                            left: int, top: int, width: int, height: int) -> None:
    projected = project_geometry_positions(geometry)
    phases = np.sort((np.arange(CAMERA_SAMPLE_COUNT, dtype=np.int32) * 223) %
                     SOURCE_SAMPLE_COUNT)
    points = projected[phases]
    for phase_rank, (x, y) in enumerate(points):
        px = left + int(np.clip(x / VIEWPORT_WIDTH, 0, 1) * (width - 1))
        py = top + int(np.clip(y / VIEWPORT_HEIGHT, 0, 1) * (height - 1))
        color = format_phase_color(phase_rank)
        draw.point((px, py), fill=color)


def load_audit_font(size: int):
    for path in ("/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Monaco.ttf"):
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def prepare_presentation(geometries: dict[str, np.ndarray],
                         coordinates_by_name: dict[str, np.ndarray],
                         selected_systems: tuple[str, ...],
                         allow_fidelity_rejections: bool = False) -> dict:
    cached = None if allow_fidelity_rejections else load_morph_cache(selected_systems)
    if cached is None:
        route = list(selected_systems)
        route, phase_indices, phase_distribution, fidelity_rejected_systems = \
            prepare_spatial_identities(
                route, coordinates_by_name,
                allow_fidelity_rejections=allow_fidelity_rejections)
        if not allow_fidelity_rejections:
            save_morph_cache(selected_systems, route, phase_indices, phase_distribution)
    else:
        route, phase_indices, phase_distribution = cached
        fidelity_rejected_systems = []
    edges = measure_edges(route, geometries, phase_indices)
    return {
        "route": route,
        "phaseIndices": phase_indices,
        "phaseDistribution": phase_distribution,
        "fidelityRejectedSystems": fidelity_rejected_systems,
        "edges": edges,
    }


def write_phase_distribution_audit(route: list[str],
                                   phase_distribution: dict[str, dict]) -> None:
    baseline = [phase_distribution[name]["baselinePairOverlapPercent"] for name in route]
    selected = [phase_distribution[name]["selectedPairOverlapPercent"] for name in route]
    reductions = [phase_distribution[name]["relativeOverlapReductionPercent"] for name in route]
    spacing_p95 = [
        phase_distribution[name]["selectedSpacing"]
        ["maximumFrameP95NearestNeighborPixels"] for name in route]
    report = {
        "schema": "csschaos-phase-distribution-audit@2",
        "sourceCommit": SOURCE_COMMIT,
        "systemCount": len(route),
        "starCount": STAR_COUNT,
        "sampleCount": SAMPLE_COUNT,
        "meanBaselinePairOverlapPercent": round(float(np.mean(baseline)), 4),
        "meanSelectedPairOverlapPercent": round(float(np.mean(selected)), 4),
        "meanRelativeOverlapReductionPercent": round(float(np.mean(reductions)), 3),
        "minimumRelativeOverlapReductionPercent": round(float(np.min(reductions)), 3),
        "maximumRelativeOverlapReductionPercent": round(float(np.max(reductions)), 3),
        "maximumSelectedFrameP95NearestNeighborPixels": round(
            float(np.max(spacing_p95)), 4),
        "medianSelectedFrameP95NearestNeighborPixels": round(
            float(np.median(spacing_p95)), 4),
        "fidelityQualifiedSystemCount": sum(
            phase_distribution[name]["selectedFidelityPass"] for name in route),
        "coverageFallbackSystemCount": sum(
            phase_distribution[name]["distributionClass"] == "coverage-greedy"
            for name in route),
        "supportFallbackSystemCount": sum(
            phase_distribution[name]["distributionClass"] == "support-greedy"
            for name in route),
        "fidelityGates": {
            "minimumDensityCosine": DENSITY_COSINE_GATE,
            "minimumSupportRecall": SUPPORT_RECALL_GATE,
            "maximumP95GapPixels": P95_GAP_GATE_PIXELS,
        },
        "systems": [{"name": name, **phase_distribution[name]} for name in route],
    }
    PHASE_DISTRIBUTION_AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    PHASE_DISTRIBUTION_AUDIT_PATH.write_text(json.dumps(report, indent=2) + "\n")


def morph_cache_fingerprint(selected_systems: tuple[str, ...]) -> str:
    contract = json.dumps({
        "sourceCommit": SOURCE_COMMIT,
        "systems": selected_systems,
        "starCount": STAR_COUNT,
        "sampleCount": SAMPLE_COUNT,
        "identityFrames": [HANDOFF_TRANSITION_FRAME, HANDOFF_FRAME],
        "reference": [REFERENCE_COLUMNS, REFERENCE_ROWS, REFERENCE_DEPTHS],
        "algorithm": "source-authority-half-pixel-p95-pareto-spacing-v17",
        "phaseDistribution": {
            "baseStride": PHASE_DISTRIBUTION_BASE_STRIDE,
            "frameStep": PHASE_DISTRIBUTION_FRAME_STEP,
            "maxGap": PHASE_DISTRIBUTION_MAX_GAP,
            "densityCosineGate": DENSITY_COSINE_GATE,
            "supportRecallGate": SUPPORT_RECALL_GATE,
            "p95GapPixelsGate": P95_GAP_GATE_PIXELS,
            "coverageRadii": COVERAGE_RADIUS_PIXELS,
            "preparedSampleFactor": PREPARED_SAMPLE_FACTOR,
            "sourceFrameStep": SOURCE_FRAME_STEP,
            "spacingPatternShortlistCount": SPACING_PATTERN_SHORTLIST_COUNT,
            "spacingAuditFirstFrame": SPACING_AUDIT_FIRST_FRAME,
            "spacingP95ParetoTolerancePixels":
                SPACING_P95_PARETO_TOLERANCE_PIXELS,
        },
    }, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(contract.encode()).hexdigest()


def load_morph_cache(selected_systems: tuple[str, ...]):
    if not MORPH_CACHE_PATH.exists():
        return None
    with np.load(MORPH_CACHE_PATH) as cache:
        if str(cache["fingerprint"].item()) != morph_cache_fingerprint(selected_systems):
            return None
        cached_systems = tuple(str(name) for name in cache["systems"])
        if cached_systems != selected_systems:
            return None
        route = [str(name) for name in cache["route"]]
        phase_values = np.asarray(cache["phaseIndices"], dtype=np.uint16)
        phase_distribution = json.loads(str(cache["phaseDistributionJson"].item()))
    if sorted(route) != sorted(selected_systems) or phase_values.shape != (len(route), STAR_COUNT):
        return None
    if set(phase_distribution) != set(route):
        return None
    phase_indices = {name: phase_values[index].astype(np.int32)
                     for index, name in enumerate(route)}
    print(f"loaded {MORPH_CACHE_PATH}")
    return route, phase_indices, phase_distribution


def save_morph_cache(selected_systems: tuple[str, ...], route: list[str],
                     phase_indices: dict[str, np.ndarray],
                     phase_distribution: dict[str, dict]) -> None:
    MORPH_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        MORPH_CACHE_PATH,
        fingerprint=np.asarray(morph_cache_fingerprint(selected_systems)),
        systems=np.asarray(selected_systems),
        route=np.asarray(route),
        phaseIndices=np.stack([phase_indices[name] for name in route]).astype(np.uint16),
        phaseDistributionJson=np.asarray(json.dumps(
            phase_distribution, sort_keys=True, separators=(",", ":"))),
    )
    print(f"saved {MORPH_CACHE_PATH}")

def prepare_spatial_identities(
        route: list[str], coordinates_by_name: dict[str, np.ndarray],
        allow_fidelity_rejections: bool = False,
) -> tuple[list[str], dict[str, np.ndarray], dict[str, dict], list[str]]:
    reference = prepare_reference_positions()
    identities = {}
    distributions = {}
    qualified_route = []
    fidelity_rejected_systems = []
    for index, name in enumerate(route):
        positions = decode_final_camera_coordinates(coordinates_by_name[name])
        try:
            base_phases, distribution = prepare_distributed_phase_indices(positions)
        except RuntimeError as error:
            if not allow_fidelity_rejections or str(error) != (
                    "Chaos phase allocation could not satisfy the retained-dot fidelity gates"):
                raise
            fidelity_rejected_systems.append(name)
            print(f"reject {index + 1:02d}/{len(route)} {name}: dot fidelity")
            continue
        incoming_positions = positions[
            (base_phases + prepared_source_frame(HANDOFF_TRANSITION_FRAME)) % SAMPLE_COUNT]
        outgoing_positions = positions[
            (base_phases + prepared_source_frame(HANDOFF_FRAME)) % SAMPLE_COUNT]
        assignment_cost = cdist(reference, incoming_positions, "sqeuclidean")
        assignment_cost += cdist(reference, outgoing_positions, "sqeuclidean")
        rows, columns = linear_sum_assignment(assignment_cost)
        phases = np.empty(STAR_COUNT, dtype=np.int32)
        phases[rows] = base_phases[columns]
        identities[name] = phases
        distributions[name] = distribution
        qualified_route.append(name)
        print(f"match {index + 1:02d}/{len(route)} {name}: "
              f"{distribution['baselinePairOverlapPercent']:.2f}% -> "
              f"{distribution['selectedPairOverlapPercent']:.2f}% "
              f"p95={distribution['selectedSpacing']['maximumFrameP95NearestNeighborPixels']:.2f}px "
              f"({distribution['selectedPattern']})")
    return qualified_route, identities, distributions, fidelity_rejected_systems


def prepare_distributed_phase_indices(positions: np.ndarray) -> tuple[np.ndarray, dict]:
    if positions.shape != (SAMPLE_COUNT, 3) or not np.isfinite(positions).all():
        raise RuntimeError("Chaos phase distribution requires the complete prepared trajectory")
    frames = np.arange(
        0, prepared_source_frame(HANDOFF_FRAME) + 1,
        PHASE_DISTRIBUTION_FRAME_STEP * SOURCE_FRAME_STEP, dtype=np.int32)
    depth_scales = PERSPECTIVE_DISTANCE / (PERSPECTIVE_DISTANCE - positions[:, 2])
    widths = depth_scales * 2
    maximum_width = float(np.max(widths))
    sample_indices = np.arange(SAMPLE_COUNT, dtype=np.int32)
    edge_keys = []
    edge_weights = []
    phase_area_cost = np.zeros(SAMPLE_COUNT, dtype=np.float64)
    for frame in frames:
        frame_indices = (sample_indices + frame) % SAMPLE_COUNT
        frame_positions = positions[frame_indices, :2]
        frame_widths = widths[frame_indices]
        phase_area_cost += np.square(frame_widths)
        pairs = cKDTree(frame_positions).query_pairs(
            maximum_width * np.sqrt(2), output_type="ndarray")
        if len(pairs) == 0:
            continue
        left = pairs[:, 0]
        right = pairs[:, 1]
        overlap_width = np.minimum(
            frame_positions[left, 0] + frame_widths[left],
            frame_positions[right, 0] + frame_widths[right],
        ) - np.maximum(frame_positions[left, 0], frame_positions[right, 0])
        overlap_height = np.minimum(
            frame_positions[left, 1] + frame_widths[left],
            frame_positions[right, 1] + frame_widths[right],
        ) - np.maximum(frame_positions[left, 1], frame_positions[right, 1])
        overlapping = (overlap_width > 0) & (overlap_height > 0)
        edge_keys.append(left[overlapping] * SAMPLE_COUNT + right[overlapping])
        edge_weights.append(overlap_width[overlapping] * overlap_height[overlapping])
    if not edge_keys:
        raise RuntimeError("Chaos phase distribution found no projected billboard contacts")
    keys = np.concatenate(edge_keys)
    weights = np.concatenate(edge_weights)
    unique_keys, inverse = np.unique(keys, return_inverse=True)
    accumulated_weights = np.bincount(inverse, weights=weights)
    edge_left = unique_keys // SAMPLE_COUNT
    edge_right = unique_keys % SAMPLE_COUNT
    candidates = prepare_phase_pattern_candidates()
    audit_frames = prepare_dot_audit_frames(HANDOFF_FRAME, SOURCE_FRAME_STEP)
    # Fidelity remains anchored to the exact integrated source samples. The odd
    # prepared samples are source-derived candidates for the same curve, not a
    # new denser target that would invalidate an already faithful 2,000-dot set.
    fidelity_reference = prepare_dot_reference(
        positions[::PREPARED_SAMPLE_FACTOR])

    def score(phases: np.ndarray) -> float:
        selected = np.zeros(SAMPLE_COUNT, dtype=bool)
        selected[phases] = True
        overlap = float(np.sum(accumulated_weights[selected[edge_left] & selected[edge_right]]))
        dot_area = float(np.sum(phase_area_cost[phases]))
        return overlap / max(dot_area, 1e-12)

    baseline = prepare_source_phase_pattern(PHASE_DISTRIBUTION_BASE_STRIDE)
    baseline_score = score(baseline)
    baseline_fidelity = measure_dot_fidelity(
        positions, fidelity_reference, baseline, audit_frames)
    spacing_frames = np.arange(
        prepared_source_frame(SPACING_AUDIT_FIRST_FRAME),
        prepared_source_frame(HANDOFF_FRAME) + 1,
        PHASE_DISTRIBUTION_FRAME_STEP * SOURCE_FRAME_STEP, dtype=np.int32)
    baseline_spacing = measure_retained_spacing(
        positions, baseline, spacing_frames)
    scored_candidates = [
        (score(phases), label, phases,
         measure_temporal_neighbor_spacing_proxy(positions, phases, spacing_frames))
        for label, phases in candidates
    ]
    overlap_shortlist = sorted(
        scored_candidates, key=lambda item: (item[0], item[1]))[
            :SPACING_PATTERN_SHORTLIST_COUNT]
    spacing_shortlist = sorted(
        scored_candidates,
        key=lambda item: (*item[3], item[0], item[1]))[
            :SPACING_PATTERN_SHORTLIST_COUNT]
    shortlisted = []
    shortlisted_keys = set()
    for candidate in overlap_shortlist + spacing_shortlist:
        key = candidate[2].tobytes()
        if key not in shortlisted_keys:
            shortlisted_keys.add(key)
            shortlisted.append(candidate)

    pattern_winners = []
    if passes_dot_fidelity_gate(baseline_fidelity):
        pattern_winners.append((
            baseline_score, f"source-baseline-{PHASE_DISTRIBUTION_BASE_STRIDE}",
            baseline, baseline_fidelity, "phase-pattern", baseline_spacing))
    evaluated_pattern_count = 0
    for candidate_score, label, phases, _ in shortlisted:
        fidelity = measure_dot_fidelity(
            positions, fidelity_reference, phases, audit_frames)
        evaluated_pattern_count += 1
        if passes_dot_fidelity_gate(fidelity):
            spacing = measure_retained_spacing(positions, phases, spacing_frames)
            pattern_winners.append(
                (candidate_score, label, phases, fidelity, "phase-pattern", spacing))

    selected = select_spacing_balanced_candidate(
        pattern_winners, baseline_score, baseline_spacing)

    coverage_candidate_count = 0
    if selected is None:
        coverage_winners = []
        for radius in COVERAGE_RADIUS_PIXELS:
            for seed_offset in (0, 1):
                phases = prepare_coverage_phase_indices(
                    positions, STAR_COUNT, audit_frames, radius, seed_offset)
                coverage_candidate_count += 1
                fidelity = measure_dot_fidelity(
                    positions, fidelity_reference, phases, audit_frames)
                if passes_dot_fidelity_gate(fidelity):
                    label = f"coverage-r{radius:g}-offset{seed_offset}"
                    spacing = measure_retained_spacing(
                        positions, phases, spacing_frames)
                    coverage_winners.append(
                        (score(phases), label, phases, fidelity, "coverage-greedy",
                         spacing))
        if coverage_winners:
            selected = select_spacing_balanced_candidate(
                coverage_winners, baseline_score, baseline_spacing)
    support_candidate_count = 0
    if selected is None:
        support_winners = []
        for seed_count in SUPPORT_SEED_COUNTS:
            phases = prepare_support_phase_indices(
                positions, STAR_COUNT, audit_frames, fidelity_reference, seed_count)
            support_candidate_count += 1
            fidelity = measure_dot_fidelity(
                positions, fidelity_reference, phases, audit_frames)
            if passes_dot_fidelity_gate(fidelity):
                label = f"support-seed{seed_count}"
                spacing = measure_retained_spacing(
                    positions, phases, spacing_frames)
                support_winners.append(
                    (score(phases), label, phases, fidelity, "support-greedy",
                     spacing))
        if support_winners:
            selected = select_spacing_balanced_candidate(
                support_winners, baseline_score, baseline_spacing)
    if selected is None:
        raise RuntimeError(
            "Chaos phase allocation could not satisfy the retained-dot fidelity gates")

    selected_score, selected_label, selected_phases, selected_fidelity, \
        distribution_class, selected_spacing = selected
    gaps = np.diff(np.r_[selected_phases, selected_phases[0] + SAMPLE_COUNT])
    return selected_phases, {
        "method": "coverage-qualified bounded-gap spacing-balanced projected-billboard search",
        "distributionClass": distribution_class,
        "selectedPattern": selected_label,
        "candidatePatternCount": len(candidates),
        "spacingPatternShortlistCount": len(shortlisted),
        "evaluatedPatternCount": evaluated_pattern_count,
        "coverageFallbackCandidateCount": coverage_candidate_count,
        "supportFallbackCandidateCount": support_candidate_count,
        "auditFrameCount": len(frames),
        "auditFrameStep": PHASE_DISTRIBUTION_FRAME_STEP,
        "fidelityAuditFrameCount": len(audit_frames),
        "maximumPhaseGap": int(np.max(gaps)),
        "baselineFidelity": baseline_fidelity,
        "selectedFidelity": selected_fidelity,
        "selectedFidelityPass": passes_dot_fidelity_gate(selected_fidelity),
        "baselineSpacing": baseline_spacing,
        "selectedSpacing": selected_spacing,
        "baselinePairOverlapPercent": round(baseline_score * 100, 4),
        "selectedPairOverlapPercent": round(selected_score * 100, 4),
        "relativeOverlapReductionPercent": round(
            (baseline_score - selected_score) / max(baseline_score, 1e-12) * 100, 3),
    }


def select_spacing_balanced_candidate(
        candidates: list[tuple], baseline_overlap: float,
        baseline_spacing: dict) -> tuple | None:
    if not candidates:
        return None
    overlap_qualified = [
        item for item in candidates if item[0] <= baseline_overlap + 1e-12]
    pool = overlap_qualified or candidates
    maximum_gap = baseline_spacing["maximumNearestNeighborPixels"]
    maximum_qualified = [
        item for item in pool
        if item[5]["maximumNearestNeighborPixels"] <= maximum_gap + 1e-9]
    pool = maximum_qualified or pool
    best_p95 = min(
        item[5]["maximumFrameP95NearestNeighborPixels"] for item in pool)
    maximum_p95 = best_p95 + SPACING_P95_PARETO_TOLERANCE_PIXELS
    p95_qualified = [
        item for item in pool
        if item[5]["maximumFrameP95NearestNeighborPixels"] <= maximum_p95 + 1e-9]
    pool = p95_qualified or pool
    return min(pool, key=lambda item: (
        item[5]["maximumNearestNeighborPixels"],
        item[5]["maximumFrameP99NearestNeighborPixels"],
        item[5]["maximumFrameP95NearestNeighborPixels"],
        item[5]["maximumFrameFractionOver12Pixels"],
        item[0], item[1]))


def prepare_phase_pattern_candidates() -> tuple[tuple[str, np.ndarray], ...]:
    candidates = []
    seen = set()

    def add(label: str, values: np.ndarray) -> None:
        phases = np.sort(np.asarray(values, dtype=np.int32) % SAMPLE_COUNT)
        if len(np.unique(phases)) != STAR_COUNT:
            return
        gaps = np.diff(np.r_[phases, phases[0] + SAMPLE_COUNT])
        if int(np.max(gaps)) > PHASE_DISTRIBUTION_MAX_GAP:
            return
        key = phases.tobytes()
        if key in seen:
            return
        seen.add(key)
        candidates.append((label, phases))

    point_indices = np.arange(STAR_COUNT, dtype=np.int32)
    add("uniform-floor", np.floor(point_indices * SAMPLE_COUNT / STAR_COUNT))
    add("uniform-round", np.rint(point_indices * SAMPLE_COUNT / STAR_COUNT))
    for stride in range(1, SOURCE_SAMPLE_COUNT):
        if math.gcd(stride, SOURCE_SAMPLE_COUNT) == 1:
            add(f"source-stride-{stride}", prepare_source_phase_pattern(stride))
    for stride in range(1, SAMPLE_COUNT):
        if math.gcd(stride, SAMPLE_COUNT) == 1:
            add(f"stride-{stride}", point_indices * stride)
    return tuple(candidates)


def prepare_source_phase_pattern(stride: int) -> np.ndarray:
    """Lift a legal 2,880-sample allocation into the dense prepared pool exactly."""
    source = (np.arange(STAR_COUNT, dtype=np.int32) * stride) % SOURCE_SAMPLE_COUNT
    return source * PREPARED_SAMPLE_FACTOR


def prepare_reference_positions() -> np.ndarray:
    if REFERENCE_COLUMNS * REFERENCE_ROWS * REFERENCE_DEPTHS != STAR_COUNT:
        raise RuntimeError("Chaos spatial reference no longer matches the retained point count")
    x = np.linspace((VIEWPORT_WIDTH - 640) / 2, (VIEWPORT_WIDTH + 640) / 2,
                    REFERENCE_COLUMNS)
    y = np.linspace((VIEWPORT_HEIGHT - 440) / 2, (VIEWPORT_HEIGHT + 440) / 2,
                    REFERENCE_ROWS)
    z = np.linspace(-210, 210, REFERENCE_DEPTHS)
    grid_x, grid_y, grid_z = np.meshgrid(x, y, z, indexing="ij")
    return np.column_stack((grid_x.ravel(), grid_y.ravel(), grid_z.ravel()))


def measure_edges(route: list[str], geometries: dict[str, np.ndarray],
                  phase_indices: dict[str, np.ndarray]) -> list[dict]:
    edges = []
    for left, right in zip(route, route[1:] + route[:1]):
        left_positions = geometries[left][
            (phase_indices[left] + prepared_source_frame(HANDOFF_FRAME)) % SAMPLE_COUNT]
        right_positions = geometries[right][
            (phase_indices[right] + prepared_source_frame(HANDOFF_TRANSITION_FRAME)) %
            SAMPLE_COUNT]
        distances = np.linalg.norm(left_positions - right_positions, axis=1)
        edges.append({
            "from": left, "to": right,
            "meanDistancePixels": round(float(np.mean(distances)), 3),
            "medianDistancePixels": round(float(np.median(distances)), 3),
            "p95DistancePixels": round(float(np.percentile(distances, 95)), 3),
        })
    return edges


def quantize(geometry: np.ndarray) -> tuple[np.ndarray, dict]:
    source_positions = geometry + (0, 0, VIEWPORT_DEPTH / 2)
    prepared_source_positions = quantize_source_positions(source_positions).astype(np.float64)
    prepared_source_positions /= COORDINATE_SCALE
    camera_positions, safe_area = fit_final_camera_positions_to_safe_area(
        project_final_camera_positions(prepared_source_positions))
    coordinates = quantize_final_camera_positions(camera_positions)
    decoded = decode_final_camera_coordinates(coordinates)
    minimum_edge = min(
        float(np.min(decoded[:, 0])), VIEWPORT_WIDTH - float(np.max(decoded[:, 0])),
        float(np.min(decoded[:, 1])), VIEWPORT_HEIGHT - float(np.max(decoded[:, 1])))
    if minimum_edge < FINAL_CAMERA_SAFE_MARGIN - 0.05:
        raise RuntimeError(
            f"Chaos final-camera safe-area fit drifted: {minimum_edge:.3f}px")
    safe_area["minimumPreparedEdgePixels"] = round(minimum_edge, 3)
    return coordinates, safe_area


def fit_final_camera_positions_to_safe_area(
        camera_positions: np.ndarray) -> tuple[np.ndarray, dict]:
    fitted = np.array(camera_positions, dtype=np.float64, copy=True)
    low = np.min(fitted[:, :2], axis=0)
    high = np.max(fitted[:, :2], axis=0)
    span = high - low
    safe_low = np.full(2, FINAL_CAMERA_SAFE_MARGIN, dtype=np.float64)
    safe_high = np.asarray((
        VIEWPORT_WIDTH - FINAL_CAMERA_SAFE_MARGIN,
        VIEWPORT_HEIGHT - FINAL_CAMERA_SAFE_MARGIN,
    ), dtype=np.float64)
    safe_span = safe_high - safe_low
    if np.any(span <= 1e-12) or np.any(safe_span <= 0):
        raise RuntimeError("Chaos final-camera safe-area fit collapsed")
    scale = min(1.0, float(np.min(safe_span / span)))
    center = (low + high) / 2
    scaled_span = span * scale
    target_center = np.clip(
        center, safe_low + scaled_span / 2, safe_high - scaled_span / 2)
    fitted[:, :2] = (fitted[:, :2] - center) * scale + target_center
    translation = target_center - center
    return fitted, {
        "method": "prepared uniform screen-space fit with minimal translation",
        "marginPixels": FINAL_CAMERA_SAFE_MARGIN,
        "uniformScale": round(scale, 6),
        "translationPixels": [round(float(value), 3) for value in translation],
    }


def quantize_source_positions(positions: np.ndarray) -> np.ndarray:
    coordinates = np.empty((len(positions), 3), dtype="<u2")
    coordinates[:, 0] = np.rint(np.clip(positions[:, 0], 0, VIEWPORT_WIDTH) *
                                COORDINATE_SCALE).astype(np.uint16)
    coordinates[:, 1] = np.rint(np.clip(positions[:, 1], 0, VIEWPORT_HEIGHT) *
                                COORDINATE_SCALE).astype(np.uint16)
    coordinates[:, 2] = np.rint(np.clip(positions[:, 2], 0, VIEWPORT_DEPTH) *
                                COORDINATE_SCALE).astype(np.uint16)
    return coordinates


def quantize_final_camera_positions(camera_positions: np.ndarray) -> np.ndarray:
    coordinates = np.empty((len(camera_positions), 3), dtype="<u2")
    coordinates[:, 0] = np.rint(np.clip(
        camera_positions[:, 0] + PREPARED_POSITION_BIAS,
        0, VIEWPORT_WIDTH + PREPARED_POSITION_BIAS * 2) *
                                COORDINATE_SCALE).astype(np.uint16)
    coordinates[:, 1] = np.rint(np.clip(
        camera_positions[:, 1] + PREPARED_POSITION_BIAS,
        0, VIEWPORT_HEIGHT + PREPARED_POSITION_BIAS * 2) *
                                COORDINATE_SCALE).astype(np.uint16)
    coordinates[:, 2] = np.rint(np.clip(camera_positions[:, 2] + PREPARED_DEPTH_BIAS,
                                        0, PREPARED_DEPTH_BIAS * 2) *
                                COORDINATE_SCALE).astype(np.uint16)
    return coordinates


def prepare_reveal_order(phase_indices: np.ndarray) -> np.ndarray:
    reveal_order = np.argsort(phase_indices, kind="stable").astype("<u2")
    if len(np.unique(reveal_order)) != STAR_COUNT:
        raise RuntimeError("Chaos prepared reveal order is incomplete")
    return reveal_order


def prepare_handoff_control_coordinates(
        target_name: str, target_coordinates: np.ndarray,
        target_phase_indices: np.ndarray, target_reveal_order: np.ndarray) -> np.ndarray:
    seed_material = f"{SOURCE_COMMIT}:trajectory-wave-to-target-v6:{target_name}"
    seed = int(hashlib.sha256(seed_material.encode()).hexdigest()[:16], 16)
    random = np.random.default_rng(seed)
    target_indices = (
        target_phase_indices[target_reveal_order] +
        prepared_source_frame(HANDOFF_TRANSITION_FRAME)) % SAMPLE_COUNT
    incoming = decode_final_camera_coordinates(target_coordinates[target_indices])
    angles = random.uniform(0, 2 * np.pi, STAR_COUNT)
    directions = np.column_stack((np.cos(angles), np.sin(angles)))
    controls = incoming.copy()
    controls[:, :2] += directions * random.uniform(18, 42, size=(STAR_COUNT, 1))
    controls[:, 2] += random.uniform(-24, 24, STAR_COUNT)
    controls[:, 0] = np.clip(controls[:, 0], -100, VIEWPORT_WIDTH + 100)
    controls[:, 1] = np.clip(controls[:, 1], -80, VIEWPORT_HEIGHT + 80)
    controls[:, 2] = np.clip(controls[:, 2], -390, 390)
    return quantize_final_camera_positions(controls)


def decode_final_camera_coordinates(coordinates: np.ndarray) -> np.ndarray:
    decoded = coordinates.astype(np.float64) / COORDINATE_SCALE
    decoded[:, 0] -= PREPARED_POSITION_BIAS
    decoded[:, 1] -= PREPARED_POSITION_BIAS
    decoded[:, 2] -= PREPARED_DEPTH_BIAS
    return decoded


def project_final_camera_positions(positions: np.ndarray) -> np.ndarray:
    centered = positions - (VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2,
                            VIEWPORT_DEPTH / 2)
    angle_y = np.deg2rad(45)
    angle_x = np.deg2rad(-40)
    x_after_y = np.cos(angle_y) * centered[:, 0] + np.sin(angle_y) * centered[:, 2]
    z_after_y = -np.sin(angle_y) * centered[:, 0] + np.cos(angle_y) * centered[:, 2]
    y_after_x = np.cos(angle_x) * centered[:, 1] - np.sin(angle_x) * z_after_y
    z_after_x = np.sin(angle_x) * centered[:, 1] + np.cos(angle_x) * z_after_y
    perspective_scale = PERSPECTIVE_DISTANCE / (PERSPECTIVE_DISTANCE - z_after_x)
    return np.column_stack((
        VIEWPORT_WIDTH / 2 + x_after_y * perspective_scale,
        VIEWPORT_HEIGHT / 2 + y_after_x * perspective_scale,
        z_after_x,
    ))


def prepare_snapshot() -> str:
    leaves = ['<b style="color:transparent"></b>'] * STAR_COUNT
    return (f'<main class="polycss-camera"><div class="polycss-scene">'
            f'{"".join(leaves)}</div></main>')


def format_phase_color(phase_rank: int) -> str:
    phase_position = phase_rank / (STAR_COUNT - 1)
    right_index = next(
        index for index, (position, _) in enumerate(PHASE_COLOR_STOPS)
        if position >= phase_position)
    left_index = max(0, right_index - 1)
    left_position, left_rgb = PHASE_COLOR_STOPS[left_index]
    right_position, right_rgb = PHASE_COLOR_STOPS[right_index]
    blend = 0 if right_position == left_position else \
        (phase_position - left_position) / (right_position - left_position)
    left = srgb8_to_oklab(left_rgb)
    right = srgb8_to_oklab(right_rgb)
    oklab = tuple(start + (end - start) * blend
                  for start, end in zip(left, right, strict=True))
    rgb = oklab_to_srgb8(oklab)
    return "#" + "".join(f"{channel:02x}" for channel in rgb)


def srgb8_to_oklab(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    red, green, blue = (srgb_to_linear_channel(channel / 255) for channel in rgb)
    l_value = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue
    m_value = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue
    s_value = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue
    l_root, m_root, s_root = l_value ** (1 / 3), m_value ** (1 / 3), s_value ** (1 / 3)
    return (
        0.2104542553 * l_root + 0.7936177850 * m_root - 0.0040720468 * s_root,
        1.9779984951 * l_root - 2.4285922050 * m_root + 0.4505937099 * s_root,
        0.0259040371 * l_root + 0.7827717662 * m_root - 0.8086757660 * s_root,
    )


def srgb_to_linear_channel(channel: float) -> float:
    return channel / 12.92 if channel <= 0.04045 else \
        ((channel + 0.055) / 1.055) ** 2.4


def oklab_to_srgb8(oklab: tuple[float, float, float]) -> tuple[int, int, int]:
    lightness, axis_a, axis_b = gamut_map_oklab(oklab)
    linear = oklab_to_linear_srgb((lightness, axis_a, axis_b))
    return tuple(round(linear_to_srgb_channel(channel) * 255) for channel in linear)


def gamut_map_oklab(oklab: tuple[float, float, float]) -> tuple[float, float, float]:
    if linear_srgb_is_in_gamut(oklab_to_linear_srgb(oklab)):
        return oklab
    lightness, axis_a, axis_b = oklab
    lower = 0.0
    upper = 1.0
    for _ in range(GAMUT_SEARCH_STEPS):
        scale = (lower + upper) / 2
        candidate = (lightness, axis_a * scale, axis_b * scale)
        if linear_srgb_is_in_gamut(oklab_to_linear_srgb(candidate)):
            lower = scale
        else:
            upper = scale
    return (lightness, axis_a * lower, axis_b * lower)


def oklab_to_linear_srgb(oklab: tuple[float, float, float]) -> tuple[float, float, float]:
    lightness, axis_a, axis_b = oklab
    l_root = lightness + 0.3963377774 * axis_a + 0.2158037573 * axis_b
    m_root = lightness - 0.1055613458 * axis_a - 0.0638541728 * axis_b
    s_root = lightness - 0.0894841775 * axis_a - 1.2914855480 * axis_b
    l_value, m_value, s_value = l_root ** 3, m_root ** 3, s_root ** 3
    return (
        4.0767416621 * l_value - 3.3077115913 * m_value + 0.2309699292 * s_value,
        -1.2684380046 * l_value + 2.6097574011 * m_value - 0.3413193965 * s_value,
        -0.0041960863 * l_value - 0.7034186147 * m_value + 1.707614701 * s_value,
    )


def linear_srgb_is_in_gamut(linear: tuple[float, float, float]) -> bool:
    return all(0.0 <= channel <= 1.0 for channel in linear)


def linear_to_srgb_channel(channel: float) -> float:
    clamped = min(1.0, max(0.0, channel))
    return 12.92 * clamped if clamped <= 0.0031308 else \
        1.055 * clamped ** (1 / 2.4) - 0.055


def format_opacity(index: int) -> str:
    return f"{0.4 + ((index * 13 + index // 17) % 5) / 10:.1f}"


def format_leaf_color(index: int) -> str:
    color = format_phase_color(index)
    red, green, blue = (int(color[offset:offset + 2], 16) for offset in (1, 3, 5))
    return f"rgba({red},{green},{blue},{format_opacity(index)})"


def format_source_badges(source_record: dict) -> str:
    badges = [f"{source_record['embedding_dimension']}D"]
    if source_record.get("delay"):
        badges.append("delay")
    badges.append("Hamiltonian" if source_record.get("hamiltonian") else "non-Hamiltonian")
    badges.append("driven" if source_record.get("nonautonomous") else "autonomous")
    return " · ".join(badges)


if __name__ == "__main__":
    main()
