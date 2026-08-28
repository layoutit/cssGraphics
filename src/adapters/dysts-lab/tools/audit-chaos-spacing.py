#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Measure visible retained-dot spacing for every prepared Chaos attractor."""

from __future__ import annotations

import brotli
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.spatial import cKDTree

from chaos_prepared_transport import decode_asset


BANK_ROOT = Path("build/generated/public/csschaos")
REPORT_PATH = Path("output/dysts-ranking/dot-spacing-audit.json")
CHART_PATH = Path("output/dysts-ranking/dot-spacing-audit.png")
POINT_COUNT = 2000
SAMPLE_COUNT = 5760
SOURCE_FRAME_STEP = 2
FIRST_FULLY_VISIBLE_FRAME = 120
LAST_VISIBLE_FRAME = 300
FRAME_STEP = 6
DIAGNOSTIC_DISTANCES = (8.0, 12.0)


def main() -> None:
    metadata = json.loads((BANK_ROOT / "prepared.json").read_text())
    validate_metadata(metadata)
    frames = np.arange(
        FIRST_FULLY_VISIBLE_FRAME, LAST_VISIBLE_FRAME + 1,
        FRAME_STEP, dtype=np.int32)
    systems = []
    for index, descriptor in enumerate(metadata["sequence"], start=1):
        positions, phases, reveal_order = decode_system(descriptor)
        metrics = measure_spacing(positions, phases, reveal_order, frames)
        systems.append({
            "id": descriptor["id"],
            "name": descriptor["name"],
            "systemIndex": descriptor["systemIndex"],
            "metrics": metrics,
        })
        print(
            f"{index:02d}/{len(metadata['sequence'])} {descriptor['name']}: "
            f"p95={metrics['maximumFrameP95NearestNeighborPixels']:.3f}px "
            f"p99={metrics['maximumFrameP99NearestNeighborPixels']:.3f}px")

    ranked = sorted(
        systems,
        key=lambda item: (
            -item["metrics"]["maximumFrameP95NearestNeighborPixels"],
            -item["metrics"]["maximumFrameP99NearestNeighborPixels"],
            item["name"],
        ),
    )
    for rank, item in enumerate(ranked, start=1):
        item["spacingRank"] = rank
    report = {
        "schema": "csschaos-dot-spacing-audit@1",
        "sourcePreparedSchema": metadata["schema"],
        "sourceCommit": metadata["source"]["commit"],
        "systemCount": len(systems),
        "pointCount": POINT_COUNT,
        "measurement": {
            "authority": "exact prepared final-camera retained-dot positions",
            "displayFrameIndices": frames.tolist(),
            "sourceSampleIndices": (frames * SOURCE_FRAME_STEP).tolist(),
            "sourceFrameStep": SOURCE_FRAME_STEP,
            "nearestNeighborMethod": (
                "Euclidean screen-space distance from every visible dot to its "
                "closest other retained dot"),
            "diagnosticDistancesPixels": list(DIAGNOSTIC_DISTANCES),
            "qualification": (
                "descriptive spacing audit only; diagnostic distances are not "
                "automatic exclusion thresholds"),
        },
        "summary": {
            "maximumFrameP95NearestNeighborPixels": round(max(
                item["metrics"]["maximumFrameP95NearestNeighborPixels"]
                for item in systems), 4),
            "medianMaximumFrameP95NearestNeighborPixels": round(float(np.median([
                item["metrics"]["maximumFrameP95NearestNeighborPixels"]
                for item in systems])), 4),
            "systemsWithMaximumFrameP95Over8Pixels": [
                item["id"] for item in ranked
                if item["metrics"]["maximumFrameP95NearestNeighborPixels"] > 8
            ],
            "systemsWithMaximumFrameP95Over12Pixels": [
                item["id"] for item in ranked
                if item["metrics"]["maximumFrameP95NearestNeighborPixels"] > 12
            ],
            "widestSpacingSystemIds": [item["id"] for item in ranked[:10]],
        },
        "systems": ranked,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    render_chart(report)
    print(REPORT_PATH)
    print(CHART_PATH)


def validate_metadata(metadata: dict) -> None:
    if metadata.get("schema") != "csschaos-prepared-sequence@15" or \
            metadata.get("starCount") != POINT_COUNT or \
            metadata.get("sampleCount") != SAMPLE_COUNT or \
            metadata.get("sourceFrameStep") != SOURCE_FRAME_STEP or \
            len(metadata.get("sequence", ())) != 50:
        raise RuntimeError("Chaos spacing audit requires the final prepared bank")


def decode_system(descriptor: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    decoded = brotli.decompress((BANK_ROOT / descriptor["asset"]).read_bytes())
    if hashlib.sha256(decoded).hexdigest() != descriptor["sha256"]:
        raise RuntimeError(f"{descriptor['name']} prepared asset digest drifted")
    asset = decode_asset(decoded, descriptor)
    positions = asset["coordinates"][:, :2].astype(np.float64) / 10 - 120
    return (
        positions,
        asset["phaseIndices"].astype(np.int32),
        asset["revealOrder"].astype(np.int32),
    )


def measure_spacing(positions: np.ndarray, phases: np.ndarray,
                    reveal_order: np.ndarray, frames: np.ndarray) -> dict:
    frame_metrics = []
    for frame in frames:
        visible = positions[
            (phases[reveal_order] + frame * SOURCE_FRAME_STEP) % len(positions)]
        nearest = cKDTree(visible).query(visible, k=2)[0][:, 1]
        frame_metrics.append({
            "displayFrame": int(frame),
            "sourceSample": int(frame * SOURCE_FRAME_STEP),
            "p50NearestNeighborPixels": round(float(np.percentile(nearest, 50)), 4),
            "p95NearestNeighborPixels": round(float(np.percentile(nearest, 95)), 4),
            "p99NearestNeighborPixels": round(float(np.percentile(nearest, 99)), 4),
            "maximumNearestNeighborPixels": round(float(np.max(nearest)), 4),
            "fractionOver8Pixels": round(float(np.mean(nearest > 8)), 6),
            "fractionOver12Pixels": round(float(np.mean(nearest > 12)), 6),
        })

    def maximum(key: str) -> float:
        return round(max(item[key] for item in frame_metrics), 4)

    worst_p95 = max(frame_metrics, key=lambda item: item["p95NearestNeighborPixels"])
    worst_single = max(
        frame_metrics, key=lambda item: item["maximumNearestNeighborPixels"])
    return {
        "maximumFrameP50NearestNeighborPixels": maximum("p50NearestNeighborPixels"),
        "maximumFrameP95NearestNeighborPixels": maximum("p95NearestNeighborPixels"),
        "maximumFrameP99NearestNeighborPixels": maximum("p99NearestNeighborPixels"),
        "maximumNearestNeighborPixels": maximum("maximumNearestNeighborPixels"),
        "maximumFrameFractionOver8Pixels": maximum("fractionOver8Pixels"),
        "maximumFrameFractionOver12Pixels": maximum("fractionOver12Pixels"),
        "worstP95DisplayFrame": worst_p95["displayFrame"],
        "worstP95SourceSample": worst_p95["sourceSample"],
        "worstSingleGapDisplayFrame": worst_single["displayFrame"],
        "worstSingleGapSourceSample": worst_single["sourceSample"],
    }


def render_chart(report: dict) -> None:
    rows = report["systems"]
    width = 1600
    row_height = 27
    top = 120
    bottom = 50
    left = 300
    plot_width = 1080
    maximum_scale = max(
        32.0,
        max(item["metrics"]["maximumNearestNeighborPixels"] for item in rows))
    image = Image.new(
        "RGB", (width, top + len(rows) * row_height + bottom), "#05070b")
    draw = ImageDraw.Draw(image)
    font = load_font(14)
    small_font = load_font(12)
    draw.text((18, 16), "Chaos prepared retained-dot spacing audit",
              fill="#f3eef9", font=font)
    draw.text((18, 43),
              "bar: worst-frame p95   white tick: p99   purple tick: single widest gap",
              fill="#aaa3b4", font=small_font)
    draw.text((18, 66),
              "8px and 12px are descriptive guides, not automatic removal gates",
              fill="#777180", font=small_font)
    for distance in DIAGNOSTIC_DISTANCES:
        x = left + round(distance / maximum_scale * plot_width)
        draw.line((x, top - 14, x, image.height - bottom + 8), fill="#45404d")
        draw.text((x - 10, top - 35), f"{distance:g}px", fill="#aaa3b4",
                  font=small_font)
    for row_index, item in enumerate(rows):
        metrics = item["metrics"]
        y = top + row_index * row_height
        p95 = metrics["maximumFrameP95NearestNeighborPixels"]
        p99 = metrics["maximumFrameP99NearestNeighborPixels"]
        widest = metrics["maximumNearestNeighborPixels"]
        color = "#55d994" if p95 <= 8 else "#efbd59" if p95 <= 12 else "#ff6570"
        bar_end = left + round(p95 / maximum_scale * plot_width)
        p99_x = left + round(p99 / maximum_scale * plot_width)
        widest_x = left + round(widest / maximum_scale * plot_width)
        draw.text((18, y + 4), f"{item['spacingRank']:02d} {item['name']}",
                  fill="#d7d1df", font=small_font)
        draw.rounded_rectangle((left, y + 7, bar_end, y + 19), radius=3, fill=color)
        draw.line((p99_x, y + 4, p99_x, y + 22), fill="#ffffff", width=2)
        draw.line((widest_x, y + 4, widest_x, y + 22), fill="#b694ff", width=2)
        draw.text((max(bar_end, p99_x, widest_x) + 7, y + 3),
                  f"{p95:.1f} / {p99:.1f} / {widest:.1f}",
                  fill="#aaa3b4", font=small_font)
    image.save(CHART_PATH, optimize=True)


def load_font(size: int):
    for path in ("/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Monaco.ttf"):
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


if __name__ == "__main__":
    main()
