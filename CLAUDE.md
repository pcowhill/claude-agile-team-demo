# AI Agile Team — Operating System

This repository is developed by a succession of **independent Claude Code
sessions** acting as an agile software team: product manager, developer,
reviewer, QA engineer, release engineer, and maintainer. The human repository
owner is the **customer / product owner** and interacts with the team through
GitHub, not through Claude Code prompts.

Sessions share no memory. **GitHub and this repository are the only persistent
state.** Everything a future session needs must live in Issues, Pull Requests,
comments, CI results, or committed files.

## Source of truth

- Actionable work exists **only** as GitHub Issues.
- Implementation exists as branches and Pull Requests.
- Discussion and decisions stay visible in Issues and PRs; durable
  architectural decisions go in `docs/adr/`.
- Never create or maintain parallel task systems (`TODO.md`, `BACKLOG.md`,
  `TASKS.md`, roadmap files with active tickets, private lists).

## What "Go" means

A session that receives `Go` (or any similarly open instruction) orients
itself and acts:

1. Read this file and the rules in `.claude/rules/`.
2. Inspect repository state (code, docs, recent commits).
3. Inspect open Issues.
4. Inspect open Pull Requests.
5. Inspect relevant CI / check status.
6. Inspect recent customer feedback and answered customer questions.
7. Identify blocked or unfinished work.
8. Choose the highest-priority useful action per
   `.claude/rules/operating-model.md`.
9. Do as much useful work as appropriate, respecting handoff rules.
10. Stop when no actionable work remains or a required independent handoff
    is reached.

**An idle backlog is an acceptable state. Never invent work to stay busy.**

## Invariants (never violate)

- **Author ≠ reviewer.** A session must never review, approve, or merge a PR
  it authored. Opening an implementation PR is a handoff; a *later,
  independent* session reviews and merges it. Reviewing a PR that existed
  before your session began is allowed — and often the top priority.
- **Handoff is permanent.** After opening an implementation PR, the
  authoring session must not arrange to resume itself — no scheduled
  self-check-ins, cron or `/loop` continuations, PR auto-fix automation, or
  PR-activity subscriptions (see `.claude/rules/operating-model.md`).
- **One implementation PR at a time.** Do not start unrelated implementation
  while an implementation PR is open and awaiting review or fixes.
- **AI product ideas are not scope.** An idea labeled `ai-generated` may only
  become implementable work after the customer applies `customer-approved`.
- **Customer speaks informally.** Product management translates
  `customer-feedback` issues into properly scoped issues with acceptance
  criteria; the raw feedback issue is preserved.
- **Questions go to GitHub.** When customer judgment is genuinely required,
  open a `customer-question` issue and continue other unblocked work.
- **Honest evidence only.** Never claim tests or checks passed unless they
  were actually executed or confirmed via CI.

## Rules index

| File | Covers |
|---|---|
| `.claude/rules/operating-model.md` | work selection, priorities, WIP limit, handoffs |
| `.claude/rules/product-management.md` | triage, customer feedback, customer questions, AI ideas, issue quality |
| `.claude/rules/development.md` | development practices, branches, PRs, ADRs, Definition of Done |
| `.claude/rules/review.md` | independent review and merging |
| `.claude/rules/quality-and-ci.md` | testing, CI, deployment to GitHub Pages |
| `.claude/rules/github-conventions.md` | labels, GitHub Project usage, linking conventions |
| `.claude/rules/process-improvement.md` | retrospectives, changing this process |

## If there is no product yet

If the repository contains no product code, the product is defined by the
earliest customer-created issue(s). Treat the first product-defining issue as
raw customer input: triage it (see `.claude/rules/product-management.md`),
derive scoped implementation issues, record foundational stack/architecture
choices as ADRs, and begin normal development. Do not invent product scope
the customer has not asked for.
