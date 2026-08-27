#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Shared prepare-time fidelity gates for retained Chaos trajectory dots."""

from __future__ import annotations

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


def prepare_audit_frames(visible_frame_count: int) -> np.ndarray:
    return np.arange(0, visible_frame_count + 1, FRAME_STEP, dtype=np.int32)


def prepare_reference(positions: np.ndarray) -> dict:
    density = render_density(positions)
    return {
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
            cKDTree(candidate).query(points, k=1)[0], 95)))
    return {
        "minimumDensityCosine": round(min(cosine_values), 6),
        "minimumSupportRecall": round(min(recall_values), 6),
        "maximumP95GapPixels": round(max(gap_values), 4),
    }


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
