import type {
  CriterionEvaluation,
  EvidenceStatus,
  EvaluatorKind,
  FeatureInput,
  ObservationPolicy,
} from "./types.js";

export class FitEngineError extends Error {}

// CPython 3.12+ uses compensated summation for float inputs to sum().
// The browser port mirrors it so half-cent materialization matches Python 3.14.
export function pythonFloatSum(values: Iterable<number>): number {
  let high = 0;
  let low = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new FitEngineError("sum input must be finite");
    const next = high + value;
    if (Math.abs(high) >= Math.abs(value)) low += (high - next) + value;
    else low += (value - next) + high;
    high = next;
  }
  return high + low;
}

export function finiteNumber(
  value: unknown,
  label: string,
  allowNegative = false,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FitEngineError(`${label} must be finite numeric`);
  }
  if (!allowNegative && value < 0) {
    throw new FitEngineError(`${label} must be non-negative`);
  }
  return value;
}

function expandDecimal(value: number): string {
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [mantissa = "0", exponentText = "0"] = text.toLowerCase().split("e");
  const exponent = Number(exponentText);
  const negative = mantissa.startsWith("-");
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const digits = whole + fraction;
  const point = whole.length + exponent;
  let expanded: string;
  if (point <= 0) expanded = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) expanded = digits + "0".repeat(point - digits.length);
  else expanded = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return negative ? `-${expanded}` : expanded;
}

export function roundMaterialized(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) throw new FitEngineError("round input must be finite");
  const negative = value < 0;
  const text = expandDecimal(Math.abs(value));
  const [whole = "0", rawFraction = ""] = text.split(".");
  const fraction = rawFraction.padEnd(3, "0");
  let cents = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) cents += 1n;
  const rounded = Number(cents) / 100;
  return negative ? -rounded : rounded;
}

export function toleranceLimit(
  evaluatorKind: EvaluatorKind,
  target: number,
  toleranceKind: string | null,
  toleranceValue: number | null,
): number {
  if (!["numeric_max", "numeric_min", "distance_max"].includes(evaluatorKind)) {
    throw new FitEngineError(`Unsupported numeric evaluator ${evaluatorKind}`);
  }
  let width = 0;
  if (toleranceKind === "absolute") width = finiteNumber(toleranceValue, "tolerance");
  else if (toleranceKind === "relative") {
    width = target * finiteNumber(toleranceValue, "tolerance");
  } else if (toleranceKind !== "none") {
    throw new FitEngineError("Unknown tolerance kind");
  }
  return evaluatorKind === "numeric_min" ? target - width : target + width;
}

