#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Lossless prepared transport shared by Chaos preparation and audits."""

from __future__ import annotations

import struct

import numpy as np


MAGIC = b"CSCHAO12"
HEADER_BYTE_LENGTH = 64
VERSION = 12
COORDINATE_SCALE = 10
VIEWPORT_WIDTH = 800
VIEWPORT_HEIGHT = 600
REVEAL_INDEX_BITS = 11
AXIS_DIRECTORY_BYTE_LENGTH = 12
TRANSPORT_ENCODING = (
    "axis-split-zigzag-varint-second-difference-u16-plus-"
    "sorted-phase-ranks-packed-reveal@1"
)


def encode_asset(system_index: int, coordinates: np.ndarray,
                 phase_indices: np.ndarray, reveal_order: np.ndarray,
                 handoff_control_coordinates: np.ndarray) -> bytes:
    """Encode exact Uint16 prepared arrays into the inner transport payload."""
    coordinates = require_u16_triplets(coordinates, "trajectory coordinates")
    handoff_control_coordinates = require_u16_triplets(
        handoff_control_coordinates, "handoff control coordinates")
    phase_indices = require_u16_vector(phase_indices, "phase indices")
    reveal_order = require_u16_vector(reveal_order, "reveal order")
    if len(phase_indices) != len(reveal_order) or len(reveal_order) > 2 ** REVEAL_INDEX_BITS:
        raise ValueError("Chaos phase and reveal cardinality drifted")
    if sorted(int(value) for value in reveal_order) != list(range(len(reveal_order))):
        raise ValueError("Chaos reveal order is not a permutation")
    trajectory = encode_axis_second_differences(coordinates)
    sorted_phases = phase_indices[reveal_order.astype(np.intp)]
    phase_ranks = encode_sorted_phase_ranks(sorted_phases)
    packed_reveal_order = pack_reveal_order(reveal_order)
    handoff_controls = encode_axis_second_differences(handoff_control_coordinates)
    trajectory_offset = HEADER_BYTE_LENGTH
    phase_rank_offset = trajectory_offset + len(trajectory)
    reveal_order_offset = phase_rank_offset + len(phase_ranks)
    handoff_control_offset = reveal_order_offset + len(packed_reveal_order)
    byte_length = handoff_control_offset + len(handoff_controls)
    header = struct.pack(
        "<8sHHHHHHHHIIIIIIIIHHI",
        MAGIC, HEADER_BYTE_LENGTH, VERSION, system_index, len(coordinates),
        COORDINATE_SCALE, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, len(phase_indices),
        trajectory_offset, len(trajectory), phase_rank_offset, len(phase_ranks),
        reveal_order_offset, len(packed_reveal_order), handoff_control_offset,
        len(handoff_controls), len(handoff_control_coordinates), REVEAL_INDEX_BITS,
        byte_length,
    )
    if len(header) != HEADER_BYTE_LENGTH:
        raise RuntimeError(f"Chaos header length drifted: {len(header)}")
    return header + trajectory + phase_ranks + packed_reveal_order + handoff_controls


