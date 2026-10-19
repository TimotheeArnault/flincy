# Flincy - Housing decisions, made clearer

Flincy is an independent, end-to-end data and product project built around a
practical problem: rental listings are fragmented, incomplete and difficult to
compare.

Focused on the Montreal area, it turns listings from multiple sources into
structured, enriched information that people can use to weigh destinations,
housing constraints and personal preferences. The product keeps missing facts
visible and evaluates housing value, nearby services and personal fit as three
separate dimensions, rather than reducing everything to a single score.

This repository contains a **curated selection of real Flincy code**: a runnable
TypeScript user-fit engine with fictional prepared inputs, selected Python
helpers and frontend source references. It is not a second checkout of the
complete live application.

## Live demo

[Explore Flincy](https://flincy.ca) (French-language interface).

## What Flincy does

- Evaluates whether required destinations are reachable within configured limits.
- Separates housing constraints, such as budget and bedrooms, from soft preferences.
- Keeps unknown facts distinct from confirmed negative facts.
- Explains preference scores, coverage and ranking through deterministic rules.
- Lets the interface change a search using prepared facts, without running a
  routing engine in the browser.

## Architecture at a glance

```text
Full Flincy system:
Rental sources -> acquisition / parsing -> Python / DuckDB
               -> identity, quality, geography and prepared facts
               -> objective / life-centric scores + user-fit facts
               -> O3 public-safe bundle
               -> frontend delivery projection -> O4 browser engine
               -> Next.js / React / MapLibre interface

Runnable in this repository:
Five fictional prepared listings -> real O4 engine -> explained rankings

Also included:
Selected Python scoring, integrity and delivery helpers
Selected frontend sources for inspection
```

O3 is the product read-model/export boundary; O4 is the browser user-fit engine.
The [architecture](docs/architecture.md) explains how these layers interact.

## What's in this repository

| Area | What you can explore |
|---|---|
| [`web/fit-engine/`](web/fit-engine/) | Compile the real engine and run selected tests. Start with [`evaluateAndRank`](web/fit-engine/src/engine.ts). |
| [`examples/synthetic-search/`](examples/synthetic-search/) | Run five fictional cases against a versioned expected result. |
| [`pipeline/`](pipeline/) | Inspect real Python scoring, explanation, integrity and delivery helpers; run the [delivery tests](tests/test_frontend_free_anchor_delivery.py). |
| [`reference/frontend/`](reference/frontend/README.md) | Explore selected Search State, runtime, decision, inspection and map sources from the live interface. These are inspectable, not a standalone UI. |
| [`docs/source-map.json`](docs/source-map.json) | Verify selected source-file hashes and see which files were copied, adapted or created for the demo. |

## Quick start

From the repository root, with Node 24.x and npm installed:

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd test
npm.cmd run demo
```

On the validated Windows environment, the selected TypeScript suite passes
**18 tests** and the demonstration prints explained, ranked JSON. Five separate
Python delivery tests use only the standard library. See
[reproducibility](docs/reproducibility.md) for the Python command, tested
versions, exact-output verification and platform limitations.

## How ranking works

Flincy keeps required-trip feasibility, housing eligibility, preference score
and evidence coverage separate. For comparable feasibility/eligibility outcomes,
the current ranking considers coverage before preference score.

In the fictional demo, A ranks ahead of B despite scoring **50 versus 100**:
A has **100% preference coverage**, while B has **50%**. Coverage measures the
share of weighted preferences that can be evaluated, not the accuracy or
quality of a listing. This is a product trade-off, not a claim of optimality.
See the [scenario and oracle rationale](examples/synthetic-search/README.md)
for the full five-case breakdown.

## Engineering decisions and development approach

- Keep acquisition, parsing, product qualification and scoring as distinct
  responsibilities rather than treating every captured field as a reliable fact.
- Prepare geographic and routing facts upstream while keeping interactive
  user-fit evaluation in a deterministic browser engine.
- Preserve provenance and unknown states; distinguish hard constraints from
  scored preferences and keep the three score axes separate.
- Validate a bounded path using real production code and synthetic inputs,
  rather than build an artificial copy of the full application.

I developed Flincy through incremental data and product experiments, guiding
product decisions, architecture trade-offs, acceptance criteria and release
scope. Codex extensively assisted with implementation, code inspection and
testing. The housing ranking itself follows deterministic rules, not generative
AI recommendations.

## Technical portfolio snapshot — October 2026

This repository preserves a curated, reproducible snapshot of selected Flincy
components. The live product continues to evolve independently, and this
repository is not synchronized with future product development. Regular updates
are not planned, although important security or documentation corrections may
be published.

## Scope and limitations

This is a selected code snapshot, not the complete Flincy pipeline. Acquisition
tooling, source observations, the DuckDB database, production O3 bundles and
geographic/routing datasets are not distributed. The frontend references are
not a buildable Next.js application; the runnable demonstration starts from
fictional facts that have already been prepared for O4.

Read [how a listing becomes usable](docs/pipeline.md), inspect the
[layer boundaries](docs/architecture.md), or
[reproduce the bounded demonstration](docs/reproducibility.md).
This code is made publicly available for inspection. No open-source license
granting general permission to reuse it is provided. Source visibility and
provenance are not a license grant; third-party components remain subject to
their respective terms.
