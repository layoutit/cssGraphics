#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Audit prepared Chaos motion and render numbered-frame review evidence.

This is an editorial motion-interest audit, not a source qualification step. It
reads the exact prepared final-camera coordinates that the adapter publishes,
measures motion at the retained-dot level, and renders the same prepared point
colors and opacities into compact review sequences.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
from pathlib import Path

import brotli
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from chaos_prepared_transport import decode_asset


POINT_COUNT = 2000
VIEWPORT_WIDTH = 800
VIEWPORT_HEIGHT = 600
MOTION_OFFSET = 6
MAX_MEDIAN_TRAVEL_PX_PER_SOURCE_FRAME = 6.0
SAMPLE_STEP = 120
REVIEW_FRAME_COUNT = 16
REVIEW_FRAME_STEP = 6
REVIEW_WIDTH = 400
REVIEW_HEIGHT = 300
CONTACT_COLUMNS = 5
CONTACT_ROWS = 4
CONTACT_CELL_WIDTH = 256
CONTACT_CELL_HEIGHT = 210
CONTACT_IMAGE_HEIGHT = 192
COLOR_PATTERN = re.compile(r"color:(#[0-9a-f]{6});opacity:0")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--bank", type=Path, default=Path("build/generated/public/csschaos"),
        help="prepared Chaos bank to audit")
    parser.add_argument(
        "--out", type=Path,
        default=Path("output/dysts-ranking/motion-interest-audit"),
        help="audit evidence output directory")
    parser.add_argument(
        "--pinned-report", type=Path,
        default=Path(
            "src/adapters/dysts-lab/notes/curation/"
            "motion-interest-audit-2026-08-27.json"),
        help="complete tracked audit record")
    parser.add_argument("--keep", type=int, default=50)
    parser.add_argument("--no-frames", action="store_true")
    return parser.parse_args()


def percentile(values: np.ndarray, quantile: float) -> float:
    return round(float(np.quantile(values, quantile)), 6)


def average_percentile_ranks(values: list[float]) -> np.ndarray:
    array = np.asarray(values, dtype=np.float64)
    order = np.argsort(array, kind="stable")
    ranks = np.empty(len(array), dtype=np.float64)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and array[order[end]] == array[order[start]]:
            end += 1
        ranks[order[start:end]] = (start + end - 1) / 2
        start = end
    return ranks / max(len(array) - 1, 1)


def read_bank(bank: Path) -> tuple[dict, np.ndarray, np.ndarray, list[dict]]:
    metadata_path = bank / "prepared.json"
    snapshot_path = bank / "snapshot.html"
    metadata_bytes = metadata_path.read_bytes()
    metadata = json.loads(metadata_bytes)
    colors = COLOR_PATTERN.findall(snapshot_path.read_text())
    if metadata.get("starCount") != POINT_COUNT or len(colors) != POINT_COUNT:
        raise RuntimeError("Motion audit requires the prepared 2,000-dot bank")
    leaf_colors = np.asarray([
        tuple(int(color[channel:channel + 2], 16) for channel in (1, 3, 5))
        for color in colors
    ], dtype=np.float64)
    leaf_opacities = np.asarray(metadata["leafOpacities"], dtype=np.float64)
    decoded_systems = []
    for descriptor in metadata["sequence"]:
        asset_path = bank / descriptor["asset"]
        encoded = asset_path.read_bytes()
        decoded = brotli.decompress(encoded)
        asset = decode_asset(decoded, descriptor)
        coordinates = asset["coordinates"]
        phases = asset["phaseIndices"].astype(np.int32)
        reveal_order = asset["revealOrder"].astype(np.int32)
        motion_payload = coordinates.tobytes() + phases.astype("<u2").tobytes() + \
            reveal_order.astype("<u2").tobytes()
        decoded_systems.append({
            "descriptor": descriptor,
            "coordinates": coordinates,
            "phases": phases,
            "revealOrder": reveal_order,
            "encodedSha256": hashlib.sha256(encoded).hexdigest(),
            "decodedSha256": hashlib.sha256(decoded).hexdigest(),
            "motionPayloadSha256": hashlib.sha256(motion_payload).hexdigest(),
        })
    return metadata, leaf_colors, leaf_opacities, decoded_systems


