"""Pure O2D-C explanation algebra for the O2D-B candidate engine."""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any


DEFAULT_TOLERANCE = 1e-9


class ExplanationContractError(ValueError):
    pass


def _number(value: Any, *, default: float = 0.0) -> float:
    if value is None:
        return default
    result = float(value)
    if not math.isfinite(result):
        raise ExplanationContractError("Explanation inputs must be finite")
    return result


def _score_fraction(score: Any, *, usable: bool) -> float:
    if not usable:
        return 0.0
    value = _number(score)
    if value < -DEFAULT_TOLERANCE or value > 100.0 + DEFAULT_TOLERANCE:
        raise ExplanationContractError("Scores must remain within [0, 100]")
    return min(100.0, max(0.0, value)) / 100.0


def _partition(
    allocated: float,
    coverage: float,
    score: Any,
    *,
    usable: bool,
) -> dict[str, float]:
    if allocated < 0.0 or coverage < 0.0 or coverage > 1.0:
        raise ExplanationContractError("Invalid explanation budget or coverage")
    evaluable = allocated * coverage
    earned = evaluable * _score_fraction(score, usable=usable and evaluable > 0.0)
    missed = evaluable - earned
    unknown = allocated - evaluable
    return {
        "allocated_budget_points": allocated,
        "evaluable_budget_points": evaluable,
        "earned_points": earned,
        "missed_points": missed,
        "unknown_points": unknown,
        "coverage": coverage,
        "match_rate": (_number(score) / 100.0 if usable and score is not None else None),
    }


def _assert_close(left: float, right: float, label: str, tolerance: float) -> None:
    if not math.isclose(left, right, rel_tol=0.0, abs_tol=tolerance):
        raise ExplanationContractError(f"{label} mismatch: {left!r} != {right!r}")


