#!/usr/bin/env python3
"""Generate an endless moving side/angled/top photon loop with pinned Luminet."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import sys
import time

import matplotlib
import numpy as np
from matplotlib import colormaps
from matplotlib.colors import PowerNorm

FRAMES_PER_SECOND = 60
POINT_COUNT = 3_000
DIRECT_COUNT = 2_000
GHOST_COUNT = 1_000
SOURCE_CONFIGURATION_COUNT = 3
TRANSITION_SECONDS = 2
TRANSITION_FRAME_COUNT = TRANSITION_SECONDS * FRAMES_PER_SECOND
ORBITAL_SPEED_SCALE = 0.5
SOURCE_MOTION_REFERENCE_SECONDS = 5 / ORBITAL_SPEED_SCALE
NATURAL_TIME_PER_SOURCE_MOTION_REFERENCE = 1_000.0
NATURAL_TIME_PER_SECOND = \
    NATURAL_TIME_PER_SOURCE_MOTION_REFERENCE / SOURCE_MOTION_REFERENCE_SECONDS
SOURCE_LOOP_SECONDS = 90
SOURCE_LOOP_FRAME_COUNT = round(SOURCE_LOOP_SECONDS * FRAMES_PER_SECOND)
NATURAL_TIME_PER_SOURCE_LOOP = NATURAL_TIME_PER_SECOND * SOURCE_LOOP_SECONDS
AVAILABLE_PERIODIC_RADIUS_COUNT = 89
PERIODIC_RADIUS_COUNT = 16
PRESENTATION_CONFIGURATION_SEQUENCE = (0, 1, 2, 1)
PRESENTATION_CONFIGURATION_COUNT = len(PRESENTATION_CONFIGURATION_SEQUENCE)
PRESENTATION_SLOT_HOLD_SECONDS = (5, 2.75, 1.5, 2.75)
PRESENTATION_SLOT_DURATION_SECONDS = tuple(
    hold_seconds + TRANSITION_SECONDS
    for hold_seconds in PRESENTATION_SLOT_HOLD_SECONDS
)
PRESENTATION_SLOT_FRAME_COUNTS = tuple(
    round(duration * FRAMES_PER_SECOND)
    for duration in PRESENTATION_SLOT_DURATION_SECONDS
)
PRESENTATION_SLOT_TRANSITION_START_FRAME_INDICES = tuple(
    frame_count - TRANSITION_FRAME_COUNT
    for frame_count in PRESENTATION_SLOT_FRAME_COUNTS
)
PRESENTATION_SLOT_START_FRAME_INDICES = tuple(
    sum(PRESENTATION_SLOT_FRAME_COUNTS[:index])
    for index in range(PRESENTATION_CONFIGURATION_COUNT)
)
PRESENTATION_SEQUENCE_FRAME_COUNT = sum(PRESENTATION_SLOT_FRAME_COUNTS)
PRESENTATION_SEQUENCE_SECONDS = \
    PRESENTATION_SEQUENCE_FRAME_COUNT / FRAMES_PER_SECOND
COMBINED_LOOP_FRAME_COUNT = math.lcm(
    SOURCE_LOOP_FRAME_COUNT,
    PRESENTATION_SEQUENCE_FRAME_COUNT,
)
COMBINED_LOOP_SECONDS = COMBINED_LOOP_FRAME_COUNT / FRAMES_PER_SECOND
FRAME_COUNT = COMBINED_LOOP_FRAME_COUNT
MASS = 1.0
MINIMUM_RADIUS = 6.0
MAXIMUM_RADIUS = 30.0
VIEWPORT_WIDTH = 800
VIEWPORT_HEIGHT = 600
CENTER_X = 400.0
CENTER_Y = 300.0
PIXELS_PER_IMPACT_PARAMETER = 9.0
SEED = 1_979
COLORMAP = "Greys_r"
DISPLAY_POWER_GAMMA = 0.35
DISPLAY_OPACITY_FLOOR = 0.22
CONFIGURATIONS = (
    {
        "id": "luminet-inclination-85deg",
        "view": "side",
        "inclinationDegrees": 85,
        "sourceEvidence": "tests/test_viz.py:incl=85*pi/180",
    },
    {
        "id": "luminet-inclination-60deg",
        "view": "angled",
        "inclinationDegrees": 60,
        "sourceEvidence": "tests/test_black_hole.py:incl=pi/3",
    },
    {
        "id": "luminet-inclination-0deg",
        "view": "top",
        "inclinationDegrees": 0,
        "sourceEvidence": "luminet/isoradial.py:0 degrees is top-down",
    },
)
if len(CONFIGURATIONS) != SOURCE_CONFIGURATION_COUNT or \
        any(index < 0 or index >= SOURCE_CONFIGURATION_COUNT
            for index in PRESENTATION_CONFIGURATION_SEQUENCE):
    raise RuntimeError("Luminet source or presentation configuration count drifted")


def main() -> None:
    arguments = parse_arguments()
    source_root = pathlib.Path(arguments.source_root).resolve()
    sys.path.insert(0, str(source_root))
    from luminet import black_hole_math as bhmath
    from luminet.spatial import polar_to_cartesian

    if SOURCE_MOTION_REFERENCE_SECONDS != 10 or SOURCE_LOOP_FRAME_COUNT != 5_400 or \
            PRESENTATION_SEQUENCE_FRAME_COUNT != 1_200 or \
            COMBINED_LOOP_SECONDS != 180 or FRAME_COUNT != 10_800:
        raise RuntimeError(
            "Variable-hold Luminet cadence did not produce the 180-second combined loop")

    particles = create_particles()
    started_at = time.perf_counter()
    source_coordinates, observed_flux, source_bounds = prepare_source_configurations(
        particles, bhmath, polar_to_cartesian, started_at)

    maximum_observed_flux = float(np.max(observed_flux))
    if not math.isfinite(maximum_observed_flux) or maximum_observed_flux <= 0:
        raise RuntimeError("Luminet produced no observable flux")
    display_normalizer = PowerNorm(
        gamma=DISPLAY_POWER_GAMMA, vmin=0.0, vmax=maximum_observed_flux, clip=True)
    normalized_flux = display_normalizer(observed_flux)
    visible_flux = DISPLAY_OPACITY_FLOOR + (1 - DISPLAY_OPACITY_FLOOR) * normalized_flux
    rgba = colormaps[COLORMAP](visible_flux, bytes=True)
    if not (np.array_equal(rgba[..., 0], rgba[..., 1]) and
            np.array_equal(rgba[..., 1], rgba[..., 2]) and
            np.all(rgba[..., 3] == 255)):
        raise RuntimeError("Luminet Greys_r did not produce neutral opaque RGB")
    source_luminances = np.ascontiguousarray(rgba[..., 0], dtype=np.uint8)

    coordinates, luminances = prepare_moving_configuration_loop(
        source_coordinates, source_luminances)

    for configuration_index, configuration in enumerate(CONFIGURATIONS):
        inclination = math.radians(configuration["inclinationDegrees"])
        closure_coordinates, closure_flux = prepare_closure_state(
            particles, inclination, bhmath, polar_to_cartesian)
        if not np.array_equal(closure_coordinates, source_coordinates[configuration_index, 0]):
            difference = np.abs(
                closure_coordinates.astype(np.int64) -
                source_coordinates[configuration_index, 0].astype(np.int64))
            raise RuntimeError(
                f"{configuration['id']} failed exact tenth-pixel closure: {difference.max()}")
        closure_visible_flux = DISPLAY_OPACITY_FLOOR + (1 - DISPLAY_OPACITY_FLOOR) * \
            display_normalizer(closure_flux)
        closure_luminance = colormaps[COLORMAP](closure_visible_flux, bytes=True)[..., 0]
        if not np.array_equal(closure_luminance, source_luminances[configuration_index, 0]):
            difference = np.abs(
                closure_luminance.astype(np.int16) -
                source_luminances[configuration_index, 0].astype(np.int16))
            raise RuntimeError(
                f"{configuration['id']} failed exact RGB8 luminance closure: {difference.max()}")

    output_path = pathlib.Path(arguments.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    coordinates.tofile(output_path)
    coordinate_hash = hashlib.sha256(output_path.read_bytes()).hexdigest()
    luminance_path = pathlib.Path(arguments.luminance_output)
    luminance_path.parent.mkdir(parents=True, exist_ok=True)
    luminances.tofile(luminance_path)
    luminance_hash = hashlib.sha256(luminance_path.read_bytes()).hexdigest()
    metadata = {
        "schema": "cssblackhole-luminet-prepared-state@9",
        "sourceCommit": arguments.source_commit,
        "pointCount": POINT_COUNT,
        "directPointCount": DIRECT_COUNT,
        "ghostPointCount": GHOST_COUNT,
        "frameCount": FRAME_COUNT,
        "framesPerSecond": FRAMES_PER_SECOND,
        "orbitalSpeedScale": ORBITAL_SPEED_SCALE,
        "naturalTimePerSourceMotionReference": NATURAL_TIME_PER_SOURCE_MOTION_REFERENCE,
        "naturalTimePerPresentationSlot": [
            NATURAL_TIME_PER_SECOND * duration
            for duration in PRESENTATION_SLOT_DURATION_SECONDS
        ],
        "naturalTimePerPresentationHold": [
            NATURAL_TIME_PER_SECOND * duration
            for duration in PRESENTATION_SLOT_HOLD_SECONDS
        ],
        "sourceMotionReferenceSeconds": SOURCE_MOTION_REFERENCE_SECONDS,
        "naturalTimePerSourceLoop": NATURAL_TIME_PER_SOURCE_LOOP,
        "sourceLoopSeconds": SOURCE_LOOP_SECONDS,
        "sourceLoopFrameCount": SOURCE_LOOP_FRAME_COUNT,
        "combinedLoopSeconds": COMBINED_LOOP_SECONDS,
        "combinedLoopFrameCount": FRAME_COUNT,
        "mass": MASS,
        "minimumRadius": MINIMUM_RADIUS,
        "maximumRadius": MAXIMUM_RADIUS,
        "pixelsPerImpactParameter": PIXELS_PER_IMPACT_PARAMETER,
        "seed": SEED,
        "coordinateSha256": coordinate_hash,
        "coordinateByteLength": output_path.stat().st_size,
        "luminanceSha256": luminance_hash,
        "luminanceByteLength": luminance_path.stat().st_size,
        "photometry": {
            "mode": "source-observed-flux-to-prepared-css-opacity",
            "intrinsicFluxFunction": "calc_flux_intrinsic_swarzschild",
            "redshiftFunction": "calc_redshift_factor",
            "observedFluxFunction": "calc_flux_observed",
            "observedFluxEquation": "F_o=F_s/(1+z)^4",
            "sourceDefaultNormalization": "linear-zero-to-maximum",
            "displayNormalization": "matplotlib-colors-PowerNorm",
            "displayPowerGamma": DISPLAY_POWER_GAMMA,
            "displayOpacityFloor": DISPLAY_OPACITY_FLOOR,
            "displayNormalizationReason":
                "power-transfer-and-nonzero-floor-for-visible-two-pixel-retained-points",
            "exposureBounds":
                "fixed-zero-to-global-maximum-over-all-moving-source-configurations",
            "minimumObservedFlux": float(np.min(observed_flux)),
            "maximumObservedFlux": maximum_observed_flux,
            "colormap": COLORMAP,
            "colormapLibrary": "matplotlib",
            "colormapLibraryVersion": matplotlib.__version__,
            "output": "prepared-source-luminance-used-as-colored-dot-opacity-over-black",
        },
        "configurationSequence": {
            "schema": "cssblackhole-luminet-moving-configuration-sequence@3",
            "distinctConfigurationCount": SOURCE_CONFIGURATION_COUNT,
            "presentationConfigurationCount": PRESENTATION_CONFIGURATION_COUNT,
            "presentationSequenceSeconds": PRESENTATION_SEQUENCE_SECONDS,
            "presentationSequenceFrameCount": PRESENTATION_SEQUENCE_FRAME_COUNT,
            "presentationSlotHoldSeconds": list(PRESENTATION_SLOT_HOLD_SECONDS),
            "presentationSlotDurationSeconds": list(PRESENTATION_SLOT_DURATION_SECONDS),
            "presentationSlotFrameCounts": list(PRESENTATION_SLOT_FRAME_COUNTS),
            "presentationSlotStartFrameIndices":
                list(PRESENTATION_SLOT_START_FRAME_INDICES),
            "transitionCadenceSecondsBySlot": list(PRESENTATION_SLOT_DURATION_SECONDS),
            "sourceMotionSecondsBeforeTransitionBySlot":
                list(PRESENTATION_SLOT_HOLD_SECONDS),
            "sourceMotionFrameCountsBeforeTransition":
                list(PRESENTATION_SLOT_TRANSITION_START_FRAME_INDICES),
            "transitionStartFrameIndices":
                list(PRESENTATION_SLOT_TRANSITION_START_FRAME_INDICES),
            "transitionSeconds": TRANSITION_SECONDS,
            "transitionFrameCount": TRANSITION_FRAME_COUNT,
            "orbitalSpeedScale": ORBITAL_SPEED_SCALE,
            "orbitalPhase":
                "continuous-across-variable-duration-configuration-transitions",
            "transition":
                "prepared-smoothstep-between-concurrently-moving-source-geodesic-fields",
            "identityCorrespondence":
                "same-source-emitter-radius-order-and-index-across-configurations",
            "presentationStateIndices": list(PRESENTATION_CONFIGURATION_SEQUENCE),
            "presentationSequence": [
                CONFIGURATIONS[index]["id"]
                for index in PRESENTATION_CONFIGURATION_SEQUENCE
            ],
            "presentationSlots": [
                {
                    "presentationIndex": presentation_index,
                    "stateIndex": state_index,
                    "id": CONFIGURATIONS[state_index]["id"],
                    "view": CONFIGURATIONS[state_index]["view"],
                    "holdSeconds": PRESENTATION_SLOT_HOLD_SECONDS[presentation_index],
                    "durationSeconds": PRESENTATION_SLOT_DURATION_SECONDS[presentation_index],
                    "frameCount": PRESENTATION_SLOT_FRAME_COUNTS[presentation_index],
                    "startFrameIndex": PRESENTATION_SLOT_START_FRAME_INDICES[presentation_index],
                    "transitionStartFrameIndex":
                        PRESENTATION_SLOT_TRANSITION_START_FRAME_INDICES[presentation_index],
                    "transitionFrameCount": TRANSITION_FRAME_COUNT,
                }
                for presentation_index, state_index in
                enumerate(PRESENTATION_CONFIGURATION_SEQUENCE)
            ],
            "states": [
                {
                    **configuration,
                    "inclinationRadians": math.radians(configuration["inclinationDegrees"]),
                    "dynamic": True,
                    "coordinates": "pinned-luminet-geodesic-solver",
                    "opacity": "pinned-luminet-observed-flux",
                }
                for configuration in CONFIGURATIONS
            ],
        },
        "bounds": {
            "minimumX": float(np.min(coordinates[..., 0])) / 10,
            "maximumX": float(np.max(coordinates[..., 0])) / 10,
            "minimumY": float(np.min(coordinates[..., 1])) / 10,
            "maximumY": float(np.max(coordinates[..., 1])) / 10,
        },
        "sourceConfigurationBounds": source_bounds,
        "availablePeriodicRadiusCount": AVAILABLE_PERIODIC_RADIUS_COUNT,
        "periodicOrbitCounts": sorted({emitter_state["turns"] for emitter_state in particles}),
        "periodicRadiusCount": len({emitter_state["radius"] for emitter_state in particles}),
        "periodicRadiusSelection":
            "source-valid-greedy-maximin-radius-coverage",
        "particlePeriodicOrbitCounts": [emitter_state["turns"] for emitter_state in particles],
        "radialSampling":
            "deterministic-jittered-uniform-radius-then-nearest-selected-periodic-source-loop-radius",
        "emitterPhaseCount": SOURCE_LOOP_FRAME_COUNT,
        "emitterPhaseQuantization": "one-prepared-source-loop-frame",
        "preparationSeconds": time.perf_counter() - started_at,
    }
    metadata_path = pathlib.Path(arguments.metadata)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n")
    render_oracle(coordinates[0], luminances[0], pathlib.Path(arguments.oracle))
    print(json.dumps(metadata, indent=2), flush=True)


def prepare_moving_configuration_loop(
        source_coordinates: np.ndarray,
        source_luminances: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    coordinates = np.empty((FRAME_COUNT, POINT_COUNT, 2), dtype="<i4")
    luminances = np.empty((FRAME_COUNT, POINT_COUNT), dtype=np.uint8)
    for global_frame_index in range(FRAME_COUNT):
        sequence_frame_index = global_frame_index % PRESENTATION_SEQUENCE_FRAME_COUNT
        presentation_index = next(
            index
            for index, start_frame_index in
            enumerate(PRESENTATION_SLOT_START_FRAME_INDICES)
            if sequence_frame_index <
            start_frame_index + PRESENTATION_SLOT_FRAME_COUNTS[index]
        )
        configuration_index = PRESENTATION_CONFIGURATION_SEQUENCE[presentation_index]
        local_frame_index = sequence_frame_index - \
            PRESENTATION_SLOT_START_FRAME_INDICES[presentation_index]
        source_loop_frame_index = global_frame_index % SOURCE_LOOP_FRAME_COUNT
        current_coordinates = source_coordinates[configuration_index, source_loop_frame_index]
        current_luminances = source_luminances[configuration_index, source_loop_frame_index]
        transition_start_frame_index = \
            PRESENTATION_SLOT_TRANSITION_START_FRAME_INDICES[presentation_index]
        if local_frame_index < transition_start_frame_index:
            coordinates[global_frame_index] = current_coordinates
            luminances[global_frame_index] = current_luminances
            continue
        next_presentation_index = \
            (presentation_index + 1) % PRESENTATION_CONFIGURATION_COUNT
        next_configuration_index = \
            PRESENTATION_CONFIGURATION_SEQUENCE[next_presentation_index]
        next_coordinates = source_coordinates[next_configuration_index, source_loop_frame_index]
        next_luminances = source_luminances[next_configuration_index, source_loop_frame_index]
        progress = (local_frame_index - transition_start_frame_index + 1) / \
            TRANSITION_FRAME_COUNT
        eased = progress * progress * (3 - 2 * progress)
        coordinates[global_frame_index] = np.rint(
            current_coordinates * (1 - eased) + next_coordinates * eased).astype("<i4")
        luminances[global_frame_index] = np.rint(
            current_luminances * (1 - eased) + next_luminances * eased).astype(np.uint8)
    return np.ascontiguousarray(coordinates), np.ascontiguousarray(luminances)


def available_periodic_orbits() -> tuple[np.ndarray, np.ndarray]:
    candidate_turns = np.arange(1, 1_024, dtype=np.int64)
    candidate_radii = (
        NATURAL_TIME_PER_SOURCE_LOOP / (2 * math.pi * candidate_turns)
    ) ** (2 / 3)
    valid = (candidate_radii >= MINIMUM_RADIUS) & (candidate_radii <= MAXIMUM_RADIUS)
    return candidate_turns[valid], candidate_radii[valid]


def periodic_orbits() -> tuple[np.ndarray, np.ndarray]:
    available_turns, available_radii = available_periodic_orbits()
    if available_turns.size != AVAILABLE_PERIODIC_RADIUS_COUNT:
        raise RuntimeError("Source-valid periodic Luminet radius count drifted")

    selected_indices = [0, available_radii.size - 1]
    while len(selected_indices) < PERIODIC_RADIUS_COUNT:
        distances = np.min(np.abs(
            available_radii[:, np.newaxis] - available_radii[selected_indices]
        ), axis=1)
        distances[selected_indices] = -1
        selected_indices.append(int(np.argmax(distances)))
    selected_indices.sort()
    return available_turns[selected_indices], available_radii[selected_indices]


def create_particles() -> list[dict[str, float | int]]:
    random = np.random.default_rng(SEED)
    valid_turns, valid_radii = periodic_orbits()
    if valid_turns.size != PERIODIC_RADIUS_COUNT:
        raise RuntimeError("Selected periodic Luminet radius count drifted")

    def image_particles(count: int, order: int) -> list[dict[str, float | int]]:
        targets = MINIMUM_RADIUS + (MAXIMUM_RADIUS - MINIMUM_RADIUS) * \
            (np.arange(count, dtype=np.float64) + random.random(count)) / count
        random.shuffle(targets)
        result = []
        for target in targets:
            radius_index = int(np.argmin(np.abs(valid_radii - target)))
            result.append(emitter(
                radius_index,
                float(valid_radii[radius_index]),
                int(random.integers(0, SOURCE_LOOP_FRAME_COUNT)),
                order,
                int(valid_turns[radius_index]),
            ))
        result.sort(key=lambda value: float(value["radius"]))
        return result

    direct = image_particles(DIRECT_COUNT, 0)
    ghosts = image_particles(GHOST_COUNT, 1)
    return direct + ghosts


def emitter(radius_index: int, radius: float, phase_frame_index: int,
        order: int, turns: int) -> dict[str, float | int]:
    omega = math.sqrt(MASS / radius**3)
    actual_turns = omega * NATURAL_TIME_PER_SOURCE_LOOP / (2 * math.pi)
    if not math.isclose(actual_turns, turns, rel_tol=0, abs_tol=1e-12):
        raise RuntimeError("Periodic Luminet radius did not preserve source omega")
    return {"radiusIndex": radius_index, "radius": radius,
            "phaseFrameIndex": phase_frame_index, "order": order,
            "turns": turns, "omega": omega}


def prepare_source_configurations(particles, bhmath, polar_to_cartesian,
        started_at: float) -> tuple[np.ndarray, np.ndarray, list[dict[str, float | str]]]:
    valid_turns, valid_radii = periodic_orbits()
    phase_angles = np.arange(SOURCE_LOOP_FRAME_COUNT, dtype=np.float64) * \
        (2 * math.pi / SOURCE_LOOP_FRAME_COUNT)
    particle_orders = np.array([particle["order"] for particle in particles], dtype=np.intp)
    particle_radius_indices = np.array(
        [particle["radiusIndex"] for particle in particles], dtype=np.intp)
    particle_phase_indices = np.array(
        [particle["phaseFrameIndex"] for particle in particles], dtype=np.int64)
    particle_turns = np.array([particle["turns"] for particle in particles], dtype=np.int64)
    source_coordinates = np.empty(
        (SOURCE_CONFIGURATION_COUNT, SOURCE_LOOP_FRAME_COUNT, POINT_COUNT, 2), dtype="<i4")
    observed_flux = np.empty(
        (SOURCE_CONFIGURATION_COUNT, SOURCE_LOOP_FRAME_COUNT, POINT_COUNT), dtype=np.float64)
    source_bounds = []

    for configuration_index, configuration in enumerate(CONFIGURATIONS):
        inclination = math.radians(configuration["inclinationDegrees"])
        rail_coordinates = np.empty(
            (2, valid_radii.size, SOURCE_LOOP_FRAME_COUNT, 2), dtype="<i4")
        rail_flux = np.empty(
            (2, valid_radii.size, SOURCE_LOOP_FRAME_COUNT), dtype=np.float64)
        completed_rails = 0
        for order in range(2):
            for radius_index, radius in enumerate(valid_radii):
                impact_parameters = np.array([
                    bhmath.solve_for_impact_parameter(
                        float(radius), inclination, float(alpha), MASS, order)
                    for alpha in phase_angles
                ], dtype=np.float64)
                if not np.all(np.isfinite(impact_parameters)) or np.any(impact_parameters <= 0):
                    raise RuntimeError(
                        "Luminet returned an invalid phase-rail impact parameter at "
                        f"configuration={configuration_index} order={order} "
                        f"turns={int(valid_turns[radius_index])}")
                x, y = polar_to_cartesian(
                    phase_angles, impact_parameters, rotation=math.pi / 2)
                redshift_factors = bhmath.calc_redshift_factor(
                    float(radius), phase_angles, inclination, MASS, impact_parameters)
                flux = np.asarray(bhmath.calc_flux_observed(
                    float(radius), 1.0, MASS, redshift_factors), dtype=np.float64)
                if not np.all(np.isfinite(flux)) or np.any(flux < 0):
                    raise RuntimeError(
                        "Luminet returned invalid phase-rail flux at "
                        f"configuration={configuration_index} order={order} "
                        f"turns={int(valid_turns[radius_index])}")
                rail_coordinates[order, radius_index, :, 0] = np.rint(
                    (CENTER_X + x * PIXELS_PER_IMPACT_PARAMETER) * 10).astype("<i4")
                rail_coordinates[order, radius_index, :, 1] = np.rint(
                    (CENTER_Y - y * PIXELS_PER_IMPACT_PARAMETER) * 10).astype("<i4")
                rail_flux[order, radius_index] = flux
                completed_rails += 1
                if completed_rails % 18 == 0 or completed_rails == valid_radii.size * 2:
                    elapsed = time.perf_counter() - started_at
                    print(
                        f"luminet configuration "
                        f"{configuration_index + 1}/{SOURCE_CONFIGURATION_COUNT} "
                        f"phase rail {completed_rails:03d}/{valid_radii.size * 2} "
                        f"elapsed={elapsed:.1f}s",
                        flush=True,
                    )

        for frame_index in range(SOURCE_LOOP_FRAME_COUNT):
            phase_indices = (
                particle_phase_indices + particle_turns * frame_index
            ) % SOURCE_LOOP_FRAME_COUNT
            source_coordinates[configuration_index, frame_index] = rail_coordinates[
                particle_orders, particle_radius_indices, phase_indices]
            observed_flux[configuration_index, frame_index] = rail_flux[
                particle_orders, particle_radius_indices, phase_indices]
        configuration_coordinates = source_coordinates[configuration_index]
        source_bounds.append({
            "id": configuration["id"],
            "minimumX": float(np.min(configuration_coordinates[..., 0])) / 10,
            "maximumX": float(np.max(configuration_coordinates[..., 0])) / 10,
            "minimumY": float(np.min(configuration_coordinates[..., 1])) / 10,
            "maximumY": float(np.max(configuration_coordinates[..., 1])) / 10,
        })
    return source_coordinates, observed_flux, source_bounds


def prepare_closure_state(
        particles,
        inclination: float,
        bhmath,
        polar_to_cartesian,
) -> tuple[np.ndarray, np.ndarray]:
    closure = np.empty((POINT_COUNT, 2), dtype="<i4")
    fluxes = np.empty(POINT_COUNT, dtype=np.float64)
    for point_index, emitter_state in enumerate(particles):
        alpha = emitter_state["phaseFrameIndex"] * 2 * math.pi / \
            SOURCE_LOOP_FRAME_COUNT + emitter_state["omega"] * NATURAL_TIME_PER_SOURCE_LOOP
        impact_parameter = bhmath.solve_for_impact_parameter(
            emitter_state["radius"], inclination, alpha, MASS, emitter_state["order"])
        x, y = polar_to_cartesian(alpha, impact_parameter, rotation=math.pi / 2)
        closure[point_index, 0] = round(
            (CENTER_X + float(x) * PIXELS_PER_IMPACT_PARAMETER) * 10)
        closure[point_index, 1] = round(
            (CENTER_Y - float(y) * PIXELS_PER_IMPACT_PARAMETER) * 10)
        redshift_factor = bhmath.calc_redshift_factor(
            emitter_state["radius"], alpha, inclination, MASS, impact_parameter)
        fluxes[point_index] = bhmath.calc_flux_observed(
            emitter_state["radius"], 1.0, MASS, redshift_factor)
    return closure, fluxes


def render_oracle(frame: np.ndarray, luminances: np.ndarray, output_path: pathlib.Path) -> None:
    image = np.zeros((VIEWPORT_HEIGHT, VIEWPORT_WIDTH, 3), dtype=np.uint8)
    for point_index, (x_tenths, y_tenths) in enumerate(frame):
        x = int(round(int(x_tenths) / 10))
        y = int(round(int(y_tenths) / 10))
        color = np.repeat(luminances[point_index], 3)
        image[max(0, y):min(VIEWPORT_HEIGHT, y + 2),
              max(0, x):min(VIEWPORT_WIDTH, x + 2)] = color
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as output:
        output.write(f"P6\n{VIEWPORT_WIDTH} {VIEWPORT_HEIGHT}\n255\n".encode("ascii"))
        output.write(image.tobytes())


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--luminance-output", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--oracle", required=True)
    return parser.parse_args()


if __name__ == "__main__":
    main()
