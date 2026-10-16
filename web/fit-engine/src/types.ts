export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

export type EvaluatorKind =
  | "numeric_max"
  | "numeric_min"
  | "distance_max"
  | "categorical_value";
export type ConstraintScope =
  | "none"
  | "search_feasibility"
  | "listing_eligibility";
export type ObservationPolicy =
  | "TRUE_UNKNOWN"
  | "POSITIVE_EVIDENCE_EXPECTED"
  | "EXPLICIT_STATE";
export type EvidenceStatus =
  | "confirmed_positive"
  | "confirmed_negative"
  | "no_positive_evidence_after_valid_observation"
  | "truly_unresolved"
  | "ambiguous";

export interface FeatureInput {
  value_numeric: number | null;
  value_category: string | null;
  unit?: string | null;
  observation_status: string;
  precision: string;
  reason_code: string;
  conclusive_fail?: boolean;
}

export interface ResolvedCriterion {
  search_state_id: string;
  criterion_instance_id: string;
  criterion_definition_id: string;
  feature_contract_id: string;
  bucket_id: string;
  evaluator_kind: EvaluatorKind;
  constraint_scope: ConstraintScope;
  score_enabled: boolean;
  criterion_enabled: boolean;
  importance_level: string;
  importance_weight: number;
  target_value_numeric: number | null;
  tolerance_kind: "none" | "absolute" | "relative" | null;
  tolerance_value_numeric: number | null;
  observable_limit_numeric: number | null;
  score_map_id: string | null;
  selection_mode: string | null;
  accepted_policy: string | null;
  resolved_criterion_hash: string;
  configuration?: Record<string, JsonValue>;
}

export interface ResolvedAnchor {
  search_state_id: string;
  criterion_instance_id: string;
  anchor_role: "primary" | "secondary";
  routing_mode: "transit" | "car";
  required_for_feasibility: boolean;
  score_enabled: boolean;
  target_value_numeric: number;
  tolerance_kind: "none" | "absolute" | "relative";
  tolerance_value_numeric: number | null;
  matched_destination_cell_id: string | null;
  routing_coverage_status: string;
  resolved_anchor_hash: string;
  [key: string]: unknown;
}

export interface ResolvedBucket {
  search_state_id: string;
  bucket_id: string;
  display_order: number;
  bucket_weight: number;
  bucket_enabled: boolean;
  active_components: string[];
  [key: string]: unknown;
}

export interface ResolvedComponent {
  search_state_id: string;
  bucket_id: string;
  component_id: string;
  component_weight: number;
  criterion_ids: string[];
  [key: string]: unknown;
}

export interface ResolvedSearchState {
  search_state_id: string;
  profile_mode: string;
  persona_id: string | null;
  base_search_state_id: string | null;
  user_fit_enabled: boolean;
  resolved_search_state_hash: string;
  preferred_metro_line_ids: string[];
  anchors: ResolvedAnchor[];
  buckets: ResolvedBucket[];
  components: ResolvedComponent[];
  criteria: ResolvedCriterion[];
  [key: string]: unknown;
}

export interface BaseCriterionAtomicInput {
  kind: "base_criterion";
  base_criterion_id: string;
  atomic_weight: number;
}

export interface NumericAtomicInput {
  kind: "numeric_feature";
  atomic_weight: number;
  value_numeric: number | null;
  target_value_numeric: number;
  tolerance_kind: "none" | "absolute" | "relative";
  tolerance_value_numeric: number | null;
  observable_limit_numeric: number;
  observation_status: string;
  precision: string;
  reason_code: string;
}

export interface EvidenceAtomicInput {
  kind: "semantic_evidence";
  atomic_weight: number;
  observation_policy: ObservationPolicy;
  semantic_truth_value: string | null;
  evidence_status: EvidenceStatus;
}

export type AtomicInput = (
  | BaseCriterionAtomicInput
  | NumericAtomicInput
  | EvidenceAtomicInput
) & {
  bucket_id: string;
  component_id: string;
  criterion_id: string;
};

