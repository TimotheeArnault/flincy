import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { evaluateAndRank } from "../src/engine.js";
import type { ExplanationPartition, FitEvaluationResult } from "../src/types.js";
import { syntheticSearch } from "./fixtures/syntheticSearch.js";

const root = resolve(__dirname, "../../../..");
const cli = resolve(root, "examples/synthetic-search/run.cjs");
const expectedPath = resolve(root, "examples/synthetic-search/expected.json");
const evaluate = () => evaluateAndRank(syntheticSearch);

function byId(rows: FitEvaluationResult[], id: string): FitEvaluationResult {
  const row = rows.find((item) => item.listing_uid === "synthetic:" + id);
  assert.ok(row, id);
  return row;
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) <= 1e-9, actual + " != " + expected);
}

test("synthetic CLI matches the independently authored five-case oracle", () => {
  const expected: unknown = JSON.parse(readFileSync(expectedPath, "utf8"));
  const actual: unknown = JSON.parse(execFileSync(process.execPath, [cli], {
    cwd: root, encoding: "utf8",
  }));
  assert.deepEqual(actual, expected);
});

test("five unique inputs preserve feasibility, eligibility, sections and real engine ranks", () => {
  const rows = evaluate();
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map((row) => row.listing_uid)).size, 5);
  assert.deepEqual(rows.map((row) => row.listing_uid),
    ["synthetic:A", "synthetic:B", "synthetic:C", "synthetic:E", "synthetic:D"]);
  assert.deepEqual(rows.map((row) => row.canonical_rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(rows.filter((row) => row.is_default_main_result).map((row) => row.listing_uid),
    ["synthetic:A", "synthetic:B"]);
  assert.deepEqual(rows.map((row) => row.result_section),
    ["main_results", "main_results", "qa_or_secondary_section", "qa_or_secondary_section", "qa_or_secondary_section"]);
  assert.deepEqual(rows.map((row) => row.feasibility_status),
    ["feasible", "feasible", "feasible", "unresolved", "not_feasible"]);
  assert.deepEqual(rows.map((row) => row.listing_eligibility_status),
    ["eligible", "eligible", "near_miss", "eligible", "eligible"]);
  assert.equal(byId(rows, "C").listing_eligibility_reason_code, "listing_constraint_near_miss");
  assert.equal(byId(rows, "D").feasibility_reason_code, "required_anchor_failed");
  assert.equal(byId(rows, "E").feasibility_reason_code, "required_anchor_unresolved");
});

test("confirmed negative is usable zero; unknown is unusable null, never false", () => {
  const rows = evaluate();
  const a = byId(rows, "A"), b = byId(rows, "B"), e = byId(rows, "E");
  const negative = a.criterion_outputs.find((row) => row.criterion_id === "dishwasher_preference");
  const unknown = b.criterion_outputs.find((row) => row.criterion_id === "dishwasher_preference");
  assert.ok(negative && unknown);
  assert.equal(negative.criterion_score_raw, 0);
  assert.equal(negative.criterion_is_usable, true);
  assert.equal(negative.semantic_truth_value, "absent");
  assert.equal(unknown.criterion_score_raw, null);
  assert.equal(unknown.criterion_is_usable, false);
  assert.equal(unknown.semantic_truth_value, "unknown");
  assert.equal(a.fit_score, 50);
  assert.equal(a.profile_coverage_raw, 1);
  assert.equal(b.fit_score, 100);
  assert.equal(b.profile_coverage_raw, 0.5);
  assert.equal(e.primary_commute_minutes, null);
  assert.equal(e.primary_commute_status, "unresolved");
  const missing = e.base_criterion_outputs.find((row) => row.criterion_id === "primary_commute");
  assert.ok(missing);
  assert.equal(missing.criterion_score_raw, null);
  assert.equal(missing.criterion_is_usable, false);
});

