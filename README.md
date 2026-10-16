# Flincy - Housing decisions, made clearer

Flincy helps people compare rental homes in the Montreal area around the places
they need to reach, the limits they cannot exceed, and the preferences that matter
to them. It keeps missing information visible and separates a home's value,
nearby services, and personal fit instead of collapsing them into one score.

This is a **curated source snapshot**, not a checkout of the complete application.
The runnable part is the real TypeScript user-fit engine with entirely fictional
prepared inputs. The broader system uses Python/DuckDB for data preparation and
Next.js, React and MapLibre for a statically delivered interface.

## Live demo

[Explore Flincy](https://flincy.ca) (French-language interface).

The live product and this code snapshot have different scopes. This repository
does not contain the deployed site's data or build inputs, and does not claim
byte-level identity with the currently served version.

## What Flincy does

- Evaluates whether required destinations are reachable within configured limits.
- Separates housing constraints, such as budget and bedrooms, from soft preferences.
- Keeps unknown facts distinct from confirmed negative facts.
- Explains preference scores, coverage and ranking through deterministic rules.
- Lets the interface change a search using prepared facts, without running a
  routing engine in the browser.

## Architecture at a glance

```text
Real system, not fully shipped here:
Sources -> Python / DuckDB -> prepared facts + separate score axes
        -> O3 public-safe bundle -> frontend delivery projection
        -> O4 browser engine -> Next.js / React / MapLibre interface

Runnable here:
Fictional prepared inputs -> real O4 engine -> explained, ranked JSON

Also included:
Selected Python helpers + one delivery test suite
Selected frontend sources for inspection, not a standalone UI
```

O3 is the product read-model/export boundary; O4 is the browser user-fit engine.
The [architecture](docs/architecture.md) explains their responsibilities.

## What's in this repository

| Area | What you can do |
|---|---|
| [`web/fit-engine/`](web/fit-engine/) | Compile the real engine and run its selected tests. Start with [`evaluateAndRank`](web/fit-engine/src/engine.ts). |
| [`examples/synthetic-search/`](examples/synthetic-search/) | Run five fictional cases against a versioned expected result. |
| [`pipeline/`](pipeline/) | Inspect four authentic Python helpers; run the [delivery tests](tests/test_frontend_free_anchor_delivery.py). Not a complete pipeline. |
| [`reference/frontend/`](reference/frontend/README.md) | Read five authentic UI/state/runtime sources. Dependencies, application wiring and data are intentionally absent. |
| [`docs/source-map.json`](docs/source-map.json) | Check selected source-file hashes and the distinction between copied code, adaptation and demo-only files. |

## Quick start

From the repository root, with Node 24.x and npm installed:

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd test
npm.cmd run demo
```

These are the Windows commands used for validation. The selected suite contains
**18 tests**; the demo prints JSON after npm/build logs. No server or real listing
data is required. Five additional delivery tests use Python's standard library.

Tested on Windows x64 with Node **24.20.0**, npm **11.19.0**, and Python **3.14.4**.
The preserved `.node-version` says **24.19.0**; that exact patch and other operating
systems have not been validated. See [reproducibility](docs/reproducibility.md)
for Python, exact-output verification and the scope of these checks.

## How ranking works

Feasibility, listing eligibility, preference coverage and preference score are
different outputs. Within comparable feasibility/eligibility bands, the current
ranking places complete coverage before partial coverage, then compares coverage
and score in descending order.

In the synthetic demo, A scores **50 with 100% coverage** and ranks before B,
which scores **100 with 50% coverage**. Coverage means the weighted share of
preferences that can be evaluated, not accuracy or housing quality. An unknown
fact is not a confirmed negative.

This is the current product trade-off, **not a proven optimal ranking policy**.
Coverage-versus-score calibration is deferred. The
[scenario and oracle rationale](examples/synthetic-search/README.md) explain
why only A and B belong to the main results.

## Engineering decisions and development approach

- Prepare expensive geography/routing facts upstream; keep interactive evaluation
  in a small deterministic browser engine.
- Preserve provenance and explicit missing states through typed boundaries.
- Separate feasibility and hard constraints from preference points.
- Verify a narrow, authentic execution path rather than manufacture a mock
  application around unavailable production data.

The project was developed through incremental data and product experiments.
Implementation and tests were extensively assisted by Codex, with human-led
scope, architecture trade-offs, evidence review and release decisions. Internal
reality audits and clean-checkout checks informed this selection; their transcripts
and private operational data are not included. Generative AI assisted development;
it does not select apartments in this scoring engine.

## Scope and limitations

This repository does **not** include acquisition tooling, private observations,
a DuckDB database, production O3 bundles, postal/POI catalogs, routing matrices,
R5 inputs, map assets or a buildable Next.js application. The Python helpers do
not reconstruct those missing stages.

Read [how a listing becomes usable](docs/pipeline.md), inspect the
[layer boundaries](docs/architecture.md), or
[reproduce the bounded demonstration](docs/reproducibility.md).
Source visibility and provenance are not a license grant; publication and
licensing review remain separate from these technical checks.
