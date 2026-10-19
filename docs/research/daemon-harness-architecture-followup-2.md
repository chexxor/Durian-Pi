I'll research these four narrow questions. Let me start with parallel searches on the most tractable ones.Now let me pull the primary sources for each question.I have strong material. Let me fill the remaining gaps: Omnigent's design doc (exact schema), filelock stale-lock semantics, and file-per-record throughput.One more targeted batch to firm up Q2 (network filesystems) and Q4 (file-per-record throughput).# Daemon-Harness Architecture — Follow-up Research Round 2

**Deliverable for:** `docs/research/daemon-harness-architecture-followup-2.md`
**Status:** Written report only; no code modified. Hand back via the operator.
**Evidence classes:** `[observed]` = read directly from the primary source in this session; `[advertised-elsewhere]` = a claim from vendor/paper prose I did not verify against implementation. Driver-specific and OS-specific claims are scoped and not generalised.

---

## Q1 — Omnigent's conformance-probe schema and rubric

**Sources:** Omnigent's own design doc, `docs/harness-bench-design.md` `[observed]` [^1], and the DeepWiki summary of `tests/harness_bench/` `[observed]` [^2].

### Data shape

The bench splits into three object kinds `[observed]` [^1] [^1]:

| Object | What it holds | Who provides it |
|---|---|---|
| **`BenchProfile`** | Harness metadata the bench *cannot infer*: a test model (or family), the CLI binary to skip-gate on, the transport class, and the static matrix columns (Owner, Auth method, Implementation, "inherits preexisting configs", priority tier). `env_prefix` (`HARNESS_<NAME>_`) and `marker` (`<NAME>_BENCH_OK`) are **derived by convention**, not authored. | Self-declared per harness |
| **Behavioral probes** | Harness-agnostic. Each creates a session, runs a turn, and inspects a **generic event stream** — `TextChunk`, `ReasoningChunk`, `ToolCallRequest`, `TurnComplete`, and elicitation events. A probe "never names a harness." | Shared, free |
| **Transport drivers** | Own the transport mechanism and expose **semantic methods** (`run_basic_turn`, `run_tool_turn`, `run_policy_turn`, `run_interrupt_turn`). Probes interpret a **common `TurnResult`**. | Per transport class |

The only concrete result shape shown is illustrative `[observed]` [^1]:

```python
async def run(self, driver, profile) -> ProbeResult:
    deltas = await driver.count_text_chunks("Write a 3-sentence story.")
    observed = SUPPORTED if deltas > 1 else PARTIAL   # "complete-only"
    return ProbeResult(observed, note=f"{deltas} text chunks",
                       drift=reconcile(observed, self.declared(profile)))
```

**Explicit gap `[observed]`:** the design doc gives this *illustrative* shape but **does not spell out the complete field schema for `BenchProfile`, `TurnResult`, or `ProbeResult`** [^1]. That is the missing input to ROADMAP 155 — you would have to read `tests/harness_bench/` source to recover the full field set.

### Pass/fail rubric

Verdict vocabulary `[observed]` [^1] [^2]:

| Verdict | Meaning |
|---|---|
| `SUPPORTED` | probe ran, behavior confirmed |
| `UNSUPPORTED` | probe ran, capability absent (and expected absent) |
| `PARTIAL` | works with caveats (e.g. "TUI-only", "hook-DENY only") |
| `NOT_APPLICABLE` | dimension does not apply |
| `UNKNOWN` | never probed / no probe written yet |
| `SKIPPED` | CLI / creds / transport unavailable in this environment |
| `DRIFT` | observed verdict disagrees with the declared flag/manifest |

Each dimension carries a **`P0`/`P1` priority**; **CI gates P0 and merely reports P1** [^1] [^1]. Every behavioral probe also reads its declared flag and returns `DRIFT` on disagreement [^1].

### Per-dimension rubric (the six you asked about)

From the design doc's "Behavioral (proven by a live turn)" table `[observed]` [^1], cross-checked against the DeepWiki priority table `[observed]` [^2]:

