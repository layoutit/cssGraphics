#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Shared prepare-time fidelity gates for retained Chaos trajectory dots."""

from __future__ import annotations

import heapq

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from scipy.sparse import csr_matrix


DENSITY_WIDTH = 160
DENSITY_HEIGHT = 120
DENSITY_SIGMA = 0.8
DENSITY_SUPPORT_THRESHOLD = 0.02
FRAME_STEP = 30
DENSITY_COSINE_GATE = 0.97
SUPPORT_RECALL_GATE = 0.90
P95_GAP_GATE_PIXELS = 6.0
COVERAGE_RADIUS_PIXELS = (4.5, 5.0, 5.5, 6.0)
COVERAGE_SEED_COUNT = 1440
COVERAGE_TARGET_UNCOVERED_FRACTION = 0.045
SUPPORT_SEED_COUNTS = (1750, 1800, 1850)


def prepare_audit_frames(visible_frame_count: int,
                         source_frame_step: int = 1) -> np.ndarray:
    if source_frame_step < 1:
        raise ValueError("Chaos source frame step must be positive")
    return np.arange(
        0, visible_frame_count * source_frame_step + 1,
        FRAME_STEP * source_frame_step, dtype=np.int32)


def prepare_reference(positions: np.ndarray) -> dict:
    density = render_density(positions)
    return {
        "points": positions[:, :2],
        "density": density,
        "densityNorm": float(np.linalg.norm(density)),
        "support": ndimage.binary_dilation(
            density > DENSITY_SUPPORT_THRESHOLD, iterations=1),
    }


def render_density(positions: np.ndarray) -> np.ndarray:
    points = positions[:, :2]
    x = np.clip((points[:, 0] / 800 * DENSITY_WIDTH).astype(np.int32),
                0, DENSITY_WIDTH - 1)
    y = np.clip((points[:, 1] / 600 * DENSITY_HEIGHT).astype(np.int32),
                0, DENSITY_HEIGHT - 1)
    density = np.zeros((DENSITY_HEIGHT, DENSITY_WIDTH), dtype=np.float64)
    np.add.at(density, (y, x), 1)
    return ndimage.gaussian_filter(np.sqrt(density), DENSITY_SIGMA)


def measure_candidate(positions: np.ndarray, reference: dict, phases: np.ndarray,
                      audit_frames: np.ndarray) -> dict:
    points = positions[:, :2]
    sample_count = len(points)
    cosine_values = []
    recall_values = []
    gap_values = []
    for frame in audit_frames:
        candidate = points[(phases + frame) % sample_count]
        density = render_density(candidate)
        cosine_values.append(float(np.dot(
            reference["density"].ravel(), density.ravel()) /
            max(reference["densityNorm"] * np.linalg.norm(density), 1e-12)))
        support = ndimage.binary_dilation(
            density > DENSITY_SUPPORT_THRESHOLD, iterations=1)
        recall_values.append(float(np.sum(reference["support"] & support) /
                                   np.sum(reference["support"])))
        gap_values.append(float(np.percentile(
            cKDTree(candidate).query(reference["points"], k=1)[0], 95)))
    return {
        "minimumDensityCosine": round(min(cosine_values), 6),
        "minimumSupportRecall": round(min(recall_values), 6),
        "maximumP95GapPixels": round(max(gap_values), 4),
    }


