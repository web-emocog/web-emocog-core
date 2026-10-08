# Author attribution

The repository `.mailmap` maps the identified legacy Valeriia name/email to
Dorila24. It applies to mailmap-aware Git log, shortlog and blame tools. It does
not reassign other contributors or modify their commits.

## What this PR does not do

- Existing commit objects, author/committer metadata and SHA values are unchanged.
- Co-authored-by trailers are not rewritten.
- This is not a historical rewrite or a promise that GitHub contribution counters
  will be recalculated. GitHub links commits using the email in commit metadata.
- The application code, branch protections, tags, releases and invitations are
  unchanged.

Future commits are authored as Dorila24 using the account-associated email.
Verify that email in GitHub account settings. After merging this PR, verify local
display with `git check-mailmap`, `git log --use-mailmap`, and `git shortlog -sne`.

## If a real history rewrite is still needed

An ordinary PR cannot replace the author metadata of existing main commits.
A separate, explicitly approved administrative operation is required. The
current Dorila24 permission is Maintain, not Admin; do not bypass the protected
main ruleset or add fake replacement commits merely to change code statistics.

Before any rewrite: back up every live ref and dirty worktree; re-prepare against
the current remote (earlier prepared graphs are stale after new commits); verify
identical source trees and only the approved identity/trailer changes. An
administrator must supervise temporary applicable protection changes, atomic
explicit-lease publication and immediate protection restoration on either
success or failure. Coordinate collaborator resynchronization beforehand.

## Primary documentation

- [Git mailmap](https://git-scm.com/docs/gitmailmap)
- [GitHub commit email attribution](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)
- [GitHub cautions on published-history edits](https://docs.github.com/en/pull-requests/how-tos/commit-changes/changing-a-commit-message)