| Dimension | Priority | How the probe proves it |
|---|---|---|
| Basic turn | P0 | complete a marker-echo turn and require assistant text |
| Streaming | P0 | count output-text deltas; **repeated single-delta output is `PARTIAL`** |
| Tool calling | P0 | provoke the transport's tool mechanism and require a surfaced call |
| Policy DENY | P0 | apply a tool-call deny and require a **blocked-call signal** |
| Model override | P0 | validate the requested harness/model pair and complete a turn |
| Interrupt | P0 | interrupt a long turn and require **cancellation or early termination** |

### How interrupt and policy denial are asserted deterministically

This is the crux, and the answer is **partially specified**:

- **Determinism mechanism `[observed]`:** both test suites "extensively use a **mock LLM server for deterministic testing**" [^2]. That is what makes the trigger reproducible — the model's output (and therefore turn length) is scripted.
- **Interrupt `[observed]`:** the stated criterion is *"interrupt a long turn and require cancellation or early termination"* [^1]. The `NativeTuiDriver` "observes native SSE events including … turn interruption" [^2]. **The doc does not give a more specific timeout, synchronization protocol, or exact event/result field for the interrupt assertion** [^1].
- **Policy DENY `[observed]`:** criterion is *"a tool-call deny plus a blocked-call signal"* [^1]. Per transport:
  - `full-server`: a **fixed policy blocks a builtin**; the driver observes ALLOW/ASK/DENY policies [^1].
  - `native-tui`: a **session CEL policy triggers the native policy hook**; DENY is observed via the native policy hook [^1].
  - `sdk-inproc`: **policy is not observable** — policy-denial/tool-call policy verdicts are partial due to wrapping limitations [^1] [^2].

**Explicit gap `[observed]`:** the doc identifies the *mechanism* and *expected signal* but **does not specify the exact blocked-signal payload/schema** [^1], nor the exact interrupt event field. So the deterministic *assertion surface* is "the observable native SSE / session event", but the byte-level payload is not published.

> **For ROADMAP 155:** the copyable parts are the **three-object split** (declared profile / harness-agnostic probe / transport driver), the **seven-verdict vocabulary with P0-gates-CI**, and the **mock-LLM-for-determinism** rule. To assert interrupt and denial you assert on the *observable session event* (a cancelled turn produces no `TurnComplete`; a denied call produces a denial event and never executes) — but you will have to define your own payload schema, because Omnigent's is not published.

---

## Q2 — `filelock`'s Windows locking semantics

**Sources:** the `filelock._windows` module source `[observed]` [^3] [^3] [^3], the filelock docs `[observed]` [^4] [^4], and the filelock "Concepts and design" page `[observed]` [^8].

### What primitive

`FileLock` on Windows is `WindowsFileLock`, which **"Uses `LockFileEx` to hard lock a byte range of the lock file"** [^3]. The implementation calls `_kernel32.LockFileEx(msvcrt.get_osfhandle(fd), flags, 0, 1, 0, ...)` with `_LOCKFILE_EXCLUSIVE_LOCK | _LOCKFILE_FAIL_IMMEDIATELY` over **a one-byte range at offset 0** [^3].

- **It is `LockFileEx`, not `msvcrt.locking`.** Note a **discrepancy in the secondary literature**: OpenHands' docstring says "flock" and the DeepWiki page says the library uses "platform-specific system calls through the `msvcrt` module" [^11]. The primary source is explicit: the primitive is the Win32 `LockFileEx` API invoked via `ctypes`, over the CRT file descriptor. The lock is **kernel-enforced** [^4].
- **Release:** `UnlockFileEx` on release; the descriptor is retained until the unlock commits, then closed and the lock file unlinked [^3].

### Stale detection when the holder dies

- **The native `LockFileEx` lock needs no stale detection.** Windows byte-range locks are **automatically released when the process terminates** [^11], and Microsoft's own `LockFileEx` docs state that a process terminating with a portion of a file locked releases it [^9]. The `_windows` source contains **no stale-lock scanning** and does not discuss a holder dying — because it does not need to [^3].
- **Stale reclaim exists only in the *soft* fallback**, which is a different class. `SoftFileLock` is a "cooperative file-existence marker" that does **same-host PID inspection** and "**Reclaims a provably-gone owner via process start identity**"; `StrictSoftFileLock` "**never guesses that an owner died**" [^4]. On other platforms, `FileLock` falls back to this soft marker protocol [^4].
- One known failure mode to be aware of if you ever depend on release: filelock issue #600 notes that if the native release itself fails, state is cleared before the lock is released, and "the reliable fallback is process termination, which lets the OS close the leaked descriptor and release any remaining native lock" [^12].

