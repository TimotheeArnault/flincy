import type {
  FitContract,
  ResolvedAnchor,
  ResolvedComponent,
  ResolvedCriterion,
  ResolvedSearchState,
} from "@fit/types.js";

export interface ComponentControl {
  componentId: string;
  active: boolean;
  weight: number;
  defaultActive: boolean;
  scoringReadiness: string;
}

export interface BucketControl {
  bucketId: string;
  active: boolean;
  weight: number;
  displayOrder: number;
  scoringReadiness: string;
  components: ComponentControl[];
}

export interface SearchControls {
  anchors: ResolvedAnchor[];
  commuteEnabled: boolean;
  commuteTargets: Record<string, number>;
  budgetEnabled: boolean;
  maxBudget: number;
  bedroomsEnabled: boolean;
  minimumBedrooms: number;
  buckets: BucketControl[];
}

export const BUDGET_LIMIT_DOMAIN = {
  min: 0,
  max: 3500,
  step: 25,
} as const;

interface CalibrationComponent {
  bucket_id: string;
  component_id: string;
  criterion_ids: string[];
  default_active?: boolean;
  scoring_readiness: string;
}

interface CalibrationContract {
  components: CalibrationComponent[];
}

export interface WeightItem {
  id: string;
  active: boolean;
  weight: number;
}

const BASE_CRITERION_COMPONENT: Record<string, string> = {
  grocery_core_max_distance: "grocery",
  laundry_status: "laundry",
  metro_access_preference: "metro_access",
  parking_availability: "parking",
  pharmacy_max_distance: "pharmacy",
  rent_budget_headroom: "rent_headroom",
};

const COMMUTE_OBSERVABLE_HORIZON_MINUTES = 90;

