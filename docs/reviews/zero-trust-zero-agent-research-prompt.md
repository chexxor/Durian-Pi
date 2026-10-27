# Research prompt — OS-grade seat isolation and permissions (Linux/Android model)

**Commissioned:** 2026-10-27, by operator ruling (R4 of the memory planning round: *"security precedes …
I want to build a platform on pi-durable (durian-pi) that has a proper security story like the Linux kernel
and its processes (llm agent/seat), maybe even with SELinux. Another good security model could be Android,
which has finer-grained permissions per app (per llm agent/seat)."*).
**This prompt realizes and extends ROADMAP item 60** ("Zero trust to zero agent — narrow seat permissions",
registered 2026-10-16). Item 60's registered output path is **`docs/reviews/zero-trust-zero-agent.md`** —
verified absent, so the research has never landed. Land it there; do not open a second file.
**Hand to the operator to route to the research agent** — the delegate cannot call it.
**Follow-on:** when it lands, the project breakdown goes into `docs/ROADMAP.md` items 170–174 (already
registered as provisional).

## Context

durian-pi is a harness for a team of LLM coding agents. A **seat** is a long-lived `pi-durable` conversation
(one per seat, ~12 seats) driven by a single-writer broker over one SQLite store. Each seat gets a **worktree
per work item** as its `cwd`, a tool surface (`read`/`write`/`edit`/`bash`/`powershell` plus queue tools), and a
declared capability set. **Native Windows first** — never WSL, never Docker; Linux is a real portability
target but not the primary one.

What already exists, verified in this tree (the baseline the report must measure against, not guess):

- **Mandatory-ish mediation at one chokepoint.** Every model-issued tool call passes
  `ToolHooks.beforeTool` (`src/seatguard.mjs:464-467` → `SeatGuard`, installed next to the Router so no seat
  escapes it). It refuses shell writes outside the seat's worktree, refuses `write`/`edit` targets outside the
  root (`src/writetargets.mjs`, `src/confine.mjs`), refuses a staged commit containing a secret, and refuses a
  degraded/guarded shell state. A refusal is `{block: reason}`, surfaced to the seat as a blocked call.
- **Redaction on the way back.** `afterTool` redacts secret-shaped values out of tool results
  (`src/secretredact.mjs`, `src/secretdetect.mjs`).
- **Coarse grants.** Capabilities are declared per seat in the rig file and decide tool *removals*
  (`src/seattools.mjs:255-264` `toolRemovalsFor`; a seat declaring no capability loses everything,
  deliberately). Org `edges` are restrictive-by-default and `check` reports unreachable/stray seats.
  `docs/SEAT-CAPABILITY-PROFILE.md` makes an assignment checkable against the assignee's real tool surface.
- **Artifact-keyed ownership** of docs/surfaces (`docs/reviews/Agent_Ownership_Review.md`), per-item worktrees
  (D49), a `genlock` lease for concurrent generations, and the store single-writer rule (two write-side
  drivers collide — dogfood F24, D42/D45).
- **Process containment already partially OS-level**: Windows process-tree reaping via a **Job Object**,
  POSIX process groups (`src/job-object.mjs`; D-notes at `docs/DECISIONS.md:1324-1328, 1731`).
- **Policy-before-code is already a rule**: a `security.sec` **position doc before** any new trust boundary or
  execution surface (D24/D27, item 55; method in `docs/runbooks/security-trust-boundary-review.md`; 12 existing
  positions at `docs/reviews/security-*-position.md`). Self-assessment: `docs/security/owasp-asi-self-assessment.md`
  (ASI06 memory/context poisoning, ASI08 no breaker/budget).
- **What is demonstrably missing** (observed here, so the report should not be told otherwise): there is **no
  audit record of an enforcement decision** — `SeatGuard` returns `{block: …}` and writes no durable row, so
  "which seat was refused, under what rule, when" is not queryable; there is **no per-item grant** (reach is set
  per seat, not per claim); there is **no egress policy** (a seat's shell has the operator's network reach and,
  today, the provider key lives in the parent environment); and **hook-level mediation has no OS-level backstop**
  — it is the same process as the subject it polices.

## Questions

Each must end in *adopt / keep / reject / unverified* against the baseline above.

1. **The kernel model, honestly abstracted.** How does Linux actually separate **DAC from MAC**: VFS as the
   single mediation point, LSM hooks as the policy interface, and SELinux's type enforcement (subjects, objects,
   security classes, `allow` rules, type transitions, roles, and MLS/MCS labels) layered on top — with policy
   *outside* the application. What is the minimum faithful analogue inside a single-process agent harness:
   subject label (seat), object label (path / artifact / tool / egress / store row), security class, and an
   `allow` relation consulted at every effect? Where does the analogy **break** when the policy engine lives in
   the same process, with the same OS permissions, as the subject it polices — and what is the smallest real
   boundary that could be moved out of process?
