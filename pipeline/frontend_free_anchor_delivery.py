#!/usr/bin/env python3
"""Pure helpers for Flincy's destination-addressable static routing delivery."""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import statistics
import time
from array import array
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence


SEARCH_TILE_SCHEMA = "flincy_free_anchor_search_tile_v1"
EXPLORE_TILE_SCHEMA = "flincy_free_anchor_explore_tile_v1"
INDEX_SCHEMA = "flincy_free_anchor_delivery_index_v1"
SEARCH_TILE_CANDIDATES = (4, 8, 16)
MAX_PREFERRED_RAW_BYTES = 5 * 1024 * 1024
MAX_CLOUDFLARE_ASSET_BYTES = 25 * 1024 * 1024
MAX_PREFERRED_SEARCH_FILES = 250
_CELL_PATTERN = re.compile(r"^grid_500_(-?\d+)_(-?\d+)$")


def canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def deterministic_gzip_size(value: bytes) -> int:
    return len(gzip.compress(value, compresslevel=9, mtime=0))


def parse_grid_cell_id(cell_id: str) -> tuple[int, int]:
    match = _CELL_PATTERN.fullmatch(cell_id)
    if match is None:
        raise ValueError(f"Invalid B30 cell ID: {cell_id}")
    return int(match.group(1)), int(match.group(2))


def tile_id_for_cell(cell_id: str, tile_size: int) -> str:
    if tile_size <= 0:
        raise ValueError("Tile size must be positive")
    x_index, y_index = parse_grid_cell_id(cell_id)
    return f"tile_{tile_size}_{x_index // tile_size}_{y_index // tile_size}"


def partition_cells(
    cell_order: Sequence[str], tile_size: int
) -> dict[str, list[tuple[str, int]]]:
    tiles: dict[str, list[tuple[str, int]]] = {}
    for source_index, cell_id in enumerate(cell_order):
        tiles.setdefault(tile_id_for_cell(cell_id, tile_size), []).append(
            (cell_id, source_index)
        )
    return dict(sorted(tiles.items()))


@dataclass
class SearchModeMatrix:
    duration_seconds: array
    diagnostic_duration_seconds: array
    routing_status_code: array
    route_pattern_code: array
    routing_status: list[str]
    route_pattern: list[str]


@dataclass
class SearchMatrix:
    cell_order: list[str]
    cell_order_hash: str
    routing_location_order: list[str]
    modes: dict[str, SearchModeMatrix]
    source_shard_hashes: list[str]


def _append_nullable_ints(target: array, values: Iterable[Any]) -> None:
    target.extend(-1 if value is None else int(value) for value in values)


def build_search_matrix(
    *,
    cell_order: Sequence[str],
    cell_order_hash: str,
    routing_location_order: Sequence[str],
    modes: Sequence[str],
    metadata_by_location_mode: Mapping[tuple[str, str], Mapping[str, Any]],
    shard_reader: Callable[[Mapping[str, Any]], Mapping[str, Any]],
) -> SearchMatrix:
    mode_matrices: dict[str, SearchModeMatrix] = {}
    source_hashes: list[str] = []
    expected_count = len(cell_order)
    for mode in sorted(modes):
        duration = array("i")
        diagnostic = array("i")
        status_codes = array("B")
        pattern_codes = array("B")
        status_dictionary: list[str] = []
        pattern_dictionary: list[str] = []
        status_index: dict[str, int] = {}
        pattern_index: dict[str, int] = {}
        for location_key in routing_location_order:
            metadata = metadata_by_location_mode.get((location_key, mode))
            if metadata is None:
                raise ValueError(f"Missing Search shard for {location_key}/{mode}")
            shard = shard_reader(metadata)
            if shard.get("cell_order_hash") != cell_order_hash:
                raise ValueError(f"Search cell-order mismatch for {location_key}/{mode}")
            columns = shard["columns"]
            if any(len(columns[name]) != expected_count for name in columns):
                raise ValueError(f"Search row-count mismatch for {location_key}/{mode}")
            _append_nullable_ints(duration, columns["duration_seconds"])
            _append_nullable_ints(
                diagnostic, columns["diagnostic_duration_seconds"]
            )
            source_statuses = shard["dictionaries"]["routing_status"]
            source_patterns = shard["dictionaries"]["route_pattern"]
            for code in columns["routing_status_code"]:
                value = str(source_statuses[int(code)])
                if value not in status_index:
                    status_index[value] = len(status_dictionary)
                    status_dictionary.append(value)
                status_codes.append(status_index[value])
            for code in columns["route_pattern_code"]:
                value = str(source_patterns[int(code)])
                if value not in pattern_index:
                    pattern_index[value] = len(pattern_dictionary)
                    pattern_dictionary.append(value)
                pattern_codes.append(pattern_index[value])
            source_hashes.append(str(metadata["sha256"]))
        mode_matrices[mode] = SearchModeMatrix(
            duration_seconds=duration,
            diagnostic_duration_seconds=diagnostic,
            routing_status_code=status_codes,
            route_pattern_code=pattern_codes,
            routing_status=status_dictionary,
            route_pattern=pattern_dictionary,
        )
    return SearchMatrix(
        cell_order=list(cell_order),
        cell_order_hash=cell_order_hash,
        routing_location_order=list(routing_location_order),
        modes=mode_matrices,
        source_shard_hashes=sorted(set(source_hashes)),
    )


