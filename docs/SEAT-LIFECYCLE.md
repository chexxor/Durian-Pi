# Seat lifecycle — what a seat is, and where its files live

**Audience:** an end-user or maintainer who wants to answer *"what happens to a seat from creation to
teardown, and where do its files live?"*. This is the operational narrative, not the internals: design
and architecture live in the docs it links to, and the feature inventory is in `FEATURES.md`. Every
behaviour below is grounded in the source and demos named in the **Evidence** table at the end, so a
reader (or a `check` rule) can verify it rather than trust it.

---

## 0. The short answer

A **seat** is one named agent = **one pi-durable conversation** plus a **roster entry** (name,
conversation id, role, capabilities). It is created by `up`, lives its working life inside an **isolated
per-item git worktree** it prepares itself, and is retired when `complete_work` succeeds. The seat's own
**durable transcript** is the durable record; the worktree is **not shared state**.

```
up → seat exists (conversation + roster)
  → woken (send/run/serve) → claim_work → prepare_workspace (creates <root>/item-<id>, points the seat
    at it) → work + commit (explicit paths) → complete_work → worktree retired, cwd reset to shared tree
Interruptions along the way: stop · reset · resume · generation-slot lease · stalled-claim re-wake.
```

---

## 1. Creation

- **`up <rig.json>`** creates a seat: a pi-durable **conversation** plus a **roster entry** recorded on
  the store, from the rig spec's seats/edges/constitution. See `QUICKSTART.md`.
- **`up --refresh`** **re-points** an existing seat (re-applies stored prompts, models, and each seat's
  working directory) and is **idempotent** — re-running it does not duplicate a seat.
- Each seat carries its own **model** and **prompt**: `seat.model` (provider/model or bare id, resolved
  per `src/seatmodel.mjs`) and the compiled persona. See `FEATURES.md` §"Per-seat model" and §"Persona
  compilation".
- On creation the seat's working directory is resolved **once** and persisted onto the conversation as
  `seat.cwd ?? spec.cwd ?? DURIG_SEAT_ROOT` (`cli.mjs`).

**Where the roster lives:** the `Seats` document in the store, named `<db>.sqlite` (default
`./rig.sqlite`), read through durig's one shared storage opener.

---

## 2. Isolation & environment

A seat's file/shell tools are confined to a **root**; which root is decided per-seat, in this order
(`makeSeatEnv`, `src/seattools.mjs:187-204`):

1. **the seat's own persisted `cwd`** — wins. `prepare_workspace` sets this to the item's worktree, so a
   seat that prepared a workspace is confined to **its own tree**, regardless of any other seat;
2. else **`DURIG_SEAT_ROOT`** — a *fallback* for a seat that has not prepared a workspace (e.g. a rig
   pointed at one shared checkout), **never** a global override of a prepared root;
3. else the **launching `cwd`** (`process.cwd()`).

`makeSeatEnv` **fails closed**: a conversation that is not a known seat gets the read-only (verifier)
environment, never an unconfined one.

Two layers hold the boundary (see `SEAT-TOOLS.md`, the M3 design):

- **SC1 — a confining execution environment** (`src/confine.mjs`) roots `read`/`write`/`edit`/shell at
  the seat's root and rejects absolute-path escapes, `..`, and symlink escapes.
- **Tool sets** narrow on top of it: an author seats keeps `read`/`write`/`edit`/shell (+
  `prepare_workspace`); a **verifier** loses `write`/`edit` and reads a disposable snapshot; a
  **coordinator** (pm/lead, no working capability) keeps none of the **working** file/shell tools (it keeps only the protocol tools: `send_work`/`claim_work`/etc.). The author/verifier asymmetry is decided
  by the seat's declared capabilities, not its name (`toolRemovalsFor`). A working seat that is **not**
  a verifier keeps the full working set — the `security` seat (capabilities `security` + `review`) is not
  classified as a verifier (`seatsAreVerifier` keys on name/role, and "security engineer" matches no
  `VERIFIER_TERMS`), so it keeps `write`/`edit`/`shell` and can write its positions.

**The F12 seat-root guard (`cli.mjs:349-372`):** a **write-side** `send`/`run` whose `DURIG_SEAT_ROOT`
differs from a seat's persisted `cwd` **fails closed**, naming both paths and the fix (`up --refresh`
under the new root, or unset `DURIG_SEAT_ROOT`). View-only commands and `up --refresh` are unaffected.
This lives once per command where the write-side harness opens — not per tool call, which must stay
cheap.

