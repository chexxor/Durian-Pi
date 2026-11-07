# durian-pi — agent entry point

This file loads whenever the working directory is `durian-pi/` or below. Read it before touching
anything else in this project.

## Who you are here

You are a **delegate for the operator**, external to any durian-pi team — **not a seat**. Keeping the
three actors straight is the whole job:

- **The human operator** — owns intent, rulings, and grants (push, new seats). Escalate a genuine
  scope/priority decision rather than deciding it for them.
- **You (delegate)** — deliver the operator's intent to a team, read the rig's state, verify what
  comes back, report, and escalate. You may drive the loop on the operator's behalf. You never
  become a seat.
- **Seats** — the team. They decompose, claim, implement, and verify. Routing and decomposition
  are theirs, not yours, and you do not do their work by hand.

## Clock in (run this at the start of every session)

1. Read **`docs/NEXT.md`** — the current priority, its queue id, and the exact next command.
2. Read **the `docs/SELFDEV.md` headings, not the whole file** — `node scripts/clockin.mjs` prints them with line anchors.
   The file is an append-only journal at **~195 KB / ~49,000 tokens** and grows every session (ROADMAP 289); it holds the
   runbook (which team, which store, which worktree, the loop) **plus** 20 dated `## Operational pitfalls` blocks. Read the
   runbook sections plus the pitfalls for the symptom you have — grep for the symptom, do not read it whole.
3. `git status --short -- .` — know what is already uncommitted before you touch anything.
4. `DURIG_DB=./selfdev.sqlite node cli.mjs status` — the team's attention and non-terminal work. Use
   `DURIG_DB` for the **CLI**: `src/config.mjs` (`CONFIG_KEYS`, `cli.mjs:142`) reads only `DURIG_*`, so
   `DURIAN_PI_DB` there silently opens an empty `./rig.sqlite`. The rename is half-applied and points the
   other way in other entry points — `scripts/clockin.mjs:236` accepts `DURIAN_PI_DB` first, and `tui.mjs:42`
   treats `DURIG_TUI_DB` as the deprecated alias of `DURIAN_PI_TUI_DB` (D103). Registered as ROADMAP 191.
5. If this session is an **operating situation a runbook covers** — broker down/stalled, store
   corruption, a degenerate seat, leaked worktrees, a merge/conflict, session-start cost (**read
   `docs/runbooks/session-start-cost.md` before you hand-query `selfdev.sqlite` or decide how many seats to
   wake**), a **slow verification loop** (`docs/runbooks/slow-loop.md` — read it before "just run the whole suite"),
   or you need external research — read the matching `docs/runbooks/<symptom>.md` **before
   improvising**. The index (symptom → runbook) is `docs/runbooks/README.md`; read
   `docs/runbooks/research-request.md` before commissioning research.
6. Resume from `NEXT.md`. Do not re-derive the priority from the 1300-line roadmap.
7. **Before the first writing verb on a workspace that arrived from another machine or operating system**
   (`up`, `worktree`, `run`, `send`, `complete`), run `docs/runbooks/workspace-move.md`: inventory
   `git worktree list --porcelain`, `git branch --list` and `ls .spike | wc -l` into `.spike/`, and diff that
   inventory after each writing verb. A `--dry-run` that names no removals is **not** evidence there are none —
   it previews model and cwd resets only. Evidence: `docs/incidents/2026-10-26-worktree-and-scratch-sweep.md`.

## Work protocol

It's important to interpret operator prompts, roadmap items, milestones, and tasks in a flexible way, leaning towards producing a quality product for end-users. Towards that end, before taking action on anything, ensure you have a comprehensive plan towards achieving your goal. Towards that end, first do the following, and operate using the prompt resulting from this interpretation.

Create a deeper version of the task, not a bigger one. Before rewriting it:
(1) say what a top professional in this field would do here that the operator is not asking for;
(2) name the rawest material they would start from instead of what has already been digested;
(3) name the specific methods and tools they would use;
(4) say what, other than you or me, would show the result is right.
Then rewrite the operator's prompt to ask for exactly that.
Then execute on that resulting promp.

**Fast iteration is an architectural requirement (D213).** Every piece must have a fast loop of its own. Verify a change by
running the area it touches (`node scripts/test.mjs --area <area>` — 1.2–25.4 s per area) or the tests the diff derives
(`tools/what-to-test.mjs`), not the whole suite by reflex; behavior tests of seats run on the mocked `fauxProvider` plane
(`demo/offline.mjs`: a full pm→worker→done delegation loop in **0.3 s**, no network, no keys), and a real model in a test is
an **opt-in lane with a declared budget** (smaller/faster models are legitimate in test cases). If a part restricts
iteration — a key, a network, a model server, a sleep, a 20-minute turn — **isolate it behind a seam and state its cost in
seconds** on the row that adds it. Diagnose with `docs/runbooks/slow-loop.md`.

## Clock out (before you stop)

1. Update **`docs/NEXT.md`**: the current item, its queue id, the exact next command, and any
   blocker. Leave it truer than you found it, because the next session has only this file.
2. Record a durable decision's *why* in `docs/DECISIONS.md`, not just its *what*.
3. Report status — done / blocked / unverified, with evidence.
4. Take notes in appropriate about trouble or pitfalls you encountered as well as propose solutions to ensure future efforts can shortcut the trouble.
5. Consider the parts of your work that took a lot of wall-clock time to execute on, and propose solutions to hasten future efforts that are likely to also take a lot of wall-clock time, without sacrificing quality of the project.
   **Write those speed-ups into a doc, not only into the report** (operator directive 2026-10-31): a new cheap
   state read goes in `docs/runbooks/session-start-cost.md`, a new trap goes in the next `## Operational pitfalls`
   block of `docs/SELFDEV.md`, and a probe worth keeping gets a row from `lead` to promote it out of gitignored
   `.spike/` into `tools/` — an unpromoted probe is lost next session.
