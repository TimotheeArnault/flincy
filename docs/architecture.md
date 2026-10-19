# Architecture: preparation, delivery and interaction

[Overview](../README.md) | [Pipeline](pipeline.md) | [Reproducibility](reproducibility.md)

Flincy's full system has three operational boundaries: constructing data,
publishing a public-safe read model, and preparing/building the static site.
This separation lets Flincy validate and prepare data independently from
public-data publication and application delivery, while keeping interactive
decisions lightweight in the browser. The selected code here illustrates
those boundaries without shipping their entire implementation.

## The real system and the included subset

| Layer in the real system | Responsibility | Included here |
|---|---|---|
| Acquisition and normalization | Capture source records, identify the intended listing and parse source-specific fields | No acquisition code or source data |
| Durable and current state | Preserve identity and observations; derive availability, quality and current product state | Described only |
| Geography and prepared facts | Qualify locations, relate points of interest, prepare routing and semantic facts with provenance | Selected downstream helper code, no datasets or routing workers |
| Score preparation | Produce separate objective, daily-services and user-fit evaluations | Selected Python user-fit scoring/explanation helpers |
| O3 product read model | Project allowed public fields and validate bundle integrity | A bundle helper, not the export producer or a production bundle |
| Frontend delivery preparation | Transform O3 into a bounded static package, including spatial indexes/shards | A delivery helper and its synthetic tests, not the full preparer |
| O4 user-fit engine | Reevaluate a resolved search against prepared listing facts; explain and rank | Ten real TypeScript modules and selected executable tests |
| Interface | Manage search, focus, selection, map and inspection interactions | Five source references, not a runnable Next.js app |

The product is statically delivered, but its preparation is not a browser task.
Python and DuckDB construct facts and upstream scores. O3 publication and the
frontend preparation/build are separate operations, not a single implied command
available in this repository.

For how source evidence is retained, reinterpreted and transformed into
product-ready facts, see the [data pipeline](pipeline.md).

## Three axes, not one universal score

- **Housing value / Valeur du logement (Objective):** upstream evaluation using
  intrinsic features and a rental benchmark. Browser interaction consumes it;
  O4 does not recompute the benchmark.
- **Daily services / Services du quotidien (Life-centric):** upstream neighborhood
  services context. It remains separate from housing value and personal fit.
- **Personal fit / Adéquation (User-fit):** deterministic evaluation against a
  search's constraints and preferences. Prepared defaults can be published
  upstream; the browser can reevaluate a changed search through O4.

There is no weighted super-score merging these axes. A neutral search can use
the existing objective rank; a missing objective rank remains explicitly
unranked rather than being invented.

## O3: projection is a boundary, not the whole database

The full system builds a content-addressed product bundle and a current pointer.
The frontend then receives a prepared projection of that bundle, not necessarily
every O3 asset. For example, the presence of a catalog in O3 does not itself mean
the UI loads that full catalog.

The included [bundle helper](../pipeline/public_product_bundle_v1.py) provides
canonicalization, public-payload checks, POI edge composition and asset integrity
functions. Its presence is not a claim that the complete export command, data,
or disclosure review is available here.

The [delivery helper](../pipeline/frontend_free_anchor_delivery.py) illustrates
deterministic grid addressing, matrix projection, bounded partition selection
and content-addressed JSON output. Its tests use tiny fabricated matrices.
Neither helper supplies real routing facts.

## O4: resolved inputs, deterministic outputs

The executable boundary is:

```text
PreparedListingFitInput[]
+ ResolvedSearchState
+ FitContract
-> evaluateAndRank
-> feasibility + eligibility
   preference score + coverage + explanations
   canonical ranks + result sections
```

Read the [types](../web/fit-engine/src/types.ts), then
[engine](../web/fit-engine/src/engine.ts),
[scoring](../web/fit-engine/src/scoring.ts),
[explanation](../web/fit-engine/src/explanation.ts) and
[ranking](../web/fit-engine/src/ranking.ts).

The [bundle adapter](../web/fit-engine/src/bundleAdapter.ts) shows how prepared
product records reach this boundary. The
[postal adapter](../web/fit-engine/src/postalAdapter.ts) consumes a supplied,
pre-resolved catalog; it is not an external geocoder. The
[spatial decoder](../web/fit-engine/src/spatial.ts) reads supplied columnar facts;
it is not a routing engine. Those modules are included and compiled, but the
five-case demo deliberately starts after input preparation.

## Browser and routing boundaries

The real UI uses Next.js, React and MapLibre. Its selected
[Search State source](../reference/frontend/lib/searchState.ts) and
[runtime bridge](../reference/frontend/lib/fitRuntime.ts) illustrate the connection
to O4; [decision controls](../reference/frontend/components/DecisionFocus.tsx),
[listing inspection](../reference/frontend/components/ListingDetail.tsx) and
[map rendering](../reference/frontend/components/ExploreMap.tsx) illustrate consumers.

Flincy uses R5, an open-source multimodal routing engine, to compute travel
times upstream. Prepared facts preserve travel direction, network support and
missing-data statuses. When users adjust their search, the browser evaluates
these facts without requesting new route calculations.

Nearby-service proximity and walking-access facts are distinct from
travel-time facts for supported destinations; they are not interchangeable.
Static files support interaction, while the site's basemap remains an external
runtime resource.

The five UI files lack application wiring, aliases, styles, helpers, data and
dependencies. See the [frontend reference boundary](../reference/frontend/README.md).
Do not infer a buildable site from the existence of these components.

## Evidence and provenance

Development combined human-directed product/architecture decisions with extensive
Codex assistance for implementation and tests. Reality audits, behavior baselines,
selection reviews and fresh-checkout validation separate observed behavior from
aspirational claims. This documentation exposes the conclusions and selected code,
not internal transcripts.

The [source map](source-map.json) records selected file identities and adaptations.
It does not prove identity with the live site, expose the private source repository,
or authorize redistribution of datasets referenced by the architecture.
