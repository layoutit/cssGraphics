#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Prepare a visual-first heuristic ranking of the source-locked dysts collection."""

from __future__ import annotations

import json
import math
import os
import re
import time
import warnings
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

from dysts import flows
from dysts.base import DynSysDelay
from dysts.systems import get_attractor_list


SOURCE_COMMIT = "2a03f1ae7b0680b0470458783dcb4664660e131a"
SAMPLE_COUNT = 2880
SAMPLES_PER_PERIOD = 240
PREVIEW_POINT_COUNT = 2000
OUTPUT_ROOT = Path("output/dysts-ranking")
PREVIEW_ROOT = OUTPUT_ROOT / "previews"
CACHE_ROOT = OUTPUT_ROOT / "trajectory-cache"
GRID_WIDTH = 64
GRID_HEIGHT = 48
VIEWPORT_WIDTH = 800
VIEWPORT_HEIGHT = 600
VIEWPORT_DEPTH = 600
PERSPECTIVE_DISTANCE = 900
FIT_WIDTH = 640
FIT_HEIGHT = 440
FIT_DEPTH = 420
CAMERA_YAW_DEGREES = 28
CAMERA_PITCH_DEGREES = -18
PALETTE = ((255, 255, 255), (236, 229, 255), (211, 194, 255), (178, 145, 239), (125, 87, 190))


def main() -> None:
    PREVIEW_ROOT.mkdir(parents=True, exist_ok=True)
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    names = get_attractor_list("continuous")
    started_at = time.perf_counter()
    results: list[dict] = []
    maximum_workers = min(6, max(1, (os.cpu_count() or 4) - 2))
    with ProcessPoolExecutor(max_workers=maximum_workers) as executor:
        pending = {executor.submit(prepare_candidate, name): name for name in names}
        for completed_count, future in enumerate(as_completed(pending), start=1):
            name = pending[future]
            try:
                result = future.result()
            except Exception as error:  # noqa: BLE001 - qualification must retain failures
                result = {
                    "name": name,
                    "status": "failed",
                    "error": f"{type(error).__name__}: {error}",
                    "score": 0,
                }
            results.append(result)
            detail = f"{result.get('score', 0):5.1f}" if result["status"] == "ready" else result["error"]
            print(f"[{completed_count:03d}/{len(names)}] {name}: {detail}", flush=True)

    ready = sorted((item for item in results if item["status"] == "ready"),
                   key=lambda item: (-item["score"], item["name"]))
    failed = sorted((item for item in results if item["status"] != "ready"), key=lambda item: item["name"])
    diverse = select_diverse(ready, count=min(24, len(ready)))
    ranking = {
        "schema": "csschaos-candidate-ranking@1",
        "source": {
            "repository": "https://github.com/GilpinLab/dysts",
            "commit": SOURCE_COMMIT,
            "implementedContinuousSystemCount": len(names),
        },
        "qualification": {
            "sampleCount": SAMPLE_COUNT,
            "samplesPerCharacteristicPeriod": SAMPLES_PER_PERIOD,
            "previewPointCount": PREVIEW_POINT_COUNT,
            "scoreKind": "heuristic-visual-coolness-not-source-authority",
            "readyCount": len(ready),
            "failedCount": len(failed),
            "elapsedSeconds": round(time.perf_counter() - started_at, 3),
        },
        "ranked": [{key: value for key, value in item.items() if key != "feature"}
                   for item in ready],
        "diverseTop24": [item["name"] for item in diverse],
        "failed": failed,
    }
    (OUTPUT_ROOT / "ranking.json").write_text(json.dumps(ranking, indent=2) + "\n")
    render_contact_sheet(ready[:36], OUTPUT_ROOT / "top-36.png", columns=6, rows=6,
                         heading="dysts heuristic visual ranking · top 36")
    render_contact_sheet(diverse[:24], OUTPUT_ROOT / "diverse-top-24.png", columns=6, rows=4,
                         heading="dysts diversity-aware shortlist · 24 candidates")
    for page_index, start in enumerate(range(0, len(ready), 30), start=1):
        render_contact_sheet(ready[start:start + 30], OUTPUT_ROOT / f"all-{page_index:02d}.png",
                             columns=6, rows=5,
                             heading=f"all source systems · score order · page {page_index}")
    print(f"ready={len(ready)} failed={len(failed)} elapsed={ranking['qualification']['elapsedSeconds']}s")
    print("top12=" + ", ".join(item["name"] for item in diverse[:12]))


