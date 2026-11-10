# Old audit 123: analytics source-to-sink review

Local worktree: `.worktrees/signal-quality-profiles`. No commit, push, deployment,
global CSP enforcement, schema, migration, scientific algorithm, builder,
stimuli-library, participant or transport changes. Parent owns the registry,
cache-tag update, combined review and release acceptance.

## Runtime And Sources

`researcher.html` loads the legacy script followed by
`researcher-analytics-production.js`, which replaces `AnalyticsView`.
`analyticsDemo=1` explicitly delegates to the legacy view. `analyticsPreview=1`
uses the separate, static production-shaped preview fixture.

The legacy session object is exposed only in demo mode. The compatibility
adapter in `researcher-api-bridge.js` maps `/sessions/:id` and proxy metrics into
that object on legacy pages. Its automatic picker installation is skipped when
the production module is present. The regression calls the real mapper/merge
and renderer explicitly; it does not claim this bridge runs automatically on
the canonical production analytics page.

Production sources are `/projects`, `/protocols`, `/sessions`,
`/analytics/v1/filter-options`, snapshots, session summary/visuals/AOI/heatmap,
group summary/heatmap and comparison responses. Local storage supplies selected
IDs and `emocog_analytics_query_draft_v1`. Local JSON import results and API
errors reach status text, not executable content.

## Legacy Inventory

All HTML construction sites and SVG/attribute/text writers were traced to their
callers. A raw interpolation in a private fixture renderer is not evidence of
attacker-controlled input.

| Renderer / Sink | Actual Source | Disposition |
| --- | --- | --- |
| `_buildSessionCard` session hint | Demo object; compatibility bridge can replace session fields | Session ID now HTML-escaped. |
| `renderSessionCardHeader` QC badge/score | Mapped session row | Existing escaping retained; badge class is a fixed allowlist. |
| QC reasons, metadata | Mapped feature/QC labels, values, browser/device/protocol | Existing `textContent` and text nodes retained; severity selects fixed colors. |
| `renderSessionMetrics` section/card HTML | Static metric registry and translations; mapped metric/group values | Text escaped; strict finite numeric adapter before format/comparison/width. Null/blank/boolean/array/object are not zero. |
| `renderSessionDetail` text and note | Same metrics; fixed translated QC branches | Text-node sinks retained; numeric formatting tolerates missing group statistics. Note contains only static translated fragments. |
| `drawDistribution` SVG template | Percentile from session group data | Finite numeric conversion; missing/hostile percentile clears the SVG; numeric percentile is bounded for plotting. No string enters an SVG attribute/text interpolation. |
| `renderBlocks` row HTML | Mapped block fields/reasons | Existing escaping retained; validity/severity choose fixed classes/colors. FPS/gaze entries require finite conversion before interpolation. |
| `AnalyticsView` tabs | Literal `ANALYTICS_TABS`, static icons/translations | Stored active-experiment ID only selects normalized boolean tab settings; it is not inserted into HTML. |
| Legacy initialization error | Exception message | Existing `textContent` error node retained. |
| `wireSessionControls` clipboard | Session object | `JSON.stringify` into clipboard text, not DOM/code. |

### Inert Chart Families

`initGroupDashboard` owns a literal private `DATASETS`. It never requests API
data or reads stored session datasets. Its `renderSegButtons`, `meanStdCell`,
`renderAB`, KPI HTML, `drawBarChart`, histogram/box plots, donut list/single donut,
QC distribution, focus bars, dot scale and line chart consume that literal and
numeric derived values. Labels, units, gradient IDs and mode/title branches are
literal call-site values. Their raw fixture interpolations were not rewritten
or reported as a stored-XSS exploit.