**Inherited environment hazard (do not restate):** `SEAT-TOOLS.md` records that a naive install hands
the ambient credential (`DEEPINFRA_API_KEY`) to every command a seat runs unless the env layer refuses it
(SC3, `inheritEnv` forced false); a worktree contains **no** `durig.config.json` (untracked, gitignored),
so no seat reads a key off disk. These are enforced in `src/confine.mjs`, proven by
`demo/confine.test.mjs` and `demo/seatguard.test.mjs`. Read `SEAT-TOOLS.md` for the full hazard list
(H1–H4) rather than repeating them here.

**The scratch-path rule — where notes/scratch go.** A seat's item notes and scratch files (working notes
that are not part of the deliverable) must live **inside the item's worktree** (`item-<id>`), where the
seat is confined and can write. The shared repo-root **`.durig/`** is a **gitignored notes directory**
(`.gitignore:9`) and is **outside every seat's root**; a confined seat cannot write there, and that
refusal is **by design** (SC1 + the seat-root guard), **not a bug**. A landing pass's per-branch report
belongs in the **completion** (the pass row), not in a file.

---

## 3. The per-item worktree (`prepare_workspace`)

This is the **recent automation** and the normal working shape for every seat that produces or checks an
artifact. It replaces the older broker-assigned global root.

- **`claim_work` first.** A seat claims an item, then calls **`prepare_workspace`** (a seat tool, *not* a
  broker action) **before any filesystem work**.
- **What it does** (`src/seattools.mjs` `prepareWorkspace`): creates the item's isolated git worktree at
  `<root>/item-<id>`, installs deps (`npm ci --prefer-offline` per worktree, never a junction), and
  **persists THAT conversation's `cwd` to it** through `configure`. `makeSeatEnv` then resolves that seat
  to its own tree, so each seat in a pass is confined to its own checkout.
- **Idempotent:** an existing worktree is reused, so a resume never nests one worktree inside another.
- **The broker no longer sets a process-global `DURIG_SEAT_ROOT`** — the switch is per-seat and survives a
  restart.
- **Dirty-source carry:** when the shared tree is dirty, `prepare_workspace` **forks the visible state**
  (uncommitted tracked edits + untracked files) into the worktree and reports what it carried, so one
  seat's in-progress work cannot block another seat's worktree (`carryVisibleState`).
- **One worktree + branch per item**, `git worktree lock` while it runs, rebase-before-merge with
  `rerere`; removal is `git worktree remove` (never `rm -rf`), refusing a dirty tree or a junction.

The **shared tree** (`<root>`, where the broker and CLI run) is never a seat's write target; the seat
works and commits inside `item-<id>`.

At the end: **`complete_work` retires the worktree with `force: false`** — a dirty worktree is refused
and left for the operator, never discarded (D60), and the seat's `cwd` is reset to the shared tree so the
next item does not inherit a removed directory (`src/rig.mjs`).

> The machine-conformance aspect — *a doc-producing seat actually calls `prepare_workspace`* — is tracked
> separately as ROADMAP item 80 and is **out of scope** here.

---

## 4. Life — one item end to end

1. **Wake.** A seat is woken by `send <seat>`, `run`, or the resident broker `serve` when it has queued
   work (or a stalled claim). See `COMMANDS-AND-THE-BROKER.md`.
2. **Claim.** `claim_work` takes the oldest item addressed to the seat; the item becomes `claimed`.
3. **Prepare.** `prepare_workspace` creates/points at `<root>/item-<id>` and confines the seat to it.
4. **Work.** Read/write/edit/shell inside the worktree; commit with **explicit file paths only** (never
   `git add -A` / `.`), one concern per commit.
5. **Complete.** `complete_work` notifies the sender, retires the worktree (`force:false`), and resets the
   seat's `cwd` to the shared tree.

### Interruptions

- **`stop <seat> [reason]`** — emergency halt: kills the live generation-lease holder, settles the
  submission `aborted: <reason>`, releases the lease; a second stop is a no-op.
- **`reset <seat> [handoff]`** (alias `clean`) — writes a **`pi.reset` boundary** so prior turns leave the
  seat's context **without deleting the durable transcript**; the fix for a degenerate/looping turn.
  `reset` refuses while the seat holds a live generation lease. See `runbooks/seat-reset.md`.
- **`resume <seat>`** (alias `doctor`) — re-arms an admitted-but-not-progressing submission so a run that
  was admitted but never scheduled is re-woken instead of looking idle.