def measure_retained_spacing(positions: np.ndarray, phases: np.ndarray,
                             audit_frames: np.ndarray) -> dict:
    """Measure isolation within the selected retained-dot set."""
    points = positions[:, :2]
    sample_count = len(points)
    frame_metrics = []
    for frame in audit_frames:
        selected = points[(phases + int(frame)) % sample_count]
        nearest = cKDTree(selected).query(selected, k=2)[0][:, 1]
        frame_metrics.append({
            "p95": float(np.percentile(nearest, 95)),
            "p99": float(np.percentile(nearest, 99)),
            "maximum": float(np.max(nearest)),
            "fractionOver8": float(np.mean(nearest > 8)),
            "fractionOver12": float(np.mean(nearest > 12)),
        })
    return {
        "maximumFrameP95NearestNeighborPixels": round(max(
            item["p95"] for item in frame_metrics), 4),
        "maximumFrameP99NearestNeighborPixels": round(max(
            item["p99"] for item in frame_metrics), 4),
        "maximumNearestNeighborPixels": round(max(
            item["maximum"] for item in frame_metrics), 4),
        "maximumFrameFractionOver8Pixels": round(max(
            item["fractionOver8"] for item in frame_metrics), 6),
        "maximumFrameFractionOver12Pixels": round(max(
            item["fractionOver12"] for item in frame_metrics), 6),
    }


def measure_temporal_neighbor_spacing_proxy(
        positions: np.ndarray, phases: np.ndarray,
        audit_frames: np.ndarray) -> tuple[float, float, float]:
    """Cheaply rank candidates by their two adjacent trajectory neighbours."""
    points = positions[:, :2]
    sample_count = len(points)
    ordered = np.sort(phases)
    previous = np.roll(ordered, 1)
    following = np.roll(ordered, -1)
    p95_values = []
    p99_values = []
    maximum_values = []
    for frame in audit_frames:
        selected = points[(ordered + int(frame)) % sample_count]
        before = points[(previous + int(frame)) % sample_count]
        after = points[(following + int(frame)) % sample_count]
        nearest = np.minimum(
            np.linalg.norm(selected - before, axis=1),
            np.linalg.norm(selected - after, axis=1))
        p95_values.append(float(np.percentile(nearest, 95)))
        p99_values.append(float(np.percentile(nearest, 99)))
        maximum_values.append(float(np.max(nearest)))
    return max(p95_values), max(p99_values), max(maximum_values)


def passes_gate(metrics: dict) -> bool:
    return metrics["minimumDensityCosine"] >= DENSITY_COSINE_GATE and \
        metrics["minimumSupportRecall"] >= SUPPORT_RECALL_GATE and \
        metrics["maximumP95GapPixels"] <= P95_GAP_GATE_PIXELS


def prepare_coverage_phase_indices(
        positions: np.ndarray, dot_count: int, audit_frames: np.ndarray,
        radius: float, seed_offset: int = 0,
) -> np.ndarray:
    """Greedily cover under-represented trajectory regions across all audit frames."""
    points = positions[:, :2]
    sample_count = len(points)
    if not 0 < COVERAGE_SEED_COUNT <= dot_count <= sample_count:
        raise RuntimeError("Chaos coverage allocation count is invalid")
    seed = (np.floor(np.arange(COVERAGE_SEED_COUNT) * sample_count /
                     COVERAGE_SEED_COUNT).astype(np.int32) + seed_offset) % sample_count
    selected = np.zeros(sample_count, dtype=bool)
    selected[seed] = True
    if int(np.sum(selected)) != COVERAGE_SEED_COUNT:
        raise RuntimeError("Chaos coverage allocation seed collapsed")

    tree = cKDTree(points)
    contacts = tree.sparse_distance_matrix(tree, radius, output_type="coo_matrix")
    adjacency = csr_matrix((np.ones(len(contacts.data), dtype=np.int8),
                            (contacts.row, contacts.col)),
                           shape=(sample_count, sample_count))
    selected_phases = np.flatnonzero(selected)
    uncovered = []
    for frame in audit_frames:
        rows = (selected_phases + frame) % sample_count
        covered = np.asarray(adjacency[rows].sum(axis=0)).ravel() > 0
        uncovered.append(~covered)
    uncovered = np.asarray(uncovered)
    target_uncovered = int(sample_count * COVERAGE_TARGET_UNCOVERED_FRACTION)

    for _ in range(dot_count - COVERAGE_SEED_COUNT):
        scores = np.zeros(sample_count, dtype=np.float64)
        deficits = np.maximum(uncovered.sum(axis=1) - target_uncovered, 0) + 1
        for frame_index, frame in enumerate(audit_frames):
            frame_scores = np.asarray(
                adjacency @ uncovered[frame_index].astype(np.int8)).ravel()
            scores += np.roll(frame_scores, -int(frame)) * deficits[frame_index]
        scores[selected] = -1
        phase = int(np.argmax(scores))
        selected[phase] = True
        for frame_index, frame in enumerate(audit_frames):
            row = (phase + int(frame)) % sample_count
            neighbours = adjacency.indices[
                adjacency.indptr[row]:adjacency.indptr[row + 1]]
            uncovered[frame_index, neighbours] = False

    phases = np.flatnonzero(selected).astype(np.int32)
    if len(phases) != dot_count:
        raise RuntimeError("Chaos coverage allocation returned the wrong dot count")
    return phases