def leaf_positions(system: dict, source_frame: int) -> np.ndarray:
    coordinates = system["coordinates"]
    # The prepared player publishes retained physical leaf `rank` from logical
    # leafRevealOrder[rank], while rankToPhysical stays stable and identical.
    indices = (system["phases"][system["revealOrder"]] + source_frame) % len(coordinates)
    # Quantized transport stores a +120 px presentation bias on every axis.
    return coordinates[indices].astype(np.float64) / 10 - 120


def local_flow_coherence(positions: np.ndarray, velocities: np.ndarray) -> float:
    x_bins = np.clip((positions[:, 0] / VIEWPORT_WIDTH * 8).astype(np.int32), 0, 7)
    y_bins = np.clip((positions[:, 1] / VIEWPORT_HEIGHT * 6).astype(np.int32), 0, 5)
    cell_ids = y_bins * 8 + x_bins
    magnitudes = np.linalg.norm(velocities, axis=1)
    weighted_sum = 0.0
    point_sum = 0
    for cell_id in range(48):
        selected = cell_ids == cell_id
        count = int(np.count_nonzero(selected))
        if count < 8:
            continue
        denominator = float(np.mean(magnitudes[selected]))
        if denominator <= 1e-9:
            continue
        coherence = float(np.linalg.norm(np.mean(velocities[selected], axis=0)) /
                          denominator)
        weighted_sum += min(coherence, 1.0) * count
        point_sum += count
    return weighted_sum / max(point_sum, 1)


def direction_entropy(velocities: np.ndarray) -> float:
    magnitudes = np.linalg.norm(velocities, axis=1)
    moving = magnitudes >= 0.25
    if not np.any(moving):
        return 0.0
    angles = (np.arctan2(velocities[moving, 1], velocities[moving, 0]) +
              2 * np.pi) % (2 * np.pi)
    histogram, _ = np.histogram(angles, bins=12, range=(0, 2 * np.pi),
                                weights=magnitudes[moving])
    probabilities = histogram / max(float(np.sum(histogram)), 1e-12)
    nonzero = probabilities > 0
    return float(-np.sum(probabilities[nonzero] * np.log(probabilities[nonzero])) /
                 np.log(len(histogram)))


def render_array(positions: np.ndarray, colors: np.ndarray,
                 opacities: np.ndarray) -> np.ndarray:
    x = np.rint(positions[:, 0] * REVIEW_WIDTH / VIEWPORT_WIDTH).astype(np.int32)
    y = np.rint(positions[:, 1] * REVIEW_HEIGHT / VIEWPORT_HEIGHT).astype(np.int32)
    inside = (x >= 0) & (x < REVIEW_WIDTH) & (y >= 0) & (y < REVIEW_HEIGHT)
    flat = y[inside] * REVIEW_WIDTH + x[inside]
    rgb = colors[inside] * opacities[inside, None]
    image = np.zeros((REVIEW_HEIGHT * REVIEW_WIDTH, 3), dtype=np.float64)
    for channel in range(3):
        np.add.at(image[:, channel], flat, rgb[:, channel])
    return np.clip(image.reshape(REVIEW_HEIGHT, REVIEW_WIDTH, 3), 0, 255).astype(np.uint8)


def normalized_frame_change(left: np.ndarray, right: np.ndarray) -> float:
    left_float = left.astype(np.float64)
    right_float = right.astype(np.float64)
    available = np.maximum(left_float, right_float).sum()
    return float(np.abs(left_float - right_float).sum() / max(available, 1e-12))


