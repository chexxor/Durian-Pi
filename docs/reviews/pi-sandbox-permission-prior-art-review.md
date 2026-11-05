# Review — the sandbox / permission prior art the operator named on 2026-11-05 (ten clones, pinned and triaged)

**Asked for:** the operator's second and third batches of "more to review" —
`erichll/pi-packages` (`packages/pi-sandbox`), `wynainfo/pi-permission-modes`, `Navin009/auto-permission-system`,
`3ZEROS12/toolflow`, `hannesro/pi-secure-it`, `josephkern/pi-code-tool`, `100monkeys-ai/aegis-orchestrator`,
`Kernel-Hunter/mudroom`, `vndee/llm-sandbox` ("for its language and backend plugin system"), and
`IronSecCo/ironclaw` — read against the
sandboxing order (ROADMAP **170–174**, **268–273**; D208 Ruling B) and the two hard constraints: **control anything
external to a seat** (filesystem, network, domains, credentials), and **every customization on top of a bare pi /
pi-durable harness lives in an extension/plugin**.

**Scope and honesty of this pass.** This is an **index + first-pass mechanism read**, not a deep code review, and it is
labelled that way so `security`'s substrate position (#4829) and `lead`'s decomposition (#4833) can cite real code
instead of README claims. **Nothing here was run, installed, or built.** Every claim below is either
**observed** (a path in the pinned clone, which anyone can re-open) or **advertised** (the project's own prose, which we
have not reproduced). Clones live in gitignored `vendor/eval/`; the tracked evidence is the pin table in
`docs/VENDOR-PINS.md`.

Host for the measurement commands: **Linux Fedora 44, kernel `7.2.14-200.fc44.x86_64`, node v24.22.1, git 2.56.0**
(`uname -a && node -v` in the same command). Cloned with `git clone --depth 1` on 2026-11-05.

## Pins (all nine; regenerate with `node tools/vendor-pins.mjs --write docs/VENDOR-PINS.md --tags`)

| clone | HEAD | commit date | license | size |
|---|---|---|---|---|
| `pi-packages` (monorepo: `pi-sandbox`, `pi-auto-review`, `pi-statusline`) | `06a3de5` | 2026-11-03 | **MIT** (`pi-packages/LICENSE`) | 2.3 MB |
| `pi-permission-modes` | `652902a` | 2026-10-25 | **MIT** | 1.9 MB |
| `auto-permission-system` | `284fd87` | 2026-11-05 | **MIT** | 3.3 MB |
| `toolflow` | `553c128` | 2026-10-25 | **MIT** | 1.3 MB |
| `pi-secure-it` | `bcdd0f1` | 2026-10-02 | **MIT** | 3.6 MB |
| `pi-code-tool` | `c686c03` | 2026-10-08 | **MIT** | 0.6 MB |
| `aegis-orchestrator` | `0da464f` | 2026-10-28 | **AGPL-3.0** — escalation, see §Escalations | 23 MB |
| `mudroom` | `2bea494` | 2026-11-01 | **MIT** | 30 MB |
| `llm-sandbox` | `a8f0d95` | 2026-11-05 | **MIT** | 13 MB |
| `ironclaw` | `1b934bf` | 2026-11-02 | **AGPL-3.0** — escalation, see §Escalations | 29 MB |

Earlier pins from the same order — `cloudflare/sandbox-sdk @ 61cac81b` (Apache-2.0),
`arjan/awesome-agent-sandboxes @ db6ffc0a` (**no LICENSE file**; operator ruled it usable as a **link catalogue**, D209 —
each linked project keeps its own license), `microsoft/agent-governance-toolkit @ a918f763` (MIT, see the **PIN MOVED**
note in `agent-governance-toolkit-review.md`) — stay as pinned.

## The one finding that should reach #4829 before it lands

**Four of the six pi extensions sit on the same substrate: `@anthropic-ai/sandbox-runtime` (SRT).** Observed in the
dependency manifests of the pinned clones — `pi-permission-modes` `2.7.2` → `@anthropic-ai/sandbox-runtime@0.0.81`;
`auto-permission-system` `3.20.4` → `^0.0.78`; `pi-secure-it` `2.0.0` → `^0.0.78`; `@erichll/pi-sandbox` `0.29.2` →
`^0.0.78` **plus** `@erichll/pi-auto-review@^0.28.0`. `toolflow` has **no dependencies** (pure in-process tool gating),
`pi-code-tool` depends on `@pydantic/monty` (an interpreter-level sandbox, not an OS one). So in the pi ecosystem the
de-facto answer to "what is the seat substrate" is already **SRT reached through an extension**, which satisfies the
operator's extension constraint while leaving the enforcement to a shared runtime. **SRT itself is NOT vendored or
pinned here** — it is an npm dependency, and pinning a runtime we might build on is a decision, not a default;
`security` and `lead` should say which way to go and then pin it before anyone quotes its behaviour.

## Per-project mechanism read (observed = re-openable in the pinned clone)

**`@erichll/pi-auto-review` — the closest thing to ROADMAP 269 that exists in the wild.** Observed: a boundary broker
with a typed request/review/grant vocabulary — `src/broker/types.ts` defines
`BoundarySurface = command | filesystem-read | filesystem-write | network | mcp | skill`, `BoundarySource =
permission-system | sandbox-runtime`, a `BoundaryRequest` carrying `operation`, `cwd`, `command`, `matchedPattern`,
`resolvedPath`, `destinationHost/Port/Protocol`, `toolCallId`, `agentName`, `requesterSessionId`, and
`matchedPolicy`; a `BoundaryReview` of `{outcome: "allow"|"deny"|"defer", riskLevel: low|medium|high|critical,
userAuthorization: unknown|low|medium|high, rationale}`; and a **scoped, expiring, single-use grant**:
`BoundaryGrant = {token, requestHash, sessionId, expiresAt, usesRemaining: 1}`. Supporting files observed:
`src/broker/grants.ts`, `overrides.ts`, `circuit-breaker.ts`, `src/policy.ts` (>1,000 lines), and — the part we do not
have at all — **`src/policy-audit/{classifier,report,sqlite,store}.ts`**, a durable audit store with a report layer.
Advertised (README): "Model-backed boundary approval broker and permission-system authorizer". **Why it matters:** the
operator's ask — a seat asks, a verifier judges against policy *and the task*, the grant is raised and revoked — is
expressed here as data shapes we can compare ours against, including the two properties D208/lead's rulings insist on
(expiry, single use) and lead's "a capability raise is a NEW SPAWN" rule (their grants bind to a `sessionId`).

**`pi-permission-modes` — the operator's "flexible permission model", as shipped config.** Observed (`src/config-audit.test.ts:21,34`
show the live schema): a mode is `{label, hideTools: [...], sandbox: {enabled, allowWrite: [".", "/tmp"], network:
{allowedDomains: [...]}}, permission: {bash: {"*": "ask"}, write: "ask"}}` with `defaultMode` and `cycleOrder`; and
`src/config-audit.ts` **audits drifted config** into `stale | redundant | custom | unknown` leaves.
`src/awareness.ts:275` tells the model, verbatim in its prompt: *"If a command fails with a permission or network error
without a prompt having appeared, the sandbox blocked it silently — ask the user for that step instead of retrying
variants"*. Advertised: four default modes (**Default → Plan Mode → Build → YOLO**), one-keystroke switching, "network
prompts pause the command instead of failing it", Linux/WSL2/macOS/Windows. **Why it matters:** it is the
allow/ask/deny-per-tool + OS-profile bundle we would have to design anyway, it puts **`network.allowedDomains`** in the
same object as the write allowlist (268), and its `silentFailures` doc ref is an explicit answer to a failure mode we
currently have no story for (our refusals are not durable at all).