2. **SELinux specifically.** What parts are load-bearing (type enforcement, default-deny, labelled objects,
   type transitions on exec, `permissive` domains for rollout, `audit2allow` as an *anti-pattern*) and what parts
   are the operational failure everyone warns about? Cite the documented policy-development workflow, and say what
   an agent harness should copy versus skip.
3. **Android specifically.** The per-app model: a distinct UID per app, an SELinux `untrusted_app` domain, a
   declared permission manifest, runtime grants with user-visible ask and revocation, scoped/tied grants, and
   signed permissions. Which of those map onto seats, and which do not — particularly: **who is the grantor**
   when a `pm` seat, not a human, is the one assigning work? Is there prior art on *delegated* grant authority
   in agent systems, and on the rubber-stamping/permission-fatigue failure mode?
4. **Identity that survives the lifecycle.** Linux gives a process an auditable identity (PID, creds, auditd
   records binding uid/subject to a decision). A seat's identity is *not* stable across a wake, a `reset`, a
   fresh conversation (roadmap 28b), a fork, or a compaction. What does prior art say about **agent identity and
   attestation** — durable per-agent identity, keying audit records to it, and preventing one run's actions being
   attributed to another? Name the audit-record shape used by auditd / SELinux `avc: denied` lines (subject,
   object, class, permission, result, policy mode) as a model.
5. **Two enforcement layers, and the escapes between them.** Where does an agent slip past a *tool-level* gate?
   Look for documented classes: shell interpreters and one-liners, build/lifecycle scripts (npm `prepare`, git
   hooks), path traversal and symlink/junction confusion, case-insensitivity and 8.3 names on Windows, device and
   UNC paths, environment inheritance, TOCTOU on a `cwd` switch. We have two concrete local examples: a
   **junction created on Linux behaves like a file symlink** and defeats a directory-only ignore rule, and
   literal `C:/…` path expectations resolve as relative paths on POSIX. What is the defence-in-depth pattern when
   the mediation layer is a hook, not a syscall boundary?
6. **OS-level containment per platform, native only.** On Windows: restricted tokens, **AppContainer**, job
   objects, mandatory integrity levels, filesystem ACLs, WDAC/AppLocker, network filtering — what is actually
   usable to contain a short-lived `bash`/`git`/`npm` child, what does it cost (startup latency, complexity,
   breakage of git/npm in a worktree), and what is *not* available? On Linux: user namespaces, Landlock, seccomp,
   `bwrap`/`unshare` — as a parity target, not a container. Are there **published agent harnesses that
   OS-sandbox their agent processes**, and what did they choose and regret?
7. **Per-item rather than per-seat grants.** Item 60's original question, still open: prior art on narrowing an
   agent's reach toward the **task** — time-boxed or claim-scoped grants, auto-expiry, deny-by-default network,
   scoped filesystem for the duration of a claim — and the measured cost side (config sprawl, maintenance,
   drift). What is the narrowest model that has been reported to actually hold up in a multi-agent codebase?
8. **Egress and credentials.** A seat needs exactly one outbound destination (the inference provider) and must
   not hold the key. Prior art on broker-side proxies / scoped short-lived tokens / egress allow-lists for agent
   systems, and the enforcement options per platform. Relate explicitly to ROADMAP item 132 (a dedicated
   API-key-management component the operator owns) — does the OS-grade model force a different design there?
