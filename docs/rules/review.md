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

GitHub does not merely fail to enforce that boundary — it over-enforces the
`APPROVE` verb, rejecting a formal approval (`Can not approve your own pull
request`) even on a PR you are entitled to review, because author and
reviewer are the same account. That is expected, not a permissions problem,
and not a reason to stop — see "Review outcomes" for how a positive verdict
is recorded.

## Reviewing a PR

Evaluate against:

- the originating issue and its acceptance criteria
- implementation correctness
- regression risk
- **widened kinds**: when the change adds a kind to an existing collection,
  or a case to an existing discriminated union, look for code that still
  assumes the narrow shape — per-kind lists, `switch` statements missing the
  new case, predicates keyed on the collection rather than on the element.
  Grep the collection's and the type's names across `src/`, and read what
  turns up against the new kind.
- architecture and fit with existing code
- maintainability and readability
- tests: do they exist, pass, and provide real evidence of correctness?
- security, where relevant
- UX, where relevant
- CI / check results (all required checks must pass)

Actually read the diff and, when checks are absent or inconclusive, run the
tests. Do not rubber-stamp.

A change can be correct in its own diff and still break a caller that was
correct before it, which is why the widened-kinds check reads code the diff
does not touch. #332 is the worked example: #294 put still overlays into the
existing overlay lane, and `heldSettingsGroups` — in #315's module, untouched
by either PR — still returned a fixed per-kind list crediting every overlay
with an audio group, so copying a still's settings onto a clip silently reset
that clip's volume, mute and fades. Both PRs were correct alone and both were
independently reviewed; one grep for `'video-overlay'` across `src/lib` would
have found it. This is a review step and nothing more: #294 and #315 passed
the independence test in `operating-model.md` on its own terms — they neither
conflicted nor depended on each other — and that test is unchanged.

## Review outcomes

**Changes required:** leave concrete, actionable review feedback on the PR
and ensure the work remains unmerged. Prefer specific comments over vague
concerns. A later session (or the same one, if it isn't the author) may then
address the feedback.

**Satisfies requirements and required checks pass:** submit the review with
`COMMENT`, stating the verdict and the evidence for it, then merge. Because a
formal `APPROVE` is impossible (above), that comment review *is* the approval
of record — state your verdict rather than re-explaining GitHub's behavior,
and never wait for an approval that cannot exist. Customer approval is not
required for merging. Prefer **squash merge** unless repository circumstances
make another strategy clearly superior. Confirm the linked issue closes (or
close it with a link), and confirm the head branch was auto-deleted (the
repository deletes head branches on merge; manual branch deletion is not
expected to work from sessions — see #19).

After merging a PR authored by another session, the reviewing session may
continue with other useful work, including starting a new implementation if
the WIP rule allows.

## Fixing versus reviewing

Fixing a stalled PR (failing CI, merge conflict, addressing existing review
feedback) is legitimate work distinct from reviewing it. The fix belongs on
that PR's own branch — see "Branches and commits" in `development.md`, which
also holds the never-rewrite-someone-else's-history rule. Doing so makes you
a co-author under the rule above when the fix is substantive — the PR then
needs review from yet another session. Trivial mechanical fixes do not
transfer authorship, but say in a comment what you did either way.