def _project_column(
    values: array,
    *,
    cell_count: int,
    source_indices: Sequence[int],
    location_count: int,
    nullable: bool,
) -> list[int | None]:
    projected: list[int | None] = []
    for location_index in range(location_count):
        offset = location_index * cell_count
        for source_index in source_indices:
            value = int(values[offset + source_index])
            projected.append(None if nullable and value == -1 else value)
    return projected


def search_tile_payload(
    matrix: SearchMatrix,
    *,
    tile_id: str,
    cells: Sequence[tuple[str, int]],
    modes: Sequence[str],
) -> dict[str, Any]:
    source_indices = [source_index for _cell_id, source_index in cells]
    location_count = len(matrix.routing_location_order)
    cell_count = len(matrix.cell_order)
    projected_modes: dict[str, Any] = {}
    for mode in sorted(modes):
        source = matrix.modes[mode]
        projected_modes[mode] = {
            "dictionaries": {
                "route_pattern": source.route_pattern,
                "routing_status": source.routing_status,
            },
            "columns": {
                "diagnostic_duration_seconds": _project_column(
                    source.diagnostic_duration_seconds,
                    cell_count=cell_count,
                    source_indices=source_indices,
                    location_count=location_count,
                    nullable=True,
                ),
                "duration_seconds": _project_column(
                    source.duration_seconds,
                    cell_count=cell_count,
                    source_indices=source_indices,
                    location_count=location_count,
                    nullable=True,
                ),
                "route_pattern_code": _project_column(
                    source.route_pattern_code,
                    cell_count=cell_count,
                    source_indices=source_indices,
                    location_count=location_count,
                    nullable=False,
                ),
                "routing_status_code": _project_column(
                    source.routing_status_code,
                    cell_count=cell_count,
                    source_indices=source_indices,
                    location_count=location_count,
                    nullable=False,
                ),
            },
        }
    return {
        "schema_version": SEARCH_TILE_SCHEMA,
        "tile_id": tile_id,
        "cell_order": [cell_id for cell_id, _source_index in cells],
        "cell_order_hash": sha256_bytes(
            canonical_json_bytes([cell_id for cell_id, _source_index in cells])
        ),
        "routing_location_order": matrix.routing_location_order,
        "storage_order": "routing_location_major_then_destination",
        "modes": projected_modes,
    }


def search_supported_modes_by_cell(
    matrix: SearchMatrix,
    addressable_cell_ids: Sequence[str],
) -> dict[str, list[str]]:
    """Qualify destination modes without converting unavailable facts to routes."""
    source_index = {cell_id: index for index, cell_id in enumerate(matrix.cell_order)}
    cell_count = len(matrix.cell_order)
    location_count = len(matrix.routing_location_order)
    result: dict[str, list[str]] = {}
    for cell_id in addressable_cell_ids:
        cell_index = source_index[cell_id]
        supported: list[str] = []
        for mode in sorted(matrix.modes):
            source = matrix.modes[mode]
            unsupported_code = next(
                (
                    code
                    for code, status in enumerate(source.routing_status)
                    if status == "destination_mode_unsupported"
                ),
                None,
            )
            if unsupported_code is None or any(
                source.routing_status_code[
                    location_index * cell_count + cell_index
                ]
                != unsupported_code
                for location_index in range(location_count)
            ):
                supported.append(mode)
        result[cell_id] = supported
    return result


