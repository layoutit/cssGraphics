#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Estimate the retained-dot requirement for every prepared Chaos attractor."""

from __future__ import annotations

import brotli
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from chaos_dot_fidelity import (
    DENSITY_COSINE_GATE,
    DENSITY_HEIGHT,
    DENSITY_SIGMA,
    DENSITY_WIDTH,
    P95_GAP_GATE_PIXELS,
    SUPPORT_RECALL_GATE,
    measure_candidate,
    passes_gate,
    prepare_audit_frames,
    prepare_reference,
)
from chaos_prepared_transport import decode_asset


BANK_ROOT = Path("build/generated/public/csschaos")
PHASE_AUDIT_PATH = Path("output/dysts-ranking/phase-distribution-audit.json")
REPORT_PATH = Path("output/dysts-ranking/dot-requirements-audit.json")
CHART_PATH = Path("output/dysts-ranking/dot-requirements-audit.png")
PREPARED_SAMPLE_COUNT = 5760
DOT_COUNT_CEILING = 2000
CURRENT_DOT_COUNT = 2000
MINIMUM_TEST_DOT_COUNT = 256
DOT_COUNT_STEP = 64
COMMON_PATTERN_COUNT = 8
BASE_PATTERN_STRIDE = 223


def main() -> None:
    metadata = json.loads((BANK_ROOT / "prepared.json").read_text())
    phase_audit = json.loads(PHASE_AUDIT_PATH.read_text())
    validate_inputs(metadata, phase_audit)
    visible_frame_count = round((metadata["preparedHandoffSeconds"] +
                                 metadata["preparedHoldSeconds"]) *
                                metadata["framesPerSecond"])
    source_frame_step = metadata["sourceFrameStep"]
    audit_frames = prepare_audit_frames(visible_frame_count, source_frame_step)
    counts = sorted(set(range(MINIMUM_TEST_DOT_COUNT, DOT_COUNT_CEILING + 1,
                              DOT_COUNT_STEP)) | {CURRENT_DOT_COUNT, DOT_COUNT_CEILING})
    common_patterns = [label for label, _ in Counter(
        item["selectedPattern"] for item in phase_audit["systems"]
        if supported_pattern_label(item["selectedPattern"])
    ).most_common(COMMON_PATTERN_COUNT)]
    selected_pattern_by_name = {
        item["name"]: item["selectedPattern"] for item in phase_audit["systems"]
    }
    systems = []
    for index, descriptor in enumerate(metadata["sequence"], start=1):
        positions, current_phases = decode_system(descriptor)
        reference = prepare_reference(positions)
        system_pattern = selected_pattern_by_name[descriptor["name"]]
        pattern_labels = tuple(dict.fromkeys(label for label in (
            "uniform-floor", "uniform-round", f"stride-{BASE_PATTERN_STRIDE}",
            system_pattern, *common_patterns,
        ) if supported_pattern_label(label)))
        current_metrics = measure_candidate(
            positions, reference, current_phases, audit_frames)
        current_pass = passes_gate(current_metrics)
        minimum = find_minimum(
            positions, reference, current_phases, audit_frames, counts, pattern_labels)
        count_sufficient = current_pass or minimum["dotCount"] <= CURRENT_DOT_COUNT
        systems.append({
            "name": descriptor["name"],
            "id": descriptor["id"],
            "minimumRequiredDots": minimum["dotCount"],
            "minimumPattern": minimum["pattern"],
            "minimumMetrics": minimum["metrics"],
            "currentDotCount": CURRENT_DOT_COUNT,
            "currentMetrics": current_metrics,
            "currentPass": current_pass,
            "countSufficientAtCurrent": count_sufficient,
            "distributionIssueAtCurrent": not current_pass and count_sufficient,
            "requiresMoreDots": not count_sufficient,
            "additionalDotsRequired": max(0, minimum["dotCount"] - CURRENT_DOT_COUNT),
        })
        print(f"{index:02d}/{len(metadata['sequence'])} {descriptor['name']}: "
              f"minimum={minimum['dotCount']} current="
              f"{'pass' if current_pass else 'fail'}")
    requirements = [item["minimumRequiredDots"] for item in systems]
    current_failures = [item for item in systems if not item["currentPass"]]
    distribution_failures = [item for item in systems if item["distributionIssueAtCurrent"]]
    count_failures = [item for item in systems if item["requiresMoreDots"]]
    report = {
        "schema": "csschaos-dot-requirements-audit@1",
        "sourcePreparedSchema": metadata["schema"],
        "sourceCommit": metadata["source"]["commit"],
        "systemCount": len(systems),
        "preparedSampleCount": PREPARED_SAMPLE_COUNT,
        "dotCountCeiling": DOT_COUNT_CEILING,
        "currentDotCount": CURRENT_DOT_COUNT,
        "measurement": {
            "authority": "prepared final-camera trajectory positions",
            "candidateSearch": "uniform patterns, the baseline phase stride, the eight most common overlap-audit winners, each system's supported phase-pattern winner, the actual current prepared allocation, and an exhaustive bounded-gap 2000-dot fallback",
            "countResolution": DOT_COUNT_STEP,
            "firstCandidateCount": MINIMUM_TEST_DOT_COUNT,
            "frameIndices": audit_frames.tolist(),
            "densityGrid": [DENSITY_WIDTH, DENSITY_HEIGHT],
            "densityGaussianSigma": DENSITY_SIGMA,
            "gates": {
                "minimumDensityCosine": DENSITY_COSINE_GATE,
                "minimumSupportRecall": SUPPORT_RECALL_GATE,
                "maximumP95GapPixels": P95_GAP_GATE_PIXELS,
            },
            "qualification": "smallest tested retained-dot count passing every gate at every audited visible-cycle frame; values are bounded estimates at 64-dot resolution, not mathematical invariants",
        },
        "summary": {
            "currentPassingSystemCount": len(systems) - len(current_failures),
            "currentFailingSystemCount": len(current_failures),
            "distributionIssueSystemCount": len(distribution_failures),
            "requiresMoreDotsSystemCount": len(count_failures),
            "distributionIssueSystems": [item["name"] for item in distribution_failures],
            "requiresMoreDotsSystems": [item["name"] for item in count_failures],
            "minimumRequiredDots": int(min(requirements)),
            "medianRequiredDots": int(np.median(requirements)),
            "maximumRequiredDots": int(max(requirements)),
        },
        "systems": systems,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    render_chart(report)
    print(f"current={report['summary']['currentPassingSystemCount']}/{len(systems)} "
          f"distribution={len(distribution_failures)} more={len(count_failures)}")


def validate_inputs(metadata: dict, phase_audit: dict) -> None:
    if metadata.get("schema") != "csschaos-prepared-sequence@14" or \
            metadata.get("starCount") != CURRENT_DOT_COUNT or \
            metadata.get("sampleCount") != PREPARED_SAMPLE_COUNT or \
            metadata.get("sourceFrameStep") != 2 or \
            len(metadata.get("sequence", ())) != 50 or \
            phase_audit.get("schema") != "csschaos-phase-distribution-audit@2" or \
            phase_audit.get("systemCount") != 50:
        raise RuntimeError("Chaos dot-requirement audit inputs drifted")


def decode_system(descriptor: dict) -> tuple[np.ndarray, np.ndarray]:
    decoded = brotli.decompress((BANK_ROOT / descriptor["asset"]).read_bytes())
    if hashlib.sha256(decoded).hexdigest() != descriptor["sha256"]:
        raise RuntimeError(f"{descriptor['name']} prepared asset digest drifted")
    asset = decode_asset(decoded, descriptor)
    coordinates = asset["coordinates"].astype(np.float64)
    positions = coordinates[:, :2] / 10 - 120
    phases = asset["phaseIndices"].astype(np.int32)
    return positions, np.sort(phases)


def find_minimum(positions: np.ndarray, reference: dict, current_phases: np.ndarray,
                 audit_frames: np.ndarray, counts: list[int],
                 pattern_labels: tuple[str, ...]) -> dict:
    for count in counts:
        candidates = prepare_limited_candidates(count, pattern_labels)
        if count == CURRENT_DOT_COUNT:
            candidates.append(("current-prepared", current_phases))
        winner = evaluate_candidates(
            positions, reference, audit_frames, candidates)
        if winner is None and count == CURRENT_DOT_COUNT:
            winner = evaluate_candidates(
                positions, reference, audit_frames,
                prepare_exhaustive_current_candidates())
        if winner is not None:
            return {"dotCount": count, "pattern": winner[0], "metrics": winner[1]}
    raise RuntimeError("Chaos dot-requirement audit could not qualify the full trajectory")


def evaluate_candidates(positions: np.ndarray, reference: dict,
                        audit_frames: np.ndarray,
                        candidates: list[tuple[str, np.ndarray]]):
    winners = []
    for label, phases in candidates:
        metrics = measure_candidate(positions, reference, phases, audit_frames)
        if passes_gate(metrics):
            margin = min(
                (metrics["minimumDensityCosine"] - DENSITY_COSINE_GATE) / 0.03,
                (metrics["minimumSupportRecall"] - SUPPORT_RECALL_GATE) / 0.10,
                (P95_GAP_GATE_PIXELS - metrics["maximumP95GapPixels"]) /
                P95_GAP_GATE_PIXELS,
            )
            winners.append((margin, label, metrics))
    if not winners:
        return None
    _, label, metrics = max(winners, key=lambda item: (item[0], item[1]))
    return label, metrics


def prepare_limited_candidates(count: int, labels: tuple[str, ...]) \
        -> list[tuple[str, np.ndarray]]:
    maximum_gap = max(3, math.ceil(PREPARED_SAMPLE_COUNT / count) * 2)
    candidates = []
    seen = set()
    for label in labels:
        phases = prepare_pattern(count, label)
        gaps = np.diff(np.r_[phases, phases[0] + PREPARED_SAMPLE_COUNT])
        key = phases.tobytes()
        if len(np.unique(phases)) == count and int(np.max(gaps)) <= maximum_gap and \
                key not in seen:
            seen.add(key)
            candidates.append((label, phases))
    return candidates


def prepare_exhaustive_current_candidates() -> list[tuple[str, np.ndarray]]:
    labels = ["uniform-floor", "uniform-round"]
    labels.extend(f"stride-{stride}" for stride in range(1, PREPARED_SAMPLE_COUNT)
                  if math.gcd(stride, PREPARED_SAMPLE_COUNT) == 1)
    return prepare_limited_candidates(CURRENT_DOT_COUNT, tuple(labels))


def prepare_pattern(count: int, label: str) -> np.ndarray:
    ranks = np.arange(count, dtype=np.int32)
    if label == "uniform-floor":
        values = np.floor(ranks * PREPARED_SAMPLE_COUNT / count)
    elif label == "uniform-round":
        values = np.rint(ranks * PREPARED_SAMPLE_COUNT / count)
    elif label.startswith("stride-"):
        values = ranks * int(label.removeprefix("stride-"))
    else:
        raise RuntimeError(f"Unknown Chaos phase pattern {label}")
    return np.sort(np.asarray(values, dtype=np.int32) % PREPARED_SAMPLE_COUNT)


def supported_pattern_label(label: str) -> bool:
    return label in {"uniform-floor", "uniform-round"} or label.startswith("stride-")


def render_chart(report: dict) -> None:
    rows = sorted(report["systems"],
                  key=lambda item: (-item["minimumRequiredDots"], item["name"]))
    width = 1500
    row_height = 27
    top = 105
    bottom = 45
    left = 330
    plot_width = 980
    image = Image.new("RGB", (width, top + len(rows) * row_height + bottom), "#06080d")
    draw = ImageDraw.Draw(image)
    font = load_font(14)
    small_font = load_font(12)
    draw.text((18, 16), "Chaos retained-dot requirement audit", fill="#f3eef9", font=font)
    draw.text((18, 43),
              "green: current passes   amber: count is sufficient, distribution fails   red: more than 2000 required",
              fill="#aaa3b4", font=small_font)
    draw.text((18, 66), "Gate: density >= .97  |  support >= .90  |  p95 gap <= 6px",
              fill="#777180", font=small_font)
    current_x = left + round(CURRENT_DOT_COUNT / DOT_COUNT_CEILING * plot_width)
    draw.line((current_x, top - 14, current_x, image.height - bottom + 8),
              fill="#ffffff", width=1)
    draw.text((current_x - 18, top - 34), "2000", fill="#ffffff", font=small_font)
    for row_index, item in enumerate(rows):
        y = top + row_index * row_height
        if item["requiresMoreDots"]:
            color = "#ff5d68"
        elif item["distributionIssueAtCurrent"]:
            color = "#f2bf57"
        else:
            color = "#52dc91"
        bar_width = round(item["minimumRequiredDots"] / DOT_COUNT_CEILING * plot_width)
        draw.text((18, y + 4), item["name"], fill="#d7d1df", font=small_font)
        draw.rounded_rectangle((left, y + 6, left + bar_width, y + 19),
                               radius=3, fill=color)
        draw.text((left + bar_width + 8, y + 3), str(item["minimumRequiredDots"]),
                  fill=color, font=small_font)
    CHART_PATH.parent.mkdir(parents=True, exist_ok=True)
    image.save(CHART_PATH, optimize=True)


def load_font(size: int):
    for path in ("/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Monaco.ttf"):
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


if __name__ == "__main__":
    main()