**`pi-secure-it` — the monotonic-tightening rule we need for any raise-a-permission flow.** Observed
(`lib/project-trust.ts:1-10`): project-scoped policy at `<cwd>/.pi/sandbox.json` (their ADR-013); *"trust it may only
tighten the policy: its deny lists are added to yours, [allow]lists, overrides, sandbox weakening flags) is ignored. A
file is trusted when its SHA-256 is recorded in the trust store, which only `/security trust` and pi-secure-it's own
'always for CURRENT project' writes (of an already trusted file) update."* Two-layer by design (README): OS bash sandbox
(`sandbox-exec` on macOS, **bubblewrap** on Linux) for shell, plus an **in-process tool guard** for the tools the OS
sandbox cannot reach (`read/grep/find/ls/write/edit`), plus a third layer that drops network for headless/`-p`/subagent
runs. Advertised: interactive unblock with "this once" / "always for this project". **Why it matters:** it is the same
split we already have (`src/confine.mjs` at spawn, `durig.guard` per tool), and its trust rule is the cleanest available
statement of "a raise never loosens below what the anchor allows" — which is lead's monotonicity ruling with a
content-hash anchor attached.

**`vndee/llm-sandbox` — the plugin/backend seam the operator pointed at, and a distinction our own instrument gets
wrong.** Observed (`llm_sandbox/backends.py:1-6`, docstring): *"Backend registration and static adapter capabilities.
**Discovery never imports a backend SDK or probes the host. Capabilities describe features implemented by an adapter,
not protections enabled for a particular session or guarantees that the current host can run it.**"* The
`BackendCapabilities` frozen dataclass (`:38-46`) is `platforms, container_images, interactive, pooling,
filesystem_isolation, network_isolation, seccomp, daemon_required`, with `pooling=True` documented as opting into a
supplied-pool path that "does not call the registered factory". The backend set is file-level visible:
`docker.py, podman.py, bubblewrap.py, wsl2_bubblewrap.py, nsjail.py, kubernetes.py, windows_mxc.py, local/, pool/,
security/, language_handlers/, mcp_server/`. **Why it matters twice over:** (a) it is a language-level answer to D131
(Linux + native Windows in one seam: `bubblewrap` / `wsl2_bubblewrap` / `windows_mxc`); (b) its
**capability ≠ armed-for-this-session ≠ host-can-run-it** split is exactly the distinction
`tools/channel-preflight.mjs` §7 collapses — it prints "NO SHELL CAN START HERE" on a host where
`tools/broker-serve.mjs --status` reports `bash` CAN start and the store shows successful `bash` tool results
(entry **#285389**). Registered as a new roadmap item.

**`Kernel-Hunter/mudroom` — the egress shape ROADMAP 268 is missing, plus an audit trail.** Observed (`README.md`
"How it works", and `App/` is Swift — a macOS app, `Package.swift`): copy-on-write clone of the project into `base/` +
`work/`; the agent runs in a **Linux micro-VM or container** with only `work/` inside; **"the only way out" is an
allowlist proxy** that "checks every host against the project's allowlist and **logs the connection**"; writes reach the
real folder only through a **per-file, per-hunk diff review with undo**, and each apply re-checks that the file still
matches `base/` so the human's own edits are never clobbered. Its README also carries a dated self-audit
("Checked against each project's docs on **2026-09-30**") comparing **Docker Sandboxes** (microVM, folder mounted
rw by default, `--clone` mode), **Apple's `sandboxy`** example (`apple/containerization`), **ArcBox** (microVM, nothing
mounted), and **Claude Code sandboxing** (real folder + OS-level limits, no VM). **Why it matters:** the
proxy-as-sole-egress-plus-log design is the cheapest thing that would make seat network reach *mediated and auditable*
without a VM, and its comparison list is the next set of pins to consider — with the caveat that the check date is
**theirs**, not ours.