def decode_asset(source: bytes, descriptor: dict) -> dict[str, np.ndarray]:
    """Decode and structurally validate one inner transport payload."""
    if len(source) < HEADER_BYTE_LENGTH:
        raise ValueError("Chaos trajectory asset is truncated")
    fields = struct.unpack_from("<8sHHHHHHHHIIIIIIIIHHI", source)
    (magic, header_length, version, system_index, sample_count, coordinate_scale,
     width, height, star_count, trajectory_offset, trajectory_byte_length,
     phase_rank_offset, phase_rank_byte_length, reveal_order_offset,
     reveal_order_byte_length, handoff_control_offset, handoff_control_byte_length,
     handoff_control_point_count, reveal_index_bits, byte_length) = fields
    expected_materialized_byte_length = (
        sample_count * 3 * 2 + star_count * 2 * 2 +
        handoff_control_point_count * 3 * 2
    )
    if magic != MAGIC or header_length != HEADER_BYTE_LENGTH or version != VERSION or \
            system_index != descriptor["systemIndex"] or \
            sample_count != descriptor["sampleCount"] or \
            coordinate_scale != COORDINATE_SCALE or width != VIEWPORT_WIDTH or \
            height != VIEWPORT_HEIGHT or star_count != descriptor["starCount"] or \
            handoff_control_point_count != descriptor["handoffControlPointCount"] or \
            reveal_index_bits != REVEAL_INDEX_BITS or byte_length != len(source) or \
            trajectory_offset != HEADER_BYTE_LENGTH or \
            trajectory_byte_length < AXIS_DIRECTORY_BYTE_LENGTH or \
            phase_rank_offset != trajectory_offset + trajectory_byte_length or \
            phase_rank_byte_length < 1 or \
            reveal_order_offset != phase_rank_offset + phase_rank_byte_length or \
            reveal_order_byte_length != \
            (star_count * REVEAL_INDEX_BITS + 7) // 8 or \
            handoff_control_offset != reveal_order_offset + reveal_order_byte_length or \
            handoff_control_byte_length < AXIS_DIRECTORY_BYTE_LENGTH or \
            handoff_control_offset + handoff_control_byte_length != len(source) or \
            descriptor.get("decodedByteLength") != len(source) or \
            descriptor.get("materializedByteLength") != expected_materialized_byte_length or \
            descriptor.get("contentEncoding") != "br" or \
            descriptor.get("transportEncoding") != TRANSPORT_ENCODING:
        raise ValueError(f"Chaos trajectory {descriptor['name']} binary contract drifted")
    coordinates = decode_axis_second_differences(
        source[trajectory_offset:phase_rank_offset], sample_count)
    reveal_order = unpack_reveal_order(
        source[reveal_order_offset:handoff_control_offset], star_count)
    sorted_phases = decode_sorted_phase_ranks(
        source[phase_rank_offset:reveal_order_offset], star_count, sample_count)
    phase_indices = np.empty(star_count, dtype="<u2")
    phase_indices[reveal_order.astype(np.intp)] = sorted_phases
    handoff_control_coordinates = decode_axis_second_differences(
        source[handoff_control_offset:], handoff_control_point_count)
    return {
        "coordinates": coordinates,
        "phaseIndices": phase_indices,
        "revealOrder": reveal_order,
        "handoffControlCoordinates": handoff_control_coordinates,
    }


def encode_axis_second_differences(values: np.ndarray) -> bytes:
    axes = []
    for axis in range(3):
        source = values[:, axis].astype(np.int64)
        output = bytearray()
        append_varuint(output, int(source[0]))
        previous_delta = int(source[1] - source[0])
        append_varuint(output, zig_zag(previous_delta))
        for second_difference in np.diff(source, n=2):
            append_varuint(output, zig_zag(int(second_difference)))
        axes.append(bytes(output))
    return struct.pack("<III", *(len(axis) for axis in axes)) + b"".join(axes)


def decode_axis_second_differences(source: bytes, count: int) -> np.ndarray:
    if len(source) < AXIS_DIRECTORY_BYTE_LENGTH or count < 2:
        raise ValueError("Chaos coordinate section drifted")
    axis_lengths = struct.unpack_from("<III", source)
    axis_offset = AXIS_DIRECTORY_BYTE_LENGTH
    output = np.empty((count, 3), dtype="<u2")
    for axis, axis_length in enumerate(axis_lengths):
        axis_end = axis_offset + axis_length
        if axis_length < 2 or axis_end > len(source):
            raise ValueError("Chaos coordinate axis directory drifted")
        value, cursor = read_varuint(source, axis_offset, axis_end)
        previous_delta_encoded, cursor = read_varuint(source, cursor, axis_end)
        previous_delta = un_zig_zag(previous_delta_encoded)
        require_u16_value(value)
        output[0, axis] = value
        value += previous_delta
        require_u16_value(value)
        output[1, axis] = value
        for index in range(2, count):
            encoded, cursor = read_varuint(source, cursor, axis_end)
            previous_delta += un_zig_zag(encoded)
            value += previous_delta
            require_u16_value(value)
            output[index, axis] = value
        if cursor != axis_end:
            raise ValueError("Chaos coordinate axis has trailing bytes")
        axis_offset = axis_end
    if axis_offset != len(source):
        raise ValueError("Chaos coordinate section has trailing bytes")
    return output


def encode_sorted_phase_ranks(sorted_phases: np.ndarray) -> bytes:
    values = sorted_phases.astype(np.int64)
    if len(values) < 1 or np.any(np.diff(values) <= 0):
        raise ValueError("Chaos prepared source phases are not strictly ranked")
    output = bytearray()
    append_varuint(output, int(values[0]))
    for delta in np.diff(values):
        append_varuint(output, int(delta))
    return bytes(output)


