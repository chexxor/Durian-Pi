I see the pi harness for llms has a codemode tool that allows the agent to write JavaScripts scripts to hypothetically use fewer tool-calls to reach a goal.
I am concerned about security -- does codemode implement a sandbox with fine-grained permissioning for the types of side-effects afforded to a JavaScript program? If not, what do you think about having an LLM use an effect-handler language to implement fine-grained permissions and sandboxing instead of JavaScript?


## What pi's codemode actually does

Short answer: it sandboxes the *JavaScript language surface* quite well, but it does **not** implement fine-grained permissioning of side effects. Permission control is coarse — essentially "which tools the session has" — not "which effects this script may perform."

**The JS sandbox itself is strict.** Scripts run as the body of an async function inside a QuickJS sandbox with **no Node APIs, no filesystem, no network, and no timers**; scripts reach the outside world only through the injected `tools` and `models` globals [^2]. It's a WASI-based QuickJS worker, isolated from the main process, with a bounded heap (256 MB) and bounded concurrency (e.g. 4 concurrent model calls) [^1] [^1] [^2]. Output is capped and there's an optional hard deadline (`timeout_ms`), which is unset by default [^2].

**But the effect surface is the tool set, and it's all-or-nothing.** Every tool the session can call becomes a method on `tools` — `bash`, `read`, `edit`, `write`, MCP tools, etc. — and `ALL_TOOLS` exposes *every* callable tool, including ones not listed in the description [^2] [^2]. Crucially:

- Tool calls are **real**: calls made before a script failure are not undone; still-running calls are cancelled, but nothing is rolled back [^2].
- `models.*` runs non-LLM models **with the session's credentials** (the credential values aren't handed to the script, but the authority is exercised on its behalf) [^2].
- The `codemode.mode` setting (`on` / `only`) controls **visibility**, i.e. whether tools are declared to the model or only reachable via scripts — it is not an authorization mechanism [^1].

And at the harness level, pi's own docs are explicit: **"Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it. If you need stronger boundaries, containerize or sandbox Pi."** [^4]

So the mental model is: *good language-level isolation, no per-effect authorization, and the effect surface inherits the ambient authority of the harness.* The dangerous part isn't `eval` or `fetch` — it's `bash`. Any capability you expose as a tool is fully usable by any script, with no per-call approval, no path scoping, no budget, and no audit trail beyond the tool result. Compare this to WASI's own model (no ambient authority; access only via explicitly granted handles [^5] [^8]) or Deno's permission broker (fs/net/env/run gated separately [^3]) — codemode's sandbox stops at the tool boundary, and the tools themselves are unmediated.

## On using an effect-handler language instead

I think the instinct is right, with one important distinction that determines whether it actually buys you safety.

**Separate "effect types" from "effect handlers."** Static effect *typing* tells you (and the reviewer) which effects a program may perform — useful for the model to reason about and for you to reject scripts. Effect *handlers* are the runtime interposition point: the operation is a request, and a handler decides whether to perform it, deny it, ask for approval, log it, or substitute it. The handler is literally a reference monitor, and scoping lets you run a script under a stack of handlers that grants read-only file effects, denies network, and caps spend. That is a very natural fit for "fine-grained permissions for side effects" — much more so than bolting checks onto arbitrary JS.

Prior art backs this up: capability-based security and effect systems are **complementary, not equivalent** — capabilities control *who can do something* (possession of a handle), effects describe *what a computation does* [^6]. Work like Brachthäuser et al.'s "Effects, capabilities, and boxes" unifies them for scope-based reasoning [^9], and there's active discussion of combining the two [^10]. Languages in this space (Koka, Eff, Effekt, Flix) make effects first-class [^7] [^11]. There's also emerging research explicitly aimed at your use case — "language-based agent control" for agentic applications [^12] — and analyses of effect/capability patterns for governing side effects in AI agent runtimes [^6].

