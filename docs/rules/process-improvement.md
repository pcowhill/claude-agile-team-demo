# Retrospectives and Process Improvement

The AI team may improve its own development process — deliberately and
visibly, never silently.

## When to hold a retrospective

The trigger is **ten merged implementation PRs since the last
retrospective**, or sooner when a recurring failure pattern is evident:
repeated CI failures, poor issue decomposition, oversized PRs, repeated
regressions, ineffective tests, customer questions that should have been
avoidable, review problems, missing repository instructions, or inefficient
practices.

Count it rather than estimating it — orientation step 6 in `CLAUDE.md`:

```sh
RETRO=$(ls -1 docs/retrospectives/2*.md | tail -1)
ANCHOR=$(git log --diff-filter=A -1 --format=%H -- "$RETRO")
git log --oneline "$ANCHOR..HEAD" | grep -cE '\(#[0-9]+\)$'
```

Three details in there are load-bearing, each because the obvious version is
wrong (#302 has the measurements):

- **A commit range, not a date.** A bare `--since=YYYY-MM-DD` naming *today*
  resolves to now rather than to midnight and returns zero — exactly on the
  day a session is most likely to run the check, and silently.
- **`--diff-filter=A`, the commit that *added* the file**, not the one that
  last touched it. Retrospectives get edited later; anchoring on the last
  touch would move the range's start forward and undercount.
- **The `$` anchor** counts squash-merge subjects, which is what a merged PR
  looks like in this history. The newest retrospective's own PR falls
  outside the range rather than counting as work done since itself.

**Who acts on the count.** The session that finds it at ten or more holds
the retrospective, if it has no higher-priority work: this is priority 7 in
`operating-model.md`, so broken main, an open PR to review, a stalled PR to
fix, and answered customer questions all come first. A session that *does*
have higher-priority work opens a `process` issue titled "Retrospective
due" instead — or comments on the open one — so the next session inherits
the finding from the backlog rather than re-deriving it. Neither route is an
emergency; neither is optional.

The count is there because a feel for the cadence was not enough. The
2026-09-03 retrospective covered **31 merged PRs** (#214 → #291) against
this ten-PR trigger — the fourth consecutive period over cadence and the
widest margin yet, by its own reckoning; the 2026-08-31 one had already
recorded the third, at double the five-PR trigger the rule carried then, and
raising the number to ten was its own recommendation. Changing the number
did not fix it. The trigger was stated all along; nothing in the orientation
routine made a session notice it (#302).

A retrospective is itself work — do not hold one when there is nothing to
learn, and keep it lightweight. This section sets the trigger only; how deep
one goes is unchanged.

## How

1. Review recent merged PRs, closed issues, review threads, and CI history.
2. Write a short summary in `docs/retrospectives/` (see its README):
   what went well, what went poorly, and specific proposed changes.
3. For each change worth making, open a `process` issue describing the
   problem, evidence, and the proposed change.

A retrospective or `process` issue that proposes an executable check — a
command, a script, a grep — must have **run** it and say what it returned.
Proposing an unexecuted command is how a broken check reaches every session
at once: #302 proposed a `git log --since=<date>` count that silently
returns zero on the day a retrospective is written, and only the
implementing session's measurement caught it (#357). The same applies to
citations in an issue, a retrospective or a PR body: a PR number, file path
or commit that a later session will rely on gets looked up, not recalled.

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
