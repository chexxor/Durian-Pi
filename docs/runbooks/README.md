# durig runbooks (SOPs)

**Status:** working set — authoring conventions plus the first runbooks. Audience: the **delegate**
(operator-facing) and **seats** (a seat reads a runbook when it is woken into a situation it does not
own). A runbook is an operating procedure, not a design doc: the design lives in `BROKER-ARCHITECTURE.md`
/ `BROKER-SUPERVISION.md` / `COMMANDS-AND-THE-BROKER.md`; this directory is *what to do*.

**A research request is open** (`docs/reviews/runbooks-research-prompt.md`): best practices for authoring
and maintaining operational runbooks, especially ones an LLM seat can execute. Until it lands, the
conventions below are our own, drawn from the failures in `docs/NEXT.md` (2026-10-16).

## The one rule that shapes every runbook: single writer

The broker owns the store; a second `Harness`-opening verb while it runs is what corrupted the store
twice. Every procedure that writes therefore starts by **stopping the broker and confirming it exited**,
and every procedure that only reads says so. See `COMMANDS-AND-THE-BROKER.md` §4 for the command table.

## Conventions

1. **One situation per file**, named for the symptom a person would type: `broker-down-or-stalled.md`,
   not `troubleshooting.md`. The filename is the index key.
2. **Fixed skeleton** so a reader (or a seat) can skim it and stop at the part they need:
   - `## When to use` — the observable symptom.
   - `## Preconditions` — what must already be true (usually "broker stopped").
   - `## Diagnose` — read-only commands that confirm the situation.
   - `## Do` — numbered, copy-pasteable steps; each command is complete (`DURIG_DB=… node cli.mjs …`).
   - `## Verify` — how to confirm the fix worked (a command and the expected output).
   - `## If it fails` — rollback or escalate; never leave a half-applied write.
   - `## Evidence` — the item/commit that proved the procedure, and the **last verified** date.
3. **Commands are literal.** No pseudo-commands; a step is either a real command or prose explicitly
   marked as judgement. Windows only (`node cli.mjs`), never `wsl`/`docker`.
4. **Stop before write.** A step that writes names the stop/verify that precedes it. A runbook that
   needs the broker up only reads.
5. **Verified, not assumed.** A runbook is done when its `Verify` step has actually been run; record the
   date and the evidence. A runbook whose `Verify` has not run is marked **unverified** (see below).
6. **Small and stable.** Prefer link-out to the design doc over restating it; a runbook that grows a
   "background" section should move that to the design doc.
7. **Ownership.** The operator surface is the delegate's; a seat-runbook's operation is the team's. The
   `Evidence` line names who verified it. `scribe` keeps these true to the code like any other doc.

## Index

| Runbook | Use when | Writes? |
|---|---|---|
| [broker-down-or-stalled.md](broker-down-or-stalled.md) | seats idle with queued work; no `serve` process; log stops | yes (restart) |
| [broker-safe-change.md](broker-safe-change.md) | a model/constitution/reset change must apply without corrupting the store | yes |
| [store-corruption-recovery.md](store-corruption-recovery.md) | every write verb fails with `Session failed after a storage error` | yes (repair) |
| [seat-reset.md](seat-reset.md) | a seat is degenerate / looping / answering in the wrong language | yes |
| [leaked-worktrees.md](leaked-worktrees.md) | `git status`/`git worktree list` shows stray `item-*` | maybe |

## Template

```markdown
# <Runbook title>

## When to use
<the observable symptom, in the words a person would use>

## Preconditions
<what must be true; usually: the broker is stopped and verified>

## Diagnose (read-only)
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs status
```

## Do
1. …
2. …

## Verify
<command + expected output>

## If it fails
<rollback or escalate>

## Evidence
<item/commit + last verified date>
```
