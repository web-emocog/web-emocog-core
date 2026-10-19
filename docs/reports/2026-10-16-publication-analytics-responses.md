# Publication Analytics, AOI Preview And Automatic Responses

Date: 2026-10-16. Local work on `feature/protocol-persistence-pdf`.
Not pushed or deployed. Earlier uncommitted persistence/PDF/key-binding work is
preserved; no changes to the other checkout or original user database.

## Changes

- The standard shape AOI editor uses the actual content bounding rectangle,
  rather than the surrounding 16:9 white viewport. Normalized AOI coordinates,
  runtime definitions and recorded gaze are not retroactively changed.
- Unbounded AOI time intervals show an explanatory placeholder, not the maximum
  safe integer. Image/video intrinsic aspect ratios remain respected.
- Authored RU/EN instructions adapt recognized keypress/click phrases to the
  following task's actual response. Existing `{response}` remains compatible,
  but the researcher is no longer asked to write a marker. Multiple responses
  use explicit trial mappings. Unrelated prose is retained; edited template
  instructions are marked as authored rather than replaced by a standard rule.
- Session analytics no longer exclude an explicit session through stale dates
  or a mismatched display alias. Canonical participant IDs prevent identical
  display aliases from merging different participants.
- Publications, historical invitation snapshots and unverified imports are
  distinct analytic versions. List, options, snapshot, media, AOI and export
  resolve the same immutable definition. Changing a draft or publishing again
  does not invalidate an unchanged historical dataset. Previous fingerprints
  require a new snapshot, rather than returning potentially mixed results.
- Task-only block filters no longer require a gaze presentation to retain RT
  records. Missing gaze metrics remain missing, not fabricated.
- Custom descriptive comparisons support complete-pair block/condition designs
  and disjoint independent participant groups. All calculations run on the API.
  Trials are pooled per participant, with equal participant weights. Correct,
  quality-valid finite RTs are used for RT; accuracy uses quality-valid trials.
- Difference B minus A, group means, paired differences, missingness and N are
  visible. Accuracy differences are percentage points. No p-value or confidence
  interval is fabricated; this is not confirmatory inference.
- Comparison JSON/CSV and the current-report PDF carry the fixed selection.
  The PDF readiness gate now uses comparison readiness in comparison mode.

## Contracts, Security And Scientific Impact

Analytics query/response/export schemas were extended together. Published
version identifiers are separate from JSON format tags. No new migration is
introduced by this change; the preceding stable-publication feature requires
migration 18. Static module versions are updated consistently.

Existing role, organization/project membership, CSRF, immutable media grants
and snapshot reauthorization remain required. Independent cohort IDs outside
the selected protocol version are rejected; overlapping cohorts and conflicting
trial filters are rejected. Server-owned IDs have bounded validation. No raw
camera/audio upload or physiological/gaze algorithm changes were introduced.

Participant-level analysis avoids treating repeated frames/trials as independent
participants. Paired and independent designs are kept distinct. Methodological
references: [NIST paired observations](https://www.itl.nist.gov/div898/handbook/prc/section3/prc311.htm),
[NIST two-sample comparisons](https://www.itl.nist.gov/div898/handbook/eda/section3/eda353.htm),
[NC3Rs experimental unit](https://eda.nc3rs.org.uk/experimental-design-unit).
These references justify design distinctions, not product validation or an
unimplemented significance test.

## Verification

- API/contract/unit suite: 373 passed, 0 failed.
- PostgreSQL integration on a separate test database: 35 passed, 0 failed.
  Includes both comparison designs, duplicate aliases, publication/media
  separation, snapshot/export consistency, membership and role denials.
- Browser regression runs: 444 distinct passed cases (199 Chromium, 199 Firefox,
  46 WebKit), 0 unexpected failures or flaky retries in the completed runs.
  This count deduplicates overlapping runs by file, title and browser.
- 21 distinct browser cases remained skipped: additional authenticated
  researcher fixture cases, the dedicated password-recovery database fixture,
  and real-cookie publication in WebKit. Real-cookie publication/draft sharing
  was enabled and passed separately in Chromium and Firefox; password API
  integration is covered by the PostgreSQL suite.
- TypeScript no-emit check and `git diff --check` passed.

Initial environment-only failures were corrected before the final runs: the
temporary browser config needed an explicit static-server working directory,
and the destructive-rollback guard test needed transaction-local empty tables
instead of assuming the shared test database contained no media versions.
No authorization, schema or measurement check was weakened.

The final local API reports `ready / db=ok` and the researcher page returns HTTP
200 using the preserved review database/media copy, not the automated test DB.
The original database and production were not changed.

## Limitations And Rollout

Unbound historical JSON imports cannot be honestly assigned to a publication
without trusted provenance. Their original AOIs/media are not guessed. The
comparison module is descriptive; formal tests, adjustment strategies and
confidence intervals need a separately agreed statistical specification.

The recognized authored-response phrases cover RU/EN and supported key labels;
arbitrary natural-language instructions cannot be safely rewritten as general
translation. Other locales retain generated/localized instructions and actual
response guidance. Real-camera accuracy and OS-reserved keys need manual tests.
The previously documented custom-QC-runtime integration gap remains separate.

Deploy API and static files together after backup and migration 18 from the
preceding change. Reapply analytic selections to generate the new fingerprints.
Do not rewrite recorded session invitations or source media versions. Protocols
above 2000 sessions fail closed and need future paginated analytics.