def prepare_support_phase_indices(
        positions: np.ndarray, dot_count: int, audit_frames: np.ndarray,
        reference: dict, seed_count: int,
) -> np.ndarray:
    """Fill an even temporal seed by greedily covering the fidelity support raster."""
    points = positions[:, :2]
    sample_count = len(points)
    if not 0 < seed_count <= dot_count <= sample_count:
        raise RuntimeError("Chaos support allocation count is invalid")

    probe = np.zeros((DENSITY_HEIGHT, DENSITY_WIDTH), dtype=np.float64)
    center = np.asarray((DENSITY_HEIGHT // 2, DENSITY_WIDTH // 2), dtype=np.int32)
    probe[tuple(center)] = 1
    footprint = np.argwhere(ndimage.binary_dilation(
        ndimage.gaussian_filter(np.sqrt(probe), DENSITY_SIGMA) >
        DENSITY_SUPPORT_THRESHOLD, iterations=1)) - center

    x = np.clip((points[:, 0] / 800 * DENSITY_WIDTH).astype(np.int32),
                0, DENSITY_WIDTH - 1)
    y = np.clip((points[:, 1] / 600 * DENSITY_HEIGHT).astype(np.int32),
                0, DENSITY_HEIGHT - 1)
    plane_size = DENSITY_WIDTH * DENSITY_HEIGHT
    reference_support = reference["support"].ravel()
    coverage = []
    for phase in range(sample_count):
        cells = []
        for frame_index, frame in enumerate(audit_frames):
            point_index = (phase + int(frame)) % sample_count
            rows = y[point_index] + footprint[:, 0]
            columns = x[point_index] + footprint[:, 1]
            valid = ((rows >= 0) & (rows < DENSITY_HEIGHT) &
                     (columns >= 0) & (columns < DENSITY_WIDTH))
            local = rows[valid] * DENSITY_WIDTH + columns[valid]
            local = local[reference_support[local]]
            cells.extend((frame_index * plane_size + local).tolist())
        coverage.append(np.unique(np.asarray(cells, dtype=np.int32)))

    seed = np.floor(np.arange(seed_count) * sample_count / seed_count).astype(np.int32)
    selected = np.zeros(sample_count, dtype=bool)
    selected[seed] = True
    uncovered = np.tile(reference_support, len(audit_frames))
    for phase in seed:
        uncovered[coverage[int(phase)]] = False

    candidates = [
        (-int(np.sum(uncovered[phase_coverage])), phase)
        for phase, phase_coverage in enumerate(coverage)
        if not selected[phase]
    ]
    heapq.heapify(candidates)
    while int(np.sum(selected)) < dot_count:
        _, phase = heapq.heappop(candidates)
        gain = int(np.sum(uncovered[coverage[phase]]))
        next_gain_bound = -candidates[0][0] if candidates else -1
        if gain < next_gain_bound:
            heapq.heappush(candidates, (-gain, phase))
            continue
        selected[phase] = True
        uncovered[coverage[phase]] = False

    phases = np.flatnonzero(selected).astype(np.int32)
    if len(phases) != dot_count:
        raise RuntimeError("Chaos support allocation returned the wrong dot count")
    return phases