`initQCDashboard` uses only `_QC_DATASETS_CACHE`, populated by its own
`genSessions` with fixed protocol/device/browser dictionaries and numeric random
samples. Histogram, mean/range/stacked-validity/bullet/distribution/reason/tech
charts use DOM SVG nodes, text nodes and numeric attributes; the gradient defs
are literal. Select/worst-slice HTML already escapes labels; remaining counts
and formatted means come from local arrays/arithmetic. Mode titles are fixed
branches. There is no API/localStorage-to-chart path.

`initConnectednessDashboard` similarly uses `_CONN_DATASETS_CACHE` from its own
generator and a literal `METRICS` list. Matrix/network/scatter SVG labels use
`textContent`, numeric attributes and fixed colors. Tooltip HTML escapes
metric/session/protocol labels. Raw block/group/QC/N tooltip/table entries are
generator literals/numbers or computed array counts, not imported/API data.
Filter options use DOM `option.value` / `textContent`. JSON download anchors use
locally created Blob URLs and fixed filenames. No network CSV/HTML is generated.

The private fixture families were exercised in all three engines with a hostile
stored session value: charts render, the value is not consumed, and no analytics
API request occurs. A future migration to API/imported datasets must introduce
new boundary tests instead of relying on this fixture-only classification.

## Production Inventory And Changes

| Source -> Sink | Review / Change |
| --- | --- |
| Projects/protocols/sessions/filter labels and IDs -> options, comparison roster, applied chips | Existing HTML text/attribute escaping retained. IDs do not become inline code. |
| Saved query dates -> input `value` attributes | Existing quote escaping tested for exact attribute round-trip. Invalid dates become null API query boundaries. Definition-specific stored IDs are reset during context initialization. |
| Session/task/passive metric IDs, reasons, units, scope, counts, algorithm versions -> cards | Existing escaping/numeric formatting retained and tested with hostile unknown metric/status/algorithm/scope strings. |
| QC/status -> classes, styles and labels | Status text escaped. `qcTone` / readiness helpers select only fixed color tokens; no API status becomes a class or CSS value. |
| Group QC counts -> HTML | `valid`, `borderline`, `invalid`, `notComputed` now escaped. |
| Group AOI numerator/denominator and participant/observation counts -> table | All now escaped. Existing AOI/metric names and participant titles were already escaped. |
| Group device participant/session counts -> details HTML | Now escaped; existing device-class escaping retained. |
| Comparison participant/observation/unidentified-session counts -> HTML | Now escaped; pair identifiers, formulas, effect units and result text were already escaped. |
| Session/group stimulus dimensions -> `style=aspect-ratio` | All three visual renderers now use finite positive numbers or fixed `16/9`, never raw metadata strings. |
| AOI/fixation coordinates -> SVG and positioned labels | Invalid/nonfinite/out-of-range geometry omitted. A malformed AOI is omitted whole, not repaired by dropping individual vertices. Names/order remain escaped; valid coordinates become only numeric geometry. Metrics are not recalculated. |
| Heatmap grid -> canvas | Numeric colors/pixels, no HTML/code sink. Existing rendering unchanged. |
| API stimulus content URL -> img/video source | Existing anchored content-route rule or locally owned Blob URL; image-SVG preview path remains an image context. `javascript:` input rejected. Name/alt/aria text escaped; class arguments are internal literals. No media-library code changed. |
| Physiology, audio, technical details, quality assessments, exclusions -> cards/details | Existing escaping of text/attributes retained; percentages/timestamps use numeric formatting; statuses choose fixed branches. |
| API/import errors -> status/UI | Existing escaping or `textContent` retained. `stateCard` callers provide static or explicitly escaped descriptions, not raw API HTML. |
| Session/comparison ID -> API path segment | URI encoding retained; empty and exact `.`/`..` rejected before the request because URI encoding does not encode dots. Query values remain URI-encoded. |
| Snapshot -> download request | Fixed `/analytics/v1/exports` endpoint with `URLSearchParams`, cookie credentials, existing CSRF/staff request headers, explicit `redirect: 'error'`, workspace ownership and transfer deadline. Existing snapshot/hash validation happens before reading bytes. |
| Reproducibility link -> native GET href | Existing fixed `/export/reproducibility` path, positive safe-integer selection and `URLSearchParams`; attribute escaped. Not a client-provided file path or mutation. Native links do not carry the fetch-only staff header; no new claim about cross-tab ownership was added. |
| Download filename -> `anchor.download` | Sanitized name/version/snapshot components; format comes from fixed controls. URL is an owned Blob URL, not API/import HTML. |