### Network / synced filesystems

- **filelock's own docs are the answer:** *"The lock is exclusive and works reliably on local filesystems. Network filesystem (SMB) support is available but considered less reliable."* [^8]. The lock-type guidance likewise says to "**Verify shared-filesystem semantics before deployment**" for the soft marker [^4].
- Windows-specific hazard: a security advisory notes that on Windows, soft-marker acquire/reclaim calls "**waits for an oplock**," which is the mechanism by which synced/network filesystems can misbehave [^13].

> **For durian-pi (only relevant if ROADMAP 157 opens):** on a **local** Windows filesystem this is *simpler* than your lease, not more complex — `LockFileEx` is kernel-enforced and **released on process death, so no stale-reclaim logic is required** (contrast your `genlock.mjs` TTL leases). Do **not** deploy it against a synced/network path — filelock itself rates SMB "less reliable" [^8].

---

## Q3 — `immutable=1` for a snapshot reader under WAL

**Source:** SQLite URI-filename documentation `[observed]` [^6].

**The promise.** `immutable=1` "signals to SQLite that the underlying database file is held on read-only media and cannot be modified, even by another process with elevated privileges. SQLite always opens immutable database files read-only and it **skips all file locking and change detection**" [^6].

**The failure mode — stated explicitly by SQLite:**

> "If this query parameter … asserts that a database file is immutable and that file **changes anyhow**, then SQLite **might return incorrect query results and/or `SQLITE_CORRUPT` errors**." [^6]

**Verdict for `#2406`.** `immutable=1` is **not safe and not correct** for a read-only connection to a database another process is still writing under WAL. It is explicitly intended for offline/copied/read-only-media databases. A live WAL writer *is* the "changes anyhow" case, and the documented consequences are stale/incorrect results and possible `SQLITE_CORRUPT` errors [^6].

The correct read-seam choice remains the one from the first round: a **`readOnly` connection without `immutable`**, short-lived, never holding a read transaction across a model call. `immutable=1` should be reserved for genuinely frozen snapshots (e.g. a copied DB file or read-only media).

---

## Q4 — Append throughput at your scale

**Sources:** Horn's benchmark as tabulated by Sesame Disk `[advertised-elsewhere]` [^5], a sysbench fsync-throughput example `[advertised-elsewhere]` [^10], Turso's write-concurrency post `[advertised-elsewhere]` [^14], and a Stack Overflow insert benchmark `[advertised-elsewhere]` [^7].

**Direct answer: I found no published benchmark for a one-file-per-record, append-only store at a few thousand records/minute on a single Windows host, and none head-to-head against WAL SQLite.** That specific figure does not appear to exist in the sources I could reach; I am stating that explicitly rather than inferring one.

What I *can* give is reference points and an order-of-magnitude argument:

| Configuration | Measured figure | Source class |
|---|---|---|
| SQLite WAL, `synchronous=NORMAL`, one insert per autocommit txn | **~33,135 inserts/sec** | `[advertised-elsewhere]` [^5] |
| SQLite WAL, `synchronous=FULL` | ~442 inserts/sec | `[advertised-elsewhere]` [^5] |
| SQLite DELETE journal, `synchronous=FULL` (default-ish) | ~279 inserts/sec | `[advertised-elsewhere]` [^5] |
| SQLite inserts (rows), prepared/transactional | ~23,000 inserts/sec | `[advertised-elsewhere]` [^7] |
| SQLite inserts (rows), Turso's measurement | 150k rows/sec; 80k with 1 ms compute | `[advertised-elsewhere]` [^14] |
| `fsync()` calls per second (sysbench example on a VM) | **~3,534 fsyncs/sec** | `[advertised-elsewhere]` [^10] |

