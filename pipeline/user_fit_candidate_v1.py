"""Pure helpers for the reviewed O2D user-fit model."""

from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any


OBSERVATION_POLICIES = {
    "TRUE_UNKNOWN",
    "POSITIVE_EVIDENCE_EXPECTED",
    "EXPLICIT_STATE",
}
EVIDENCE_STATUSES = {
    "confirmed_positive",
    "confirmed_negative",
    "no_positive_evidence_after_valid_observation",
    "truly_unresolved",
    "ambiguous",
}
SCORING_READINESS = {
    "DEFAULT_ACTIVE",
    "SELECTABLE_ONLY",
    "NOT_SCORABLE_V1",
    "DEFER",
}
DISPLAY_READINESS = {
    "CANONICAL_RESOLVED",
    "STRUCTURED_SOURCE",
    "INTERNAL_ONLY",
}
DISPLAY_FEATURE_FAMILIES = {
    "core",
    "lease_availability",
    "unit_amenity",
    "building_amenity",
    "canonical_resolved",
    "other",
}
DISPLAY_PROJECTION_STATUSES = {
    "DIRECT_CURRENT_FIELD",
    "CANONICAL_RESOLUTION",
    "TRIVIAL_WHITELIST_PROJECTION",
    "REQUIRES_NEW_SEMANTIC_RESOLUTION",
    "INTERNAL_ONLY",
}
GLOBAL_WEIGHT_POLICIES = {"explicit", "equal_active_buckets"}


class CandidateModelError(ValueError):
    pass


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        default=str,
    )