test("hard-only budget and travel affect decisions but allocate no preference points", () => {
  assert.ok(syntheticSearch.searchState.criteria.every((row) => !row.score_enabled));
  assert.ok(syntheticSearch.listings.every((row) =>
    row.atomic_inputs.every((atomic) => atomic.kind === "semantic_evidence")));
  for (const row of evaluate()) {
    assert.equal(row.base_criterion_outputs.length, 2);
    assert.equal(row.criterion_outputs.length, 2);
    assert.deepEqual(row.explanation.criteria.map((part) => part.criterion_id),
      ["dishwasher_preference", "laundry_preference"]);
    assert.equal(row.active_bucket_count, 1);
    for (const bucket of row.explanation.buckets) {
      if (bucket.bucket_id !== "housing_comfort") assert.equal(bucket.allocated_budget_points, 0);
    }
  }
  assert.equal(byId(evaluate(), "D").fit_score, 100);
  assert.equal(byId(evaluate(), "E").profile_coverage, 100);
});

test("explanation partitions reconcile at criterion, component, bucket and profile levels", () => {
  const fields = ["allocated_budget_points", "evaluable_budget_points",
    "earned_points", "missed_points", "unknown_points"] as const;
  const sum = (rows: ExplanationPartition[], field: typeof fields[number]) =>
    rows.reduce((total, row) => total + row[field], 0);
  for (const row of evaluate()) {
    const explanation = row.explanation, p = explanation.profile;
    for (const part of [...explanation.criteria, ...explanation.components, ...explanation.buckets]) {
      close(part.allocated_budget_points, part.earned_points + part.missed_points + part.unknown_points);
      close(part.evaluable_budget_points, part.earned_points + part.missed_points);
    }
    for (const component of explanation.components) {
      const children = explanation.criteria.filter((part) => part.component_id === component.component_id);
      for (const field of fields) close(sum(children, field), component[field]);
    }
    for (const bucket of explanation.buckets) {
      const children = explanation.components.filter((part) => part.bucket_id === bucket.bucket_id);
      for (const field of fields) close(sum(children, field), bucket[field]);
    }
    close(p.total_allocated_budget_points, 100);
    close(sum(explanation.buckets, "earned_points"), p.total_earned_points);
    close(sum(explanation.buckets, "missed_points"), p.total_missed_points);
    close(sum(explanation.buckets, "unknown_points"), p.total_unknown_points);
    close(sum(explanation.buckets, "evaluable_budget_points"), p.total_evaluable_budget_points);
    close(p.total_allocated_budget_points,
      p.total_earned_points + p.total_missed_points + p.total_unknown_points);
    assert.equal(p.reconciliation_valid, true);
    assert.notEqual(row.fit_score_raw, null);
    assert.notEqual(row.profile_coverage_raw, null);
    close(row.fit_score_raw!, 100 * p.total_earned_points / p.total_evaluable_budget_points);
    close(row.profile_coverage_raw!, p.total_evaluable_budget_points / p.total_allocated_budget_points);
  }
});

test("direct engine and CLI calls are byte-deterministic and preserve inputs", () => {
  const before = structuredClone(syntheticSearch);
  assert.equal(JSON.stringify(evaluate()), JSON.stringify(evaluate()));
  const first = execFileSync(process.execPath, [cli], { cwd: root });
  const second = execFileSync(process.execPath, [cli], { cwd: root });
  assert.deepEqual(first, second);
  assert.deepEqual(syntheticSearch, before);
});

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, position) => position !== index)).map((tail) => [item, ...tail]));
}

test("all 120 input permutations preserve full unsorted engine output and semantic ranks", () => {
  const before = structuredClone(syntheticSearch);
  const expected = evaluate();
  const orders = permutations(syntheticSearch.listings);
  assert.equal(orders.length, 120);
  for (const listings of orders) {
    assert.deepEqual(evaluateAndRank({ ...syntheticSearch, listings }), expected);
  }
  assert.deepEqual(syntheticSearch, before);
});
