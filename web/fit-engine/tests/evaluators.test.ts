import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateCategorical,
  evaluateEvidence,
  evaluateNumeric,
  pythonFloatSum,
  roundMaterialized,
} from "../src/evaluators.js";
import type { FeatureInput } from "../src/types.js";

function feature(value: number | null, status = "observed_point_value"): FeatureInput {
  return {
    value_numeric: value,
    value_category: null,
    observation_status: status,
    precision: "exact",
    reason_code: status,
  };
}

test("Python 3.14 compensated sum and Decimal half-up materialization are portable", () => {
  const values = [11.6, 26.984999999999996, 14.399999999999999, 28];
  assert.equal(pythonFloatSum(values), 80.985);
  assert.equal(roundMaterialized(pythonFloatSum(values)), 80.99);
  assert.equal(roundMaterialized(2.675), 2.68);
  assert.equal(roundMaterialized(-2.675), -2.68);
});

test("numeric_max preserves strict, near-miss, fail and missing semantics", () => {
  const evaluate = (value: number | null, status = "observed_point_value") =>
    evaluateNumeric({
      evaluatorKind: "numeric_max",
      feature: feature(value, status),
      target: 1800,
      toleranceKind: "absolute",
      toleranceValue: 100,
    });
  assert.deepEqual(
    [evaluate(1800).criterion_status, evaluate(1850).criterion_status, evaluate(1950).criterion_status],
    ["strict_match", "near_miss", "fail"],
  );
  assert.equal(evaluate(1800).criterion_score_raw, 100);
  assert.equal(evaluate(1850).criterion_score_raw, 75);
  assert.equal(evaluate(1950).criterion_score_raw, 25);
  assert.equal(evaluate(null, "missing_source_value").criterion_is_usable, false);
});

test("numeric_min and distance_max reproduce threshold curves", () => {
  const minimum = evaluateNumeric({
    evaluatorKind: "numeric_min",
    feature: feature(1),
    target: 2,
    toleranceKind: "none",
    toleranceValue: null,
  });
  assert.equal(minimum.criterion_status, "fail");
  assert.equal(minimum.criterion_score_raw, 0);

  const distance = (value: number) =>
    evaluateNumeric({
      evaluatorKind: "distance_max",
      feature: feature(value),
      target: 10,
      toleranceKind: "absolute",
      toleranceValue: 2,
      observableLimit: 60,
    });
  assert.equal(distance(0).criterion_score_raw, 100);
  assert.equal(distance(10).criterion_score_raw, 70);
  assert.equal(distance(12).criterion_score_raw, 50);
  assert.equal(distance(36).criterion_score_raw, 25);
  assert.equal(distance(60).criterion_score_raw, 0);
});

test("bounded routing failure remains usable and categorical maps stay controlled", () => {
  const bounded = evaluateNumeric({
    evaluatorKind: "distance_max",
    feature: { ...feature(null, "route_unavailable_within_diagnostic_horizon"), conclusive_fail: true },
    target: 35,
    toleranceKind: "absolute",
    toleranceValue: 10,
    observableLimit: 90,
  });
  assert.equal(bounded.criterion_status, "fail");
  assert.equal(bounded.criterion_is_usable, true);
  assert.equal(bounded.score_basis_kind, "bounded_over_contract_max");

  const categorical = evaluateCategorical({
    feature: { ...feature(null), value_category: "in_unit" },
    scoreMap: { in_unit: 100, building_or_shared: 80 },
  });
  assert.equal(categorical.criterion_status, "strict_match");
  assert.equal(categorical.criterion_score_raw, 100);
});

test("observation policies distinguish missing, negative and no-positive evidence", () => {
  assert.equal(
    evaluateEvidence("confirmed_negative", "EXPLICIT_STATE").criterion_score_raw,
    0,
  );
  assert.equal(
    evaluateEvidence(
      "no_positive_evidence_after_valid_observation",
      "POSITIVE_EVIDENCE_EXPECTED",
    ).criterion_is_usable,
    true,
  );
  assert.equal(
    evaluateEvidence(
      "no_positive_evidence_after_valid_observation",
      "TRUE_UNKNOWN",
    ).criterion_is_usable,
    false,
  );
  assert.equal(evaluateEvidence("ambiguous", "EXPLICIT_STATE").criterion_status, "unresolved");
});
