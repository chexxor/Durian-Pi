# `docs/reviews/zero-trust-zero-agent.md`

**Status:** research report, landed for item 60. **Written report only** — no code or house-doc edits accompany it. Anything herethat opens a trust boundary is framed as needing a `security.sec` position before code (item 55).

**Reading note on evidence classes.** The commission supplies the baseline with file:line citations. I could not open that tree (see §8), so every baseline row below is class `briefed`, not `observed` by me. External claims carry `direct` / `advertised-elsewhere` / `community` / `observed` / `unverified` and a URL in the source table.

---

## 0. Verdict

**Adopt the kernel/Android *shape*, not the kernel/Android *machinery*.** What is load-bearing in Linux is not SELinux's policy language; it is (a) one mediation point every effect must pass, (b) decisions computed from *labels* rather than from the caller's identity or good intentions, (c) an `allow` relation that is default-deny and lives outside the subject, and (d) a durable record binding subject, object, class, permission and result to each decision [^1][^2]. durian-pi already has (a) at `ToolHooks.beforeTool` and has none of (b)–(d). So the first three backlog items are cheap, high-value, and do not touch a trust boundary: **label the objects, make the reach relation data, and write the decision down.** Android contributes the second half — a *declared* capability manifest plus *runtime grants with expiry and revocation* — and that is exactly the missing per-item grant. But the load-bearing caveat is the one the commission already guessed: while the policy engine is the same process, with the same OS permissions, as the subject it polices, the hook is an **integrity and mistake-containment control, not a security boundary** against a determined escape. The smallest real boundary is not a daemon — it is a **spawn-time wrapper** around every `bash`/`git`/`npm` child (restricted token + restricted SID on Windows, Landlock/seccomp or `bwrap` on Linux), applied at the existing Job Object spawn point, with a monotonic (unwidenable) ruleset. Egress is the exception where the honest answer differs by platform: on Linux a network namespace makes "exactly one destination" real; on native Windows without an elevated setup step, network denial is advisory at best — OpenAI reached exactly that conclusion after building both variants [^3].

**Reject** SELinux's policy language, type-enforcement compiler, roles/MLS, and `audit2allow`-style synthesis. Not because the ideas are wrong, but because the operational failure mode is documented and severe: `audit2allow` is described in LWN as "unfortunately, the way that most SELinux policy is developed" because there are not enough experts [^4], and the pre-permissive-domain workaround was to put the *whole system* in permissive mode to shake out a policy for *one* application [^5].

---

## 1. Gap table

| # | Mechanism | durian-pi today | Missing | Ruling |
|---|---|---|---|---|
| 1 | Single mediation point (VFS analogue) | `ToolHooks.beforeTool` → `SeatGuard` (`src/seatguard.mjs:464-467`) | Covers *tool calls* only. No coverage of the effect after the call (child process syscalls, network, store writes by other paths) | **keep**, extend coverage at spawn (§5) |
| 2 | Subject label | seat id in the rig file | No per-run / per-claim identity; the seat id appears in no durable record | **adopt** |
| 3 | Object label | ad-hoc path strings (`src/writetargets.mjs`, `src/confine.mjs`) | No canonical label for artifact / tool / egress host / store row; path comparison is string-level, not resolve-then-label | **adopt** |
| 4 | `allow` relation, policy as data | capability set → tool *removals* (`src/seattools.mjs:255-264`) | No per-effect relation consulted; capabilities are per-seat and coarse; policy is not data with a revision | **adopt** (narrow) |
| 5 | Default deny | "a seat declaring no capability loses everything" | Default-deny exists at tool-surface level only, not at path/egress/class level | **keep**, extend |
| 6 | Audit of enforcement decisions | `{block: reason}` returned to the caller; no row written | Nothing queryable: "which seat was refused, under what rule, when" | **adopt** (item 170) |
| 7 | Redaction on the way back | `afterTool` + `src/secretredact.mjs`, `src/secretdetect.mjs` | — | **keep** |
| 8 | Per-item (claim-scoped) grant | per-item worktree only (D49) | No claim-scoped, expiring, revocable grant | **adopt** (item 172) |
| 9 | Egress policy | none; provider key in the parent environment | No allowlist, no proxy, key reachable by every child | **adopt** (item 174) |
| 10 | OS-level containment of children | Job Object / process groups (`src/job-object.mjs`) | Reaping and lifetime only — no *rights* restriction on the child | **adopt**, extend |
| 11 | SELinux TE policy language (types, roles, MLS, compiler) | none | — | **reject** |
| 12 | Android runtime grants (ask / revoke / one-time / auto-reset) | none | Grantor undefined; no grant record; no expiry | **adopt** model, **reject** per-call human prompt (§3, Q3) |
| 13 | Identity across wake / `reset` / fork / compaction | conversation-scoped, reset-able | No durable run identity; attribution across runs impossible | **adopt** (items 170–171) |
| 14 | Multi-project isolation | one store, one rig file, one provider key, one machine | No per-project partition or per-project key | **adopt** (label partition, §2) |
| 15 | Complain-before-enforce rollout | none | No audit-only mode; no signed promotion path | **adopt** (item 171) |