**The catch: enforcement semantics, not the paradigm.** An effect system is only as strong as the types around its capabilities. If the script can freely copy and pass a "file handle" capability, a handler that checked at mint time doesn't help. You'd want **linear/affine capabilities or sealed/unforgeable handles** so a granted capability can't be duplicated, stored, or smuggled past its scope. Handlers without that give you *dynamic* mediation (good), but not *unforgeable* authority (better).

**The pragmatic objection: LLM competence.** Models are trained overwhelmingly on JS/TS/Python and produce effect-annotated code in Koka/Effekt far less reliably, with harder-to-recover type errors. Making the model author in an exotic effect language raises failure rates and repair cost. Also note the WASI layer is already capability-based (no ambient authority, explicit grants [^5]), so a lot of the sandboxing benefit is available *underneath* JS — you don't need to change the authoring language to get it.

**What I'd actually recommend (hybrid):**

| Layer | Approach |
| --- | --- |
| Authoring | Keep JavaScript for the model — it's what it writes best. |
| Tool surface | Stop injecting ambient `tools`; inject **minted capability objects** per script (narrow, sealed handles), not the whole session tool set. Extend `codemode.mode` from visibility to *authorization*. |
| Enforcement | Put a **broker/handler** in front of every effectful tool: path globs for fs, host allowlist for net, process allowlist for exec, per-script budget for `models`. This is "effects as a library" — dynamic handlers, no new language. |
| Types | Expose a typed tool surface with effect annotations (even as TS-style declarations the model sees) so misuse is caught before execution where possible. |
| Isolation | Since tools like `bash` are effectively universal effects, treat them as privileged: run the whole harness in a container/VM — pi's docs point here for a reason [^4]. |

The honest summary: codemode gives you a solid *language* sandbox but treats the *tool set* as the security boundary, and pi deliberately has no permission system of its own. An effect-handler language is a genuinely better foundation for fine-grained, composable, auditable permissions — the handler is the natural chokepoint — but you can capture most of that value *today* by layering a capability/effect broker over JS (sealed per-script capabilities + a mediating handler + host containment), rather than betting on the model to write effect-typed code in a niche language. Ideal is both: JS for ergonomics, an effect/capability runtime for enforcement.

**References**

