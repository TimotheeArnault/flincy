"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BedDouble,
  Building2,
  Car,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Gauge,
  MapPin,
  MapPinPlus,
  PiggyBank,
  Scale,
  ShoppingBasket,
  SlidersHorizontal,
  Sofa,
  Sparkles,
  TrainFront,
  Trash2,
  WalletCards,
} from "lucide-react";
import type { ResolvedAnchor, ResolvedSearchState } from "@fit/types.js";
import {
  BUDGET_LIMIT_DOMAIN,
  boundedCommuteTolerance,
  displayPercentages,
  hasCommutePriorityPrerequisite,
  setBucketActive,
  setBucketWeight,
  setComponentActive,
  setComponentWeight,
  setCommuteTarget,
  type SearchControls,
} from "@/lib/searchState";
import {
  PRIORITY_PRESETS,
  type DaFocusMode,
  type PriorityPresetId,
  type PrioritySelection,
} from "@/lib/frontendDa";
import {
  activeFunnelSteps,
  COMPONENT_LABELS,
  TRAVEL_FLEXIBILITY_HELP,
  WEIGHT_HELP,
  formatPrice,
  minimumBedroomsLimitCopy,
} from "@/lib/resultPresentation";
import type { FunnelCounts } from "@/lib/types";
import {
  MobileTrajectoryCard,
  TrajectoryIdentity,
  TrajectoryModeControl,
  trajectoryControlLabel,
} from "./TrajectoryControlParts";

const PRESET_ICONS = {
  balanced: Scale,
  economy: PiggyBank,
  mobility: TrainFront,
  proximity: MapPin,
  comfort: Sofa,
} satisfies Record<PriorityPresetId, typeof Scale>;

const BUCKET_LABELS: Record<string, string> = {
  financial_flexibility: "Budget & flexibilité",
  anchor_mobility: "Mobilité",
  daily_essentials: "Proximité",
  housing_comfort: "Confort du logement",
  building_features: "Caractéristiques de l’immeuble",
};

const BUCKET_ICONS: Record<string, typeof WalletCards> = {
  financial_flexibility: WalletCards,
  anchor_mobility: TrainFront,
  daily_essentials: ShoppingBasket,
  housing_comfort: Sofa,
  building_features: Building2,
};

