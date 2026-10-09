# Photodiode Release Recovery And Branch Synchronization

Date: 2026-10-10. Integration branch: `fix/photodiode-release-sync`.
Target: `develop`. Production promotion belongs to the repository owner.

## Verified Starting State

- `main`: `ec2e8cc5d23bb2a03008ec9147f69e9cb9ed0c1b`.
- `develop`: `c3f92b125bb2484a2681f8709a7c69e9a592f9b1`.
- Explicit fetch of both branch refs confirmed that `develop` was three
  commits behind `main`, with no commits unique to `develop`.
- [PR 110](https://github.com/web-emocog/web-emocog-core/pull/110) added the
  temporary researcher-owned photodiode setting. Its checks passed before
  the owner merged it into `main`.
- [PR 111](https://github.com/web-emocog/web-emocog-core/pull/111), `main` into
  `develop`, was mergeable without Git conflicts. Its failed status came from
  a failed release job, not conflicting source files.

## Actual Failure

[Production run 37995129529](https://github.com/web-emocog/web-emocog-core/actions/runs/37995129529)
stopped at Buildx setup: Docker Hub authentication timed out while pulling
`moby/buildkit:buildx-stable-1`. Application image builds, remote database
backup, migrations and deployment had not started.

[PR release run 37995278354](https://github.com/web-emocog/web-emocog-core/actions/runs/37995278354)
failed while pulling the PostgreSQL service image from Docker Hub, before any
PostgreSQL test ran. API/security and Chromium/Firefox jobs passed. The required
release gate correctly failed because the database job failed.

These logs do not establish a defect in the photodiode runtime. Its protocol
controls, pulses and scientific limitations are retained rather than rewritten
to address a registry outage.

## Changes

- An ordinary merge, `af554e6`, includes all of `main` in the branch created from
  `develop`. Before recovery edits, its tracked tree matched `main` exactly.
  No squash, rebase, force-push or branch-protection change is used.
- CI and deployment share a composite builder action. BuildKit first uses
  `mirror.gcr.io/moby/buildkit`; if setup fails, it uses the canonical upstream
  image. Both sources use the same verified SHA-256 digest,
  `cec9f139f45e93c5c69c60f8b07cfad9f43f4ef6b6a6cd917527fea5ff2e3dea`.
  Only the first attempt may continue on error; a failed fallback fails the job.
- BuildKit's Docker Hub registry configuration uses Google's cache with the
  normal canonical fallback for application base images. A cache is not an
  availability guarantee; failures are not relabelled as successful tests.
- The PostgreSQL service uses the official Docker image distributed through
  Amazon ECR Public, pinned to the verified digest
  `029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297`.
  Both upstream and mirror resolved to this digest for `16.10-alpine`.
- CI now checks pull requests into both `develop` and `main`. Production
  deployment remains triggered only by pushes to `main`.
- The static action-SHA audit also scans local composite actions. Regression
  tests check image pins, fallback behavior and preservation of database gates.
- A preview navigation layout test now mocks unauthenticated staff responses
  instead of querying a developer's live API. Production CORS and authorization
  are unchanged, and uncaught browser errors remain test failures.
- README explains the complete loopback PostgreSQL/API/frontend setup,
  migrations, persistent uploads, first admin and organization, memberships,
  invitation publication, photodiode opt-in and troubleshooting. README and
  AGENTS require feature/fix PRs into `develop` before owner promotion to `main`.

Primary references: [Google's cache behavior](https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images),
[Docker's builder configuration](https://docs.docker.com/build/ci/github-actions/configure-builder/)
and [Docker Official Images on ECR Public](https://aws.amazon.com/blogs/containers/docker-official-images-now-available-on-amazon-elastic-container-registry-public/).

## Verification

- Full API suite with a real, isolated PostgreSQL database: **375 passed,
  0 failed, 0 skipped**, including photodiode access and immutable invitations.
- Targeted photodiode and release-hardening suites: **26 passed**; these are
  included in, not additional to, the API suite above.
- Chromium, Firefox and WebKit: **228 passed, 0 failed** across photodiode
  runtime/protocol controls, participant runtime, builder/instructions and
  design-system regressions.
- TypeScript, Python RT smoke, static release audit, workflow/composite YAML
  parsing, shell syntax and whitespace checks passed.
- Both production API and frontend images built with the new pinned builder
  and registry configuration, then passed their production-image smoke scripts.
  Local builds used the native arm64 platform; GitHub CI checks the Linux runner.
- Fresh PostgreSQL 16.10 setup from the documented image applied all 17
  migrations. Admin bootstrap, real browser cookie/CSRF login, organization and
  project creation, protocol publication and the public invitation's enabled
  photodiode setting passed. `/health` and `/ready` returned HTTP 200.

Tests used separate databases/media and ports 3031/4181. Existing preview
services on 3000/4173 and the user's saved experiments/uploads were not modified.
Local verification does not establish physical photodiode onset accuracy,
sensor compatibility or timing jitter; those require the actual detector.
No raw face video, audio or landmarks are introduced.

## Rollout And Rollback

Review and merge the recovery PR into `develop` only after its latest checks
pass, using a merge commit to retain common ancestry. Verify that `main` is an
ancestor of `develop` and retire the superseded synchronization PR. The owner
then promotes `develop` into `main` with a merge commit when ready. This recovery
does not deploy production or modify remote `main`.

After owner promotion, enable the temporary photodiode option in the builder's
quality-control step and publish a new invitation. Old invitation snapshots
retain their original setting. Check enabled and disabled protocols, including
precheck/calibration/completion teardown. Revert the recovery changes with a
normal revert if necessary; no schema migration or data deletion is required.