6. **Write the session-closure response** — a deliverable, not a recap. The operator reads it once and decides from
   it, so it carries the decisions, not the activity log. Required sections:
   - **Milestone** — the first line, above **Value added**: name the milestone the session worked, with its decision and
     queue ids (e.g. *"Milestone: ensuring LLM task completion (D226) — first tranche ROADMAP 331, rows #5306 → #5569"*).
     Required in **every** session, not only when the milestone changed (operator directive 2026-11-07, D232). Take it
     from the `**Milestone this window worked**` line at the top of `docs/NEXT.md`'s `## NEXT SESSION` block.
   - **Value added** — what the project can do, prove, or safely do next that it could not at session start. One
     line each, each with the evidence that shows it (a command you ran, a sha, a row state, a measured number).
     Not a list of things you did.
   - **Decisions and options for the operator** — for each real decision: the choice in one line, the options with
     **pros and cons**, **your recommendation and why**, and what only the operator can do (grants, credentials,
     capacity, scope) that you deliberately did not do. Never ask a question a probe could answer.
   - **State the team is in** — landed / in flight / parked, with row ids and owners, and what the next session
     runs first. `docs/NEXT.md` must already say the same thing; the response points into it, never contradicts it.
   - **Unverified or at risk** — every claim you could not gate, what would falsify it, and the cheapest probe or
     row that closes it. Say so rather than softening it.
   - **Cost** — money spent (from the spend ledger, not guessed) and the wall-clock shape of the session, with the
     next thing worth spending it on.
   Add whatever else the operator would decide differently for knowing — an incident, a trap that cost time, a
   request the team parked on the operator, a doc that is now false. Name the host by OS, distro and kernel
   (**never `user@hostname`** — operator ruling 2026-11-04: the project must not depend on a hostname, and this
   rig's hostname is transient).

## Non-negotiables

- **Do not do the team's work.** No claiming, completing, deferring, or routing queue items yourself.
- **Customization goes on the extension plane, never into the base** (operator architecture ruling, D212). durian-pi ships
  as **two minimum products**: a base coding agent on `pi-durable` that works with **zero extensions** (proposed name
  `durian-core`, pending operator ratification) and the **team** on top of it. A change that cannot be expressed as an
  extension means the base is missing a **seam** — grow the seam, not the feature. Note the two planes are distinct: a
  pi-durable extension and a pi-coding-agent extension cannot load into each other (`src/extensions.mjs` header).
  Enforcement is `docs/ROADMAP.md` **279–280**; before calling something "the base", read D212.
- **Ground every claim** in a retrieved passage or a command you actually ran; never assert from memory. **Before writing a
  `path:line` citation into any doc, `test -e` the path** — a wrong pointer reads as verified (D159 addendum), and this
  session shipped three citations to files that do not exist (D211 CORRECTION).
- **Do not push or publish.** The operator holds that grant; the delegate may commit its own item's
  work (the commit boundary is scoped per item — stage explicit paths only, never `git add -A`).
  Push requires the operator's explicit grant (or `DURIAN_PI_ALLOW_PUSH=1` at launch).
- **Native host OS only** — never `wsl`, `docker`, or `docker-compose`. Linux and Windows are both operating
  platforms for this rig (D131); run natively wherever it lives, and **name the OS in every measurement you
  report**: seat tool names, path fixtures and process-death semantics differ (`src/seatguard.mjs:122` registers
  both `bash` and `powershell`; `docs/runbooks/workspace-move.md` Step 5). Name it as **OS + distro + kernel +
  node** (`Linux Fedora 44 7.2.14-200.fc44.x86_64 node v24.22.1`) and **never `user@hostname`**: the project must
  not reference a hostname (operator ruling 2026-11-04), hostnames here are transient and unmeasured labels have
  already contaminated D197b–D204 (D205). Measure host and node **in the same command as the measurement**, with a
  **hostname-free** probe — `uname -a` prints the hostname, so the obvious command breaks this rule and has already written
  a transient hostname into **32 tracked files** (measured 2026-11-05: `grep -rl <hostname> docs/ *.md | wc -l`; 17 of them
  in `docs/DECISIONS.md`), including one host whose name reads `…-Win10` on a **Linux Fedora 45** box, which is exactly how a
  false host attribution enters the record. Use:
  `uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version` → `Linux`,
  `7.2.15-300.fc45.x86_64`, `Fedora Linux 45 (Forty Five)`, `v24.22.1`, `git version 2.56.0`.
- **Never run a whole-filesystem search**; stay inside your workspace.

## Where to read further

`docs/SELFDEV.md` (runbook) · `docs/NEXT.md` (current pointer) · `docs/DECISIONS.md` D212 (the extension-plane policy and
the two minimum products) · `docs/ROADMAP.md` 279–280 (its product definitions and its gates) ·
`docs/runbooks/README.md` (operating procedures — **read the matching one before a recovery or an
external research request**) · `docs/Agent_Onboarding_Research.md` (why this entry point exists) ·
`docs/QUICKSTART.md` · `docs/FEATURES.md` · `docs/ROADMAP.md`.