**`IronSecCo/ironclaw` — the containment **grader** the rig does not have (AGPL: design only).** Observed at
`docs/blog/add-a-sandbox-isolation-score-badge-to-your-repo.md:26-46`: `ironctl scan` "reads your container's runtime
configuration and grades **seven independent containment dimensions**" — non-root user (15), dropped capabilities (20,
"not the default set"), seccomp profile (15), network isolation (15, "no bridge egress; prefer `network=none`"),
read-only root filesystem (10), no `docker.sock` exposure (15), no shared host namespaces (10) — sums to 0–100 with a
letter grade, and **"the scan is fail-closed: any dimension it cannot observe is scored as insecure, never waved
through."** Observed substrate in the clone (`go.mod`, `cmd/{controlplane,ironctl,sandbox,scan-wasm,ironclaw-vault-injector}`):
`network=none` (1805 hits), `gvisor`/`runsc` (1085/450), `seccomp` (1118), `no-new-privileges` (371), `cap_drop`,
`read-only` (3007), `proxy` (874), plus a **vault injector** (credential brokerage, not yet read). Advertised: "Each one
runs sealed in a sandbox that provably cannot phone home, read your host, or rewrite its own rules", with the agent
reaching the model "only through a host proxy" and **unable to change its own configuration**. **Why it matters:** we
assert a seat is confined and never grade the posture, and our one verdict-printing instrument (`channel-preflight` §7)
is currently wrong in the loud direction — a fail-closed grader is the discipline we lack. Registered as **278**.