def measure_system(system: dict, colors: np.ndarray,
                   opacities: np.ndarray) -> tuple[dict, list[np.ndarray]]:
    descriptor = system["descriptor"]
    sample_count = descriptor["sampleCount"]
    sampled_frames = np.arange(0, sample_count, SAMPLE_STEP, dtype=np.int32)
    median_speeds = []
    moving_coverages = []
    local_coherences = []
    global_coherences = []
    direction_entropies = []
    turn_angles = []
    frame_changes = []
    for source_frame in sampled_frames:
        current = leaf_positions(system, int(source_frame))
        future = leaf_positions(system, int(source_frame + MOTION_OFFSET))
        later = leaf_positions(system, int(source_frame + MOTION_OFFSET * 2))
        velocity = future[:, :2] - current[:, :2]
        next_velocity = later[:, :2] - future[:, :2]
        magnitudes = np.linalg.norm(velocity, axis=1)
        median_speeds.append(float(np.median(magnitudes)))
        moving_coverages.append(float(np.mean(magnitudes >= 1)))
        local_coherences.append(local_flow_coherence(current, velocity))
        mean_magnitude = float(np.mean(magnitudes))
        global_coherences.append(
            float(np.linalg.norm(np.mean(velocity, axis=0)) / max(mean_magnitude, 1e-12)))
        direction_entropies.append(direction_entropy(velocity))
        moving = (magnitudes >= 0.25) & (np.linalg.norm(next_velocity, axis=1) >= 0.25)
        if np.any(moving):
            dot = np.sum(velocity[moving] * next_velocity[moving], axis=1)
            denominator = (np.linalg.norm(velocity[moving], axis=1) *
                           np.linalg.norm(next_velocity[moving], axis=1))
            turn_angles.append(float(np.median(np.arccos(np.clip(
                dot / np.maximum(denominator, 1e-12), -1, 1)))))
        left = render_array(current, colors, opacities)
        right = render_array(future, colors, opacities)
        frame_changes.append(normalized_frame_change(left, right))

    speed_array = np.asarray(median_speeds)
    typical_speed = float(np.median(speed_array))
    local_coherence = float(np.median(local_coherences))
    global_coherence = float(np.median(global_coherences))
    metrics = {
        "preparedMedianTravelPxPer100ms": round(typical_speed, 6),
        "quietMedianTravelPxPer100ms": percentile(speed_array, 0.1),
        "livelyMedianTravelPxPer100ms": percentile(speed_array, 0.9),
        "motionCoverageAboveOnePx": round(float(np.median(moving_coverages)), 6),
        "normalizedRenderedChangePer100ms": round(float(np.median(frame_changes)), 6),
        "localFlowCoherence": round(local_coherence, 6),
        "globalRigidTranslationCoherence": round(global_coherence, 6),
        "structuredNonRigidFlow": round(
            local_coherence * math.sqrt(max(0, 1 - global_coherence)), 6),
        "directionEntropy": round(float(np.median(direction_entropies)), 6),
        "medianTurnRadiansPer100ms": round(float(np.median(turn_angles)), 6),
        "temporalSpeedVariation": round(
            float((np.quantile(speed_array, 0.9) - np.quantile(speed_array, 0.1)) /
                  max(typical_speed, 1e-12)), 6),
    }
    review_frames = [render_array(
        leaf_positions(system, frame_index * REVIEW_FRAME_STEP), colors, opacities)
        for frame_index in range(REVIEW_FRAME_COUNT)]
    return metrics, review_frames


def readable_speed_score(speed: float) -> float:
    # A broad log-normal preference keeps visibly moving trajectories while not
    # letting a very fast trajectory win merely by crossing more pixels.
    return math.exp(-0.5 * (math.log(max(speed, 1e-9) / 18) / 0.95) ** 2)


def temporal_variation_score(variation: float) -> float:
    # Mild variation is legible; near-constant or extremely bursty motion is less
    # informative in a three-second presentation.
    return math.exp(-0.5 * (math.log((variation + 0.08) / 0.38) / 0.9) ** 2)


