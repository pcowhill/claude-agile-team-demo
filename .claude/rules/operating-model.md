# Operating Model and Work Selection

## Session model

Each Claude Code session is independent and stateless. A session may act in
one or several roles (product manager, developer, reviewer, QA, release
engineer, maintainer) as the work demands, subject to the author/reviewer
boundary in `review.md`. Everything worth remembering must be persisted to
GitHub (Issues, PRs, comments) or committed files before the session ends.

## Work selection priority

After orienting (see "What Go means" in `CLAUDE.md`), pick the
highest-priority applicable action. Approximate order:

1. **Broken main.** Failing CI on `main`, or a broken deployment, outranks
   everything else.
2. **Review an open implementation PR** you did not author. Getting existing
   work merged beats starting new work.
3. **Fix an open implementation PR you may touch** — failing CI, merge
   conflicts, or unresolved review feedback on a PR whose author-session is
   gone. (Fixing a PR does not make you its reviewer; substantial new commits
   to a PR make you a co-author, and someone else must still review them.)
4. **Incorporate answered `customer-question` issues** into the work they
   blocked, link the decision, and close the question.
5. **Triage new `customer-feedback`** into scoped, actionable issues.
6. **Implement the highest-priority Ready issue** — but only if the WIP rule
   below permits.
7. **Backlog hygiene**: refine vague issues, close duplicates, update stale
   issues, record overdue ADRs or retrospectives when genuinely warranted.
8. **Stop.** If none of the above is actionable, end the session and say so.

Priority signals, in order of authority: the customer's explicit statements >
GitHub Project `Priority` field (P0 critical → P3 nice-to-have) > labels
(`bug` generally before `feature`, `blocked` is not actionable) > issue age.

## Work-in-progress limit

**At most one active implementation PR at a time.** While an implementation
PR is open (awaiting review, fixes, or merge), do not start an unrelated
implementation. Permitted concurrent activities: triage, feedback processing,
answering/asking questions, reviewing the open PR (if you are not its
author), fixing its CI, resolving blockers, documentation-only corrections.

Prefer finishing existing work over creating new work. Prefer small, coherent
PRs over large bundles of unrelated changes.

## Handoffs

A natural handoff is reached when a session has, for one issue:
implemented → tested → pushed the branch → opened the PR → linked the issue →
supplied PR context. At that point the session must stop implementing that
issue and must not review or merge its own PR. It may continue with other
permitted activities or end.

**Handoff is permanent for the authoring session.** Once its implementation
PR is open and context is supplied, the author session must not arrange to
resume itself: no scheduled self-check-ins or reminders, no cron or
`/loop`-style continuations, no PR auto-fix automation, and no subscribing
to the PR's activity or CI events. Follow-up on the PR — review feedback,
CI failures, merge conflicts — belongs to later, independent sessions, which
discover it by orienting from GitHub state. If the session's harness offers
to watch, monitor, or auto-fix the PR, decline.

## Blocked work

If work cannot proceed:

- Label the issue `blocked` and comment with what blocks it and what would
  unblock it (link the blocking issue or `customer-question`).
- Continue with other unblocked work rather than halting entirely.
- Remove `blocked` when the blocker is resolved.

## No artificial activity

Do not manufacture tickets, ceremonies, documentation, refactors, or
architecture merely to look active. Agile practice here exists to improve
delivery, not to maximize visible process. Useful issues, clear decisions,
small PRs, test evidence, meaningful review, and customer value beat
ceremony. If there is no useful work, stop and report that clearly.

## Ending a session

Before stopping, ensure state is persisted: branches pushed, PRs opened or
updated, issue comments recording partial progress or discoveries, labels
current. A future session must be able to pick up from GitHub alone.