def decode_sorted_phase_ranks(source: bytes, count: int, sample_count: int) -> np.ndarray:
    output = np.empty(count, dtype="<u2")
    phase = -1
    cursor = 0
    for rank in range(count):
        encoded, cursor = read_varuint(source, cursor, len(source))
        phase = encoded if rank == 0 else phase + encoded
        if phase < 0 or phase >= sample_count or (rank > 0 and encoded == 0):
            raise ValueError("Chaos prepared source phase rank drifted")
        output[rank] = phase
    if cursor != len(source):
        raise ValueError("Chaos prepared source phases have trailing bytes")
    return output


def pack_reveal_order(values: np.ndarray) -> bytes:
    byte_length = (len(values) * REVEAL_INDEX_BITS + 7) // 8
    output = bytearray(byte_length)
    accumulator = 0
    available_bits = 0
    output_index = 0
    for raw_value in values:
        value = int(raw_value)
        accumulator |= value << available_bits
        available_bits += REVEAL_INDEX_BITS
        while available_bits >= 8:
            output[output_index] = accumulator & 0xff
            output_index += 1
            accumulator >>= 8
            available_bits -= 8
    if available_bits:
        output[output_index] = accumulator
    return bytes(output)


def unpack_reveal_order(source: bytes, count: int) -> np.ndarray:
    output = np.empty(count, dtype="<u2")
    seen = np.zeros(count, dtype=np.uint8)
    accumulator = 0
    available_bits = 0
    input_index = 0
    mask = (1 << REVEAL_INDEX_BITS) - 1
    for index in range(count):
        while available_bits < REVEAL_INDEX_BITS:
            if input_index >= len(source):
                raise ValueError("Chaos reveal order ended early")
            accumulator |= source[input_index] << available_bits
            input_index += 1
            available_bits += 8
        value = accumulator & mask
        accumulator >>= REVEAL_INDEX_BITS
        available_bits -= REVEAL_INDEX_BITS
        if value >= count or seen[value]:
            raise ValueError("Chaos reveal order is not a permutation")
        seen[value] = 1
        output[index] = value
    while input_index < len(source):
        accumulator |= source[input_index] << available_bits
        input_index += 1
        available_bits += 8
    if accumulator != 0:
        raise ValueError("Chaos reveal order padding drifted")
    return output


def append_varuint(output: bytearray, value: int) -> None:
    if value < 0:
        raise ValueError("Chaos varint value drifted")
    remaining = value
    while remaining >= 0x80:
        output.append((remaining & 0x7f) | 0x80)
        remaining >>= 7
    output.append(remaining)


def read_varuint(source: bytes, offset: int, end: int) -> tuple[int, int]:
    value = 0
    shift = 0
    cursor = offset
    for _ in range(5):
        if cursor >= end:
            raise ValueError("Chaos varint ended early")
        byte = source[cursor]
        cursor += 1
        value |= (byte & 0x7f) << shift
        if byte & 0x80 == 0:
            return value, cursor
        shift += 7
    raise ValueError("Chaos varint exceeded its bound")


def zig_zag(value: int) -> int:
    return -value * 2 - 1 if value < 0 else value * 2


def un_zig_zag(value: int) -> int:
    return value // 2 if value % 2 == 0 else -(value + 1) // 2


def require_u16_triplets(values: np.ndarray, label: str) -> np.ndarray:
    array = np.asarray(values)
    if array.ndim != 2 or array.shape[1] != 3 or len(array) < 2 or \
            not np.issubdtype(array.dtype, np.integer) or np.any(array < 0) or \
            np.any(array > np.iinfo(np.uint16).max):
        raise ValueError(f"Chaos {label} drifted")
    return array.astype("<u2", copy=False)


def require_u16_vector(values: np.ndarray, label: str) -> np.ndarray:
    array = np.asarray(values)
    if array.ndim != 1 or len(array) < 1 or not np.issubdtype(array.dtype, np.integer) or \
            np.any(array < 0) or np.any(array > np.iinfo(np.uint16).max):
        raise ValueError(f"Chaos {label} drifted")
    return array.astype("<u2", copy=False)


def require_u16_value(value: int) -> None:
    if value < 0 or value > 0xffff:
        raise ValueError("Chaos coordinate exceeded Uint16 range")
