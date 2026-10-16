"""Pure helpers for the O3 public-safe static product bundle."""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import re
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


class PublicBundleError(RuntimeError):
    """Raised when a public bundle invariant is not satisfied."""


FORBIDDEN_PUBLIC_KEYS = frozenset(
    {
        "description_full",
        "raw_description",
        "raw_html",
        "raw_payload",
        "raw_payloads",
        "source_specific_amenities_json",
        "seller_name",
        "owner_name",
        "phone",
        "email",
        "local_path",
        "filesystem_path",
        "semantic_evidence_text",
        "human_comment",
        "debug_fields",
    }
)
WINDOWS_PATH_PATTERN = re.compile(r"(?:[A-Za-z]:\\|\\\\)[^\n\r]+")
PHYSICAL_RELATION_PATTERN = re.compile(
    r"\b(?:[a-z0-9_]+_current_v[01]|product_current_candidates_v0|"
    r"listing_observations_v0|ref_poi_locations_v0|ref_poi_group_membership_v0|"
    r"int_listing_[a-z0-9_]+_v[01])\b"
)


def canonical_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise PublicBundleError("Non-finite number in public payload")
        return value
    if isinstance(value, Decimal):
        parsed = float(value)
        if not math.isfinite(parsed):
            raise PublicBundleError("Non-finite decimal in public payload")
        return parsed
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {
            str(key): canonical_value(item)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, set):
        return [canonical_value(item) for item in sorted(value, key=str)]
    if isinstance(value, (list, tuple)):
        return [canonical_value(item) for item in value]
    return str(value)