9. **Rollout without breaking the team.** `permissive`/complain-before-enforce exists in SELinux and Android.
   What is the documented practice for turning default-deny on over a working system: audit-only mode, policy
   diffing, `audit2allow`-style synthesis *with human sign-off*, and how to detect over-broad synthesis?
10. **Multi-project separation.** Operator ruling: memory and reach are scoped **per project**. What does
    per-project isolation look like in practice — separate stores vs labelled partitions in one store, per-project
    workspaces and keys, and Android's user/profile separation as a model? What leaks across today (the rig file,
    one store, one provider key, one machine)?
11. **What not to copy, with evidence.** Label drift in dynamic systems, policy sprawl and its maintenance cost,
    the audit2allow rubber-stamp culture, over-trust in "it's sandboxed", container-vs-sandbox debates, and any
    measurement showing sandbox overhead against a short-lived process churn profile.

## Deliverable

`docs/reviews/zero-trust-zero-agent.md`, in the shape of the existing research reviews (see
`docs/reviews/agent-governance-toolkit-review.md`):

0. Verdict in one paragraph: is the kernel/Android model the right substrate here, and which half.
1. **Gap table** — mechanism → what durian-pi has today (with file path) → what is missing → adopt / keep /
   reject / unverified.
2. **Substrate vs policy split** — which mechanism belongs in the harness code (the mediation points, already
   `beforeTool`/`afterTool`), and which belongs in declarative config (labels and `allow` rules). Our house rule:
   **policy is data, not code**, and it must fail closed.
3. **Decision table** with the *why* for each ruling, written so it can be lifted into `docs/DECISIONS.md`.
4. **Failure catalogue** — how each proposed control is defeated, and the test that would show it.
5. **A proposed enforcement-point inventory** — every place a seat can produce an effect (tool call, store
   commit, egress, spawn), and whether a control exists there today.
6. **Platform matrix** — Windows vs Linux, per control: available / partial / absent, with the doc or code citation.
7. **Backlog proposals** — concrete items with owner and acceptance, *registered not scheduled*, aligned to
   provisional items 170–174 so `pm` can sequence them.
8. **Could-not-verify list** — explicit, not omitted.

## Evidence discipline

Every external claim carries a **URL** and an **evidence class** in our vocabulary: `direct` (measured by its
authors) / `advertised-elsewhere` (vendor or paper self-claim) / `community` (practitioner report) / `observed`
(a fact from a repo, doc, man page, or LICENSE you can point at) / `unverified`. For every implementation cited
as reusable: name the **licence**, the **exact file path**, and a **pinned commit**. Benchmarks and overhead
figures must state the machine and the workload. **A design pattern with no implementation and no measurement is
`unverified`, not advice.** Prefer primary sources: kernel docs, SELinux/SE Linux policy docs, AOSP docs, Android
security CDD/CTL documents, man pages — not blog summaries.

## Constraints

- **Native Windows first.** Do not propose WSL, Docker, or a container runtime as the answer; Linux is a parity
  target on the same codebase.
- **One process, one store, one writer.** The broker owns the store; two write-side drivers collide. Any design
  needing a second always-on daemon must say what it costs and which existing runbook it invalidates
  (`docs/runbooks/broker-down-or-stalled.md`, `docs/runbooks/daemon-not-running.md`).
- Seats already run real `git`/`npm`/shell in a per-item worktree; a control that breaks that must name the
  breakage and a failing-first test for it.
- Do not propose a control that lives only in the system prompt. Our measured stance (from
  `docs/reviews/memory-implementation-plan.md` §6 and the memory research) is that prompt-level defences are the
  weakest control known; architectural enforcement is the point.
- Written report only — no code, no doc edits beyond the report itself.
- Anything that opens a new trust boundary must be framed as needing a `security.sec` **position before code**
  (item 55; `docs/runbooks/security-trust-boundary-review.md`).