def score_systems(rows: list[dict], keep_count: int) -> None:
    metric_names = {
        "renderedActivity": "normalizedRenderedChangePer100ms",
        "motionCoverage": "motionCoverageAboveOnePx",
        "structuredFlow": "structuredNonRigidFlow",
        "curvature": "medianTurnRadiansPer100ms",
    }
    ranked_components = {
        name: average_percentile_ranks([
            row["metrics"][metric_name] for row in rows
        ]) for name, metric_name in metric_names.items()
    }
    for index, row in enumerate(rows):
        speed = readable_speed_score(row["metrics"]["preparedMedianTravelPxPer100ms"])
        variation = temporal_variation_score(row["metrics"]["temporalSpeedVariation"])
        components = {
            name: round(float(values[index]), 6)
            for name, values in ranked_components.items()
        }
        components["readableSpeed"] = round(speed, 6)
        components["temporalVariation"] = round(variation, 6)
        score = (
            0.30 * components["renderedActivity"] +
            0.25 * components["structuredFlow"] +
            0.20 * components["readableSpeed"] +
            0.10 * components["motionCoverage"] +
            0.10 * components["curvature"] +
            0.05 * components["temporalVariation"]
        )
        row["scoreComponents"] = components
        row["motionInterestScore"] = round(score, 6)
        row["motionQualityQualified"] = (
            row["metrics"]["preparedMedianTravelPxPer100ms"] / MOTION_OFFSET <=
            MAX_MEDIAN_TRAVEL_PX_PER_SOURCE_FRAME
        )
    qualified_count = sum(row["motionQualityQualified"] for row in rows)
    if qualified_count < keep_count:
        raise RuntimeError(
            f"Only {qualified_count} systems satisfy the source-frame motion gate; "
            f"cannot keep {keep_count}")
    rows.sort(key=lambda row: (
        not row["motionQualityQualified"], -row["motionInterestScore"], row["id"]))
    for rank, row in enumerate(rows, start=1):
        row["motionInterestRank"] = rank
        row["decision"] = (
            "keep" if rank <= keep_count and row["motionQualityQualified"] else "remove")


def render_evidence(rows: list[dict], frames_by_id: dict[str, list[np.ndarray]],
                    output_root: Path) -> None:
    frames_root = output_root / "systems"
    contacts_root = output_root / "contacts"
    frames_root.mkdir(parents=True, exist_ok=True)
    contacts_root.mkdir(parents=True, exist_ok=True)
    for row in rows:
        system_root = frames_root / f"{row['motionInterestRank']:02d}-{row['id']}"
        system_root.mkdir()
        for frame_index, frame in enumerate(frames_by_id[row["id"]]):
            Image.fromarray(frame, "RGB").save(system_root / f"frame_{frame_index:04d}.png")

    page_size = CONTACT_COLUMNS * CONTACT_ROWS
    font = ImageFont.load_default()
    for page_index in range(math.ceil(len(rows) / page_size)):
        page_rows = rows[page_index * page_size:(page_index + 1) * page_size]
        page_root = contacts_root / f"page-{page_index + 1:02d}" / "frames"
        page_root.mkdir(parents=True)
        for frame_index in range(REVIEW_FRAME_COUNT):
            canvas = Image.new(
                "RGB", (CONTACT_COLUMNS * CONTACT_CELL_WIDTH,
                        CONTACT_ROWS * CONTACT_CELL_HEIGHT), "black")
            draw = ImageDraw.Draw(canvas)
            for cell_index, row in enumerate(page_rows):
                x = cell_index % CONTACT_COLUMNS * CONTACT_CELL_WIDTH
                y = cell_index // CONTACT_COLUMNS * CONTACT_CELL_HEIGHT
                frame = Image.fromarray(frames_by_id[row["id"]][frame_index], "RGB")
                frame = frame.resize((CONTACT_CELL_WIDTH, CONTACT_IMAGE_HEIGHT),
                                     Image.Resampling.NEAREST)
                canvas.paste(frame, (x, y))
                decision_color = "#70ff9c" if row["decision"] == "keep" else "#ff7373"
                label = (f"{row['motionInterestRank']:02d} {row['name']} "
                         f"{row['motionInterestScore']:.3f}")
                draw.text((x + 4, y + CONTACT_IMAGE_HEIGHT + 4), label,
                          fill=decision_color, font=font)
            canvas.save(page_root / f"frame_{frame_index:04d}.png")