---

## 2. Substrate vs policy split

House rule: **policy is data, not code, and it must fail closed.**

**Belongs in harness code (the substrate).** These are the primitives that must be identical in every deployment and must not be editable by a seat:

1. **Canonicalisation and labelling** — resolve a path (symlinks, junctions, 8.3 names, case, UNC/device prefixes, drive-relative quirks), then map to a label. Resolution *before* matching, never string-prefix matching on the caller's text.
2. **The decision function** — `decide(subject, object, class, perms) → allow | deny(rule_id)`, total, no exceptions path, no "unknown → allow".
3. **The spawn wrapper** — the single place a child process is created (`src/job-object.mjs` already owns creation), which applies the platform ruleset.
4. **The egress proxy** — one listener in the broker, one allowlist.
5. **The audit writer**, with the rule that a decision that cannot be recorded is not granted.
6. **The policy loader**, which refuses to start the broker on an unparsable/absent policy rather than degrading. This mirrors `failIfUnavailable` in Claude Code's sandbox, which turns "sandbox could not start" from a silent fallback into a startup failure [^6].

**Belongs in declarative config (the policy).**

| Data | Shape | Fail-closed rule |
|---|---|---|
| Seat types | `seat_type → domain` (analogue of `untrusted_app`) | unknown seat type → deny all |
| Object labels | ordered globs → label, most-specific wins, deny beats allow inside a broader allow | unmatched path → `unlabelled` → deny |
| Classes | `file, dir, tool, egress, store, process` | unknown class → deny |
| Permissions | `read, write, create, delete, exec, connect, invoke, commit` | unknown permission → deny |
| Allow rules | `allow <seat_type> <object_label>:<class> {perms}` | no matching rule → deny |
| Grants | `grant(claim_id, object_label, perms, issued_by, expires_at)` | expired/missing grant → deny |
| Egress | `allow egress <host:port>` — one entry in normal operation | absent → deny |
| Rollout | `mode: enforce | permissive` per domain | `permissive` still writes the deny row |
| Revision | monotonic `policy_rev` | any decision row with an unknown rev → treated as unenforced |

Two subtleties worth writing into the ADR. First, **`permissive` is not "off"**: SELinux per-domain permissive still performs the checks and still emits the AVC denial while allowing the access [^5], and Android documents permissive as "policy isn't enforced, only logged" precisely as an implementation aid [^1]. Our equivalent must write the same row it would write in enforce, differing only in the `result` field — otherwise the rollout data is useless. Second, **labels are not a security control in a dynamic tree.** A per-item worktree is created and destroyed constantly; anything that labels by path must be recomputed at spawn, not cached at session start. Landlock's own documentation notes that files opened *before* the ruleset is applied are not subject to it [^7] — the same staleness class applies to a cached label map.

---

## 3. Decision table