**`auto-permission-system`** — advertises a "zero-trust permission architecture / Secure Auto Mode"; observed only that
it is SRT-based (`^0.0.78`) with heavy `network`/`egress`/`bubblewrap`/`seccomp` surface and an `adr/` directory.
**Not reviewed beyond that.** Its author is the same as `pi-secure-it`'s (both MIT, "Hannes" in the copyright) — worth
knowing before treating them as two independent designs.

**`toolflow`** — "stage-gated capability mounting" + context dehydration; observed **zero runtime dependencies**, so its
gating is entirely in-process/harness-level. Relevant to 269's *lifecycle* question (capabilities mounted at a stage
boundary are the same family as a grant that expires) and to 270 (a pure extension), but it does not do OS or egress
enforcement. **Not reviewed beyond the seam.**

**`pi-code-tool`** — code-mode meta-tool: the agent writes Python executed by `@pydantic/monty`, calling host tools as
functions, and can save working code as named ephemeral tools. A **different substrate axis** (interpreter-level, tools
as capability handles) that matters to us because pi itself ships codemode; unreviewed beyond the manifest.

## Escalations (recorded, not resolved by me)

1. **`aegis-orchestrator` is AGPL-3.0** (`LICENSE` first line, observed), and so is **`ironclaw`** (`LICENSE` first
   line, observed). Per `docs/VENDOR-PINS.md` ("a copyleft or
   missing licence is an escalation to the operator, not a quiet copy") they stay **read-for-design-only**. What
   `aegis` is
   worth reading: a Rust orchestrator with **policy-enforced runtimes, durable FSM state, a plugin/registry seam**
   (`registry`/`plugin` dominate its source surface) and backends including **Firecracker** and egress control. **No
   code, schema, or vendored copy of either may enter the tree without a ruling.**
2. **`arjan/awesome-agent-sandboxes` has no LICENSE file**; operator ruled it usable as a **link catalogue** (D209). The
   working rule recorded: structure and links usable as an index; **each linked project keeps its own license**, so a
   per-item check still gates any clone.
3. **SRT (`@anthropic-ai/sandbox-runtime`) is unpinned and unreviewed** while four projects above depend on it, and
   `pi-permission-modes` pins an exact version (`0.0.81`) while others take a range. Nobody should quote SRT behaviour in
   170's position until it is pinned and its own license/terms are read.

## What this changes in the roadmap (registration only — decomposition is `lead`'s)

- **271 is now consumed** (was: "named prior art pinned but not reviewed"): it produced this review, the SRT
  convergence finding, the grant-shape comparison, and the escalation above. **Ten more clones were pinned in the same
  order on 2026-11-05** (`pi-packages`, `pi-permission-modes`, `auto-permission-system`, `toolflow`, `pi-secure-it`,
  `pi-code-tool`, `aegis-orchestrator`, `mudroom`, `llm-sandbox`, `ironclaw`) — `tools/vendor-pins.mjs --check` →
  **PASS, 27 clones**.
- **New items registered from this pass** (see `docs/ROADMAP.md`): **274** a substrate decision on SRT is a prerequisite
  for 170's position; **275** the capability / armed-this-session / host-can-run-it distinction the preflight collapses
  (feeds **217**); **276** an egress mediation + durable-decision-log shape (allowlist-proxy vs in-process guard) that
  **268** must choose between; **277** an audit/`avc`-style schema and store, which **269** needs before a grant cycle
  can be audited at all.

## What is NOT established here (say it plainly)

- No project above was **run**; every enforcement claim is `observed-in-code` or `advertised`. Nothing here proves an
  enforcement claim **works** — that needs a probe, and the only rig-side measurement I ran this session is the
  credential/egress baseline in D208 (`inheritEnv: false` + allowlist at `src/confine.mjs:491,686-692,340-353,365`;
  `grep -c -iE "network|socket|egress" src/confine.mjs` → **0**).
- The pi extensions target **bare pi**, not the rig's durable layer. Whether their seams survive
  `pi-durable`'s replay/attach lifecycle (a seat's conversation outlives a process) is **untested and load-bearing**
  for 269's grant lifecycle — a grant bound to a session id must mean the same thing after a re-attach.
- `mudroom`'s and `aegis`'s claims about VM isolation were not verified; `mudroom` is a macOS/Swift app and this rig is
  Linux/Fedora (D131: Linux **enforces**, native Windows **checks**) — its value here is the **egress-proxy-and-log**
  shape, not the VM.
