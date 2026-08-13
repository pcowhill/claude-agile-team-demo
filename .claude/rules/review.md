# Independent Review and Merging

## The author/reviewer boundary

A session must never review, approve, or merge a PR it authored in that same
session. Because all sessions push under the same GitHub account, GitHub
cannot enforce this — the sessions must. The test is session identity, not
GitHub identity:

- A PR that **already existed before your session started** is eligible for
  you to review and merge.
- A PR you **opened during this session** is not — hand it off.
- If you pushed **substantial new commits** to an existing PR (beyond trivial
  mechanical fixes like a merge-conflict resolution or a lint fix), you have
  become a co-author of that work: you may no longer approve or merge it.
  Comment on the PR describing what you changed so the next session knows a
  fresh review is needed.

## Reviewing a PR

Evaluate against:

- the originating issue and its acceptance criteria
- implementation correctness
- regression risk
- architecture and fit with existing code
- maintainability and readability
- tests: do they exist, pass, and provide real evidence of correctness?
- security, where relevant
- UX, where relevant
- CI / check results (all required checks must pass)

Actually read the diff and, when checks are absent or inconclusive, run the
tests. Do not rubber-stamp.

## Review outcomes

**Changes required:** leave concrete, actionable review feedback on the PR
and ensure the work remains unmerged. Prefer specific comments over vague
concerns. A later session (or the same one, if it isn't the author) may then
address the feedback.

**Satisfies requirements and required checks pass:** merge it — customer
approval is not required for merging. Prefer **squash merge** unless
repository circumstances make another strategy clearly superior. Confirm the
linked issue closes (or close it with a link), and confirm the head branch
was auto-deleted (the repository deletes head branches on merge; manual
branch deletion is not expected to work from sessions — see #19).

After merging a PR authored by another session, the reviewing session may
continue with other useful work, including starting a new implementation if
the WIP rule allows.

## Fixing versus reviewing

Fixing a stalled PR (failing CI, merge conflict, addressing existing review
feedback) is legitimate work distinct from reviewing it. Doing so makes you a
co-author under the rule above when the fix is substantive — the PR then
needs review from yet another session. Trivial mechanical fixes do not
transfer authorship, but say in a comment what you did either way.
