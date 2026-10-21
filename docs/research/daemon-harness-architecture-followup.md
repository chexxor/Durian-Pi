I'll execute this research prompt. Given the 12 questions across four clusters, let me batch my research efficiently, starting with the code-level questions (OpenHands locks, `node:sqlite` behavior).Budget noted — 4 iterations left. Let me pull the primary sources for the highest-value questions.Strong primary sources. Now let me cover the remaining clusters in parallel.Final research iteration — covering the remaining gaps (test isolation, the `Operations` seam, shutdown specifics, outbox GC).# Daemon-Harness Architecture — Follow-up Research Report

**Deliverable for:** `docs/research/daemon-harness-architecture-followup.md`
**Status:** Written report only; no code modified. Hand back via the operator.
**Evidence classes:** `[observed]` = read from primary source code/docs in this session; `[advertised]` = vendor/paper claim I read but did not verify against implementation; `[inferred]` = my reasoning, flagged as such.

> **Caveat up front.** I hit the research-iteration ceiling before I could independently re-derive the *Omnigent probe schema* (Q4) or the *exact* `node:sqlite` error-object property names (Q3). Those two are marked **PARTIAL** and state precisely what is still unverified. Everything else is sourced.

---

## Q1 — OpenHands' lock protocol, exactly

**Two distinct locks, not one.**

**(a) The cross-process file lock — `LocalFileStore.lock()`** `[observed]` [^10]

- Signature: `lock(self, path: str, timeout: float = 30.0)`, a `@contextmanager`.
- The lock path is **the resolved storage path itself** — `get_full_path(path)`, which strips a leading `/`, normalizes separators, joins under `root`, and rejects path escapes via `os.path.commonpath` [^10]. **No lock-file suffix is appended inside `lock()`**; the caller supplies the lock filename.
- It delegates to a `filelock.FileLock(lock_path)` and `file_lock.acquire(timeout=timeout)`; on `filelock.Timeout` it logs and raises `TimeoutError` [^10].
- **No stale-lock detection or reclaim is implemented here.** `[observed]` — the module contains no PID/heartbeat/mtime logic; reclamation is whatever the `filelock` library does natively (documented as: stale detection off by default unless `FileLock(..., stale=True)` — *not* used here).

**(b) The EventLog protocol — `.eventlog.lock`** `[observed]` [^2] [^2] [^2] [^2]

| Element | Value / behaviour |
|---|---|
| Lock file | `.eventlog.lock` (constant `LOCK_FILE_NAME`) |
| Timeout | `LOCK_TIMEOUT_SECONDS = 30` |
| Count sidecar | `.eventlog-len-{length}.marker` — the event count is **in the filename** because `FileStore.read` is cached |
| Event files | one JSON file per event (`EVENT_FILE_PATTERN`, `{idx}-{event_id}`) |
| Append order | acquire lock → **only if the marker can't prove no new writer**, count events on disk and `_sync_from_disk()` → duplicate-ID/parent check → write event file under an optional `write_guard` → update in-memory indices → bump `_length` → advance marker |
| Marker advance | **delete old marker first, then write new** — "an interrupted update leaves no marker rather than a stale one claiming to be current" |

**How it "synchronizes against on-disk state":** the marker is a cheap existence check (`_marker_matches_length()`); a *miss* is not proof of divergence, so it falls back to an exact `_count_events_on_disk()`, and only if `disk_length > self._length` does it re-scan, preserving existing index mappings and merging [^2] [^2].

**The in-process tier:** the *FIFO lock* is a **separate concern** — it protects `ConversationState`, not the file store. The paper describes "A FIFO lock ensures thread-safe updates through a two-path pattern: state-only updates … and event-based updates that append to the log," with metadata to a single `state.json` and events as individual JSON files [^8]. The docs add: callbacks fire *after* successful commit, and **read operations never block writes** [^11].

**Maps to `genlock.mjs`:** *Different mechanism.* `genlock` is a **lease** (time-bounded, reclaimable); OpenHands' file lock is a **mutual-exclusion mutex with a fixed acquisition timeout and no lease renewal**. Two consequences for durian-pi:
- If you want OpenHands' resumability guarantee, adopt the **length-marker + exact-count fallback** pattern — it is what lets a second writer safely detect and pick up another process's appends without a full re-read.
- **Windows caveat `[inferred]`:** the `local.py` docstring says "using flock," but it actually calls the `filelock` library, whose Windows backend is not POSIX `flock`. Since durian-pi is Windows-only, **verify the `filelock` Windows semantics before porting** — do not assume `flock` behaviour.