def main() -> None:
    args = parse_args()
    metadata, colors, opacities, decoded_systems = read_bank(args.bank)
    if len(decoded_systems) < args.keep:
        raise RuntimeError(
            f"Cannot keep {args.keep} systems from a {len(decoded_systems)}-system bank")
    rows = []
    frames_by_id = {}
    for index, system in enumerate(decoded_systems, start=1):
        descriptor = system["descriptor"]
        metrics, frames = measure_system(system, colors, opacities)
        rows.append({
            "id": descriptor["id"],
            "name": descriptor["name"],
            "systemIndex": descriptor["systemIndex"],
            "asset": descriptor["asset"],
            "encodedSha256": system["encodedSha256"],
            "decodedSha256": system["decodedSha256"],
            "motionPayloadSha256": system["motionPayloadSha256"],
            "metrics": metrics,
        })
        frames_by_id[descriptor["id"]] = frames
        print(f"measured {index:02d}/{len(decoded_systems)} {descriptor['name']}")
    score_systems(rows, args.keep)
    selected = [row["id"] for row in rows if row["decision"] == "keep"]
    measured_removed = [row["id"] for row in rows if row["decision"] == "remove"]
    fidelity_rejected = list(metadata.get("audition", {}).get(
        "fidelityRejectedSystemIds", ()))
    considered_count = metadata.get("audition", {}).get(
        "preMotionCandidateCount", len(rows))
    if considered_count != len(rows) + len(fidelity_rejected):
        raise RuntimeError("Chaos pre-motion qualification counts drifted")
    removed = measured_removed + fidelity_rejected
    report = {
        "schema": "csschaos-motion-interest-audit@2",
        "sourcePreparedSchema": metadata["schema"],
        "sourceCommit": metadata["source"]["commit"],
        "auditedSystemCount": len(rows),
        "consideredSystemCount": considered_count,
        "fidelityRejectedSystemIds": fidelity_rejected,
        "keptSystemCount": len(selected),
        "removedSystemCount": len(removed),
        "basis": (
            "exact prepared final-camera retained-dot positions, colors, and opacities; "
            "100 ms means six source frames at the declared 60 Hz source cadence"),
        "qualificationBoundary": (
            "editorial presentation ranking only; it does not alter or qualify the "
            "pinned dysts equations"),
        "score": {
            "renderedActivityPercentile": 0.30,
            "structuredNonRigidFlowPercentile": 0.25,
            "readableSpeedBroadTarget18PxPer100ms": 0.20,
            "motionCoveragePercentile": 0.10,
            "curvaturePercentile": 0.10,
            "temporalVariationBroadTarget": 0.05,
            "maximumMedianTravelPxPerSourceFrame":
                MAX_MEDIAN_TRAVEL_PX_PER_SOURCE_FRAME,
        },
        "sampling": {
            "measurementFrameStep": SAMPLE_STEP,
            "motionOffsetFrames": MOTION_OFFSET,
            "reviewFrameCount": REVIEW_FRAME_COUNT,
            "reviewFrameStep": REVIEW_FRAME_STEP,
            "reviewViewport": [REVIEW_WIDTH, REVIEW_HEIGHT],
        },
        "selectedSystemIds": selected,
        "measuredRemovedSystemIds": measured_removed,
        "removedSystemIds": removed,
        "systems": rows,
    }
    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True)
    report_text = json.dumps(report, indent=2) + "\n"
    (args.out / "motion-interest-audit.json").write_text(report_text)
    args.pinned_report.parent.mkdir(parents=True, exist_ok=True)
    args.pinned_report.write_text(report_text)
    if not args.no_frames:
        render_evidence(rows, frames_by_id, args.out)
    print(f"kept={len(selected)} removed={len(removed)}")
    print(args.out / "motion-interest-audit.json")
    print(args.pinned_report)


if __name__ == "__main__":
    main()
