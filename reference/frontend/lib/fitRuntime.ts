import {
  adaptResolvedSearchState,
  evaluateAndRank,
  prepareListingFromO3,
} from "@fit/index.js";
import type { ResolvedSearchState } from "@fit/types.js";
import type { RoutingFact, RoutingLookup } from "@fit/spatial.js";
import {
  createNeutralControls,
  createNeutralState,
  createPersonaControls,
  resolveSearchState,
  type SearchControls,
} from "./searchState";
import type {
  CompactRoutingFact,
  DivergenceCounts,
  ExploreBootstrap,
  RuntimeEvaluation,
  RuntimeParity,
} from "./types";

export {
  exploreProjectionInputKey,
  projectExploreGrid,
  type ExploreProjection,
} from "./exploreProjection";

function routingKey(locationKey: string, mode: string, cellId: string): string {
  return `${locationKey}\u0000${mode}\u0000${cellId}`;
}

function buildRoutingLookup(facts: readonly CompactRoutingFact[]): RoutingLookup {
  const byKey = new Map<string, RoutingFact>();
  for (const fact of facts) {
    byKey.set(
      routingKey(fact.routing_location_key, fact.routing_mode, fact.destination_cell_id),
      {
        duration_seconds: fact.duration_seconds,
        diagnostic_duration_seconds: fact.diagnostic_duration_seconds,
        routing_status: fact.routing_status,
        route_pattern: fact.route_pattern,
      },
    );
  }
  return (locationKey, mode, cellId) =>
    byKey.get(routingKey(locationKey, mode, cellId)) ?? null;
}

function parityForDefault(
  bootstrap: ExploreBootstrap,
  stateId: string,
  results: RuntimeEvaluation["results"],
): RuntimeParity {
  const oracleByUid = new Map(
    bootstrap.persona_oracle_results
      .filter((row) => row.search_state_id === stateId)
      .map((row) => [row.listing_uid, row]),
  );
  let mismatchCount = 0;
  let maxNumericDelta = 0;
  for (const result of results) {
    const oracle = oracleByUid.get(result.listing_uid);
    if (!oracle) {
      mismatchCount += 1;
      continue;
    }
    const numericPairs: Array<[number | null, number | null]> = [
      [result.fit_score_raw, oracle.fit_score_raw],
      [result.fit_score, oracle.fit_score],
      [result.profile_coverage_raw, oracle.profile_coverage_raw],
      [result.primary_commute_minutes, oracle.primary_commute_minutes],
      [result.secondary_commute_minutes, oracle.secondary_commute_minutes],
    ];
    for (const [actual, expected] of numericPairs) {
      if (actual === null || expected === null) {
        if (actual !== expected) mismatchCount += 1;
      } else {
        const delta = Math.abs(actual - expected);
        maxNumericDelta = Math.max(maxNumericDelta, delta);
        if (delta !== 0) mismatchCount += 1;
      }
    }
    if (
      result.canonical_rank !== oracle.canonical_rank ||
      result.feasibility_status !== oracle.feasibility_status ||
      result.listing_eligibility_status !== oracle.listing_eligibility_status ||
      result.fit_status !== oracle.fit_status
    ) {
      mismatchCount += 1;
    }
  }
  return {
    checked_count: results.length,
    mismatch_count: mismatchCount,
    max_numeric_delta: maxNumericDelta,
  };
}

function divergenceFor(
  bootstrap: ExploreBootstrap,
  results: RuntimeEvaluation["results"],
  footprint: ReadonlySet<string> | null,
): DivergenceCounts {
  if (footprint === null) {
    return {
      exact_feasible: 0,
      exact_eligible: 0,
      exact_feasible_inside_footprint: 0,
      exact_feasible_outside_footprint: 0,
      exact_eligible_inside_footprint: 0,
      exact_eligible_outside_footprint: 0,
      inside_footprint_exact_not_feasible: 0,
      inside_footprint_exact_not_eligible: 0,
    };
  }
  const resultByUid = new Map(results.map((result) => [result.listing_uid, result]));
  let exactFeasible = 0;
  let exactEligible = 0;
  let feasibleInside = 0;
  let eligibleInside = 0;
  let approximateNotFeasible = 0;
  let approximateNotEligible = 0;
  for (const listing of bootstrap.listings) {
    const result = resultByUid.get(listing.listing_uid);
    const feasible = result?.feasibility_status === "feasible";
    const eligible = feasible && result.listing_eligibility_status === "eligible";
    const approximate =
      listing.explore_cell_id !== null && footprint.has(listing.explore_cell_id);
    if (feasible) {
      exactFeasible += 1;
      if (approximate) feasibleInside += 1;
    } else if (approximate) approximateNotFeasible += 1;
    if (eligible) {
      exactEligible += 1;
      if (approximate) eligibleInside += 1;
    } else if (approximate) {
      approximateNotEligible += 1;
    }
  }
  return {
    exact_feasible: exactFeasible,
    exact_eligible: exactEligible,
    exact_feasible_inside_footprint: feasibleInside,
    exact_feasible_outside_footprint: exactFeasible - feasibleInside,
    exact_eligible_inside_footprint: eligibleInside,
    exact_eligible_outside_footprint: exactEligible - eligibleInside,
    inside_footprint_exact_not_feasible: approximateNotFeasible,
    inside_footprint_exact_not_eligible: approximateNotEligible,
  };
}

