import assert from "node:assert/strict";
import test from "node:test";

import { rankSearchResults } from "../src/ranking.js";
import type { FitEvaluationResult } from "../src/types.js";

function result(
  listingUid: string,
  overrides: Partial<FitEvaluationResult> = {},
): FitEvaluationResult {
  return {
    listing_uid: listingUid,
    source_platform: "fixture",
    search_state_id: "state",
    persona_id: null,
    profile_mode: "custom",
    user_fit_enabled: true,
    resolved_search_state_hash: "state-hash",
    product_universe_band: "main_product_universe",
    feasibility_status: "feasible",
    feasibility_reason_code: "all_required_anchors_strict_match",
    listing_eligibility_status: "eligible",
    listing_eligibility_reason_code: "all_listing_constraints_satisfied",
    fit_status: "eligible",
    coverage_class: "complete",
    primary_commute_minutes: null,
    primary_commute_status: null,
    secondary_commute_minutes: null,
    secondary_commute_status: null,
    problem_criterion_ids: [],
    objective_rank: null,
    base_criterion_outputs: [],
    criterion_outputs: [],
    component_outputs: [],
    bucket_outputs: [],
    explanation: {
      criteria: [],
      components: [],
      buckets: [],
      profile: {
        total_allocated_budget_points: 100,
        total_evaluable_budget_points: 100,
        total_earned_points: 80,
        total_missed_points: 20,
        total_unknown_points: 0,
        reconciliation_valid: true,
      },
    },
    fit_score_raw: 80,
    fit_score: 80,
    profile_coverage_raw: 1,
    profile_coverage: 100,
    fit_score_is_exact: true,
    active_bucket_count: 1,
    scored_bucket_count: 1,
    ...overrides,
  };
}

test("ranking preserves semantic bands before score", () => {
  const rows = rankSearchResults([
    result("near-complete", {
      listing_eligibility_status: "near_miss",
      fit_status: "near_miss",
      fit_score: 100,
    }),
    result("eligible-partial", {
      profile_coverage_raw: 0.5,
      profile_coverage: 50,
      fit_score: 20,
    }),
    result("unresolved", {
      listing_eligibility_status: "unresolved",
      fit_status: "unresolved",
    }),
    result("not-eligible", {
      listing_eligibility_status: "not_eligible",
      fit_status: "not_eligible",
    }),
  ]);
  assert.deepEqual(rows.map((row) => row.listing_uid), [
    "eligible-partial",
    "near-complete",
    "unresolved",
    "not-eligible",
  ]);
});

test("semantic ties use average rank while UID tie-break is bytewise and shuffle-safe", () => {
  const original = [result("listing:b"), result("listing:A"), result("listing:a")];
  const ordered = rankSearchResults(original);
  const shuffled = rankSearchResults([original[2]!, original[0]!, original[1]!]);
  assert.deepEqual(ordered.map((row) => row.listing_uid), ["listing:A", "listing:a", "listing:b"]);
  assert.deepEqual(shuffled.map((row) => row.listing_uid), ordered.map((row) => row.listing_uid));
  assert.deepEqual(ordered.map((row) => row.semantic_tie_rank), [2, 2, 2]);
});

test("fit-disabled ranking uses objective rank and keeps unavailable rows unranked", () => {
  const rows = rankSearchResults([
    result("unavailable", { user_fit_enabled: false, fit_status: "disabled", fit_score: null }),
    result("objective", {
      user_fit_enabled: false,
      fit_status: "disabled",
      fit_score: null,
      objective_rank: 4,
    }),
  ]);
  assert.equal(rows[0]!.listing_uid, "objective");
  assert.equal(rows[1]!.canonical_rank, null);
  assert.equal(rows[1]!.result_section, "unranked_objective_unavailable");
});
