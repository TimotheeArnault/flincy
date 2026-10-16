import tempfile
import unittest
from array import array
from pathlib import Path

from pipeline.frontend_free_anchor_delivery import (
    SearchMatrix,
    SearchModeMatrix,
    canonical_json_bytes,
    parse_grid_cell_id,
    partition_cells,
    search_tile_payload,
    search_supported_modes_by_cell,
    select_search_strategy,
    tile_id_for_cell,
    write_content_addressed_json,
)


class FrontendFreeAnchorDeliveryTest(unittest.TestCase):
    def test_grid_identity_and_tiles_are_deterministic_for_negative_indices(self):
        self.assertEqual(parse_grid_cell_id("grid_500_-1_17"), (-1, 17))
        self.assertEqual(tile_id_for_cell("grid_500_-1_17", 8), "tile_8_-1_2")
        self.assertEqual(
            partition_cells(
                ["grid_500_8_8", "grid_500_1_1", "grid_500_9_8"], 8
            ),
            {
                "tile_8_0_0": [("grid_500_1_1", 1)],
                "tile_8_1_1": [
                    ("grid_500_8_8", 0),
                    ("grid_500_9_8", 2),
                ],
            },
        )
        with self.assertRaises(ValueError):
            parse_grid_cell_id("other_1_2")

    def test_search_projection_preserves_nulls_statuses_and_storage_order(self):
        mode = SearchModeMatrix(
            duration_seconds=array("i", [10, -1, 30, 40]),
            diagnostic_duration_seconds=array("i", [10, 20, 30, 40]),
            routing_status_code=array("B", [0, 1, 0, 0]),
            route_pattern_code=array("B", [0, 1, 0, 0]),
            routing_status=["calculated_point", "network_coverage_missing"],
            route_pattern=["direct", "none"],
        )
        matrix = SearchMatrix(
            cell_order=["grid_500_1_1", "grid_500_1_2"],
            cell_order_hash="source-order",
            routing_location_order=["a", "b"],
            modes={"transit": mode},
            source_shard_hashes=["source"],
        )
        payload = search_tile_payload(
            matrix,
            tile_id="tile",
            cells=[("grid_500_1_2", 1)],
            modes=["transit"],
        )
        self.assertEqual(payload["storage_order"], "routing_location_major_then_destination")
        self.assertEqual(payload["modes"]["transit"]["columns"]["duration_seconds"], [None, 40])
        self.assertEqual(payload["modes"]["transit"]["columns"]["routing_status_code"], [1, 0])

    def test_strategy_prefers_the_smallest_bounded_shared_mode_partition(self):
        rows = [
            {"tile_size_cells": 4, "mode_partition": "combined", "file_count": 500, "max_raw_bytes": 100, "median_gzip_bytes": 10},
            {"tile_size_cells": 8, "mode_partition": "separate", "file_count": 240, "max_raw_bytes": 100, "median_gzip_bytes": 10},
            {"tile_size_cells": 8, "mode_partition": "combined", "file_count": 120, "max_raw_bytes": 100, "median_gzip_bytes": 10},
            {"tile_size_cells": 16, "mode_partition": "combined", "file_count": 40, "max_raw_bytes": 100, "median_gzip_bytes": 8},
        ]
        self.assertEqual(
            select_search_strategy(rows)["mode_partition"], "combined"
        )
        self.assertEqual(select_search_strategy(rows)["tile_size_cells"], 8)

    def test_mode_support_fails_closed_when_every_origin_rejects_the_destination(self):
        matrix = SearchMatrix(
            cell_order=["grid_500_1_1", "grid_500_1_2"],
            cell_order_hash="source-order",
            routing_location_order=["a", "b"],
            modes={
                "car": SearchModeMatrix(
                    duration_seconds=array("i", [-1, 10, -1, 20]),
                    diagnostic_duration_seconds=array("i", [-1, 10, -1, 20]),
                    routing_status_code=array("B", [0, 1, 0, 1]),
                    route_pattern_code=array("B", [0, 0, 0, 0]),
                    routing_status=["destination_mode_unsupported", "calculated_provisional_origin"],
                    route_pattern=["none"],
                ),
                "transit": SearchModeMatrix(
                    duration_seconds=array("i", [10, 10, 20, 20]),
                    diagnostic_duration_seconds=array("i", [10, 10, 20, 20]),
                    routing_status_code=array("B", [0, 0, 0, 0]),
                    route_pattern_code=array("B", [0, 0, 0, 0]),
                    routing_status=["calculated_provisional_origin"],
                    route_pattern=["direct"],
                ),
            },
            source_shard_hashes=[],
        )
        self.assertEqual(
            search_supported_modes_by_cell(
                matrix, ["grid_500_1_1", "grid_500_1_2"]
            ),
            {
                "grid_500_1_1": ["transit"],
                "grid_500_1_2": ["car", "transit"],
            },
        )

    def test_content_addressed_output_is_stable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = write_content_addressed_json(root, "tile", {"b": 2, "a": 1})
            second = write_content_addressed_json(root, "tile", {"a": 1, "b": 2})
            self.assertEqual(first, second)
            self.assertEqual(len(list(root.iterdir())), 1)
            self.assertEqual(
                (root / first["relative_path"]).read_bytes(),
                canonical_json_bytes({"a": 1, "b": 2}),
            )


if __name__ == "__main__":
    unittest.main()
