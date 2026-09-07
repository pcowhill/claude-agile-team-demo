# Operating Model and Work Selection

## Session model

Each Claude Code session is independent and stateless. A session may act in
one or several roles (product manager, developer, reviewer, QA, release
engineer, maintainer) as the work demands, subject to the author/reviewer
boundary in `review.md`. Everything worth remembering must be persisted to
GitHub (Issues, PRs, comments) or committed files before the session ends.

## Work selection priority

After orienting (see "What Go means" in `CLAUDE.md`), pick the
highest-priority applicable action. Approximate order:

1. **Broken main.** Failing CI on `main`, or a broken deployment, outranks
   everything else.
2. **Review an open implementation PR** you did not author. Getting existing
   work merged beats starting new work.
3. **Fix an open implementation PR you may touch** — failing CI, merge
   conflicts, or unresolved review feedback on a PR whose author-session is
   gone. (Fixing a PR does not make you its reviewer; substantial new commits
   to a PR make you a co-author, and someone else must still review them.)
4. **Incorporate answered `customer-question` issues** into the work they
   blocked, link the decision, and close the question.
5. **Triage new `customer-feedback`** into scoped, actionable issues.
6. **Implement the highest-priority Ready issue** — but only if the WIP rule
   below permits.
7. **Backlog hygiene**: refine vague issues, close duplicates, update stale
   issues, record overdue ADRs or retrospectives when genuinely warranted.
