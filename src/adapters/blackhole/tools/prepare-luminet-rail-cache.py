#!/usr/bin/env python3
"""Factor the exact prepared Luminet cache into reusable source phase rails."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import sys

import numpy as np
from matplotlib import colormaps
from matplotlib.colors import PowerNorm


def main() -> None:
    arguments = parse_arguments()
    preparation = load_preparation_module(pathlib.Path(arguments.preparation))
    source_root = pathlib.Path(arguments.source_root).resolve()
    sys.path.insert(0, str(source_root))
    from luminet import black_hole_math as bhmath
    from luminet.spatial import polar_to_cartesian

    state_path = pathlib.Path(arguments.state)
    state = json.loads(state_path.read_text())
    if state.get("schema") != "cssblackhole-luminet-prepared-state@9" or \
            state.get("sourceCommit") != arguments.source_commit or \
            state.get("frameCount") != 10_800 or state.get("pointCount") != 3_000:
        raise RuntimeError("Exact full Luminet prepared cache is required")

    particles = preparation.create_particles()
    orders = np.array([particle["order"] for particle in particles], dtype=np.intp)
    radius_indices = np.array(
        [particle["radiusIndex"] for particle in particles], dtype=np.intp)
    phase_indices = np.array(
        [particle["phaseFrameIndex"] for particle in particles], dtype=np.int64)
    turns = np.array([particle["turns"] for particle in particles], dtype=np.int64)
    if len(particles) != preparation.POINT_COUNT:
        raise RuntimeError("Luminet particle identity count drifted")

    prepared_coordinates = np.memmap(
        arguments.coordinates,
        dtype="<i4",
        mode="r",
        shape=(state["frameCount"], preparation.POINT_COUNT, 2),
    )
    prepared_luminances = np.memmap(
        arguments.luminances,
        dtype=np.uint8,
        mode="r",
        shape=(state["frameCount"], preparation.POINT_COUNT),
    )
    shape = (
        preparation.SOURCE_CONFIGURATION_COUNT,
        2,
        preparation.PERIODIC_RADIUS_COUNT,
        preparation.SOURCE_LOOP_FRAME_COUNT,
    )
    rail_coordinates = np.zeros((*shape, 2), dtype="<i4")
    rail_luminances = np.zeros(shape, dtype=np.uint8)
    seen = np.zeros(shape, dtype=bool)
    sequence = state["configurationSequence"]

    for global_frame_index in range(state["frameCount"]):
        sequence_frame_index = global_frame_index % \
            sequence["presentationSequenceFrameCount"]
        presentation_index = next(
            index
            for index, start_frame_index in
            enumerate(sequence["presentationSlotStartFrameIndices"])
            if sequence_frame_index <
            start_frame_index + sequence["presentationSlotFrameCounts"][index]
        )
        local_frame_index = sequence_frame_index - \
            sequence["presentationSlotStartFrameIndices"][presentation_index]
        if local_frame_index >= \
                sequence["transitionStartFrameIndices"][presentation_index]:
            continue
        configuration_index = \
            sequence["presentationStateIndices"][presentation_index]
        source_frame_index = global_frame_index % preparation.SOURCE_LOOP_FRAME_COUNT
        particle_phase_indices = (
            phase_indices + turns * source_frame_index
        ) % preparation.SOURCE_LOOP_FRAME_COUNT
        key = (
            np.full(preparation.POINT_COUNT, configuration_index, dtype=np.intp),
            orders,
            radius_indices,
            particle_phase_indices,
        )
        rail_coordinates[key] = prepared_coordinates[global_frame_index]
        rail_luminances[key] = prepared_luminances[global_frame_index]
        seen[key] = True

    recovered_sample_count = int(np.count_nonzero(seen))
    solve_missing_rail_samples(
        preparation,
        bhmath,
        polar_to_cartesian,
        state,
        rail_coordinates,
        rail_luminances,
        seen,
    )
    if not np.all(seen):
        raise RuntimeError("Luminet rail recovery retained missing samples")

    verify_exact_presentation(
        preparation,
        state,
        prepared_coordinates,
        prepared_luminances,
        rail_coordinates,
        rail_luminances,
        orders,
        radius_indices,
        phase_indices,
        turns,
    )
    if int(np.min(rail_coordinates)) < 0 or int(np.max(rail_coordinates)) > 0xffff:
        raise RuntimeError("Luminet rail coordinate exceeded unsigned 16-bit transport")

    coordinate_output = pathlib.Path(arguments.coordinate_output)
    luminance_output = pathlib.Path(arguments.luminance_output)
    metadata_output = pathlib.Path(arguments.metadata_output)
    for path in (coordinate_output, luminance_output, metadata_output):
        path.parent.mkdir(parents=True, exist_ok=True)
    np.ascontiguousarray(rail_coordinates, dtype="<u2").tofile(coordinate_output)
    np.ascontiguousarray(rail_luminances, dtype=np.uint8).tofile(luminance_output)
    coordinate_bytes = coordinate_output.read_bytes()
    luminance_bytes = luminance_output.read_bytes()
    metadata = {
        "schema": "cssblackhole-luminet-source-rail-cache@1",
        "sourceCommit": arguments.source_commit,
        "configurationCount": preparation.SOURCE_CONFIGURATION_COUNT,
        "imageOrderCount": 2,
        "radiusCount": preparation.PERIODIC_RADIUS_COUNT,
        "sourceFrameCount": preparation.SOURCE_LOOP_FRAME_COUNT,
        "coordinateEncoding": "configuration-order-radius-phase-xy-u16le-decimal1",
        "coordinateByteLength": len(coordinate_bytes),
        "coordinateSha256": hashlib.sha256(coordinate_bytes).hexdigest(),
        "luminanceEncoding": "configuration-order-radius-phase-u8-rgb8",
        "luminanceByteLength": len(luminance_bytes),
        "luminanceSha256": hashlib.sha256(luminance_bytes).hexdigest(),
        "recoveredPreparedSampleCount": recovered_sample_count,
        "sourceSolvedMissingSampleCount": int(seen.size - recovered_sample_count),
        "particleCount": preparation.POINT_COUNT,
        "particleOrders": orders.tolist(),
        "particleRadiusIndices": radius_indices.tolist(),
        "particlePhaseFrameIndices": phase_indices.tolist(),
        "particlePeriodicOrbitCounts": turns.tolist(),
    }
    metadata_output.write_text(json.dumps(metadata, separators=(",", ":")) + "\n")
    print(json.dumps({
        "status": "ready",
        "coordinateByteLength": len(coordinate_bytes),
        "luminanceByteLength": len(luminance_bytes),
        "recoveredPreparedSampleCount": recovered_sample_count,
        "sourceSolvedMissingSampleCount": int(seen.size - recovered_sample_count),
        "exactPresentationFrameCount": state["frameCount"],
    }, indent=2), flush=True)


def solve_missing_rail_samples(
        preparation,
        bhmath,
        polar_to_cartesian,
        state: dict[str, object],
        rail_coordinates: np.ndarray,
        rail_luminances: np.ndarray,
        seen: np.ndarray,
) -> None:
    _, radii = preparation.periodic_orbits()
    normalizer = PowerNorm(
        gamma=state["photometry"]["displayPowerGamma"],
        vmin=0.0,
        vmax=state["photometry"]["maximumObservedFlux"],
        clip=True,
    )
    for configuration_index, configuration in enumerate(preparation.CONFIGURATIONS):
        inclination = math.radians(configuration["inclinationDegrees"])
        for order in range(2):
            for radius_index, radius in enumerate(radii):
                missing_phase_indices = np.flatnonzero(
                    ~seen[configuration_index, order, radius_index]
                )
                if missing_phase_indices.size == 0:
                    continue
                phase_angles = missing_phase_indices.astype(np.float64) * \
                    (2 * math.pi / preparation.SOURCE_LOOP_FRAME_COUNT)
                impact_parameters = np.array([
                    bhmath.solve_for_impact_parameter(
                        float(radius), inclination, float(alpha), preparation.MASS, order)
                    for alpha in phase_angles
                ], dtype=np.float64)
                if not np.all(np.isfinite(impact_parameters)) or \
                        np.any(impact_parameters <= 0):
                    raise RuntimeError("Luminet missing rail solve returned invalid impact parameter")
                x, y = polar_to_cartesian(
                    phase_angles, impact_parameters, rotation=math.pi / 2
                )
                redshift_factors = bhmath.calc_redshift_factor(
                    float(radius), phase_angles, inclination,
                    preparation.MASS, impact_parameters,
                )
                flux = np.asarray(bhmath.calc_flux_observed(
                    float(radius), 1.0, preparation.MASS, redshift_factors
                ), dtype=np.float64)
                visible_flux = preparation.DISPLAY_OPACITY_FLOOR + \
                    (1 - preparation.DISPLAY_OPACITY_FLOOR) * normalizer(flux)
                luminance = colormaps[preparation.COLORMAP](
                    visible_flux, bytes=True
                )[..., 0]
                rail_coordinates[
                    configuration_index, order, radius_index, missing_phase_indices, 0
                ] = np.rint(
                    (preparation.CENTER_X + x * preparation.PIXELS_PER_IMPACT_PARAMETER) * 10
                ).astype("<i4")
                rail_coordinates[
                    configuration_index, order, radius_index, missing_phase_indices, 1
                ] = np.rint(
                    (preparation.CENTER_Y - y * preparation.PIXELS_PER_IMPACT_PARAMETER) * 10
                ).astype("<i4")
                rail_luminances[
                    configuration_index, order, radius_index, missing_phase_indices
                ] = luminance
                seen[configuration_index, order, radius_index, missing_phase_indices] = True


def verify_exact_presentation(
        preparation,
        state: dict[str, object],
        prepared_coordinates: np.ndarray,
        prepared_luminances: np.ndarray,
        rail_coordinates: np.ndarray,
        rail_luminances: np.ndarray,
        orders: np.ndarray,
        radius_indices: np.ndarray,
        phase_indices: np.ndarray,
        turns: np.ndarray,
) -> None:
    sequence = state["configurationSequence"]
    for global_frame_index in range(state["frameCount"]):
        source_frame_index = global_frame_index % preparation.SOURCE_LOOP_FRAME_COUNT
        particle_phase_indices = (
            phase_indices + turns * source_frame_index
        ) % preparation.SOURCE_LOOP_FRAME_COUNT
        sequence_frame_index = global_frame_index % \
            sequence["presentationSequenceFrameCount"]
        presentation_index = next(
            index
            for index, start_frame_index in
            enumerate(sequence["presentationSlotStartFrameIndices"])
            if sequence_frame_index <
            start_frame_index + sequence["presentationSlotFrameCounts"][index]
        )
        configuration_index = \
            sequence["presentationStateIndices"][presentation_index]
        current_coordinates = rail_coordinates[
            configuration_index, orders, radius_indices, particle_phase_indices
        ]
        current_luminances = rail_luminances[
            configuration_index, orders, radius_indices, particle_phase_indices
        ]
        local_frame_index = sequence_frame_index - \
            sequence["presentationSlotStartFrameIndices"][presentation_index]
        transition_start_frame_index = \
            sequence["transitionStartFrameIndices"][presentation_index]
        if local_frame_index < transition_start_frame_index:
            expected_coordinates = current_coordinates
            expected_luminances = current_luminances
        else:
            next_presentation_index = \
                (presentation_index + 1) % sequence["presentationConfigurationCount"]
            next_configuration_index = \
                sequence["presentationStateIndices"][next_presentation_index]
            next_coordinates = rail_coordinates[
                next_configuration_index, orders, radius_indices, particle_phase_indices
            ]
            next_luminances = rail_luminances[
                next_configuration_index, orders, radius_indices, particle_phase_indices
            ]
            progress = (
                local_frame_index - transition_start_frame_index + 1
            ) / preparation.TRANSITION_FRAME_COUNT
            eased = progress * progress * (3 - 2 * progress)
            expected_coordinates = np.rint(
                current_coordinates * (1 - eased) + next_coordinates * eased
            ).astype("<i4")
            expected_luminances = np.rint(
                current_luminances * (1 - eased) + next_luminances * eased
            ).astype(np.uint8)
        if not np.array_equal(expected_coordinates, prepared_coordinates[global_frame_index]):
            raise RuntimeError(
                f"Luminet rail coordinates diverged at frame {global_frame_index}"
            )
        if not np.array_equal(expected_luminances, prepared_luminances[global_frame_index]):
            raise RuntimeError(
                f"Luminet rail luminance diverged at frame {global_frame_index}"
            )


def load_preparation_module(path: pathlib.Path):
    specification = importlib.util.spec_from_file_location(
        "cssblackhole_luminet_preparation", path.resolve()
    )
    if specification is None or specification.loader is None:
        raise RuntimeError("Could not load Luminet preparation module")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preparation", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--coordinates", required=True)
    parser.add_argument("--luminances", required=True)
    parser.add_argument("--coordinate-output", required=True)
    parser.add_argument("--luminance-output", required=True)
    parser.add_argument("--metadata-output", required=True)
    return parser.parse_args()


if __name__ == "__main__":
    main()
