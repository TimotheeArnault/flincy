"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Info,
  LocateFixed,
  Minus,
} from "lucide-react";
import type { FitEvaluationResult, ResolvedSearchState } from "@fit/types.js";
import {
  FIT_SCORE_DEFINITION,
  LIFE_SCORE_DEFINITION,
  OBJECTIVE_SCORE_DEFINITION,
  PUBLIC_AXIS_LABELS,
  anchorCommutes,
  compactFitCoverageLabel,
  componentScoreLabel,
  displayFactClass,
  displayFactLabel,
  displayFactValue,
  displayFamilyLabel,
  detailedFitCoverageLabel,
  detailFactDecisionNotes,
  explanationItems,
  fitBucketContributions,
  fitScoreForPresentation,
  formatCalendarDate,
  formatPrice,
  groupCapabilities,
  isUnknownFact,
  lifeScoreContributions,
  materialDetailCautions,
  objectiveNumber,
  objectiveScoreContributions,
  partitionDetailCapabilities,
  provenanceLabel,
  rankingExplanationItems,
  resultBand,
  resultStatusLabel,
  scoreLabel,
  utilityDisplayRows,
  type DetailFactDecisionNote,
} from "@/lib/resultPresentation";
import type {
  FrontendListing,
  PublicDisplayCapability,
  PublicDisplayFact,
} from "@/lib/types";
import PinAction from "./PinAction";

type ScoreAxis = "fit" | "objective" | "life";

interface ScoreAxisPresentation {
  id: ScoreAxis;
  label: string;
  score: number | null;
  definition: string;
  coverageLabel?: string | null;
}

function factFor(listing: FrontendListing, key: string): PublicDisplayFact {
  return listing.display_facts[key] ?? {
    status: "missing",
    value: null,
    provenance: "missing_public_projection",
  };
}

function FactRow({ capability, fact, decisionNote, showProvenance = false }: {
  capability: PublicDisplayCapability;
  fact: PublicDisplayFact;
  decisionNote?: DetailFactDecisionNote;
  showProvenance?: boolean;
}) {
  const label = displayFactLabel(capability.feature_key);
  if (!label) return null;
  const provenance = provenanceLabel(fact.provenance);
  if (capability.feature_key === "utilities_atomic") {
    const utilityRows = utilityDisplayRows(fact);
    if (utilityRows.length === 0) return null;
    return (
      <div className="fact-row utilities-fact-row" data-feature-key={capability.feature_key}>
        <span>Services inclus</span>
        <div className="utility-tristate-list">
          {utilityRows.map((row) => (
            <span className={`utility-tristate ${row.status}`} key={row.featureKey} data-utility-key={row.featureKey}>
              <span>{row.label}</span><strong>{row.value}</strong>
            </span>
          ))}
        </div>
        {showProvenance && provenance && <small className="fact-provenance"><Info size={11} />{provenance}</small>}
      </div>
    );
  }
  const displayValue = capability.feature_key === "available_date"
    ? formatCalendarDate(fact.value) ?? displayFactValue(fact, capability.feature_key)
    : displayFactValue(fact, capability.feature_key);
  if (displayValue === null) return null;
  return (
    <div className={`fact-row ${displayFactClass(fact)}${decisionNote ? " has-decision-note" : ""}`} data-feature-key={capability.feature_key}>
      <span>{label}</span>
      <strong>{displayValue}</strong>
      {decisionNote && (
        <small className={`fact-decision-note status-${decisionNote.status}`}>
          <span>{decisionNote.limitLabel}</span>
          <em>{decisionNote.deltaLabel}</em>
        </small>
      )}
      {showProvenance && provenance && <small className="fact-provenance"><Info size={11} />{provenance}</small>}
    </div>
  );
}

