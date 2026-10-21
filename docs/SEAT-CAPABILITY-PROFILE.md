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
| `qa` | read + shell + prepare_workspace (verifier — write/edit TOOLS stripped; the retained shell can write, see the mechanism note) | pm, impl, lead, auditor, security, architect, qa2 | write/edit tools stripped; retained shell can write/commit (mechanism note); project surfaces route through author/`scribe` |
| `qa2` | read + shell + prepare_workspace (verifier — write/edit TOOLS stripped; shell can write) | pm, impl, lead, auditor, security, qa | write/edit tools stripped; retained shell can write/commit |
| `auditor` | read + shell + prepare_workspace (verifier — write/edit TOOLS stripped; shell can write) | pm, impl, lead, qa, security, architect, qa2 | write/edit tools stripped; retained shell can write/commit |
| `advocate` | read + shell + prepare_workspace (**treated as a verifier by role text** — write/edit TOOLS stripped; shell can write) | pm, lead, designer, security | write/edit tools stripped; retained shell can write/commit |
| `designer` | read + shell + prepare_workspace (**treated as a verifier by role text** — write/edit TOOLS stripped; shell can write) | pm, lead, advocate, impl, security | write/edit tools stripped; retained shell can write/commit |

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
  loses write and edit TOOLS (`VERIFIER_REMOVALS`). `qa`, `qa2`, `auditor` and — by
  their role text — `advocate` and `designer`.
- **Working non-verifier:** keeps everything.
- Wired at `cli.mjs:711` (`scopeSeatTools` during `up`).

**Caveat — the write/edit TOOL strip is advisory, not a hard capability limit.**
A verifier keeps the `shell` tool (only write/edit are removed), and the read-only
environment refuses the FILE-API (`write`/`edit` tool calls via `readOnlyGuard`,
`confine.mjs`) but does NOT block shell writes: `confine.mjs`'s `exec` wrapper
pins cwd and strips env (SC3) and allows the command to run. So a
verifier-classified seat can write files and `git commit` through its retained
shell. The SC2 "disposable copy" guarantee holds only where the verifier's
worktree IS a throwaway verify tree (the qa/auditor verify-scratch case) — it is
not enforced at the confinement layer (`makeSeatEnv` passes the seat's real root,
`seattools.mjs`). Measured against observed behaviour: `designer` delivered
`24b7fc9` and `advocate` delivered its review (`7387716`), both real commits on
main, which a write/edit-stripped-but-shell-armed seat can produce. The taxonomy
question — `role text contains "review"` being a PROXY for "verifier" that
mis-classifies seats whose job is to PRODUCE reviews — is a lead ruling, recorded
in #3588, NOT asserted here as current behaviour.

**Verifier read-only, stated as the three facts (SC2's row, matching
`docs/SEAT-TOOLS.md` and the security position — never "read-only" unqualified):**

| fact | status | mechanism |
|---|---|---|
| **(1) FILE-API REFUSAL** | **ENFORCED** | `readOnlyGuard` refuses `write`/`edit` tool calls (demo half 1 proves it) |
| **(2) ENV DISCIPLINE** | **ENFORCED** | cwd pinned + `inheritEnv:false` (SC3) |
| **(3) SHELL-WRITE ISOLATION** | **CONVENTION** | a verifier's shell can still write; its writes are isolated only by disposable-scratch policy (reaped, audited), NOT a confinement guarantee, because `makeSeatEnv` passes the seat's real root |

**Interim form, verbatim, for any doc that describes verifier capability:**

> Verifier read-only is enforced at the file API and env layers. Shell-write
> isolation rests on disposable-scratch policy (reaped, audited), NOT a confinement
> guarantee. NO VERIFICATION ARGUMENT MAY CITE THE CURRENT STATE AS A GUARANTEE.

**How to re-verify this document** — the derivation command, run from the repo
root against the current `rig.selfdev.json`:

```bash
node --input-type=module -e "import('./src/seattools.mjs').then(async m=>{const{readFileSync}=await import('node:fs');const rig=JSON.parse(readFileSync('rig.selfdev.json','utf8'));const base=['read','write','edit','powershell','prepare_workspace','seatRoot'];for(const s of Object.values(rig.seats)){const r=m.toolRemovalsFor(s).map(t=>t.name);console.log(s.name+': removed='+(r.join(',')||'none')+' retained='+base.filter(t=>!r.includes(t)).join(','));}})"
```

The org-edge targets are the `edges` array in the current `rig.selfdev.json`,
enforced by `assertSendAllowed` (`src/rig.mjs:64`); "Absent/empty = open"
(`src/rig.mjs:28`).
