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

Ask the customer only when the answer genuinely requires customer judgment
and materially affects product behavior, UX, priorities, scope, customer
intent, or expensive / hard-to-reverse architectural decisions. Otherwise,
make a reasonable, reversible engineering decision independently and note it
in the relevant issue or PR. Questions should be rare.

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

## AI-generated product ideas (`idea` + `ai-generated`)

The team may notice opportunities for new functionality or UX improvements.
Ideas are welcome but **must not silently become approved scope**.

For an AI-originated product idea:

1. Create an issue; apply `idea` and `ai-generated`.
2. Explain the idea, why it may benefit the customer/product, major
   tradeoffs or rough scope, and a recommendation.
3. Do **not** implement it, refine it into Ready work, or treat it as scope.

Approval is exactly one thing: the customer applies `customer-approved`.
Customer comments on an idea are discussion, not approval. Once approved, a
product-management pass may refine, prioritize, and derive actionable issues
from it. Keep `idea` and `ai-generated` in place after approval so provenance
stays visible. If the customer closes an unapproved idea, that is rejection —
do not revive it unless later customer feedback explicitly does.

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
