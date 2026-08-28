#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Audit visual similarity across the prepared Chaos attractor shortlist."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import brotli
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from scipy.spatial.distance import pdist

from chaos_prepared_transport import decode_asset


ASSET_ROOT = Path("build/generated/public/csschaos")
OUTPUT_ROOT = Path("output/dysts-similarity-audit")
METADATA_PATH = ASSET_ROOT / "prepared.json"
COORDINATE_SCALE = 10
VIEWPORT_WIDTH = 800
VIEWPORT_HEIGHT = 600
VIEWPORT_DEPTH = 600
PREPARED_POSITION_BIAS = 120
PREPARED_DEPTH_BIAS = 500
POINT_COUNT = 2000
DENSITY_SIZE = 48
ROTATION_ANGLES = tuple(range(0, 360, 15))
PAGE_SIZE = 36
SYSTEMS_PER_ROW = 6
CELL_WIDTH = 320
CELL_HEIGHT = 184
HEADING_HEIGHT = 52
PHASE_COLOR_STOPS = (
    (0x42, 0xFF, 0x8A),
    (0xFF, 0xFF, 0xFF),
    (0xFF, 0xE4, 0x5E),
    (0xFF, 0x4D, 0x4D),
)
LAVENDER_ACCENT = (0xC7, 0xAB, 0xFF)
LAVENDER_ACCENT_STRIDE = 13


def main() -> None:
    metadata = json.loads(METADATA_PATH.read_text())
    sequence = metadata.get("sequence", ())
    if metadata.get("schema") != "csschaos-prepared-sequence@15" or \
            metadata.get("starCount") != POINT_COUNT or len(sequence) < 2 or \
            len(sequence) != metadata.get("audition", {}).get("candidateCount"):
        raise RuntimeError("Chaos similarity audit requires the complete prepared shortlist")
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    systems = []
    for index, descriptor in enumerate(metadata["sequence"], start=1):
        geometry = decode_geometry(descriptor)
        projected = geometry[:, :2]
        density = prepare_density(projected)
        systems.append({
            "name": descriptor["name"],
            "id": descriptor["id"],
            "geometry": geometry,
            "projected": projected,
            "density": density,
            "densityVariants": prepare_density_variants(density),
            "geometryFeature": prepare_geometry_feature(geometry),
        })
        print(f"feature {index:03d}/{len(metadata['sequence'])} {descriptor['name']}")

    similarity = np.eye(len(systems), dtype=np.float64)
    visual_similarity = np.eye(len(systems), dtype=np.float64)
    geometry_similarity = np.eye(len(systems), dtype=np.float64)
    pairs = []
    for left_index, left in enumerate(systems):
        for right_index in range(left_index + 1, len(systems)):
            right = systems[right_index]
            visual = float(np.max(right["densityVariants"] @ left["density"].ravel()))
            geometry = float(np.dot(left["geometryFeature"], right["geometryFeature"]))
            combined = 0.75 * visual + 0.25 * geometry
            similarity[left_index, right_index] = similarity[right_index, left_index] = combined
            visual_similarity[left_index, right_index] = visual_similarity[
                right_index, left_index] = visual
            geometry_similarity[left_index, right_index] = geometry_similarity[
                right_index, left_index] = geometry
            pairs.append({
                "leftIndex": left_index,
                "rightIndex": right_index,
                "left": left["name"],
                "right": right["name"],
                "similarity": round(combined, 5),
                "visualSimilarity": round(visual, 5),
                "geometrySimilarity": round(geometry, 5),
            })
    pairs.sort(key=lambda pair: (-pair["similarity"], pair["left"], pair["right"]))

    nearest = []
    for index, system in enumerate(systems):
        candidate_scores = similarity[index].copy()
        candidate_scores[index] = -np.inf
        neighbor_index = int(np.argmax(candidate_scores))
        nearest.append({
            "systemIndex": index,
            "system": system["name"],
            "neighborIndex": neighbor_index,
            "neighbor": systems[neighbor_index]["name"],
            "similarity": round(float(similarity[index, neighbor_index]), 5),
            "visualSimilarity": round(float(visual_similarity[index, neighbor_index]), 5),
            "geometrySimilarity": round(float(geometry_similarity[index, neighbor_index]), 5),
        })

    report = {
        "schema": "csschaos-shape-similarity-audit@1",
        "status": "diagnostic-not-removal-authority",
        "systemCount": len(systems),
        "method": {
            "combined": "75% rotation/reflection-tolerant prepared final-camera density plus 25% prepared final-camera distance signature",
            "visualGrid": [DENSITY_SIZE, DENSITY_SIZE],
            "visualRotationStepDegrees": 15,
            "visualReflectionCompared": True,
            "geometry": "normalized prepared final-camera radial and pairwise-distance histograms plus covariance spectrum",
        },
        "nearestBySystem": nearest,
        "pairs": pairs,
    }
    (OUTPUT_ROOT / "similarity-report.json").write_text(
        json.dumps(report, indent=2) + "\n")
    render_pair_pages(systems, nearest)
    render_top_pairs(systems, pairs[:36])
    print("top12=" + ", ".join(
        f"{pair['left']}~{pair['right']}:{pair['similarity']:.3f}" for pair in pairs[:12]))