function personaId(state: ResolvedSearchState): string {
  return String(state.persona_id ?? state.search_state_id);
}

export interface FitRuntime {
  defaultPersonaId: string;
  personaIds: string[];
  neutralState: ResolvedSearchState;
  neutralControls: SearchControls;
  stateFor(persona: string): ResolvedSearchState;
  controlsFor(persona: string): SearchControls;
  evaluate(
    persona: string,
    controls: SearchControls,
    custom: boolean,
    footprint: ReadonlySet<string> | null,
  ): RuntimeEvaluation;
  evaluateResolved(
    state: ResolvedSearchState,
    footprint: ReadonlySet<string> | null,
    dynamicRoutingFacts?: readonly CompactRoutingFact[],
    parityStateId?: string | null,
  ): RuntimeEvaluation;
}

export function createFitRuntime(bootstrap: ExploreBootstrap): FitRuntime {
  const stateByPersona = new Map<string, ResolvedSearchState>();
  for (const payload of bootstrap.personas) {
    const state = adaptResolvedSearchState(payload);
    stateByPersona.set(personaId(state), state);
  }
  const personaIds = bootstrap.personas.map((row) => String(row.persona_id));
  const templateState = stateByPersona.get(personaIds[0]!);
  if (!templateState) throw new Error("The public bundle does not expose a persona template");
  const neutralState = createNeutralState(templateState);
  const neutralControls = createNeutralControls(templateState, bootstrap.fit_contract);
  const stateFor = (persona: string): ResolvedSearchState => {
    const state = stateByPersona.get(persona);
    if (!state) throw new Error(`Unknown persona ${persona}`);
    return state;
  };
  const evaluateResolved = (
    state: ResolvedSearchState,
    footprint: ReadonlySet<string> | null,
    dynamicRoutingFacts: readonly CompactRoutingFact[] = [],
    parityStateId: string | null = null,
  ): RuntimeEvaluation => {
    const started = performance.now();
    const routingLookup = buildRoutingLookup([
      ...bootstrap.search_routing_facts,
      ...dynamicRoutingFacts,
    ]);
    const stateResolvedAt = performance.now();
    const preparedListings = bootstrap.listings.map((listing) =>
      prepareListingFromO3({
        listing,
        searchState: state,
        fitContract: bootstrap.fit_contract,
        routingLookup,
      })
    );
    const preparedAt = performance.now();
    const results = evaluateAndRank({
      listings: preparedListings,
      searchState: state,
      contract: bootstrap.fit_contract,
    });
    const completedAt = performance.now();
    return {
      state,
      results,
      evaluation_ms: completedAt - started,
      state_resolution_ms: stateResolvedAt - started,
      listing_preparation_ms: preparedAt - stateResolvedAt,
      engine_evaluation_ms: completedAt - preparedAt,
      parity: parityStateId
        ? parityForDefault(bootstrap, parityStateId, results)
        : null,
      divergence: divergenceFor(bootstrap, results, footprint),
    };
  };
  return {
    defaultPersonaId: personaIds[0]!,
    personaIds,
    neutralState,
    neutralControls,
    stateFor,
    controlsFor(persona) {
      return createPersonaControls(stateFor(persona), bootstrap.fit_contract);
    },
    evaluate(persona, controls, custom, footprint) {
      const defaultState = stateFor(persona);
      const state = resolveSearchState(
        defaultState,
        bootstrap.fit_contract,
        controls,
        custom,
      );
      return evaluateResolved(
        state,
        footprint,
        [],
        !custom ? defaultState.search_state_id : null,
      );
    },
    evaluateResolved,
  };
}