def explain_outputs(
    outputs: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    tolerance: float = DEFAULT_TOLERANCE,
) -> dict[str, list[dict[str, Any]]]:
    """Derive criterion, component, bucket and profile explanations exactly."""
    criteria_by_component: dict[tuple[str, str, str, str], list[dict[str, Any]]] = (
        defaultdict(list)
    )
    for row in outputs["criteria"]:
        key = (
            str(row["listing_uid"]),
            str(row["search_state_id"]),
            str(row["bucket_id"]),
            str(row["component_id"]),
        )
        criteria_by_component[key].append(dict(row))

    components_by_bucket: dict[tuple[str, str, str], list[dict[str, Any]]] = (
        defaultdict(list)
    )
    for row in outputs["components"]:
        key = (
            str(row["listing_uid"]),
            str(row["search_state_id"]),
            str(row["bucket_id"]),
        )
        components_by_bucket[key].append(dict(row))

    buckets_by_profile: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in outputs["buckets"]:
        buckets_by_profile[
            (str(row["listing_uid"]), str(row["search_state_id"]))
        ].append(dict(row))

    criterion_explanations: list[dict[str, Any]] = []
    component_explanations: list[dict[str, Any]] = []
    bucket_explanations: list[dict[str, Any]] = []
    profile_explanations: list[dict[str, Any]] = []

    component_explanation_index: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    bucket_explanation_index: dict[tuple[str, str, str], dict[str, Any]] = {}

    for bucket_key, component_rows in sorted(components_by_bucket.items()):
        listing_uid, state_id, bucket_id = bucket_key
        active_components = [
            row
            for row in component_rows
            if _number(row.get("component_weight")) > 0.0
            and row.get("component_status") != "inactive"
        ]
        active_weight_total = sum(
            _number(row.get("component_weight")) for row in active_components
        )
        for component in sorted(component_rows, key=lambda row: str(row["component_id"])):
            component_id = str(component["component_id"])
            key = (listing_uid, state_id, bucket_id, component_id)
            configured_weight = _number(component.get("component_weight"))
            active = component in active_components and active_weight_total > 0.0
            effective_weight = configured_weight / active_weight_total if active else 0.0
            component_explanation_index[key] = {
                "listing_uid": listing_uid,
                "source_platform": component.get("source_platform"),
                "search_state_id": state_id,
                "bucket_id": bucket_id,
                "component_id": component_id,
                "component_status": component.get("component_status"),
                "configured_component_weight": configured_weight,
                "effective_component_weight": effective_weight,
                "component_coverage_raw": component.get("component_coverage_raw"),
                "component_score_raw": component.get("component_score_raw"),
                "reason_codes": sorted(
                    {
                        str(row.get("score_basis_kind") or row.get("criterion_status") or "unknown")
                        for row in criteria_by_component.get(key, [])
                    }
                ),
            }

    for context in sorted(
        outputs["contexts"],
        key=lambda row: (str(row["search_state_id"]), str(row["listing_uid"])),
    ):
        listing_uid = str(context["listing_uid"])
        state_id = str(context["search_state_id"])
        profile_key = (listing_uid, state_id)
        bucket_rows = buckets_by_profile[profile_key]
        active_buckets = [row for row in bucket_rows if _number(row.get("bucket_weight")) > 0.0]
        bucket_weight_total = sum(_number(row.get("bucket_weight")) for row in active_buckets)

        for bucket in sorted(bucket_rows, key=lambda row: str(row["bucket_id"])):
            bucket_id = str(bucket["bucket_id"])
            bucket_key = (listing_uid, state_id, bucket_id)
            active = bucket in active_buckets and bucket_weight_total > 0.0
            effective_bucket_weight = (
                _number(bucket.get("bucket_weight")) / bucket_weight_total if active else 0.0
            )
            allocated = effective_bucket_weight * 100.0
            coverage = (
                _number(bucket.get("bucket_coverage_raw"))
                if bucket.get("bucket_coverage_raw") is not None
                else 0.0
            )
            partition = _partition(
                allocated,
                coverage,
                bucket.get("bucket_score_raw"),
                usable=bucket.get("bucket_score_raw") is not None,
            )
            component_rows = components_by_bucket.get(bucket_key, [])
            component_parts: list[dict[str, Any]] = []
            for component in component_rows:
                component_id = str(component["component_id"])
                component_key = (listing_uid, state_id, bucket_id, component_id)
                base = component_explanation_index[component_key]
                component_allocated = (
                    allocated * float(base["effective_component_weight"])
                )
                component_coverage = (
                    _number(component.get("component_coverage_raw"))
                    if component.get("component_coverage_raw") is not None
                    else 0.0
                )
                component_partition = _partition(
                    component_allocated,
                    component_coverage,
                    component.get("component_score_raw"),
                    usable=component.get("component_score_raw") is not None,
                )
                component_full = {**base, **component_partition}
                component_parts.append(component_full)
                component_explanations.append(component_full)

                criterion_rows = criteria_by_component.get(component_key, [])
                atomic_weight_total = sum(
                    _number(row.get("atomic_weight")) for row in criterion_rows
                )
                for criterion in sorted(
                    criterion_rows, key=lambda row: str(row["criterion_id"])
                ):
                    atomic_weight = (
                        _number(criterion.get("atomic_weight")) / atomic_weight_total
                        if atomic_weight_total > 0.0
                        else 0.0
                    )
                    criterion_allocated = component_allocated * atomic_weight
                    usable = bool(criterion.get("criterion_is_usable"))
                    criterion_partition = _partition(
                        criterion_allocated,
                        1.0 if usable else 0.0,
                        criterion.get("criterion_score_raw"),
                        usable=usable,
                    )
                    criterion_explanations.append(
                        {
                            "listing_uid": listing_uid,
                            "source_platform": criterion.get("source_platform"),
                            "search_state_id": state_id,
                            "bucket_id": bucket_id,
                            "component_id": component_id,
                            "criterion_id": criterion.get("criterion_id"),
                            "atomic_weight": atomic_weight,
                            "criterion_status": criterion.get("criterion_status"),
                            "semantic_truth_value": criterion.get("semantic_truth_value"),
                            "evidence_status": criterion.get("evidence_status"),
                            "reason_code": criterion.get("score_basis_kind"),
                            "criterion_score_raw": criterion.get("criterion_score_raw"),
                            "criterion_is_usable": usable,
                            **criterion_partition,
                        }
                    )

            for field in (
                "allocated_budget_points",
                "evaluable_budget_points",
                "earned_points",
                "missed_points",
                "unknown_points",
            ):
                _assert_close(
                    sum(_number(row[field]) for row in component_parts),
                    _number(partition[field]),
                    f"component-to-bucket {profile_key}/{bucket_id}/{field}",
                    tolerance,
                )
            bucket_full = {
                "listing_uid": listing_uid,
                "source_platform": bucket.get("source_platform"),
                "search_state_id": state_id,
                "bucket_id": bucket_id,
                "bucket_status": bucket.get("bucket_status"),
                "configured_bucket_weight": _number(bucket.get("bucket_weight")),
                "effective_bucket_weight": effective_bucket_weight,
                "bucket_coverage_raw": bucket.get("bucket_coverage_raw"),
                "bucket_score_raw": bucket.get("bucket_score_raw"),
                "reason_codes": sorted(
                    {
                        reason
                        for row in component_parts
                        for reason in row.get("reason_codes", [])
                    }
                ),
                **partition,
            }
            bucket_explanation_index[bucket_key] = bucket_full
            bucket_explanations.append(bucket_full)

        active_bucket_parts = [
            bucket_explanation_index[(listing_uid, state_id, str(row["bucket_id"]))]
            for row in active_buckets
        ]
        totals = {
            field: sum(_number(row[field]) for row in active_bucket_parts)
            for field in (
                "allocated_budget_points",
                "evaluable_budget_points",
                "earned_points",
                "missed_points",
                "unknown_points",
            )
        }
        if context.get("user_fit_enabled"):
            _assert_close(totals["allocated_budget_points"], 100.0, "profile budget", tolerance)
        _assert_close(
            totals["allocated_budget_points"],
            totals["earned_points"] + totals["missed_points"] + totals["unknown_points"],
            "profile partition",
            tolerance,
        )
        derived_coverage = (
            totals["evaluable_budget_points"] / totals["allocated_budget_points"]
            if totals["allocated_budget_points"] > 0.0
            else None
        )
        derived_score = (
            totals["earned_points"] / totals["evaluable_budget_points"] * 100.0
            if totals["evaluable_budget_points"] > 0.0
            else None
        )
        if context.get("profile_coverage_raw") is not None:
            _assert_close(
                _number(context["profile_coverage_raw"]),
                _number(derived_coverage),
                "profile coverage",
                tolerance,
            )
        if context.get("fit_score_raw") is not None:
            _assert_close(
                _number(context["fit_score_raw"]),
                _number(derived_score),
                "profile score",
                tolerance,
            )
        profile_explanations.append(
            {
                "listing_uid": listing_uid,
                "source_platform": context.get("source_platform"),
                "search_state_id": state_id,
                "product_universe_band": context.get("product_universe_band"),
                "feasibility_status": context.get("feasibility_status"),
                "listing_eligibility_status": context.get("listing_eligibility_status"),
                "fit_score_raw": context.get("fit_score_raw"),
                "profile_coverage_raw": context.get("profile_coverage_raw"),
                "derived_fit_score_raw": derived_score,
                "derived_profile_coverage_raw": derived_coverage,
                "active_bucket_count": len(active_bucket_parts),
                "reconciliation_valid": True,
                **{f"total_{key}": value for key, value in totals.items()},
            }
        )

    criterion_totals: dict[tuple[str, str, str, str], dict[str, float]] = defaultdict(
        lambda: defaultdict(float)
    )
    for row in criterion_explanations:
        key = (
            str(row["listing_uid"]),
            str(row["search_state_id"]),
            str(row["bucket_id"]),
            str(row["component_id"]),
        )
        for field in (
            "allocated_budget_points",
            "evaluable_budget_points",
            "earned_points",
            "missed_points",
            "unknown_points",
        ):
            criterion_totals[key][field] += _number(row[field])
    for row in component_explanations:
        key = (
            str(row["listing_uid"]),
            str(row["search_state_id"]),
            str(row["bucket_id"]),
            str(row["component_id"]),
        )
        for field in (
            "allocated_budget_points",
            "evaluable_budget_points",
            "earned_points",
            "missed_points",
            "unknown_points",
        ):
            _assert_close(
                criterion_totals[key][field],
                _number(row[field]),
                f"criterion-to-component {key}/{field}",
                tolerance,
            )

    return {
        "criteria": criterion_explanations,
        "components": component_explanations,
        "buckets": bucket_explanations,
        "profiles": profile_explanations,
    }
