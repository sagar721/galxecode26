# Team Workflow — GALXECODE 26

## Roles (provisional — adjust after problem statement)
- **Member 1** — Lead / Integration / Architecture
- **Member 2** — Frontend / UI
- **Member 3** — Backend / APIs
- **Member 4** — AI / Core Logic
- **Member 5** — Testing / Demo / Documentation

## Branches
- `main`  — stable, demo-ready. Protected in spirit; only merge from `dev`.
- `dev`   — integration branch. All feature branches merge here first.
- `feature/<short-kebab-name>` — one branch per task.
  - Examples: `feature/login-ui`, `feature/api-scoring`, `feature/ai-prompt-v2`.
- `fix/<short-kebab-name>` — bug fixes.

## Commit messages
Format: `<type>: <short imperative summary>`

Types:
- `feat:`  new feature
- `fix:`   bug fix
- `chore:` tooling / config / non-code
- `docs:`  documentation
- `refactor:` code change, no behavior change
- `test:`  tests only

Examples:
- `feat: add user login form`
- `fix: handle empty API response`
- `chore: add eslint config`

## Pull / merge process
1. `git checkout dev && git pull origin dev`
2. `git checkout -b feature/<name>`
3. Work → commit → push.
4. Open PR into `dev`. Request one teammate to review.
5. Reviewer pulls the branch, runs it, approves.
6. Merge into `dev`. Delete the feature branch.
7. Only Lead merges `dev` into `main`, and only when `dev` is demo-ready.

## Reporting bugs
- File an entry in `progress.md` under **Bugs** with:
  - What you saw / expected
  - Steps to reproduce
  - Branch + commit hash
  - Who's fixing it

## Updating progress.md
- Whenever you complete, start, or block a task, update `progress.md`.
- Keep it short — one line per item.
- Move items between **Pending → In Progress → Completed**.

## Avoiding file conflicts
- Own your area: frontend/backend/ai/database. Don't edit another area's files without asking that owner.
- Shared files (README, docs, root configs): announce in team chat before editing.
- Pull frequently. Small, frequent commits reduce conflict pain.

## Keeping `dev` stable
- Never merge broken code into `dev`.
- Run the app locally before opening a PR.
- If `dev` breaks: whoever broke it fixes it first, before anything else lands.

## Preparing `main` for the demo
- Freeze `dev` ~1 hour before demo.
- Lead merges `dev` → `main` only after a full end-to-end run-through.
- Tag the demo commit: `git tag demo-v1 && git push --tags`.
- Keep a recorded backup of the working demo.
