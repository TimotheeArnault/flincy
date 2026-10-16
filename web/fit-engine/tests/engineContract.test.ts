import assert from "node:assert/strict";
import test from "node:test";

import { cloneResolvedSearchState, evaluateListing } from "../src/engine.js";
import type {
  FitContract,
  PreparedListingFitInput,
  ResolvedSearchState,
} from "../src/types.js";

const contract = {
  schema_version: "fixture",
  profile_catalog: {
    categorical_score_maps: {},
    pets_requirement_policy: { accepted: ["allowed"], prohibited: ["not_allowed"], unresolved: [null] },
  },
  calibration: {
    criterion_definitions: [],
    daily_walk_parameters: {
      default_targets_minutes: {},
      persona_targets_minutes: {},
      tolerance_kind: "relative",
      tolerance_value_numeric: 0.2,
      observable_limit_minutes: 60,
    },
  },
  evaluation: {
    contract_version: "fit_evaluation_contract_v1",
    routing_policy: {
      main_contract_max_minutes: 90,
      diagnostic_max_minutes: 180,
      bounded_over_contract_max_is_conclusive_fail: true,
      large_snap_is_unresolved: true,
      missing_or_input_mismatch_is_unresolved: true,
    },
    rounding: { decimal_places: 2, mode: "ROUND_HALF_UP" },
  },
} as FitContract;

function buildingState(active: boolean): ResolvedSearchState {
  const components = ["building_gym", "elevator", "pool"];
  return {
    search_state_id: active ? "building-active" : "building-default",
    profile_mode: "custom",
    persona_id: null,
    base_search_state_id: null,
    user_fit_enabled: active,
    resolved_search_state_hash: active ? "active" : "default",
    preferred_metro_line_ids: [],
    anchors: [],
    criteria: [],
    buckets: [{
      search_state_id: "state",
      bucket_id: "building_features",
      display_order: 1,
      bucket_weight: active ? 1 : 0,
      bucket_enabled: active,
      active_components: active ? components : [],
    }],
    components: components.map((componentId) => ({
      search_state_id: "state",
      bucket_id: "building_features",
      component_id: componentId,
      component_weight: active ? 1 / 3 : 0,
      criterion_ids: [`${componentId}_preference`],
    })),
  };
}

function buildingListing(): PreparedListingFitInput {
  return {
    listing_uid: "listing",
    source_platform: "fixture",
    product_universe_eligible: true,
    product_universe_reason: "eligible",
    product_universe_band: "main_product_universe",
    objective_rank: null,
    base_features: {},
    atomic_inputs: [
      ["building_gym", "confirmed_positive", "present"],
      ["elevator", "confirmed_negative", "absent"],
      ["pool", "truly_unresolved", "unknown"],
    ].map(([componentId, evidenceStatus, truth]) => ({
      kind: "semantic_evidence" as const,
      bucket_id: "building_features",
      component_id: componentId!,
      criterion_id: `${componentId}_preference`,
      atomic_weight: 1,
      observation_policy: "POSITIVE_EVIDENCE_EXPECTED" as const,
      semantic_truth_value: truth!,
      evidence_status: evidenceStatus as "confirmed_positive" | "confirmed_negative" | "truly_unresolved",
    })),
  };
}

test("Building Features is inactive by default and allocates no hidden budget", () => {
  const state = buildingState(false);
  const result = evaluateListing({ listing: buildingListing(), searchState: state, contract });
  assert.equal(result.fit_score, null);
  assert.equal(result.profile_coverage_raw, null);
  assert.equal(result.explanation.profile.total_allocated_budget_points, 0);
  assert.deepEqual(state.buckets[0]?.active_components, []);
});

test("selected Building Features participate while storage locker stays deferred", () => {
  const state = buildingState(true);
  const result = evaluateListing({ listing: buildingListing(), searchState: state, contract });
  assert.equal(result.profile_coverage_raw, 2 / 3);
  assert.equal(result.fit_score, 50);
  assert.equal(result.explanation.profile.total_allocated_budget_points, 100);
  assert.equal(result.criterion_outputs.some((row) => row.criterion_id.includes("storage_locker")), false);
});

test("Search State cloning is deep and does not mutate persona sources", () => {
  const source = buildingState(true);
  const clone = cloneResolvedSearchState(source);
  clone.buckets[0]!.bucket_weight = 0.5;
  clone.components[0]!.component_weight = 0.8;
  assert.equal(source.buckets[0]!.bucket_weight, 1);
  assert.equal(source.components[0]!.component_weight, 1 / 3);
});