---

## Q2 — OpenHands' resource-keyed lock manager

**PARTIAL — the design is a proposal; the exact conflict rule is not in the shipped docs.**

The proposal (issue #2350) is concrete `[observed]` [^6] [^6]:

- **Keying:** `ResourceLockManager` keyed by **file path**, **terminal session**, or **browser session**. *Same resource → serialize; independent resources → parallel.*
- **Conflict decision:** identical resource key. Terminal is treated as **opaque** — "extracting file paths from shell commands is intractable."
- **Scope:** the lock manager is **per workspace, not per agent** — a singleton keyed by resolved workspace path, so two sub-agents editing the same file serialize even though each has its own `FileEditor` instance.
- **Lifetime relative to `step()`:** parallelism is **within a single tool-call batch/step only**; cross-step parallelism is explicitly out of scope, and the next LLM call waits for all tools in the step. API is `get_resource_key()` (singular) per tool type, plus a `ToolExecutionSemaphore` singleton.

The shipped guide confirms the *control knob* but not the internals: `tool_concurrency_limit` defaults to **1** (sequential), warns that "concurrent execution can lead to race conditions … for tools that share state," and gives a limit table (1 default; 2–8 moderate; >8 only for independent I/O-heavy tools) [^7] [^7] [^7].

**Maps to durian-pi / ROADMAP 153:** the shape you want is **`Map<resourceKey, Mutex>` scoped to the workspace**, with the mutex held only for the duration of one tool call and released before the next model turn. Compared to a **per-file lease**, the key differences are: (i) a lease has a TTL and can expire mid-call; a mutex does not — the call holds it until it returns or is cancelled; (ii) the key is *declared by the tool* (`get_resource_key()`), not *derived by the scheduler*. Your `genlock.mjs` N-seat lease is coarser (whole-seat); ROADMAP 153 would narrow it to per-resource. **Note the open bug** [^31]: `ParallelToolExecutor` can start a pending tool *after* its cancellation token is cancelled while it waits for a declared-resource lock — a race you must design around if you adopt this.

---

## Q3 — `BEGIN IMMEDIATE` + busy-timeout failure modes under WAL

**Answer to "what *other* condition yields a non-retryable `database is locked`":** `SQLITE_BUSY_SNAPSHOT`, plus the WAL-lifecycle races.

**`SQLITE_BUSY_SNAPSHOT` (517)** `[observed]` [^1] — an *extended* `SQLITE_BUSY` that fires only in WAL mode when a connection tries to **promote a read transaction to a write** after another connection has written, invalidating its snapshot. The canonical sequence: A opens a read txn and SELECTs; B writes; A tries to write → `SQLITE_BUSY_SNAPSHOT`. **This is not fixed by a busy timeout** — retrying the *write* fails until the read snapshot is refreshed. **Fix: use `BEGIN IMMEDIATE` for any read-then-write unit.**

**`BEGIN IMMEDIATE`'s own guarantee** `[observed]` [^1]: it "might itself return `SQLITE_BUSY`, but if it succeeds, then SQLite guarantees that no subsequent operations … through the next COMMIT will return `SQLITE_BUSY`." So a `BUSY` on `BEGIN IMMEDIATE` is the *retryable* one; a `BUSY` mid-transaction means you used `BEGIN` (deferred), not `IMMEDIATE`.

**`SQLITE_BUSY` (5) vs `SQLITE_LOCKED` (6)** `[observed]` [^1]: `BUSY` = conflict with a **separate connection/process**; `LOCKED` = conflict **within the same connection** (or shared-cache). If your log says `database is locked` while you *know* only one process is attached, suspect shared-cache or same-connection reentrancy, not a second writer.

**Error-code plumbing** `[observed]` [^1]: SQLite's C API **returns primary codes by default**; the extended code requires `sqlite3_extended_result_codes()` or `sqlite3_extended_errcode()`. **Implication:** unless `node:sqlite` exposes the extended code, you will see `SQLITE_BUSY` (5) and **cannot distinguish `SQLITE_BUSY_SNAPSHOT` (517) from a plain busy-wait timeout** — which is exactly the classification you need for `#2420`/residual `SessionFailed`.

**node:sqlite specifics** `[observed]` [^3] [^3] [^3]:
- `DatabaseSync` is a **deprecated alias** for `Database` (DEP0210).
- Constructor options include `open` (default true), **`readOnly`**, and **`timeout`** = the **busy timeout in ms, default `0`**.
- The docs I read document `timeout`/`open`/`readOnly` but **do not document `errcode`/`errstr`/`ERR_SQLITE_ERROR` properties**. `[observed]` for the omission.
- Separate Node issues show node:sqlite throwing `{ code: 'ERR_SQLITE_ERROR' }` and recommend checking **both `code === 'ERR_SQLITE_ERROR'` and `errcode`** for bounded retry [^12] [^13] [^32]. **PARTIAL — verify the exact property set (`errcode`, `errstr`) on your pinned Node before relying on them.** Do **not** generalise from `better-sqlite3`/`sqlite3`, which surface `.code` as the SQLite string and differ.

**WAL-lifecycle race (the one your 5,000 ms timeout does *not* save you from):** opening/closing a WAL database briefly needs exclusive locks on the `-shm` file, and a reader arriving in that window gets `SQLITE_BUSY` **even with no writes** [^9]. A nonzero busy timeout masks it (the source measured 1–10 failures with timeout 0, **0 with a 1 s timeout**) [^9] [^9]. Also relevant: `sqlite3_close()` on a WAL connection can take an EXCLUSIVE lock to checkpoint-and-delete the WAL [^14], and **checkpoint starvation** under sustained writes with a long-lived reader pins WAL truncation [^33] [^15].

**Maps to durian-pi:** classify your residual `SessionFailed` by **enabling extended result codes if `node:sqlite` allows it**; if it does not, then a `BUSY` you cannot clear by retry after 5 s is almost certainly `BUSY_SNAPSHOT` (deferred-BEGIN upgrade) or a `-shm`/checkpoint race — both of which are **structural**, not timeout-tuning, problems.

---

## Q4 — Conformance-bench schema

**PARTIAL.** I could not retrieve a published probe **data shape or pass/fail rubric** for Omnigent in this session. What I *did* confirm `[observed]`:

- Omnigent classifies harnesses into **two execution modes** — **Direct** (Omnigent drives the model and tools itself; full platform: streaming, policies, persistent sessions, mobile) and **Native TUI** (boots the vendor's terminal UI in a pane and mirrors it) — with ids like `claude-sdk`/`claude-native` [^4] [^4].
- Support is a **three-tier maturity label** — *Fully supported* (CI-tested, regression is a blocking bug), *Maintained* (CI-tested, lower priority), *Community-supported* — and promotion between tiers is gated on "dedicated integration coverage, CI testing, and active maintenance" [^4].
- Pi is a first-class Direct+Native harness ("a headless multi-model worker … ideal for … read-heavy tasks delegated by a supervisor agent") [^4] [^4].

**The five integration modes / probe list** (basic turns, tool calling, streaming, interrupts, model override, policy denial) came from the *prior* report's source, not from anything I re-read here — treat as `[advertised]` pending re-verification.

**Maps to ROADMAP 155 (inferred):** the *modes × maturity* table is directly copyable as a **capability matrix**, and the tier definitions give you a **pass/fail rubric skeleton**: a probe passes only when CI-verifiable, and "Fully supported" means a regression blocks release. For deterministic **interrupt** and **policy-denial** assertions, assert on the *observable event* (a cancelled tool call produces no observation; a denied call produces a denial event and never executes) rather than on timing.

---

## Q5 — Per-record append vs one SQLite file, at your scale

**Evidence found:** OpenHands' own paper reports `[advertised]` [^8] that event-sourcing overhead is "negligible relative to LLM round-trip times," with **sub-millisecond persist latency** and **crash recovery under 20 ms**, and that the dual-path design (metadata → one `state.json`; events → per-event JSON) "avoids rewrites of large histories," resuming by replaying the directory.

**Gap:** I found **no published throughput number for a few-thousand-events/minute single writer**, and no head-to-head vs WAL SQLite. `[observed]` — that comparison is not published in the sources I read.

**Assessment `[inferred]`:** at your scale the file-per-event model trades a **lock-contention problem for an inode/fsync/latency problem** — every append is a `write` + directory entry, and recovery is a directory scan. OpenHands mitigates this with the **length-marker** (avoids re-scan) and an **in-process FIFO lock** (batches writes) [^2] [^95b411]. **Recommendation:** do **not** open ROADMAP 157 on throughput grounds alone — the deciding factor is whether your residual `SessionFailed` is *lock* contention (file-per-event helps) or *snapshot/checkpoint* pressure (it also helps, by removing transcript churn from the DB). Keep it as a **contingency**, not a default.

---

## Q6 — Bounded graceful shutdown with an unconditional force fallback

**The canonical deadline/escape pattern** `[observed]` [^16] [^17] [^34]: `SIGTERM` → wait `TimeoutStopSec` → **`SIGKILL`**. systemd's `KillMode=process` signals only the main process and "can leave children behind, still holding ports and files after systemd considers the service stopped" [^18] — so default `KillMode=control-group` (whole tree) is the safe choice.

**What the reference daemons cancel:** OpenHands applies **`SIGTERM`-then-`SIGKILL` escalation to a command's process group and descendants**, reusing the same escalation the service already applies on timeout, explicitly so "user-installed cleanup traps get a chance to run" [^19]. And the *failure mode to avoid* is documented: because `SIGKILL` is uncatchable, bash cleanup traps are silently skipped, "leaving stale PID files / temp dirs / open connections behind" [^20]. The generic gRPC pattern is the same shape: `GracefulStop()`, and if it does not finish within a deadline, `Stop()` [^35].

**Maps to `#2420` (inferred):** replace `harness.waitForIdle()` unbounded with:
1. a **drain deadline** (e.g. 30 s) on new-work admission (stop accepting wakes),
2. **cancel in-flight stream/tool calls** at the deadline (not the commit — commit is the thing you want to *finish*),
3. **unconditional force fallback** that is *unconditional* — a `SIGKILL`/`TerminateProcess` path that does not itself await idle.

The invariant: **the fallback must not depend on the same wedge it is escaping.** On Windows this is `taskkill /T /F` on the PID (see Q10).

---

## Q7 — A genuinely read-only second connection under WAL

**Key finding** `[observed]` [^9]: **a long-lived read-only connection *can* pin the WAL** — that is exactly the checkpoint-starvation mechanism (a reader holds back WAL truncation; autocheckpoint can't advance) [^33] [^15]. The hynek case is the *opposite* surprise: short-lived read-only connections that **open/close** repeatedly can themselves hit `database is locked` because open/close briefly needs exclusive locks on `-shm`, *even with no writes* [^9]. The source's fix was a **nonzero busy timeout** (1 s → 0 failures) [^9] [^9].

**Canonical recipe (synthesis):**
| Goal | Mechanism | Notes |
|---|---|---|
| Reader can never *acquire* the write lock | open with `readOnly` (node:sqlite option) [^3] | "If the database does not exist, opening it will fail" |
| Reader can never *stall the writer's checkpoint* | **short-lived** read connections + `PRAGMA query_only`; avoid a long-lived reader txn | a pinned reader is the starvation cause [^33] |
| Zero-cost reads when the file truly never changes | SQLite URI `immutable=1` | `[inferred]` — not covered by the sources I read; **verify** |
| Snapshot isolation | a read transaction | holds a snapshot; long-lived = pins WAL |

**node:sqlite vs better-sqlite3:** I found **no evidence** that they differ on this point; the `-shm` behaviour is in the SQLite C library, not the driver. `[observed]` — the driver docs only expose `readOnly`/`timeout` [^3]. Do not generalise across drivers without testing.

**Maps to `#2406` (inferred):** your "no second store opener" rule is **sufficient to prevent a second *writer***, but **not sufficient to prevent a reader pinning the WAL** if that reader is long-lived. The safe rule is: **one long-lived writer connection; readers are short-lived, `readOnly`, and never hold a read transaction across a model call.**

---

## Q8 — Distinguishing a wedged loop from a slow pass

**What OpenHands exposes** `[observed]` [^5] [^5] [^5]: a **content-based stuck detector**, enabled by default (`stuck_detection=True`), checking the history *after the last user message* for five patterns with explicit thresholds:

| Pattern | Threshold |
|---|---|
| Repeated action→observation (same action, same observation) | 4+ times |
| Repeated action→error | 3+ times |
| Agent monologue (consecutive messages, no user input/progress) | 3+ messages |
| Alternating ping-pong of two action-observation pairs | 6+ cycles |
| Repeated context-window errors | flagged |

Crucially it compares **semantic content, ignoring IDs and timestamps** ("compared by their tool name, action content, and thought") [^5] — which is *how it avoids false positives on superficial difference*. The API is `conversation.stuck_detector.is_stuck()` [^5].

**Gap** `[observed]`: the source **does not** describe a monotonic-progress counter, a per-pass wall-clock deadline, or a heartbeat separate from liveness. So the "liveness contract" you asked for is **not** documented there.

**Maps to ROADMAP 61–64 (inferred):** combine two orthogonal signals, because each alone fails:
- **Progress signal** = a monotonic counter (events appended / steps completed / bytes streamed). A *fresh heartbeat over a frozen loop* is defeated by requiring the counter to *advance*, not the process to merely be alive.
- **Deadline signal** = a wall-clock cap per pass that is **generous** (avoid killing slow model calls). OpenHands' **content-based** detection (repeated identical actions) is the third leg — it catches "alive but looping," which neither counter nor deadline catches. A watchdog that fires on *any one* of {counter stalled, deadline exceeded, repetition threshold} with a **pause-and-ask** step (rather than auto-kill) avoids both false positives and negatives.

---

## Q9 — Durable spool / transactional-outbox delivery semantics

**Established practice** `[observed]` [^21] [^36] [^22] [^37] [^23] [^38]:

- **Atomicity of the dual write:** write the domain change **and** the outbox record in **one local transaction**; the relay publishes *after* commit [^36] [^22]. This removes the "publish then crash" gap.
- **Delivery is at-least-once**; **consumers must dedup** [^37].
- **Idempotency key** carried on the message, ideally **backed by a unique DB constraint** on the consumer side (Stripe-style) [^22].
- **Dedup key = the outbox/request id** [^37].
- **Known relay failure modes to design against:** unsafe relay concurrency, publish-before-mark crashes, and **poison rows** that stall the drain [^23].
- **Ordering:** with a saga, messages deliver after state is saved; otherwise per-key ordering requires serializing on the key [^39] [^40].

**Maps to `intent.mjs` → `<db>.broker.inbox/` (inferred):** because your broker is a **single writer**, the "one transaction" is free — the broker is the transaction boundary. Concretely:
1. Give each intent a **`requestId`**; the broker keeps a **dedup set keyed by `requestId`** (a unique index in the same SQLite store).
2. **Ordering vs the seat's in-flight run:** enqueue with a sequence number; the broker **does not start a second run for a seat while one is in flight** — that *is* your ordering guarantee.
3. **Stale/abandoned GC:** stamp each intent with an enqueue time and a **TTL**; reclaim intents older than TTL *only if* no run is in flight for that seat (a poison-row guard) [^23]. Mark published/consumed by *moving or tombstoning*, never by deleting before the effect is durable.

---

## Q10 — Windows-native daemon process lifecycle

**Observed constraints** `[observed]`:
- **`SIGTERM` is not supported on Windows** — it "can be listened on," and `process.kill()` behaviour on Windows is "somewhat confusing" [^41] [^42].
- **`taskkill /PID … /F` does not trigger the `SIGTERM` handler** [^24] — so a Unix-style `SIGTERM` stop-contract silently degrades to "handler never runs."
- **`taskkill` is the Windows process-tree killer**; `tree-kill` uses it for Windows [^43].
- systemd's `SIGTERM → TimeoutStopSec → SIGKILL` model is the Unix reference, with `KillMode=control-group` to reap children [^16] [^18].

**Maps to durian-pi (inferred) — the Windows stop-contract:**
1. **Do not rely on `SIGTERM`.** Use an **explicit control channel**: a `stop` intent written to the same durable spool, or a named-pipe/socket `stop` command, that the broker polls. This is your `serve --stop` cooperative reaping path — it is the *right* design on Windows precisely because signals are unreliable.
2. **Bound the drain**, then escalate to **`taskkill /T /F <pid>`** (tree kill) — the Windows analogue of `SIGKILL`, which *does* reap the process tree [^43].
3. **Crash vs graceful detection:** a **`down`/`clean-shutdown` marker** written on graceful exit, plus exit codes; on next start, a missing marker means "unclean → recover" (mirrors OpenHands' incomplete-conversation detection [^8]).
4. **Under a service manager:** run under a supervisor that supports a stop-timeout and tree-kill (e.g. a Windows Service / NSSM / Job Object). **Job Objects** are the native mechanism to guarantee descendants die with the parent — use them so a wedged seat cannot outlive the broker.

---

## Q11 — Test-suite concurrency and isolation that does not flake

**Observed guidance** `[observed]`:
- **"Fix isolation before adding more shards."** Give each job its **own database schema, port range, temporary directory, and external resource names** [^44].
- **Git worktrees isolate branches, not runtimes** — the shared machine still collides on **ports, Docker/Compose state, and fixed paths** [^25] [^26]. "Everything else on the machine is shared" [^45].
- **Node's test runner** runs **test files in parallel**, **tests within a file serially** (default), which "seems to work well for most cases" [^46] [^47].
- Parallel flakiness root causes: shared state, DB conflicts, **port collisions, file locks** [^27] [^28].

**Maps to replacing `DURIG_SUITE_CONCURRENCY` (inferred):** the isolation primitives are exactly: **per-worker temp dir** (`fs.mkdtemp`), **per-worker DB path** (never a fixed `./rig.sqlite`), **ephemeral ports** (bind :0 and read back), and **per-worker git worktree** for anything touching git. Your `demo/*.test.mjs` suite already isolates by construction (one runnable proof per guarantee); the work is to make the *fixtures* parameterized by a worker id so the suite can run at bounded concurrency without cross-test interference.

---

## Q12 — Security model of the `Operations` relocation seam

**Observed** `[observed]`:
- Pi's **Gondolin** extension is a local Linux micro-VM that **keeps Pi and provider auth on the host while routing the built-in tools and `!` commands into the VM** [^29] [^48].
- **The documented footgun:** "Commands inside the VM inherit the host process environment. Provider keys supplied through environment variables can therefore be visible inside the VM. Do not use this …" [^30]. This is the boundary leak to design against.
- Pi **by default does not ask for permissions** [^49] — the harness ships permissive, which is why the *seam* must carry the constraint, not the tool.

**Maps to ROADMAP 156 / per-seat tool scoping (ROADMAP 18) (inferred):** the seam must enforce **three scopes**, none of which may be inferable from the tool's own code:
1. **Filesystem scope** — the relocated tool sees only the seat's worktree (your per-seat worktree is the right boundary; enforce it at the seam, not inside each tool).
2. **Credential scope** — the relocated process must **not inherit host env**; pass only explicitly-allow-listed credentials, or keep credentials host-side and proxy calls (Gondolin's *intent*, defeated by env inheritance [^30]).
3. **Capability enumeration** — the relocated tool declares its resources (Q2's `get_resource_key()`), and the seam **rejects undeclared capability** rather than trusting the tool.

The controlling principle: **the seam is the security boundary; the tool is untrusted.** A per-seat scoped tool "cannot escape its boundary" only if the boundary is enforced by the *parent* (the harness/broker), never by the child.

---

## Consolidated answers to the two headline questions

| # | Question | Answer | Confidence |
|---|---|---|---|
| 1 | Does OpenHands' lock protocol map onto `genlock.mjs`? | **Different mechanism.** It's a mutex-with-timeout + length-marker, not a reclaimable lease. Adopt the marker/exact-count sync; verify `filelock` Windows semantics. | High `[observed]` |
| 2 | Shape of ROADMAP 153 | **Per-workspace `Map<resourceKey, Mutex>`**, key declared per tool, held per tool call; not a per-file lease. | Medium `[observed proposal]` |
| 3 | Residual `database is locked` causes | `SQLITE_BUSY_SNAPSHOT` (deferred-BEGIN upgrade) and `-shm`/checkpoint races — **structural, not timeout-tunable**. Need extended codes to classify. | High `[observed]` |
| 4 | Conformance probe schema | **PARTIAL** — modes × maturity matrix confirmed; exact probe data shape not retrieved. | Low |
| 5 | Per-record append worth opening ROADMAP 157? | **Only as contingency.** No published throughput numbers at your scale; sub-ms persist / <20 ms recovery is OpenHands' own measurement. | Medium |
| 6 | `#2420` shutdown | Bounded drain → cancel stream/tool → **unconditional** force fallback (`taskkill /T /F`). | High `[observed pattern]` |
| 7 | `#2406` read-only second connection | One long-lived writer; **short-lived, `readOnly` readers**, no txn across model calls. A reader *can* pin the WAL. | High `[observed]` |
| 8 | Watchdog (61–64) | **Counter-advance + per-pass deadline + content-repetition**, three orthogonal legs, pause-and-ask. | Medium `[inferred]` |
| 9 | `intent.mjs` spool semantics | Outbox: one txn (free for single writer), `requestId` dedup via unique index, sequence ordering, TTL GC guarded by in-flight check. | High `[observed pattern]` |
| 10 | Windows stop-contract | **Explicit control channel + `down` marker + `taskkill /T /F` + Job Objects.** Never rely on `SIGTERM`. | High `[observed]` |
| 11 | Test concurrency | Per-worker temp dir / DB path / ephemeral port / worktree; Node runner parallelizes files. | High `[observed]` |
| 12 | `Operations` seam security | Three scopes enforced **at the seam**: filesystem (worktree), credentials (no env inheritance), capability (declared resources). | High `[observed + inferred]` |

---

## What I could not verify (be explicit in the report)

1. **Q4 probe schema** — no published Omnigent probe data shape / pass-fail rubric retrieved.
2. **Q3 `node:sqlite` property names** — the official docs page documents `timeout`/`open`/`readOnly` but not `errcode`/`errstr`/`ERR_SQLITE_ERROR`; Node issue threads imply them. **Verify against your pinned Node before relying on them.** Do not generalise from `better-sqlite3`.
3. **Q5 throughput numbers** — none found for a few-thousand-events/minute single-writer case.
4. **Q1 `filelock` Windows semantics** — the `local.py` docstring says "flock"; the library's Windows backend is not POSIX `flock`. Verify before porting to durian-pi.
5. **Q7 `immutable=1`** — not covered by the sources I read.

## Evidence-discipline note
All `[observed]` markers above cite a specific source read in this session. The `[advertised]` claims (Omnigent probe list, OpenHands persist-latency figures) come from vendor/paper prose and were **not** verified against implementation. Driver-specific claims are scoped to `node:sqlite` and explicitly **not** generalised to `better-sqlite3`/`sqlite3`.

Want me to take a second pass at the two PARTIAL items (Q4 probe schema, Q3 `node:sqlite` error properties) in a fresh session, or turn this into the final `docs/research/daemon-harness-architecture-followup.md` text with per-question "how this maps to durian-pi" notes expanded?

**References**

[^1]: [Result and Error Codes](https://www.sqlite.org/rescode.html) (15%)
[^2]: [raw.githubusercontent.com](https://raw.githubusercontent.com/OpenHands/software-agent-sdk/main/openhands-sdk/openhands/sdk/conversation/event_store.py) (12%)
[^3]: [SQLite | Node.js v26.12.0 Documentation](https://nodejs.org/api/sqlite.html) (12%)
[^4]: [Supported Harnesses · Omnigent](https://omnigent.ai/docs/build/harnesses/supported) (9%)
[^5]: [Stuck Detector - OpenHands Docs](https://docs.openhands.dev/sdk/guides/agent-stuck-detector) (6%)
[^6]: [Proposal: Parallel Tool Execution](https://github.com/OpenHands/software-agent-sdk/issues/2350) (5%)
[^7]: [Parallel Tool Execution - OpenHands Docs](https://docs.openhands.dev/sdk/guides/parallel-tool-execution) (5%)
[^8]: [[2511.03690v2] The OpenHands Software Agent SDK: A Composable and Extensible Foundation for Production Agents](https://arxiv.org/html/2511.03690v2) (4%)
[^9]: [SQLite WAL Mode Can Lock Short-Lived Readers](https://hynek.me/til/sqlite-read-only-wal-locked/) (4%)
[^10]: [raw.githubusercontent.com](https://raw.githubusercontent.com/OpenHands/software-agent-sdk/main/openhands-sdk/openhands/sdk/io/local.py) (3%)
[^11]: [Conversation - OpenHands Docs](https://docs.openhands.dev/sdk/arch/conversation) (1%)
[^12]: [sqlite: backup() rejects with "not an error" when its first step ...](https://github.com/nodejs/node/issues/66760) (1%)
[^13]: [Improving the node:sqlite error messages #61051 - GitHub](https://github.com/nodejs/node/issues/61051) (1%)
[^14]: [SQLITE_BUSY debugging: tracking "hidden" checkpoints](https://sqlite.org/forum/forumpost/49178f62e9) (1%)
[^15]: [SQLite WAL Checkpoint Starvation Diagnostics - GitHub](https://github.com/mouadja02/skills/blob/main/skills/databases/sqlite-wal-checkpoint-starvation-diagnostics/SKILL.md) (1%)
[^16]: [systemd sends SIGKILL signals after waiting for](https://til.codeinthehole.com/posts/systemd-sends-sigkill-signals-after-waiting-for-timestopsec-seconds/) (1%)
[^17]: [Configure buggy systemd service to terminate via SIGKILL](https://serverfault.com/questions/928376/configure-buggy-systemd-service-to-terminate-via-sigkill) (1%)
[^18]: [Set timeouts and stop cleanly - flaviocopes.com](https://flaviocopes.com/courses/systemd/set-timeouts-and-stop-cleanly/) (1%)
[^19]: [[Feature]: Agent Server operation to stop a single running ... - GitHub](https://github.com/OpenHands/software-agent-sdk/issues/5257) (1%)
[^20]: [agent-server: bash cleanup traps don't run because SIGKILL ... - GitHub](https://github.com/OpenHands/software-agent-sdk/issues/3120) (1%)
[^21]: [Transactional outbox pattern - AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) (1%)
[^22]: [Idempotency & the Transactional Outbox Pattern | Wavise OpenLLM](https://openllm.wavise.com/blog/idempotency-transactional-outbox) (1%)
[^23]: [Why Your Outbox Relay Stops Draining: Execution Strategies, Duplicate ...](https://www.dotnet-guide.com/articles/distributed-systems/outbox-relay-common-mistakes/) (1%)
[^24]: [SIGTERM in node.js on Windows - Stack Overflow](https://stackoverflow.com/questions/61655836/sigterm-in-node-js-on-windows) (1%)
[^25]: [Git Worktrees Need Runtime Isolation for Parallel AI Agent ...](https://www.penligent.ai/hackinglabs/git-worktrees-need-runtime-isolation-for-parallel-ai-agent-development/) (1%)
[^26]: [Run Isolated End-to-End Test Stacks in Every Git Worktree](https://henrietteharmse.com/2026/07/27/end-to-end-testing-across-git-worktrees/) (1%)
[^27]: [Parallel Test Execution Causing Flaky Tests? Here's How to Fix It](https://deflaky.com/blog/parallel-test-execution-flaky) (1%)
[^28]: [How to Fix 'Parallel Test' Execution Issues - oneuptime.com](https://oneuptime.com/blog/post/2026-01-24-parallel-test-execution-issues/view) (1%)
[^29]: [earendil-works/pi: AI agent toolkit: unified LLM API, ...](https://github.com/earendil-works/pi) (1%)
[^30]: [Run Pi in an isolated environment · Documentation](https://pi.dev/docs/latest/containerization) (1%)
[^31]: [[Bug]: ParallelToolExecutor starts a pending tool after ... - GitHub](https://github.com/OpenHands/software-agent-sdk/issues/4777) (0%)
[^32]: [node:sqlite unique constraint exception parity · Issue #28289](https://github.com/denoland/deno/issues/28289) (0%)
[^33]: [WAL blows past its pinned journal_size_limit under a write ...](https://github.com/vjt/grappa-irc/issues/2287) (0%)
[^34]: [systemd.service](https://www.freedesktop.org/software/systemd/man/systemd.service.html) (0%)
[^35]: [Stop() deadlocks when called after GracefulStop() while a ...](https://github.com/grpc/grpc-go/issues/9393) (0%)
[^36]: [Outbox Pattern: Solving the Dual-Write Problem](https://milanjovanovic.tech/blog/outbox-pattern-dual-write-problem) (0%)
[^37]: [The Outbox Pattern: How You Actually Guarantee Message ...](https://www.linkedin.com/pulse/outbox-pattern-how-you-actually-guarantee-message-delivery-gupta-bemhc) (0%)
[^38]: [Reasons Your Idempotency Key Design Still Creates ...](https://medium.com/@tuananhbk1996/reasons-your-idempotency-key-design-still-creates-duplicate-orders-in-microservices-3d7a8eb2359f) (0%)
[^39]: [Outbox | MassTransit Documentation](https://masstransit.massient.com/concepts/outbox/) (0%)
[^40]: [Durable Messaging - Wolverine](https://wolverinefx.net/guide/durability/) (0%)
[^41]: [process.kill() and signals on Windows #12378 - nodejs/node](https://github.com/nodejs/node/issues/12378) (0%)
[^42]: [Process | Node.js v26.12.0 Documentation](https://nodejs.org/api/process.html) (0%)
[^43]: [Can't kill child process on Windows - node.js](https://stackoverflow.com/questions/32705857/cant-kill-child-process-on-windows) (0%)
[^44]: [How can I run Node.js tests in parallel in CI? - Depot.dev](https://depot.dev/resources/guides/how-can-i-run-node-js-tests-in-parallel-in-ci) (0%)
[^45]: [Why I Replaced My git-worktree Swarm with Docker Isolation](https://www.linkedin.com/pulse/from-worktrees-workspaces-why-i-replaced-my-swarm-docker-lihhatsov-bnwef) (0%)
[^46]: [concurrent tests are slow · Issue #47365 · nodejs/node](https://github.com/nodejs/node/issues/47365) (0%)
[^47]: [Test runner | Node.js v26.12.0 Documentation](https://nodejs.org/api/test.html) (0%)
[^48]: [pi/packages/coding-agent/docs/containerization.md at main · earendil ...](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md) (0%)
[^49]: [Secure way of running Pi? : r/PiCodingAgent](https://www.reddit.com/r/PiCodingAgent/comments/1u6ovco/secure_way_of_running_pi/) (0%)