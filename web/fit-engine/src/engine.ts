import {
  evaluateCategorical,
  evaluateEvidence,
  evaluateNumeric,
  FitEngineError,
  inactiveEvaluation,
} from "./evaluators.js";
import { explainResult } from "./explanation.js";
import { coverageClass, rankSearchResults } from "./ranking.js";
import { aggregateBucket, aggregateComponent, aggregateProfile } from "./scoring.js";
import type {
  AtomicInput,
  CriterionEvaluation,
  EvaluatedCriterion,
  FitContract,
  FitEvaluationResult,
  PreparedListingFitInput,
  ResolvedCriterion,
  ResolvedSearchState,
} from "./types.js";

export const BROWSER_FIT_ENGINE_VERSION = "ms_0_16_o4_browser_fit_engine_ts_v1";

function evaluateBaseCriterion(
  criterion: ResolvedCriterion,
  listing: PreparedListingFitInput,
  state: ResolvedSearchState,
  contract: FitContract,
): EvaluatedCriterion {
  let evaluation: CriterionEvaluation;
  if (!criterion.criterion_enabled) {
    evaluation = inactiveEvaluation();
  } else {
    const feature = listing.base_features[criterion.criterion_instance_id];
    if (!feature) {
      throw new FitEngineError(
        `${listing.listing_uid}/${state.search_state_id}: missing base input ${criterion.criterion_instance_id}`,
      );
    }
    if (criterion.evaluator_kind === "categorical_value") {
      if (criterion.criterion_definition_id === "pets_requirement") {
        const policy = contract.profile_catalog.pets_requirement_policy;
        evaluation = evaluateCategorical({
          feature,
          acceptedValues: policy.accepted,
          prohibitedValues: policy.prohibited,
          unresolvedValues: policy.unresolved,
        });
      } else {
        const scoreMap = criterion.score_map_id
          ? contract.profile_catalog.categorical_score_maps[criterion.score_map_id]
          : undefined;
        if (!scoreMap) {
          throw new FitEngineError(
            `${listing.listing_uid}/${state.search_state_id}: unknown score map ${criterion.score_map_id}`,
          );
        }
        evaluation = evaluateCategorical({ feature, scoreMap });
      }
    } else {
      if (criterion.target_value_numeric === null) {
        throw new FitEngineError(
          `${listing.listing_uid}/${state.search_state_id}: numeric target missing for ${criterion.criterion_instance_id}`,
        );
      }
      const observableLimit = criterion.criterion_definition_id === "anchor_commute"
        ? contract.evaluation.routing_policy.main_contract_max_minutes
        : criterion.observable_limit_numeric;
      evaluation = evaluateNumeric({
        evaluatorKind: criterion.evaluator_kind,
        feature,
        target: criterion.target_value_numeric,
        toleranceKind: criterion.tolerance_kind ?? "none",
        toleranceValue: criterion.tolerance_value_numeric,
        observableLimit,
      });
    }
  }
  return {
    listing_uid: listing.listing_uid,
    source_platform: listing.source_platform,
    search_state_id: state.search_state_id,
    bucket_id: criterion.bucket_id,
    criterion_id: criterion.criterion_instance_id,
    criterion_instance_id: criterion.criterion_instance_id,
    criterion_definition_id: criterion.criterion_definition_id,
    constraint_scope: criterion.constraint_scope,
    criterion_enabled: criterion.criterion_enabled,
    score_enabled: criterion.score_enabled,
    importance_weight: criterion.importance_weight,
    atomic_weight: 1,
    ...evaluation,
  };
}

function aggregateFeasibility(criteria: readonly EvaluatedCriterion[]): {
  status: string;
  reason: string;
} {
  const required = criteria.filter((row) => row.constraint_scope === "search_feasibility");
  if (required.length === 0) return { status: "feasible", reason: "no_required_anchor" };
  if (required.some((row) => row.criterion_status === "fail")) {
    return { status: "not_feasible", reason: "required_anchor_failed" };
  }
  if (required.some((row) => row.criterion_status === "unresolved")) {
    return { status: "unresolved", reason: "required_anchor_unresolved" };
  }
  if (required.some((row) => row.criterion_status === "near_miss")) {
    return { status: "feasibility_near_miss", reason: "required_anchor_near_miss" };
  }
  return { status: "feasible", reason: "all_required_anchors_strict_match" };
}

