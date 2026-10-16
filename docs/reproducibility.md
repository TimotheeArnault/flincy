# Reproducibility: what this checkout can actually run

[Overview](../README.md) | [Architecture](architecture.md) | [Pipeline](pipeline.md)

## Validated scope and environment

The bounded path is a real TypeScript engine operating on five fictional prepared
listings, plus a separate Python delivery test suite. It is not a full application
or end-to-end reconstruction from source observations.

Fresh-checkout validation was performed on **2026-10-16** using:

| Tool | Observed version |
|---|---|
| OS | Windows x64, NT 10.0.26200.0 |
| Node | 24.20.0 |
| npm | 11.19.0 |
| TypeScript | 7.0.2, restored from the lock |
| Node types | 24.13.3, restored from the lock |
| Python | CPython 3.14.4, independent of the private project's environment |

The preserved [`.node-version`](../.node-version) specifies 24.19.0; that exact
patch has not been tested here. Node 24.x is declared in
[`package.json`](../package.json). No Linux/macOS validation is claimed.

## Install, test and run

Run these commands separately from the checkout root and stop on a failed command:

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd test
npm.cmd run demo
```

The `.cmd` spelling avoids PowerShell script-policy issues. The fresh-checkout
validation used an additional `--cache .tmp/npm-cache` on `npm ci` to keep its npm
cache separate. Installation requires registry access unless packages are cached;
the demonstration after installation requires no application service or network.

`npm test` compiles the explicitly listed TypeScript sources and runs **18 tests**:
11 existing tests of evaluators, ranking and engine contracts, plus 7 synthetic
scenario tests. The latter include all 120 input permutations, input preservation
and explanation reconciliation. There are no real O3 golden files in this suite.

`npm run demo` rebuilds and prints npm/compiler logs followed by JSON. After a
build, this command emits **only the scenario JSON**:

```powershell
node examples/synthetic-search/run.cjs
```

No server is started. The [wrapper](../examples/synthetic-search/run.cjs) invokes
the authentic `evaluateAndRank` and projects its output; it does not add a second
scoring or ranking implementation.

## Exact output and Windows line endings

The direct wrapper's expected output is **10,924 bytes**, SHA-256:

```text
3bfbf24efc39e9e173ac9d8e47228fa47c6c40b6827823fe913cf902c6f63582
```

It equals the versioned [oracle](../examples/synthetic-search/expected.json).
That oracle was authored analytically before the original engine run, not
regenerated from the current output.

The initial clean-checkout audit (G1.3) found that Windows Git's
`core.autocrlf=true` converted the oracle to CRLF: JSON decisions still matched,
but raw bytes did not. The repository now contains one targeted
[`.gitattributes`](../.gitattributes) rule:

```gitattributes
examples/synthetic-search/expected.json text eol=lf
```

G1.4 checks this rule in a new normal Windows clone with `core.autocrlf=true`,
without the earlier `core.autocrlf=false` workaround. Other files need not have
LF working-tree line endings. To inspect the oracle's checkout:

```powershell
git ls-files --eol examples/synthetic-search/expected.json
```

The index and working tree should both show LF. Compare raw output without
PowerShell text redirection or normalizing either side:

```powershell
@'
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const expected = readFileSync('examples/synthetic-search/expected.json');
const run = () => {
  const r = spawnSync(process.execPath, ['examples/synthetic-search/run.cjs'], {
    encoding: null
  });
  if (r.error || r.status !== 0) throw new Error('Demo failed');
  return r.stdout;
};
const a = run(), b = run();
if (!a.equals(expected)) throw new Error('Oracle byte mismatch');
if (!a.equals(b)) throw new Error('Nondeterministic output');
const hash = createHash('sha256').update(a).digest('hex');
if (a.length !== 10924 ||
    hash !== '3bfbf24efc39e9e173ac9d8e47228fa47c6c40b6827823fe913cf902c6f63582') {
  throw new Error('Unexpected baseline identity');
}
console.log(a.length, hash);
'@ | node
```

This is a one-off verification command, not an oracle-generation command.

## Read the five cases

The [fixture](../web/fit-engine/tests/fixtures/syntheticSearch.ts) supplies a
resolved Search State and typed `FitContract` already prepared for O4. Budget is
1,800 CAD with 100 tolerance; required travel is 35 minutes with 10 tolerance.
Travel times are fictional input values, not routing results. Budget and travel
are hard-only constraints; laundry and dishwasher share the comfort score equally.

| Case | Fit score | Preference coverage | Feasibility / listing eligibility | Rank / section |
|---|---:|---:|---|---|
| A | 50 | 100% | feasible / eligible | 1 / main |
| B | 100 | 50% | feasible / eligible | 2 / main |
| C | 100 | 100% | feasible / near_miss | 3 / secondary |
| E | 100 | 100% | unresolved / eligible | 4 / secondary |
| D | 100 | 100% | not_feasible / eligible | 5 / secondary |

A has a known negative dishwasher fact: it contributes an evaluable zero.
B has an unknown dishwasher fact: it is not evaluable, leaving 50 unknown points.
Both earn 50 points, but B's score is calculated over only its 50 evaluable points.

C's 1,850 CAD price is within tolerance, not a strict match. D's 60-minute trip
fails the required limit; E's null trip stays unresolved. D/E remain eligible
for the housing constraints and can have full comfort coverage without feasible
travel. Only A/B are main results, even though all five receive canonical ranks.

Coverage is the weighted fraction of evaluable preferences, **not** direct
accuracy, confidence or housing quality. The current coverage-first ranking
explains A before B; it is a product trade-off, not a demonstrated optimum.
Coverage-versus-score calibration remains separate. See the
[original scenario rationale](../examples/synthetic-search/README.md).

## Python delivery tests

Use an independently installed Python, not a private project's virtual environment.
Confirm the interpreter and version first; substitute its executable if
`python` does not select the intended installation:

```powershell
python -c "import sys; print(sys.executable); print(sys.version)"
python -B -m unittest discover -s tests -p test_frontend_free_anchor_delivery.py
```

Validation used the explicit path to an independent CPython 3.14.4 installation,
because the local Windows launcher alias was unavailable. No machine-specific
path is required by the code.

**Five tests** cover grid/tile identity, nulls and storage order, bounded partition
choice, unsupported modes, and deterministic content-addressed output. They need
only the standard library and their own temporary directories; no pip install,
DuckDB, R5 or production files. The [test import](../tests/test_frontend_free_anchor_delivery.py)
was adapted from the original module location to `pipeline`, with assertions
unchanged.

This is not a Python/TypeScript end-to-end parity suite. The other selected
Python helpers remain inspectable; this command tests delivery only.

## Provenance and limits

[`source-map.json`](source-map.json) records SHA-256 values for selected code and
demo files. Its hashes describe **Git blob bytes**, not platform-converted
working-tree bytes. For example, `git show HEAD:web/fit-engine/src/engine.ts`
provides the blob to hash; capture it as bytes rather than redirecting text
through PowerShell. This distinction keeps provenance verifiable under CRLF
checkout without changing all source files.

The earlier G1.3 audit used a clean local clone on the same PC, not a VM. Targeted
module-loading and process-level network checks found no private runtime
dependency in the exercised path; they were not an OS-level network/filesystem
security sandbox. G1.4's targeted recheck closes the oracle checkout issue,
not a new multi-platform certification.

The adapters for bundle/postal/spatial facts compile, but this demo bypasses
production input preparation. Historical real-snapshot parity tests, full Python
pipeline tests and browser QA are not included in the selected suite.

There is no production O3 bundle, postal catalog, DuckDB database, source capture,
routing matrix, map dataset or complete static site here. The
[frontend sources](../reference/frontend/README.md) are not independently buildable.
Do not run a Next.js build expecting this selection to become the live application.
