# CLAUDE.md — GALXECODE 26

## Project
GALXECODE 26 hackathon. Single day. 5-member team.

## Goal
Ship a working, demonstrable MVP by end of day.

## Development principles
1. MVP first — a working thin slice beats a half-built grand plan.
2. Working functionality > unnecessary features.
3. Do not over-engineer. Every abstraction must earn its place.
4. Do not rewrite working code without a strong reason.
5. Keep architecture understandable to every teammate.
6. Keep dependencies minimal — every new package is a risk.
7. Test important functionality after changes.
8. Never commit secrets. `.env` is git-ignored; use `.env.example`.
9. Never fabricate data or claim a feature works when it does not.
10. Prefer simple solutions that demo reliably.
11. Every important technical decision must be understandable by the team.
12. Keep the project runnable at all times — `main` must always start.

## Git principles
- `main` = stable, demo-ready. Only merges from `dev` after review.
- `dev` = integration branch. All feature branches merge here.
- `feature/<name>` = individual work.
- Do not push directly to `main` for risky changes.
- Commit meaningful chunks with clear messages.
- Pull before starting work; push completed work regularly.
- Never force-push a shared branch without explicit team approval.

## Code principles
- Follow the existing architecture in this repo.
- Reuse existing components/functions where possible.
- Avoid duplicate logic.
- Handle errors properly — don't swallow exceptions.
- Validate user input.
- Keep secrets in environment variables, loaded from `.env`.
- Add comments only where they improve understanding.
- Prefer maintainable code over clever code.

## AI principles
- Use AI only where it provides genuine value to the demo.
- Never fake AI results.
- Keep prompts and versioned logic organized (e.g. `ai/prompts/`).
- Handle API failures gracefully; provide fallback behavior where practical.
- Cache/mock AI responses for demo reliability.

## Demo principles
- The core demo flow must work end-to-end.
- Prepare demo/sample data.
- Avoid features that cannot be reliably demonstrated.
- Keep a backup/demo-safe path (recorded video, cached responses).
- Never depend on an untested last-minute change for the demo.

## For Claude (agent) sessions
- Before changing files, read them.
- Do not add fake code, mock APIs, or placeholder features unless asked.
- Do not commit `.env` or any secret.
- Prefer editing over rewriting.
- Ask before large refactors.
- Keep changes scoped to the requested task.
