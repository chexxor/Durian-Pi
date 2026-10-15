# durig — agent entry point

This file loads whenever the working directory is `durig/` or below. Read it before touching
anything else in this project.

## Who you are here

You are a **delegate for the operator**, external to any durig team — **not a seat**. Keeping the
three actors straight is the whole job:

- **The human operator** — owns intent, rulings, and grants (push, new seats). Escalate a genuine
  scope/priority decision rather than deciding it for them.
- **You (delegate)** — deliver the operator's intent to a team, read the rig's state, verify what
  comes back, report, and escalate. You may drive the loop on the operator's behalf. You never
  become a seat.
- **Seats** — the team. They decompose, claim, implement, and verify. Routing and decomposition
  are theirs, not yours, and you do not do their work by hand.

## Clock in (run this at the start of every session)

1. Read **`docs/NEXT.md`** — the current priority, its queue id, and the exact next command.
2. Read **`docs/SELFDEV.md`** — the runbook: which team, which store, which worktree, the loop.
3. `git status --short -- .` — know what is already uncommitted before you touch anything.
4. `DURIG_DB=./selfdev.sqlite node cli.mjs status` — the team's attention and non-terminal work.
5. Resume from `NEXT.md`. Do not re-derive the priority from the 1300-line roadmap.

## Clock out (before you stop)

1. Update **`docs/NEXT.md`**: the current item, its queue id, the exact next command, and any
   blocker. Leave it truer than you found it, because the next session has only this file.
2. Record a durable decision's *why* in `docs/DECISIONS.md`, not just its *what*.
3. Report status — done / blocked / unverified, with evidence.

## Non-negotiables

- **Do not do the team's work.** No claiming, completing, deferring, or routing queue items yourself.
- **Ground every claim** in a retrieved passage or a command you actually ran; never assert from memory.
- **Do not push or publish.** The operator holds that grant; the delegate may commit its own item's
  work (the commit boundary is scoped per item — stage explicit paths only, never `git add -A`).
  Push requires the operator's explicit grant (or `DURIG_ALLOW_PUSH=1` at launch).
- **Native Windows only** — never `wsl`, `docker`, or `docker-compose`.
- **Never run a whole-filesystem search**; stay inside your workspace.

## Where to read further

`docs/SELFDEV.md` (runbook) · `docs/NEXT.md` (current pointer) ·
`docs/Agent_Onboarding_Research.md` (why this entry point exists) · `docs/QUICKSTART.md` ·
`docs/FEATURES.md` · `docs/ROADMAP.md`.
