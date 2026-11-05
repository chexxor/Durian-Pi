# Research commission — sandbox substrates and permission raising for a multi-seat rig

**Status:** delegate-written, NOT YET ROUTED. The research agent is off-host and has no write access to this repo
(operator, 2026-10-28), so this prompt asks for **content to copy**, never for commits or repo writes
(`docs/runbooks/research-request.md`). The delegate fetches and manifests every cited page into
`inputs/fetched/` on landing.

**Written:** 2026-11-05 (delegate), on the operator's directive to prioritize seat sandboxing. Host of the
measurements quoted below: Linux, Fedora 44, kernel `7.2.14-200.fc44.x86_64`, node v24.22.1.

**Already consumed — do not re-run these:** `docs/reviews/zero-trust-zero-agent-research.md` (the OS-grade
isolation commission, D130 — it already rules: adopt the *shape* not the machinery; reject SELinux type-enforcement
language, roles/MLS, `audit2allow` auto-load, AppContainer, MIC relabelling, per-call human prompting; the smallest
real boundary is a spawn-time wrapper — restricted token + restricted SID list on Windows, Landlock/seccomp/`bwrap`
on Linux). This prompt is the **second round**: the named prior art the operator supplied, and the one mechanism
the first round did not specify (raising a grant at runtime).

## Context