function aggregateEligibility(
  criteria: readonly EvaluatedCriterion[],
  listing: PreparedListingFitInput,
): { status: string; reason: string } {
  const hard = criteria.filter((row) => row.constraint_scope === "listing_eligibility");
  if (!listing.product_universe_eligible) {
    return { status: "not_eligible", reason: listing.product_universe_reason };
  }
  if (hard.some((row) => row.criterion_status === "fail")) {
    return { status: "not_eligible", reason: "listing_constraint_failed" };
  }
  if (hard.some((row) => row.criterion_status === "unresolved")) {
    return { status: "unresolved", reason: "listing_constraint_unresolved" };
  }
  if (hard.some((row) => row.criterion_status === "near_miss")) {
    return { status: "near_miss", reason: "listing_constraint_near_miss" };
  }
  return { status: "eligible", reason: "all_listing_constraints_satisfied" };
}

function evaluateAtomic(
  input: AtomicInput,
  baseById: ReadonlyMap<string, EvaluatedCriterion>,
  listing: PreparedListingFitInput,
  state: ResolvedSearchState,
): EvaluatedCriterion {
  let evaluation: CriterionEvaluation;
  if (input.kind === "base_criterion") {
    const base = baseById.get(input.base_criterion_id);
    if (!base) {
      throw new FitEngineError(
        `${listing.listing_uid}/${state.search_state_id}: missing base criterion ${input.base_criterion_id}`,
      );
    }
    evaluation = {
      criterion_status: base.criterion_status,
      criterion_score_raw: base.criterion_score_raw,
      criterion_score: base.criterion_score,
      criterion_is_usable: base.criterion_is_usable,
      criterion_score_is_exact: base.criterion_score_is_exact,
      criterion_coverage_status: base.criterion_coverage_status,
      score_basis_kind: base.score_basis_kind,
      score_basis_value_numeric: base.score_basis_value_numeric,
      score_basis_value_category: base.score_basis_value_category,
      effective_tolerance_limit_numeric: base.effective_tolerance_limit_numeric,
      reason_code: base.score_basis_kind,
    };
  } else if (input.kind === "numeric_feature") {
    evaluation = evaluateNumeric({
      evaluatorKind: "distance_max",
      feature: {
        value_numeric: input.value_numeric,
        value_category: null,
        observation_status: input.observation_status,
        precision: input.precision,
        reason_code: input.reason_code,
      },
      target: input.target_value_numeric,
      toleranceKind: input.tolerance_kind,
      toleranceValue: input.tolerance_value_numeric,
      observableLimit: input.observable_limit_numeric,
    });
  } else {
    evaluation = evaluateEvidence(input.evidence_status, input.observation_policy);
  }
  return {
    listing_uid: listing.listing_uid,
    source_platform: listing.source_platform,
    search_state_id: state.search_state_id,
    bucket_id: input.bucket_id,
    component_id: input.component_id,
    criterion_id: input.criterion_id,
    atomic_weight: input.atomic_weight,
    observation_policy: input.kind === "semantic_evidence" ? input.observation_policy : undefined,
    semantic_truth_value: input.kind === "semantic_evidence" ? input.semantic_truth_value : null,
    evidence_status:
      input.kind === "semantic_evidence"
        ? input.evidence_status
        : input.kind === "numeric_feature"
          ? input.reason_code
          : listing.base_features[input.base_criterion_id]?.observation_status,
    ...evaluation,
  };
}

function commuteSummary(
  state: ResolvedSearchState,
  listing: PreparedListingFitInput,
  baseById: ReadonlyMap<string, EvaluatedCriterion>,
  role: "primary" | "secondary",
): { minutes: number | null; status: string | null } {
  const anchor = state.anchors.find((row) => row.anchor_role === role);
  if (!anchor) return { minutes: null, status: null };
  return {
    minutes: listing.base_features[anchor.criterion_instance_id]?.value_numeric ?? null,
    status: baseById.get(anchor.criterion_instance_id)?.criterion_status ?? null,
  };
}