def canonical_json(value: Any) -> str:
    return json.dumps(
        canonical_value(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def pretty_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            canonical_value(value),
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
        )
        + "\n"
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def semantic_hash(value: Any) -> str:
    return sha256_bytes(canonical_json(value).encode("utf-8"))


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def gzip_size(payload: bytes) -> int:
    return len(gzip.compress(payload, compresslevel=9, mtime=0))


def repair_utf8_mojibake(value: Any) -> Any:
    """Repair only the reversible UTF-8-as-Latin-1 corruption in authorities."""
    if not isinstance(value, str) or not any(token in value for token in ("Ã", "Â", "�")):
        return value
    for codec in ("latin-1", "cp1252"):
        try:
            candidate = value.encode(codec).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if candidate.count("�") < value.count("�") or not any(
            token in candidate for token in ("Ã", "Â")
        ):
            return candidate
    return value


def parse_json_object(value: Any, *, label: str) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if value in (None, ""):
        return {}
    try:
        parsed = json.loads(str(value))
    except json.JSONDecodeError as exc:
        raise PublicBundleError(f"Invalid JSON in {label}") from exc
    if not isinstance(parsed, dict):
        raise PublicBundleError(f"{label} must contain a JSON object")
    return parsed


def unique_index(
    rows: Iterable[Mapping[str, Any]], *keys: str, label: str
) -> dict[tuple[Any, ...], dict[str, Any]]:
    output: dict[tuple[Any, ...], dict[str, Any]] = {}
    for row in rows:
        key = tuple(row.get(name) for name in keys)
        if any(value in (None, "") for value in key) or key in output:
            raise PublicBundleError(f"Invalid or duplicate {label} key: {key}")
        output[key] = dict(row)
    return output


def scan_public_payload(value: Any, path: str = "$") -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            child = f"{path}.{key_text}"
            if key_text.casefold() in FORBIDDEN_PUBLIC_KEYS:
                findings.append(
                    {"path": child, "finding": "forbidden_public_key"}
                )
            findings.extend(scan_public_payload(item, child))
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            findings.extend(scan_public_payload(item, f"{path}[{index}]"))
    elif isinstance(value, str):
        if WINDOWS_PATH_PATTERN.search(value):
            findings.append({"path": path, "finding": "local_filesystem_path"})
        if PHYSICAL_RELATION_PATTERN.search(value):
            findings.append({"path": path, "finding": "internal_physical_relation"})
    return findings


def build_poi_assets(
    *,
    public_listing_uids: set[str],
    locations: Sequence[Mapping[str, Any]],
    memberships: Sequence[Mapping[str, Any]],
    haversine_links: Sequence[Mapping[str, Any]],
    walk_links: Sequence[Mapping[str, Any]],
    nearest_rows: Sequence[Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Create a deduplicated POI catalog and one merged edge per listing/POI/group."""
    active_locations = {
        str(row["poi_id"]): dict(row)
        for row in locations
        if row.get("is_active") is True
    }
    groups_by_poi: dict[str, set[str]] = defaultdict(set)
    group_lineage: dict[tuple[str, str], dict[str, Any]] = {}
    for row in memberships:
        if row.get("is_active") is not True:
            continue
        poi_id = str(row["poi_id"])
        group_id = str(row["poi_group"])
        if poi_id not in active_locations:
            raise PublicBundleError(f"Active POI membership lacks active POI: {poi_id}")
        groups_by_poi[poi_id].add(group_id)
        group_lineage[(poi_id, group_id)] = dict(row)

    catalog: list[dict[str, Any]] = []
    for poi_id in sorted(groups_by_poi):
        source = active_locations[poi_id]
        catalog.append(
            {
                "poi_id": poi_id,
                "group_ids": sorted(groups_by_poi[poi_id]),
                "poi_type": source.get("poi_type"),
                "poi_subtype": source.get("poi_subtype"),
                "name": source.get("poi_name") or None,
                "latitude": source.get("latitude"),
                "longitude": source.get("longitude"),
                "source": {
                    "dataset_id": str(source.get("poi_source") or "osm"),
                    "attribution_source_id": str(source.get("poi_source") or "osm"),
                    "source_poi_id": source.get("source_poi_id"),
                    "snapshot_id": source.get("extract_batch_id"),
                    "rules_version": source.get("poi_rules_version"),
                },
            }
        )

    edges: dict[tuple[str, str, str], dict[str, Any]] = {}

    def edge_for(uid: str, poi_id: str, group_id: str) -> dict[str, Any]:
        key = (uid, poi_id, group_id)
        if key not in edges:
            edges[key] = {
                "listing_uid": uid,
                "poi_id": poi_id,
                "poi_group_id": group_id,
                "haversine_distance_m": None,
                "haversine_rank": None,
                "walk_duration_s": None,
                "walk_status": None,
                "walk_rank": None,
                "walk_snap_quality": None,
                "is_nearest_by_group": False,
                "nearest_selection_basis": None,
            }
        return edges[key]

    public_haversine_rows = 0
    for row in haversine_links:
        uid = str(row["listing_uid"])
        if uid not in public_listing_uids:
            continue
        public_haversine_rows += 1
        poi_id = str(row["poi_id"])
        for group_id in sorted(groups_by_poi.get(poi_id, ())):
            edge = edge_for(uid, poi_id, group_id)
            distance = row.get("distance_m")
            if edge["haversine_distance_m"] not in (None, distance):
                raise PublicBundleError(f"Conflicting Haversine distance for {(uid, poi_id, group_id)}")
            edge["haversine_distance_m"] = distance

    haversine_by_listing_group: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for edge in edges.values():
        if edge["haversine_distance_m"] is not None:
            haversine_by_listing_group[
                (str(edge["listing_uid"]), str(edge["poi_group_id"]))
            ].append(edge)
    for group_edges in haversine_by_listing_group.values():
        group_edges.sort(
            key=lambda row: (float(row["haversine_distance_m"]), str(row["poi_id"]))
        )
        for rank, edge in enumerate(group_edges, 1):
            edge["haversine_rank"] = rank

    public_walk_rows = 0
    selected_walk: dict[tuple[str, str], str] = {}
    for row in walk_links:
        uid = str(row["listing_uid"])
        if uid not in public_listing_uids:
            continue
        public_walk_rows += 1
        poi_id = str(row["poi_id"])
        group_id = str(row["poi_group"])
        if group_id not in groups_by_poi.get(poi_id, set()):
            raise PublicBundleError(
                f"WALK edge has no active POI membership: {(uid, poi_id, group_id)}"
            )
        edge = edge_for(uid, poi_id, group_id)
        if edge["haversine_distance_m"] is None:
            edge["haversine_distance_m"] = row.get("straight_distance_m")
            edge["haversine_rank"] = row.get("straight_rank")
        edge.update(
            {
                "walk_duration_s": row.get("walk_duration_seconds"),
                "walk_status": row.get("routing_status"),
                "walk_rank": row.get("walk_rank_within_group"),
                "walk_snap_quality": row.get("snap_quality"),
            }
        )
        if row.get("is_selected_nearest_walk") is True:
            key = (uid, group_id)
            if key in selected_walk and selected_walk[key] != poi_id:
                raise PublicBundleError(f"Multiple selected WALK nearest POIs for {key}")
            selected_walk[key] = poi_id

    selected_haversine: dict[tuple[str, str], str] = {}
    for row in nearest_rows:
        uid = str(row["listing_uid"])
        if uid not in public_listing_uids:
            continue
        selected_haversine[(uid, str(row["poi_group"]))] = str(row["nearest_poi_id"])

    nearest: list[dict[str, Any]] = []
    listing_groups = sorted(set(selected_haversine) | set(selected_walk))
    for uid, group_id in listing_groups:
        if (uid, group_id) in selected_walk:
            poi_id = selected_walk[(uid, group_id)]
            basis = "WALK"
        else:
            poi_id = selected_haversine[(uid, group_id)]
            basis = "HAVERSINE"
        edge = edge_for(uid, poi_id, group_id)
        edge["is_nearest_by_group"] = True
        edge["nearest_selection_basis"] = basis
        nearest.append(
            {
                "listing_uid": uid,
                "poi_group_id": group_id,
                "poi_id": poi_id,
                "selection_basis": basis,
                "haversine_distance_m": edge["haversine_distance_m"],
                "walk_duration_s": edge["walk_duration_s"],
                "walk_status": edge["walk_status"],
            }
        )

    edge_rows = [edges[key] for key in sorted(edges)]
    if len(edge_rows) != len({
        (row["listing_uid"], row["poi_id"], row["poi_group_id"])
        for row in edge_rows
    }):
        raise PublicBundleError("Duplicate public listing/POI/group edge")

    stats = {
        "active_physical_poi_count": len(catalog),
        "active_membership_count": sum(len(groups) for groups in groups_by_poi.values()),
        "source_public_haversine_reference_count": public_haversine_rows,
        "source_public_walk_k_reference_count": public_walk_rows,
        "logical_listing_poi_group_edge_count": len(edge_rows),
        "nearest_by_group_count": len(nearest),
        "multi_group_physical_poi_count": sum(len(groups) > 1 for groups in groups_by_poi.values()),
        "relation_semantics": "currently_available_bounded_listing_to_poi_relations",
        "exhaustive_neighborhood_inventory": False,
    }
    return catalog, edge_rows, nearest, stats


def asset_record(relative_path: str, payload: bytes, item_count: int) -> dict[str, Any]:
    return {
        "relative_path": relative_path,
        "sha256": sha256_bytes(payload),
        "item_count": int(item_count),
        "size_bytes": len(payload),
        "gzip_size_bytes": gzip_size(payload),
    }


def validate_asset_inventory(root: Path, records: Sequence[Mapping[str, Any]]) -> list[str]:
    errors: list[str] = []
    for record in records:
        path = root / str(record["relative_path"])
        if not path.is_file():
            errors.append(f"missing:{record['relative_path']}")
            continue
        payload = path.read_bytes()
        if sha256_bytes(payload) != record.get("sha256"):
            errors.append(f"sha256:{record['relative_path']}")
        if len(payload) != int(record.get("size_bytes") or -1):
            errors.append(f"size:{record['relative_path']}")
    return errors


def tree_content_hash(root: Path) -> str:
    """Hash relative paths and file bytes for byte-level rebuild comparisons."""
    digest = hashlib.sha256()
    for path in sorted((item for item in root.rglob("*") if item.is_file()), key=lambda item: item.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        size = path.stat().st_size
        digest.update(size.to_bytes(8, "big"))
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def load_and_validate_public_bundle(root: Path) -> dict[str, Any]:
    """Load a published bundle as a static consumer and verify its integrity."""
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        raise PublicBundleError("Published bundle manifest is missing")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PublicBundleError("Published bundle manifest is invalid") from exc
    if not isinstance(manifest, dict):
        raise PublicBundleError("Published bundle manifest must be an object")
    records = manifest.get("assets")
    if not isinstance(records, list):
        raise PublicBundleError("Published bundle asset inventory is invalid")
    errors = validate_asset_inventory(root, records)
    if errors:
        raise PublicBundleError(f"Published asset integrity errors: {errors[:5]}")

    item_keys = {
        "listings.json": "listings",
        "display_capabilities.json": "capabilities",
        "personas.json": "personas",
        "persona_results.json": "results",
        "poi_catalog.json": "pois",
        "listing_poi_refs.json": "relations",
        "transit_catalog.json": "stations",
    }
    parsed_assets: dict[str, Any] = {}
    for record in records:
        relative = str(record["relative_path"])
        path = root / relative
        if path.suffix not in {".json", ".geojson"}:
            continue
        try:
            parsed = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise PublicBundleError(f"Published JSON asset is invalid: {relative}") from exc
        parsed_assets[relative] = parsed
        if relative in item_keys:
            rows = parsed.get(item_keys[relative]) if isinstance(parsed, dict) else None
            if not isinstance(rows, list) or len(rows) != int(record["item_count"]):
                raise PublicBundleError(f"Published item count mismatch: {relative}")

    spatial = parsed_assets.get("spatial_refs.json")
    if not isinstance(spatial, dict):
        raise PublicBundleError("Published spatial references are missing")
    spatial_records = [spatial.get("common_grid"), *(spatial.get("routing_shards") or [])]
    if any(not isinstance(record, dict) for record in spatial_records):
        raise PublicBundleError("Published spatial reference inventory is invalid")
    spatial_errors = validate_asset_inventory(root, spatial_records)
    if spatial_errors:
        raise PublicBundleError(f"Published spatial integrity errors: {spatial_errors[:5]}")
    return {
        "bundle_id": manifest.get("bundle_id"),
        "logical_asset_count": len(records),
        "spatial_asset_count": len(spatial_records),
        "parsed_json_asset_count": len(parsed_assets),
        "manifest_sha256": file_sha256(manifest_path),
    }
