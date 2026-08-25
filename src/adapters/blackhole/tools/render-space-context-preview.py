#!/usr/bin/env python3
"""Place the real browser Luminet frame in a deterministic deep-space context."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib

import numpy as np
from PIL import Image

SEED = 1_979
UNIFORM_STAR_COUNT = 3_200
GALACTIC_BAND_STAR_COUNT = 1_800
EINSTEIN_RADIUS_PIXELS = 48.0
LENSING_RADIUS_PIXELS = 220.0
SHADOW_RADIUS_PIXELS = 43.0
PALETTE = np.asarray([
    (255, 255, 255),
    (248, 245, 255),
    (238, 231, 255),
    (223, 209, 255),
    (199, 171, 255),
], dtype=np.float64)


def main() -> None:
    arguments = parse_arguments()
    input_path = pathlib.Path(arguments.input).resolve()
    output_path = pathlib.Path(arguments.output).resolve()
    manifest_path = output_path.with_suffix(".json")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    luminet = np.asarray(Image.open(input_path).convert("RGB"), dtype=np.uint8)
    height, width, channels = luminet.shape
    if channels != 3 or width != 960 or height != 540:
        raise RuntimeError("Luminet space-context input dimensions drifted")
    center_x = width / 2
    center_y = height / 2
    random = np.random.default_rng(SEED)
    space = np.zeros_like(luminet)
    primary_image_count = 0
    secondary_image_count = 0
    footprint_pixel_visit_count = 0

    stars = []
    for _ in range(UNIFORM_STAR_COUNT):
        stars.append((
            float(random.uniform(0, width)),
            float(random.uniform(0, height)),
            False,
        ))
    for _ in range(GALACTIC_BAND_STAR_COUNT):
        x = float(random.uniform(-width * 0.08, width * 1.08))
        band_center = height * 0.57 - 0.16 * (x - center_x)
        y = float(band_center + random.normal(0, height * 0.11))
        if 0 <= x < width and 0 <= y < height:
            stars.append((x, y, True))

    for source_index, (source_x, source_y, in_band) in enumerate(stars):
        palette_index = int(random.choice(
            len(PALETTE), p=(0.53, 0.22, 0.13, 0.08, 0.04)))
        color = PALETTE[palette_index]
        brightness = 0.08 + 0.66 * float(random.random() ** 2.8)
        if in_band:
            brightness *= 0.72
        size_roll = float(random.random())
        size = 1 if size_roll < 0.973 else 2 if size_roll < 0.998 else 3
        images = lensed_images(source_x, source_y, center_x, center_y, brightness)
        for image_index, (x, y, image_brightness) in enumerate(images):
            if image_index == 0:
                primary_image_count += 1
            else:
                secondary_image_count += 1
            footprint_pixel_visit_count += draw_star(
                space,
                x,
                y,
                color,
                image_brightness,
                size if image_index == 0 else 1,
                source_index,
            )

    yy, xx = np.ogrid[:height, :width]
    shadow = (xx - center_x) ** 2 + (yy - center_y) ** 2 <= SHADOW_RADIUS_PIXELS ** 2
    space[shadow] = 0
    composite = np.maximum(space, luminet)
    Image.fromarray(composite, mode="RGB").save(output_path, optimize=True)
    manifest = {
        "schema": "cssblackhole-space-context-steering-preview@1",
        "classification":
            "browser-luminet-frame-with-decorative-deterministic-deep-space-context",
        "luminetInput": file_descriptor(input_path),
        "output": file_descriptor(output_path),
        "seed": SEED,
        "sourceBackgroundStarCount": len(stars),
        "uniformStarCount": UNIFORM_STAR_COUNT,
        "acceptedGalacticBandStarCount": len(stars) - UNIFORM_STAR_COUNT,
        "primaryImageCount": primary_image_count,
        "secondaryImageCount": secondary_image_count,
        "footprintPixelVisitCount": footprint_pixel_visit_count,
        "palette": ["#ffffff", "#f8f5ff", "#eee7ff", "#dfd1ff", "#c7abff"],
        "backgroundModel": "uniform-deep-field-plus-broad-low-contrast-stellar-band",
        "lensingPreview": {
            "classification": "thin-lens-compositional-preview-not-Luminet-source-parity",
            "einsteinRadiusPixels": EINSTEIN_RADIUS_PIXELS,
            "lensingRadiusPixels": LENSING_RADIUS_PIXELS,
            "secondaryImages": True,
        },
        "shadowRadiusPixels": SHADOW_RADIUS_PIXELS,
        "blendPolicy": "per-channel-maximum-no-opacity-summing",
        "runtimeProductChanged": False,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "ready",
        "output": str(output_path),
        "manifest": str(manifest_path),
        "sourceBackgroundStarCount": len(stars),
        "lensedImageCount": primary_image_count + secondary_image_count,
    }, indent=2))


def lensed_images(
        source_x: float,
        source_y: float,
        center_x: float,
        center_y: float,
        brightness: float,
) -> list[tuple[float, float, float]]:
    dx = source_x - center_x
    dy = source_y - center_y
    beta = math.hypot(dx, dy)
    if beta <= 1e-6 or beta > LENSING_RADIUS_PIXELS:
        return [(source_x, source_y, brightness)]
    root = math.sqrt(beta * beta + 4 * EINSTEIN_RADIUS_PIXELS ** 2)
    primary_radius = 0.5 * (beta + root)
    secondary_radius = 0.5 * (root - beta)
    unit_x = dx / beta
    unit_y = dy / beta
    proximity = 1 - beta / LENSING_RADIUS_PIXELS
    primary_brightness = min(0.92, brightness * (1 + 0.34 * proximity))
    images = [(
        center_x + unit_x * primary_radius,
        center_y + unit_y * primary_radius,
        primary_brightness,
    )]
    if brightness > 0.12 and secondary_radius >= SHADOW_RADIUS_PIXELS:
        images.append((
            center_x - unit_x * secondary_radius,
            center_y - unit_y * secondary_radius,
            brightness * min(0.42, 0.12 + 0.36 * proximity),
        ))
    return images


def draw_star(
        image: np.ndarray,
        x: float,
        y: float,
        color: np.ndarray,
        brightness: float,
        size: int,
        identity: int,
) -> int:
    height, width, _ = image.shape
    center_x = int(round(x))
    center_y = int(round(y))
    radius = size // 2
    start_x = center_x - radius
    start_y = center_y - radius
    value = np.rint(color * min(1.0, brightness)).astype(np.uint8)
    visits = 0
    for offset_y in range(size):
        for offset_x in range(size):
            pixel_x = start_x + offset_x
            pixel_y = start_y + offset_y
            if 0 <= pixel_x < width and 0 <= pixel_y < height:
                image[pixel_y, pixel_x] = np.maximum(image[pixel_y, pixel_x], value)
                visits += 1
    if size == 3 and identity % 2 == 0:
        halo = np.rint(color * min(1.0, brightness * 0.32)).astype(np.uint8)
        for pixel_x, pixel_y in (
                (center_x - 2, center_y), (center_x + 2, center_y),
                (center_x, center_y - 2), (center_x, center_y + 2)):
            if 0 <= pixel_x < width and 0 <= pixel_y < height:
                image[pixel_y, pixel_x] = np.maximum(image[pixel_y, pixel_x], halo)
                visits += 1
    return visits


def file_descriptor(path: pathlib.Path) -> dict:
    payload = path.read_bytes()
    with Image.open(path) as image:
        width, height = image.size
    return {
        "path": str(path),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "byteLength": len(payload),
        "width": width,
        "height": height,
    }


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


if __name__ == "__main__":
    main()