- **Generation-slot lease (`genlock`)** — cross-process file leases cap concurrent generations; a live
  holder is healthy-waiting, a dead holder is surfaced as stale (`src/genlock.mjs`).
- **Stalled-claim re-wake** — the broker/driver re-wakes a seat holding a `claimed` item whose run died,
  so an abandoned claim is re-driven; an operator-`stop`ped claim is never re-woken, and a live/in-flight
  run is never double-woken.

---

## 5. Teardown & durability

- **The transcript is durable.** A seat's conversation is a pi-durable document: it survives `reset`
  (which only writes a boundary) and `stop`; this is the source of truth for what the seat decided.
- **The worktree is not shared state.** It is a disposable checkout for one item, retired on `complete_work`
  and removed with `git worktree remove` on a *clean* tree.
- **Leaked worktrees.** A worktree whose queue item is terminal is an **orphan**; one holding uncommitted
  work is **dirty** and is refused on purpose (never force-destroyed). The broker sweeps **clean** orphans
  at start; dirty ones need their owner to commit or the operator to resolve. *Procedure and commands:
  `runbooks/leaked-worktrees.md`*.

---

## 6. Where things live — quick map

| Thing | Location |
|---|---|
| Seat roster + queue + all durable state | the store, `<db>.sqlite` (default `./rig.sqlite`) |
| Broker journal / liveness | `<db>.broker.log`; broker pid in `<db>.broker.json` (genlock pid convention) |
| Operator intent spool | `<db>.broker.inbox/` (dead-lettered to `<db>.broker.inbox.error/`) |
| Generation-slot leases | `<db>.genlock.*` (one per slot) |
| Per-item checkout a seat works in | `<root>/item-<id>` (git worktree; `git worktree list` shows them) |
| The shared tree | `<root>` — where the broker and CLI run; a seat never writes here directly |

---

## 7. Verify / Evidence

This document is a narrative; its claims are grounded in the following artifacts, all of which can be
run, not just read:

| Claim | Where (source / demo) | What proves it |
|---|---|---|
| cwd resolution order `cwd ?? DURIG_SEAT_ROOT ?? process.cwd()` | `src/seattools.mjs:187-204` | `makeSeatEnv` `root = target.cwd ?? process.env.DURIG_SEAT_ROOT ?? fallbackRoot` |
| `prepare_workspace` creates `item-<id>`, persists cwd, idempotent | `src/seattools.mjs` `prepareWorkspace`; `demo/prepare-workspace.test.mjs`, `demo/broker-dirty-fork.test.mjs` | demo exit 0; the tool returns `WORKSPACE READY (created|reused): <path>` |
| `complete_work` retires worktree `force:false`, resets cwd | `src/rig.mjs` (complete_work) | the `removeSeatWorkspace({worktreeRoot, itemId})` + `configure(cwd: process.cwd())` block after `ok` |
| removal uses `git worktree remove`, refuses dirty unless `force` (D60) | `src/worktree.mjs` `removeClaimedWorktree`/`removeSeatWorkspace` | the `if (!force)` dirty-refusal branch |
| F12 seat-root guard fails closed on mismatch | `cli.mjs:349-372` | the `enforceSeatRoot && CFG.DURIG_SEAT_ROOT` block fails naming both paths |
| SC1/SC3 confinement + env refusal | `src/confine.mjs`, `demo/confine.test.mjs`, `demo/seatguard.test.mjs` | env-absence and path-escape canaries exit 0 |
| scratch-path rule: `.durig/` (`.gitignore:9`) is outside every seat's root; notes/scratch live in the worktree | `.gitignore:9`; `src/confine.mjs` + `demo/confine.test.mjs` | the `.durig/` gitignore entry; SC1 path-escape refusals exit 0 |
| genlock lease / stalled-claim re-wake | `src/genlock.mjs`, `src/driver.mjs`; `demo/singleflight.test.mjs`, `demo/stalledclaim.test.mjs` | demo exit 0 |
| reset writes a `pi.reset` boundary, keeps transcript | `cli.mjs` `cmdReset`; `demo/reset.test.mjs` | demo exit 0 |
| leaked/dirty worktree handling | `docs/runbooks/leaked-worktrees.md` | its `Verify` step (`git worktree list`) |

**Verify yourself:** `node demo/prepare-workspace.test.mjs`, `node demo/confine.test.mjs`,
`node demo/seatguard.test.mjs`, `node demo/reset.test.mjs` — each exit 0 on success. Cross-read
`FEATURES.md` §4–5 for the feature inventory and `SEAT-TOOLS.md` for the security design.
