# claude-agile-team-demo

An experiment in **repository-driven autonomous software development**.

## The product: Browser Video Editor

The customer asked for a simple video editor that runs entirely in the
browser (#3): import clips, arrange and trim them on a timeline, preview the
result, and export a video file. It is deployed automatically from `main` to
GitHub Pages: **https://pcowhill.github.io/claude-agile-team-demo/**

Stack: Vite + TypeScript + React, tested with Vitest and React Testing
Library, linted with oxlint — see
[`docs/adr/0001-frontend-stack-and-deployment.md`](docs/adr/0001-frontend-stack-and-deployment.md).

### Development

```bash
npm ci             # install dependencies (Node 22)
npm run dev        # local dev server
npm test           # unit tests (Vitest)
npm run test:e2e   # browser tests (Playwright; needs its Chromium — npx playwright install chromium)
npm run lint       # oxlint
npm run typecheck  # tsc -b
npm run build      # production build to dist/
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, and build on
every PR and push to `main`; merged changes deploy to GitHub Pages via
`.github/workflows/deploy.yml`.

This repository is built and maintained by a succession of independent
Claude Code sessions acting as an agile software team — product manager,
developer, reviewer, QA engineer, release engineer, maintainer. Each session
is started with essentially one instruction (`Go`) and orients itself
entirely from the persistent state in this repository and its GitHub Issues,
Pull Requests, comments, and CI results. The full operating model lives in
[`CLAUDE.md`](CLAUDE.md) and [`.claude/rules/`](.claude/rules/).

There is no predetermined product. What gets built is decided by the human
**customer** through GitHub. The repository's history — issues, PRs, reviews,
decisions — is itself an artifact of the experiment.

## How to interact with the team (for the customer)

- **Ask for anything / give feedback:** open an issue using the *Customer
  feedback* template. Write informally — no user stories, acceptance
  criteria, or technical detail required. The team translates it into
  actionable work.
- **Answer questions:** the team asks for your judgment via issues labeled
  `customer-question`, assigned to you. Reply with a normal comment.
- **Approve AI ideas:** the team may propose product ideas (labeled `idea` +
  `ai-generated`). They are built only if you add the `customer-approved`
  label. Closing an unapproved idea rejects it.
- **Set priorities:** say so in issues, or use the linked GitHub Project's
  Priority field (P0–P3).

Everything else — triage, implementation, review, merging, releasing — is
handled by the AI team through ordinary GitHub workflow.

## Key guarantees the team operates under

- GitHub Issues and PRs are the single source of truth for work.
- The session that authors a PR never reviews or merges it; an independent
  session does.
- AI-proposed product ideas never become scope without explicit customer
  approval.
- Test results are only ever claimed from real execution or CI evidence.
