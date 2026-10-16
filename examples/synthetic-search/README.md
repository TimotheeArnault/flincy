# Synthetic O4 search

Five entirely fictional prepared listings, one fictional destination (no coordinates),
a custom resolved state and a typed synthetic FitContract call the authentic O4 engine.
Budget is 1800 CAD with 100 tolerance; travel is 35 minutes with 10 tolerance.
Travel values are invented inputs, NOT routing results. Only laundry and dishwasher
contribute to the score, with equal comfort weights. Budget and travel have no scoring atomics.

## Oracle established before execution

The expected.json file was authored analytically, before the first engine execution:
evaluateEvidence assigns 100 to confirmed positive, 0 to confirmed negative and
null/unusable to unresolved evidence. scoring weights usable coverage, while explanation
allocates 50 points to each comfort component. Thus A earns 50, misses 50, covers 100%;
B earns 50, has 50 unknown points, covers 50% and scores 100 on its evaluable budget.
C/D/E have two positives: 100 points and complete comfort coverage.

engine aggregates travel feasibility separately from listing eligibility.
C's 1850 is within the budget tolerance, D's 60 minutes exceeds 45, and E has null travel.
ranking compares feasibility, eligibility and coverage before score.
Expected order is A, B, C, E, D. Only A/B are main_results. In this enabled-fit
scenario O4 DOES assign canonical ranks to all five, including secondary cases.
D/E retain eligible fit_status, which is not a claim that their travel is feasible.
problem_criterion_ids concerns scoring atomics; hard-constraint reasons are exposed
separately in base_criteria. Missing travel does not reduce comfort coverage.

After installing development dependencies, run npm test or npm run demo.
The selected test scope is the three existing O4 suites plus syntheticSearch.
npm scripts include build logs; for pure JSON use node examples/synthetic-search/run.cjs
after npm run build. The wrapper projects real output fields without recalculating or
sorting results. Tests also compare unprojected engine results across all 120 input orders.

No O3, DuckDB, geocoder, routing service, frontend assets or business network is used.
This is not a full Flincy execution, a production prediction, a frontend build or a
clean-room validation. Python delivery and fresh-install portability belong to G1.3.