function Toggle({ checked, disabled = false, label, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={checked ? "da-toggle active" : "da-toggle"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    ><span /></button>
  );
}

function LimitsDecision({
  controls,
  anchors,
  anchorLabels,
  funnel,
  state,
  mobileWorkspace,
  placementMode,
  placementBusy,
  destinationFeedback,
  onChange,
  onStartPlacement,
  onCancelPlacement,
  onRemoveAnchor,
  onSwitchAnchorMode,
}: {
  controls: SearchControls;
  anchors: ResolvedAnchor[];
  anchorLabels: Record<string, string>;
  funnel: FunnelCounts;
  state: ResolvedSearchState;
  mobileWorkspace: boolean;
  placementMode: "transit" | "car" | null;
  placementBusy: boolean;
  destinationFeedback: string | null;
  onChange: (controls: SearchControls) => void;
  onStartPlacement: (mode: "transit" | "car") => void;
  onCancelPlacement: () => void;
  onRemoveAnchor: (criterionInstanceId: string) => void;
  onSwitchAnchorMode: (criterionInstanceId: string, routingMode: "transit" | "car") => void;
}) {
  const controlsRef = useRef(controls);
  const activeCommuteRef = useRef<string | null>(null);
  const commuteFrameRef = useRef<number | null>(null);
  const pendingCommuteRef = useRef<{ criterionInstanceId: string; value: number } | null>(null);
  const lastPublishedRef = useRef<Record<string, number>>({});
  const [draftCommuteTargets, setDraftCommuteTargets] = useState<Record<string, number>>({});
  const funnelSteps = activeFunnelSteps(state, funnel);

  useEffect(() => {
    controlsRef.current = controls;
    setDraftCommuteTargets((current) => Object.fromEntries(
      Object.entries(current).filter(([criterionInstanceId, value]) => (
        activeCommuteRef.current === criterionInstanceId
        || controls.commuteTargets[criterionInstanceId] !== value
      )),
    ));
  }, [controls]);

  useEffect(() => () => {
    if (commuteFrameRef.current !== null) cancelAnimationFrame(commuteFrameRef.current);
  }, []);

  const publishCommuteTarget = useCallback((criterionInstanceId: string, value: number) => {
    if (lastPublishedRef.current[criterionInstanceId] === value) return;
    lastPublishedRef.current[criterionInstanceId] = value;
    const next = setCommuteTarget(controlsRef.current, criterionInstanceId, value);
    onChange(next.commuteEnabled ? next : { ...next, commuteEnabled: true });
  }, [onChange]);

  const scheduleCommuteTarget = useCallback((criterionInstanceId: string, value: number) => {
    pendingCommuteRef.current = { criterionInstanceId, value };
    if (commuteFrameRef.current !== null) return;
    commuteFrameRef.current = requestAnimationFrame(() => {
      commuteFrameRef.current = null;
      const pending = pendingCommuteRef.current;
      pendingCommuteRef.current = null;
      if (pending) publishCommuteTarget(pending.criterionInstanceId, pending.value);
    });
  }, [publishCommuteTarget]);

  const flushCommuteTarget = useCallback((criterionInstanceId: string) => {
    if (commuteFrameRef.current !== null) {
      cancelAnimationFrame(commuteFrameRef.current);
      commuteFrameRef.current = null;
    }
    const pending = pendingCommuteRef.current;
    pendingCommuteRef.current = null;
    const fallback = draftCommuteTargets[criterionInstanceId]
      ?? controlsRef.current.commuteTargets[criterionInstanceId];
    const value = pending?.criterionInstanceId === criterionInstanceId
      ? pending.value
      : fallback;
    if (typeof value === "number") publishCommuteTarget(criterionInstanceId, value);
    if (activeCommuteRef.current === criterionInstanceId) activeCommuteRef.current = null;
  }, [draftCommuteTargets, publishCommuteTarget]);

  const updateCommuteDraft = useCallback((criterionInstanceId: string, value: number) => {
    setDraftCommuteTargets((current) => ({ ...current, [criterionInstanceId]: value }));
    scheduleCommuteTarget(criterionInstanceId, value);
  }, [scheduleCommuteTarget]);

  return (
    <>
      <div className="decision-heading">
        <span className="eyebrow">VOS LIMITES</span>
        <h1>Qu’est-ce qui est non négociable&nbsp;?</h1>
        <p>Définissez les seuils qu’un logement doit respecter pour apparaître parmi vos correspondances.</p>
      </div>

      <section className="focus-control-section" aria-labelledby="focus-commute-heading">
        <div className="focus-section-heading">
          <h2 id="focus-commute-heading">Vos trajets</h2>
          {anchors.length > 0 && (
            <Toggle
              checked={controls.commuteEnabled}
              label="Activer les limites de trajet"
              onChange={(commuteEnabled) => onChange({ ...controls, commuteEnabled })}
            />
          )}
        </div>
        {anchors.length === 0 && <p className="focus-empty-note">Aucune destination définie.</p>}
        {anchors.map((anchor, index) => {
          const label = String(anchor.anchor_label ?? anchorLabels[String(anchor.preset_anchor_id)] ?? "Destination");
          const trajectoryLabel = trajectoryControlLabel(label, index, mobileWorkspace);
          const target = draftCommuteTargets[anchor.criterion_instance_id]
            ?? controls.commuteTargets[anchor.criterion_instance_id]
            ?? anchor.target_value_numeric;
          const tolerance = boundedCommuteTolerance(target, anchor.tolerance_value_numeric);
          const sliderControl = (
            <input
              type="range"
              min={15}
              max={90}
              step={1}
              value={target}
              data-testid={`focus-commute-${anchor.criterion_instance_id}`}
              aria-label={mobileWorkspace ? `Temps de trajet maximal pour ${trajectoryLabel}` : undefined}
              aria-description={TRAVEL_FLEXIBILITY_HELP}
              title={TRAVEL_FLEXIBILITY_HELP}
              onPointerDown={() => {
                activeCommuteRef.current = anchor.criterion_instance_id;
                lastPublishedRef.current[anchor.criterion_instance_id] = controls.commuteTargets[anchor.criterion_instance_id]
                  ?? anchor.target_value_numeric;
              }}
              onKeyDown={() => {
                activeCommuteRef.current = anchor.criterion_instance_id;
                lastPublishedRef.current[anchor.criterion_instance_id] = controls.commuteTargets[anchor.criterion_instance_id]
                  ?? anchor.target_value_numeric;
              }}
              onChange={(event) => updateCommuteDraft(anchor.criterion_instance_id, Number(event.currentTarget.value))}
              onPointerUp={() => flushCommuteTarget(anchor.criterion_instance_id)}
              onPointerCancel={() => flushCommuteTarget(anchor.criterion_instance_id)}
              onLostPointerCapture={() => flushCommuteTarget(anchor.criterion_instance_id)}
              onKeyUp={() => flushCommuteTarget(anchor.criterion_instance_id)}
              onBlur={() => flushCommuteTarget(anchor.criterion_instance_id)}
            />
          );
          if (mobileWorkspace) {
            return (
              <MobileTrajectoryCard
                key={anchor.criterion_instance_id}
                criterionInstanceId={anchor.criterion_instance_id}
                enabled={controls.commuteEnabled}
                slotIndex={index}
                variant="focus"
                label={trajectoryLabel}
                routingMode={anchor.routing_mode}
                removeDisabled={placementBusy}
                onRemove={() => onRemoveAnchor(anchor.criterion_instance_id)}
                onSwitch={(routingMode) => onSwitchAnchorMode(anchor.criterion_instance_id, routingMode)}
                duration={<strong>{target} min</strong>}
                tolerance={tolerance}
                slider={sliderControl}
              />
            );
          }
          return (
            <article className={`focus-commute-control${controls.commuteEnabled ? "" : " is-dormant"}`} data-control-state={controls.commuteEnabled ? "active" : "dormant"} data-trajectory-slot={index + 1} data-trajectory-variant="focus" key={anchor.criterion_instance_id}>
              <header>
                <span className="focus-control-icon"><Clock3 size={18} /></span>
                <TrajectoryIdentity
                  label={trajectoryLabel}
                  routingMode={anchor.routing_mode}
                  testId={`focus-anchor-label-${anchor.criterion_instance_id}`}
                />
                <button
                  type="button"
                  className="focus-anchor-remove"
                  aria-label={`Retirer ${trajectoryLabel}`}
                  data-testid={`focus-remove-anchor-${anchor.criterion_instance_id}`}
                  disabled={placementBusy}
                  onClick={() => onRemoveAnchor(anchor.criterion_instance_id)}
                ><Trash2 size={15} /></button>
              </header>
              <div className="focus-anchor-meta">
                <TrajectoryModeControl
                  label={trajectoryLabel}
                  routingMode={anchor.routing_mode}
                  testIdPrefix={`focus-anchor-mode-${anchor.criterion_instance_id}`}
                  disabled={placementBusy}
                  onSwitch={(routingMode) => onSwitchAnchorMode(anchor.criterion_instance_id, routingMode)}
                />
                <strong>{target} min</strong>
              </div>
              <label>
                <span>Limite de trajet</span>
                {sliderControl}
              </label>
              <div className="focus-scale"><span>15</span><span>45</span><span>90 min</span></div>
            </article>
          );
        })}
        {anchors.length < 2 && (
          <div className="focus-destination-entry">
            {placementMode ? (
              <button type="button" className="destination-add active" data-testid="focus-cancel-destination-placement" onClick={onCancelPlacement}>Annuler le placement</button>
            ) : (
              <button
                type="button"
                className="destination-add"
                data-testid="focus-add-destination"
                disabled={placementBusy}
                onClick={() => onStartPlacement("transit")}
              ><MapPinPlus size={15} /> Ajouter une destination</button>
            )}
            {placementMode && <p className="placement-instruction" role="status">Cliquez sur la carte pour placer la destination.</p>}
          </div>
        )}
        {destinationFeedback && <p className="destination-feedback focus-destination-feedback" role="status">{destinationFeedback}</p>}
      </section>

      <section className="focus-control-section" aria-labelledby="focus-home-heading">
        <h2 id="focus-home-heading">Le logement</h2>
        <div className="focus-home-grid">
          <article className={`focus-home-control${controls.budgetEnabled ? "" : " is-dormant"}`} data-control-state={controls.budgetEnabled ? "active" : "dormant"}>
            <header><span><WalletCards size={17} />Budget maximum</span><Toggle checked={controls.budgetEnabled} label="Activer le budget maximum" onChange={(budgetEnabled) => onChange({ ...controls, budgetEnabled })} /></header>
            <strong>{formatPrice(controls.maxBudget)}</strong>
            <input
              type="range"
              min={BUDGET_LIMIT_DOMAIN.min}
              max={BUDGET_LIMIT_DOMAIN.max}
              step={BUDGET_LIMIT_DOMAIN.step}
              value={controls.maxBudget}
              data-testid="focus-budget-slider"
              aria-label="Budget maximum"
              onChange={(event) => onChange({ ...controls, budgetEnabled: true, maxBudget: Number(event.currentTarget.value) })}
            />
            <div className="focus-scale"><span>{formatPrice(BUDGET_LIMIT_DOMAIN.min)}</span><span>{formatPrice((BUDGET_LIMIT_DOMAIN.min + BUDGET_LIMIT_DOMAIN.max) / 2)}</span><span>{formatPrice(BUDGET_LIMIT_DOMAIN.max)}</span></div>
            <small>{controls.budgetEnabled ? "Cette limite est appliquée." : "Limite inactive · valeur mémorisée."}</small>
          </article>
          <article className={`focus-home-control${controls.bedroomsEnabled ? "" : " is-dormant"}`} data-control-state={controls.bedroomsEnabled ? "active" : "dormant"}>
            <header><span><BedDouble size={17} />Chambres minimum</span><Toggle checked={controls.bedroomsEnabled} label="Activer le minimum de chambres" onChange={(bedroomsEnabled) => onChange({ ...controls, bedroomsEnabled })} /></header>
            <div className="focus-bedroom-options" role="group" aria-label="Chambres minimum">
              {[[0, "Studio"], [1, "1"], [2, "2"], [3, "3"], [4, "4+"]].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={controls.bedroomsEnabled && controls.minimumBedrooms === value}
                  className={controls.bedroomsEnabled && controls.minimumBedrooms === value ? "active" : controls.minimumBedrooms === value ? "dormant-selected" : ""}
                  data-testid={`focus-bedrooms-${value}`}
                  onClick={() => onChange({ ...controls, bedroomsEnabled: true, minimumBedrooms: Number(value) })}
                >{label}</button>
              ))}
            </div>
            <small>{controls.bedroomsEnabled ? minimumBedroomsLimitCopy(controls.minimumBedrooms) : "Tous les formats restent admissibles."}</small>
          </article>
        </div>
      </section>

      <div className="focus-consequence-summary" aria-live="polite" data-testid="focus-funnel">
        <Gauge size={21} />
        {funnelSteps.map((step, index) => (
          <span className="focus-summary-step" data-funnel-step={step.id} key={step.id}>
            {index > 0 && <ChevronRight className="focus-summary-arrow" size={16} aria-hidden="true" />}
            <strong>{step.value}</strong><span>{step.label}</span>
          </span>
        ))}
      </div>
    </>
  );
}

