# Codemode for seats — design plan

**Status: design, not implemented.** Gated on (a) the boundary SC1–SC3 landing, (b) a
`security.sec` position (**ratified**, item #1295 — see gate 1), and (c) the library review
below being treated as requirements rather than notes. Basis: the operator's
`CodeMode_JS_with_Effects_and_Policies.md` review, checked against the runtime source rather
than taken on trust.

## What the operator's review got right, and what it got wrong

**Adopted in full.** The central finding is correct and it is the reason this is a project and
not a switch: codemode sandboxes the *language* well and does **not** permission effects — the
effect surface **is** the tool set, all-or-nothing. `ALL_TOOLS` exposes every *callable* tool,
including ones the description omits; tool calls are **real** (nothing is rolled back);
`models.*` exercises the session's credentials on the script's behalf; and `codemode.mode`
(`on`/`only`) is **visibility, not authorization**. The recommended shape — JavaScript for
authoring, a capability/effect **broker** for enforcement — is what we adopt, and its
authorize → budget → approve → execute → audit handler with `revokeAll` in `finally` is the
design.

**Corrected against source** (each was load-bearing, so each is recorded rather than edited away):

| Claim | Reality |
|---|---|
| "bounded heap (256 MB)" | **256 MB is a *pi-tool* setting, not a library default.** `CodemodeSandboxOptions.memoryLimitBytes` defaults to **no limit** beyond wasm32's 4 GiB (§ `types.d.ts:110-113`). A durig codemode tool that omits it gets **no memory bound** |
| "optional hard deadline (`timeout_ms`), unset by default" | The **script's** `@options.timeout_ms` is unset; the **sandbox** is not — `DEFAULT_TIMEOUT_MS = 300_000` and `options.timeoutMs ?? DEFAULT_TIMEOUT_MS` (`runtime/host.js:5,302`) |
| "a WASI-based QuickJS worker, isolated from the main process" | It is `new Worker(...)` from **`node:worker_threads`** (`runtime/host.js:1,147`) — a **thread in the same process**. Language isolation; a VM escape inherits main-process authority |
| the `runScript` sketch | Built on `quickjs-emscripten` / `newQuickJSWASMModule`. pi's library is **`quickjs-wasi`** with `CodemodeSandbox` + `loadQuickJSWasm`. We must build on `CodemodeSandbox`, not a second sandbox |

**Verified as stated:** no Node APIs, filesystem, network or timers in the VM; `tools`/`models`
are the only egress; output capped at `MAX_OUTPUT_CHARS` = 16 MB and `MAX_OUTPUT_ITEMS` =
100 000; store capped at `MAX_STORE_VALUE_CHARS` = 256 KB and `MAX_STORE_TOTAL_CHARS` = 1 MB;
`CodemodeExecuteOptions` carries an `AbortSignal`. pi's own README confirms the framing we are
planning around: it "does not include a built-in permission system … it runs with the
permissions of the user and process that launched it."

## The design

### 1. Build on `CodemodeSandbox`, and set what it does not default

```js
new CodemodeSandbox({
  tools: mintedCapabilities,     // NOT the session's tool set
  globals: hostHelpers,          // text()/image() only
  timeoutMs: <deliberate>,       // never inherit 300_000 by accident
  memoryLimitBytes: <deliberate> // MUST be set; the default is unlimited
});
```

Registering only minted capability tools is what removes `ALL_TOOLS`: with nothing else
registered there is no ambient surface to discover.

### 2. Minted capabilities per script, revoked in `finally`

Each `api.*` method is an effect operation; the broker is the handler; grants are **resource
predicates**, not handles, so copying a capability inside the script buys nothing. Grants carry
budgets (`maxCalls`, `maxBytes`, `maxUsd`) and optional `once` for linear single-use effects.
`revokeAll(scriptId)` runs in `finally`, so authority dies with the script.

### 3. Executors delegate to the boundary, so codemode inherits SC1

The broker's executors do **not** touch the filesystem directly. `fs.read`/`fs.write` go through
durig's **confined `ExecutionEnv`** (SC1) and `proc.exec` through `api.executeTool()` on the
confined tool. Path confinement is therefore enforced **twice** — the grant predicate and the
environment — and the SC1/SC2 work planned for the shell serves codemode with no second
implementation.

### 4. `proc.exec` is never the boundary

The operator's sketch allowlists `argv[0]`. That is the **same weakness security.sec flagged for
PowerShell**: a string check is not a boundary. So `proc.exec`, if exposed at all, is a narrowing
layer over an already-confined environment — exactly as F4 concluded for `prepare`.

### 5. Audit

`result.calls` records `{ name, status, durationMs }` only — **no arguments and no output** —
and a nested result never enters the transcript (spec §8.3–8.4). The broker's audit sink is
therefore the script's real effect record, and it is a requirement, not a nicety: without it a
codemode execution is one opaque line in `log`.

Research: `docs/reviews/reducing-llm-agent-tool-calls-followup.md` §3/§6 confirms the shape of this gap
and turns it into an acceptance criterion — ROADMAP **129** (the audit sink) and **128** (a mid-run bound
on a single long-running sandbox call, which D64 cannot see until the run settles).

## What this buys, and what it does not

**Buys:** a narrower front door. If the model sees only `codemode` and the minted set is
narrower than the shell, the model's own calls are structured, inspectable and budgeted — and
because durig's hooks see **nested** calls via `ToolCall.parent`, a guard at `beforeTool`
(`types.ts:745-752`) also covers everything a script does.

**Does not buy:** confinement. Per `security.sec`'s answer to Q6, a QuickJS sandbox adds **no**
filesystem confinement for the tools it hosts — they keep their reach. So codemode is a
**replacement for the shell only if the minted set is narrower**, and SC1–SC3 remain the
boundary regardless. Its one genuine security *gain* is that a nested result never enters the
transcript, which reduces model-visible untrusted input — and that gain only exists once SC1
does.

## Deferred: an effect-handler *language*

The operator's doc weighs Koka/Effekt-style authoring and reaches the right answer: defer it.
Model competence is the binding constraint (models write JS/TS/Python), the WASI layer already
provides capability semantics underneath, and "effects as a library" captures most of the value
without betting on a niche language. Revisit only if a static effect type-checker over
model-authored scripts proves worth the authoring failure rate.

## Gates before this lands

1. **`security.sec` position — RATIFIED (#1295); gate 1 is CLOSED by this fold.** The position is
   `docs/reviews/security-codemode-position.md` (branch `security-item-1295`, rev `4cba82f`). It
   **ratifies with three corrections** the delegate's round
   (`docs/reviews/security-codemode-review.md`, E1–E14) — which is the *input*, not the position — and
   answers the round's six open questions. This gate is a new dependency (`pi-codemode` +
   `quickjs-wasi`), a new execution surface, and its own audit sink. No network capability is exposed
   in the first cut: `net.fetch` and `model.call` are **not minted**, so no egress is added.
   *Corrections:* **C1** the `node:worker_threads` sandbox is a **thread in the broker process** —
   language isolation only; with the same Windows user a thread escape reaches broker memory (the
   store handle, the provider key in env), so T0 narrows the motivated-attacker surface but never
   *proves* containment. **C2** the audit sink records **denied** effects too, not only allowed ones
   (gate G1). **C3** every cite-by-reference library claim is re-verified before this gate declares
   closed.
   *Open questions, resolved:* **audit sink** — git-backed **append-only**, readable while the broker
   is down, landing **before any tier** (G1 / ROADMAP **129**); the live store is not the forensics
   record. **`proc.exec`** — never the boundary (E6), rejected in T0/T1; T2 only under containment
   plus a new position (G8). **`model.call`** — not minted in the first cut (it spends the session's
   credentials); minting it later needs per-call approval + budgets **and a new position** first.
   **Host containment** — form is the implementer's pick (container/VM/AppContainer), but **without a
   runnable deny-demonstration no containment exists** and no write/exec tier may land. **Mid-run
   bound** — a security **control** (G2 / ROADMAP **128**): an in-sandbox loop is invisible to D64's
   per-turn bounds until the run settles, so it lands **with** codemode, not after.
   *Tier gating:* mint + SC1 (predicates-not-handles, no ambient surface, always-set bounds) is
   sufficient for **T0** (read-only `fs.read` + `fs.list`) only. **T1 (write) and T2 (exec) stay
   gated** on host containment + the audit sink; this fold releases no tier item.
   *Position gates (all falsifiable; no codemode code lands until they hold):* **G1** audit sink first
   (allowed **and denied**); **G2** mid-run bound; **G3** bounds fail closed (`memoryLimitBytes`/
   `timeoutMs` unset ⇒ refuse to start); **G4** offline demo probes (E1/E3/E4/E7/E8/E11/E12/E14);
   **G5** the two-layer denial proof — one escape denied by the grant predicate, another independently
   by the confined environment; **G6** supply chain (pin + install-script review, E13); **G7** surface
   equality — declared = granted = minted (E1/E14); **G8** any deviation (minting `tools`/`models`,
   omitting bounds, a T0-only push, an unaudited effect, a `proc.exec` boundary) needs a **new**
   `security.sec` position first.
   *Not re-registered here:* 128/129 and the batchability rule were registered against item 32 by
   #1235 (VERIFY #1293).
2. **Boundary first.** SC1–SC3 land and are proved before codemode exists, because the
   executors delegate to them.
3. **Library review as requirements** — the four corrections above are acceptance criteria, and
   the first two (`memoryLimitBytes`, `timeoutMs`) are must-sets: getting them wrong means an
   unbounded VM.
4. **Proof** — a demo where a script attempts an escape that the **grant** denies *and* one the
   **environment** denies independently, so neither layer is load-bearing alone.

## Relationship to the other seat-tool work

- `docs/SEAT-TOOLS.md` — the shell/tools boundary this depends on (SC1–SC3).
- `docs/reviews/security-codemode-review.md` — the delegate security round: threat model **E1–E14**, the
  **T0 read-only** first cut, and the audit-sink/bounds prerequisites (ROADMAP **128/129**).
- `docs/reviews/security-codemode-position.md` — the ratified `security.sec` position (item #1295):
  E1–E14 ratified with corrections C1–C3, the six answered questions, and gates **G1–G8** (gate 1 above).
- ROADMAP item 31 — the pi-warden port (the guard at `beforeTool`), which covers nested calls.
- ROADMAP item 32 — this plan.