def decode_geometry(descriptor: dict) -> np.ndarray:
    encoded = (ASSET_ROOT / descriptor["asset"]).read_bytes()
    decoded = brotli.decompress(encoded)
    if hashlib.sha256(decoded).hexdigest() != descriptor["sha256"]:
        raise RuntimeError(f"{descriptor['name']} prepared asset digest drifted")
    coordinates = decode_asset(decoded, descriptor)["coordinates"].astype(np.float64)
    coordinates /= COORDINATE_SCALE
    coordinates[:, :2] -= PREPARED_POSITION_BIAS
    coordinates[:, 2] -= PREPARED_DEPTH_BIAS
    return coordinates


def sample_phases(sample_count: int) -> np.ndarray:
    return np.sort((np.arange(POINT_COUNT, dtype=np.int32) * 223) % sample_count)


def prepare_density(projected: np.ndarray) -> np.ndarray:
    points = projected[sample_phases(len(projected))]
    centered = points - np.median(points, axis=0)
    extent = float(np.max(np.quantile(np.abs(centered), 0.995, axis=0)))
    if extent <= 1e-12:
        raise RuntimeError("Chaos similarity density collapsed")
    normalized = centered / (extent * 2.25) + 0.5
    grid_x = np.clip((normalized[:, 0] * DENSITY_SIZE).astype(int), 0, DENSITY_SIZE - 1)
    grid_y = np.clip((normalized[:, 1] * DENSITY_SIZE).astype(int), 0, DENSITY_SIZE - 1)
    density = np.zeros((DENSITY_SIZE, DENSITY_SIZE), dtype=np.float64)
    np.add.at(density, (grid_y, grid_x), 1)
    density = ndimage.gaussian_filter(np.sqrt(density), sigma=0.8)
    norm = np.linalg.norm(density)
    if norm <= 1e-12:
        raise RuntimeError("Chaos similarity density has no support")
    return density / norm


def prepare_density_variants(density: np.ndarray) -> np.ndarray:
    variants = []
    for reflected in (density, np.fliplr(density)):
        for angle in ROTATION_ANGLES:
            rotated = ndimage.rotate(reflected, angle, reshape=False, order=1,
                                     mode="constant", cval=0, prefilter=False)
            norm = np.linalg.norm(rotated)
            if norm > 1e-12:
                variants.append((rotated / norm).ravel())
    return np.stack(variants)


def prepare_geometry_feature(geometry: np.ndarray) -> np.ndarray:
    points = geometry[sample_phases(len(geometry))]
    centered = points - np.median(points, axis=0)
    radius_scale = float(np.sqrt(np.mean(np.sum(np.square(centered), axis=1))))
    if radius_scale <= 1e-12:
        raise RuntimeError("Chaos similarity geometry collapsed")
    normalized = centered / radius_scale
    radii = np.linalg.norm(normalized, axis=1)
    radial_histogram, _ = np.histogram(radii, bins=32, range=(0, 3), density=False)
    pair_sample = normalized[np.linspace(0, len(normalized) - 1, 256, dtype=np.int32)]
    pairwise_histogram, _ = np.histogram(
        pdist(pair_sample), bins=48, range=(0, 4), density=False)
    covariance_values = np.sort(np.linalg.eigvalsh(np.cov(normalized.T)))[::-1]
    covariance_values /= max(float(np.sum(covariance_values)), 1e-12)
    feature = np.concatenate((
        normalize_histogram(radial_histogram) * 0.30,
        normalize_histogram(pairwise_histogram) * 0.60,
        covariance_values * 0.10,
    ))
    norm = np.linalg.norm(feature)
    return feature / max(norm, 1e-12)


