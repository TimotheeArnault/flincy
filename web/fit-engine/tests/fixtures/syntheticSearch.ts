import type {
  EvidenceStatus,
  FeatureInput,
  FitContract,
  PreparedListingFitInput,
  ResolvedCriterion,
  ResolvedSearchState,
} from "../../src/types.js";

const stateId = "synthetic-search-v1";

const contract: FitContract = {
  schema_version: "synthetic-fit-contract-v1",
  profile_catalog: {
    categorical_score_maps: {},
    pets_requirement_policy: {
      accepted: ["allowed"],
      prohibited: ["not_allowed"],
      unresolved: [null, "unknown", "ambiguous", "limited"],
    },
  },
  calibration: {
    criterion_definitions: [
      { criterion_definition_id: "budget_max", evaluator_kind: "numeric_max" },
      { criterion_definition_id: "anchor_commute", evaluator_kind: "distance_max" },
    ],
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
};

const criteria: ResolvedCriterion[] = [
  {
    search_state_id: stateId,
    criterion_instance_id: "budget_limit",
    criterion_definition_id: "budget_max",
    feature_contract_id: "synthetic_price",
    bucket_id: "financial_flexibility",
    evaluator_kind: "numeric_max",
    constraint_scope: "listing_eligibility",
    score_enabled: false,
    criterion_enabled: true,
    importance_level: "disabled",
    importance_weight: 0,
    target_value_numeric: 1800,
    tolerance_kind: "absolute",
    tolerance_value_numeric: 100,
    observable_limit_numeric: null,
    score_map_id: null,
    selection_mode: null,
    accepted_policy: null,
    resolved_criterion_hash: "synthetic-budget-v1",
  },
  {
    search_state_id: stateId,
    criterion_instance_id: "primary_commute",
    criterion_definition_id: "anchor_commute",
    feature_contract_id: "synthetic_prepared_commute",
    bucket_id: "anchor_mobility",
    evaluator_kind: "distance_max",
    constraint_scope: "search_feasibility",
    score_enabled: false,
    criterion_enabled: true,
    importance_level: "disabled",
    importance_weight: 0,
    target_value_numeric: 35,
    tolerance_kind: "absolute",
    tolerance_value_numeric: 10,
    observable_limit_numeric: 90,
    score_map_id: null,
    selection_mode: null,
    accepted_policy: null,
    resolved_criterion_hash: "synthetic-commute-v1",
  },
];

const searchState: ResolvedSearchState = {
  search_state_id: stateId,
  profile_mode: "custom",
  persona_id: null,
  base_search_state_id: null,
  user_fit_enabled: true,
  resolved_search_state_hash: "synthetic-resolved-state-v1",
  preferred_metro_line_ids: [],
  anchors: [{
    search_state_id: stateId,
    criterion_instance_id: "primary_commute",
    anchor_role: "primary",
    routing_mode: "transit",
    required_for_feasibility: true,
    score_enabled: false,
    target_value_numeric: 35,
    tolerance_kind: "absolute",
    tolerance_value_numeric: 10,
    matched_destination_cell_id: "synthetic-destination-cell",
    routing_coverage_status: "synthetic_prepared_fact",
    resolved_anchor_hash: "synthetic-anchor-v1",
  }],
  criteria,
  buckets: [
    {
      search_state_id: stateId, bucket_id: "financial_flexibility",
      display_order: 1, bucket_weight: 0, bucket_enabled: false, active_components: [],
    },
    {
      search_state_id: stateId, bucket_id: "anchor_mobility",
      display_order: 2, bucket_weight: 0, bucket_enabled: false, active_components: [],
    },
    {
      search_state_id: stateId, bucket_id: "housing_comfort",
      display_order: 3, bucket_weight: 1, bucket_enabled: true,
      active_components: ["laundry", "dishwasher"],
    },
  ],
  components: ["laundry", "dishwasher"].map((id) => ({
    search_state_id: stateId,
    bucket_id: "housing_comfort",
    component_id: id,
    component_weight: 0.5,
    criterion_ids: [id + "_preference"],
  })),
};

function point(value: number | null, unit: string): FeatureInput {
  return {
    value_numeric: value,
    value_category: null,
    unit,
    observation_status: value === null ? "missing_source_value" : "observed_point_value",
    precision: value === null ? "unavailable" : "exact",
    reason_code: value === null ? "synthetic_commute_missing" : "synthetic_prepared_fact",
  };
}

// Invented prepared facts only. No coordinates, source records or routing calls.
function listing(
  suffix: string,
  price: number,
  commute: number | null,
  dishwasher: EvidenceStatus,
): PreparedListingFitInput {
  return {
    listing_uid: "synthetic:" + suffix,
    source_platform: "synthetic",
    product_universe_eligible: true,
    product_universe_reason: "synthetic_eligible",
    product_universe_band: "main_product_universe",
    objective_rank: null,
    base_features: {
      budget_limit: point(price, "CAD"),
      primary_commute: point(commute, "minutes"),
    },
    // Hard-only base criteria deliberately have NO scoring atomic.
    atomic_inputs: [
      {
        kind: "semantic_evidence", bucket_id: "housing_comfort",
        component_id: "laundry", criterion_id: "laundry_preference",
        atomic_weight: 1, observation_policy: "EXPLICIT_STATE",
        semantic_truth_value: "present", evidence_status: "confirmed_positive",
      },
      {
        kind: "semantic_evidence", bucket_id: "housing_comfort",
        component_id: "dishwasher", criterion_id: "dishwasher_preference",
        atomic_weight: 1, observation_policy: "EXPLICIT_STATE",
        semantic_truth_value: dishwasher === "confirmed_positive"
          ? "present" : dishwasher === "confirmed_negative" ? "absent" : "unknown",
        evidence_status: dishwasher,
      },
    ],
  };
}

export const syntheticSearch: {
  listings: PreparedListingFitInput[];
  searchState: ResolvedSearchState;
  contract: FitContract;
} = {
  listings: [
    listing("A", 1700, 30, "confirmed_negative"),
    listing("B", 1700, 30, "truly_unresolved"),
    listing("C", 1850, 30, "confirmed_positive"),
    listing("D", 1700, 60, "confirmed_positive"),
    listing("E", 1700, null, "confirmed_positive"),
  ],
  searchState,
  contract,
};