[^1]: [Codemode Sandbox | earendil-works/pi | DeepWiki](https://deepwiki.com/earendil-works/pi/6.5-codemode-sandbox) (42%)
[^2]: [Codemode · Documentation · Pi](https://pi.dev/docs/latest/codemode) (41%)
[^3]: [Security and permissions | Deno Docs](https://docs.deno.com/runtime/fundamentals/security/) (4%)
[^4]: [earendil-works/pi: AI agent toolkit: unified LLM API ...](https://github.com/earendil-works/pi) (3%)
[^5]: [Security](https://wasi.dev/security) (3%)
[^6]: [Effect Systems and Algebraic Effects for Controlled Side Effects in AI ...](https://zylos.ai/research/2026-03-15-effect-systems-algebraic-effects-ai-agent-runtimes/) (2%)
[^7]: [Why Algebraic Effects? - antelang.org](https://antelang.org/blog/why_effects/) (2%)
[^8]: [Capability-based security model · Issue #378 · denoland ...](https://github.com/denoland/deno/issues/378) (1%)
[^9]: [Effects, capabilities, and boxes: from scope-based reasoning ...](https://plg.uwaterloo.ca/~e45lee/publication/boxes/boxes.pdf) (1%)
[^10]: [Combining capability-based security and effects](https://www.reddit.com/r/ProgrammingLanguages/comments/v09vit/combining_capabilitybased_security_and_effects/) (1%)
[^11]: [Programming with Algebraic Effects and Handlers](https://math.andrej.com/2012/03/08/programming-with-algebraic-effects-and-handlers/) (1%)
[^12]: [Language-Based Agent Control](https://arxiv.org/html/2605.12863v1) (1%)



Can you give me an idea with an example implementation of how we could implement your suggestion regarding JS as the codemode language?


Good question — the goal is to show that "effects as a library" is real, not just a slogan. Below is a self-contained design plus a working sketch you can drop into a codemode-style harness. The three ideas that do the work:

1. **The sandbox gets no ambient `tools`.** It gets an `api` object that is *minted per script* from a policy.
2. **Every effect goes through a broker** (the handler), which authorizes, budgets, optionally asks a human, executes, and audits.
3. **Authority is scoped to the script's lifetime** and dies in a `finally`.

## Data flow

```
policy ──▶ mintApi(scriptId) ──▶ grants registered on broker
                                    │
model script ──▶ api.readFile(p) ──▶ broker.request({kind:'fs.read', resource:p})
                                    │
                     authorize ─▶ budget ─▶ approve? ─▶ execute ─▶ audit
                                    │
                              value | throw EACCES
```

## 1. Effect vocabulary and policy

```ts
type EffectKind =
  | 'fs.read' | 'fs.write' | 'fs.list'
  | 'net.fetch' | 'proc.exec' | 'model.call';

interface EffectRequest {
  id: string;
  scriptId: string;
  kind: EffectKind;
  resource: string;          // path, URL, command, model id
  payload?: unknown;         // body / file contents
  meta?: Record<string, unknown>;
}

interface EffectResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: string;
  auditId: string;
}

interface Grant {
  id: string;
  kind: EffectKind;
  /** Resource *predicate* — not a handle to a resource. */
  allows(resource: string): boolean;
  requiresApproval?: boolean;
  once?: boolean;            // single-use: linear capability
  budget?: { maxCalls?: number; maxBytes?: number; maxUsd?: number };
}

interface Policy {
  fs?: { read?: string[]; write?: string[]; list?: string[] };
  net?: { allow?: string[] };              // hostnames
  proc?: { allow?: string[] };             // argv[0] allowlist
  model?: { allow?: string[]; maxCalls?: number; budgetUsd?: number };
  limits?: { timeoutMs?: number; memoryMb?: number };
  approval?: { proc?: 'always'; net?: 'first' };
}
```

## 2. The broker — the effect handler

```ts
type Executor = (req: EffectRequest) => Promise<unknown>;
type Approver = (req: EffectRequest, prompt: string) => Promise<boolean>;

interface AuditSink {
  record(e: EffectRequest & {
    auditId: string; decision: 'allow' | 'deny' | 'error'; reason?: string;
  }): void;
}

class EffectBroker {
  #grants   = new Map<string, Grant[]>();       // scriptId -> grants
  #budgets  = new Map<string, { calls: number; bytes: number; usd: number }>();
  #revoked  = new Set<string>();                // grant ids

  constructor(
    private executors: Record<EffectKind, Executor>,
    private audit: AuditSink,
    private approver?: Approver,
  ) {}

  grant(scriptId: string, g: Grant) {
    (this.#grants.get(scriptId) ?? this.#grants.set(scriptId, []).get(scriptId)!)
      .push(g);
  }

  /** Scope closes: all authority for this script evaporates. */
  revokeAll(scriptId: string) {
    for (const g of this.#grants.get(scriptId) ?? []) this.#revoked.add(g.id);
    this.#grants.delete(scriptId);
  }

  async request<T>(req: EffectRequest): Promise<EffectResult<T>> {
    const auditId = crypto.randomUUID();
    const grants = this.#grants.get(req.scriptId) ?? [];

    // 1. Authorize against a live grant.
    const grant = grants.find(
      g => !this.#revoked.has(g.id) && g.kind === req.kind && g.allows(req.resource),
    );
    if (!grant) {
      this.audit.record({ ...req, auditId, decision: 'deny', reason: 'no matching grant' });
      return { ok: false, error: `EACCES: ${req.kind} "${req.resource}" not permitted`, auditId };
    }

    // 2. Enforce per-grant budgets.
    const over = this.#charge(grant, req);
    if (over) {
      this.audit.record({ ...req, auditId, decision: 'deny', reason: over });
      return { ok: false, error: `EACCES: budget exceeded (${over})`, auditId };
    }

    // 3. Human-in-the-loop for privileged effects.
    if (grant.requiresApproval && this.approver) {
      const ok = await this.approver(req, `Allow ${req.kind} "${req.resource}"?`);
      if (!ok) {
        this.audit.record({ ...req, auditId, decision: 'deny', reason: 'approval denied' });
        return { ok: false, error: 'EACCES: approval denied', auditId };
      }
    }

    // 4. Execute the real effect.
    try {
      const value = await this.executors[req.kind](req);
      if (grant.once) this.#revoked.add(grant.id);   // linear capability consumed
      this.audit.record({ ...req, auditId, decision: 'allow' });
      return { ok: true, value: value as T, auditId };
    } catch (e) {
      this.audit.record({ ...req, auditId, decision: 'error', reason: String(e) });
      return { ok: false, error: `EIO: ${String(e)}`, auditId };
    }
  }

  #charge(grant: Grant, req: EffectRequest): string | null {
    if (!grant.budget) return null;
    const b = this.#budgets.get(grant.id) ?? { calls: 0, bytes: 0, usd: 0 };
    b.calls += 1;
    if (req.payload && typeof req.payload === 'string') b.bytes += req.payload.length;
    const { maxCalls, maxBytes, maxUsd } = grant.budget;
    if (maxCalls != null && b.calls > maxCalls) return `maxCalls=${maxCalls}`;
    if (maxBytes != null && b.bytes > maxBytes) return `maxBytes=${maxBytes}`;
    if (maxUsd   != null && b.usd   > maxUsd)   return `maxUsd=${maxUsd}`;
    this.#budgets.set(grant.id, b);
    return null;
  }
}
```

## 3. Minting the per-script `api`

This is the part that replaces pi's ambient `tools` / `ALL_TOOLS` injection.

```ts
const rid = () => crypto.randomUUID();
const unwrap = <T>(r: EffectResult<T>): T => {
  if (!r.ok) throw new Error(r.error);   // catchable inside the script
  return r.value!;
};

function mintApi(scriptId: string, broker: EffectBroker, policy: Policy) {
  const api: Record<string, unknown> = {};

  if (policy.fs?.read?.length) {
    broker.grant(scriptId, {
      id: rid(), kind: 'fs.read',
      allows: (p) => withinGlobs(p, policy.fs!.read!),
      budget: { maxCalls: 500, maxBytes: 8_000_000 },
    });
    api.readFile = Object.freeze(async (path: string) =>
      unwrap(await broker.request<string>({ id: rid(), scriptId, kind: 'fs.read', resource: path })));
  }

  if (policy.fs?.list?.length) {
    broker.grant(scriptId, {
      id: rid(), kind: 'fs.list',
      allows: (p) => withinGlobs(p, policy.fs!.list!),
      budget: { maxCalls: 200 },
    });
    api.listDir = Object.freeze(async (path: string) =>
      unwrap(await broker.request<string[]>({ id: rid(), scriptId, kind: 'fs.list', resource: path })));
  }

  if (policy.fs?.write?.length) {
    broker.grant(scriptId, {
      id: rid(), kind: 'fs.write',
      allows: (p) => withinGlobs(p, policy.fs!.write!),
      requiresApproval: false,
      budget: { maxCalls: 50, maxBytes: 2_000_000 },
    });
    api.writeFile = Object.freeze(async (path: string, body: string) =>
      unwrap(await broker.request<void>({ id: rid(), scriptId, kind: 'fs.write', resource: path, payload: body })));
  }

  if (policy.net?.allow?.length) {
    broker.grant(scriptId, {
      id: rid(), kind: 'net.fetch',
      allows: (u) => hostAllowed(u, policy.net!.allow!),
      requiresApproval: policy.approval?.net === 'first',
      budget: { maxCalls: 20, maxBytes: 4_000_000 },
    });
    api.fetch = Object.freeze(async (url: string, init?: { method?: string; body?: string }) =>
      unwrap(await broker.request({ id: rid(), scriptId, kind: 'net.fetch', resource: url, payload: init?.body })));
  }

  if (policy.proc?.allow?.length) {
    broker.grant(scriptId, {
      id: rid(), kind: 'proc.exec',
      allows: (cmd) => policy.proc!.allow!.includes(argv0(cmd)),
      requiresApproval: policy.approval?.proc === 'always',
      budget: { maxCalls: 20 },
    });
    api.exec = Object.freeze(async (cmd: string) =>
      unwrap(await broker.request<{ code: number; stdout: string; stderr: string }>(
        { id: rid(), scriptId, kind: 'proc.exec', resource: cmd })));
  }

  if (policy.model?.allow?.length) {
    broker.grant(scriptId, {
      id: rid(), kind: 'model.call',
      allows: (m) => policy.model!.allow!.includes(m),
      budget: { maxCalls: policy.model.maxCalls ?? 8, maxUsd: policy.model.budgetUsd },
    });
    api.callModel = Object.freeze(async (model: string, input: string) =>
      unwrap(await broker.request<string>({ id: rid(), scriptId, kind: 'model.call', resource: model, payload: input })));
  }

  return Object.freeze(api);   // the only handle the sandbox ever receives
}
```

### The resource predicates are where the real security lives

```ts
import { resolve, normalize } from 'node:path';
import { realpathSync } from 'node:fs';
import { minimatch } from 'minimatch';

function withinGlobs(path: string, globs: string[], root = process.cwd()): boolean {
  if (path.includes('\0')) return false;
  // Resolve through symlinks so a link can't escape the root.
  let real: string;
  try { real = realpathSync(resolve(root, path)); } catch { real = resolve(root, path); }
  if (!real.startsWith(root + '/')) return false;
  return globs.some(g => minimatch(real, resolve(root, g), { dot: true }));
}

function hostAllowed(url: string, allow: string[]): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;            // no http, no file:, no gopher:
  return allow.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
}

const argv0 = (cmd: string) => (cmd.match(/^\s*(\S+)/)?.[1] ?? '');
```

## 4. Wiring it into the QuickJS sandbox

The only change from a standard codemode setup is that you set `api` instead of `tools`:

```ts
import { newQuickJSWASMModule } from 'quickjs-emscripten';

async function runScript(source: string, policy: Policy, audit: AuditSink, approver?: Approver) {
  const scriptId = crypto.randomUUID();
  const broker = new EffectBroker(executors, audit, approver);
  const api = mintApi(scriptId, broker, policy);

  const vm = (await (await newQuickJSWASMModule()).newContext());
  try {
    vm.setMemoryLimit((policy.limits?.memoryMb ?? 256) * 1024 * 1024);
    vm.setMaxStackSize(512 * 1024);
    vm.setInterruptHandler(makeDeadline(policy.limits?.timeoutMs ?? 30_000));

    // Marshal `api` as host functions. No `tools`, no `models`, no `require`,
    // no `fetch`, no `fs` — the *only* way out is these frozen methods.
    vm.setGlobal('api', marshalHostApi(vm, api));

    const fn = vm.evalCode(
      `(async () => { "use strict";\n${source}\n})()`,
      { filename: `script-${scriptId}.js` },
    );
    return await vm.resolvePromise(fn);        // bounded by timeout + heap
  } finally {
    broker.revokeAll(scriptId);                // scope closes; authority gone
    vm.dispose();
  }
}
```

## 5. What the model sees

Emit the tool schema *from the policy* so the model's declared surface is exactly the granted surface:

```ts
/** Global `api` available inside a codemode script.
 *  Any call outside these grants throws EACCES — catch it and adapt. */
declare const api: {
  /** Read a file. Allowed roots: src/**, docs/**, package.json */
  readFile(path: string): Promise<string>;
  /** List a directory. Allowed roots: src/** */
  listDir(path: string): Promise<string[]>;
  /** Write a file. Allowed roots: tmp/** (max 2 MB total) */
  writeFile(path: string, body: string): Promise<void>;
  /** HTTPS only. Allowed hosts: api.github.com (max 20 calls) */
  fetch(url: string, init?: { method?: string; body?: string }):
    Promise<{ status: number; body: string }>;
  /** Run a command. Allowed argv[0]: rg, git. Requires approval. */
  exec(cmd: string): Promise<{ code: number; stdout: string; stderr: string }>;
  /** Call a model. Allowed: gpt-4o-mini (max 8 calls, $0.25 cap) */
  callModel(model: string, input: string): Promise<string>;
};
```

## 6. Worked example

Policy:

```ts
const policy: Policy = {
  fs:   { read: ['src/**', 'docs/**', 'package.json'], write: ['tmp/**'], list: ['src/**'] },
  net:  { allow: ['api.github.com'] },
  proc: { allow: ['rg', 'git'] },
  model:{ allow: ['gpt-4o-mini'], maxCalls: 8, budgetUsd: 0.25 },
  limits: { timeoutMs: 30_000, memoryMb: 256 },
  approval: { proc: 'always' },
};
```

Model script (still one tool call, still a loop — the efficiency win is intact):

```js
const hits = [];
for (const f of await api.listDir('src')) {
  if (!f.endsWith('.ts')) continue;
  const text = await api.readFile(`src/${f}`);
  if (text.includes('TODO')) hits.push(f);
}
await api.writeFile('tmp/todos.json', JSON.stringify(hits));
return hits;
```

Trace:

| Call | Decision | Why |
| --- | --- | --- |
| `listDir('src')` | allow | matches `fs.list` grant |
| `readFile('src/a.ts')` | allow | inside `src/**` |
| `readFile('/etc/passwd')` | deny | escapes root / no glob match |
| `writeFile('tmp/todos.json')` | allow | inside `tmp/**` |
| `exec('rm -rf /')` | deny | `rm` not in argv[0] allowlist |
| `exec('rg TODO src')` | approve → allow | allowed, but `proc:'always'` gates it |

The script can `try/catch` the `EACCES` errors and report partial results — denial is a recoverable, structured outcome, not a crash.

## Why this is an effect-handler design, not just "checks in JS"

- Each `api.*` method is an **effect operation**; the broker is the **handler**; grants are the handler's scoped authority; `revokeAll` in `finally` is the handler scope closing.
- Because a grant is a **resource predicate** rather than a handle, duplicating the capability inside the script buys nothing — you can't smuggle authority past the predicate.
- For true **linearity**, set `once: true` on a grant; the broker self-revokes it after one successful use (useful for one-shot destructive effects).
- The handler stack is **composable**: approval, budget, audit, and rate-limiting are all just layers in `request()` — you can add a retry/circuit-breaker layer without touching the sandbox.

## Hardening notes

- **Validate at the boundary.** Only accept structured-cloneable primitives from the sandbox; reject objects with exotic prototypes before they reach the broker. Freeze the `api` object and never hand the sandbox a reference to the broker or to grant objects.
- **Canonicalize paths** with `realpath` *and* reject `..`/NUL, or a symlink defeats your glob check.
- **Defense in depth.** A broker bug or a QuickJS escape still leaves ambient authority, so still run the whole harness in a container/VM — exactly what pi's own docs advise. The broker shrinks the blast radius; containment caps it.
- **Audit is a feature, not overhead.** The `auditId` on every result lets the model (and you) trace which effect produced which value, and gives you a replayable record of the script's effect footprint.
- **Map `codemode.mode` to authorization, not visibility.** Instead of "declare tools vs. reach them via scripts," make the policy decide *which* capabilities get minted for a given task tier (read-only, write-to-tmp, privileged-with-approval).

If you later want the static-type version, generate the `.d.ts` above from the same `Policy` and typecheck the model's script before execution — you then catch illegal effects at compile time *and* enforce them at runtime, with one source of truth.

