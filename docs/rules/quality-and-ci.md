# Testing, CI, and Deployment

## No stack, no fake CI

Until a technology stack exists there is deliberately no CI. Do not install
frameworks or invent checks for an empty repository. The session that
introduces the initial stack **must** introduce stack-appropriate CI in the
same or an immediately following PR, and record the stack choice as an ADR.

## Required quality gates (once a stack exists)

PRs should be protected by checks appropriate to the stack, typically:

- build
- lint / static analysis
- type checking, where the language supports it
- unit tests
- integration tests, where appropriate
- browser / end-to-end tests for web functionality, where valuable
- accessibility or other quality checks, where appropriate

Grow the gates with the product; add a check when its absence has bitten or
clearly will. Tests must provide independent evidence of correctness — a test
that merely mirrors the implementation or exists to satisfy a checklist is
worse than no test, because it manufactures false confidence.

## CI discipline

- Failing CI on `main` outranks all feature work (see `operating-model.md`).
- A PR with failing required checks is never merged.
- Flaky tests are bugs: file an issue, and fix or quarantine them
  deliberately — never by deleting coverage to get green.
- Never claim checks passed without CI evidence or an actual local run — and
  a local run is evidence only for the tree it ran on, which must be the
  tree that was pushed (see "Pull Requests" in `development.md`).

## Deployment (GitHub Pages)

The product is expected to be usable via GitHub Pages. Do not create a
deployment while there is no application. Once the architecture/stack is
known, establish a GitHub Actions deployment workflow appropriate to it.

Principles:

- Deploy from merged `main` only; never deploy feature branches as
  production.
- CI protects production: deployment happens after checks pass.
- Deployment success is not proof the application works — perform an
  appropriate smoke verification of the deployed app when practical, and
  file a `bug` issue immediately if production is broken.
- Changes reaching `main` should become available to the customer with
  minimal manual intervention.