`previewSummaryHtml` has no callers in the current module. Its block-table
interpolations are inactive, not a current API-to-DOM path. Preview constructors
and preview-only client CSV generation consume static fixtures. Live export is
server-generated and snapshot-validated; this patch does not claim to re-audit
server CSV formula protection or the entire import contract.

Server producers were checked, not inferred from field names:
`analytics/metrics.js` builds QC/device/group counts from counters, array lengths
and Sets; `analytics/comparisons.js` builds comparison counts numerically;
`analytics/v1-router.js` applies `positiveDimension` to stimulus dimensions.
Hostile response tests deliberately violate these numeric contracts to verify
the UI trust boundary. The additional escaping/geometry checks are
defense-in-depth, not proof that these server fields permit stored XSS today.

## Tests And Reproduction

- New browser spec: `apps/autotests/tests/old-audit-analytics-security.spec.ts`.
- Dedicated config: `apps/autotests/playwright.old-audit-analytics.config.ts`.
- Dedicated loopback server: `apps/autotests/tests/old-audit-analytics-security-server.mjs`.
- New VM/API-consumer tests: `apps/api/tests/old-audit-analytics-security.test.js`.
- Final browser run: **39 passed**, no skips/retries, Chromium/Firefox/WebKit:
  27 new security cases and 12 existing session/media/group/export regressions.
- Final targeted Node run: **70 passed**, no skips; includes 4 new tests plus
  existing HTML boundaries, analytics-v1/version/comparison/passive/attempt/export tests.
- Initial mocked 302 failed in WebKit because `route.fulfill(302)` is unsupported.
  It was replaced, not skipped: a real local HTTP 302 is used in every engine.
  The test verifies server redirect hits increase by one and target hits do not
  increase. Hash mismatch also rejects before download.
- Camera/microphone are never opened. New cases deny media requests and assert
  zero calls. No screenshots, video or biometric fixtures are produced.

From the worktree, the stable standalone security command is:

```sh
cd apps/autotests
npx playwright test --config=playwright.old-audit-analytics.config.ts tests/old-audit-analytics-security.spec.ts
```

Default port is 4215; optional `OLD_AUDIT_ANALYTICS_PORT` changes both config and
server. The server is independently owned; it does not depend on Dalton's files.
To reproduce the full 39-case run without unrelated builder cases:

```sh
npx playwright test --config=playwright.old-audit-analytics.config.ts --grep-invert 'AOI remains block-scoped|analytics plan preserves|existing runtime-shaped protocols'
```

Node reproduction from the worktree root:

```sh
node --test apps/api/tests/old-audit-analytics-security.test.js apps/api/tests/html-data-boundaries.test.js apps/api/tests/analytics-v1.test.js apps/api/tests/analytics-version-comparisons.test.js apps/api/tests/passive-analytics.test.js apps/api/tests/issue144-attempt-analytics.test.js apps/api/tests/session-export-recovery.test.js
```

## Acceptance Boundary

Local source-to-sink closure for audit item 123, not blanket "XSS-free" or
production approval. Canonical/compatibility runtime separation, inert fixture
classification, unknown response strings, missing metrics, tooltips/classes,
SVG geometry, stored date attributes and download/path boundaries are covered.
No real DB/tenant authorization retest, global CSP rollout, physical-device
validation or scientific acceptance is claimed. Parent owns broader gates and
the final cache-tag bump. Rollout requires those gates; rollback is limited to
the analytics-specific diff, never a reset of the shared dirty worktree.
