import { pythonFloatSum, roundMaterialized } from "./evaluators.js";
import type {
  BucketScore,
  ComponentScore,
  EvaluatedCriterion,
  ProfileScore,
} from "./types.js";

export function aggregateComponent(args: {
  listingUid: string;
  sourcePlatform: string;
  searchStateId: string;
  bucketId: string;
  componentId: string;
  componentWeight: number;
  criteria: readonly EvaluatedCriterion[];
}): ComponentScore {
  const active = args.criteria.filter((row) => row.atomic_weight > 0);
  const denominator = pythonFloatSum(active.map((row) => row.atomic_weight));
  const usable = active.filter((row) => row.criterion_is_usable);
  const usableWeight = pythonFloatSum(usable.map((row) => row.atomic_weight));
  const coverage = denominator > 0 ? usableWeight / denominator : null;
  const score = usableWeight > 0
    ? pythonFloatSum(
        usable.map((row) => Number(row.criterion_score_raw) * row.atomic_weight),
      ) / usableWeight
    : null;
  return {
    listing_uid: args.listingUid,
    source_platform: args.sourcePlatform,
    search_state_id: args.searchStateId,
    bucket_id: args.bucketId,
    component_id: args.componentId,
    component_weight: args.componentWeight,
    configured_component_weight: args.componentWeight,
    component_status: active.length === 0 ? "inactive" : score === null ? "unavailable" : "scored",
    active_criterion_count: active.length,
    usable_criterion_count: usable.length,
    component_coverage_raw: coverage,
    component_score_raw: score,
    component_score_is_exact:
      usable.length > 0 && usable.every((row) => row.criterion_score_is_exact),
  };
}

export function aggregateBucket(args: {
  listingUid: string;
  sourcePlatform: string;
  searchStateId: string;
  bucketId: string;
  bucketWeight: number;
  components: readonly ComponentScore[];
}): BucketScore {
  const active = args.components.filter(
    (row) => row.component_weight > 0 && row.component_status !== "inactive",
  );
  const total = pythonFloatSum(active.map((row) => row.component_weight));
  const coverageNumerator = pythonFloatSum(
    active.map((row) => row.component_weight * (row.component_coverage_raw ?? 0)),
  );
  const coverage = total > 0 ? coverageNumerator / total : null;
  const scored = active.filter(
    (row) => row.component_score_raw !== null && (row.component_coverage_raw ?? 0) > 0,
  );
  const scoreDenominator = pythonFloatSum(
    scored.map((row) => row.component_weight * Number(row.component_coverage_raw)),
  );
  const score = scoreDenominator > 0
    ? pythonFloatSum(
        scored.map(
          (row) =>
            Number(row.component_score_raw) *
            row.component_weight *
            Number(row.component_coverage_raw),
        ),
      ) / scoreDenominator
    : null;
  return {
    listing_uid: args.listingUid,
    source_platform: args.sourcePlatform,
    search_state_id: args.searchStateId,
    bucket_id: args.bucketId,
    bucket_weight: args.bucketWeight,
    configured_bucket_weight: args.bucketWeight,
    bucket_status:
      args.bucketWeight <= 0 ? "inactive" : score === null ? "unavailable" : "scored",
    active_component_count: active.length,
    scored_component_count: scored.length,
    bucket_coverage_raw: coverage,
    bucket_coverage: roundMaterialized(coverage === null ? null : coverage * 100),
    bucket_score_raw: score,
    bucket_score: roundMaterialized(score),
    bucket_score_is_exact:
      scored.length > 0 && scored.every((row) => row.component_score_is_exact),
  };
}

export function aggregateProfile(
  buckets: readonly BucketScore[],
  userFitEnabled: boolean,
): ProfileScore {
  if (!userFitEnabled) {
    return {
      fit_score_raw: null,
      fit_score: null,
      profile_coverage_raw: null,
      profile_coverage: null,
      fit_score_is_exact: false,
      active_bucket_count: 0,
      scored_bucket_count: 0,
    };
  }
  const active = buckets.filter((row) => row.bucket_weight > 0);
  const total = pythonFloatSum(active.map((row) => row.bucket_weight));
  const coverageNumerator = pythonFloatSum(
    active.map((row) => row.bucket_weight * (row.bucket_coverage_raw ?? 0)),
  );
  const coverage = total > 0 ? coverageNumerator / total : null;
  const scored = active.filter(
    (row) => row.bucket_score_raw !== null && (row.bucket_coverage_raw ?? 0) > 0,
  );
  const scoreDenominator = pythonFloatSum(
    scored.map((row) => row.bucket_weight * Number(row.bucket_coverage_raw)),
  );
  const score = scoreDenominator > 0
    ? pythonFloatSum(
        scored.map(
          (row) =>
            Number(row.bucket_score_raw) *
            row.bucket_weight *
            Number(row.bucket_coverage_raw),
        ),
      ) / scoreDenominator
    : null;
  return {
    fit_score_raw: score,
    fit_score: roundMaterialized(score),
    profile_coverage_raw: coverage,
    profile_coverage: roundMaterialized(coverage === null ? null : coverage * 100),
    fit_score_is_exact:
      scored.length > 0 && scored.every((row) => row.bucket_score_is_exact),
    active_bucket_count: active.length,
    scored_bucket_count: scored.length,
  };
}
