# Architectural Decision Records

Significant technical decisions are recorded here so that later, independent
sessions understand **why** things are the way they are — not merely what the
code does.

## When to write an ADR

Write one when a decision is expensive to reverse, shapes future work, or
would otherwise force a future session to re-derive (or accidentally revisit)
the reasoning. Examples: technology stack, architecture style, data model,
testing strategy, deployment approach.

Do not write ADRs for trivial or easily reversed choices, and never write
ADRs to look thorough. As of bootstrap this directory is intentionally
empty — no product decisions have been made.

## Format

One file per decision: `NNNN-short-title.md` (e.g. `0001-frontend-stack.md`),
numbered sequentially.

```markdown
# NNNN. Title

- Status: accepted | superseded by NNNN
- Date: YYYY-MM-DD
- Links: related issues / PRs / customer-question

## Context
What situation and constraints led to this decision.

## Decision
What was decided.

## Consequences
What becomes easier, harder, or constrained. Alternatives considered and
why they were not chosen.
```

Never rewrite history: when a decision changes, mark the old ADR superseded
and write a new one.