8. **Suggestion upkeep** (customer-directed, #173): if no open unapproved AI
   suggestion (`idea` + `ai-generated`) exists, create one — never exceeding
   three open suggestions. See "AI product suggestions" in
   `product-management.md`.
9. **Stop.** If none of the above is actionable, end the session and say so.

Priority signals, in order of authority: the customer's explicit statements >
GitHub Project `Priority` field (P0 critical → P3 nice-to-have) > labels
(`bug` generally before `feature`, `blocked` is not actionable) > issue age.

## Work-in-progress limit

**At most three open implementation PRs at a time, and a session may author at
most three of them.** The three include PRs opened by earlier sessions that are
still open — the cap is on how much unreviewed work the repository carries, not
on how much any one session produced.

Parallel work is allowed only where it is genuinely parallel. Before starting a
second or third implementation, check that the issues are independent:

- neither depends on the other's outcome, and either could be merged first
  without the other needing changes;
- they touch disjoint enough **logic** that a reviewer can judge each on its
  own — a textual collision is not necessarily a dependency, and "Textual
  conflict is not dependence" below says which is which;
- neither one's acceptance criteria can only be evaluated once the other has
  landed.

If independence is doubtful, treat the issues as serialized: implement one and
leave the other for a later session. Two entangled PRs cost a later session
more untangling than the parallelism saved.

Each PR is a separate handoff: its own branch (see `development.md`), its own
linked issue, its own PR context, and its own independent review. Author ≠
reviewer is unchanged — a session never reviews, approves, or merges any PR it
opened, however many it opens.

While three implementation PRs are open, do not start a fourth implementation.
Permitted concurrent activities: triage, feedback processing, answering/asking
questions, reviewing an open PR (if you are not its author), fixing its CI,
resolving blockers, documentation-only corrections.

The cap is a ceiling, not a target. Filling it is not a goal, and a session
that opens one PR and stops has done nothing wrong. Prefer finishing existing
work over creating new work — reviewing a PR you did not author still outranks
starting a new implementation (see "Work selection priority"). Prefer small,
coherent PRs over large bundles of unrelated changes.

**Take the top issue first.** When a session reaches priority 6 and intends
to implement, it starts with the highest-priority Ready issue rather than a
smaller one, because that is when its budget is largest. Do not fill the WIP
cap with smaller items ahead of it: a cap filled with small work is a cap
that excludes the big work. If the top issue is genuinely too large for the
budget that remains, comment on it saying so — naming what a later session
should know — and take the next issue down. Recording the deferral is what
keeps "nobody got to it" from looking like an oversight. (#356: the top
customer-derived issue once sat Ready for a day while eleven smaller PRs
merged around it, each individually justifiable.)

### Textual conflict is not dependence

The second bullet used to read "disjoint enough *code* … merging one does not
conflict with the other". Two sessions applied that honestly to #413 and #404
and both got it wrong the same way (#431). Each reasoned about hunks and each
was right about them — the zoom block and the `NameField` block sit far apart
in `Timeline.tsx` — but both PRs also added one line to the same **import
list** (`ZoomEditor` in #428, `NameField` in #429, both just after
`ConfirmDialog`), so merging #428 left #429 un-mergeable. Distinguish:

- **A logic conflict** — one PR changes behaviour the other relies on, or
  introduces a shape the other should adopt. The issues are **not**
  independent: serialize them.
- **A convergence-point conflict** — a textual collision at the one line every
  PR of its kind reaches for: an import list, an export barrel, a registry or
  `switch` that each new kind must extend, the tail of a test file. Expected,
  cheap, and **not** a dependency. Two PRs adding two components to one file
  *must* both touch its import list, and serializing every such change would
  cost far more than these conflicts do.

`development.md`'s "new test blocks go before the file's last `describe`" is
the same phenomenon where a workaround exists — the end of a file is the line
every PR reaches for, and moving the block sidesteps it. An import list has no
such escape, which is why it needs a rule rather than a convention.

**What a claim comment should say.** Do not promise "any order of merging"
when a convergence point is shared. Name it and say it is trivial — "both add
an import to `Timeline.tsx`: expect a one-line conflict, no logic overlap".
Nothing else changes. The conflict is resolved by whichever session merges the
first PR, under `review.md`'s trivial-mechanical-fix carve-out and
`development.md`'s "a fix for an open PR goes on that PR's own branch"; those
two remain the single place that says how a conflict gets resolved.

**Wide mechanical edits are the case nobody can assess.** A PR that rewrites
many call sites across files it does not otherwise own — a renamed API, a
control moved behind a test helper — is neither a logic conflict nor a named
convergence point. It is a moving target: its edits sit at whatever lines
happened to call the old thing. #435 routed the library's moved controls
through a helper in **28 test files** (23 e2e specs and 5 component suites,
counted from its merge commit), and #436 rewrote **99 call sites across 37
test files** (counted with `git grep` before the change), both touching
`src/components/Timeline.test.tsx`. In each case the honest
answer to "would merging one conflict with the other" was *"probably not, but
neither of us can say"*, and in each case the session serialized — which is
what "if independence is doubtful" above already requires. So this is not a
third verdict; it is what makes the doubt legible instead of leaving the next
session to re-derive it:

- the PR carrying the wide edit **names the files it rewrites**, in its claim
  comment or its PR body, so a later session can check its own footprint
  against that list rather than reading the diff. #436 did this and it cost a
  paragraph.
- A later session whose issue lies outside that list may treat any remaining
  overlap as a convergence point; one that lies inside it serializes, and
  **says so on the issue it is deferring** — a deferral nobody recorded is
  indistinguishable from nobody having got to it (see "Take the top issue
  first" above).

A file list does not by itself make two issues independent — it names files,
not the lines that move, and in both cases above the later issue was still
serialized. What it buys is a later session deciding in a minute rather than
guessing.

## Handoffs

A natural handoff is reached when a session has, for one issue:
implemented → tested → pushed the branch → opened the PR → linked the issue →
supplied PR context. At that point the session must stop implementing that
issue and must not review or merge its own PR. It may continue with other
permitted activities — including implementing another independent issue while
the WIP limit above allows it — or end.

**Handoff is permanent for the authoring session.** Once an implementation PR
is open and context is supplied, the author session must not arrange to resume
itself for it: no scheduled self-check-ins or reminders, no cron or
`/loop`-style continuations, no PR auto-fix automation, and no subscribing
to the PR's activity or CI events. This holds for every PR the session opened.
Follow-up on a PR — review feedback, CI failures, merge conflicts — belongs to
later, independent sessions, which discover it by orienting from GitHub state.
If the session's harness offers to watch, monitor, or auto-fix the PR, decline.
Moving on to another independent issue is not self-resumption; going back to
one of your own open PRs is.

## Blocked work

If work cannot proceed:

- Label the issue `blocked` and comment with what blocks it and what would
  unblock it (link the blocking issue or `customer-question`).
- Continue with other unblocked work rather than halting entirely.
- Remove `blocked` when the blocker is resolved.

**Nothing blocks on the person running the session.** Waiting on a human is
never a state this repository's work can be in: the customer answers on
GitHub, in their own time, and the session that needed the answer will be
long gone (`product-management.md`). So a session never ends a turn holding
a question, and never treats "I am not certain I am allowed to" as a
blocker — see the invariant in `CLAUDE.md`.

Where the harness's own instructions and these rules seem to disagree, they
usually do not: the harness says where a session's *own* work goes, while
these rules say what work exists and how it is carried out. Read both,
choose the reading that lets the repository's work proceed, and record the
reasoning in the issue or PR so the next session inherits the answer rather
than the dilemma. If the two genuinely cannot both be satisfied, do the
part that is unambiguous, say plainly in the issue or PR what you did not
do and why, and open a `process` issue — that is how the rules get fixed.

## No artificial activity

Do not manufacture tickets, ceremonies, documentation, refactors, or
architecture merely to look active. Agile practice here exists to improve
delivery, not to maximize visible process. Useful issues, clear decisions,
small PRs, test evidence, meaningful review, and customer value beat
ceremony. If there is no useful work, stop and report that clearly.

## Ending a session

Before stopping, ensure state is persisted: branches pushed, PRs opened or
updated, issue comments recording partial progress or discoveries, labels
current. A future session must be able to pick up from GitHub alone.
