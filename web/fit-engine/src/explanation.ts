import { FitEngineError, pythonFloatSum } from "./evaluators.js";
import type {
  BucketScore,
  ComponentScore,
  EvaluatedCriterion,
  ExplanationOutput,
  ExplanationPartition,
} from "./types.js";

const TOLERANCE = 1e-9;

function partition(
  allocated: number,
  coverage: number,
  score: number | null,
  usable: boolean,
): ExplanationPartition {
  if (allocated < 0 || coverage < 0 || coverage > 1) {
    throw new FitEngineError("Invalid explanation budget or coverage");
  }
  const evaluable = allocated * coverage;
  const scoreFraction = usable && evaluable > 0 && score !== null
    ? Math.max(0, Math.min(100, score)) / 100
    : 0;
  const earned = evaluable * scoreFraction;
  return {
    allocated_budget_points: allocated,
    evaluable_budget_points: evaluable,
    earned_points: earned,
    missed_points: evaluable - earned,
    unknown_points: allocated - evaluable,
    coverage,
    match_rate: usable && score !== null ? score / 100 : null,
  };
}

function assertClose(left: number, right: number, label: string): void {
  if (Math.abs(left - right) > TOLERANCE) {
    throw new FitEngineError(`${label} mismatch: ${left} != ${right}`);
  }
}

function sumField(rows: readonly ExplanationPartition[], field: keyof ExplanationPartition): number {
  return pythonFloatSum(rows.map((row) => {
    const value = row[field];
    return typeof value === "number" ? value : 0;
  }));
}