export interface PreparedListingFitInput {
  listing_uid: string;
  source_platform: string;
  product_universe_eligible: boolean;
  product_universe_reason: string;
  product_universe_band: "main_product_universe" | "report_only";
  objective_rank: number | null;
  base_features: Record<string, FeatureInput>;
  atomic_inputs: AtomicInput[];
}

export interface CriterionEvaluation {
  criterion_status: string;
  criterion_score_raw: number | null;
  criterion_score: number | null;
  criterion_is_usable: boolean;
  criterion_score_is_exact: boolean;
  criterion_coverage_status: string;
  score_basis_kind: string;
  score_basis_value_numeric?: number | null;
  score_basis_value_category?: string | null;
  effective_tolerance_limit_numeric?: number | null;
  reason_code: string;
}

export interface EvaluatedCriterion extends CriterionEvaluation {
  listing_uid: string;
  source_platform: string;
  search_state_id: string;
  bucket_id: string;
  component_id?: string;
  criterion_id: string;
  criterion_instance_id?: string;
  criterion_definition_id?: string;
  constraint_scope?: ConstraintScope;
  criterion_enabled?: boolean;
  score_enabled?: boolean;
  importance_weight?: number;
  atomic_weight: number;
  observation_policy?: ObservationPolicy;
  semantic_truth_value?: string | null;
  evidence_status?: string;
}

export interface ComponentScore {
  listing_uid: string;
  source_platform: string;
  search_state_id: string;
  bucket_id: string;
  component_id: string;
  component_weight: number;
  component_status: string;
  active_criterion_count: number;
  usable_criterion_count: number;
  component_coverage_raw: number | null;
  component_score_raw: number | null;
  component_score_is_exact: boolean;
  configured_component_weight?: number;
}

export interface BucketScore {
  listing_uid: string;
  source_platform: string;
  search_state_id: string;
  bucket_id: string;
  bucket_weight: number;
  bucket_status: string;
  active_component_count: number;
  scored_component_count: number;
  bucket_coverage_raw: number | null;
  bucket_coverage?: number | null;
  bucket_score_raw: number | null;
  bucket_score?: number | null;
  bucket_score_is_exact: boolean;
  configured_bucket_weight?: number;
}

export interface ProfileScore {
  fit_score_raw: number | null;
  fit_score: number | null;
  profile_coverage_raw: number | null;
  profile_coverage: number | null;
  fit_score_is_exact: boolean;
  active_bucket_count: number;
  scored_bucket_count: number;
}

export interface FitEvaluationResult extends ProfileScore {
  listing_uid: string;
  source_platform: string;
  search_state_id: string;
  persona_id: string | null;
  profile_mode: string;
  user_fit_enabled: boolean;
  resolved_search_state_hash: string;
  product_universe_band: "main_product_universe" | "report_only";
  feasibility_status: string;
  feasibility_reason_code: string;
  listing_eligibility_status: string;
  listing_eligibility_reason_code: string;
  fit_status: string;
  coverage_class: string;
  primary_commute_minutes: number | null;
  primary_commute_status: string | null;
  secondary_commute_minutes: number | null;
  secondary_commute_status: string | null;
  problem_criterion_ids: string[];
  objective_rank: number | null;
  public_persona?: boolean;
  base_criterion_outputs: EvaluatedCriterion[];
  criterion_outputs: EvaluatedCriterion[];
  component_outputs: ComponentScore[];
  bucket_outputs: BucketScore[];
  explanation: ExplanationOutput;
  canonical_rank?: number | null;
  semantic_tie_rank?: number;
  is_default_main_result?: boolean;
  result_section?: string;
}

export interface ExplanationPartition {
  allocated_budget_points: number;
  evaluable_budget_points: number;
  earned_points: number;
  missed_points: number;
  unknown_points: number;
  coverage: number;
  match_rate: number | null;
}

