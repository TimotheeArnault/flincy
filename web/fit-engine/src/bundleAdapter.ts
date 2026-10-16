import { FitEngineError } from "./evaluators.js";
import type { RoutingFact, RoutingLookup } from "./spatial.js";
import type {
  AtomicInput,
  EvidenceStatus,
  FeatureInput,
  FitContract,
  JsonValue,
  O3BundleManifest,
  O3Listing,
  ObservationPolicy,
  PreparedListingFitInput,
  ResolvedAnchor,
  ResolvedBucket,
  ResolvedComponent,
  ResolvedCriterion,
  ResolvedSearchState,
} from "./types.js";

const CALCULATED_ROUTING_STATUSES = new Set([
  "calculated_point",
  "calculated_provisional_origin",
]);
const CONCLUSIVE_ROUTING_STATUSES = new Set([
  "bounded_over_contract_max",
  "route_exceeds_vehicle_contract",
  "route_unavailable_within_diagnostic_horizon",
]);
const DAILY_GROUP_BY_COMPONENT: Record<string, string> = {
  grocery: "grocery_core",
  pharmacy: "pharmacy",
  convenience: "convenience",
  medical: "medical_clinic",
};
const BASE_COMPONENT_CRITERIA: Record<string, string> = {
  rent_headroom: "rent_budget_headroom",
  metro_access: "metro_access_preference",
  parking: "parking_availability",
  laundry: "laundry_status",
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FitEngineError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new FitEngineError(`${label} must be an array`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new FitEngineError(`${label} must be a string`);
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function parsedArray(value: unknown, label: string): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? JSON.parse(value) as unknown
      : [];
  return array(raw, label).map((item) => stringValue(item, `${label} item`));
}

function parsedRecord(value: unknown): Record<string, JsonValue> {
  if (typeof value === "string") return record(JSON.parse(value) as unknown, "configuration") as Record<string, JsonValue>;
  if (value === undefined || value === null) return {};
  return record(value, "configuration") as Record<string, JsonValue>;
}

export function assertO3BundleCompatible(args: {
  manifest: O3BundleManifest;
  fitContract: FitContract;
  expectedBrowserContractHash: string;
}): void {
  if (args.manifest.bundle_schema_version !== "product_sandbox_static_bundle_v1") {
    throw new FitEngineError(`Unsupported O3 bundle schema ${args.manifest.bundle_schema_version}`);
  }
  if (args.manifest.verdict !== "PRODUCT_READ_MODEL_READY") {
    throw new FitEngineError(`O3 bundle is not ready: ${args.manifest.verdict}`);
  }
  if (args.manifest.contracts.browser_engine_input !== args.expectedBrowserContractHash) {
    throw new FitEngineError("O3 browser input contract hash mismatch");
  }
  if (args.fitContract.evaluation.contract_version !== "fit_evaluation_contract_v1") {
    throw new FitEngineError("Unsupported fit evaluation contract");
  }
  const paths = new Set(args.manifest.assets.map((asset) => asset.relative_path));
  for (const required of [
    "fit_contract.json",
    "listings.json",
    "personas.json",
    "persona_results.json",
    "postal_anchors.json",
    "spatial_refs.json",
  ]) {
    if (!paths.has(required)) throw new FitEngineError(`Required O3 asset missing: ${required}`);
  }
}

export function adaptResolvedSearchState(rawValue: unknown): ResolvedSearchState {
  const raw = record(rawValue, "resolved Search State");
  const stateId = stringValue(raw.search_state_id, "search_state_id");
  const anchors: ResolvedAnchor[] = array(raw.anchors ?? [], "anchors").map((value) => {
    const row = record(value, "anchor");
    return {
      ...row,
      search_state_id: stateId,
      criterion_instance_id: stringValue(row.criterion_instance_id, "anchor criterion"),
      anchor_role: stringValue(row.anchor_role, "anchor role") as "primary" | "secondary",
      routing_mode: stringValue(row.routing_mode, "routing mode") as "transit" | "car",
      required_for_feasibility: booleanValue(row.required_for_feasibility),
      score_enabled: booleanValue(row.score_enabled),
      target_value_numeric: Number(row.target_value_numeric),
      tolerance_kind: stringValue(row.tolerance_kind, "anchor tolerance") as "none" | "absolute" | "relative",
      tolerance_value_numeric: nullableNumber(row.tolerance_value_numeric),
      matched_destination_cell_id: nullableString(row.matched_destination_cell_id),
      routing_coverage_status: stringValue(row.routing_coverage_status, "routing coverage status"),
      resolved_anchor_hash: stringValue(row.resolved_anchor_hash, "resolved anchor hash"),
    };
  });
  const buckets: ResolvedBucket[] = array(raw.buckets, "buckets").map((value) => {
    const row = record(value, "bucket");
    return {
      ...row,
      search_state_id: stateId,
      bucket_id: stringValue(row.bucket_id, "bucket_id"),
      display_order: Number(row.display_order),
      bucket_weight: Number(row.bucket_weight),
      bucket_enabled: booleanValue(row.bucket_enabled),
      active_components: parsedArray(
        row.active_components ?? row.active_components_json,
        "active components",
      ),
    };
  });
  const components: ResolvedComponent[] = array(raw.components, "components").map((value) => {
    const row = record(value, "component");
    return {
      ...row,
      search_state_id: stateId,
      bucket_id: stringValue(row.bucket_id, "component bucket"),
      component_id: stringValue(row.component_id, "component_id"),
      component_weight: Number(row.component_weight),
      criterion_ids: parsedArray(row.criterion_ids ?? row.criterion_ids_json, "criterion IDs"),
    };
  });
  const criteria: ResolvedCriterion[] = array(raw.criteria, "criteria").map((value) => {
    const row = record(value, "criterion");
    return {
      search_state_id: stateId,
      criterion_instance_id: stringValue(row.criterion_instance_id, "criterion_instance_id"),
      criterion_definition_id: stringValue(row.criterion_definition_id, "criterion_definition_id"),
      feature_contract_id: stringValue(row.feature_contract_id, "feature_contract_id"),
      bucket_id: stringValue(row.bucket_id, "criterion bucket"),
      evaluator_kind: stringValue(row.evaluator_kind, "evaluator_kind") as ResolvedCriterion["evaluator_kind"],
      constraint_scope: stringValue(row.constraint_scope, "constraint_scope") as ResolvedCriterion["constraint_scope"],
      score_enabled: booleanValue(row.score_enabled),
      criterion_enabled: booleanValue(row.criterion_enabled),
      importance_level: stringValue(row.importance_level, "importance_level"),
      importance_weight: Number(row.importance_weight),
      target_value_numeric: nullableNumber(row.target_value_numeric),
      tolerance_kind: nullableString(row.tolerance_kind) as ResolvedCriterion["tolerance_kind"],
      tolerance_value_numeric: nullableNumber(row.tolerance_value_numeric),
      observable_limit_numeric: nullableNumber(row.observable_limit_numeric),
      score_map_id: nullableString(row.score_map_id),
      selection_mode: nullableString(row.selection_mode),
      accepted_policy: nullableString(row.accepted_policy),
      resolved_criterion_hash: stringValue(row.resolved_criterion_hash, "resolved criterion hash"),
      configuration: parsedRecord(row.configuration ?? row.configuration_json),
    };
  });
  if (anchors.length > 2) throw new FitEngineError(`${stateId}: more than two anchors`);
  return {
    ...raw,
    search_state_id: stateId,
    profile_mode: stringValue(raw.profile_mode, "profile_mode"),
    persona_id: nullableString(raw.persona_id),
    base_search_state_id: nullableString(raw.base_search_state_id) ?? stateId,
    user_fit_enabled: booleanValue(raw.user_fit_enabled),
    resolved_search_state_hash: stringValue(raw.resolved_search_state_hash, "resolved state hash"),
    preferred_metro_line_ids: parsedArray(
      raw.preferred_metro_line_ids ?? raw.preferred_metro_line_ids_json,
      "preferred metro lines",
    ),
    anchors,
    buckets,
    components,
    criteria,
  };
}

function unavailableFeature(reasonCode: string, unit: string): FeatureInput {
  return {
    value_numeric: null,
    value_category: null,
    unit,
    observation_status: reasonCode,
    precision: "unavailable",
    reason_code: reasonCode,
    conclusive_fail: false,
  };
}

function semanticFact(listing: O3Listing, key: string): Record<string, unknown> | null {
  const value = listing.fit_substrate.semantic_facts[key];
  return value ? record(value, `semantic fact ${key}`) : null;
}

function semanticValue(fact: Record<string, unknown> | null, path: string): unknown {
  let value: unknown = fact?.value;
  for (const part of path.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function typedCategory(
  listing: O3Listing,
  featureKey: string,
  path: string,
): FeatureInput {
  const fact = semanticFact(listing, featureKey);
  const value = semanticValue(fact, path);
  const text = value === null || value === undefined ? null : String(value);
  const knowledge = nullableString(fact?.knowledge_status) ?? "unknown";
  const unavailable = text === null || text === "unknown" || knowledge === "unknown";
  const ambiguous = text === "ambiguous" || knowledge === "ambiguous";
  return {
    value_numeric: null,
    value_category: text,
    unit: "category",
    observation_status: ambiguous ? "ambiguous" : unavailable ? "missing_source_value" : "observed_category",
    precision: "exact",
    reason_code: `canonical_fact_${ambiguous ? "ambiguous" : unavailable ? "unknown" : "observed"}`,
    conclusive_fail: false,
  };
}

function poiFeature(listing: O3Listing, groupId: string): FeatureInput {
  const row = listing.poi_nearest_by_group.find((item) => item.poi_group_id === groupId);
  const value = nullableNumber(row?.haversine_distance_m);
  return value === null
    ? unavailableFeature("poi_value_missing", "m")
    : {
        value_numeric: value,
        value_category: null,
        unit: "m",
        observation_status: "observed_point_value",
        precision: record(listing.geography, "geography").geo_readiness_status === "provisional"
          ? "provisional"
          : "exact",
        reason_code: "poi_distance_observed",
        conclusive_fail: false,
      };
}

function metroFeature(
  listing: O3Listing,
  criterion: ResolvedCriterion,
  state: ResolvedSearchState,
): FeatureInput {
  const metro = record(listing.fit_substrate.metro, "metro substrate");
  let selected: Record<string, unknown> | null = metro;
  if (criterion.selection_mode === "preferred_lines") {
    const preferred = new Set(state.preferred_metro_line_ids);
    const candidates = array(metro.by_line ?? [], "metro lines")
      .map((row) => record(row, "metro line"))
      .filter((row) => preferred.has(String(row.route_id)));
    const usable = candidates.filter((row) => nullableNumber(row.walk_time_minutes) !== null);
    selected = usable.sort((left, right) => {
      const numeric = Number(left.walk_time_minutes) - Number(right.walk_time_minutes);
      if (numeric) return numeric;
      const leftId = String(left.route_id);
      const rightId = String(right.route_id);
      return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
    })[0] ?? candidates[0] ?? null;
  }
  const value = nullableNumber(selected?.walk_time_minutes);
  const status = nullableString(selected?.walk_status) ?? "input_mismatch";
  const freshness = nullableString(metro.station_catalog_freshness_status) ?? "";
  const usable = freshness.startsWith("active_") && CALCULATED_ROUTING_STATUSES.has(status) && value !== null;
  return {
    value_numeric: value,
    value_category: criterion.selection_mode === "preferred_lines"
      ? nullableString(selected?.route_id)
      : null,
    unit: "minutes",
    observation_status: usable ? "observed_point_value" : status,
    precision: status.includes("provisional") ? "provisional" : "exact",
    reason_code: freshness.startsWith("active_") ? status : "station_catalog_not_active",
    conclusive_fail: false,
  };
}

function routingFeature(
  listing: O3Listing,
  anchor: ResolvedAnchor,
  lookup: RoutingLookup,
): FeatureInput {
  const commute = record(listing.fit_substrate.commute, "commute substrate");
  const locationKey = nullableString(commute.routing_location_key);
  if (!locationKey || !anchor.matched_destination_cell_id) {
    return unavailableFeature(
      anchor.matched_destination_cell_id ? "routing_origin_or_artifact_missing" : anchor.routing_coverage_status,
      "minutes",
    );
  }
  const fact = lookup(locationKey, anchor.routing_mode, anchor.matched_destination_cell_id);
  if (!fact) return unavailableFeature("routing_origin_or_artifact_missing", "minutes");
  const usable = CALCULATED_ROUTING_STATUSES.has(fact.routing_status) && fact.duration_seconds !== null;
  return {
    value_numeric: fact.duration_seconds === null ? null : fact.duration_seconds / 60,
    value_category: fact.route_pattern,
    unit: "minutes",
    observation_status: usable ? "observed_point_value" : fact.routing_status,
    precision: fact.routing_status === "calculated_point" ? "exact" : usable ? "provisional" : "unavailable",
    reason_code: fact.routing_status,
    conclusive_fail: CONCLUSIVE_ROUTING_STATUSES.has(fact.routing_status),
  };
}

function featureForCriterion(args: {
  listing: O3Listing;
  criterion: ResolvedCriterion;
  state: ResolvedSearchState;
  routingLookup: RoutingLookup;
}): FeatureInput {
  const { listing, criterion, state } = args;
  const definition = criterion.criterion_definition_id;
  if (definition === "max_budget") {
    const value = nullableNumber(listing.attributes.price.amount);
    return value === null
      ? unavailableFeature("product_price_missing", "CAD")
      : {
          value_numeric: value,
          value_category: null,
          unit: "CAD",
          observation_status: "observed_point_value",
          precision: "exact",
          reason_code: "product_price_observed",
          conclusive_fail: false,
        };
  }
  if (definition === "minimum_bedrooms") {
    const value = nullableNumber(listing.attributes.bedrooms_for_scoring);
    return value === null
      ? unavailableFeature("current_quality_bedrooms_unavailable", "count")
      : {
          value_numeric: value,
          value_category: null,
          unit: "count",
          observation_status: "observed_point_value",
          precision: "exact",
          reason_code: "current_quality_bedrooms",
          conclusive_fail: false,
        };
  }
  if (definition === "rent_budget_headroom") {
    const price = nullableNumber(listing.attributes.price.amount);
    const budget = state.criteria.find((row) => row.criterion_definition_id === "max_budget")?.target_value_numeric ?? null;
    return price === null || budget === null
      ? unavailableFeature("budget_headroom_unavailable", "CAD")
      : {
          value_numeric: budget - price,
          value_category: null,
          unit: "CAD",
          observation_status: "observed_point_value",
          precision: "exact",
          reason_code: "profile_relative_budget_headroom",
          conclusive_fail: false,
        };
  }
  if (definition === "grocery_core_max_distance") return poiFeature(listing, "grocery_core");
  if (definition === "pharmacy_max_distance") return poiFeature(listing, "pharmacy");
  if (definition === "laundry_status") return typedCategory(listing, "laundry", "fit_projection");
  if (definition === "parking_availability") return typedCategory(listing, "parking", "fit_projection");
  if (definition === "pets_requirement") return typedCategory(listing, "pets", "general_policy");
  if (definition === "metro_access_preference") return metroFeature(listing, criterion, state);
  if (definition === "anchor_commute") {
    const anchor = state.anchors.find((row) => row.criterion_instance_id === criterion.criterion_instance_id);
    if (!anchor) throw new FitEngineError(`${state.search_state_id}: missing resolved anchor ${criterion.criterion_instance_id}`);
    return routingFeature(listing, anchor, args.routingLookup);
  }
  throw new FitEngineError(`Unsupported O3 criterion definition: ${definition}`);
}

function dailyAtomic(
  listing: O3Listing,
  state: ResolvedSearchState,
  contract: FitContract,
  bucketId: string,
  componentId: string,
  criterionId: string,
): AtomicInput {
  const groupId = DAILY_GROUP_BY_COMPONENT[componentId]!;
  const row = listing.poi_nearest_by_group.find((item) => item.poi_group_id === groupId);
  const status = nullableString(row?.walk_status) ?? "input_missing";
  const seconds = nullableNumber(row?.walk_duration_s);
  const usable = CALCULATED_ROUTING_STATUSES.has(status) && seconds !== null;
  const parameters = contract.calibration.daily_walk_parameters;
  const baseId = state.base_search_state_id ?? state.search_state_id;
  const target = parameters.persona_targets_minutes[baseId]?.[groupId] ??
    parameters.default_targets_minutes[groupId];
  if (target === undefined) throw new FitEngineError(`Missing Daily WALK target ${baseId}/${groupId}`);
  return {
    kind: "numeric_feature",
    bucket_id: bucketId,
    component_id: componentId,
    criterion_id: criterionId,
    atomic_weight: 1,
    value_numeric: usable ? Number(seconds) / 60 : null,
    target_value_numeric: target,
    tolerance_kind: parameters.tolerance_kind,
    tolerance_value_numeric: parameters.tolerance_value_numeric,
    observable_limit_numeric: parameters.observable_limit_minutes,
    observation_status: usable ? "calculated_provisional" : "missing_source_value",
    precision: "provisional",
    reason_code: usable ? "walk_duration_observed" : status,
  };
}

function evidenceFor(
  listing: O3Listing,
  definition: Record<string, unknown>,
): { truth: string | null; status: EvidenceStatus } {
  const featureKey = stringValue(definition.feature_key, "evidence feature key");
  const dimensionPath = stringValue(definition.dimension_path, "evidence dimension path");
  const fact = semanticFact(listing, featureKey);
  const rawTruth = semanticValue(fact, dimensionPath);
  const truth = rawTruth === null || rawTruth === undefined ? null : String(rawTruth);
  const positive = dimensionPath === "status" ? new Set(["present", "yes", "true"]) : new Set(["yes", "present", "true"]);
  const negative = dimensionPath === "status" ? new Set(["absent", "no", "false"]) : new Set(["no", "absent", "false"]);
  if (truth !== null && positive.has(truth)) return { truth, status: "confirmed_positive" };
  if (truth !== null && negative.has(truth)) return { truth, status: "confirmed_negative" };
  if (truth === "ambiguous" || fact?.knowledge_status === "ambiguous") {
    return { truth, status: "ambiguous" };
  }
  const valid =
    typeof fact?.resolution_status === "string" &&
    fact.resolution_status.startsWith("resolved") &&
    fact.quality_status !== "invalid";
  return {
    truth: truth ?? "unknown",
    status: valid ? "no_positive_evidence_after_valid_observation" : "truly_unresolved",
  };
}

function atomicInputs(
  listing: O3Listing,
  state: ResolvedSearchState,
  contract: FitContract,
): AtomicInput[] {
  const definitions = new Map(
    contract.calibration.criterion_definitions.map((raw) => {
      const row = record(raw, "calibration criterion");
      return [stringValue(row.criterion_id, "calibration criterion ID"), row] as const;
    }),
  );
  const result: AtomicInput[] = [];
  for (const component of state.components) {
    if (component.criterion_ids.length === 1 && component.criterion_ids[0] === "anchor_commute_dynamic") {
      const anchors = state.criteria.filter(
        (criterion) =>
          criterion.criterion_definition_id === "anchor_commute" &&
          criterion.criterion_enabled &&
          criterion.score_enabled,
      );
      const weight = anchors.length > 0 ? 1 / anchors.length : 0;
      for (const anchor of anchors) {
        result.push({
          kind: "base_criterion",
          bucket_id: component.bucket_id,
          component_id: component.component_id,
          criterion_id: anchor.criterion_instance_id,
          base_criterion_id: anchor.criterion_instance_id,
          atomic_weight: weight,
        });
      }
      continue;
    }
    const baseCriterion = BASE_COMPONENT_CRITERIA[component.component_id];
    if (baseCriterion) {
      const criterion = state.criteria.find((row) => row.criterion_instance_id === baseCriterion);
      if (criterion?.criterion_enabled) {
        result.push({
          kind: "base_criterion",
          bucket_id: component.bucket_id,
          component_id: component.component_id,
          criterion_id: baseCriterion,
          base_criterion_id: baseCriterion,
          atomic_weight: 1,
        });
      }
      continue;
    }
    if (component.component_id in DAILY_GROUP_BY_COMPONENT) {
      const criterionId = component.criterion_ids[0];
      if (!criterionId) throw new FitEngineError(`${component.component_id}: missing Daily WALK criterion`);
      result.push(dailyAtomic(listing, state, contract, component.bucket_id, component.component_id, criterionId));
      continue;
    }
    const weight = component.criterion_ids.length > 0 ? 1 / component.criterion_ids.length : 0;
    for (const criterionId of component.criterion_ids) {
      const definition = definitions.get(criterionId);
      if (!definition) throw new FitEngineError(`Unknown component criterion ${criterionId}`);
      const evidence = evidenceFor(listing, definition);
      result.push({
        kind: "semantic_evidence",
        bucket_id: component.bucket_id,
        component_id: component.component_id,
        criterion_id: criterionId,
        atomic_weight: weight,
        observation_policy: stringValue(
          definition.observation_policy,
          "observation policy",
        ) as ObservationPolicy,
        semantic_truth_value: evidence.truth,
        evidence_status: evidence.status,
      } as AtomicInput);
    }
  }
  return result;
}

export function prepareListingFromO3(args: {
  listing: O3Listing;
  searchState: ResolvedSearchState;
  fitContract: FitContract;
  routingLookup: RoutingLookup;
}): PreparedListingFitInput {
  const baseFeatures: Record<string, FeatureInput> = {};
  for (const criterion of args.searchState.criteria) {
    baseFeatures[criterion.criterion_instance_id] = featureForCriterion({
      listing: args.listing,
      criterion,
      state: args.searchState,
      routingLookup: args.routingLookup,
    });
  }
  return {
    listing_uid: args.listing.listing_uid,
    source_platform: args.listing.source.platform,
    product_universe_eligible: true,
    product_universe_reason: "standard_available_supported_market",
    product_universe_band: "main_product_universe",
    objective_rank: args.listing.objective?.objective_rank ?? null,
    base_features: baseFeatures,
    atomic_inputs: atomicInputs(args.listing, args.searchState, args.fitContract),
  };
}

export function routingFeatureFromFact(fact: RoutingFact): FeatureInput {
  const usable = CALCULATED_ROUTING_STATUSES.has(fact.routing_status) && fact.duration_seconds !== null;
  return {
    value_numeric: fact.duration_seconds === null ? null : fact.duration_seconds / 60,
    value_category: fact.route_pattern,
    unit: "minutes",
    observation_status: usable ? "observed_point_value" : fact.routing_status,
    precision: usable ? "provisional" : "unavailable",
    reason_code: fact.routing_status,
    conclusive_fail: CONCLUSIVE_ROUTING_STATUSES.has(fact.routing_status),
  };
}
