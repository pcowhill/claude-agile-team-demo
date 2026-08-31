# GitHub Conventions

## Labels

| Label | Meaning |
|---|---|
| `customer-feedback` | Raw, free-form input from the customer. Processed per `product-management.md`, then closed; never deleted. |
| `customer-question` | A question that requires the customer's judgment. Assigned to the customer; answered by normal comment. |
| `customer-approved` | Applied **only by the customer**, to an `idea` issue, to approve it as product scope. |
| `ai-generated` | The issue was created by the AI team rather than the customer. See "Origin labels". |
| `human-generated` | The issue was created by the customer. See "Origin labels". |
| `idea` | A product idea / AI suggestion (#173). With `ai-generated` and without customer approval (label or explicit go-ahead comment), it is not implementable scope. |
| `feature` | New or changed product functionality. |
| `bug` | Something is wrong in the product, tests, or tooling. |
| `tech-debt` | Necessary engineering improvement without direct feature value. |
| `blocked` | Cannot proceed; a comment must say what blocks it and link the blocker. |
| `process` | Changes to how the AI team works (rules, CI strategy, workflow). See `process-improvement.md`. |

Keep the taxonomy small. Add a new label only for a clear, durable purpose,
and document it in this table in the same PR. Do not create priority labels —
priority lives in the GitHub Project's Priority field (and, when that is not
writable, in the issue body/comments).

## Origin labels

Every issue carries exactly one of `ai-generated` or `human-generated`,
chosen by **who created the issue** — comments never change it (customer
requested this in #79). All sessions share one GitHub account, so the label
is the only visible record of origin.

- A session applies `ai-generated` to every issue it creates, whatever the
  issue's kind (derived work, bugs, questions, ideas, process).
- The customer may label their own issues `human-generated`; when they
  forget, any session that touches or triages the issue adds it.
- These labels record provenance only. Approval semantics are unchanged:
  an `idea` + `ai-generated` issue still needs `customer-approved`
  (see `CLAUDE.md` invariants).

## GitHub Project

A GitHub Project linked to this repository tracks flow. Do not redesign or
remove its fields or automations.

- **Status lifecycle:** Inbox → Backlog → Ready → In Progress → In Review →
  Blocked → Done.
- **Priority:** P0 critical/blocking, P1 high, P2 normal, P3 low /
  nice-to-have.

Meanings: **Inbox** untriaged; **Backlog** triaged, not yet fully ready;
**Ready** scoped with acceptance criteria, implementable; **In Progress**
implementation underway; **In Review** PR open awaiting independent review;
**Blocked** see `blocked` label; **Done** per the Definition of Done.

Maintain Project fields when the authenticated environment can write them.
**Project write access must never be a process dependency.** If Project
fields cannot be manipulated: do not request credentials, do not fail —
continue with Issues, PRs, labels, comments, and links, and rely on the
Project's built-in automations. Everything needed to select work must be
inferable from Issues and PRs alone: readiness from issue content and labels,
in-progress state from comments and open PRs, priority from customer
statements and issue content.

## Linking

- PRs link their issue with closing syntax (`Closes #123`) when merge should
  close it.
- Derived issues link their origin (`Derived from #45`); origins get a
  comment listing derived issues.
- Decisions applied from an answered `customer-question` are linked wherever
  they are applied.
- Blocked items link their blockers.

Cross-links are how stateless sessions reconstruct context — when in doubt,
link.

## Assignment

Assign `customer-question` issues (and anything else needing customer action)
to the repository owner when permissions allow. Issues the AI team will
handle need no assignee — an open, unblocked issue is available work.