def normalize_histogram(values: np.ndarray) -> np.ndarray:
    values = values.astype(np.float64)
    return values / max(float(np.sum(values)), 1e-12)


def render_pair_pages(systems: list[dict], nearest: list[dict]) -> None:
    for page_index, page_start in enumerate(range(0, len(nearest), PAGE_SIZE), start=1):
        page = nearest[page_start:page_start + PAGE_SIZE]
        render_pair_sheet(
            systems,
            page,
            OUTPUT_ROOT / f"nearest-neighbors-{page_index:02d}.png",
            f"Chaos shape similarity audit {page_index} · each selected shape beside its nearest neighbor",
            left_key="systemIndex",
            right_key="neighborIndex",
        )


def render_top_pairs(systems: list[dict], pairs: list[dict]) -> None:
    render_pair_sheet(
        systems,
        pairs,
        OUTPUT_ROOT / "top-similar-pairs.png",
        "Chaos shape similarity audit · 36 closest distinct pairs",
        left_key="leftIndex",
        right_key="rightIndex",
    )


def render_pair_sheet(systems: list[dict], pairs: list[dict], path: Path,
                      heading: str, left_key: str, right_key: str) -> None:
    row_count = int(np.ceil(len(pairs) / SYSTEMS_PER_ROW))
    image = Image.new("RGB", (SYSTEMS_PER_ROW * CELL_WIDTH,
                              HEADING_HEIGHT + row_count * CELL_HEIGHT), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    heading_font = load_font(15)
    label_font = load_font(9)
    draw.text((14, 15), heading, fill=(235, 235, 235), font=heading_font)
    for pair_index, pair in enumerate(pairs):
        column = pair_index % SYSTEMS_PER_ROW
        row = pair_index // SYSTEMS_PER_ROW
        left = column * CELL_WIDTH
        top = HEADING_HEIGHT + row * CELL_HEIGHT
        left_system = systems[pair[left_key]]
        right_system = systems[pair[right_key]]
        render_thumbnail(draw, left_system["projected"], left, top + 28,
                         CELL_WIDTH // 2, CELL_HEIGHT - 30)
        render_thumbnail(draw, right_system["projected"], left + CELL_WIDTH // 2,
                         top + 28, CELL_WIDTH // 2, CELL_HEIGHT - 30)
        label = f"{left_system['name']} ~ {right_system['name']}  {pair['similarity']:.3f}"
        draw.text((left + 5, top + 7), label, fill=(220, 220, 220), font=label_font)
    image.save(path, optimize=True)


def render_thumbnail(draw: ImageDraw.ImageDraw, projected: np.ndarray,
                     left: int, top: int, width: int, height: int) -> None:
    points = projected[sample_phases(len(projected))]
    for phase_rank, (x, y) in enumerate(points):
        px = left + int(np.clip(x / VIEWPORT_WIDTH, 0, 1) * (width - 1))
        py = top + int(np.clip(y / VIEWPORT_HEIGHT, 0, 1) * (height - 1))
        draw.point((px, py), fill=format_phase_color(phase_rank))


def format_phase_color(phase_rank: int) -> str:
    if phase_rank % LAVENDER_ACCENT_STRIDE == 0:
        return "#" + "".join(f"{channel:02x}" for channel in LAVENDER_ACCENT)
    stop_position = phase_rank * (len(PHASE_COLOR_STOPS) - 1) / (POINT_COUNT - 1)
    left_index = min(int(stop_position), len(PHASE_COLOR_STOPS) - 2)
    blend = stop_position - left_index
    left = PHASE_COLOR_STOPS[left_index]
    right = PHASE_COLOR_STOPS[left_index + 1]
    rgb = tuple(round(start + (end - start) * blend)
                for start, end in zip(left, right, strict=True))
    return "#" + "".join(f"{channel:02x}" for channel in rgb)


def load_font(size: int):
    for path in ("/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Monaco.ttf"):
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


if __name__ == "__main__":
    main()