durian-pi runs a team of twelve LLM **seats** on one native host (Linux and Windows; **never** WSL or Docker —
D131 and the entry point's non-negotiable). Each seat is a `pi-durable` conversation; every model-issued tool call
passes one chokepoint, `ToolHooks.beforeTool` in the `durig.guard` extension (`src/seatguard.mjs:526-531`), which
refuses writes outside the seat's per-item worktree (`src/confine.mjs`, `src/writetargets.mjs`), refuses a staged
commit carrying a secret, and refuses a degraded shell state; `afterTool` redacts secret-shaped values
(`src/secretredact.mjs`). Seat child processes get `inheritEnv: false` plus a 12-name OS allowlist, and a
credential-shaped name never crosses (`src/confine.mjs:340-353, 365, 686-692`). Process-tree reaping is already
OS-level (Windows Job Object, POSIX process group).

**Measured gaps** (so the agent can correct us rather than repeat us): `grep -c -iE "network|socket|egress"
src/confine.mjs` → **0** — no network, destination, or per-endpoint rule exists; a refusal writes **no durable
record** (there is no `avc: denied` analogue); reach is granted **per seat, never per claim**; and the mediator
shares the subject's process and OS identity. The first round called in-process mediation "an integrity and
mistake-containment control", not a boundary — we agree and want the honest limit stated per control.

**What we are deciding.** (1) Which sandbox substrate to adopt for a short-lived seat child (`git`, `npm`, `bash`)
on a native host with no container and no VM; (2) how to express its policy as **data** that the existing hook
substrate consults; (3) how a seat may **ask** for more reach and have a **verifier** adjudicate the ask against
project policy and the specific task, then raise the grant for that claim only, with expiry and revocation —
against a spawn-time ruleset we intend to keep **monotonic** (unwidenable).

## Questions

1. **Spawn-time substrates on Linux without root or a container daemon.** For Landlock (ABI v4+), seccomp-bpf with
   `SECCOMP_RET_ERRNO`, user+network namespaces via `unshare`/`setns` without `CAP_SYS_ADMIN`, `bwrap`, and `sc`:
   for each — what is enforceable **unprivileged** on a stock modern distro (Fedora 44, kernel 6.17-class), what is
   inherited by children, what is unwidenable by the sandboxed subject, and what does it cost (per-spawn overhead,
   complexity, failure modes)? Cite the kernel doc or the tool's own source path, not a blog.
2. **TCP/UDP destination control specifically.** Landlock's `TCP_BIND`/`TCP_CONNECT` rules are **per-port**, not
   per-address (verify). If destinations must be per-host/domain, what is the smallest honest mechanism on a single
   host: an allowlist proxy at a loopback port? a `nftables`/`cgroup`-owned rule (needs root — say so)? a
   userspace HTTP(S) forward proxy with TLS-CONNECT allowlisting and its limits stated (SNI vs Host vs pinned IP)?
   We need a per-run destination set, not a host-wide firewall; say which of these can actually be scoped to one
   process tree and which cannot.
3. **Credential brokerage.** Cloudflare's Sandbox SDK states the pattern in one line: *"Your Worker decides who
   gets a sandbox, which hosts it can reach, and which credentials stay out of it"* and its `S3Mount` signs each
   storage request so the secret never enters the sandbox (`README.md`, `docs/architecture.md:12,75`). Find other
   implementations of "the sandboxed subject requests a signed operation; the outer process holds the secret":
   name the mechanism, its revocation story, and what it costs per call. Include agent-specific cases: a model API
   key the harness needs for the seat's *own* completion vs a key the seat wants for a task — how do the projects
   we listed keep those two apart?
4. **Capability/permission request flows that do not rot.** Survey the request/approve/raise machinery actually
   implemented (not advertised) in: SandBase Harness (`MCP tool permissions, approvals, and audit/replay`), AEGIS
   (deny-by-default policy), `cplt` (policy committed to the repository), `nono` (capability-based shell),
   Copilot CLI (`permissionDecision`) and Claude Code (`permissionMode`/hooks). For each: who adjudicates (human,
   policy engine, another agent), what is the grant scoped to (session, directory, command, destination, per
   tool-call), does it expire, is the decision logged, and what happens when the adjudicator does not answer?
   We specifically want **evidence of fail-open behaviour**: known issues where an "ask" path or a hook times out
   into allow (we already hold copilot-cli #3590 and #2893 as fetched, title-checked evidence — check them and
   find more).
5. **Can a verifier (a second model, different family) adjudicate a capability grant?** Anything published on
   LLM-judged permission decisions: does anyone do it, what is the measured error rate, what escalation do they use
   for abstentions, and what does an approver need in its context (the policy text, the claim text, the diff, the
   destination?) to be better than a static allowlist? Name the study/benchmark and its evidence class.
6. **Audit record shape.** Our target shape is `avc: denied`-like (subject label, object label, class, permission,
   result, enforce|complain, policy version). Find the closest analogue in agent runtimes (OpenTelemetry semantic
   conventions for agent/tool spans, e.g. `gen_ai.*`, or a project's own audit schema), and state whether a
   durable-store row plus that convention can be reconciled without a second writer.
7. **Windows parity, honestly.** If Linux gets Landlock, what is the *equivalent-fidelity* control on native
   Windows for a short-lived child — restricted token + restricted SID list, job objects, mandatory integrity,
   WDAC — and what is provably **not** available without elevation (especially: network denial)? The first round's
   answer was "advisory at best"; confirm or refute with a citable source.

## Deliverable

Write the report to **`docs/reviews/agent-sandbox-substrate-research.md`** (we will commit it verbatim; you cannot).
Required sections, each supplied as **one fenced block with no narration glued to the title line**:

1. **Substrate decision table** — substrate · privilege required · enforceable scope (path / port / destination /
   syscall / IPC) · inheritance · unwidenable? · per-spawn cost · failure catalogue · evidence class · citation.
2. **Egress control table** — mechanism · can it be scoped to one process tree? · per-host vs per-port · TLS
   limitations · privilege required · citation.
3. **Credential-brokerage patterns** — pattern · who holds the secret · revocation · per-call cost · citation.
4. **Permission-request flows** — the survey from Q4, one row per project, with an explicit "advertised" vs
   "observed in code" mark and a link into a specific file path at a specific commit.
5. **A fail-open catalogue** — every documented case where an approval/ask/hook path resolved to allow on
   timeout, absence, or misconfiguration, with the issue/commit id and its title verbatim.
6. **Verifier-adjudicated grants** — what exists, what is measured, what is unknown (Q5). Be blunt if the answer
   is "nobody has shown this".
7. **Audit schema** — Q6's answer, plus the minimal field set you would add to our `avc` shape and why.
8. **Recommendation for a single native host, no containers, no VMs** — what to adopt, what to adapt, what to
   reject **with the reason**, and what stays unverified.
9. **Could-not-verify list** — explicit, no hedging in the body.

**Evidence discipline (this is what killed a previous round).** Every external claim carries a **verbatim quote of
≤ 40 words + the URL + your own fetch date**. A line range into a page you fetched into your own workspace is not
portable — we cannot open it. For code, cite **repo path + the commit sha you read** (`git grep` output is fine),
never "the project uses X". State the evidence class per row: `advertised-elsewhere` (docs/marketing) vs
`observed` (you read the code) vs `measured` (you ran it). Name your licence check for anything you propose to
borrow (the awesome list itself has **no LICENSE file**; that is an escalation class, not an invitation).

## Constraints

- Written report only; **do not modify code**, do not open issues, do not run anything from the projects surveyed.
- Respect our platform rule: **no WSL, no Docker, no Kubernetes, no microVM/cloud sandbox is acceptable as our
  seat substrate** (D131 + the native-host non-negotiable). Survey them only to say what we are declining and what
  property we lose by declining (e.g. real destination isolation), so the trade is on the record.
- Do not re-litigate the first round's rejections (SELinux type-enforcement language, roles/MLS, `audit2allow`
  auto-load, AppContainer, MIC relabelling, per-call human prompting) unless you bring new evidence that a
  rejection is wrong.
- Keep our two-plane rule in view: **policy is data, mechanism is in the harness**, and every new mechanism we
  adopt must be installable as a **pi-durable extension** (`defineExtension({name, tools, sections, hooks, tasks,
  wraps})`, loaded explicitly by name from `DURIG_EXTENSIONS`, no auto-discovery). A substrate that can only be
  welded into the host process must be named as such.