export interface ExplanationOutput {
  criteria: Array<Record<string, unknown> & ExplanationPartition>;
  components: Array<Record<string, unknown> & ExplanationPartition>;
  buckets: Array<Record<string, unknown> & ExplanationPartition>;
  profile: Record<string, unknown> & {
    total_allocated_budget_points: number;
    total_evaluable_budget_points: number;
    total_earned_points: number;
    total_missed_points: number;
    total_unknown_points: number;
    reconciliation_valid: boolean;
  };
}

export interface FitContract {
  schema_version: string;
  profile_catalog: {
    categorical_score_maps: Record<string, Record<string, number>>;
    pets_requirement_policy: {
      accepted: string[];
      prohibited: string[];
      unresolved: Array<string | null>;
    };
  };
  calibration: {
    criterion_definitions: Array<Record<string, unknown>>;
    daily_walk_parameters: {
      default_targets_minutes: Record<string, number>;
      persona_targets_minutes: Record<string, Record<string, number>>;
      tolerance_kind: "relative";
      tolerance_value_numeric: number;
      observable_limit_minutes: number;
    };
  };
  evaluation: {
    contract_version: string;
    routing_policy: {
      main_contract_max_minutes: number;
      diagnostic_max_minutes: number;
      bounded_over_contract_max_is_conclusive_fail: boolean;
      large_snap_is_unresolved: boolean;
      missing_or_input_mismatch_is_unresolved: boolean;
    };
    rounding: {
      decimal_places: number;
      mode: string;
    };
  };
  browser_engine_contract?: Record<string, JsonValue>;
  [key: string]: unknown;
}

export interface PostalAnchorRecord {
  postal_code: string;
  resolved_latitude: number;
  resolved_longitude: number;
  resolution_status: string;
  market_status: string;
  routing_coverage_status: string;
  routing_coverage_reason: string;
  matched_grid_contract_id: string;
  matched_destination_cell_id: string | null;
  grid_match_distance_m: number | null;
  resolver_version: string;
  postal_reference_version: string;
}

export interface PostalAnchorCatalog {
  schema_version: string;
  postal_anchors: PostalAnchorRecord[];
  [key: string]: unknown;
}

export interface PostalLookupResult {
  input: string | null;
  normalized_postal_code: string | null;
  lookup_status: "resolved" | "unknown" | "invalid" | "empty";
  anchor: PostalAnchorRecord | null;
  engine_anchor_available: boolean;
}

export interface O3ManifestAsset {
  relative_path: string;
  sha256: string;
  size_bytes: number;
  item_count?: number;
}

export interface O3BundleManifest {
  bundle_schema_version: string;
  bundle_id: string;
  snapshot_id: string;
  source_snapshot_id: string;
  contracts: Record<string, string>;
  assets: O3ManifestAsset[];
  counts: Record<string, number>;
  verdict: string;
  [key: string]: unknown;
}

export interface O3PersonaDocument {
  schema_version: string;
  personas: Array<Record<string, unknown>>;
}

export interface O3Listing {
  listing_uid: string;
  source: { platform: string; listing_url?: string };
  attributes: {
    price: { amount: number | null; currency: string };
    bedrooms_for_scoring: number | null;
    [key: string]: unknown;
  };
  fit_substrate: {
    commute: Record<string, unknown>;
    metro: Record<string, unknown>;
    semantic_facts: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  poi_nearest_by_group: Array<Record<string, unknown>>;
  objective: { objective_rank: number | null; [key: string]: unknown } | null;
  [key: string]: unknown;
}

export interface O3ListingDocument {
  schema_version: string;
  listings: O3Listing[];
}

export interface O3SpatialAsset {
  asset_kind: string;
  relative_path: string;
  sha256: string;
  routing_mode: string | null;
  direction: string | null;
  anchor_id: string | null;
  [key: string]: unknown;
}

export interface O3SpatialRefs {
  schema_version: string;
  static_asset_base: string;
  common_grid: O3SpatialAsset;
  routing_shards: O3SpatialAsset[];
  listing_routing_locations: Array<Record<string, unknown>>;
  runtime_routing: boolean;
  [key: string]: unknown;
}