export function explainResult(args: {
  listingUid: string;
  sourcePlatform: string;
  searchStateId: string;
  productUniverseBand: string;
  feasibilityStatus: string;
  listingEligibilityStatus: string;
  userFitEnabled: boolean;
  fitScoreRaw: number | null;
  profileCoverageRaw: number | null;
  criteria: readonly EvaluatedCriterion[];
  components: readonly ComponentScore[];
  buckets: readonly BucketScore[];
}): ExplanationOutput {
  const criterionRows: Array<Record<string, unknown> & ExplanationPartition> = [];
  const componentRows: Array<Record<string, unknown> & ExplanationPartition> = [];
  const bucketRows: Array<Record<string, unknown> & ExplanationPartition> = [];

  const activeBuckets = args.buckets.filter((row) => row.bucket_weight > 0);
  const bucketWeightTotal = pythonFloatSum(activeBuckets.map((row) => row.bucket_weight));

  for (const bucket of [...args.buckets].sort((a, b) => bytewiseCompare(a.bucket_id, b.bucket_id))) {
    const bucketComponents = args.components.filter((row) => row.bucket_id === bucket.bucket_id);
    const activeComponents = bucketComponents.filter(
      (row) => row.component_weight > 0 && row.component_status !== "inactive",
    );
    const componentWeightTotal = pythonFloatSum(
      activeComponents.map((row) => row.component_weight),
    );
    const bucketActive = bucket.bucket_weight > 0 && bucketWeightTotal > 0;
    const effectiveBucketWeight = bucketActive ? bucket.bucket_weight / bucketWeightTotal : 0;
    const bucketAllocated = effectiveBucketWeight * 100;
    const bucketCoverage = bucket.bucket_coverage_raw ?? 0;
    const bucketPart = partition(
      bucketAllocated,
      bucketCoverage,
      bucket.bucket_score_raw,
      bucket.bucket_score_raw !== null,
    );
    const componentParts: Array<Record<string, unknown> & ExplanationPartition> = [];

    for (const component of [...bucketComponents].sort((a, b) =>
      bytewiseCompare(a.component_id, b.component_id)
    )) {
      const componentActive = activeComponents.includes(component) && componentWeightTotal > 0;
      const effectiveComponentWeight = componentActive
        ? component.component_weight / componentWeightTotal
        : 0;
      const componentAllocated = bucketAllocated * effectiveComponentWeight;
      const componentPart = partition(
        componentAllocated,
        component.component_coverage_raw ?? 0,
        component.component_score_raw,
        component.component_score_raw !== null,
      );
      const componentCriteria = args.criteria.filter(
        (row) => row.bucket_id === bucket.bucket_id && row.component_id === component.component_id,
      );
      const reasonCodes = [...new Set(componentCriteria.map(
        (row) => row.score_basis_kind || row.criterion_status || "unknown",
      ))].sort(bytewiseCompare);
      const componentFull = {
        listing_uid: args.listingUid,
        source_platform: args.sourcePlatform,
        search_state_id: args.searchStateId,
        bucket_id: bucket.bucket_id,
        component_id: component.component_id,
        component_status: component.component_status,
        configured_component_weight: component.component_weight,
        effective_component_weight: effectiveComponentWeight,
        component_coverage_raw: component.component_coverage_raw,
        component_score_raw: component.component_score_raw,
        reason_codes: reasonCodes,
        ...componentPart,
      };
      componentParts.push(componentFull);
      componentRows.push(componentFull);

      const atomicTotal = pythonFloatSum(componentCriteria.map((row) => row.atomic_weight));
      for (const criterion of [...componentCriteria].sort((a, b) =>
        bytewiseCompare(a.criterion_id, b.criterion_id)
      )) {
        const normalizedAtomicWeight = atomicTotal > 0 ? criterion.atomic_weight / atomicTotal : 0;
        const criterionPart = partition(
          componentAllocated * normalizedAtomicWeight,
          criterion.criterion_is_usable ? 1 : 0,
          criterion.criterion_score_raw,
          criterion.criterion_is_usable,
        );
        criterionRows.push({
          listing_uid: args.listingUid,
          source_platform: args.sourcePlatform,
          search_state_id: args.searchStateId,
          bucket_id: bucket.bucket_id,
          component_id: component.component_id,
          criterion_id: criterion.criterion_id,
          atomic_weight: normalizedAtomicWeight,
          criterion_status: criterion.criterion_status,
          semantic_truth_value: criterion.semantic_truth_value ?? null,
          evidence_status: criterion.evidence_status ?? null,
          reason_code: criterion.score_basis_kind,
          criterion_score_raw: criterion.criterion_score_raw,
          criterion_is_usable: criterion.criterion_is_usable,
          ...criterionPart,
        });
      }
    }

    for (const field of [
      "allocated_budget_points",
      "evaluable_budget_points",
      "earned_points",
      "missed_points",
      "unknown_points",
    ] as const) {
      assertClose(sumField(componentParts, field), Number(bucketPart[field]), `component-to-bucket/${bucket.bucket_id}/${field}`);
    }
    bucketRows.push({
      listing_uid: args.listingUid,
      source_platform: args.sourcePlatform,
      search_state_id: args.searchStateId,
      bucket_id: bucket.bucket_id,
      bucket_status: bucket.bucket_status,
      configured_bucket_weight: bucket.bucket_weight,
      effective_bucket_weight: effectiveBucketWeight,
      bucket_coverage_raw: bucket.bucket_coverage_raw,
      bucket_score_raw: bucket.bucket_score_raw,
      reason_codes: [...new Set(componentParts.flatMap((row) =>
        (row.reason_codes as string[] | undefined) ?? []
      ))].sort(bytewiseCompare),
      ...bucketPart,
    });
  }

  const activeBucketParts = bucketRows.filter((row) => Number(row.effective_bucket_weight) > 0);
  const totals = {
    allocated_budget_points: sumField(activeBucketParts, "allocated_budget_points"),
    evaluable_budget_points: sumField(activeBucketParts, "evaluable_budget_points"),
    earned_points: sumField(activeBucketParts, "earned_points"),
    missed_points: sumField(activeBucketParts, "missed_points"),
    unknown_points: sumField(activeBucketParts, "unknown_points"),
  };
  if (args.userFitEnabled) assertClose(totals.allocated_budget_points, 100, "profile budget");
  assertClose(
    totals.allocated_budget_points,
    totals.earned_points + totals.missed_points + totals.unknown_points,
    "profile partition",
  );
  const derivedCoverage = totals.allocated_budget_points > 0
    ? totals.evaluable_budget_points / totals.allocated_budget_points
    : null;
  const derivedScore = totals.evaluable_budget_points > 0
    ? (totals.earned_points / totals.evaluable_budget_points) * 100
    : null;
  if (args.profileCoverageRaw !== null && derivedCoverage !== null) {
    assertClose(args.profileCoverageRaw, derivedCoverage, "profile coverage");
  }
  if (args.fitScoreRaw !== null && derivedScore !== null) {
    assertClose(args.fitScoreRaw, derivedScore, "profile score");
  }
  return {
    criteria: criterionRows,
    components: componentRows,
    buckets: bucketRows,
    profile: {
      listing_uid: args.listingUid,
      source_platform: args.sourcePlatform,
      search_state_id: args.searchStateId,
      product_universe_band: args.productUniverseBand,
      feasibility_status: args.feasibilityStatus,
      listing_eligibility_status: args.listingEligibilityStatus,
      fit_score_raw: args.fitScoreRaw,
      profile_coverage_raw: args.profileCoverageRaw,
      derived_fit_score_raw: derivedScore,
      derived_profile_coverage_raw: derivedCoverage,
      active_bucket_count: activeBucketParts.length,
      total_allocated_budget_points: totals.allocated_budget_points,
      total_evaluable_budget_points: totals.evaluable_budget_points,
      total_earned_points: totals.earned_points,
      total_missed_points: totals.missed_points,
      total_unknown_points: totals.unknown_points,
      reconciliation_valid: true,
    },
  };
}

export function bytewiseCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