def prepare_candidate(name: str) -> dict:
    warnings.filterwarnings("ignore")
    started_at = time.perf_counter()
    system = getattr(flows, name)()
    kwargs = {
        "pts_per_period": SAMPLES_PER_PERIOD,
        "standardize": False,
        "random_seed": 0,
    }
    if not isinstance(system, DynSysDelay):
        kwargs.update({"method": "RK45", "rtol": 1e-9, "atol": 1e-11})
    trajectory = system.make_trajectory(SAMPLE_COUNT, **kwargs)
    values = normalize_trajectory(trajectory, name)
    geometry, representation = prepare_source_geometry(values)
    projected, clipped_fraction = project_prepared_camera(geometry)
    metrics, feature = calculate_metrics(projected, clipped_fraction)
    score = calculate_score(metrics)
    slug = slugify(name)
    np.savez_compressed(CACHE_ROOT / f"{slug}.npz", geometry=geometry.astype(np.float32),
                        projected=projected.astype(np.float32))
    render_preview(name, projected, score, PREVIEW_ROOT / f"{slug}.png")
    return {
        "name": name,
        "slug": slug,
        "status": "ready",
        "score": round(score, 3),
        "metrics": {key: round(float(value), 5) for key, value in metrics.items()},
        "dimension": int(values.shape[1]),
        "representation": representation,
        "delaySystem": isinstance(system, DynSysDelay),
        "period": finite_or_none(getattr(system, "period", None)),
        "description": getattr(system, "description", ""),
        "citation": getattr(system, "citation", ""),
        "doi": getattr(system, "doi", ""),
        "preview": f"previews/{slug}.png",
        "cache": f"trajectory-cache/{slug}.npz",
        "integrationSeconds": round(time.perf_counter() - started_at, 3),
        "feature": feature.tolist(),
    }


def normalize_trajectory(trajectory, name: str) -> np.ndarray:
    if trajectory is None:
        raise ValueError("upstream integration returned no trajectory")
    values = np.asarray(trajectory, dtype=np.float64)
    values = np.squeeze(values)
    if values.ndim != 2:
        raise ValueError(f"unexpected trajectory shape {values.shape}")
    if values.shape[0] != SAMPLE_COUNT and values.shape[1] == SAMPLE_COUNT:
        values = values.T
    if values.shape[0] != SAMPLE_COUNT or values.shape[1] < 2:
        raise ValueError(f"unexpected trajectory shape {values.shape}")
    if not np.isfinite(values).all():
        raise ValueError("trajectory contains non-finite values")
    if np.max(np.std(values, axis=0)) <= 1e-12:
        raise ValueError(f"{name} trajectory is stationary")
    return values


def prepare_source_geometry(values: np.ndarray) -> tuple[np.ndarray, str]:
    centered = values - np.median(values, axis=0)
    centered = centered[:, np.std(centered, axis=0) > 1e-12]
    if centered.shape[1] < 2:
        raise ValueError("fewer than two active dimensions")

    if centered.shape[1] == 2:
        camera_values = np.column_stack((centered, np.zeros(len(centered))))
        representation = "two source coordinates in a prepared planar CSS camera"
    else:
        # A full three-component PCA basis is only a rigid camera rotation for a 3D
        # source. No source coordinate is independently rescaled. Higher-dimensional
        # sources require a projection, so retain their three greatest raw variances.
        _, _, components = np.linalg.svd(centered, full_matrices=False)
        camera_values = centered @ components[:3].T
        for axis in range(3):
            dominant_index = int(np.argmax(np.abs(components[axis])))
            if components[axis, dominant_index] < 0:
                camera_values[:, axis] *= -1
        representation = ("source 3D geometry with a rigid prepared PCA camera"
                          if centered.shape[1] == 3 else
                          "unscaled PCA from source state space to prepared 3D geometry")

    camera_values = camera_values @ presentation_rotation().T
    low = np.quantile(camera_values, 0.003, axis=0)
    high = np.quantile(camera_values, 0.997, axis=0)
    span = high - low
    if span[0] <= 1e-12 or span[1] <= 1e-12:
        raise ValueError("prepared 3D geometry collapsed")
    limits = np.asarray((FIT_WIDTH, FIT_HEIGHT, FIT_DEPTH), dtype=np.float64)
    valid = span > 1e-12
    scale = float(np.min(limits[valid] / span[valid]))
    fitted = (camera_values - (low + high) / 2) * scale
    fitted[:, 0] += VIEWPORT_WIDTH / 2
    fitted[:, 1] += VIEWPORT_HEIGHT / 2
    return fitted, representation