export function boundedCommuteTolerance(
  targetMinutes: number,
  configuredToleranceMinutes: number | null,
  observableHorizonMinutes = COMMUTE_OBSERVABLE_HORIZON_MINUTES,
): number {
  return Math.max(
    0,
    Math.min(configuredToleranceMinutes ?? 0, observableHorizonMinutes - targetMinutes),
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function calibration(contract: FitContract): CalibrationContract {
  const value = contract.calibration as unknown as Partial<CalibrationContract>;
  if (!Array.isArray(value.components)) {
    throw new Error("The O3 fit contract does not expose calibration components");
  }
  return value as CalibrationContract;
}

function correctedShares(items: WeightItem[]): WeightItem[] {
  const active = items.filter((item) => item.active);
  if (active.length === 0) return items.map((item) => ({ ...item, weight: 0 }));
  const total = active.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  const equal = 1 / active.length;
  const normalized = items.map((item) => ({
    ...item,
    weight: item.active ? (total > 0 ? Math.max(0, item.weight) / total : equal) : 0,
  }));
  let lastActiveIndex = -1;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (normalized[index]!.active) {
      lastActiveIndex = index;
      break;
    }
  }
  const beforeLast = normalized.reduce(
    (sum, item, index) => sum + (item.active && index !== lastActiveIndex ? item.weight : 0),
    0,
  );
  if (lastActiveIndex >= 0) normalized[lastActiveIndex]!.weight = Math.max(0, 1 - beforeLast);
  return normalized;
}

export function redistributeWeight(
  items: readonly WeightItem[],
  targetId: string,
  requestedShare: number,
): WeightItem[] {
  const current = correctedShares(items.map((item) => ({ ...item })));
  const target = current.find((item) => item.id === targetId);
  if (!target || !target.active) return current;
  const others = current.filter((item) => item.active && item.id !== targetId);
  if (others.length === 0) {
    return current.map((item) => ({ ...item, weight: item.id === targetId ? 1 : 0 }));
  }
  const share = Math.min(0.95, Math.max(0.05, requestedShare));
  const remaining = 1 - share;
  const otherTotal = others.reduce((sum, item) => sum + item.weight, 0);
  const updated = current.map((item) => {
    if (!item.active) return { ...item, weight: 0 };
    if (item.id === targetId) return { ...item, weight: share };
    return {
      ...item,
      weight: otherTotal > 0 ? remaining * item.weight / otherTotal : remaining / others.length,
    };
  });
  return correctedShares(updated);
}

export function toggleWeight(
  items: readonly WeightItem[],
  targetId: string,
  nextActive: boolean,
): WeightItem[] {
  const current = correctedShares(items.map((item) => ({ ...item })));
  const target = current.find((item) => item.id === targetId);
  if (!target || target.active === nextActive) return current;
  const activeCount = current.filter((item) => item.active).length;
  if (!nextActive && activeCount <= 1) return current;
  if (!nextActive) {
    return correctedShares(current.map((item) =>
      item.id === targetId ? { ...item, active: false, weight: 0 } : item
    ));
  }
  const targetShare = 1 / (activeCount + 1);
  const activated = current.map((item) =>
    item.id === targetId ? { ...item, active: true, weight: 0 } : item
  );
  return redistributeWeight(activated, targetId, targetShare);
}

export function displayPercentages(items: readonly WeightItem[]): Record<string, number> {
  const active = correctedShares(items.map((item) => ({ ...item }))).filter((item) => item.active);
  if (active.length === 0) {
    return Object.fromEntries(items.map((item) => [item.id, 0] as const));
  }
  const rows = active.map((item, index) => {
    const raw = item.weight * 100;
    return { id: item.id, floor: Math.floor(raw), remainder: raw - Math.floor(raw), index };
  });
  let points = 100 - rows.reduce((sum, row) => sum + row.floor, 0);
  const allocationOrder = [...rows].sort((left, right) =>
    right.remainder - left.remainder || left.index - right.index
  );
  for (let index = 0; index < points; index += 1) {
    allocationOrder[index % allocationOrder.length]!.floor += 1;
  }
  return Object.fromEntries([
    ...items.filter((item) => !item.active).map((item) => [item.id, 0] as const),
    ...rows.map((row) => [row.id, row.floor] as const),
  ]);
}

function criterionTarget(state: ResolvedSearchState, definitionId: string): number {
  const value = state.criteria.find(
    (criterion) => criterion.criterion_definition_id === definitionId,
  )?.target_value_numeric;
  if (typeof value !== "number") throw new Error(`Missing numeric criterion ${definitionId}`);
  return value;
}

function hasCompatibleAnchor(anchors: readonly ResolvedAnchor[]): boolean {
  return anchors.some(
    (anchor) =>
      typeof anchor.matched_destination_cell_id === "string"
      && anchor.matched_destination_cell_id.length > 0
      && anchor.routing_coverage_status === "covered_by_500m_grid",
  );
}

export function hasCommutePriorityPrerequisite(controls: SearchControls): boolean {
  return controls.commuteEnabled && hasCompatibleAnchor(controls.anchors);
}

export function applyControlPrerequisiteIntegrity(controls: SearchControls): SearchControls {
  const commuteApplicable = hasCommutePriorityPrerequisite(controls);
  let buckets = controls.buckets.map((bucket) => {
    if (bucket.bucketId === "financial_flexibility" && !controls.budgetEnabled) {
      return {
        ...bucket,
        active: false,
        weight: 0,
        components: bucket.components.map((component) => ({
          ...component,
          active: false,
          weight: 0,
        })),
      };
    }
    let components = correctedShares(bucket.components.map((component) => ({
      id: component.componentId,
      active: component.componentId === "commute" && !commuteApplicable
        ? false
        : component.active,
      weight: component.componentId === "commute" && !commuteApplicable
        ? 0
        : component.weight,
    })));
    if (
      bucket.active
      && bucket.bucketId === "anchor_mobility"
      && !commuteApplicable
      && !components.some((component) => component.active)
    ) {
      const applicable = bucket.components.filter(
        (component) => component.componentId !== "commute",
      );
      const preferred = applicable.filter((component) => component.defaultActive);
      const selected = preferred.length > 0 ? preferred : applicable;
      const selectedIds = new Set(selected.map((component) => component.componentId));
      const share = selectedIds.size > 0 ? 1 / selectedIds.size : 0;
      components = components.map((component) => ({
        ...component,
        active: selectedIds.has(component.id),
        weight: selectedIds.has(component.id) ? share : 0,
      }));
    }
    const byId = new Map(components.map((component) => [component.id, component]));
    const nextComponents = bucket.components.map((component) => {
      const next = byId.get(component.componentId)!;
      return { ...component, active: next.active, weight: next.weight };
    });
    const active = bucket.active && nextComponents.some((component) => component.active);
    return {
      ...bucket,
      active,
      weight: active ? bucket.weight : 0,
      components: nextComponents,
    };
  });
  const bucketWeights = correctedShares(buckets.map((bucket) => ({
    id: bucket.bucketId,
    active: bucket.active,
    weight: bucket.weight,
  })));
  const bucketWeightById = new Map(bucketWeights.map((bucket) => [bucket.id, bucket.weight]));
  buckets = buckets.map((bucket) => ({
    ...bucket,
    weight: bucket.active ? bucketWeightById.get(bucket.bucketId)! : 0,
  }));
  return {
    ...clone(controls),
    commuteEnabled: commuteApplicable,
    buckets,
  };
}

function stateWithPrerequisiteIntegrity(
  source: ResolvedSearchState,
): ResolvedSearchState {
  const state = clone(source);
  if (state.preferred_metro_line_ids.length === 0) {
    state.criteria = state.criteria.map((criterion) =>
      criterion.criterion_definition_id === "metro_access_preference"
        && criterion.selection_mode === "preferred_lines"
        ? { ...criterion, selection_mode: "nearest_any" }
        : criterion
    );
  }
  const commuteApplicable = hasCompatibleAnchor(state.anchors);
  const budgetApplicable = state.criteria.some(
    (criterion) =>
      criterion.criterion_definition_id === "max_budget"
      && criterion.criterion_enabled,
  );
  const componentPrerequisiteMissing = (component: ResolvedComponent) =>
    (!commuteApplicable && component.component_id === "commute")
    || (!budgetApplicable && component.bucket_id === "financial_flexibility");
  const removedBucketIds = new Set(
    state.components
      .filter(componentPrerequisiteMissing)
      .map((component) => component.bucket_id),
  );
  if (!commuteApplicable) {
    state.criteria = state.criteria.filter(
      (criterion) => criterion.criterion_definition_id !== "anchor_commute",
    );
  }
  if (!budgetApplicable) {
    state.criteria = state.criteria.map((criterion) =>
      criterion.criterion_definition_id === "rent_budget_headroom"
        ? {
            ...criterion,
            criterion_enabled: false,
            score_enabled: false,
            importance_level: "disabled",
            importance_weight: 0,
          }
        : criterion
    );
  }
  if (removedBucketIds.size === 0) return state;

  const retainedComponents = state.components.filter(
    (component) => !componentPrerequisiteMissing(component),
  );
  state.components = retainedComponents.map((component) => {
    if (!removedBucketIds.has(component.bucket_id)) return component;
    const total = retainedComponents
      .filter(
        (candidate) =>
          candidate.bucket_id === component.bucket_id
          && candidate.component_weight > 0,
      )
      .reduce((sum, candidate) => sum + candidate.component_weight, 0);
    return {
      ...component,
      component_weight: total > 0 ? component.component_weight / total : 0,
    };
  });
  state.buckets = state.buckets.map((bucket) => {
    if (!removedBucketIds.has(bucket.bucket_id)) return bucket;
    const activeComponents = state.components
      .filter(
        (component) =>
          component.bucket_id === bucket.bucket_id
          && component.component_weight > 0,
      )
      .map((component) => component.component_id);
    const active = bucket.bucket_enabled && activeComponents.length > 0;
    return {
      ...bucket,
      bucket_enabled: active,
      bucket_weight: active ? bucket.bucket_weight : 0,
      active_components: activeComponents,
      bucket_mode: active ? "score" : "inactive",
      score_bucket: active,
    };
  });
  const activeBuckets = state.buckets.filter(
    (bucket) => bucket.bucket_enabled && bucket.bucket_weight > 0,
  );
  const bucketTotal = activeBuckets.reduce(
    (sum, bucket) => sum + bucket.bucket_weight,
    0,
  );
  if (bucketTotal > 0) {
    const activeBucketIds = new Set(activeBuckets.map((bucket) => bucket.bucket_id));
    state.buckets = state.buckets.map((bucket) =>
      activeBucketIds.has(bucket.bucket_id)
        ? { ...bucket, bucket_weight: bucket.bucket_weight / bucketTotal }
        : bucket
    );
  }
  state.user_fit_enabled = state.components.some(
    (component) => component.component_weight > 0,
  );
  return state;
}

export function createPersonaControls(
  state: ResolvedSearchState,
  contract: FitContract,
): SearchControls {
  const applicableState = stateWithPrerequisiteIntegrity(state);
  const existingComponents = new Map(
    applicableState.components.map((component) => [
      `${component.bucket_id}\u0000${component.component_id}`,
      component,
    ]),
  );
  const definitions = calibration(contract).components.filter(
    (component) => !["NOT_SCORABLE_V1", "DEFER"].includes(component.scoring_readiness),
  );
  const buckets = [...applicableState.buckets]
    .sort((left, right) => left.display_order - right.display_order)
    .map((bucket) => {
      const components = definitions
        .filter((component) => component.bucket_id === bucket.bucket_id)
        .map((definition) => {
          const existing = existingComponents.get(
            `${definition.bucket_id}\u0000${definition.component_id}`,
          );
          return {
            componentId: definition.component_id,
            active: Boolean(existing && existing.component_weight > 0),
            weight: existing?.component_weight ?? 0,
            defaultActive: definition.default_active === true,
            scoringReadiness: definition.scoring_readiness,
          };
        });
      return {
        bucketId: bucket.bucket_id,
        active: bucket.bucket_enabled && bucket.bucket_weight > 0,
        weight: bucket.bucket_weight,
        displayOrder: bucket.display_order,
        scoringReadiness: String(bucket.scoring_readiness ?? "DEFAULT_ACTIVE"),
        components,
      };
    });
  return applyControlPrerequisiteIntegrity({
    anchors: clone(applicableState.anchors),
    commuteEnabled: hasCompatibleAnchor(applicableState.anchors),
    commuteTargets: Object.fromEntries(applicableState.anchors.map((anchor) => [
      anchor.criterion_instance_id,
      anchor.target_value_numeric,
    ])),
    budgetEnabled: applicableState.criteria.some(
      (criterion) => criterion.criterion_definition_id === "max_budget" && criterion.criterion_enabled,
    ),
    maxBudget: criterionTarget(applicableState, "max_budget"),
    bedroomsEnabled: applicableState.criteria.some(
      (criterion) => criterion.criterion_definition_id === "minimum_bedrooms" && criterion.criterion_enabled,
    ),
    minimumBedrooms: criterionTarget(applicableState, "minimum_bedrooms"),
    buckets,
  });
}

export function createNeutralState(template: ResolvedSearchState): ResolvedSearchState {
  const inactiveCriteria: ResolvedCriterion[] = template.criteria
    .filter((criterion) => criterion.criterion_definition_id !== "anchor_commute")
    .map((criterion) => ({
      ...criterion,
      search_state_id: "neutral_search_state_v1",
      selection_mode: criterion.criterion_definition_id === "metro_access_preference"
        ? "nearest_any"
        : criterion.selection_mode,
      criterion_enabled: false,
      constraint_scope: "none" as const,
      score_enabled: false,
      importance_level: "disabled",
      importance_weight: 0,
    }));
  return {
    ...clone(template),
    search_state_id: "neutral_search_state_v1",
    profile_mode: "none",
    persona_id: null,
    base_search_state_id: null,
    user_fit_enabled: false,
    resolved_search_state_hash: "browser_neutral_state_v1",
    preferred_metro_line_ids: [],
    anchors: [],
    buckets: template.buckets.map((bucket) => ({
      ...bucket,
      search_state_id: "neutral_search_state_v1",
      bucket_enabled: false,
      bucket_weight: 0,
      active_components: [],
      bucket_mode: "inactive",
      score_bucket: false,
    })),
    components: [],
    criteria: inactiveCriteria,
  };
}

export function createNeutralControls(
  template: ResolvedSearchState,
  contract: FitContract,
): SearchControls {
  const controls = createPersonaControls(template, contract);
  return {
    ...controls,
    anchors: [],
    commuteEnabled: false,
    commuteTargets: {},
    budgetEnabled: false,
    bedroomsEnabled: false,
    buckets: controls.buckets.map((bucket) => ({
      ...bucket,
      active: false,
      weight: 0,
      components: bucket.components.map((component) => ({
        ...component,
        active: false,
        weight: 0,
      })),
    })),
  };
}

export function setCommuteTarget(
  controls: SearchControls,
  criterionInstanceId: string,
  targetMinutes: number,
): SearchControls {
  if (!(criterionInstanceId in controls.commuteTargets)) return controls;
  return {
    ...controls,
    commuteTargets: {
      ...controls.commuteTargets,
      [criterionInstanceId]: Math.min(90, Math.max(15, targetMinutes)),
    },
  };
}

export function setBucketWeight(
  controls: SearchControls,
  bucketId: string,
  requestedShare: number,
): SearchControls {
  const weights = redistributeWeight(
    controls.buckets.map((bucket) => ({ id: bucket.bucketId, active: bucket.active, weight: bucket.weight })),
    bucketId,
    requestedShare,
  );
  const byId = new Map(weights.map((item) => [item.id, item]));
  return {
    ...controls,
    buckets: controls.buckets.map((bucket) => ({ ...bucket, weight: byId.get(bucket.bucketId)!.weight })),
  };
}

export function setBucketActive(
  controls: SearchControls,
  bucketId: string,
  active: boolean,
): SearchControls {
  const weights = toggleWeight(
    controls.buckets.map((bucket) => ({ id: bucket.bucketId, active: bucket.active, weight: bucket.weight })),
    bucketId,
    active,
  );
  const byId = new Map(weights.map((item) => [item.id, item]));
  return {
    ...controls,
    buckets: controls.buckets.map((bucket) => {
      const item = byId.get(bucket.bucketId)!;
      let components = bucket.components;
      if (item.active && !components.some((component) => component.active)) {
        const preferred = components.filter((component) => component.defaultActive);
        const selected = preferred.length > 0 ? new Set(preferred.map((component) => component.componentId)) : new Set(components.map((component) => component.componentId));
        const share = selected.size > 0 ? 1 / selected.size : 0;
        components = components.map((component) => ({
          ...component,
          active: selected.has(component.componentId),
          weight: selected.has(component.componentId) ? share : 0,
        }));
      }
      return { ...bucket, active: item.active, weight: item.weight, components };
    }),
  };
}

export function setComponentWeight(
  controls: SearchControls,
  bucketId: string,
  componentId: string,
  requestedShare: number,
): SearchControls {
  return {
    ...controls,
    buckets: controls.buckets.map((bucket) => {
      if (bucket.bucketId !== bucketId) return bucket;
      const weights = redistributeWeight(
        bucket.components.map((component) => ({ id: component.componentId, active: component.active, weight: component.weight })),
        componentId,
        requestedShare,
      );
      const byId = new Map(weights.map((item) => [item.id, item]));
      return {
        ...bucket,
        components: bucket.components.map((component) => ({
          ...component,
          weight: byId.get(component.componentId)!.weight,
        })),
      };
    }),
  };
}

export function setComponentActive(
  controls: SearchControls,
  bucketId: string,
  componentId: string,
  active: boolean,
): SearchControls {
  return {
    ...controls,
    buckets: controls.buckets.map((bucket) => {
      if (bucket.bucketId !== bucketId) return bucket;
      const weights = toggleWeight(
        bucket.components.map((component) => ({ id: component.componentId, active: component.active, weight: component.weight })),
        componentId,
        active,
      );
      const byId = new Map(weights.map((item) => [item.id, item]));
      return {
        ...bucket,
        components: bucket.components.map((component) => {
          const item = byId.get(component.componentId)!;
          return { ...component, active: item.active, weight: item.weight };
        }),
      };
    }),
  };
}

export interface ManualAnchorSelection {
  longitude: number;
  latitude: number;
  cellId: string;
  cellCenterLongitude: number;
  cellCenterLatitude: number;
  routingMode: "transit" | "car";
}

export function addManualAnchor(
  controls: SearchControls,
  selection: ManualAnchorSelection,
  scoreEnabled = true,
): SearchControls {
  if (controls.anchors.length >= 2) return controls;
  if (controls.anchors.some((anchor) => anchor.matched_destination_cell_id === selection.cellId)) {
    return controls;
  }
  const usedSlots = new Set(
    controls.anchors.flatMap((anchor) => {
      const match = String(anchor.criterion_instance_id).match(/^manual_destination_(\d+)_commute$/);
      return match ? [Number(match[1])] : [];
    }),
  );
  const slot = [1, 2].find((value) => !usedSlots.has(value)) ?? controls.anchors.length + 1;
  const criterionId = `manual_destination_${slot}_commute`;
  const anchor: ResolvedAnchor = {
    search_state_id: "browser_custom_manual_anchor_v1",
    criterion_instance_id: criterionId,
    anchor_role: controls.anchors.length === 0 ? "primary" : "secondary",
    routing_mode: selection.routingMode,
    required_for_feasibility: true,
    score_enabled: scoreEnabled,
    target_value_numeric: 45,
    tolerance_kind: "absolute",
    tolerance_value_numeric: 10,
    matched_destination_cell_id: selection.cellId,
    routing_coverage_status: "covered_by_500m_grid",
    resolved_anchor_hash: `browser_manual_${selection.cellId}_${selection.routingMode}_${selection.longitude}_${selection.latitude}`,
    preset_anchor_id: `manual_destination_${slot}`,
    anchor_label: `Destination ${slot}`,
    anchor_source_kind: "manual_map_click",
    resolution_status: "resolved_manual_map_click",
    resolved_longitude: selection.longitude,
    resolved_latitude: selection.latitude,
    cell_center_longitude: selection.cellCenterLongitude,
    cell_center_latitude: selection.cellCenterLatitude,
    importance_level: scoreEnabled ? "very_high" : "disabled",
    importance_weight: scoreEnabled ? 3 : 0,
  };

  let buckets = controls.buckets.map((bucket) => ({
    ...bucket,
    components: bucket.components.map((component) => ({ ...component })),
  }));
  if (scoreEnabled || buckets.some((bucket) => bucket.bucketId === "anchor_mobility" && bucket.active)) {
    const mobility = buckets.find((bucket) => bucket.bucketId === "anchor_mobility");
    if (!mobility) throw new Error("The fit contract does not expose anchor_mobility");
    if (!mobility.active) {
      const activeBuckets = buckets.filter((bucket) => bucket.active);
      mobility.active = true;
      mobility.weight = activeBuckets.length === 0 ? 1 : 1 / (activeBuckets.length + 1);
      for (const bucket of activeBuckets) {
        bucket.weight *= 1 - mobility.weight;
      }
      mobility.components = mobility.components.map((component) => ({
        ...component,
        active: component.componentId === "commute",
        weight: component.componentId === "commute" ? 1 : 0,
      }));
    } else {
      const commute = mobility.components.find((component) => component.componentId === "commute");
      if (!commute) throw new Error("The fit contract does not expose the commute component");
      if (!commute.active) {
        const activeComponents = mobility.components.filter((component) => component.active);
        commute.active = true;
        commute.weight = activeComponents.length === 0 ? 1 : 1 / (activeComponents.length + 1);
        for (const component of activeComponents) component.weight *= 1 - commute.weight;
      }
    }
  }
  buckets = buckets.map((bucket) => ({ ...bucket }));
  return {
    ...controls,
    anchors: [...controls.anchors, anchor],
    commuteEnabled: true,
    commuteTargets: { ...controls.commuteTargets, [criterionId]: 45 },
    buckets,
  };
}

export function setAnchorRoutingMode(
  controls: SearchControls,
  criterionInstanceId: string,
  routingMode: "transit" | "car",
): SearchControls {
  const anchor = controls.anchors.find(
    (candidate) => candidate.criterion_instance_id === criterionInstanceId,
  );
  if (!anchor || anchor.routing_mode === routingMode) return controls;
  return {
    ...controls,
    anchors: controls.anchors.map((candidate) => {
      if (candidate.criterion_instance_id !== criterionInstanceId) return candidate;
      return {
        ...candidate,
        routing_mode: routingMode,
        resolved_anchor_hash: [
          "browser_anchor_mode_v1",
          criterionInstanceId,
          candidate.matched_destination_cell_id,
          routingMode,
          candidate.resolved_longitude,
          candidate.resolved_latitude,
        ].join("_"),
      };
    }),
  };
}

export function removeAnchor(
  controls: SearchControls,
  criterionInstanceId: string,
): SearchControls {
  const anchors = controls.anchors.filter(
    (anchor) => anchor.criterion_instance_id !== criterionInstanceId,
  );
  if (anchors.length === controls.anchors.length) return controls;
  const commuteTargets = { ...controls.commuteTargets };
  delete commuteTargets[criterionInstanceId];
  if (anchors.length > 0) {
    return { ...controls, anchors, commuteTargets, commuteEnabled: true };
  }
  const buckets = controls.buckets.map((bucket) => {
    if (bucket.bucketId !== "anchor_mobility") return { ...bucket };
    const components = bucket.components.map((component) =>
      component.componentId === "commute"
        ? { ...component, active: false, weight: 0 }
        : { ...component }
    );
    const remaining = components.filter((component) => component.active);
    if (remaining.length === 0) {
      const applicable = components.filter(
        (component) => component.componentId !== "commute",
      );
      const preferred = applicable.filter((component) => component.defaultActive);
      const selected = preferred.length > 0 ? preferred : applicable;
      const selectedIds = new Set(selected.map((component) => component.componentId));
      const share = selectedIds.size > 0 ? 1 / selectedIds.size : 0;
      return {
        ...bucket,
        active: selectedIds.size > 0,
        weight: selectedIds.size > 0 ? bucket.weight : 0,
        components: components.map((component) => ({
          ...component,
          active: selectedIds.has(component.componentId),
          weight: selectedIds.has(component.componentId) ? share : 0,
        })),
      };
    }
    const total = remaining.reduce((sum, component) => sum + component.weight, 0);
    return {
      ...bucket,
      components: components.map((component) => ({
        ...component,
        weight: component.active
          ? (total > 0 ? component.weight / total : 1 / remaining.length)
          : 0,
      })),
    };
  });
  const activeBuckets = buckets.filter((bucket) => bucket.active);
  const total = activeBuckets.reduce((sum, bucket) => sum + bucket.weight, 0);
  return {
    ...controls,
    anchors,
    commuteTargets,
    commuteEnabled: false,
    buckets: buckets.map((bucket) => ({
      ...bucket,
      weight: bucket.active
        ? (total > 0 ? bucket.weight / total : 1 / activeBuckets.length)
        : 0,
    })),
  };
}

function stableStateHash(controls: SearchControls): string {
  const projection = {
    anchors: controls.anchors.map((anchor) => ({
      criterion_instance_id: anchor.criterion_instance_id,
      routing_mode: anchor.routing_mode,
      matched_destination_cell_id: anchor.matched_destination_cell_id,
      resolved_latitude: anchor.resolved_latitude,
      resolved_longitude: anchor.resolved_longitude,
    })),
    commuteEnabled: controls.commuteEnabled,
    commuteTargets: Object.fromEntries(
      Object.entries(controls.commuteTargets).sort(([left], [right]) => left.localeCompare(right)),
    ),
    budgetEnabled: controls.budgetEnabled,
    maxBudget: controls.maxBudget,
    bedroomsEnabled: controls.bedroomsEnabled,
    minimumBedrooms: controls.minimumBedrooms,
    buckets: controls.buckets.map((bucket) => ({
      id: bucket.bucketId,
      active: bucket.active,
      weight: bucket.weight,
      components: bucket.components.map((component) => ({
        id: component.componentId,
        active: component.active,
        weight: component.weight,
      })),
    })),
  };
  let hash = 0x811c9dc5;
  for (const character of JSON.stringify(projection)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function resolveSearchState(
  defaultState: ResolvedSearchState,
  contract: FitContract,
  controls: SearchControls,
  custom: boolean,
): ResolvedSearchState {
  if (!custom) return stateWithPrerequisiteIntegrity(defaultState);
  const state = clone(defaultState);
  const applicableControls = applyControlPrerequisiteIntegrity(controls);
  const searchStateId = `custom_from_${defaultState.search_state_id}`;
  const activeComponents = new Set(
    applicableControls.buckets.flatMap((bucket) =>
      bucket.active
        ? bucket.components.filter((component) => component.active).map((component) => component.componentId)
        : []
    ),
  );
  const commuteScoringEnabled = applicableControls.commuteEnabled && activeComponents.has("commute");
  if (applicableControls.commuteEnabled) {
    for (const anchor of applicableControls.anchors) {
      if (typeof applicableControls.commuteTargets[anchor.criterion_instance_id] !== "number") {
        throw new Error(`An enabled commute constraint requires target ${anchor.criterion_instance_id}`);
      }
    }
  }
  const definitionByKey = new Map(
    calibration(contract).components.map((component) => [
      `${component.bucket_id}\u0000${component.component_id}`,
      component,
    ]),
  );
  const existingByKey = new Map(
    state.components.map((component) => [
      `${component.bucket_id}\u0000${component.component_id}`,
      component,
    ]),
  );
  const existingAnchorCriteria = new Map(
    state.criteria
      .filter((criterion) => criterion.criterion_definition_id === "anchor_commute")
      .map((criterion) => [criterion.criterion_instance_id, criterion]),
  );
  const anchorCriteria: ResolvedCriterion[] = applicableControls.anchors.map((anchor) => {
    const existing = existingAnchorCriteria.get(anchor.criterion_instance_id);
    const target = applicableControls.commuteTargets[anchor.criterion_instance_id] ?? anchor.target_value_numeric;
    const configuredImportanceWeight = Number(anchor.importance_weight ?? 0);
    return {
      ...(existing ?? {}),
      search_state_id: searchStateId,
      criterion_instance_id: anchor.criterion_instance_id,
      criterion_definition_id: "anchor_commute",
      feature_contract_id: "anchor_commute_v1",
      bucket_id: "anchor_mobility",
      evaluator_kind: "distance_max",
      constraint_scope: "search_feasibility",
      score_enabled: commuteScoringEnabled,
      criterion_enabled: true,
      importance_level: String(
        commuteScoringEnabled && anchor.importance_level !== "disabled"
          ? anchor.importance_level ?? "very_high"
          : commuteScoringEnabled ? "very_high" : "disabled",
      ),
      importance_weight: commuteScoringEnabled
        ? configuredImportanceWeight > 0 ? configuredImportanceWeight : 3
        : 0,
      target_value_numeric: target,
      tolerance_kind: anchor.tolerance_kind,
      tolerance_value_numeric: boundedCommuteTolerance(
        target,
        anchor.tolerance_value_numeric,
      ),
      observable_limit_numeric: null,
      score_map_id: null,
      selection_mode: null,
      accepted_policy: null,
      resolved_criterion_hash: String(
        existing?.resolved_criterion_hash ?? `browser_${anchor.resolved_anchor_hash}`,
      ),
      configuration: {
        anchor_role: anchor.anchor_role,
        anchor_source_kind: String(anchor.anchor_source_kind ?? "manual_map_click"),
        routing_mode: anchor.routing_mode,
      },
    };
  });
  const components: ResolvedComponent[] = [];
  for (const bucket of applicableControls.buckets) {
    if (!bucket.active) continue;
    for (const control of bucket.components.filter((component) => component.active)) {
      if (!activeComponents.has(control.componentId)) continue;
      const key = `${bucket.bucketId}\u0000${control.componentId}`;
      const definition = definitionByKey.get(key);
      if (!definition) throw new Error(`Missing contract component ${key}`);
      components.push({
        ...(existingByKey.get(key) ?? {}),
        search_state_id: searchStateId,
        bucket_id: bucket.bucketId,
        component_id: control.componentId,
        component_weight: control.weight,
        criterion_ids: [...definition.criterion_ids],
        scoring_readiness: definition.scoring_readiness,
        resolution_source: existingByKey.has(key)
          ? "persona_override"
          : "fit_contract_selectable_component",
      });
    }
  }
  const criteriaSource = [
    ...state.criteria.filter((criterion) => criterion.criterion_definition_id !== "anchor_commute"),
    ...anchorCriteria,
  ];
  const criteria: ResolvedCriterion[] = criteriaSource.flatMap((criterion) => {
    const next = { ...criterion, search_state_id: searchStateId };
    if (criterion.criterion_definition_id === "anchor_commute") {
      if (!applicableControls.commuteEnabled) return [];
      const anchor = applicableControls.anchors.find(
        (candidate) => candidate.criterion_instance_id === criterion.criterion_instance_id,
      );
      if (anchor) {
        const target = applicableControls.commuteTargets[anchor.criterion_instance_id]!;
        next.target_value_numeric = target;
        next.tolerance_value_numeric = boundedCommuteTolerance(
          target,
          criterion.tolerance_value_numeric,
        );
      }
    } else if (criterion.criterion_definition_id === "max_budget") {
      next.target_value_numeric = applicableControls.maxBudget;
      next.criterion_enabled = applicableControls.budgetEnabled;
      next.constraint_scope = applicableControls.budgetEnabled ? "listing_eligibility" : "none";
      if (!applicableControls.budgetEnabled) {
        next.score_enabled = false;
        next.importance_weight = 0;
        next.importance_level = "disabled";
      }
    } else if (criterion.criterion_definition_id === "minimum_bedrooms") {
      next.target_value_numeric = applicableControls.minimumBedrooms;
      next.criterion_enabled = applicableControls.bedroomsEnabled;
      next.constraint_scope = applicableControls.bedroomsEnabled ? "listing_eligibility" : "none";
      if (!applicableControls.bedroomsEnabled) {
        next.score_enabled = false;
        next.importance_weight = 0;
        next.importance_level = "disabled";
      }
    }
    const componentId = BASE_CRITERION_COMPONENT[criterion.criterion_definition_id];
    if (componentId) {
      const enabled = activeComponents.has(componentId);
      next.criterion_enabled = enabled;
      next.score_enabled = enabled;
      next.importance_weight = enabled ? Math.max(criterion.importance_weight, 1) : 0;
      next.importance_level = enabled ? criterion.importance_level === "disabled" ? "standard" : criterion.importance_level : "disabled";
    }
    return [next];
  });
  state.anchors = applicableControls.commuteEnabled
    ? applicableControls.anchors.map((anchor) => {
        const target = applicableControls.commuteTargets[anchor.criterion_instance_id]!;
        const configuredImportanceWeight = Number(anchor.importance_weight ?? 0);
        return {
          ...anchor,
          search_state_id: searchStateId,
          score_enabled: commuteScoringEnabled,
          importance_level: commuteScoringEnabled && anchor.importance_level !== "disabled"
            ? anchor.importance_level ?? "very_high"
            : commuteScoringEnabled ? "very_high" : "disabled",
          importance_weight: commuteScoringEnabled
            ? configuredImportanceWeight > 0 ? configuredImportanceWeight : 3
            : 0,
          target_value_numeric: target,
          tolerance_value_numeric: boundedCommuteTolerance(
            target,
            anchor.tolerance_value_numeric,
          ),
        };
      })
    : [];
  state.buckets = state.buckets.map((bucket) => {
    const control = applicableControls.buckets.find((candidate) => candidate.bucketId === bucket.bucket_id);
    if (!control) throw new Error(`Missing bucket control ${bucket.bucket_id}`);
    return {
      ...bucket,
      search_state_id: searchStateId,
      bucket_enabled: control.active,
      bucket_weight: control.active ? control.weight : 0,
      active_components: control.active
        ? control.components.filter((component) => component.active).map((component) => component.componentId)
        : [],
      bucket_mode: control.active ? "score" : "inactive",
      score_bucket: control.active,
    };
  });
  state.criteria = criteria;
  state.components = components;
  state.search_state_id = searchStateId;
  state.base_search_state_id = defaultState.search_state_id;
  state.profile_mode = "custom";
  state.persona_id = null;
  state.user_fit_enabled = components.length > 0;
  state.resolved_search_state_hash = `browser_custom_${stableStateHash(applicableControls)}`;
  return stateWithPrerequisiteIntegrity(state);
}

export function activeWeightSums(controls: SearchControls): {
  bucketTotal: number;
  componentTotals: Record<string, number>;
} {
  return {
    bucketTotal: controls.buckets.reduce((sum, bucket) => sum + (bucket.active ? bucket.weight : 0), 0),
    componentTotals: Object.fromEntries(controls.buckets.map((bucket) => [
      bucket.bucketId,
      bucket.components.reduce(
        (sum, component) => sum + (component.active ? component.weight : 0),
        0,
      ),
    ])),
  };
}