export function evaluateNumeric(args: {
  evaluatorKind: "numeric_max" | "numeric_min" | "distance_max";
  feature: FeatureInput;
  target: number;
  toleranceKind: "none" | "absolute" | "relative";
  toleranceValue: number | null;
  observableLimit?: number | null;
}): CriterionEvaluation {
  const target = finiteNumber(args.target, "target");
  const limit = toleranceLimit(
    args.evaluatorKind,
    target,
    args.toleranceKind,
    args.toleranceValue,
  );
  const unavailable: CriterionEvaluation = {
    criterion_status: "unresolved",
    criterion_score_raw: null,
    criterion_score: null,
    criterion_is_usable: false,
    criterion_score_is_exact: false,
    criterion_coverage_status: "unavailable",
    score_basis_kind: "unavailable",
    score_basis_value_numeric: null,
    effective_tolerance_limit_numeric: limit,
    reason_code: args.feature.reason_code,
  };
  if (args.feature.conclusive_fail) {
    return {
      ...unavailable,
      criterion_status: "fail",
      criterion_score_raw: 0,
      criterion_score: 0,
      criterion_is_usable: true,
      criterion_coverage_status: "usable_bounded",
      score_basis_kind: "bounded_over_contract_max",
    };
  }
  if (
    args.feature.value_numeric === null ||
    !["observed_point_value", "calculated", "calculated_provisional"].includes(
      args.feature.observation_status,
    )
  ) {
    return unavailable;
  }
  const numeric = finiteNumber(
    args.feature.value_numeric,
    "feature value",
    args.evaluatorKind !== "distance_max",
  );
  let status: string;
  let score: number;
  let reason: string;
  if (args.evaluatorKind === "numeric_max") {
    if (numeric <= target) [status, score, reason] = ["strict_match", 100, "strict_threshold_satisfied"];
    else if (limit > target && numeric <= limit) {
      [status, score, reason] = [
        "near_miss",
        100 - (50 * (numeric - target)) / (limit - target),
        "within_numeric_tolerance",
      ];
    } else if (limit > target) {
      [status, score, reason] = [
        "fail",
        50 * (1 - (numeric - limit) / (limit - target)),
        "outside_numeric_tolerance",
      ];
    } else [status, score, reason] = ["fail", 0, "outside_numeric_tolerance"];
  } else if (args.evaluatorKind === "numeric_min") {
    if (numeric >= target) [status, score, reason] = ["strict_match", 100, "strict_threshold_satisfied"];
    else if (limit < target && numeric >= limit) {
      [status, score, reason] = [
        "near_miss",
        100 - (50 * (target - numeric)) / (target - limit),
        "within_numeric_tolerance",
      ];
    } else if (limit < target) {
      [status, score, reason] = [
        "fail",
        50 * (1 - (limit - numeric) / (target - limit)),
        "outside_numeric_tolerance",
      ];
    } else [status, score, reason] = ["fail", 0, "outside_numeric_tolerance"];
  } else {
    const radius = finiteNumber(args.observableLimit, "observable limit");
    if (target > radius || limit > radius) {
      throw new FitEngineError("Distance threshold or tolerance exceeds observable limit");
    }
    if (numeric <= target) {
      [status, score, reason] = [
        "strict_match",
        target === 0 ? 100 : 100 - (30 * numeric) / target,
        "within_lower_is_better_threshold",
      ];
    } else if (limit > target && numeric <= limit) {
      [status, score, reason] = [
        "near_miss",
        70 - (20 * (numeric - target)) / (limit - target),
        "within_lower_is_better_tolerance",
      ];
    } else {
      const start = limit > target ? limit : target;
      const startScore = limit > target ? 50 : 70;
      [status, score, reason] = [
        "fail",
        radius === start ? 0 : (startScore * (radius - numeric)) / (radius - start),
        "outside_lower_is_better_tolerance",
      ];
    }
  }
  const clamped = Math.max(0, Math.min(100, score));
  const exact = args.feature.precision === "exact";
  return {
    criterion_status: status,
    criterion_score_raw: clamped,
    criterion_score: roundMaterialized(clamped),
    criterion_is_usable: true,
    criterion_score_is_exact: exact,
    criterion_coverage_status: exact ? "usable_exact" : "usable_provisional",
    score_basis_kind: exact ? "point_exact" : "point_provisional",
    score_basis_value_numeric: numeric,
    effective_tolerance_limit_numeric: limit,
    reason_code: reason,
  };
}

