# agent-fleet vs durig — architecture comparison and the adopt-or-build question

**Date:** 2026-10-12 · **Read at:** `vendor/eval/agent-fleet` HEAD `7c34dde`
(MIT, `@chankov/agent-fleet@2.0.17`) · **Sources:** that repo's `README.md`,
`docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `docs/workflows.md`,
`docs/getting-started.md`, `docs/MIGRATION-agent-fleet.md`.

**The question (operator):** *if agent-fleet accomplishes all our goals, should we
use it instead of continuing to build durig on pi-durable?*

**Short answer.** It does **not** accomplish all our goals, and the reason is
structural, not a maturity gap: the two projects sit at **different layers**.
agent-fleet is a pi-**coding-agent** harness + methodology; durig is a pi-**durable**
substrate. Replacing durig with agent-fleet would trade away the durable
queue/audit/restart guarantees durig exists to provide. What is worth doing is
**borrowing** several of agent-fleet's mechanisms. Details and evidence below.

---

## 1. Layer map — the decisive fact

| | agent-fleet | durig |
|---|---|---|
| Runtime layer | **pi-coding-agent**: harnesses (`.pi/harnesses/`), extensions, prompts, personas | **pi-durable**: durable conversations, durable tasks, typed documents over SQLite |
| Unit of work | a **dispatch** to a specialist pi session (in-process child, or a `herdr` peer pane) | a **queue item** (a typed document) with an append-only transition trail |
| Coordination | hub dispatcher + `coms` P2P messaging + `herdr` panes | a durable cross-seat queue + Router tools (`send_work`/`claim_work`/`complete_work`/`defer_work`/…) |
| Durability | pi session JSONL (authoritative, append-only) + on-disk findings/contracts + `herdr` snapshot/resume | `harness.resume()` re-arms scheduling; the queue and every transition live in the store |
| What "durable" means there | **process-ownership reservations on disk** — verified: agent-fleet references **pi-durable nowhere** (no import, no dependency; `grep -rln pi-durable` = 0) | durable **task/queue** state across process restart |
| Platform | **Windows-aware in parts, but not a documented supported flow**: `coms` uses named pipes on Windows and the installer has win32 handling (`.cmd`/`.exe`/`.bat`), but the write-isolation sandbox has only `bubblewrap` (Linux) / `seatbelt` (macOS) backends and no doc describes an end-to-end Windows setup | native Windows (a hard requirement of ours) |
| Licence / maturity | MIT, `2.0.17`, npm-published, changeset releases | our in-repo tool, pre-release |

**Consequence.** Adopting agent-fleet does not give us a durable queue, a
cross-seat audit trail, or restart-safe work items — those are exactly what its
architecture delegates elsewhere (pi sessions + disk + herdr). The project's own
`../docs/ORCHESTRATION-COMPARISON.md` already reached this: the **AF+PD** column
("agent-fleet over pi-durable") is *assembly we would own*, not an existing
integration, because AF runs specialists as plain pi sessions today.

### Process model — does each agent get a new shell? (asked by the operator)

**No shell; a new `pi` child process.** Every native specialist, research helper
and nested delegate is spawned directly as a `pi` process with piped stdio and no
shell (evidence: `.pi/harnesses/agent-hub/spawn.ts`):

- `spawn.ts:257` — `const launchCommand = isolation?.command ?? "pi";`
- `spawn.ts:274` — `spawn(launchCommand, launchArgs, { stdio: ["pipe","pipe","pipe"], detached: true })`,
  with the prompt written to stdin (`proc.stdin.end(opts.prompt)`); `shell: true`
  appears nowhere in agent-hub.
- The **hub itself is one pi process** — agent-hub is a `pi-coding-agent`
  extension (`import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"`).

So the OpenRig pattern — one **shell / terminal pane per agent**, the thing the
operator rejected — is **not** agent-fleet's native model: no tty, no tmux/psmux
pane, no interactive shell. Two caveats that keep this honest:

- **Opt-in peers** (`--peers`; `docs/ARCHITECTURE.md` "Peer topology") *are*
  separate processes in **herdr panes** — a terminal per peer — but peers are
  opt-in, not the default.
- It is still **one OS process per agent** (a child `pi`), whereas durig is
  lighter still: every seat is a conversation in **one** harness process. The
  docs call the specialists "in-process"; the code spawns child `pi` processes,
  so treat "one `pi` process per agent" as the fact and "in-process" as loose wording.

**Concurrency — one process is not one agent at a time.** Two mechanisms run seats
at once:

- **Async inside one harness process.** pi-durable's `TaskScheduler` runs multiple
task invocations concurrently (`packages/durable/src/harness/scheduler.ts`: an
`#invocations` map with a per-invocation abort controller, awaited as a group).
Generations await network I/O, so one Node event loop interleaves many seats;
`driver.mjs` submits wakes to several seats per pass and `pendingConvIds` is a
*set* of in-flight conversations.
- **Across processes.** Every `send`/`run` is its own CLI process, which is why
the genlock exists (`src/genlock.mjs`: "an in-process semaphore would only police
one process against itself"). `DURIG_MAX_CONCURRENT_SEATS` caps concurrent
generations rig-wide; **unset = unlimited** (`maxSeats()` → `Infinity`).

Proof: `demo/singleflight.test.mjs` runs two seats concurrently and asserts both
finish (capping in-flight at 1 only when the cap is set to 1).

So the single process is for **single-writer correctness** (D24) and for the
driver owning the run lifetime (item 38) — not serialization. The honest
trade-off is **fault isolation**: agent-fleet's per-agent process contains a
crash to one agent, while durig's shared process means a crash (the disk-full V8
OOM we hit) kills every in-flight generation in it; the durable store + `resume`
recovers the *state*, but the in-flight turns restart.