def benchmark_search_sharding(
    matrix: SearchMatrix,
    *,
    addressable_cell_ids: Sequence[str],
    tile_sizes: Sequence[int] = SEARCH_TILE_CANDIDATES,
) -> list[dict[str, Any]]:
    source_index = {cell_id: index for index, cell_id in enumerate(matrix.cell_order)}
    addressable = set(addressable_cell_ids)
    ordered = [cell_id for cell_id in matrix.cell_order if cell_id in addressable]
    results: list[dict[str, Any]] = []
    for tile_size in tile_sizes:
        cells = [(cell_id, source_index[cell_id]) for cell_id in ordered]
        tiles = partition_cells([cell_id for cell_id, _index in cells], tile_size)
        source_by_cell = dict(cells)
        tile_cells = {
            tile_id: [(cell_id, source_by_cell[cell_id]) for cell_id, _ in rows]
            for tile_id, rows in tiles.items()
        }
        for combined_modes in (False, True):
            started = time.perf_counter()
            raw_sizes: list[int] = []
            gzip_sizes: list[int] = []
            file_count = 0
            for tile_id, rows in tile_cells.items():
                mode_groups = [sorted(matrix.modes)] if combined_modes else [
                    [mode] for mode in sorted(matrix.modes)
                ]
                for mode_group in mode_groups:
                    raw = canonical_json_bytes(
                        search_tile_payload(
                            matrix,
                            tile_id=tile_id,
                            cells=rows,
                            modes=mode_group,
                        )
                    )
                    raw_sizes.append(len(raw))
                    gzip_sizes.append(deterministic_gzip_size(raw))
                    file_count += 1
            results.append(
                {
                    "tile_size_cells": tile_size,
                    "mode_partition": "combined" if combined_modes else "separate",
                    "file_count": file_count,
                    "max_raw_bytes": max(raw_sizes),
                    "median_raw_bytes": round(statistics.median(raw_sizes)),
                    "total_raw_bytes": sum(raw_sizes),
                    "max_gzip_bytes": max(gzip_sizes),
                    "median_gzip_bytes": round(statistics.median(gzip_sizes)),
                    "total_gzip_bytes": sum(gzip_sizes),
                    "benchmark_build_seconds": round(time.perf_counter() - started, 3),
                }
            )
    return results


def select_search_strategy(candidates: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    valid = [
        row
        for row in candidates
        if int(row["max_raw_bytes"]) < MAX_CLOUDFLARE_ASSET_BYTES
    ]
    if not valid:
        raise ValueError("Every Search sharding candidate exceeds Cloudflare's asset gate")
    preferred = [
        row
        for row in valid
        if int(row["max_raw_bytes"]) < MAX_PREFERRED_RAW_BYTES
        and int(row["file_count"]) <= MAX_PREFERRED_SEARCH_FILES
    ]
    pool = preferred or valid
    selected = min(
        pool,
        key=lambda row: (
            int(row["tile_size_cells"]),
            0 if row["mode_partition"] == "combined" else 1,
            int(row["file_count"]),
            int(row["median_gzip_bytes"]),
        ),
    )
    return dict(selected)


def write_content_addressed_json(
    root: Path, prefix: str, payload: Mapping[str, Any]
) -> dict[str, Any]:
    raw = canonical_json_bytes(payload)
    content_hash = sha256_bytes(raw)
    filename = f"{prefix}_{content_hash[:20]}.json"
    path = root / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(raw)
    temporary.replace(path)
    return {
        "relative_path": path.name,
        "sha256": content_hash,
        "size_bytes": len(raw),
        "gzip_size_bytes": deterministic_gzip_size(raw),
    }
