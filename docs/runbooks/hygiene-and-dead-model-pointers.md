---
runbook: hygiene-and-dead-model-pointers
symptom: "a seat's shell call dies as `spawn powershell ENOENT` / `spawn pwsh ENOENT` (the Windows shape is `spawn powershell.exe ENOENT`); a seat reports a test it never ran, or its tool output comes back empty; or a model swap left every seat aiming at a model no loaded instance serves while `single-model-rig` still passes"
writes: false
precondition: "read-only — every Diagnose step is safe with the broker down; nothing here edits the rig file or a model server"
last_verified: 2026-10-29
verified_by: delegate
evidence: "every command under Diagnose was run 2026-10-29 on Linux (Fedora 7.2.11-200.fc42.x86_64, box Alex-Desktop-Win10, node v24.22.1) against ./selfdev.sqlite (137,427 entries) and the live servers at :47831 / :1234; the dead-pointer half is the 2026-10-29 incident recorded in docs/DECISIONS.md as D163/D166 and in `git log --oneline` at the commit whose subject begins 'rig+NEXT+runbook(verifier seat strings)' (reachable from main)"
check_rule: "demo/local-model-pointer.test.mjs is the offline half that fails when rig.selfdev.json and durig.config.json disagree; the LIVE installed-vs-loaded half is unimplemented — docs/ROADMAP.md 261"
---

# A seat has no shell on this host, and a model pointer can be dead while every check passes

**Audience:** the delegate, and any seat woken into a rig whose tool surface does not match the host it is
running on. Two failure classes share one root — *the rig's declared surface and the host's actual surface are
never compared* — and both produce a confident, wrong green.

## When to use

- A seat's shell call errors instead of running: `spawn powershell ENOENT`, `spawn pwsh ENOENT`.
- A seat **reports** that it ran the demo suite, a `git` command, or a verifier check, and you cannot find the
  command's output.
- `tools/channel-preflight.mjs` §7 or `tools/broker-serve.mjs` raises **`seat-shell-availability`**.
- You swapped a model (or someone did) and now a seat's `provider/model` names something the server does not
  have loaded, while `cli.mjs check` reports nothing.
- You are asked whether seat **hygiene** (worktrees, branches, merges to `main`) is acceptable, and the only
  evidence anyone has is prose.

## Impact

**No spawnable shell is not a cosmetic gap.** `src/seattools.mjs:214-221` registers exactly one shell,
`shell: createPowerShellTool()`, whose comment says *"`bash` is deliberately absent"*. The pinned build's default
program list is `["pwsh", "powershell"]` (`vendor/pi-main/packages/durable/src/tools/bash.ts:169`, and the same
line numbers in the recovered TypeScript of the installed `@earendil-works/pi-durable` 1.3.0). On this Linux box
neither exists (`command -v pwsh` → absent, `command -v powershell` → absent) while `/usr/bin/bash` is present and
unregistered. So every seat shell call is a guaranteed spawn error: a seat **can edit files and cannot run
`node demo/<name>.test.mjs` or `git`**. That voids the constitution's oracle ("the demo suite … exit 0 is a
pass"), the completion rule ("RUN the checks that exercise it and name them"), and — for ROADMAP **256** — the
seat-hygiene rehearsal, whose instrument is git. It also means the honest answer to "are the seats hygienic?"
is **unmeasured**, not "yes".

**A dead model pointer is invisible to `check`.** `single-model-rig` is a string comparison over *resolved* model
strings (`src/checkup.mjs:591-598`) — not a certification that anything is served, and "different family" appears
only in its remedy text (**D137**). On 2026-10-29 `rig.selfdev.json` pointed all five second-provider seats at
`verifier/recursivesi/flint` while the only loaded instance was Ministral Q6_K: `check` said nothing, and
`demo/local-model-pointer.test.mjs` was **RED** until both surfaces agreed.

## Preconditions

- Read-only: no broker stop is required, and none of this wakes a seat.
- **Never load or unload a model while a run is live** — `docs/runbooks/model-server-broker-race.md`.
- **Seat instruction text is operator-owned** (`rig.selfdev.json`). `spawn powershell ENOENT` tempts you to
  re-word it; propose, do not hand-edit.

## Diagnose (read-only)