function PrioritiesDecision({
  controls,
  selection,
  previewSelection,
  onSelectPreset,
  onPreviewPreset,
  onClearPreview,
  onCustomVisibilityChange,
  onCustomize,
}: {
  controls: SearchControls;
  selection: PrioritySelection;
  previewSelection: PriorityPresetId | null;
  onSelectPreset: (presetId: PriorityPresetId) => void;
  onPreviewPreset: (presetId: PriorityPresetId) => void;
  onClearPreview: () => void;
  onCustomVisibilityChange: (open: boolean) => void;
  onCustomize: (controls: SearchControls) => void;
}) {
  const [showCustom, setShowCustom] = useState(selection === "custom");
  const [expandedBuckets, setExpandedBuckets] = useState(() => new Set(["anchor_mobility"]));
  const display = useMemo(() => displayPercentages(
    controls.buckets.map((bucket) => ({ id: bucket.bucketId, active: bucket.active, weight: bucket.weight })),
  ), [controls.buckets]);
  const activeCount = controls.buckets.filter((bucket) => bucket.active).length;
  const commuteApplicable = hasCommutePriorityPrerequisite(controls);
  return (
    <>
      <div className="decision-heading">
        <span className="eyebrow">Priorités de classement</span>
        <h1>Comment voulez-vous départager les logements qui restent&nbsp;?</h1>
        <p>Vos limites définissent ce qui est possible. Vos priorités changent seulement l’ordre.</p>
      </div>
      <div className="priority-preset-grid" role="radiogroup" aria-label="Preset de priorités">
        {PRIORITY_PRESETS.map((preset) => {
          const Icon = PRESET_ICONS[preset.id];
          const disabled = Boolean(preset.requiresBudget && !controls.budgetEnabled);
          const selected = selection === preset.id;
          const previewed = previewSelection === preset.id;
          const status = disabled ? "disabled" : selected ? "selected" : previewed ? "preview" : null;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-describedby={disabled ? `preset-help-${preset.id}` : undefined}
              className={`priority-preset${selected ? " selected" : ""}${previewed ? " previewed" : ""}`}
              key={preset.id}
              disabled={disabled}
              data-testid={`priority-preset-${preset.id}`}
              onMouseEnter={() => !disabled && onPreviewPreset(preset.id)}
              onMouseLeave={onClearPreview}
              onFocus={() => !disabled && onPreviewPreset(preset.id)}
              onBlur={onClearPreview}
              onClick={() => onSelectPreset(preset.id)}
            >
              <Icon size={29} aria-hidden="true" />
              <strong>{preset.label}</strong>
              <span>{preset.description}</span>
              <small
                className={`priority-preset-status${status ? " is-visible" : ""}`}
                id={disabled ? `preset-help-${preset.id}` : undefined}
                aria-hidden={status ? undefined : true}
              >
                {status === "selected" && <Check size={13} aria-hidden="true" />}
                {status === "preview" && <Sparkles size={13} aria-hidden="true" />}
                {status === "selected" ? "Sélectionné" : status === "preview" ? "Aperçu" : status === "disabled" ? "Définissez un budget" : ""}
              </small>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="custom-priorities-toggle"
        aria-expanded={showCustom}
        data-testid="customize-priorities"
        onClick={() => setShowCustom((current) => {
          const next = !current;
          onCustomVisibilityChange(next);
          return next;
        })}
      ><SlidersHorizontal size={18} />Personnaliser mes priorités<ChevronRight size={16} aria-hidden="true" /></button>

      {showCustom && (
        <section className="priority-customizer" data-testid="priority-customizer">
          <header><strong>{selection === "custom" ? "Priorités personnalisées" : "Composition du preset"}</strong><span>Répartition totale&nbsp;: 100&nbsp;%</span></header>
          {controls.buckets.map((bucket) => {
            const disabled = bucket.bucketId === "financial_flexibility" && !controls.budgetEnabled;
            const Icon = BUCKET_ICONS[bucket.bucketId] ?? SlidersHorizontal;
            const expanded = expandedBuckets.has(bucket.bucketId);
            const activeComponentCount = bucket.components.filter((component) => component.active).length;
            const componentDisplay = displayPercentages(
              bucket.components.map((component) => ({
                id: component.componentId,
                active: component.active,
                weight: component.weight,
              })),
            );
            return (
              <article className={`focus-priority-bucket${bucket.active ? " active" : ""}`} key={bucket.bucketId}>
                <div className="priority-custom-row">
                  <button
                    type="button"
                    className="focus-bucket-expand"
                    aria-expanded={expanded}
                    data-testid={`focus-bucket-expand-${bucket.bucketId}`}
                    onClick={() => setExpandedBuckets((current) => {
                      const next = new Set(current);
                      if (next.has(bucket.bucketId)) next.delete(bucket.bucketId);
                      else next.add(bucket.bucketId);
                      return next;
                    })}
                  >
                    <Icon size={17} />
                    <span><strong>{BUCKET_LABELS[bucket.bucketId] ?? "Critère"}</strong><small className={disabled ? "priority-prerequisite-help" : undefined}>{disabled ? "Ajoutez une limite de budget pour utiliser cette priorité." : `${activeComponentCount} critère${activeComponentCount > 1 ? "s" : ""}`}</small></span>
                    {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  <input
                    type="range"
                    min={5}
                    max={95}
                    step={1}
                    value={display[bucket.bucketId] ?? 0}
                    disabled={disabled || (bucket.active && activeCount <= 1)}
                    aria-label={`Poids ${BUCKET_LABELS[bucket.bucketId] ?? "Critère"}`}
                    aria-description={WEIGHT_HELP}
                    title={WEIGHT_HELP}
                    data-testid={`focus-bucket-${bucket.bucketId}`}
                    onChange={(event) => {
                      const activeControls = bucket.active
                        ? controls
                        : setBucketActive(controls, bucket.bucketId, true);
                      onCustomize(setBucketWeight(activeControls, bucket.bucketId, Number(event.currentTarget.value) / 100));
                    }}
                  />
                  <strong>{display[bucket.bucketId] ?? 0}&nbsp;%</strong>
                  <Toggle
                    checked={bucket.active}
                    disabled={disabled || (bucket.active && activeCount <= 1)}
                    label={`${bucket.active ? "Désactiver" : "Activer"} ${BUCKET_LABELS[bucket.bucketId] ?? "Critère"}`}
                    onChange={(active) => !disabled && onCustomize(setBucketActive(controls, bucket.bucketId, active))}
                  />
                </div>
                {expanded && (
                  <div className="focus-component-list" data-testid={`focus-components-${bucket.bucketId}`}>
                    {bucket.components.map((component) => {
                      const componentLabel = COMPONENT_LABELS[component.componentId] ?? "Critère";
                      const prerequisiteMissing = component.componentId === "commute" && !commuteApplicable;
                      return (
                        <div className="focus-component-row" data-prerequisite-missing={prerequisiteMissing || undefined} key={component.componentId}>
                          <span><strong>{componentLabel}</strong>{prerequisiteMissing ? <small className="priority-prerequisite-help">Ajoutez un trajet pour utiliser ce critère.</small> : component.scoringReadiness === "SELECTABLE_ONLY" && <small>Optionnel</small>}</span>
                          <input
                            type="range"
                            min={5}
                            max={95}
                            step={1}
                            value={componentDisplay[component.componentId] ?? 0}
                            disabled={prerequisiteMissing || !bucket.active || (component.active && activeComponentCount <= 1)}
                            aria-label={`Poids ${componentLabel}`}
                            aria-description={WEIGHT_HELP}
                            title={WEIGHT_HELP}
                            data-testid={`focus-component-${bucket.bucketId}-${component.componentId}`}
                            onChange={(event) => {
                              const activeControls = component.active
                                ? controls
                                : setComponentActive(controls, bucket.bucketId, component.componentId, true);
                              onCustomize(setComponentWeight(activeControls, bucket.bucketId, component.componentId, Number(event.currentTarget.value) / 100));
                            }}
                          />
                          <strong>{componentDisplay[component.componentId] ?? 0}&nbsp;%</strong>
                          <Toggle
                            checked={component.active}
                            disabled={prerequisiteMissing || !bucket.active || (component.active && activeComponentCount <= 1)}
                            label={`${component.active ? "Désactiver" : "Activer"} ${componentLabel}`}
                            onChange={(active) => onCustomize(setComponentActive(controls, bucket.bucketId, component.componentId, active))}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}

export default function DecisionFocus({
  mode,
  controls,
  anchors,
  anchorLabels,
  funnel,
  state,
  mobileWorkspace,
  prioritySelection,
  priorityPreview,
  onChange,
  onSelectPreset,
  onPreviewPreset,
  onClearPreview,
  onCustomizePriorities,
  onCustomVisibilityChange,
  placementMode,
  placementBusy,
  destinationFeedback,
  onStartPlacement,
  onCancelPlacement,
  onRemoveAnchor,
  onSwitchAnchorMode,
  onBack,
}: {
  mode: Exclude<DaFocusMode, "none">;
  controls: SearchControls;
  anchors: ResolvedAnchor[];
  anchorLabels: Record<string, string>;
  funnel: FunnelCounts;
  state: ResolvedSearchState;
  mobileWorkspace: boolean;
  prioritySelection: PrioritySelection;
  priorityPreview: PriorityPresetId | null;
  onChange: (controls: SearchControls) => void;
  onSelectPreset: (presetId: PriorityPresetId) => void;
  onPreviewPreset: (presetId: PriorityPresetId) => void;
  onClearPreview: () => void;
  onCustomizePriorities: (controls: SearchControls) => void;
  onCustomVisibilityChange: (open: boolean) => void;
  placementMode: "transit" | "car" | null;
  placementBusy: boolean;
  destinationFeedback: string | null;
  onStartPlacement: (mode: "transit" | "car") => void;
  onCancelPlacement: () => void;
  onRemoveAnchor: (criterionInstanceId: string) => void;
  onSwitchAnchorMode: (criterionInstanceId: string, routingMode: "transit" | "car") => void;
  onBack: () => void;
}) {
  return (
    <section className={`decision-stage decision-${mode}`} data-testid={`${mode}-focus`}>
      <div className="decision-stage-scroll">
        <button type="button" className="decision-back" data-testid="back-to-search" onClick={onBack}><ArrowLeft size={18} />Recherche</button>
        {mode === "limits" ? (
          <LimitsDecision
            controls={controls}
            anchors={anchors}
            anchorLabels={anchorLabels}
            funnel={funnel}
            state={state}
            mobileWorkspace={mobileWorkspace}
            placementMode={placementMode}
            placementBusy={placementBusy}
            destinationFeedback={destinationFeedback}
            onChange={onChange}
            onStartPlacement={onStartPlacement}
            onCancelPlacement={onCancelPlacement}
            onRemoveAnchor={onRemoveAnchor}
            onSwitchAnchorMode={onSwitchAnchorMode}
          />
        ) : (
          <PrioritiesDecision
            controls={controls}
            selection={prioritySelection}
            previewSelection={priorityPreview}
            onSelectPreset={onSelectPreset}
            onPreviewPreset={onPreviewPreset}
            onClearPreview={onClearPreview}
            onCustomVisibilityChange={onCustomVisibilityChange}
            onCustomize={onCustomizePriorities}
          />
        )}
      </div>
    </section>
  );
}