export function evaluateCategorical(args: {
  feature: FeatureInput;
  scoreMap?: Record<string, number>;
  acceptedValues?: string[];
  prohibitedValues?: string[];
  unresolvedValues?: Array<string | null>;
}): CriterionEvaluation {
  const text = args.feature.value_category;
  const unresolved = new Set(args.unresolvedValues ?? [null, "", "unknown", "ambiguous", "not_mentioned"]);
  if (unresolved.has(text)) {
    return {
      criterion_status: "unresolved",
      criterion_score_raw: null,
      criterion_score: null,
      criterion_is_usable: false,
      criterion_score_is_exact: false,
      criterion_coverage_status: "unavailable",
      score_basis_kind: "unavailable",
      score_basis_value_category: text,
      reason_code: args.feature.reason_code,
    };
  }
  let status: string;
  let score: number;
  let reason: string;
  const accepted = new Set(args.acceptedValues ?? []);
  const prohibited = new Set(args.prohibitedValues ?? []);
  if (accepted.size || prohibited.size) {
    if (text !== null && accepted.has(text)) [status, score, reason] = ["strict_match", 100, "categorical_requirement_accepted"];
    else if (text !== null && prohibited.has(text)) [status, score, reason] = ["fail", 0, "categorical_requirement_prohibited"];
    else {
      return {
        criterion_status: "unresolved",
        criterion_score_raw: null,
        criterion_score: null,
        criterion_is_usable: false,
        criterion_score_is_exact: false,
        criterion_coverage_status: "unavailable",
        score_basis_kind: "unavailable",
        score_basis_value_category: text,
        reason_code: "categorical_requirement_unresolved",
      };
    }
  } else {
    if (text === null || !args.scoreMap || !(text in args.scoreMap)) {
      return {
        criterion_status: "unresolved",
        criterion_score_raw: null,
        criterion_score: null,
        criterion_is_usable: false,
        criterion_score_is_exact: false,
        criterion_coverage_status: "unavailable",
        score_basis_kind: "unavailable",
        score_basis_value_category: text,
        reason_code: "category_not_in_controlled_score_map",
      };
    }
    score = finiteNumber(args.scoreMap[text], "categorical score");
    if (score > 100) throw new FitEngineError("Categorical scores must be in [0,100]");
    status = score === 100 ? "strict_match" : score === 0 ? "fail" : "near_miss";
    reason = "categorical_preference_scored";
  }
  return {
    criterion_status: status,
    criterion_score_raw: score,
    criterion_score: roundMaterialized(score),
    criterion_is_usable: true,
    criterion_score_is_exact: true,
    criterion_coverage_status: "usable_exact",
    score_basis_kind: "categorical_exact",
    score_basis_value_category: text,
    reason_code: reason,
  };
}

export function evaluateEvidence(
  evidenceStatus: EvidenceStatus,
  observationPolicy: ObservationPolicy,
): CriterionEvaluation {
  if (evidenceStatus === "confirmed_positive") {
    return {
      criterion_status: "strict_match",
      criterion_score_raw: 100,
      criterion_score: 100,
      criterion_is_usable: true,
      criterion_score_is_exact: true,
      criterion_coverage_status: "usable_exact",
      score_basis_kind: "confirmed_positive",
      reason_code: "confirmed_positive",
    };
  }
  if (evidenceStatus === "confirmed_negative") {
    return {
      criterion_status: "fail",
      criterion_score_raw: 0,
      criterion_score: 0,
      criterion_is_usable: true,
      criterion_score_is_exact: true,
      criterion_coverage_status: "usable_exact",
      score_basis_kind: "confirmed_negative",
      reason_code: "confirmed_negative",
    };
  }
  if (
    evidenceStatus === "no_positive_evidence_after_valid_observation" &&
    observationPolicy === "POSITIVE_EVIDENCE_EXPECTED"
  ) {
    return {
      criterion_status: "fail",
      criterion_score_raw: 0,
      criterion_score: 0,
      criterion_is_usable: true,
      criterion_score_is_exact: false,
      criterion_coverage_status: "usable_observation_evidence",
      score_basis_kind: "no_positive_after_valid_observation",
      reason_code: "no_positive_after_valid_observation",
    };
  }
  return {
    criterion_status: "unresolved",
    criterion_score_raw: null,
    criterion_score: null,
    criterion_is_usable: false,
    criterion_score_is_exact: false,
    criterion_coverage_status: "unavailable",
    score_basis_kind: "unresolved_evidence",
    reason_code: "unresolved_evidence",
  };
}

export function inactiveEvaluation(): CriterionEvaluation {
  return {
    criterion_status: "disabled",
    criterion_score_raw: null,
    criterion_score: null,
    criterion_is_usable: false,
    criterion_score_is_exact: false,
    criterion_coverage_status: "inactive",
    score_basis_kind: "unavailable",
    score_basis_value_numeric: null,
    score_basis_value_category: null,
    effective_tolerance_limit_numeric: null,
    reason_code: "criterion_disabled",
  };
}