def semantic_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _unique_index(
    rows: Sequence[Mapping[str, Any]], key: str, label: str
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for raw in rows:
        value = str(raw.get(key) or "")
        if not value or value in result:
            raise CandidateModelError(f"Invalid or duplicate {key} in {label}: {value!r}")
        result[value] = dict(raw)
    return result


def normalize_weights(
    weights: Mapping[str, Any], active_ids: Sequence[str], *, label: str
) -> dict[str, float]:
    active = list(dict.fromkeys(str(value) for value in active_ids))
    if not active:
        raise CandidateModelError(f"{label} has no active member")
    unknown = sorted(set(weights) - set(active))
    if unknown:
        raise CandidateModelError(f"{label} contains inactive weights: {unknown}")
    values: dict[str, float] = {}
    for member in active:
        raw = weights.get(member, 1.0)
        try:
            value = float(raw)
        except (TypeError, ValueError) as exc:
            raise CandidateModelError(f"{label}/{member} weight is not numeric") from exc
        if not math.isfinite(value) or value < 0:
            raise CandidateModelError(f"{label}/{member} weight must be finite and non-negative")
        values[member] = value
    total = sum(values.values())
    if total <= 0:
        raise CandidateModelError(f"{label} weight total must be positive")
    return {member: values[member] / total for member in active}


def resolve_active_weights(
    *,
    catalog_ids: Sequence[str],
    active_ids: Sequence[str],
    requested_weights: Mapping[str, Any],
    label: str,
) -> dict[str, float]:
    """Resolve a catalog against one explicit active subset."""
    catalog = list(dict.fromkeys(str(value) for value in catalog_ids))
    active = list(dict.fromkeys(str(value) for value in active_ids))
    unknown_active = sorted(set(active) - set(catalog))
    if unknown_active:
        raise CandidateModelError(f"{label} contains unknown active members: {unknown_active}")
    unknown_weights = sorted(set(requested_weights) - set(active))
    if unknown_weights:
        raise CandidateModelError(f"{label} contains inactive weights: {unknown_weights}")
    if not active:
        return {member: 0.0 for member in catalog}
    normalized = normalize_weights(requested_weights, active, label=label)
    return {member: normalized.get(member, 0.0) for member in catalog}


def _preset_active_bucket_ids(
    preset: Mapping[str, Any], buckets: Mapping[str, Any]
) -> list[str]:
    explicit = preset.get("active_bucket_ids")
    if explicit is None:
        explicit = list((preset.get("bucket_weights") or {}).keys())
    active = list(dict.fromkeys(str(value) for value in explicit or []))
    unknown = sorted(set(active) - set(buckets))
    if unknown:
        raise CandidateModelError(
            f"{preset.get('preset_id')} contains unknown active buckets: {unknown}"
        )
    return active


def validate_candidate_contract(
    contract: Mapping[str, Any], *, allow_authoritative: bool = False
) -> None:
    boundary = (contract.get("authority"), contract.get("canonical"))
    expected = {("audit_only", False)}
    if allow_authoritative:
        expected.add(("authoritative", True))
    if boundary not in expected:
        raise CandidateModelError("O2D contract authority/canonical boundary is invalid")
    model = contract.get("weight_model") or {}
    if model.get("maximum_component_depth") != 1 or model.get("recursive_components_allowed") is not False:
        raise CandidateModelError("O2D-B permits exactly one non-recursive component layer")
    if model.get("feature_count_changes_bucket_budget") is not False:
        raise CandidateModelError("Adding a feature must not increase a bucket budget")
    if set(contract.get("observation_policies") or {}) != OBSERVATION_POLICIES:
        raise CandidateModelError("Observation policy set drifted")
    if set(contract.get("scoring_readiness_statuses") or []) != SCORING_READINESS:
        raise CandidateModelError("Scoring readiness set drifted")
    if set(contract.get("display_readiness_statuses") or []) != DISPLAY_READINESS:
        raise CandidateModelError("Display readiness set drifted")
    if "source_platform" in canonical_json(contract):
        raise CandidateModelError("Source-specific scoring is forbidden")

    buckets = _unique_index(contract.get("buckets") or [], "bucket_id", "buckets")
    components = _unique_index(
        contract.get("components") or [], "component_id", "components"
    )
    criteria = _unique_index(
        contract.get("criterion_definitions") or [], "criterion_id", "criteria"
    )
    display_inventory = _unique_index(
        contract.get("display_inventory") or [], "feature_key", "display inventory"
    )
    for display_fact in display_inventory.values():
        if display_fact.get("scoring_readiness") not in SCORING_READINESS:
            raise CandidateModelError("Display fact has unknown scoring readiness")
        if display_fact.get("display_readiness") not in DISPLAY_READINESS:
            raise CandidateModelError("Display fact has unknown display readiness")
        if display_fact.get("feature_family") not in DISPLAY_FEATURE_FAMILIES:
            raise CandidateModelError("Display fact has unknown feature family")
        if display_fact.get("projection_status") not in DISPLAY_PROJECTION_STATUSES:
            raise CandidateModelError("Display fact has unknown projection status")
        if not isinstance(display_fact.get("sources_supported"), list):
            raise CandidateModelError("Display fact sources_supported must be an array")
        if not isinstance(display_fact.get("public_safe_candidate"), bool):
            raise CandidateModelError("Display fact public-safe decision must be explicit")
        if not str(display_fact.get("absence_semantics") or ""):
            raise CandidateModelError("Display fact absence semantics must be explicit")
    for component in components.values():
        if component.get("bucket_id") not in buckets:
            raise CandidateModelError("Component references an unknown bucket")
        if component.get("scoring_readiness") not in SCORING_READINESS:
            raise CandidateModelError("Component has unknown scoring readiness")
        criterion_ids = list(component.get("criterion_ids") or [])
        if not criterion_ids:
            raise CandidateModelError("Component contains no atomic criterion")
        for criterion_id in criterion_ids:
            if criterion_id != "anchor_commute_dynamic" and criterion_id not in criteria:
                raise CandidateModelError(f"Unknown criterion in component: {criterion_id}")
    for criterion in criteria.values():
        if criterion.get("component_id") not in components:
            raise CandidateModelError("Criterion references an unknown component")
        if criterion.get("observation_policy") not in OBSERVATION_POLICIES:
            raise CandidateModelError("Criterion has unknown observation policy")

    global_presets = _unique_index(
        contract.get("global_presets") or [], "preset_id", "global presets"
    )
    for preset in global_presets.values():
        active_bucket_ids = _preset_active_bucket_ids(preset, buckets)
        policy = str(preset.get("weight_policy") or "explicit")
        if policy not in GLOBAL_WEIGHT_POLICIES:
            raise CandidateModelError("Global preset has unknown weight policy")
        requested = preset.get("bucket_weights") or {}
        if policy == "equal_active_buckets" and requested:
            raise CandidateModelError(
                "Equal-active global presets must not carry explicit bucket weights"
            )
        normalized = resolve_active_weights(
            catalog_ids=list(buckets),
            active_ids=active_bucket_ids,
            requested_weights=requested,
            label=str(preset["preset_id"]),
        )
        if active_bucket_ids and not math.isclose(
            sum(normalized.values()), 1.0, abs_tol=1e-12
        ):
            raise CandidateModelError("Global preset does not normalize to one")
    bucket_presets = _unique_index(
        contract.get("bucket_presets") or [], "preset_id", "bucket presets"
    )
    for preset in bucket_presets.values():
        bucket_id = str(preset.get("bucket_id") or "")
        if bucket_id not in buckets:
            raise CandidateModelError("Bucket preset references an unknown bucket")
        active = list(preset.get("active_components") or [])
        if any(
            component_id not in components
            or components[component_id]["bucket_id"] != bucket_id
            for component_id in active
        ):
            raise CandidateModelError("Bucket preset references a component outside its bucket")
        normalize_weights(
            preset.get("component_weights") or {}, active, label=str(preset["preset_id"])
        )

    compositions = _unique_index(
        contract.get("persona_compositions") or [], "search_state_id", "compositions"
    )
    for composition in compositions.values():
        if composition.get("global_preset_id") not in global_presets:
            raise CandidateModelError("Composition references an unknown global preset")
        global_preset = global_presets[str(composition["global_preset_id"])]
        active_bucket_ids = list(
            dict.fromkeys(
                str(value)
                for value in (
                    composition.get("active_bucket_ids")
                    if composition.get("active_bucket_ids") is not None
                    else _preset_active_bucket_ids(global_preset, buckets)
                )
            )
        )
        unknown_active = sorted(set(active_bucket_ids) - set(buckets))
        if unknown_active:
            raise CandidateModelError(
                f"Composition contains unknown active buckets: {unknown_active}"
            )
        preset_ids = list(composition.get("bucket_preset_ids") or [])
        if any(preset_id not in bucket_presets for preset_id in preset_ids):
            raise CandidateModelError("Composition references an unknown bucket preset")
        covered = [bucket_presets[preset_id]["bucket_id"] for preset_id in preset_ids]
        if len(covered) != len(set(covered)) or set(covered) != set(active_bucket_ids):
            raise CandidateModelError(
                "Each composition must select exactly one preset per active bucket"
            )
        manual = composition.get("manual_overrides") or {}
        forbidden = {"max_budget", "minimum_bedrooms", "pets_requirement"}
        if forbidden & set(manual):
            raise CandidateModelError("Presets cannot silently alter hard constraints")
        if "rebalancing_group" in composition or "rebalancing_group" in manual:
            raise CandidateModelError("UI rebalancing groups are not Search State")
        manual_bucket_weights = manual.get("bucket_weights")
        if manual_bucket_weights is not None:
            resolve_active_weights(
                catalog_ids=list(buckets),
                active_ids=active_bucket_ids,
                requested_weights=manual_bucket_weights,
                label=f"{composition['search_state_id']}/manual buckets",
            )
        unknown_component_overrides = sorted(
            set((manual.get("component_weights") or {})) - set(active_bucket_ids)
        )
        if unknown_component_overrides:
            raise CandidateModelError(
                "Component overrides target inactive buckets: "
                f"{unknown_component_overrides}"
            )


def validate_authoritative_contract(contract: Mapping[str, Any]) -> None:
    validate_candidate_contract(contract, allow_authoritative=True)
    if contract.get("authority") != "authoritative" or contract.get("canonical") is not True:
        raise CandidateModelError("Authoritative O2D contract boundary is invalid")
    if contract.get("contract_version") != "fit_product_calibration_v1":
        raise CandidateModelError("Authoritative O2D contract version drifted")
    freeze = contract.get("freeze_semantics") or {}
    if freeze.get("structural_contract_status") != "FROZEN_V1":
        raise CandidateModelError("O2D structural contract must be frozen at v1")
    if freeze.get("numerical_defaults_status") != "AUTHORITATIVE_V1":
        raise CandidateModelError("O2D numerical defaults must be authoritative v1")
    if freeze.get("frontend_calibration_policy") != "FRONTEND_CALIBRATION_ALLOWED":
        raise CandidateModelError("O2D frontend calibration policy drifted")
    snapshot_hash = str(
        (contract.get("accepted_candidate_v1_snapshot") or {}).get(
            "input_snapshot_fingerprint"
        )
        or ""
    )
    if len(snapshot_hash) != 64 or any(character not in "0123456789abcdef" for character in snapshot_hash):
        raise CandidateModelError("O2D accepted input snapshot hash is invalid")


def resolve_candidate_states(
    contract: Mapping[str, Any],
    current_states: Sequence[Mapping[str, Any]],
    *,
    allow_authoritative: bool = False,
) -> dict[str, list[dict[str, Any]]]:
    validate_candidate_contract(contract, allow_authoritative=allow_authoritative)
    state_index = _unique_index(current_states, "search_state_id", "current states")
    buckets = _unique_index(contract["buckets"], "bucket_id", "buckets")
    components = _unique_index(contract["components"], "component_id", "components")
    global_presets = _unique_index(
        contract["global_presets"], "preset_id", "global presets"
    )
    bucket_presets = _unique_index(
        contract["bucket_presets"], "preset_id", "bucket presets"
    )

    resolved_states: list[dict[str, Any]] = []
    resolved_buckets: list[dict[str, Any]] = []
    resolved_components: list[dict[str, Any]] = []
    resolved_atomics: list[dict[str, Any]] = []
    for composition in contract["persona_compositions"]:
        state_id = str(composition["search_state_id"])
        base_id = str(composition["base_search_state_id"])
        if base_id not in state_index:
            raise CandidateModelError(f"Unknown base Search State: {base_id}")
        base = state_index[base_id]
        global_preset = global_presets[str(composition["global_preset_id"])]
        active_bucket_ids = list(
            dict.fromkeys(
                str(value)
                for value in (
                    composition.get("active_bucket_ids")
                    if composition.get("active_bucket_ids") is not None
                    else _preset_active_bucket_ids(global_preset, buckets)
                )
            )
        )
        bucket_weights = dict(global_preset.get("bucket_weights") or {})
        manual = dict(composition.get("manual_overrides") or {})
        if manual.get("bucket_weights") is not None:
            bucket_weights = dict(manual["bucket_weights"])
        elif str(global_preset.get("weight_policy") or "explicit") == "equal_active_buckets":
            bucket_weights = {}
        bucket_weights = resolve_active_weights(
            catalog_ids=list(buckets),
            active_ids=active_bucket_ids,
            requested_weights=bucket_weights,
            label=f"{state_id}/buckets",
        )
        trace = {
            "bucket_weights": (
                "manual_override"
                if manual.get("bucket_weights") is not None
                else f"global_preset:{global_preset['preset_id']}"
            ),
            "hard_constraints": f"base_search_state:{base_id}",
        }
        state_semantic = {
            "search_state_id": state_id,
            "base_search_state_id": base_id,
            "profile_mode": composition.get("profile_mode") or base.get("profile_mode"),
            "persona_id": composition.get("persona_id", base.get("persona_id")),
            "global_preset_id": composition["global_preset_id"],
            "active_bucket_ids": active_bucket_ids,
            "bucket_preset_ids": list(composition["bucket_preset_ids"]),
            "manual_overrides": manual,
        }
        resolved_states.append(
            {
                **state_semantic,
                "public_label": base.get("public_label"),
                "user_fit_enabled": bool(base.get("user_fit_enabled"))
                and bool(active_bucket_ids),
                "resolution_trace_json": canonical_json(trace),
                "resolved_candidate_state_hash": semantic_hash(state_semantic),
            }
        )
        preset_by_bucket = {
            str(bucket_presets[preset_id]["bucket_id"]): bucket_presets[preset_id]
            for preset_id in composition["bucket_preset_ids"]
        }
        for bucket_id, bucket in buckets.items():
            bucket_enabled = bucket_id in active_bucket_ids
            preset = preset_by_bucket.get(bucket_id)
            active_components = list(preset["active_components"]) if preset else []
            weights = dict(preset["component_weights"]) if preset else {}
            manual_component = (manual.get("component_weights") or {}).get(bucket_id)
            if manual_component is not None:
                weights = dict(manual_component)
                active_components = list(weights)
            normalized = (
                normalize_weights(
                    weights,
                    active_components,
                    label=f"{state_id}/{bucket_id}/components",
                )
                if bucket_enabled
                else {}
            )
            bucket_semantic = {
                "search_state_id": state_id,
                "bucket_id": bucket_id,
                "bucket_weight": bucket_weights[bucket_id],
                "bucket_enabled": bucket_enabled,
                "component_preset_id": preset["preset_id"] if preset else None,
                "active_components": active_components,
            }
            resolved_buckets.append(
                {
                    **bucket_semantic,
                    "display_order": bucket["display_order"],
                    "resolved_bucket_hash": semantic_hash(bucket_semantic),
                }
            )
            for component_id in active_components:
                definition = components[component_id]
                criterion_ids = list(definition["criterion_ids"])
                atomic_weights = normalize_weights(
                    {}, criterion_ids, label=f"{state_id}/{component_id}/atomics"
                )
                component_semantic = {
                    "search_state_id": state_id,
                    "bucket_id": bucket_id,
                    "component_id": component_id,
                    "component_weight": normalized[component_id],
                    "criterion_ids": criterion_ids,
                }
                resolved_components.append(
                    {
                        **component_semantic,
                        "scoring_readiness": definition["scoring_readiness"],
                        "resolution_source": (
                            "manual_override"
                            if manual_component is not None
                            else f"bucket_preset:{preset['preset_id']}"
                        ),
                        "resolved_component_hash": semantic_hash(component_semantic),
                    }
                )
                for criterion_id in criterion_ids:
                    resolved_atomics.append(
                        {
                            "search_state_id": state_id,
                            "bucket_id": bucket_id,
                            "component_id": component_id,
                            "criterion_id": criterion_id,
                            "atomic_weight": atomic_weights[criterion_id],
                        }
                    )
    return {
        "states": resolved_states,
        "buckets": resolved_buckets,
        "components": resolved_components,
        "atomics": resolved_atomics,
    }


def evaluate_evidence(
    evidence_status: str,
    observation_policy: str,
) -> dict[str, Any]:
    if evidence_status not in EVIDENCE_STATUSES:
        raise CandidateModelError(f"Unknown evidence status: {evidence_status}")
    if observation_policy not in OBSERVATION_POLICIES:
        raise CandidateModelError(f"Unknown observation policy: {observation_policy}")
    if evidence_status == "confirmed_positive":
        return {
            "criterion_status": "strict_match",
            "criterion_score_raw": 100.0,
            "criterion_is_usable": True,
            "criterion_score_is_exact": True,
            "criterion_coverage_status": "usable_exact",
            "score_basis_kind": "confirmed_positive",
        }
    if evidence_status == "confirmed_negative":
        return {
            "criterion_status": "fail",
            "criterion_score_raw": 0.0,
            "criterion_is_usable": True,
            "criterion_score_is_exact": True,
            "criterion_coverage_status": "usable_exact",
            "score_basis_kind": "confirmed_negative",
        }
    if (
        evidence_status == "no_positive_evidence_after_valid_observation"
        and observation_policy == "POSITIVE_EVIDENCE_EXPECTED"
    ):
        return {
            "criterion_status": "fail",
            "criterion_score_raw": 0.0,
            "criterion_is_usable": True,
            "criterion_score_is_exact": False,
            "criterion_coverage_status": "usable_observation_evidence",
            "score_basis_kind": "no_positive_after_valid_observation",
        }
    return {
        "criterion_status": "unresolved",
        "criterion_score_raw": None,
        "criterion_is_usable": False,
        "criterion_score_is_exact": False,
        "criterion_coverage_status": "unavailable",
        "score_basis_kind": "unresolved_evidence",
    }


def aggregate_component(
    criteria: Sequence[Mapping[str, Any]],
    *,
    component_id: str,
    component_weight: float,
) -> dict[str, Any]:
    active = [row for row in criteria if float(row.get("atomic_weight") or 0) > 0]
    denominator = sum(float(row["atomic_weight"]) for row in active)
    usable = [row for row in active if row.get("criterion_is_usable")]
    usable_weight = sum(float(row["atomic_weight"]) for row in usable)
    coverage = usable_weight / denominator if denominator else None
    score = (
        sum(float(row["criterion_score_raw"]) * float(row["atomic_weight"]) for row in usable)
        / usable_weight
        if usable_weight
        else None
    )
    return {
        "component_id": component_id,
        "component_weight": float(component_weight),
        "component_status": (
            "inactive" if not active else ("scored" if score is not None else "unavailable")
        ),
        "active_criterion_count": len(active),
        "usable_criterion_count": len(usable),
        "component_coverage_raw": coverage,
        "component_score_raw": score,
        "component_score_is_exact": bool(usable)
        and all(row.get("criterion_score_is_exact") for row in usable),
    }


def aggregate_bucket(
    components: Sequence[Mapping[str, Any]],
    *,
    bucket_id: str,
    bucket_weight: float,
) -> dict[str, Any]:
    active = [
        row
        for row in components
        if float(row.get("component_weight") or 0) > 0
        and row.get("component_status") != "inactive"
    ]
    total = sum(float(row["component_weight"]) for row in active)
    coverage_numerator = sum(
        float(row["component_weight"]) * float(row.get("component_coverage_raw") or 0)
        for row in active
    )
    coverage = coverage_numerator / total if total else None
    scored = [
        row
        for row in active
        if row.get("component_score_raw") is not None
        and float(row.get("component_coverage_raw") or 0) > 0
    ]
    score_denominator = sum(
        float(row["component_weight"]) * float(row["component_coverage_raw"])
        for row in scored
    )
    score = (
        sum(
            float(row["component_score_raw"])
            * float(row["component_weight"])
            * float(row["component_coverage_raw"])
            for row in scored
        )
        / score_denominator
        if score_denominator
        else None
    )
    return {
        "bucket_id": bucket_id,
        "bucket_weight": float(bucket_weight),
        "bucket_status": (
            "inactive"
            if float(bucket_weight) <= 0
            else ("scored" if score is not None else "unavailable")
        ),
        "active_component_count": len(active),
        "scored_component_count": len(scored),
        "bucket_coverage_raw": coverage,
        "bucket_score_raw": score,
        "bucket_score_is_exact": bool(scored)
        and all(row.get("component_score_is_exact") for row in scored),
    }


def aggregate_profile(
    buckets: Sequence[Mapping[str, Any]], *, user_fit_enabled: bool = True
) -> dict[str, Any]:
    if not user_fit_enabled:
        return {
            "fit_score_raw": None,
            "profile_coverage_raw": None,
            "fit_score_is_exact": False,
            "active_bucket_count": 0,
            "scored_bucket_count": 0,
        }
    active = [row for row in buckets if float(row.get("bucket_weight") or 0) > 0]
    total = sum(float(row["bucket_weight"]) for row in active)
    coverage_numerator = sum(
        float(row["bucket_weight"]) * float(row.get("bucket_coverage_raw") or 0)
        for row in active
    )
    coverage = coverage_numerator / total if total else None
    scored = [
        row
        for row in active
        if row.get("bucket_score_raw") is not None
        and float(row.get("bucket_coverage_raw") or 0) > 0
    ]
    score_denominator = sum(
        float(row["bucket_weight"]) * float(row["bucket_coverage_raw"])
        for row in scored
    )
    score = (
        sum(
            float(row["bucket_score_raw"])
            * float(row["bucket_weight"])
            * float(row["bucket_coverage_raw"])
            for row in scored
        )
        / score_denominator
        if score_denominator
        else None
    )
    return {
        "fit_score_raw": score,
        "profile_coverage_raw": coverage,
        "fit_score_is_exact": bool(scored)
        and all(row.get("bucket_score_is_exact") for row in scored),
        "active_bucket_count": len(active),
        "scored_bucket_count": len(scored),
    }


def legacy_singleton_profile(
    criteria: Sequence[Mapping[str, Any]],
    buckets: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Re-express the current flat model as singleton components."""
    by_bucket: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for criterion in criteria:
        if (
            criterion.get("criterion_enabled")
            and criterion.get("score_enabled")
            and float(criterion.get("importance_weight") or 0) > 0
        ):
            by_bucket[str(criterion["bucket_id"])].append(criterion)
    bucket_rows: list[dict[str, Any]] = []
    for bucket in buckets:
        bucket_id = str(bucket["bucket_id"])
        active = by_bucket.get(bucket_id, [])
        if not active:
            continue
        weights = normalize_weights(
            {str(row["criterion_instance_id"]): row["importance_weight"] for row in active},
            [str(row["criterion_instance_id"]) for row in active],
            label=f"legacy/{bucket_id}",
        )
        components = [
            aggregate_component(
                [{**dict(row), "atomic_weight": 1.0}],
                component_id=str(row["criterion_instance_id"]),
                component_weight=weights[str(row["criterion_instance_id"])],
            )
            for row in active
        ]
        bucket_rows.append(
            aggregate_bucket(
                components,
                bucket_id=bucket_id,
                bucket_weight=float(bucket.get("bucket_weight") or 0),
            )
        )
    return aggregate_profile(bucket_rows)
