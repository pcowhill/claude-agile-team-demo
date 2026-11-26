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
clearly will. **Lint warnings fail the build** (`npm run lint` is
`oxlint --deny-warnings`, #550): a warning here is a decision — the one
rule set to `warn` in `.oxlintrc.json` and the deliberate hook-dependency
omissions each carry a disable comment — so a tree meant to be silent
fails when it is not, and a session that meets a warning writes the
disable comment or fixes the cause rather than re-running. It has bitten:
#517's branch carried the repository's only warning under a green "Lint"
step and an honest "`oxlint` exit 0", and only a reviewer reading the
output found it. Tests must provide independent evidence of correctness — a test
that merely mirrors the implementation or exists to satisfy a checklist is
worse than no test, because it manufactures false confidence.

## CI discipline

- Failing CI on `main` outranks all feature work (see `operating-model.md`).
- A PR with failing required checks is never merged.
- Flaky tests are bugs: file an issue, and fix or quarantine them
  deliberately — never by deleting coverage to get green.
- **A flake nobody can reproduce expires after five clean CI runs**
  (customer-directed, #588). A failure seen once that will not fail again
  on demand is filed as a `bug` labeled `flake-watch`, naming the test and
  the CI **job** that runs it — `Build, lint, typecheck, test` for a unit
  test, `Browser tests (Playwright)` for an e2e spec. A session that
  orients and finds an open `flake-watch` issue counts its runs (backlog
  hygiene, priority 7 in `operating-model.md`):
  - **What counts:** runs of the watched job in `ci.yml`, on any branch
    and event, created after the last sighting — the issue's creation, or
    its newest recurrence comment — in which the job reached its test
    step. A job that failed or was cancelled before running its tests says
    nothing about the flake and is skipped.
  - **What recurs:** the watched test failing in such a run on any
    attempt, including a Playwright test the summary reports `flaky`
    because a retry passed. Comment the run's link and the failure output;
    the count restarts from that run. A recurrence after the issue closed
    by count does not restart it; it is measured (below).
  - **How to read it:** `actions_list` with `list_workflow_runs` on
    `ci.yml` for the runs, `list_workflow_jobs` for each run's jobs, and
    the tail of `get_job_logs` for a Playwright job or any failed job,
    where the reporter's summary names the failed and flaky tests. A
    successful unit job needs no log: vitest does not retry.
  - **At five clean runs**, close the issue as `not_planned`, listing the
    five runs. Short of five, comment the count and its runs, but only
    when it has moved since the last such comment.
  - **A measured cause ends the watch, and the count does not.** Once the
    failure has been explained by a measurement and a fix can be named, it
    is no longer a flake nobody can reproduce, so this rule stops applying.
    The session that sees this:
    - removes `flake-watch` and keeps `bug`;
    - comments the measurement (run link and numbers) and the named fix;
    - stops counting.

    The issue is then an ordinary bug, fixed like any other, and closed by
    the PR that fixes it. #788 is the worked example. At 17:29 its thread
    measured the cause, a recorder starting about 0.4 s behind the readout,
    and named the fix (stop the take at `0:02`). At 19:15 it closed by
    count. It failed again at 19:59 and 20:05, and the fix shipped as #813
    under a new issue, #812.
  - **A watch that recurs after closing by count is measured, not counted
    out again** (#968). The five-run count is how a *first* sighting
    expires. A recurrence after that close is direct evidence the count was
    wrong, and a second count is weak evidence about the same question.
    The session that sees the recurrence:
    - reopens the original issue, or links it from the new one, so the
      sighting history stays in one thread;
    - comments the recurrence as above, and names the measurement that
      would test the thread's hypothesis, or proposes one;
    - removes `flake-watch` and keeps `bug`. The issue is not closed by
      count again.

    The measurement may be a local repeat, or #779's dispatched run with
    `--repeat-each` on the one spec, for a browser the container lacks.
    Either it finds a cause, and the issue is fixed as any bug, or it shows
    the test not failing at a stated number of repeats, written on the
    issue with the run, which may then close as `not_planned` citing it.
    #741 and #967 are the worked example, the same Firefox failure in
    `trim-window.spec.ts:65` each time, `"1.5"` where `"0"` was expected.
    #741 closed by count at 14:43 on 2026-11-25. The failure was seen again
    at 18:29 and filed as #967, which was counted out at 21:37, seen again
    at 02:34 and counted out a second time at 04:41 on 2026-11-26. That
    made six sightings, and nobody measured the hypothesis #741's closing
    comment had named.

  Five is the customer's number. A local sighting starts the count, but
  only CI runs advance it, because a local run leaves nothing a later
  session can re-read. The watch existed before this rule as "close it
  after a few weeks of green suites", and #442 carried that for more than
  two months: a date judged by feel never arrived, and a count does.
- **Never read a value once, straight after a synthetic input.** A browser
  driver's `keyboard.press` or `mouse.up` resolves when the event has been
  *dispatched*, not when the framework has committed the render it causes,
  so a bare `inputValue()` on the next line can read the previous render.
  Assert with an auto-retrying matcher instead — `expect(locator)
  .toHaveValue(…)`, or `expect.poll` where the comparison is numeric or
  derived — and when two values must agree with each other, read both
  **in one page read** — one `evaluate` (or one matcher) inside the poll —
  so they come from the same render. A poll callback that awaits two reads
  can see a render between them (#733). A read that can find its subject
  mid-replacement (an image with no `naturalWidth` yet, an element just
  remounted) returns a value the poll's condition rejects, rather than
  throwing; a throw ends the poll instead of retrying it. Once a retrying
  assertion has observed the commit, one-shot reads of that same render are
  fine. The race hides under low load, which is why it is a rule and not a
  fix in one file: #444's spec passed alone and in three full-suite runs,
  then failed the first run that carried one more test (#446's spec, which
  had independently written the same shape). Measured on that spec with
  `npx playwright test e2e/crop-editor.spec.ts --workers=2 --repeat-each=5`:
  **2 failed** before the reads were polled, **0 of 20** after (#449).
- **A Firefox measurement the container cannot take is taken in CI, before
  the fix** (#779). Some session containers have no Playwright Firefox, and
  the harness may forbid installing one. A fix written blind and judged by
  its PR's CI is the guess #598's criteria rule out. Instead:
  1. Push a measurement-only commit to the session's own branch, for
     example a spec that logs the geometry or timing in question.
  2. Dispatch `ci.yml` on that branch (`workflow_dispatch`), and read the
     Firefox job's log.
  3. Write the fix on the measured numbers. Keep the logging only if a
     later reader needs it.

  A dispatched run is not a PR and does not count against the WIP limit. It
  never deploys. The route works only once the trigger is on `main`, so the
  first session after #779 merges verifies that a session may dispatch at
  all, and records the result on #779.
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