| Q | Decision | Ruling | Why (liftable into `docs/DECISIONS.md`) |
|---|---|---|---|
| 1 | Labels + `allow` relation at `beforeTool` | **adopt** | One chokepoint plus decision-from-labels is the part of the LSM design that transfers; it converts scattered path checks into a reviewable table and makes every refusal explainable by a rule id. |
| 1 | Claim that in-process mediation is a security boundary | **reject** | The policy engine shares the subject's OS identity. Linux policy sits in kernel memory the subject cannot write; ours sits in the same heap. Hooks buy integrity and accident prevention, not containment. |
| 1 | Smallest real boundary = spawn wrapper, not a daemon | **adopt** | The child is a different security context if the token/Landlock domain is applied at creation and cannot be widened afterwards (Landlock is monotonic: "no way to remove its security policy") [^7]. No always-on process, so no runbook invalidated. |
| 2 | Type enforcement, default-deny, labelled objects, `permissive` domains | **adopt** (concepts) | These are the load-bearing parts: every subject and object carries a type, and access exists only if a rule allows it [^8][^1]. |
| 2 | Type transitions on `execve` | **adopt** (narrowly) | The analogue is: a child that runs a different program gets a fresh decision context rather than inheriting the parent's reach — this is the `npm prepare` / git-hook hole. |
| 2 | TE policy language, roles, MLS, `audit2allow` synthesis | **reject** | The synthesis tool is the documented failure: allow rules generated from denials, with a culture of doing so because expertise is scarce [^4][^9]. Copying it copies the sprawl. |
| 3 | Per-app UID analogue: unique identity per seat-run | **adopt** | Android's isolation starts from a distinct UID per app plus a domain label; the transferable half is "distinct principal, stable for the life of the run". |
| 3 | Runtime grants **with a human in the loop per call** | **reject** | Android itself moved *away* from repeated asks: deny twice and the dialog never appears again; unused-app permissions auto-reset [^10]. Per-call prompting is the fatigue machine we would be importing. |
| 3 | Grantor = the `pm` authority acting on the *claim*, countersigned by policy | **adopt** | Seats assign work to seats, so the grantor cannot be a human presence. Make the grant a *derived, auditable* object (claim id + issuer + policy revision + expiry) rather than a conversational assertion by `pm`. |
| 4 | Durable run identity + audit record shape modelled on AVC | **adopt** | AVC gives the exact fields: subject context, target context, class, permission set, result, and a `permissive` flag distinguishing "would have denied" from "denied" [^2][^2]. Map one-to-one. |
| 5 | Treat tool-level gate as sufficient | **reject** | Documented escape classes (interpreters, lifecycle scripts, symlink/junction confusion, case/8.3, UNC, env inheritance, cwd TOCTOU) are all *post-decision* effects. Defence in depth requires the spawn boundary plus canonicalisation. |
| 6 | AppContainer as the Windows answer | **reject** | OpenAI evaluated it and rejected it: it is built for apps that know their needs up front, not for "shells, Git, Python, package managers, and whatever other binaries the agent decides it needs" [^3]. |
| 6 | Mandatory Integrity Control relabelling the workspace | **reject** | Relabelling a checkout low-integrity makes it writable by *all* low-integrity processes — the trust model of the workspace changes, not just the agent's access [^3]. |
| 6 | Restricted token + restricted SID list, unelevated | **adopt** | Two checks must pass for a write: the token owner and at least one restricted SID [^3]. Cheap, non-invasive, denies writes outside declared roots including `.git`. |
| 6 | Firewall-scoped network denial on Windows without elevation | **reject** | Windows cannot match a firewall rule to a restricted token's synthetic SID, and program-path rules cannot isolate one invocation of `python.exe` from another [^3]. Requires a separate local principal → elevation at setup. |
| 6 | Linux parity via Landlock + seccomp (or `bwrap`) | **adopt** | Unprivileged, self-imposed, deny-by-default over explicitly handled rights, inherited by children, with TCP port rules since ABI 4 [^7][^7]. |
| 6 | Containers/WSL as the answer | **reject** | Explicit constraint; and Claude Code's own sandbox is unavailable on native Windows, which is why its managed-setting guidance tells Windows fleets to move to WSL2 [^6]. |
| 7 | Per-item, expiring grants | **adopt** | Narrowest model that matches the existing per-item worktree (D49) and closes the "reach is per seat, not per claim" gap. Expiry at claim close, not wall-clock only. |
| 7 | Config sprawl as a reason to stay per-seat | **reject** | Sprawl is a real cost, but it is bounded if grants are *derived* from claim metadata rather than hand-written. Hand-written per-item policy would sprawl; generated grants do not. |
| 8 | Provider key never in the child | **adopt** | A seat's shell currently inherits the parent environment; Claude Code documents exactly this default and its consequence (credential files and secrets in env inherited unless explicitly denied) [^6]. |
| 8 | Broker-side proxy with a one-host allowlist + sentinel tokens | **adopt** | The mask/sentinel pattern is implemented and documented: the command sees a placeholder, the proxy substitutes on outbound requests to allowed hosts, requiring TLS termination [^6]. |
| 8 | Treat proxy env vars as network control | **reject** | OpenAI's first Windows prototype did this and called it what it is: "advisory", circumventable by anything with its own socket stack [^3]. |
| 9 | Audit-only mode then promote | **adopt** | Both SELinux and Android use permissive specifically to gather denials before enforcing [^1][^5]. |
| 9 | Automated synthesis of allow rules from the deny log | **reject** as default | Accept only as a *proposal* step whose output is diffed, narrowed, and signed; never auto-loaded. |
| 10 | Per-project isolation by label partition in one store | **adopt** | Keeps the single-writer rule; Android's own multi-user model is categories on one policy rather than separate policies [^1]. |
| 10 | Second store/daemon per project | **reject** | Would invalidate the single-writer rule (F24, D42/D45) and add an always-on process to the failure surface the runbooks already cover. |
| 11 | "It's sandboxed, therefore safe" | **reject** | Claude Code's own limitations page: default read access is most of the machine including `~/.ssh` and `~/.aws/credentials`; the proxy allows by client-supplied hostname without inspecting TLS, so domain fronting is possible [^5f97cd#24][^6]. |

