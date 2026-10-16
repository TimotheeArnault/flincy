"use strict";

const { evaluateAndRank } = require("../../web/fit-engine/dist/src/engine.js");
const { syntheticSearch } = require("../../web/fit-engine/dist/tests/fixtures/syntheticSearch.js");

// Projection only: preserve the engine's order, ranks, statuses and explanations.
const results = evaluateAndRank(syntheticSearch).map((row) => ({
  listing_uid: row.listing_uid,
  feasibility_status: row.feasibility_status,
  feasibility_reason_code: row.feasibility_reason_code,
  listing_eligibility_status: row.listing_eligibility_status,
  listing_eligibility_reason_code: row.listing_eligibility_reason_code,
  fit_status: row.fit_status,
  result_section: row.result_section,
  is_default_main_result: row.is_default_main_result,
  canonical_rank: row.canonical_rank,
  semantic_tie_rank: row.semantic_tie_rank,
  fit_score: row.fit_score,
  profile_coverage: row.profile_coverage,
  coverage_class: row.coverage_class,
  primary_commute_minutes: row.primary_commute_minutes,
  primary_commute_status: row.primary_commute_status,
  problem_criterion_ids: row.problem_criterion_ids,
  base_criteria: row.base_criterion_outputs.map((criterion) => ({
    criterion_id: criterion.criterion_id,
    constraint_scope: criterion.constraint_scope,
    criterion_status: criterion.criterion_status,
    reason_code: criterion.reason_code,
    criterion_is_usable: criterion.criterion_is_usable,
    score_enabled: criterion.score_enabled,
  })),
  comfort_criteria: row.criterion_outputs.map((criterion) => ({
    criterion_id: criterion.criterion_id,
    semantic_truth_value: criterion.semantic_truth_value,
    evidence_status: criterion.evidence_status,
    criterion_status: criterion.criterion_status,
    criterion_score: criterion.criterion_score,
    criterion_is_usable: criterion.criterion_is_usable,
    reason_code: criterion.reason_code,
  })),
  points: {
    allocated: row.explanation.profile.total_allocated_budget_points,
    evaluable: row.explanation.profile.total_evaluable_budget_points,
    earned: row.explanation.profile.total_earned_points,
    missed: row.explanation.profile.total_missed_points,
    unknown: row.explanation.profile.total_unknown_points,
    reconciliation_valid: row.explanation.profile.reconciliation_valid,
  },
}));

process.stdout.write(JSON.stringify({ scenario: "synthetic-search-v1", results }, null, 2) + "\n");