def presentation_rotation() -> np.ndarray:
    yaw = math.radians(CAMERA_YAW_DEGREES)
    pitch = math.radians(CAMERA_PITCH_DEGREES)
    rotate_y = np.asarray((
        (math.cos(yaw), 0, math.sin(yaw)),
        (0, 1, 0),
        (-math.sin(yaw), 0, math.cos(yaw)),
    ))
    rotate_x = np.asarray((
        (1, 0, 0),
        (0, math.cos(pitch), -math.sin(pitch)),
        (0, math.sin(pitch), math.cos(pitch)),
    ))
    return rotate_x @ rotate_y


def project_prepared_camera(geometry: np.ndarray) -> tuple[np.ndarray, float]:
    perspective_scale = PERSPECTIVE_DISTANCE / (PERSPECTIVE_DISTANCE - geometry[:, 2])
    projected = np.empty((len(geometry), 2), dtype=np.float64)
    projected[:, 0] = (VIEWPORT_WIDTH / 2 +
                       (geometry[:, 0] - VIEWPORT_WIDTH / 2) * perspective_scale)
    projected[:, 1] = (VIEWPORT_HEIGHT / 2 +
                       (geometry[:, 1] - VIEWPORT_HEIGHT / 2) * perspective_scale)
    normalized = projected / np.asarray((VIEWPORT_WIDTH, VIEWPORT_HEIGHT))
    clipped = np.any((normalized < 0.01) | (normalized > 0.99), axis=1)
    return np.clip(normalized, 0.01, 0.99), float(np.mean(clipped))


def calculate_metrics(points: np.ndarray, clipped_fraction: float) -> tuple[dict, np.ndarray]:
    phase_indices = (np.arange(PREVIEW_POINT_COUNT) * 223) % len(points)
    preview = points[phase_indices]
    grid_x = np.clip((preview[:, 0] * GRID_WIDTH).astype(int), 0, GRID_WIDTH - 1)
    grid_y = np.clip((preview[:, 1] * GRID_HEIGHT).astype(int), 0, GRID_HEIGHT - 1)
    counts = np.zeros((GRID_HEIGHT, GRID_WIDTH), dtype=np.float64)
    np.add.at(counts, (grid_y, grid_x), 1)
    occupied = counts > 0
    dilated = ndimage.binary_dilation(occupied, iterations=1)
    filled = ndimage.binary_fill_holes(dilated)
    holes = filled & ~dilated
    labelled_holes, hole_count = ndimage.label(holes)
    hole_areas = [int(np.sum(labelled_holes == index)) for index in range(1, hole_count + 1)]
    meaningful_holes = [area for area in hole_areas if area >= 5]
    probabilities = counts[counts > 0] / np.sum(counts)
    entropy = float(-np.sum(probabilities * np.log(probabilities)) / math.log(len(preview)))
    occupancy = float(np.mean(dilated))
    hole_fraction = float(sum(meaningful_holes) / holes.size)
    boxes = []
    for divisor in (4, 2, 1):
        height = GRID_HEIGHT // divisor
        width = GRID_WIDTH // divisor
        sample_x = np.clip((preview[:, 0] * width).astype(int), 0, width - 1)
        sample_y = np.clip((preview[:, 1] * height).astype(int), 0, height - 1)
        boxes.append(len(set(zip(sample_x.tolist(), sample_y.tolist()))))
    fractal_dimension = float(np.polyfit(np.log([16, 32, 64]), np.log(np.maximum(boxes, 1)), 1)[0])
    point_span = np.quantile(preview, 0.98, axis=0) - np.quantile(preview, 0.02, axis=0)
    aspect_ratio = float(point_span[0] / max(point_span[1], 1e-12))
    future = points[(phase_indices + 60) % len(points)]
    motion = np.linalg.norm(future - preview, axis=1)
    median_motion = float(np.median(motion))
    motion_spread = float(np.quantile(motion, 0.9) - np.quantile(motion, 0.1))
    edge_fraction = float(np.mean(np.any((preview < 0.03) | (preview > 0.97), axis=1)))
    radial = np.linalg.norm(preview - 0.5, axis=1)
    radial_hist, _ = np.histogram(radial, bins=10, range=(0, 0.72), density=False)
    angles = np.arctan2(preview[:, 1] - 0.5, preview[:, 0] - 0.5)
    angle_hist, _ = np.histogram(angles, bins=12, range=(-math.pi, math.pi), density=False)
    tiny = ndimage.zoom(dilated.astype(np.float64), (12 / GRID_HEIGHT, 16 / GRID_WIDTH), order=0)
    feature = np.concatenate((tiny.ravel(), radial_hist, angle_hist)).astype(np.float64)
    norm = np.linalg.norm(feature)
    if norm > 0:
        feature /= norm
    metrics = {
        "entropy": entropy,
        "occupancy": occupancy,
        "holeFraction": hole_fraction,
        "meaningfulHoleCount": len(meaningful_holes),
        "fractalDimension": fractal_dimension,
        "aspectRatio": aspect_ratio,
        "medianQuarterPeriodMotion": median_motion,
        "motionSpread": motion_spread,
        "edgeFraction": edge_fraction,
        "clippedFraction": clipped_fraction,
    }
    return metrics, feature


