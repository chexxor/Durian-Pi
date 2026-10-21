# Per-seat capability profile

Who can actually do what — so an assignment names a **mechanism** the assignee has,
not an intention it cannot perform. Companion to the work-item schema
(`docs/WORK-ITEM-SCHEMA.md`): the schema says what an item IS; this says WHO can act
on it.

**The rule this profile enforces:** an instruction must be checkable against the
assignee's tool surface BEFORE it is issued. If you cannot NAME THE TOOL the
assignee will use to carry it out, you are guessing — and a guess costs a round
trip and makes the assignee invent a workaround. Write the mechanism into the
assignment, or route it to the seat that has the mechanism.

**Why it exists (the trigger):** four assignments in one session each named a
mechanism the assignee could not perform — (1) "mint the standing waiting marker
addressed to yourself" for `pm`, which `pm→pm` is forbidden by the org edge
(`src/rig.mjs:69` `assertSendAllowed`); (2) "sequence the #3222 verify ahead of the
others" for `pm`, with no priority lever (claim order is oldest-first; a new note
lands at the END); (3) "append the ledger rows yourself" for `pm` (#3404/#3426/#3497/
#3503), which is unexecutable for a queue-only seat (the deciding-seat-appends rule
is right in principle, unexecutable for a seat with no file tools); (4) "audit qa's
completion bodies" for `pm`, which cannot read a body it does not hold.

## The table (one row per seat)

| seat | tools (a) | org-edge send targets (b) | doc-edit in own worktree (e) |
|------|-----------|---------------------------|------------------------------|
| `pm` | queue tools + `seatRoot` only (coordinator — no read/write/edit/shell/prepare_workspace) | impl, qa, lead, scribe, devtools, auditor, advocate, designer, security, architect, qa2 | cannot (no file tools) |
| `lead` | queue tools + `seatRoot` only (coordinator) | pm, impl, qa, advocate, designer, devtools, scribe, auditor, security, architect, qa2 | cannot (no file tools) |
| `impl` | full: read, write, edit, shell, prepare_workspace, seatRoot | pm, qa, auditor, advocate, designer, scribe, devtools, security, architect, qa2 | can write/edit; project surfaces (FEATURES/STATUS/README/DISPOSITIONS/DECISIONS) route through `scribe` |
| `scribe` | full: read, write, edit, shell, prepare_workspace, seatRoot | pm, impl, advocate, security | can write/edit; OWNER of the project surfaces |
| `devtools` | full: read, write, edit, shell, prepare_workspace, seatRoot | pm, impl, lead, security | can write/edit; project surfaces route through `scribe` |
| `security` | full: read, write, edit, shell, prepare_workspace, seatRoot | pm, impl, lead, qa, auditor, designer, advocate, devtools, scribe, architect, qa2 | can write/edit; project surfaces route through `scribe` |
| `architect` | full: read, write, edit, shell, prepare_workspace, seatRoot | pm, lead, impl, qa, auditor, security, devtools, scribe, advocate, designer, qa2 | can write/edit; project surfaces route through `scribe` |
| `qa` | read + shell + prepare_workspace (verifier — **no write, no edit**) | pm, impl, lead, auditor, security, architect, qa2 | cannot write/edit (by tool scoping); routes doc changes through the author/`scribe` |
| `qa2` | read + shell + prepare_workspace (verifier — no write, no edit) | pm, impl, lead, auditor, security, qa | cannot write/edit |
| `auditor` | read + shell + prepare_workspace (verifier — no write, no edit) | pm, impl, lead, qa, security, architect, qa2 | cannot write/edit |
| `advocate` | read + shell + prepare_workspace (**treated as a verifier** — no write, no edit) | pm, lead, designer, security | cannot write/edit |
| `designer` | read + shell + prepare_workspace (**treated as a verifier** — no write, no edit) | pm, lead, advocate, impl, security | cannot write/edit |

## Uniform facts (no per-seat variance)

**(c) Reading an item body you do not hold — NO seat can.** `peek_queue` returns
subjects only; `claim_work` requires the item be addressed to you; there is no
read-an-arbitrary-body tool. A completed item's body cannot be claimed or read
through the queue tools either (the carrier leak, #3410). The `task` toolcall
(full item details, read-side, scoped read) is registered backlog item **#1582**,
not built. So "audit X's completion bodies" is only executable by the seat that
holds X (or that was sent X and still has it queued).

**(d) Reordering or promoting another seat's queue — NO seat can.** Claim order is
oldest-first by creation; a new note lands at the END of the recipient's queue. A
held item frees its claim slot, but only the recipient can hold its own item. So
"sequence the #N verify ahead of the others" has no mechanism today.

**(e) Doc-edit convention, in addition to the tool surface.** A seat that CAN
write/edit still routes a change to a project-level surface
(`docs/FEATURES.md`, `docs/STATUS.md`, the README, `docs/DISPOSITIONS.md`,
`docs/DECISIONS.md`) through `scribe` (the file owner), or lands DECISIONS entries
from the serialized pass branch (#3186). The tool surface is the *can*; the doc
owner is the *may*.

## How the tool surface is derived (checked against the rig, not from memory)

- **Base tool set:** `src/seattools.mjs` `seatTools` = { read, write, edit, shell
  (`powershell`), prepare_workspace }; `seatRoot` is always available.
- **Coordinator** (no capability in `implement/code/verify/review`): loses read,
  write, edit, shell, prepare_workspace (`COORDINATOR_REMOVALS`) — queue tools +
  seatRoot only. `pm` and `lead` are the coordinators in this rig.
- **Verifier** (name/role matches `verif|qa|review|editor`, `src/verifierrole.mjs`):
  loses write and edit (`VERIFIER_REMOVALS`) — reads and shells but cannot fix.
  `qa`, `qa2`, `auditor` and — by their role text — `advocate` and `designer`.
- **Working non-verifier:** keeps everything.
- Wired at `cli.mjs:711` (`scopeSeatTools` during `up`).

**How to re-verify this document** — the derivation command, run from the repo
root against the current `rig.selfdev.json`:

```bash
node --input-type=module -e "import('./src/seattools.mjs').then(async m=>{const{readFileSync}=await import('node:fs');const rig=JSON.parse(readFileSync('rig.selfdev.json','utf8'));const base=['read','write','edit','powershell','prepare_workspace','seatRoot'];for(const s of Object.values(rig.seats)){const r=m.toolRemovalsFor(s).map(t=>t.name);console.log(s.name+': removed='+(r.join(',')||'none')+' retained='+base.filter(t=>!r.includes(t)).join(','));}})"
```

The org-edge targets are the `edges` array in the current `rig.selfdev.json`,
enforced by `assertSendAllowed` (`src/rig.mjs:64`); "Absent/empty = open"
(`src/rig.mjs:28`).
