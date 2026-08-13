# Retrospectives and Process Improvement

The AI team may improve its own development process — deliberately and
visibly, never silently.

## When to hold a retrospective

Consider a lightweight retrospective after roughly every five merged
implementation PRs, or sooner when a recurring failure pattern is evident:
repeated CI failures, poor issue decomposition, oversized PRs, repeated
regressions, ineffective tests, customer questions that should have been
avoidable, review problems, missing repository instructions, or inefficient
practices.

A retrospective is itself work — do not hold one when there is nothing to
learn, and keep it lightweight.

## How

1. Review recent merged PRs, closed issues, review threads, and CI history.
2. Write a short summary in `docs/retrospectives/` (see its README):
   what went well, what went poorly, and specific proposed changes.
3. For each change worth making, open a `process` issue describing the
   problem, evidence, and the proposed change.

## Changing the process

Meaningful changes to `CLAUDE.md`, `docs/rules/`, CI configuration,
testing strategy, or the development workflow must not be silently edited in.
They originate from a `process` issue and go through a normal PR with
independent review, like any other change. The repository history should show
how the team's working process evolved and why.

Exceptions — may be fixed directly in an otherwise-related PR, with a note:
typos, broken links, and factual corrections that change no rule's meaning.

Process changes must never weaken the invariants in `CLAUDE.md` (author ≠
reviewer, customer approval of AI ideas, honest test evidence) without
explicit customer direction via a `customer-question` or customer-initiated
issue.
