# Development Checklist — GALXECODE 26

## Before coding
- [ ] Understand the requirement
- [ ] Confirm the owner (avoid duplicate work)
- [ ] Confirm the files/modules affected
- [ ] Pull latest `dev`

## During coding
- [ ] Keep changes focused on the one task
- [ ] Test locally as you go
- [ ] Do not commit secrets or `.env`
- [ ] Follow existing patterns

## Before commit
- [ ] Run relevant tests / lints
- [ ] `git status` — nothing unintended staged
- [ ] `git diff --cached` — review what you're committing
- [ ] Confirm no `.env`, `node_modules`, build artifacts, or large binaries staged
- [ ] Environment variables read from `.env`, not hardcoded

## Before merging into dev
- [ ] Pull latest `dev` into your branch
- [ ] Resolve conflicts carefully (don't blindly accept "theirs" or "ours")
- [ ] Run the build
- [ ] Run tests
- [ ] Verify core functionality still works
- [ ] Get one teammate's review

## Before demo
- [ ] Fresh clone / fresh startup works from scratch
- [ ] Main user flow works end-to-end
- [ ] AI/API calls work (or fallback is in place)
- [ ] Database reachable and seeded
- [ ] Errors handled gracefully — no unhandled exceptions on stage
- [ ] Demo data prepared and loaded
- [ ] Screenshots and/or backup video recorded
- [ ] `main` tagged with the demo commit