```bash
# 1. Is the failure the HOST, the registration, or the guard? All three are different files.
sh -c 'for c in bash pwsh powershell; do printf "%s=%s\n" "$c" "$(command -v $c || echo ABSENT)"; done'
grep -n "shell: create" src/seattools.mjs          # which tool is REGISTERED (measured: only powershell)
grep -n "SHELL_TOOLS"  src/seatguard.mjs           # measured: :122 = new Set(["bash","powershell"])
grep -n "programs = options" vendor/pi-main/packages/durable/src/tools/bash.ts   # :169 ["pwsh","powershell"]
node tools/broker-serve.mjs --dry-run              # read-only; BLOCK seat-shell-availability when none spawn
```

`seatguard`'s `SHELL_TOOLS` naming `bash` is **not** evidence a bash tool exists — it is the set of command
strings the guard inspects *if* such a tool is ever registered. Reading only that line has already produced a
false "217 is half-landed".

```bash
# 2. What has a seat ACTUALLY run? (one scan; LIKE patterns printed so the count is checkable)
node -e 'import("node:sqlite").then(({DatabaseSync})=>{const db=new DatabaseSync("./selfdev.sqlite",{readOnly:true});
for(const p of ["\"toolName\":\"bash\"","\"toolName\":\"powershell\"","\"toolName\":\"pwsh\"",
 "spawn bash ENOENT","spawn powershell ENOENT","spawn pwsh ENOENT","spawn powershell.exe ENOENT",
 "spawn /usr/bin/bash EACCES","The powershell tool is only available on Windows","\"result\":null"])
 console.log(String(db.prepare("SELECT COUNT(*) n FROM entries WHERE record LIKE ?").get("%"+p+"%").n).padStart(7),p);})'
```

Measured 2026-10-29 over **137,427** entries: `powershell` **20,340**, `bash` **0**, `pwsh` **0**; spawn errors
`powershell ENOENT` **3**, `pwsh ENOENT` **1**, and **0** for `spawn bash ENOENT`,
`spawn powershell.exe ENOENT`, `spawn /usr/bin/bash EACCES`, `The powershell tool is only available on Windows`,
and `"result":null`. Read those numbers as three facts, not one:

1. **No seat has ever run a shell successfully on this host** (`bash` 0; the 20,340 are the Windows era).
2. **The Linux failure is rare and recent** — 4 ENOENT rows, newest entry **#274090** (conv 4930 = `devtools`,
   2026-10-28T17:09Z), inside the last broker pass. That entry's own reasoning is the symptom in one line:
   *"PowerShell is not available? … Maybe the shell is pwsh on Linux?"* — the seat burns turns on the substrate.
3. **`"result":null` = 0 rows.** The empty-tool-output shape that an earlier index row promised for this runbook
   was **not observed in this store**; do not treat its absence as "fixed", and if you meet it, say which entry.

```bash
# 3. Model pointer: name the two surfaces and compare them, then prove which .gguf answers.
node -e 'const r=require("./rig.selfdev.json");console.log(r.seats.map(s=>s.name+" "+(s.model||"-")).join("\n"))'
curl -s --max-time 15 http://127.0.0.1:1234/api/v1/models | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const m of JSON.parse(s).models)console.log(m.key,m.variants.join(" "),(m.loaded_instances||[]).map(i=>i.id+"@"+i.config.context_length).join(",")||"NOT LOADED")})'
ps -eo args | grep '[l]lama-server' | tr ' ' '\n' | grep -E '^--(model|ctx-size|parallel|n-gpu-layers)' -A1 | tr '\n' ' '
node demo/local-model-pointer.test.mjs     # the offline half: fails when the two config surfaces disagree
```

Measured 2026-10-29: rig says `local/iq3_s` (7 seats) and
`verifier/mistralai/ministral-3-14b-reasoning` (5 seats); the server has Ministral **@8192** loaded and
`recursivesi/flint` **NOT LOADED** (catalog variant `@q4_k_m` only, because Q6/Q8 are set aside); the process
line names `…-Q6_K.gguf --ctx-size 8192 --parallel 4`; the demo prints
`LOCAL MODEL POINTER PASS (providers=local=iq3_s, verifier=mistralai/ministral-3-14b-reasoning, pinned seats=12)`.
**A model key never identifies the bytes** — the `ps` line is the only surface naming variant + ctx + parallel.

## Do