## 2. Goal-by-goal — what agent-fleet covers, and where it does not

Legend: **✔** covered · **⊕** covered *better than durig* · **◐** partial / different shape · **✘** absent.

| Our goal (durig) | agent-fleet | Evidence / note |
|---|---|---|
| Declarative seats/roles/topology | ◐ (⊕ personas) | `.pi/agents/teams.yaml` roster + 15 personas; a *roster/peer topology*, not a durable registry |
| Durable cross-seat queue with claim/complete/audit | ✘ | no queue document; `coms` is messaging, `just flow` is code-owned phase order |
| Restart recovery of in-flight work | ◐ | pi session JSONL rebuild + `herdr` snapshot/resume; not a queue that re-arms claimed work |
| Per-seat role instructions | ⊕ | 15 personas, installed verbatim; a richer library than our inline instructions |
| Delegation with capability/edge gating | ◐ | dispatch backends (`native`/`coms`/`auto`) + tier persona gate; not an edge graph |
| Human escalation / park a question | ⊕ | `ask_user` + Hermes relay to phone + `EXTERNAL_BLOCKED:` gated stop |
| Independent verification | ⊕ | **Verification Contract**: `runtime-result/v1`, orthogonal execution/changes/verification/acceptance bound to task/revision/command/exit/evidence |
| Observation of other agents | ⊕ | Hermes Desktop panel + `herdr` presence + transcript/monitor transport |
| Stalled/degenerate-run detection | ⊕ | **drift watchdog**: deterministic rules → cheap LLM judge → `drift_stop` |
| Context-pressure management | ⊕ | ordered guard (80% warn / 90% abort-preserve-settle / one compaction) |
| Measurement / drift metrics | ◐ | budget/audit accounting + `/af-hub-report`; not a measure-with-bands surface |
| Deterministic process / methodology | ⊕ | `PHILOSOPHY.md` + skills with anti-rationalization tables + `just flow` gates |
| Windows-native operation | ◐ (partial/unverified) | `coms` named pipes + installer win32 handling exist; the sandbox has no Windows backend and no end-to-end Windows flow is documented |
| Pluggable corpus / domain | ✘ (out of scope by design) | it is a **software-development** fleet (spec→plan→build→test→review→ship); a specific product domain is orthogonal |

## 3. What agent-fleet does *better* — the lessons to take (already listed in `COMPETITORS.md`)

1. **Verification Contract as a structured result** — their orthogonal
   `execution / changes / verification / acceptance` is a sharper shape than our
   prose completion + qa re-run. Directly informs durig's `complete_work`/pair review.
2. **Drift watchdog** — deterministic-first, model-second termination of a stuck
   run. This *is* our ROADMAP 42/43; read it before designing ours.
3. **Proportionality as a ratcheting task tier** — a tier that survives the next
   message and needs a reason to raise. Our PM `S/M/L` is turn-scoped.
4. **Thin-context dispatcher** — research/subagent output to disk; the coordinator
   gets **paths, not bodies**.
5. **Ordered context-pressure guard** — preserve-settle-then-compact.
6. **Independent runtime axes** (work mode × roster × peer topology).

## 4. Why "just use it" is the wrong move

- **It would not replace durig; it would sit beside it.** We would still need the
  pi-durable substrate and would own the AF+PD integration — more work, not less.
- **We would lose the guarantees we built durig for**: durable queue + audit
  trail, restart-safe claims, attention notices, drift metrics (see §2, ✘/◐ rows).
- **Platform**: agent-fleet's Windows support is partial — `coms` (named pipes)
  and the installer handle win32, but the write-isolation sandbox has no Windows
  backend and no supported end-to-end Windows flow is documented — while our
  seats run on **native Windows**.
- **Purpose mismatch**: agent-fleet encodes a *software-development* lifecycle. It
  is a rig-level competitor, not a product domain; adopting it would not advance the
  grounded-product goal, and its skills (spec/TDD/review/ship) are the
  wrong corpus for teaching TAPL.
- **Coupling/direction**: it is a fast-moving product at the pi-coding-agent
  layer; durig's pin discipline exists to absorb exactly that kind of churn.

## 5. Recommendation

**Keep durig as the durable substrate; adopt agent-fleet's mechanisms, not its
stack.** Concretely, in priority order:

1. Fold the **drift-watchdog** design (deterministic-first, one cheap judge,
   terminal `drift_stop`) into the ROADMAP 42/43 work as a cited input.
2. Adopt the **Verification Contract result shape** for `complete_work`/qa so a
   completion cannot be read as a pass.
3. Make the PM **task tier ratchet** (survive the next message; reason to raise).
4. Adopt the **thin-context return contract** (return paths, not bodies) for
   tool results.
5. Re-evaluate **AF-as-an-upper-layer** (AF+PD) only if we later want its
   UI/Hermes panel — explicitly as "assembly we own", priced as such.

## 6. Open questions the review has not yet settled (do not assume)

- **Windows**: `coms` (named pipes) and the installer have win32 handling, but
  the write-isolation sandbox path does not, and no doc describes a supported
  end-to-end Windows flow. Establish which layers actually run on native Windows
  before pricing any adoption.
- **`coms` + Verification Contract code**: read `coms-core.ts` and the
  verification path before copying a mechanism — the docs describe intent.
- **Restart semantics**: read `fleet-codex-operations.ts` ("durable command IDs
  suppress repeats after restart") and `herdr` snapshot/resume to state precisely
  what recovers, and how it differs from `harness.resume()`.
- **The product domain**: confirm the previous-rig goals are a *corpus* on top of a
  domain-agnostic rig, so the SDLC skills are not being asked to do teaching.