---

## 4. Failure catalogue

Each row is a control, the documented or structural way it is defeated, and the failing-first test that should exist before the control is trusted.

| Control | How it is defeated | Failing-first test |
|---|---|---|
| Path confinement by string prefix (`src/confine.mjs`, `src/writetargets.mjs`) | Symlink/junction whose target is outside the root; junction created on Linux behaving as a file symlink defeating a directory-only ignore rule; case-insensitive and 8.3 aliases (`PROGRA~1`); `\\?\C:\…`, `\\.\pipe\…`, UNC; literal `C:/…` resolving relative on POSIX | Build a fixture worktree containing: a junction → store dir; a symlink → `.git/hooks`; `C:/…` literal; `PROGRA~1`; a UNC path. Assert every one is `deny` with a rule id, before any resolution-dependent code runs |
| `beforeTool` decision | TOCTOU: decision taken on a path string, effect happens later in a child that re-resolves the path (swap the symlink target between decision and `exec`) | Test that swaps a symlink between `beforeTool` and spawn; the spawn-time wrapper must still deny. If only the hook denies, the control is not real |
| Shell allow/deny by command text | Interpreters, one-liners, `eval`, `make CC=…`, `FOO=bar npm test` — Claude Code documents that these forms require separate handling and that a wildcard rule does not stop the prompt for `eval` [^6] | Run `sh -c '…'`, `node -e`, `make` with an overridden variable, and a `prepare` script that writes outside the worktree |
| Lifecycle scripts (npm `prepare`, git hooks) | They execute inside the allowed `cwd` but with the child's full ambient rights | Fixture package whose `prepare` writes to the store path and posts to a non-allowlisted host; expect two denials, two audit rows |
| Environment inheritance | Child inherits `PROVIDER_KEY`; `env` or a crash dump leaks it | Spawn `bash` and assert the key is absent; assert any sentinel value is substituted only on the allowed host |
| Egress allowlist (proxy) | Domain fronting / client-supplied hostname without TLS inspection [^6]; tools that ignore proxy vars (plain `ssh`, most DB drivers, UDP/QUIC) simply fail closed, which is correct but breaks workflows [^6] | `curl --noproxy '*'` must fail resolution inside the sandbox; a raw socket to the allowed IP on a non-allowed port must fail; a TLS-fronted request to an allowed host must be recorded with its true SNI |
| Spawn wrapper (Landlock) | Not "bypass" but *scope*: `chdir`, `stat`, `chmod`, `chown`, `access` cannot be restricted today; `/proc/<pid>/fd/*` and nsfs are not explicitly restrictable; 16-layer stack limit [^7][^7] | Assert the wrapper's claim set is limited to what it actually enforces — do not claim metadata confidentiality from Landlock alone |
| Restricted-token write denial (Windows) | A writable path that is on `PATH`, or a shell startup file, lets the child widen its own next run; Claude Code documents this exact escalation for a filesystem-isolation-off mode [^5f97cd#300] | Write a `.bashrc`/`$PATH` shim into the worktree; assert the next spawn does not execute it |
| Per-item grant | Grant is minted but not checked (advisory), or never expires on `reset`/fork | Unit test: expired grant, grant for a different claim, grant issued by a seat without grant authority — all `deny` with distinct rule ids |
| Audit row ("no row, no effect") | Writer failure silently degrades to "allow" | Inject a store write failure; assert the effect is refused, not permitted |
| Permissive mode | Never promoted because the diff is unreadable; or promoted wholesale | Assert that `permissive → enforce` requires a signed policy revision, and that the promote diff is bounded (see §7, item 171) |
| Prompt-level instruction | Everything above | Explicitly out of scope: no control in this report may exist only in the system prompt |

---

## 5. Enforcement-point inventory

Every place a seat can produce an effect, and whether a control exists today.

| Effect surface | Path today | Control now | Proposed |
|---|---|---|---|
| Model-issued tool call (`read`/`write`/`edit`/`bash`/`powershell`/queue) | `ToolHooks.beforeTool` → `SeatGuard` | yes, coarse | label-based `allow` + audit row |
| File write via `write`/`edit` | `src/writetargets.mjs` | yes, string-path | canonicalise → label → `allow` |
| Shell write / spawn | `bash` tool → the same process; children via `src/job-object.mjs` | **none** (reaping only) | spawn wrapper (token / Landlock) |
| Build & lifecycle scripts (`prepare`, git hooks) | inside a child | **none** | spawn wrapper + protected-path deny (`.git/hooks`, `.git/config`) |
| Network egress | inherits host reach; provider key in parent env | **none** | broker proxy, one-host allowlist, sentinel credentials |
| Store commit / row write | broker, single-writer | yes (single writer) | per-project label on rows; audit row is itself a store write |
| Secret in staged commit | `SeatGuard` | yes | keep |
| Tool result return | `afterTool` + `secretredact`/`secretdetect` | yes | keep |
| Grant issuance (new surface) | — | — | `pm`-authority grant, countersigned, expiring |
| Policy load (new surface) | — | — | fail-closed loader, `policy_rev` pinned |
| Audit write (new surface) | — | — | precondition for allow |

The two new surfaces — grant issuance and policy load — are the ones that need the `security.sec` position before code.

---

## 6. Platform matrix

| Control | Windows (native) | Linux (parity) |
|---|---|---|
| Tool-level mediation | **available** — same JS code path | **available** |
| Canonicalisation / labels | **available** (must handle case-insensitivity, 8.3, drive-relative, UNC, junctions) | **available** (must handle symlinks, and junctions that present as file symlinks) |
| Spawn-level FS restriction | **partial** — write-restricted token with a synthetic SID gives real, unelevated write denial at ACL granularity; ACL application cost scales with workspace topology [^3] | **available** — Landlock deny-by-default over handled rights; `EXECUTE`, `WRITE_FILE`, `REFER` etc.; inherited by children [^7] |
| Per-child network denial | **absent without elevation** — firewall cannot match a restricted token's synthetic SID; requires a dedicated local user created at elevated setup time [^3] | **available** — network namespace (Claude Code uses one) or Landlock TCP/UDP port rules [^6][^7] |
| Unique per-run identity | **partial** — synthetic SID / logon SID per sandbox; a distinct *principal* needs a local user + elevation [^3] | **partial** — Landlock domain + process creds; `untrusted_app`-style per-app UID has no direct analogue without a helper user |
| App-level allow-listing | **partial** — App Container policies are machine-wide and admin-deployed; block events land in the CodeIntegrity operational log [^11]. Not per-invocation | **partial** — no WDAC analogue; Landlock `EXECUTE` rights are path-based only |
| Integrity labels | **partial, rejected for this use** — MIC relabels the host workspace, changing the trust model [^3] | n/a |
| Job lifetime / reaping | **available** — Job Object (existing) | **available** — process groups |
| Durable audit of decisions | **absent** — must be built (item 170) | **absent** — same |
| Policy outside the subject | **absent** on both. The nearest real boundary is the kernel: token/Landlock state, which the child cannot widen [^7] |

Two documented prior-art choices worth recording, because they are the harnesses closest to this one. **OpenAI Codex** ships a Windows sandbox at the cost of an **elevated one-time setup** (create two local users, store credentials under DPAPI, install firewall rules), plus a separate `codex-command-runner.exe` because `CreateProcessAsUserW` cannot cross the user boundary from the real-user side [^3]. **Claude Code** does not sandbox native Windows at all; it sandboxes shell commands only, on macOS/Linux/WSL2, and explicitly notes that file tools, MCP servers and hooks run *outside* the sandbox [^5f97cd#9][^6]. Both are arguments for the spawn-wrapper design and against pretending the hook is the boundary.

---

## 7. Backlog proposals (registered, not scheduled)

All five are aligned to provisional items 170–174. None requires a second always-on daemon; the egress proxy must live **inside** the broker, or it invalidates `docs/runbooks/broker-down-or-stalled.md` and `docs/runbooks/daemon-not-running.md`.

| Item | Proposal | Owner | Acceptance |
|---|---|---|---|
| **170** | **Decision audit rows.** Add an `effect` record written by `SeatGuard` for every allow and deny: `ts, run_id, seat_id, claim_id, policy_rev, mode, subject_label, object_label, class, perms, decision, rule_id, correlation_id`. "No row, no effect": a failed audit write refuses the call | broker / seatguard | A query answers "which seat was refused, under what rule, when" for a seeded refusal; injected write failure produces a refusal, not a silent allow |
| **171** | **Policy as data + fail-closed loader + complain mode.** Labels, classes, `allow` table in one versioned file; `policy_rev` pinned into every audit row; `permissive` writes the same row with `result=permissive`; broker refuses to start on unparsable policy; `policy explain <call>` prints the deciding rule | seatguard | Same call produces identical `rule_id` in `explain` and in the audit row; corrupt policy → broker refuses to start; promote requires a signed revision |
| **172** | **Claim-scoped grants.** Grant object `(claim_id, object_label, perms, issued_by, policy_rev, expires_at)`; derived from claim metadata at claim open; revoked at claim close; invalid across `reset`/fork; issuance authority is a named role, not "any seat" | pm + seatguard | Expired / wrong-claim / unauthorised-issuer grants each deny with a distinct rule id; claim close removes reach without a seat restart |
| **173** | **Spawn boundary.** Every child passes a launcher: Windows = restricted token + restricted SID list (unelevated first); Linux = Landlock (+ seccomp) or `bwrap`. Measure spawn latency and compare git/npm success rates with and without | runtime | Failing-first fixtures from §4 pass; measured latency delta recorded with machine and workload; documented list of broken tools with a named workaround, not a blanket exclusion |
| **174** | **Egress broker + credential non-possession.** In-broker HTTP proxy, allowlist of exactly the inference host; children get no direct route (netns on Linux, firewall-per-principal on Windows only if the elevated setup is accepted); sentinel token substitution with TLS termination; provider key never in a child env. Relates to item 132 (operator-owned key management): the OS-grade model **does** change the requirement — item 132 must supply a *broker-side* credential, not a distributable one | broker + operator | Child `env` shows no key; non-allowlisted host refused and recorded; sentinel substituted only on the allowed host; Windows residual-risk decision recorded explicitly if elevation is declined |

Sequencing note for `pm`: 170 and 171 are prerequisites for 172 (a grant without a decision record is unverifiable), and 173/174 both need the canonicaliser from 171. 174 should not start before the item 132 design question is answered, because the proxy's credential story *is* that design.

---

## 8. Could-not-verify

Explicit, not omitted.

1. **The repository.** I had the commissioned prompt only, not the tree. Every baseline claim (`src/seatguard.mjs:464-467`, `src/seattools.mjs:255-264`, D49, F24, D42/D45) is `briefed`, not `observed` by me. The report must be re-checked against the tree before it is treated as a gap analysis rather than a design memo.
2. **Overhead figures.** No measurement I could cite states both machine and workload for Landlock ruleset enforcement, restricted-token creation, or ACL application against a short-lived `bash`/`git`/`npm` churn profile. OpenAI reports qualitatively that ACL application "can be expensive depending on the topology of the workspace" and runs read-ACL installation asynchronously for that reason [^3][^80058c#220] — class `advertised-elsewhere`, no number. **All latency claims are `unverified` until measured locally (item 173).**
3. **Per-item / claim-scoped grants.** I found no primary source reporting a per-task, auto-expiring grant model *measured* in a multi-agent codebase. The mechanism is `unverified` as prior art; the recommendation rests on structural fit with D49, not on someone else's result.
4. **Delegated grant authority** (a `pm` seat granting rather than a human). Only standards-adjacent self-claims (agent identity/delegation surveys) [^12][^13], nothing with an implementation and a measurement. `unverified`.
5. **Licence + pinned commit for reusable implementations.** I did not verify the licence, exact file path, or commit for `@anthropic-ai/sandbox-runtime`, `bubblewrap`, or Codex's sandbox crates. Under our own evidence rule these are `unverified` as *reusable* components; they are cited here only as descriptions of design.
6. **WDAC specifics.** I confirmed only that App Control policies are machine-wide, admin-deployed, and log blocks to the CodeIntegrity operational log [^11]. Whether a per-invocation WDAC policy is possible at all is `unverified`.
7. **Android grantor semantics for a non-human principal.** Android's model assumes a human user as grantor with system UI. I found no primary source describing delegated grant issuance between apps; the "grantor = claim authority" ruling is inference, not precedent.
8. **Permission-fatigue measurement.** The strongest nearby evidence I located is an arXiv preprint on permission-group auto-granting [^14] and the platform's own mitigations (deny-twice suppression, auto-reset) [^10]. I did not verify a peer-reviewed measurement of fatigue rates, so the "per-call prompting is the fatigue machine" ruling rests on the platform's design response, not on a cited study.
9. **Junction-on-Linux and `C:/…`-on-POSIX examples.** Taken from the commission as local observations; I did not reproduce them. They are `briefed`, and they are exactly the kind of thing the failing-first tests in §4 exist to pin down.

---

### Sources

| Marker | Source | Class |
|---|---|---|
| [^1] | [AOSP — SELinux concepts](https://source.android.com/docs/security/features/selinux/concepts) | observed (primary doc) |
| [^8] | [SELinux Notebook — type enforcement](https://github.com/SELinuxProject/selinux-notebook/blob/main/src/type_enforcement.md) | observed |
| [^2] | [SELinux Notebook — auditing (AVC message fields)](https://github.com/SELinuxProject/selinux-notebook/blob/main/src/auditing.md) | observed |
| [^5] | [Red Hat — Permissive Domains](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/6/html/security-enhanced_linux/sect-security-enhanced_linux-fixing_problems-permissive_domains) | observed |
| [^9] | [Red Hat — Allowing Access: audit2allow](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/6/html/security-enhanced_linux/sect-security-enhanced_linux-fixing_problems-allowing_access_audit2allow) | observed |
| [^4] | [LWN — SELinux permissive domains (2008)](https://lwn.net/Articles/303216/) | community |
| [^10] | [Android Developers — Permissions updates in Android 11](https://developer.android.com/about/versions/11/privacy/permissions) | observed |
| [^14] | [arXiv — Silent Consent, Persistent Risk: Android permission auto-granting](https://arxiv.org/html/2605.27667v1) | advertised-elsewhere (preprint) |
| [^7] | [Linux kernel docs — Landlock](https://docs.kernel.org/userspace-api/landlock.html) | observed |
| [^15] | [Microsoft Learn — AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation) | observed |
| [^11] | [Microsoft Learn — App Control debugging/troubleshooting](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/operations/appcontrol-debugging-and-troubleshooting) | observed |
| [^3] | [OpenAI — Building a safe, effective sandbox to enable Codex on Windows (2026-05-13)](https://openai.com/index/building-codex-windows-sandbox/) | direct (their build, their measurements/observations) |
| [^6] | [Claude Code docs — Configure the sandboxed Bash tool](https://code.claude.com/docs/en/sandboxing) | observed (product doc) |
| [^12] | [arXiv — AI Identity: Standards, Gaps, and Research Directions](https://arxiv.org/pdf/2604.23280) | advertised-elsewhere |
| [^13] | [OpenID Foundation — Identity Management for Agentic AI](https://openid.net/wp-content/uploads/2025/10/Identity-Management-for-Agentic-AI.pdf) | advertised-elsewhere |

**References**

[^1]: [SELinux concepts  |  Security  |  Android Open Source Project](https://source.android.com/docs/security/features/selinux/concepts) (3%)
[^2]: [selinux-notebook/src/auditing.md at main · SELinuxProject/selinux-notebook · GitHub](https://github.com/SELinuxProject/selinux-notebook/blob/main/src/auditing.md) (0%)
[^3]: [Building a safe, effective sandbox to enable Codex on Windows | OpenAI](https://openai.com/index/building-codex-windows-sandbox/) (50%)
[^4]: [SELinux permissive domains](https://lwn.net/Articles/303216/) (0%)
[^5]: [8.3.4. Permissive Domains | Security-Enhanced Linux | Red Hat Enterprise Linux | 6 | Red Hat Documentation](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/6/html/security-enhanced_linux/sect-security-enhanced_linux-fixing_problems-permissive_domains) (3%)
[^6]: [Configure the sandboxed Bash tool - Claude Code Docs](https://code.claude.com/docs/en/sandboxing) (29%)
[^7]: [Landlock: unprivileged access control — The Linux Kernel  documentation](https://docs.kernel.org/userspace-api/landlock.html) (8%)
[^8]: [selinux-notebook/src/type_enforcement.md at main - GitHub](https://github.com/SELinuxProject/selinux-notebook/blob/main/src/type_enforcement.md) (1%)
[^9]: [8.3.8. Allowing Access: audit2allow - Red Hat](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/6/html/security-enhanced_linux/sect-security-enhanced_linux-fixing_problems-allowing_access_audit2allow) (1%)
[^10]: [Permissions updates in Android 11  |  Android Developers](https://developer.android.com/about/versions/11/privacy/permissions) (1%)
[^11]: [App Control debugging and troubleshooting guide](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/operations/appcontrol-debugging-and-troubleshooting) (0%)
[^12]: [AI Identity: Standards, Gaps, and Research Directions for AI Agents](https://arxiv.org/pdf/2604.23280) (1%)
[^13]: [Identity Management for Agentic AI](https://openid.net/wp-content/uploads/2025/10/Identity-Management-for-Agentic-AI.pdf) (0%)
[^14]: [Silent Consent, Persistent Risk: Android Permission ...](https://arxiv.org/html/2605.27667v1) (0%)
[^15]: [AppContainer isolation - Win32 apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation) (1%)