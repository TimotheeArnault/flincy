import { FitEngineError } from "./evaluators.js";
import { bytewiseCompare } from "./explanation.js";
import type { FitEvaluationResult } from "./types.js";

const PRODUCT_PRIORITY: Record<string, number> = {
  main_product_universe: 1,
  report_only: 2,
};
const FEASIBILITY_PRIORITY: Record<string, number> = {
  feasible: 1,
  feasibility_near_miss: 2,
  unresolved: 3,
  not_feasible: 4,
};
const FIT_PRIORITY: Record<string, number> = {
  eligible: 1,
  near_miss: 2,
  unresolved: 3,
  not_eligible: 4,
  disabled: 5,
};
const COVERAGE_PRIORITY: Record<string, number> = {
  complete: 1,
  partial: 2,
  unavailable: 3,
};

function priority(table: Record<string, number>, value: string, label: string): number {
  const result = table[value];
  if (result === undefined) throw new FitEngineError(`Unknown ${label}: ${value}`);
  return result;
}

export function coverageClass(coverage: number | null, score: number | null): string {
  if (coverage === null || coverage <= 0 || score === null) return "unavailable";
  return Math.abs(coverage - 1) <= 1e-12 ? "complete" : "partial";
}

function descendingNullable(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function ascendingNullable(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function compareResults(left: FitEvaluationResult, right: FitEvaluationResult): number {
  let value = priority(PRODUCT_PRIORITY, left.product_universe_band, "product band") -
    priority(PRODUCT_PRIORITY, right.product_universe_band, "product band");
  if (value) return value;
  value = priority(FEASIBILITY_PRIORITY, left.feasibility_status, "feasibility status") -
    priority(FEASIBILITY_PRIORITY, right.feasibility_status, "feasibility status");
  if (value) return value;
  if (!left.user_fit_enabled) {
    value = ascendingNullable(left.objective_rank, right.objective_rank);
    return value || bytewiseCompare(left.listing_uid, right.listing_uid);
  }
  value = priority(FIT_PRIORITY, left.listing_eligibility_status, "fit status") -
    priority(FIT_PRIORITY, right.listing_eligibility_status, "fit status");
  if (value) return value;
  value = priority(COVERAGE_PRIORITY, left.coverage_class, "coverage class") -
    priority(COVERAGE_PRIORITY, right.coverage_class, "coverage class");
  if (value) return value;
  value = descendingNullable(left.profile_coverage_raw, right.profile_coverage_raw);
  if (value) return value;
  value = descendingNullable(left.fit_score, right.fit_score);
  return value || bytewiseCompare(left.listing_uid, right.listing_uid);
}

function semanticKey(row: FitEvaluationResult): string {
  return JSON.stringify([
    row.product_universe_band,
    row.feasibility_status,
    row.listing_eligibility_status,
    row.coverage_class,
    row.profile_coverage_raw,
    row.fit_score,
  ]);
}

export function rankSearchResults(
  input: readonly FitEvaluationResult[],
): FitEvaluationResult[] {
  const grouped = new Map<string, FitEvaluationResult[]>();
  for (const source of input) {
    const row = {
      ...source,
      coverage_class: coverageClass(source.profile_coverage_raw, source.fit_score),
    };
    const group = grouped.get(row.search_state_id) ?? [];
    group.push(row);
    grouped.set(row.search_state_id, group);
  }
  const output: FitEvaluationResult[] = [];
  for (const stateId of [...grouped.keys()].sort(bytewiseCompare)) {
    const rows = grouped.get(stateId) ?? [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.listing_uid)) {
        throw new FitEngineError(`Duplicate listing ${row.listing_uid}/${stateId}`);
      }
      seen.add(row.listing_uid);
    }
    const ordered = [...rows].sort(compareResults);
    const tieRanks = new Map<string, number>();
    let start = 0;
    while (start < ordered.length) {
      const key = semanticKey(ordered[start]!);
      let end = start + 1;
      while (end < ordered.length && semanticKey(ordered[end]!) === key) end += 1;
      const average = ((start + 1) + end) / 2;
      for (let index = start; index < end; index += 1) {
        tieRanks.set(ordered[index]!.listing_uid, average);
      }
      start = end;
    }
    ordered.forEach((row, zeroIndex) => {
      const main =
        row.product_universe_band === "main_product_universe" &&
        row.feasibility_status === "feasible" &&
        row.listing_eligibility_status === "eligible";
      const objectiveUnavailable = !row.user_fit_enabled && row.objective_rank === null;
      output.push({
        ...row,
        canonical_rank: objectiveUnavailable ? null : zeroIndex + 1,
        semantic_tie_rank: tieRanks.get(row.listing_uid)!,
        is_default_main_result: main,
        result_section: objectiveUnavailable
          ? "unranked_objective_unavailable"
          : main
            ? "main_results"
            : "qa_or_secondary_section",
      });
    });
  }
  return output;
}