def calculate_score(metrics: dict) -> float:
    entropy_score = smooth_target(metrics["entropy"], 0.78, 0.18)
    occupancy_score = smooth_target(metrics["occupancy"], 0.32, 0.20)
    fractal_score = smooth_target(metrics["fractalDimension"], 1.55, 0.42)
    balance_score = math.exp(-(math.log(max(metrics["aspectRatio"], 1e-6)) / 1.0) ** 2)
    motion_score = smooth_log_target(metrics["medianQuarterPeriodMotion"], 0.095, 0.9)
    hole_score = min(1.0, metrics["holeFraction"] / 0.12) * 0.7 + min(
        1.0, metrics["meaningfulHoleCount"] / 3) * 0.3
    penalty = 34 * metrics["edgeFraction"] + 30 * metrics["clippedFraction"]
    return max(0.0, min(100.0,
        22 * entropy_score + 18 * occupancy_score + 16 * fractal_score +
        12 * balance_score + 17 * motion_score + 15 * hole_score - penalty))


def smooth_target(value: float, target: float, width: float) -> float:
    return math.exp(-((value - target) / width) ** 2)


def smooth_log_target(value: float, target: float, width: float) -> float:
    if value <= 1e-12:
        return 0.0
    return math.exp(-(math.log(value / target) / width) ** 2)


def select_diverse(ranked: list[dict], count: int) -> list[dict]:
    if not ranked:
        return []
    selected = [ranked[0]]
    remaining = ranked[1:]
    minimum_score = max(35.0, ranked[min(len(ranked) - 1, 60)]["score"])
    eligible = [item for item in remaining if item["score"] >= minimum_score]
    while eligible and len(selected) < count:
        def selection_value(item: dict) -> float:
            feature = np.asarray(item["feature"])
            minimum_distance = min(1 - float(np.dot(feature, np.asarray(chosen["feature"])))
                                   for chosen in selected)
            return 0.72 * (item["score"] / 100) + 0.28 * minimum_distance
        chosen = max(eligible, key=selection_value)
        selected.append(chosen)
        eligible.remove(chosen)
    if len(selected) < count:
        fallback = [item for item in remaining if item not in selected]
        selected.extend(fallback[:count - len(selected)])
    return selected


def render_preview(name: str, points: np.ndarray, score: float, path: Path) -> None:
    width, height = 640, 480
    image = Image.new("RGB", (width, height), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    phases = (np.arange(PREVIEW_POINT_COUNT) * 223) % len(points)
    sampled = points[phases]
    future = points[(phases + 10) % len(points)]
    speeds = np.linalg.norm(future - sampled, axis=1)
    thresholds = np.quantile(speeds, [0.2, 0.4, 0.6, 0.8])
    for index, (x, y) in enumerate(sampled):
        palette_index = int(np.searchsorted(thresholds, speeds[index]))
        px = int(x * (width - 1))
        py = int(y * (height - 1))
        draw.rectangle((px, py, px + 1, py + 1), fill=PALETTE[palette_index])
    font = load_font(16)
    draw.rectangle((0, 0, width, 34), fill=(0, 0, 0))
    draw.text((12, 8), f"{name}  ·  {score:.1f}", fill=(223, 214, 236), font=font)
    image.save(path, optimize=True)


def render_contact_sheet(items: list[dict], path: Path, columns: int, rows: int,
                         heading: str) -> None:
    cell_width, cell_height, heading_height = 320, 250, 54
    image = Image.new("RGB", (columns * cell_width, heading_height + rows * cell_height), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.text((18, 16), heading, fill=(228, 220, 238), font=load_font(20))
    for index, item in enumerate(items[:columns * rows]):
        column = index % columns
        row = index // columns
        preview = Image.open(PREVIEW_ROOT / f"{item['slug']}.png").convert("RGB")
        preview = preview.resize((cell_width, 240), Image.Resampling.LANCZOS)
        image.paste(preview, (column * cell_width, heading_height + row * cell_height))
        draw.text((column * cell_width + 8, heading_height + row * cell_height + 232),
                  f"#{index + 1:02d}  {item['score']:.1f}", fill=(134, 116, 157),
                  font=load_font(11))
    image.save(path, optimize=True)


def load_font(size: int):
    for path in ("/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Monaco.ttf"):
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def finite_or_none(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


if __name__ == "__main__":
    main()
