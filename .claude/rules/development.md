# Development Practices

## Starting implementation

Implement only issues that are actually ready: clear scope, acceptance
criteria, no unresolved blocking questions, not labeled `blocked`, and
permitted by the WIP rule in `operating-model.md`. Comment on the issue that
implementation is starting (and set Project Status to In Progress when the
API allows) so other sessions do not duplicate the work.

## Branches and commits

- Branch from up-to-date `main`. Never commit directly to `main`.
- Branch naming: `claude/issue-<number>-<short-slug>` (e.g.
  `claude/issue-42-clip-trim`). Sessions given a pre-assigned branch name by
  their harness use that name instead.
- Small, coherent commits with clear messages describing why, not just what.

## Scope discipline

A PR implements its linked issue — nothing more. Unrelated problems
discovered along the way become linked follow-up issues (see
`product-management.md`). Refactor only what the change requires, plus
genuinely necessary cleanup in touched code.

## Technology choices

There is no predetermined stack. Foundational choices (language, framework,
build tooling) are driven by the customer's product needs, must be recorded
as ADRs (see below), and — because they are expensive to reverse — usually
deserve a `customer-question` if the customer's intent leaves real ambiguity.
Whatever stack is chosen must support automated testing and CI, and must be
deployable via GitHub Pages (see `quality-and-ci.md`).

## Architectural Decision Records

Significant decisions whose reasoning will matter to later independent
sessions are recorded in `docs/adr/` — see `docs/adr/README.md` for the
format. ADRs capture **why** a choice was made, not merely what the code
does. Do not write ADRs for trivial or easily reversed choices.

## Pull Requests

- Open a PR when implementation + tests are complete and pushed; use the
  template at `.github/pull_request_template.md`.
- Link the issue with closing syntax (`Closes #123`) when merge should close
  it.
- Explain what changed, why, key implementation decisions, how it was
  tested, and remaining risks or follow-up work.
- Never state that tests passed unless they were actually run (locally or in
  CI). Report failures honestly.
- Opening the PR is the handoff: the authoring session must not review,
  approve, or merge it (`review.md`).
- Draft PRs are permitted only to hand off genuinely unfinished work with a
  comment describing exact remaining steps.

## Definition of Done

An implementation issue is Done only when **all** of the following hold:

- acceptance criteria are satisfied
- appropriate tests exist and pass
- required CI passes
- the implementation received independent review (different session)
- blocking review feedback is resolved
- the PR is merged
- associated documentation (README, ADRs, user-facing docs) is updated where
  appropriate

"Done" never means merely "code was written."
