# Product Management

The customer is the product owner. The AI team's product-management role
turns the customer's informal input into well-scoped, actionable engineering
work — and never invents product scope the customer has not asked for.

## Issue quality

Engineering/product issues created by the team should generally contain:

- a concise title
- context / problem statement
- desired outcome
- appropriate scope (small enough for one focused PR when possible)
- acceptance criteria
- relevant dependencies
- links to originating feedback, questions, or issues

Detail proportional to the work — do not make tickets bureaucratic. Use
sub-issues only when they genuinely improve decomposition. Search existing
issues before creating new ones; avoid duplicates.

### Verifiable acceptance criteria

Every acceptance criterion must pass a capability test when written: **can a
session, in the environment sessions actually run in, execute this check and
honestly report the result?** Do not enumerate today's tooling in the
criterion — capabilities change; the test is executability by a session at
the time the work is done.

When a property the customer cares about genuinely needs something no
session has, do not write it as an ordinary checkbox. Write it as one of:

- a **proxy criterion** a session can execute that evidences the same
  underlying property (e.g. "the exported file demuxes as WebM/VP9 with an
  Opus audio track, verified with FFmpeg" instead of "plays in another
  mainstream media player"); or
- a criterion explicitly marked **customer-verifiable**: the issue states
  that verification belongs to the customer, and the criterion is excluded
  from the team-executed evidence in the Definition of Done
  (`development.md`) rather than left for a session to decide whether
  "met in substance" counts.

A criterion nobody can execute is worse than none: it either gets waved
through, eroding the honest-evidence invariant, or burns reviewer time
re-deciding what it really meant.

## Processing customer feedback (`customer-feedback`)

The customer writes feedback in completely free form — no user stories,
acceptance criteria, or structured reports required from them, ever.

To process a `customer-feedback` issue:

1. Preserve the original issue untouched as the raw voice of the customer.
2. Understand the request in the context of the existing product.
3. Ask a `customer-question` only if genuinely necessary.
4. Create one or more appropriately scoped engineering/product issues.
5. Add clear acceptance criteria to those derived issues.
6. Link derived issues back to the feedback issue (and vice versa).
7. Check for and link existing backlog items instead of duplicating them.
8. Close the feedback issue (as completed) once its actionable meaning is
   fully captured, with a comment listing the derived issues.

## Customer questions (`customer-question`)

**A GitHub issue is the only channel.** The customer does not answer
questions inside a Claude Code session and has asked never to be asked
there (#312): no interactive prompt, no "how should I proceed?" at the end
of a turn, no menu of options, no request for permission. A session that
finds itself wanting to ask has two legitimate moves — decide, or open a
`customer-question` issue and carry on with other work. Stopping to wait
for an answer is not one of them.

Ask the customer only when the answer genuinely requires customer judgment
and materially affects product behavior, UX, priorities, scope, customer
intent, or expensive / hard-to-reverse architectural decisions. Otherwise,
make a reasonable, reversible engineering decision independently and note it
in the relevant issue or PR. Questions should be rare.

Most of what feels like a question is not one. A choice the team can make
and later revise — a naming decision, a test's shape, which of two sound
implementations to use, whether a rule covers a case it does not name — is
an engineering decision, not customer judgment. Make it, say in the issue
or PR what you chose and why, and let review disagree if it should. A
question that the repository's own rules already answer, or that only
concerns how the team works rather than what the product does, is never a
`customer-question`: read the rules, and if they are genuinely silent or
contradictory, decide and open a `process` issue proposing the wording that
would have settled it.

A `customer-question` issue must include:

- the question
- why the answer matters
- reasonable options, when applicable
- consequences / tradeoffs of each option
- the team's recommended option

Assign the issue to the repository owner when permissions allow. The customer
answers with a normal comment in any format.

When a later session finds an answered question: incorporate the answer into
the affected work, link the decision where it is applied (issue, PR, or ADR),
and close the question. If a question blocks only one piece of work, label
that work `blocked` and continue other useful work.

## AI product suggestions (`idea` + `ai-generated`)

The team is expected to notice opportunities for new functionality or UX
improvements — the customer asked for these proactively and recurringly
(#166, #173). Features established in existing video editing tools are a
good source of inspiration when they fit this product's scope. Suggestions
are welcome but **must not silently become approved scope**.

A suggestion is an ordinary issue labeled `idea` + `ai-generated` — this
existing pairing *is* the "AI suggestion" of #173; no separate label. Each
suggestion issue explains the idea, why it may benefit the customer/product,
major tradeoffs, and a recommendation, plus a **scope estimate**: rough size
(how many issues/PRs), key risks and their mitigations, any new
dependencies, and any new UI surface (#173).

Standing mechanics, customer-directed in #173:

- **Keep at least one alive.** A session that orients and finds no open
  unapproved suggestion creates one before ending. This is a standing
  customer instruction and a deliberate exception to "no artificial
  activity" (`operating-model.md`): the suggestion itself is a deliverable
  the customer asked for.
- **At most three open suggestions at a time**, so the customer can always
  review the whole set quickly. While three are open, create none.
- **Uniqueness check.** Before writing one, review existing suggestions —
  open and closed — and the customer's feedback on them. Never re-suggest a
  rejected feature as-is. If a new suggestion resembles an earlier one, the
  issue must say what is similar and which difference makes it worth
  considering anyway.
- **OBE closure.** Any session may close an open suggestion that has been
  overtaken by events — the customer asked for something equivalent
  themselves, or another change makes it obsolete or out of scope — with a
  comment saying why, even if the customer never reviewed it.

The customer responds to a suggestion by commenting on it (#173). Handle
responses as customer input:

- **Approval** is either the `customer-approved` label or an explicit
  go-ahead comment from the customer on the suggestion issue ("implement
  this", "yes, I want this") — the customer's stated workflow is comments
  (#173), and an explicit request in their own words is customer-initiated
  scope. When approval arrives by comment, a product-management pass derives
  scoped issues from the suggestion exactly as for `customer-feedback`,
  linking the approving comment, and closes the suggestion once captured.
- **Ambiguous positivity** ("interesting", "cool idea") is discussion, not
  approval — refine or wait; never implement from it.
- **Rejection** — an explicit "no", or the customer closing an unapproved
  suggestion — is final; do not revive it unless later customer input
  explicitly does. Closed suggestions remain part of the uniqueness-check
  record.

Do **not** implement a suggestion, refine it into Ready work, or treat it as
scope before approval. Keep `idea` and `ai-generated` in place after
approval so provenance stays visible.

## AI-discovered engineering work

Distinct from product ideas: the team autonomously creates and prioritizes
issues for discovered bugs, regressions, broken tests, security problems,
necessary tech debt, maintainability problems, CI problems, required
refactors, accessibility defects, and reliability issues. These do **not**
need `customer-approved` — unless fixing them would materially change
intended product behavior or scope, in which case ask first.

When such a problem is discovered while an implementation PR is in flight and
it is unrelated to that PR's issue: do not expand the PR. Create a linked
follow-up issue instead.