function UtilitiesSubgroup({ fact }: { fact: PublicDisplayFact }) {
  const utilityRows = utilityDisplayRows(fact);
  if (utilityRows.length === 0) return null;
  return (
    <section className="included-services-subgroup" data-feature-key="utilities_atomic">
      <h4>Services inclus</h4>
      <div className="included-services-grid">
        {utilityRows.map((row) => (
          <div className={`fact-row utility-service-row ${row.status}`} key={row.featureKey} data-utility-key={row.featureKey}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function HousingFacts({
  listing,
  capabilities,
  decisionNotes,
}: {
  listing: FrontendListing;
  capabilities: PublicDisplayCapability[];
  decisionNotes: Partial<Record<string, DetailFactDecisionNote>>;
}) {
  if (capabilities.length === 0) return null;
  const utilityCapability = capabilities.find((capability) => capability.feature_key === "utilities_atomic");
  const factCapabilities = capabilities.filter((capability) => capability.feature_key !== "utilities_atomic");
  return (
    <section className="housing-facts" data-testid="housing-facts">
      <h3>Le logement</h3>
      {factCapabilities.length > 0 && <div className="fact-grid">
        {factCapabilities.map((capability) => (
          <FactRow
            key={capability.feature_key}
            capability={capability}
            fact={factFor(listing, capability.feature_key)}
            decisionNote={decisionNotes[capability.feature_key]}
          />
        ))}
      </div>}
      {utilityCapability && <UtilitiesSubgroup fact={factFor(listing, utilityCapability.feature_key)} />}
    </section>
  );
}

function AdditionalDetails({
  listing,
  capabilities,
}: {
  listing: FrontendListing;
  capabilities: PublicDisplayCapability[];
}) {
  if (capabilities.length === 0) return null;
  const groups = groupCapabilities(capabilities);
  return (
    <details className="additional-details" data-testid="additional-details">
      <summary>Détails complémentaires <ChevronDown size={16} /></summary>
      <div className="additional-details-content">
        {groups.map(([family, rows]) => (
          <section className="additional-detail-group" key={family}>
            {rows.some((capability) => capability.feature_key !== "utilities_atomic") && (
              <h4>{displayFamilyLabel(family)}</h4>
            )}
            {rows.some((capability) => capability.feature_key !== "utilities_atomic") && <div className={`fact-grid fact-count-${Math.min(rows.filter((capability) => capability.feature_key !== "utilities_atomic").length, 3)}`}>
              {rows.filter((capability) => capability.feature_key !== "utilities_atomic").map((capability) => (
                <FactRow
                  key={capability.feature_key}
                  capability={capability}
                  fact={factFor(listing, capability.feature_key)}
                />
              ))}
            </div>}
            {rows.find((capability) => capability.feature_key === "utilities_atomic") && (
              <UtilitiesSubgroup fact={factFor(listing, "utilities_atomic")} />
            )}
          </section>
        ))}
      </div>
    </details>
  );
}

function QaFactInventory({
  listing,
  capabilities,
}: {
  listing: FrontendListing;
  capabilities: PublicDisplayCapability[];
}) {
  const publicCapabilities = capabilities.filter((capability) =>
    displayFactLabel(capability.feature_key) !== null
  );
  const groupedAll = groupCapabilities(publicCapabilities);
  return (
    <details className="qa-all-facts" data-testid="qa-all-facts">
      <summary>Afficher tous les faits QA <span>{publicCapabilities.length}</span></summary>
      {groupedAll.map(([family, rows]) => (
        <section key={family}>
          <h4>{displayFamilyLabel(family)}</h4>
          <div className="fact-grid">
            {rows.map((capability) => (
              <FactRow
                key={capability.feature_key}
                capability={capability}
                fact={factFor(listing, capability.feature_key)}
                showProvenance
              />
            ))}
          </div>
        </section>
      ))}
    </details>
  );
}

function FitScorePanel({ result }: { result: FitEvaluationResult }) {
  const explanation = explanationItems(result);
  const coverageLabel = detailedFitCoverageLabel(result);
  const publicBuckets = fitBucketContributions(result);
  const hasReasons = explanation.tradeoffs.length > 0 ||
    explanation.unknown.length > 0;
  return (
    <div className="score-detail fit-detail" data-testid="fit-score-detail">
      <p className="fit-definition">{FIT_SCORE_DEFINITION}</p>
      {coverageLabel && <div className="score-detail-summary"><span>{coverageLabel}</span></div>}
      {hasReasons && <div className="fit-reasons">
        {explanation.unknown.length > 0 && <section><h4>Information manquante</h4>{explanation.unknown.map((item) => <p key={item}><CircleHelp size={13} />{item}</p>)}</section>}
        {explanation.tradeoffs.length > 0 && <section><h4>Compromis</h4>{explanation.tradeoffs.map((item) => <p key={item}><Minus size={13} />{item}</p>)}</section>}
      </div>}
      {publicBuckets.length > 0 && <div className="bucket-score-list">
        {publicBuckets.map((bucket) => (
          <div
            key={bucket.id}
            data-score-contribution={bucket.id}
            data-earned={bucket.earned ?? undefined}
            data-possible={bucket.possible}
          >
            <span>{bucket.label}</span>
            <strong>{componentScoreLabel(bucket.earned, bucket.possible)}</strong>
            {bucket.earned !== null && typeof bucket.coveragePercent === "number" && bucket.coveragePercent > 0 && bucket.coveragePercent < 100 && (
              <small>{Math.round(bucket.coveragePercent)} % évalué</small>
            )}
          </div>
        ))}
      </div>}
    </div>
  );
}

function ObjectiveScorePanel({ listing }: { listing: FrontendListing }) {
  const components = objectiveScoreContributions(listing);
  const benchmarkMedian = objectiveNumber(listing, "benchmark_median_price");
  const benchmarkCount = objectiveNumber(listing, "benchmark_listing_count");
  const benchmarkDifference = objectiveNumber(listing, "price_vs_benchmark_pct");
  return (
    <div className="score-detail objective-detail" data-testid="objective-score-detail">
      <p className="score-definition">{OBJECTIVE_SCORE_DEFINITION}</p>
      {components.length > 0 && <div className="objective-components">
        {components.map((component) => (
          <span
            key={component.id}
            data-objective-component={component.id}
            data-score-contribution={component.id}
            data-earned={component.earned ?? undefined}
            data-possible={component.possible}
          >
            {component.label}
            <strong>{componentScoreLabel(component.earned, component.possible)}</strong>
          </span>
        ))}
      </div>}
      {benchmarkMedian !== null && benchmarkCount !== null && (
        <p>Loyer médian de référence : <strong>{formatPrice(benchmarkMedian)}</strong> · {benchmarkCount} annonces.</p>
      )}
      {benchmarkDifference !== null && (
        <p>Écart avec le loyer de référence : <strong>{benchmarkDifference} %</strong>.</p>
      )}
    </div>
  );
}

function LifeScorePanel({ listing }: { listing: FrontendListing }) {
  const publicComponents = lifeScoreContributions(listing);
  return (
    <div className="score-detail life-detail" data-testid="life-score-detail">
      <p className="score-definition">{LIFE_SCORE_DEFINITION}</p>
      {publicComponents.length > 0 && <div className="life-component-list">
        {publicComponents.map((component) => (
          <div
            key={component.id}
            data-score-contribution={component.id}
            data-earned={component.earned ?? undefined}
            data-possible={component.possible}
          >
            <span>{component.label}</span>
            <strong>{componentScoreLabel(component.earned, component.possible)}</strong>
          </div>
        ))}
      </div>}
    </div>
  );
}

export default function ListingDetail({
  listing,
  result,
  state,
  anchorLabels,
  capabilities,
  qaMode,
  pinned,
  pinDisabled,
  rankMovement,
  onToggleCompare,
  onLocalize,
  onBack,
}: {
  listing: FrontendListing;
  result: FitEvaluationResult;
  state: ResolvedSearchState;
  anchorLabels: Record<string, string>;
  capabilities: PublicDisplayCapability[];
  qaMode: boolean;
  pinned: boolean;
  pinDisabled: boolean;
  rankMovement: number;
  onToggleCompare: () => void;
  onLocalize: () => void;
  onBack: () => void;
}) {
  const [openScore, setOpenScore] = useState<ScoreAxis | null>(null);
  const commutes = anchorCommutes(result, listing, state, anchorLabels);
  const factPartitions = useMemo(
    () => partitionDetailCapabilities(capabilities, listing.display_facts, state),
    [capabilities, listing.display_facts, state],
  );
  const housingCapabilities = [
    ...factPartitions.essential,
    ...factPartitions.activeDecision,
  ];
  const cautionItems = materialDetailCautions(listing, state, factPartitions.unknownEssential);
  const whyItems = rankingExplanationItems(result);
  const decisionNotes = detailFactDecisionNotes(result, state);
  const axes: ScoreAxisPresentation[] = [
    ...(state.user_fit_enabled
      ? [{
          id: "fit" as const,
          label: "Votre adéquation",
          score: fitScoreForPresentation(result),
          definition: FIT_SCORE_DEFINITION,
          coverageLabel: compactFitCoverageLabel(result),
        }]
      : []),
    {
      id: "objective",
      label: PUBLIC_AXIS_LABELS.objective,
      score: objectiveNumber(listing, "objective_score"),
      definition: OBJECTIVE_SCORE_DEFINITION,
    },
    {
      id: "life",
      label: PUBLIC_AXIS_LABELS.life,
      score: typeof listing.life_centric?.score === "number" ? listing.life_centric.score : null,
      definition: LIFE_SCORE_DEFINITION,
    },
  ];
  const displayedOpenScore = axes.some((axis) => axis.id === openScore) ? openScore : null;
  const band = resultBand(result);
  const statusLabel = resultStatusLabel(result);
  const canLocalize = typeof listing.geography.latitude === "number" &&
    typeof listing.geography.longitude === "number";
  const listingTitle = listing.display.title ?? "Location résidentielle";
  const bedroomsFact = factFor(listing, "bedrooms");
  const bedrooms = isUnknownFact(bedroomsFact)
    ? null
    : displayFactValue(bedroomsFact, "bedrooms");
  const areaFact = factFor(listing, "area_sqft");
  const area = isUnknownFact(areaFact)
    ? null
    : displayFactValue(areaFact, "area_sqft");
  const propertyTypeFact = factFor(listing, "property_type");
  const propertyType = isUnknownFact(propertyTypeFact)
    ? null
    : displayFactValue(propertyTypeFact, "property_type");
  const sourceListingUrl = typeof listing.source.listing_url === "string" &&
    /^https?:\/\//i.test(listing.source.listing_url)
    ? listing.source.listing_url
    : null;

  return (
    <aside
      id="right-panel"
      className={`ranked-panel listing-inspector band-${band}`}
      data-testid="selected-listing"
      data-fit-coverage={result.user_fit_enabled ? result.coverage_class : undefined}
    >
      <header className="listing-inspector-header">
        <div className="detail-header-toolbar">
          <button className="detail-back-button" type="button" aria-label="Retour aux résultats" data-testid="detail-back-results" onClick={onBack}><ArrowLeft size={18} /><span>Résultats</span></button>
          <span className={`detail-header-status status-${band}`}><strong>{statusLabel}</strong></span>
          <span className="detail-header-actions">
            <PinAction pinned={pinned} limitReached={pinDisabled} onClick={onToggleCompare} />
          </span>
        </div>
        <div className="detail-header-summary">
          <span className="selected-kicker">
            <Check size={14} /> {band === "match" ? `Rang #${result.canonical_rank ?? "—"}` : statusLabel}
            {band === "match" && <span className={rankMovement > 0 ? "rank-movement up" : rankMovement < 0 ? "rank-movement down" : "rank-movement stable"}>
              {rankMovement > 0 && <ArrowUp size={12} />}
              {rankMovement < 0 && <ArrowDown size={12} />}
              {rankMovement === 0 ? "—" : Math.abs(rankMovement)}
            </span>}
          </span>
          <div className="detail-price-line"><strong>{formatPrice(listing.attributes.price.amount)}</strong><span>/ mois</span></div>
          <h2 title={listingTitle}>{listingTitle}</h2>
          <div className="listing-basics">
            {bedrooms && <span>{bedrooms} ch.</span>}
            {area && <span>{area}</span>}
            {propertyType && <span>{propertyType}</span>}
          </div>
          <div className="detail-primary-actions">
            <button type="button" data-testid="localize-listing" disabled={!canLocalize} onClick={onLocalize}><LocateFixed size={15} />Localiser</button>
            {sourceListingUrl && (
              <a href={sourceListingUrl} target="_blank" rel="noreferrer" data-testid="detail-source-link">Voir l’annonce source <ArrowUpRight size={14} /></a>
            )}
          </div>
        </div>
      </header>
      <article className="selected-listing docked-listing-detail">
        <section className={`score-disclosure axis-count-${axes.length}`} data-testid="score-disclosure">
          {axes.map((axis) => (
            <div className={`score-axis axis-${axis.id}${displayedOpenScore === axis.id ? " active" : ""}`} key={axis.id}>
              <button
                id={`score-axis-trigger-${axis.id}`}
                type="button"
                aria-expanded={displayedOpenScore === axis.id}
                aria-controls={`score-axis-panel-${axis.id}`}
                aria-description={axis.definition}
                title={axis.definition}
                data-testid={`score-axis-${axis.id}`}
                onClick={() => setOpenScore((current) => current === axis.id ? null : axis.id)}
              >
                <span className="score-axis-label">{axis.label}</span>
                <strong>{scoreLabel(axis.score)}</strong>
                {axis.coverageLabel && <small className="score-axis-coverage">{axis.coverageLabel}</small>}
                <ChevronRight className="score-axis-chevron" size={16} />
              </button>
            </div>
          ))}
          {axes.map((axis) => (
            <div
              className={`score-detail-wide${displayedOpenScore === axis.id ? " is-open" : ""}`}
              id={`score-axis-panel-${axis.id}`}
              key={`panel-${axis.id}`}
              role="region"
              aria-hidden={displayedOpenScore !== axis.id}
              aria-labelledby={`score-axis-trigger-${axis.id}`}
              data-testid={displayedOpenScore === axis.id ? "score-detail-wide" : undefined}
            >
              <div className="score-detail-motion-clip">
                {axis.id === "fit" && <FitScorePanel result={result} />}
                {axis.id === "objective" && <ObjectiveScorePanel listing={listing} />}
                {axis.id === "life" && <LifeScorePanel listing={listing} />}
              </div>
            </div>
          ))}
        </section>

        {(whyItems.length > 0 || commutes.length > 0) && (
          <div
            className={`contextual-proof-grid${whyItems.length > 0 && commutes.length > 0 ? " has-both" : commutes.length > 0 ? " context-only" : " why-only"}`}
            data-testid="decision-context-grid"
          >
            {whyItems.length > 0 && (
              <section className="listing-proof-section why-listing-stands-out" data-testid="why-listing-stands-out">
                <h3>Pourquoi elle ressort</h3>
                <div>
                  {whyItems.map((item, index) => (
                    <p key={`${index}:${item}`}><Check size={14} />{item}</p>
                  ))}
                </div>
              </section>
            )}
            {commutes.length > 0 && (
              <section className="user-context commute-section" data-testid="commute-section">
                <h3>Votre contexte</h3>
                <div className={`commute-list destination-count-${Math.min(commutes.length, 2)}`}>
                  {commutes.map((commute) => (
                    <article key={commute.anchor.criterion_instance_id} data-anchor-id={commute.anchor.criterion_instance_id}>
                      <div><strong>{commute.label}</strong><small>{commute.anchor.routing_mode === "car" ? "Voiture" : "Transport"}</small></div>
                      <span className={`commute-status ${commute.status}`}>
                        <strong>{commute.actualMinutes === null ? "Non disponible" : `${Math.round(commute.actualMinutes)} min`}</strong>
                        <small>limite {commute.targetMinutes} min</small>
                        {commute.deltaMinutes !== null && commute.deltaMinutes > 0 && <em>+{Math.round(commute.deltaMinutes)} min</em>}
                      </span>
                      {commute.googleMapsUrl && (
                        <a
                          href={commute.googleMapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          data-testid={`google-maps-${commute.anchor.criterion_instance_id}`}
                        >Ouvrir dans Google Maps <ArrowUpRight size={13} /></a>
                      )}
                    </article>
                  ))}
                </div>
                <small className="commute-basis">Temps estimé par Flincy pour un matin de semaine, selon le mode choisi et les données disponibles.</small>
              </section>
            )}
          </div>
        )}

        <HousingFacts
          listing={listing}
          capabilities={housingCapabilities}
          decisionNotes={decisionNotes}
        />

        {cautionItems.length > 0 && (
          <section className="listing-proof-section listing-cautions" data-testid="listing-cautions">
            <h3>À garder en tête</h3>
            <div>
              {cautionItems.map((item) => (
                <p key={item.id}><Info size={14} />{item.text}</p>
              ))}
            </div>
          </section>
        )}

        <AdditionalDetails listing={listing} capabilities={factPartitions.additional} />
        {qaMode && <QaFactInventory listing={listing} capabilities={capabilities} />}
      </article>
    </aside>
  );
}
