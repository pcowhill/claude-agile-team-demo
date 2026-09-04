# Development Practices

## Starting implementation

Implement only issues that are actually ready: clear scope, acceptance
criteria, no unresolved blocking questions, not labeled `blocked`, and
permitted by the WIP rule in `operating-model.md`.

Concurrent sessions can race on the same issue, and a claim comment alone
does not prevent it — the claim must be checked at the moments the race is
detectable:

1. **Immediately before claiming**, re-fetch the issue's comments and the
   repository's open PRs. If another session has already claimed the issue
   (a claim comment, or an open PR referencing it), do not start — pick
   other work. Count the open implementation PRs in the same check: they are
   what the WIP limit caps, and other sessions may have opened one since you
   last looked.
2. **In that same check, look for your branch on `origin`.** Harness-assigned
   branch names are not unique across sessions, so the branch you are about
   to push may already carry another session's in-flight work.
   - If the branch exists on `origin` and an **open PR is built on it**, do
     not push: your commits would land on that PR silently, invalidating any
     review evidence already recorded against it. Say so in a comment on the
     issue you were about to claim (and on that PR), treat it as `blocked`,
     and pick other work.
   - If the branch exists on `origin` with **no open PR** (a leftover from
     merged or abandoned work), proceed normally.
3. Comment on the issue that implementation is starting, naming the branch
   (and set Project Status to In Progress when the API allows).
4. **Immediately before opening the PR**, check again for a competing open
   PR implementing the same issue. If one exists, do not open a second:
   resolve on the issue — by default the earlier claim wins and the later
   session abandons its duplicate.
5. If a duplicate PR pair nonetheless exists, the earlier-claimed PR is the
   default candidate for review and merge; close the later one as a
   duplicate unless an independent session (author of neither PR) judges it
   clearly superior.

## Branches and commits

- Branch from up-to-date `main`. Never commit directly to `main`.
- Branch naming: `claude/issue-<number>-<short-slug>` (e.g.
  `claude/issue-42-clip-trim`). Sessions given a pre-assigned branch name by
  their harness use that name instead — after the origin check in "Starting
  implementation" above, because assigned names repeat across sessions.
- **One branch per PR.** A session implementing more than one issue (see the
  WIP limit in `operating-model.md`) uses its harness-assigned name for at
  most one of them and `claude/issue-<number>-<short-slug>` for the rest.
  Never stack two issues on one branch: the second issue's commits would land
  on the first issue's open PR, invalidating review evidence already recorded
  against it. Branch each one from `main`, not from the previous branch, so
  the PRs stay independently reviewable and mergeable in any order.
- **A fix for an open PR goes on that PR's own branch.** The
  harness-assigned name governs the work a session *authors*; it does not
  follow work that belongs somewhere else. Fixing a stalled PR
  (`operating-model.md`, priority 3) means pushing to its head branch,
  because that is the only place the fix reaches the PR — an ordinary
  collaborative push, not a branch violation, and it needs nobody's
  permission. The prohibitions below still hold, and `review.md` still
  decides what the push does to authorship.
- Never force-push, rebase, amend, or otherwise rewrite history on a branch
  this session did not create.
- Small, coherent commits with clear messages describing why, not just what.
- **New test blocks go before the file's last `describe`, not at EOF.** A
  convention that removes friction, not a correctness rule: an EOF append is
  never a defect, and a reviewer should not treat one as something to send
  back. Concurrent PRs append to the same test files, and the end of the file
  is the one line they all reach for, so appending there turns an otherwise
  clean merge into a textual conflict at every file tail. Placing the block
  ahead of the final `describe` leaves the file's end untouched and lets those
  merges resolve themselves. #328 worked this out and moved its own `describe`
  mid-file for exactly this reason, in a commit message; two PRs later #330
  and #331 conflicted at the tail of both `src/lib/timeline.test.ts` and
  `src/components/Timeline.test.tsx` and paid it again. The reason is stated
  so a session can tell when it does not apply — a file with one `describe`,
  or none, has no earlier block to sit before. When relocating an existing
  block, move it verbatim, so a reviewer can see at a glance that no test
  changed.

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
- Reported evidence describes the **pushed** branch, not the working tree.
  Once the branch is pushed and before writing the evidence section, confirm
  the two are the same tree — `git status` clean, and
  `git diff <branch> origin/<branch>` empty. Checks run before the final
  commit stay reportable: name the state they were measured on rather than
  leaving the pushed one to be assumed. A working tree is invisible to
  reviewers and to CI, so one unstaged file makes a sincere claim false —
  #330 reported a passing suite its branch could not have run, and CI
  failed on the file that was never committed (#335).
- **A UI-affecting change carries rendered evidence, not only jsdom.** jsdom
  has no layout, so a component test cannot see what is mis-sized,
  mis-placed, or showing through something else. A PR that adds or changes
  visible UI — controls, dialogs, layout, CSS — reports evidence from a
  real browser. A **new** visible surface needs both: a screenshot the author
  states they inspected, *and* a geometry assertion in the e2e spec for
  anything a later change could regress. A change to an **existing** surface
  needs the geometry assertion; whether to also look is the author's call.
  The two are not substitutes, and #311 is the worked example — it produced
  both, and each caught what the other could not. With every geometry
  assertion green, a placeholder glyph still showed *through* a translucent
  waveform and an audio card read as a grey slab: nothing was mis-sized or
  mis-placed, so no bounding-box, overflow or alignment check could have
  failed, and only looking found them. Conversely, a screenshot nobody
  re-takes cannot catch what a later change breaks. Geometry assertions are
  claims a browser can measure — a bounding box lying inside its dialog, a
  label not wrapping (`scrollWidth <= clientWidth`), rows still aligned, the
  page not scrolling sideways. Give a containment or coverage check an
  explicit tolerance and say why: an absolutely positioned `inset: 0` child
  fills the padding box, so it falls a pixel short of a bordered parent's
  border box, and the honest fix is a ratio rather than an exact match. This
  is not a call for pixel-diff snapshots, and a PR touching no visible UI is
  unaffected. Two layout defects reached the customer under green CI for
  want of this — the export modal's overflowing format note (#268, fixed in
  #270) and the cheat sheet's mid-combo wrap (#287, fixed in #289) — both
  reported by the customer with screenshots (#264, #282).
- Opening the PR is the handoff: the authoring session must not review,
  approve, or merge it (`review.md`), and must not arrange to resume itself
  afterwards — no self-check-ins, PR-activity subscriptions, or other
  self-resumption (see "Handoffs" in `operating-model.md`).
- Draft PRs are permitted only to hand off genuinely unfinished work with a
  comment describing exact remaining steps.

## Definition of Done

An implementation issue is Done only when **all** of the following hold:

- acceptance criteria are satisfied — for a criterion marked
  **customer-verifiable** (see "Verifiable acceptance criteria" in
  `product-management.md`), the PR must name it as such, supply whatever
  proxy evidence is feasible, and leave verification explicitly to the
  customer; it must never be silently claimed as verified or silently
  dropped
- appropriate tests exist and pass
- for a UI-affecting change, the rendered evidence required under "Pull
  Requests" above is present and matches the change
- required CI passes
- the implementation received independent review (different session)
- blocking review feedback is resolved
- the PR is merged
- associated documentation (README, ADRs, user-facing docs) is updated where
  appropriate

"Done" never means merely "code was written."