**Order-of-magnitude reasoning (my analysis, `[inferred]`).** "A few thousand records/minute" is **~50 records/sec**. That is roughly **two to three orders of magnitude below** the ~3,500 fsync/sec figure and ~three orders below the ~33k inserts/sec WAL figure. A one-file-per-record store's cost is dominated by **fsync latency plus directory-entry operations**, not by raw byte volume; even pessimistically (say one fsync per record, plus a directory update), ~50 records/sec sits far under the fsync ceiling measured above [^10].

**Conclusion `[inferred]`:** at your stated scale, **throughput is not a deciding factor between per-record files and WAL SQLite** — both are comfortable. Therefore ROADMAP 157 should **not** be opened on throughput grounds. (The real reasons to consider it, from round 1, are *lock-contention relief* and *removing transcript churn from the SQLite write lock* — not speed.) Any final decision should be validated on your own NTFS volume, since the fsync ceiling is storage- and Defender-dependent `[advertised-elsewhere]` [^10].

---

## What could not be answered

1. **Q1 — full field schemas.** The design doc gives an *illustrative* `ProbeResult` shape but not the complete field set for `BenchProfile` / `TurnResult` / `ProbeResult`, nor the exact interrupt-event or blocked-call-signal payload. Recover by reading `tests/harness_bench/` source [^1] [^1].
2. **Q4 — no direct file-per-record benchmark at your scale.** Stated explicitly; only proxy reference points found.

## Evidence-discipline note
All `[observed]` claims cite a source read in this session. `[advertised-elsewhere]` figures (Horn/Sesame Disk, Turso, Stack Overflow, sysbench example) are third-party measurements not independently reproduced here. Windows locking behaviour is cited only for Windows (`LockFileEx`); Unix `flock` behaviour is not generalised to Windows, and `node:sqlite` behaviour is not generalised to other drivers. Note the secondary-source discrepancy on Q2 (docstring/DeepWiki say "flock"/"msvcrt"; the primary `_windows` source shows `LockFileEx` via `ctypes`) — I have reported the primary source.

**References**

[^1]: [raw.githubusercontent.com](https://raw.githubusercontent.com/omnigent-ai/omnigent/main/docs/harness-bench-design.md) (35%)
[^2]: [End-to-End & Harness Bench Tests | omnigent-ai/omnigent | DeepWiki](https://deepwiki.com/omnigent-ai/omnigent/11.2-end-to-end-and-harness-bench-tests) (25%)
[^3]: [filelock._windows - filelock](https://py-filelock.readthedocs.io/en/stable/_modules/filelock/_windows.html) (13%)
[^4]: [filelock Contents Menu Expand Light mode Dark mode Auto light/dark, in light mode Auto light/dark, in dark mode](https://py-filelock.readthedocs.io/en/latest/index.html) (6%)
[^5]: [Performance Tuning SQLite for High-Throughput Applications - Sesame Disk](https://sesamedisk.com/sqlite-performance-tuning-high-throughput/) (5%)
[^6]: [Uniform Resource Identifiers](https://sqlite.org/uri.html) (3%)
[^7]: [Improve INSERT-per-second performance of SQLite - Stack Overflow](https://stackoverflow.com/questions/1711631/improve-insert-per-second-performance-of-sqlite) (3%)
[^8]: [Concepts and design - filelock - Read the Docs](https://py-filelock.readthedocs.io/en/latest/concepts.html) (2%)
[^9]: [LockFileEx function (fileapi.h) - Win32 apps](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex) (2%)
[^10]: [How to Use ‘Sysbench’ to Measure the Speed of Data Reads/Writes on ...](https://webhostinggeeks.com/howto/use-sysbench-measure-speed-data-reads-writes-linux/) (2%)
[^11]: [Windows File Locking | tox-dev/filelock | DeepWiki](https://deepwiki.com/tox-dev/filelock/2.2.2-windows-file-locking) (1%)
[^12]: [Native release failure clears state before the lock is released #600](https://github.com/tox-dev/filelock/issues/600) (1%)
[^13]: [On Windows an oplock on a soft lock's marker holds ... - GitHub](https://github.com/tox-dev/filelock/security/advisories/GHSA-567q-5qvw-pf92) (1%)
[^14]: [Beyond the Single-Writer Limitation with Turso's ...](https://turso.tech/blog/beyond-the-single-writer-limitation-with-tursos-concurrent-writes) (1%)