1. **Missing shell (ROADMAP 217, owner `devtools`).** Do not hand-patch `src/seattools.mjs`: the current choice
   is *asserted* by `demo/seattools.test.mjs:27-30` ("no bash tool — native-Windows bash is an undeclared Git
   Bash dependency"), so the fix is a failing-first rewrite of that demo plus a host-conditional registration —
   and pi already ships `createBashTool` (`durable/src/tools/bash.ts:145`), which `src/tui/durable/adapter.mjs:612`
   already installs for the TUI. The guard needs no change: `SHELL_TOOLS` already covers both names, and 217's
   acceptance criterion deliberately names **the guard**, not the tool, because a seat holding both tools can pick
   the one policed less closely.
2. **Dead pointer.** Correct **both** surfaces in the same change — the seat `model` strings in
   `rig.selfdev.json` and the provider `ctx`/`max_tokens` in `durig.config.json` (a declared `_CONTEXT` above the
   served window makes the request unsatisfiable, **259**) — then re-run `demo/local-model-pointer.test.mjs` and
   the `ps` check. Loading/unloading or re-windowing a model is the operator's grant and is procedure:
   `docs/runbooks/verifier-model-server.md`.
3. **A "hygiene" claim.** Refuse it unless it names a command. `cli.mjs worktree audit` is a seed, not a verdict
   (`reapable: 0` is not a verdict — `docs/BRANCH-AND-WORKTREE-LIFECYCLE.md:244`), and the rehearsal instrument
   256 asks for (`tools/seat-hygiene-audit.mjs`) **does not exist**. Before any `up`/`worktree`/`run`, run
   `docs/runbooks/workspace-move.md` and diff the inventory.
4. **A lost delegate instrument.** Recover it from the harness transcripts with the tracked
   `tools/transcript-recovery.mjs <session-dir> <basename>... [--out <dir>]` (it writes only with `--out`), and
   label anything you recover **re-created**, never "landed" (233/D156).

## Verify

| Claim | Command | Measured 2026-10-29 |
|---|---|---|
| seats have no spawnable shell here | `node tools/broker-serve.mjs --dry-run` | `BLOCK seat-shell-availability` — "spawns [pwsh, powershell], NONE of which exists on linux"; 1 blocking finding |
| no seat ever ran `bash` | the `entries` scan above | `"toolName":"bash"` → **0**; `"toolName":"powershell"` → **20,340** |
| the pointer is currently consistent | `node demo/local-model-pointer.test.mjs` | `LOCAL MODEL POINTER PASS … pinned seats=12` |
| the pointer CAN fail (the check is not vacuous) | the 2026-10-29 incident | it was RED while five seats named `verifier/recursivesi/flint` against a Ministral-only server (commit `93a14298`) |
| nothing compares the rig to the loaded instance | `DURIG_DB=./selfdev.sqlite node cli.mjs check rig.selfdev.json` | 61 findings; `single-model-rig` **passes** — it is a string comparison |

## If it fails

- A preflight `BLOCK` that you disagree with is **not** permission to bypass it: `--allow-dirty` /
  `--yes-pm-wakes` are acknowledgements of a hazard, and the channel start is the operator's grant.
- If `--dry-run` gives two different blocking sets minutes apart (it did today: `provider-local-completion-failed`
  appeared once and not on the next run against the same servers), re-run it before reporting — a single failed
  provider probe is not proof the provider is dead.
- If the store scan disagrees with a doc's number, the store wins; fix the doc and say which entry you read.

## Escalate to

- **217** → `devtools` (owner) via `pm`. Note the blocker is real: **0 of 4,821 queue rows cite 217** (or 232, 233,
  256, 262), so nobody is working it.
- **Model loads, variants, context windows** → the operator (grant), procedure in `verifier-model-server.md`.
- **A live installed-vs-loaded check that does not exist** → ROADMAP **261**.
- **Channel start, seat roots, instruction text** → the operator.

## Evidence

`tools/channel-preflight.mjs` §5–§7 (217's store evidence, era-attributed), `tools/broker-serve.mjs`
(`seat-shell-availability`), entries **#274074** (`spawn powershell ENOENT`, isError=true, `devtools`) and
**#274090** (the seat reasoning about it), `docs/DECISIONS.md` **D166** (dead pointer, both config surfaces
mis-set) and **D137** (a `single-model-rig` PASS is not certification), commits `93a14298` and `c34bb232`
(both reachable from `main`), and this runbook's own promotion work: `tools/transcript-recovery.mjs`,
`tools/extract-pi-src.mjs`.

**Do not:** read `SHELL_TOOLS` as proof a shell is registered; call a seat hygienic because it *says* it ran the
suite; treat a `20,340` count as success (it is the Windows era); trust an API model key to identify a model;
expect `"result":null` rows here (there are none); or infer that a `check` with 61 findings has looked at the
model at all.