export function evaluateListing(args: {
  listing: PreparedListingFitInput;
  searchState: ResolvedSearchState;
  contract: FitContract;
}): FitEvaluationResult {
  const { listing, searchState: state, contract } = args;
  const baseCriteria = state.criteria.map((criterion) =>
    evaluateBaseCriterion(criterion, listing, state, contract)
  );
  const baseById = new Map(baseCriteria.map((row) => [row.criterion_id, row]));
  const feasibility = aggregateFeasibility(baseCriteria);
  const eligibility = aggregateEligibility(baseCriteria, listing);
  const atomics = listing.atomic_inputs.map((input) =>
    evaluateAtomic(input, baseById, listing, state)
  );
  const components = state.components.map((component) =>
    aggregateComponent({
      listingUid: listing.listing_uid,
      sourcePlatform: listing.source_platform,
      searchStateId: state.search_state_id,
      bucketId: component.bucket_id,
      componentId: component.component_id,
      componentWeight: component.component_weight,
      criteria: atomics.filter(
        (row) => row.bucket_id === component.bucket_id && row.component_id === component.component_id,
      ),
    })
  );
  const buckets = state.buckets.map((bucket) =>
    aggregateBucket({
      listingUid: listing.listing_uid,
      sourcePlatform: listing.source_platform,
      searchStateId: state.search_state_id,
      bucketId: bucket.bucket_id,
      bucketWeight: bucket.bucket_weight,
      components: components.filter((row) => row.bucket_id === bucket.bucket_id),
    })
  );
  const profile = aggregateProfile(buckets, state.user_fit_enabled);
  const primary = commuteSummary(state, listing, baseById, "primary");
  const secondary = commuteSummary(state, listing, baseById, "secondary");
  const problemCriterionIds = [...new Set(
    atomics
      .filter((row) => ["fail", "unresolved", "near_miss"].includes(row.criterion_status))
      .map((row) => row.criterion_id),
  )].sort();
  const fitStatus = state.user_fit_enabled ? eligibility.status : "disabled";
  const resultWithoutExplanation = {
    listing_uid: listing.listing_uid,
    source_platform: listing.source_platform,
    search_state_id: state.search_state_id,
    persona_id: state.persona_id,
    profile_mode: state.profile_mode,
    user_fit_enabled: state.user_fit_enabled,
    public_persona: state.profile_mode === "persona",
    resolved_search_state_hash: state.resolved_search_state_hash,
    product_universe_band: listing.product_universe_band,
    feasibility_status: feasibility.status,
    feasibility_reason_code: feasibility.reason,
    listing_eligibility_status: eligibility.status,
    listing_eligibility_reason_code: eligibility.reason,
    fit_status: fitStatus,
    coverage_class: coverageClass(profile.profile_coverage_raw, profile.fit_score),
    primary_commute_minutes: primary.minutes,
    primary_commute_status: primary.status,
    secondary_commute_minutes: secondary.minutes,
    secondary_commute_status: secondary.status,
    problem_criterion_ids: problemCriterionIds,
    objective_rank: listing.objective_rank,
    base_criterion_outputs: baseCriteria,
    criterion_outputs: atomics,
    component_outputs: components,
    bucket_outputs: buckets,
    ...profile,
  };
  const explanation = explainResult({
    listingUid: listing.listing_uid,
    sourcePlatform: listing.source_platform,
    searchStateId: state.search_state_id,
    productUniverseBand: listing.product_universe_band,
    feasibilityStatus: feasibility.status,
    listingEligibilityStatus: eligibility.status,
    userFitEnabled: state.user_fit_enabled,
    fitScoreRaw: profile.fit_score_raw,
    profileCoverageRaw: profile.profile_coverage_raw,
    criteria: atomics,
    components,
    buckets,
  });
  return { ...resultWithoutExplanation, explanation };
}

export function evaluateAndRank(args: {
  listings: readonly PreparedListingFitInput[];
  searchState: ResolvedSearchState;
  contract: FitContract;
}): FitEvaluationResult[] {
  return rankSearchResults(
    args.listings.map((listing) =>
      evaluateListing({ listing, searchState: args.searchState, contract: args.contract })
    ),
  );
}

export function cloneResolvedSearchState(state: ResolvedSearchState): ResolvedSearchState {
  return JSON.parse(JSON.stringify(state)) as ResolvedSearchState;
}
