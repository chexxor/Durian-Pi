# Research commission — sandbox substrates, egress mediation and permission raising for a multi-seat rig (round 2)

**Status: READY TO ROUTE** (written 2026-11-05, amended same day after a security position and a ten-project prior-art
intake landed; the operator ruled **"Yes, continue the research. We should have a thorough understanding of the domain
before we design a solution for our needs"** and offered to route prompts to their own research agent).

The research agent is off-host and has **no write access to this repo** (operator, 2026-10-28), so this prompt asks for
**content to copy**, never for commits or repo writes (`docs/runbooks/research-request.md`). The delegate fetches and
manifests every cited page into `inputs/fetched/` on landing, and checks every quote against our own copy.

**Host of every measurement quoted below:** Linux Fedora 44, kernel `7.2.14-200.fc44.x86_64`, node v24.22.1
(never a hostname — D205). This rig also runs Windows natively; **never WSL, never Docker** (D131).

## What changed since this prompt was first drafted (read before answering)

A `security` seat wrote the substrate position for ROADMAP 170–174 and **measured our current stack** rather than
restating our docs. Its baseline is the premise for the questions below — **correct it if it is wrong**:

- Every model-issued tool call passes one chokepoint, `ToolHooks.beforeTool` in the `durig.guard` extension. That hook
  is a **text matcher over one tool call** plus a partial write-target resolver. Measured **ALLOW** at both layers
  (in-process evaluation of the guard's own decision function; nothing executed): an HTTP PUT of a worktree file to a
  foreign host; raw TCP to a LAN host; a `python3 -c` socket to the rig's own inference port; outbound `ssh`;
  `cat ~/.ssh/id_ed25519`; `cat` of a sibling seat's worktree; `rm -rf <sibling worktree>`; `sed -i $HOME/.bashrc`;
  `chmod 666 ~/.ssh/authorized_keys`; `ln -s <outside>`; `git config --global core.hooksPath <outside>`;
  `git config --global alias.x '!…'`; `include.path`; `credential.helper store`; an `npm install` with lifecycle
  scripts. Measured **BLOCK**: a shell redirect outside the root, `cp` to `/tmp`, `docker ps`, `git push` without the
  operator grant. The write-target resolver returned `targets:[] unresolved:[]` (silent) for every mutating POSIX verb and
  for every global-git-config form.
- Credential hygiene is **closed for names, open through the filesystem**: `inheritEnv:false` is forced, the child env is
  a 12-name OS allowlist, and a credential-*named* variable never crosses. But `HOME` is allowlisted, so private keys are
  reachable by path, and there is no egress rule to stop exfiltration
  (`grep -c -iE "network|socket|egress" src/confine.mjs` → **0**).
- All twelve seats run as **one OS user**, so OS identity is a norm, not a control. No refusal writes a durable record.
- The position's conclusion, which we accept: **the boundary is the spawn seam of every seat-initiated child process**
  (`bash`/`git`/`npm`/anything a child execs), carrying an OS-enforced **read and write** path rule set, an OS-enforced
  destination rule set, a per-run subject label, and no credential in the child env. Everything above that seam is a
  belt for mistakes, not a boundary.

## New prior art we now hold pinned (do not re-survey these — read them, then go past them)

Pinned clones at recorded shas, licence read from each clone's own `LICENSE`:
`pi-packages` (MIT, contains `pi-auto-review` with a `BoundaryRequest`/`BoundaryReview`/`BoundaryGrant` schema and a
SQLite audit store), `pi-permission-modes` (MIT), `auto-permission-system` (MIT), `toolflow` (MIT, zero deps, pure
in-process gating), `pi-secure-it` (MIT: `sandbox-exec`/bubblewrap OS sandbox + in-process tool guard + network-drop for
headless runs), `pi-code-tool` (MIT, depends on `@pydantic/monty`), `mudroom` (MIT, Swift/macOS: copy-on-write clone +
allowlist proxy that logs every connection), `llm-sandbox` (MIT: backend-capability dataclass that deliberately separates
*adapter capability* from *protections enabled for this session* from *host can run it*; backends incl. bubblewrap,
nsjail, kubernetes, `windows_mxc`), `aegis-orchestrator` (**AGPL-3.0**), `ironclaw` (**AGPL-3.0**: `network=none` +
host proxy to the model, gVisor/seccomp/`no-new-privileges`, and an `ironctl scan` that grades seven weighted dimensions
fail-closed), plus `cloudflare/sandbox-sdk` (Apache-2.0), `microsoft/agent-governance-toolkit` (MIT),
`arjan/awesome-agent-sandboxes` (**no LICENSE file**; used as a link list only).

**And the one we have not pinned yet, which is why this round exists:** four of the six pi-ecosystem extensions depend
on **`@anthropic-ai/sandbox-runtime`** (one at `0.0.81` exact, three at `^0.0.78`). Measured on the npm registry
2026-11-05: licence **Apache-2.0**, published versions `0.0.78`–`0.0.81`, repository `anthropics/sandbox-runtime`. We
have read **neither its enforcement claims nor its source**.

**Licensing ruling now in force (operator, 2026-11-05), so you can be blunt:** we prefer mechanisms that are MIT or
Apache-2.0 ("option (a)" — read AGPL material for design only, no code or schema enters our tree without a per-item
ruling), **but the operator has said we may adopt AGPL if we must** (our tree is MIT today, so that means either a
relicensing decision or accepting AGPL obligations on the combined work). State the licence per mechanism you propose;
do not self-censor a mechanism because it is AGPL.

## Questions

1. **`@anthropic-ai/sandbox-runtime`, read at a commit.** What does it actually enforce, by what syscall-level mechanism,
   on Linux and on macOS and Windows? Does it need root or any elevated setup? Is the policy a per-spawn, monotonic
   ruleset or a mutable one? Which of these does it cover: filesystem read **and** write, network destinations
   (per-host? per-port? via a proxy?), env/credential scrubbing, spawn-time vs per-call mediation? Does it support a
   *proxy that terminates TLS and allowlists destinations*, and does it carry its own audit record? Is it usable as a
   substrate by a harness that is not Claude Code, and what is the integration surface (its README's own words)? Cite
   repo path + commit sha for every claim, and mark each row `observed` vs `advertised`.
2. **Minimal Landlock ruleset for a real coding seat.** Given Landlock at spawn (unprivileged, self-imposed, inherited by
   children, TCP rules since ABI v4): what is the **smallest ruleset that still admits** `git`, `node`, npm installs with
   lifecycle scripts, `sqlite` reads of a large on-disk store, symlinks into a vendored checkout, `/tmp` scratch, and
   loopback connections to two local model providers — and **what demonstrably remains unmediated** after that ruleset?
   Say specifically: which metadata operations, `/proc` paths, `AF_UNIX`/IPC, `ptrace`, and device paths stay open; and
   which of those a seccomp filter or a user/net namespace closes, at what cost and with what portability loss.
3. **`bwrap` vs Landlock vs a userspace proxy on one unprivileged host.** For each: what is scoped to the process tree,
   what is host-global, what survives a `setuid`/`exec` chain, what happens to our existing extension-loaded hook layer,
   and what does it cost per spawn. We do **not** want a daemon; say plainly if a mechanism requires one.
4. **Egress mediation that can be scoped to one process tree.** Verify or refute: Landlock's `TCP_BIND`/`TCP_CONNECT`
   rules are **per-port**, not per-address. If we need per-host/per-domain control without root, what is the honest
   mechanism (loopback allowlist proxy with TLS-CONNECT allowlisting? per-run `HOME` + proxy env vars? `nftables`/cgroup
   rules that need root — say so) and what does each *actually see* (SNI vs `Host:` vs pinned IP; a proxy sees
   destinations but not what a tool did with a file). Name at least two shipped implementations of the proxy pattern and
   how they handle a child that ignores `*_PROXY` env vars.
5. **Credential brokerage, two kinds.** The harness needs a provider key for the seat's *own* completion; the seat may
   want a different key for its *task*. How do shipped projects keep those apart so the second never enters the child?
   For each pattern: who holds the secret, how a signed operation is requested, how it is revoked, cost per call.
   Include the case where the outer process and the sandbox are the same OS user (our situation).
6. **Request/raise/adjudicate flows that do not rot.** Survey what is *implemented* (not advertised) in the projects
   pinned above **plus** any others you find: who adjudicates (human, policy engine, another model), what the grant is
   scoped to (session, directory, command, destination, tool-call), does it **expire**, is it **single-use**, is the
   decision logged, and what happens when the adjudicator does not answer. We have ruled that a raise produces a **new
   spawn with a wider ruleset** and never widens a live one; find any project that implements that, or say nobody does.
   Find **evidence of fail-open behaviour**: an `ask`/hook/timeout path that resolves to allow (we already hold
   copilot-cli issues #3590 and #2893 as title-checked evidence — check them and find more).
7. **Can a second model adjudicate a capability grant?** Anything published on LLM-judged permission decisions: measured
   error rates, what it needs in context (policy text, the claim text, the diff, the destination?) to beat a static
   allowlist, and what an abstention does. Be blunt if the answer is "nobody has shown this". Note our constraint: the
   adjudicator is a different model family from the author seats, on a metered API, with a per-call cost cap.
8. **Durable grants vs durable conversations.** The pi packages bind `BoundaryGrant` to a **pi session id**. Our seats
   outlive processes (a conversation is re-attached after a crash/reset/compaction), so "same session" is ambiguous. Find
   any project that scopes a grant to a *task/claim* rather than a session or process, and state what identity they use.
9. **Audit record shape and standards.** Our target is `avc: denied`-like (subject, object, class, permission, result,
   enforce|complain, policy revision). What is the closest shipped schema in agent runtimes (OpenTelemetry `gen_ai.*`
   semantic conventions, a project's own audit table), and can a durable-store row be reconciled with it without a second
   writer? Also: what do projects do to keep an audit sink from becoming a secret store?
10. **Grading containment, fail-closed.** `ironclaw`'s scanner grades seven weighted dimensions and scores anything it
    cannot observe as insecure. Propose the equivalent dimension set for a **process-confined seat** on Linux (Landlock /
    seccomp / namespaces / egress / uid / caps / env / cwd), state how each is *observed* by an instrument, and what is
    unobservable. Reject the container-shaped dimensions with the reason.
11. **Windows parity, honestly.** If Linux gets Landlock, what is the equivalent-fidelity control for a short-lived child
    on native Windows (restricted token + restricted SID list, job objects, mandatory integrity, WDAC, AppContainer), and
    what is provably **not** available without elevation — especially network denial. Confirm or refute our belief that
    Windows egress control is advisory at best without an elevated setup step.
12. **What we would be silently opting out of.** State, for the record, what the cloud/microVM/container family
    (E2B, Modal, Firecracker, gVisor, Kubernetes agent-sandbox, Docker/Podman, "run the seat on another host") gives that
    a native single-host spawn wrapper cannot — real destination isolation, per-principal identity, kernel separation —
    so the trade is written down rather than implied. We are declining them deliberately (native-host rule, one OS user).

## Deliverable

Report to **`docs/reviews/agent-sandbox-substrate-research.md`** (we commit it verbatim; you cannot write it). Each
section as **one fenced block with no narration glued to the title line**:

1. `@anthropic-ai/sandbox-runtime` facts table (Q1) — mechanism · privilege · scope · monotonic? · audit · licence ·
   citation (repo path + commit sha).
2. Substrate decision table — Landlock · seccomp · user/net namespaces · `bwrap` · proxy · (SRT) · privilege required ·
   enforceable scope (path read/write, port, destination, syscall, IPC) · inheritance · unwidenable? · per-spawn cost ·
   failure catalogue · evidence class · citation.
3. **Minimal-ruleset residue list** (Q2) — what the ruleset admits, and the named residue that stays unmediated.
4. Egress control table (Q4) — mechanism · scope-able to one process tree? · per-host vs per-port · TLS limits ·
   privilege · citation · how a child evades it.
5. Credential-brokerage patterns (Q5) — pattern · secret holder · revocation · per-call cost · same-OS-user behaviour ·
   citation.
6. Permission-request flows (Q6) — one row per project, marked `advertised` vs `observed in code`, with grant scope,
   expiry, single-use, log, and no-answer behaviour.
7. **Fail-open catalogue** (Q6) — every documented case where an approval/ask/hook resolved to allow on timeout,
   absence or misconfiguration; issue/commit id **and its title verbatim** (we title-check every pointer).
8. Verifier-adjudicated grants (Q7) — what exists, what is measured, what is unknown.
9. Grant identity for durable sessions (Q8) + audit schema (Q9) — the minimal field set you would add to our `avc` shape.
10. Containment grading dimensions for a process-confined seat (Q10) — dimension · how observed · unobservable?
11. Windows parity table (Q11) — control · fidelity vs the Linux answer · needs elevation? · citation.
12. What we decline, and the property we lose by declining (Q12).
13. **Recommendation** for one native host, one OS user, no containers, no VMs, control placed in an installed extension:
    adopt / adapt / reject **with the reason**, each with its licence, and what stays unverified.
14. **Could-not-verify list** — explicit, no hedging.

## Evidence discipline (this is what killed a previous round)

Every external claim carries a **verbatim quote of ≤ 40 words + the URL + your own fetch date**. A line range into a page
you fetched into your own workspace is not portable — we cannot open it. For code, cite **repo path + the commit sha you
read**; `git grep` output is fine; "the project uses X" is not. State the evidence class per row: `advertised-elsewhere`
(docs/marketing) vs `observed` (you read the code) vs `measured` (you ran it). Name the licence of anything you propose to
borrow. **Check the title of every issue you cite before you characterise it** — we once folded a report's numbers under
the wrong title and it took a fetch to catch.

## Constraints

- Written report only. **Do not modify code**, do not open issues, do not run anything from the projects surveyed.
- No WSL, no Docker, no Kubernetes, no microVM/cloud sandbox is acceptable **as our seat substrate** — survey them only
  for Q12.
- Do not re-litigate these rejections unless you bring new evidence: SELinux type-enforcement policy language, roles/MLS,
  `audit2allow` auto-load, AppContainer as our control, per-call human prompting, always-on sandbox daemons.
- Keep our two-plane rule in view: **policy is data, mechanism is in the harness**, and every new mechanism must be
  installable as an explicitly-loaded extension (no auto-discovery). A substrate that can only be welded into the host
  process must be named as such.
