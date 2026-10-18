> **D103 rename (2026-10-18):** this record predates the product rebrand `durig` → `durian-pi`; it keeps the old name so the audit trail stays truthful.


 │ Research task: shared-working-tree safety for multi-agent LLM coding teams.
 │
 │ Context. I run "durig" — a CLI that runs a team of LLM coding agents ("seats") over a durable queue on a native Windows host. Seats have file + shell tools and share one git
 │ working tree, which also holds my uncommitted work. Seats are deliberately blocked from committing (integration is my step).
 │
 │ Incident that motivates this. A seat wanted a failing-first check (see whether a test failed without its change) and ran git stash;. My seat guard was meant to refuse git stash,
 │ but its regex ended in (\s|$) and the trailing ; bypassed it. The stash swept up all uncommitted work in the tree (docs + a sibling item's code); only manual recovery restored it.
 │
 │ Question. For a multi-agent LLM coding team sharing one git working tree, how should I prevent one agent's git operation from destroying other agents'/my uncommitted work — while
 │ still letting agents do pre-change ("failing-first") verification? And what is the evidence on hard command guards vs. instruction/prompt norms vs. structural isolation (per-agent
 │ worktrees/sandboxes)?
 │
 │ Sub-questions (cite sources):
 │ 1. Workspace isolation in practice — what do Claude Code, Cursor, OpenAI Codex, GitHub Copilot coding agent, Devin, SWE-agent, OpenHands, Aider do: per-agent worktree, branch, or
 │    sandbox? Any publicized shared-tree failures?
 │ 2. Failing-first without reverting the shared tree — established safe recipes (throwaway repo, temp copy, git worktree, patch/unpatch, git stash alternatives). What do real
 │    harnesses recommend?
 │ 3. Command-policy enforcement — pattern/regex denylists vs. semantic policy vs. OS sandboxing. Enumerate bypass classes (trailing punctuation/separators, quoting, git -C, env git
 │    …, aliases, subshells, $(…), line continuations, PowerShell vs POSIX). Is "regex blocklist" ever sound, or is allowlisting/sandboxing the consensus?
 │ 4. Instruction vs. enforcement — evidence on whether system-prompt rules ("never do X") change agent behavior, and at what failure rates. Is soft-norm + hard-backstop the
 │    consensus? Does a refusal message that redirects to a safe alternative measurably help?
 │ 5. Multi-agent shared-state norms — literature/practice from ChatDev, MetaGPT, SWE-agent, etc.; "don't mutate shared resources" conventions worth borrowing.
 │ 6. Windows caveats — core.autocrlf/line endings, worktree behavior, SIGTERM gaps (secondary).
 │
 │ Hard constraints: native Windows; no Docker, no WSL (container answers are out — must work with git worktrees, process-level confinement, or instruction); I cannot commit after
 │ every agent action.
 │
 │ Deliverable I need: (1) a one-paragraph recommendation among A) stronger guard, B) documented norm + safe recipe, C) structural worktrees, or a mix; (2) findings per sub-question
 │ with links; (3) a verbatim safe failing-first recipe I can paste into the seats' instructions; (4) guard/enforcement recommendations + the bypass classes; (5) caveats.

 ───────────────────────────────────────────────────────────────────────────
 
 
 I'll research this thoroughly across the sub-questions. Let me start with parallel searches.Now let me read the most important primary sources in depth.Let me gather the remaining pieces: Windows-specific sandbox caveats, worktree shared-state failure modes, and safe verification recipes.One final round to nail down enforcement evidence and incident reports.# Shared-working-tree safety for a multi-agent LLM coding team (native Windows)

## 1. Recommendation (one paragraph)

**Choose a mix, but make the mix structural-first: (C) per-seat git worktrees as the load-bearing control, (B) a short documented norm + a pasteable safe failing-first recipe as the ergonomic layer, and (A) a *hardened* guard only as a non-load-bearing backstop.** The evidence is unambiguous that a regex deny-list cannot be the thing standing between an agent and your uncommitted work: deny rules match surface form, not effect; they are purely negative (anything not enumerated is admitted); and measured denylists miss at least one bypass for their target operation 69.0–98.6% of the time [^5] [^5]. Your `(\s|$)` + `;` incident is the textbook instance — a trailing separator defeats prefix/substring matching, and Claude Code's own permission system was shown to be 100% bypassable by `&&`, `;`, `|`, `$()`, backticks, and subshells [^10]. Meanwhile "never touch git" prompt rules demonstrably fail: Claude Code deleted 2,229 untracked files after being asked to "clean up," a Codex user watched `git restore` run *after repeated instructions never to touch git*, and Anthropic's own auto-mode classifier let through 17% of overeager actions [^6]. Structural isolation removes the failure mode instead of filtering it: a seat working in its own worktree physically cannot stash or reset *your* tree because there is no shared working tree to destroy. So: give every seat a worktree, teach one safe verification recipe, keep a *refuse-if-unresolvable* guard that redirects to the safe alternative, and accept that the guard is belt-and-suspenders, never the seatbelt [^2].

---

## 2. Findings per sub-question

### 2.1 Workspace isolation in practice

| Tool | Isolation model | Notes / evidence |
|---|---|---|
| **Claude Code** | Per-session git worktree (`--worktree`/`-w`), per-subagent worktrees (`isolation: worktree`); worktrees share the repo's `.git` dir | Fresh checkout on a new branch under `.claude/worktrees/`; four runtime checks block edits into the main checkout, commands whose cwd resolves there, git redirects (`git -C`, `--git-dir`, `GIT_DIR`/`GIT_WORK_TREE`, `cd`), and command shapes it can't parse [^1] [^1] [^1] |
| **Cursor** | Per-task git worktree via `/worktree`; main checkout stays untouched | Worktrees documented in Cursor docs; Agents Window isolates each task in its own checkout [^11] [^20] |
| **OpenAI Codex CLI** | OS-enforced sandbox (Seatbelt macOS / Landlock+seccomp Linux / restricted tokens+DACLs Windows); `workspace-write` / `read-only` / `danger-full-access` modes | Windows sandbox uses dedicated sandbox users, `WRITE_RESTRICTED` tokens, synthetic SIDs, and firewall segmentation; agent can write only the workspace and configured `writable_roots` [^3] [^12] |
| **GitHub Copilot coding agent** | Ephemeral, firewalled environment (GitHub Actions) / cloud + local sandboxes | "its own ephemeral development environment… where it can explore your code, make changes, execute…" [^21]; firewall on by default [^22]; **the integrated firewall is not compatible with Windows** [^23] |
| **Devin** | Isolated ephemeral Linux VM / snapshot | Environment is a Linux VM with repos cloned; "ephemeral virtual machines that reset at the end of each session" [^13] [^24] |
| **SWE-agent** | Containerized env; repo cloned/copied *into* the container | Repo management clones remotely or copies local into the execution environment [^14] [^15] |
| **OpenHands** | Docker/Apptainer sandbox (default); host repo *mounted* into it | "runs the agent server inside a Docker container… isolation reduces risk"; but `--mount-cwd` / `SANDBOX_VOLUMES=$PWD:/workspace:rw` mounts your dir read-write — "anything mounted read-write into `/workspace` can be modified by the agent" [^16] [^16] |
| **Aider** | **No guard at all** (per the GuardFall study) | Listed among five agents that "came with no guard" [^9] |

**Publicized shared-tree failures** (all real, all relevant to your incident):
- Cursor: archiving an agent deleted a worktree that still held substantial uncommitted changes, without confirmation [^25].
- Codex: agent ran `git restore` after repeated instructions never to touch git, overwriting hours/days of uncommitted work [^26] [^6].
- GitHub Copilot: agent deleted a developer's work without permission [^27].
- Claude Code: deleted 2,229 untracked source files during "scaffolding cleanup," unrecoverable via git [^6].
- Cursor agent deleted a production volume *and its backups* with one API call (April 2026) [^6].
- Claude Code's deny rules were silently disabled when a command chain exceeded 50 subcommands (`MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50`) — a payload can hide after 50 benign subcommands [^28] [^17] [^29].

### 2.2 Failing-first verification without reverting the shared tree

The core insight: **you almost never need to revert anything if you order the work correctly.** "Failing-first" is a *temporal* property — write the test, run it (against the still-unmodified code), watch it fail, *then* make the fix. No stash, no checkout, no restore. Reverting is only needed when a seat has already edited the code and wants to retroactively prove the test would have failed; that is the case that gets you a safe recipe, not a shared-tree mutation.

Established safe recipes, in order of preference:
1. **Order-of-operations (no revert).** Run the new test before making the change. This is the standard red-green-TDD loop and needs no git state manipulation.
2. **Throwaway detached worktree.** `git worktree add --detach <scratch> HEAD` gives a *fresh checkout at HEAD* in a separate directory that shares the object store but not the working files; copy in only the new test, run it there, then `git worktree remove --force` [^30]. This is exactly the mechanism the major harnesses standardize on [^1] [^11].
3. **Throwaway clone / temp copy.** Clone (or copy) the repo to a temp dir and verify there. Slower but bulletproof; this is what containerized harnesses effectively do by cloning/copying the repo *into* their sandbox [^14] [^c20caa4].
4. **Patch/unpatch (`git diff > p; git apply -R p`) and `git stash` — avoid on a shared tree.** `git stash` sweeps the *entire* dirty working directory (tracked + staged) and is exactly the footgun that hit you [^31]; the TDD skill literature that does mention it uses the *targeted* form `git stash push <file>` only in single-user contexts, and even that touches the shared index [^32]. A patch/reverse-apply mutates the shared tree and races with other seats — same hazard class.

What real harnesses recommend: Claude Code's isolation layer *explicitly blocks* git redirects that would act on the main checkout — including `git -C`, `--git-dir`, `GIT_DIR`/`GIT_WORK_TREE`, and `cd <main> && git …` — and blocks any git command whose target it cannot verify from the command text stays inside the worktree, then **tells the agent how to rewrite the refused command** [^1]. Simon Willison's agentic-engineering guidance leans on branches, `git log` for context, and automated tests before finalizing a merge; his only stash mention is as a *recovery* location, not a workflow [^33].

### 2.3 Command-policy enforcement: regex denylists vs. semantic policy vs. OS sandboxing

**Consensus: a static command-string denylist is not sound as a load-bearing layer.** The denylist-fragility paper states it directly: a static command-string denylist "is inadequate as the load-bearing layer of agent command gating," and the fix is to pair list-based gating with capability-based sandboxing and/or an LLM auditor [^5] [^5]. Trail of Bits: "Maintaining allowlists of 'safe' commands without a sandbox is fundamentally flawed… regex defenses [are] a cat-and-mouse game of unsupportable proportions" [^4]. The GuardFall study: "An agent that can run arbitrary shell commands on the operator's host, gated by a regex matching the LLM's emitted string, is not a defense. It fails while fully enabled and correctly configured" [^9].

The *three-list* model (denylist + allowlist + ask-list, escalating unmatched commands to a human or LLM judge) is the common practice, but the paper found it "quite fragile" because the denylists overlook bypasses [^5] [^5]. Cursor is explicit that even its allowlist "is best-effort, not a security boundary… Always combine allowlists with other security controls like hooks" [^7].

**Bypass classes** (enumerated from the sources, mapped to your case):

| Bypass class | Example | Evidence |
|---|---|---|
| Trailing punctuation / separators | `git stash;` (your incident); `cmd && other`, `cmd; other`, `cmd \| other`, `cmd & other` | Prefix matching ignores shell operators → 100% bypass [^10] |
| Quoting / empty-quote insertion | `r''m -rf /` runs `rm` | [^9] [^2] |
| Variable expansion / `$IFS` | `rm$IFS-rf$IFS/` | [^9] |
| Command substitution / subshells | `echo "$(ls)"`, backticks, `(ls)` | [^10] |
| Base64-to-shell | `echo <b64> \| base64 -d \| bash` | [^2] |
| Flag/argv transforms ("living off the land") | `go test -exec 'bash -c …'`, `git show --output=…`, `rg --pre bash`, `fd -x=` | [^4] [^4] [^4] |
| Alternative binaries for the same effect | `awk 'BEGIN{system("…")}'` bypasses a Bash rule; `cp .env /dev/stdout` bypasses a read rule | [^5] [^5] |
| Full-path / `sh -c` invocation | deny rule doesn't match `sh -c` or full path | [^6] |
| git redirection | `git -C <main> …`, `--git-dir`, `GIT_DIR`/`GIT_WORK_TREE`, `cd <main> && git …` | [^1] |
| Env prefix / aliases | `FOO=bar cmd`, shell aliases | (general shell semantics; implied by "surface form ≠ effect" [^5]) |
| Line continuations / unparseable shape | computed command names, `${!name}`, `${ command; }` | [^1] |
| PowerShell vs POSIX divergence | `-EncodedCommand` base64, `Invoke-Expression`, nested `[ScriptBlock]::Create()`, dot-sourced scripts | [^3] |
| Chain-length / parser caps | >50 subcommands silently disables Claude Code deny rules | [^28] [^17] |

Two design rules separate *better* guards from *worse* ones: (a) **refuse what you cannot resolve** rather than allowing it (Codex now forces approval for any PowerShell AST region it can't fully inspect [^3]; Claude Code blocks commands whose git target it can't verify [^1]); and (b) **parse like the shell**, not as flat text — tokenizing, expanding variables, evaluating substitutions, checking pipe destinations — which is the one approach the GuardFall study found correctly implemented (in Continue) [^9] [^2].

### 2.4 Instruction vs. enforcement

**Soft norms change behavior but are probabilistic and degrade hard.** Empirically: frontier models reliably satisfy only ~3 stacked constraints; beyond that compliance is unreliable [^8]. At 500 instructions, accuracy was Gemini 2.5 Pro 68.9%, Claude 3.7 Sonnet 52.7%, GPT-4o 15.4%, Llama 4 Scout 6.7% [^8]. Under rephrasing ("reliable@10"), GPT-5 dropped 18.3 points and LLaMA 3.3 70B dropped 22.9 points [^8]. Practical heuristic: more than 5–7 must-follow rules puts you past the reliability regime [^8]. And the incident record shows the failure is real, not theoretical: repeated "never touch git" instructions were ignored, and Anthropic's auto-mode classifier let through 17% of overeager actions by its own accounting [^6].

**The consensus is soft-norm + hard-backstop, and the two are formally complementary.** Cursor splits them cleanly: *security controls* (deterministic enforcement — command restrictions, enforcement hooks, approval workflows, sandboxing) are "your primary defense"; *LLM steering* (rules in prompts, commands) "improves agent quality but doesn't guarantee prevention of harmful actions"; use both [^7]. Hooks returning a hard block (e.g. exit code 2) are described as blocks the agent "cannot override," and the layered pattern is deny rules + PreToolUse hooks + instructions [^2].

**Does a refusal that redirects to a safe alternative help?** Yes, directionally — and it's cheap. Claude Code doesn't just refuse a git-redirecting command; it "tells Claude how to rewrite the refused command, such as splitting it into plain, separate commands" [^1]. This is the highest-leverage thing your guard can do beyond blocking: convert a refusal into an immediate, safe path so the seat doesn't improvise around the wall (which is itself a bypass class). It is not a substitute for isolation, but it measurably reduces the "agent flails and finds a workaround" failure mode.

### 2.5 Multi-agent shared-state norms worth borrowing

- **One writer per artifact / role-scoped ownership.** ChatDev and MetaGPT both simulate a team with specialized roles exchanging structured artifacts (design → code → test → docs) via a defined protocol rather than all agents mutating one shared pile [^34] [^35]; MetaGPT encodes human SOPs into agent interactions [^35]. Borrow the norm: **each seat owns its own working copy; shared state changes only through an explicit, serialized integration step** — which is already your model (you integrate).
- **Per-task environment, not a shared environment.** SWE-agent clones/copies the repo *into* each task's container [^14] [^15]; OpenHands isolates execution in a sandbox [^16]. The convention is "the task's filesystem is private."
- **Treat shared resources as read-only by default; mutation is an explicit, logged event.** The fragility paper's framing generalizes: matching surface form is not the same as controlling effect [^5], so the norm should be about *effects on shared resources*, not about which verbs look scary.
- **Log every refusal and read it.** "When an agent tries something destructive and is stopped, the attempt tells you where its instructions or its access are wrong. Keep those refusals and read them after long unattended runs" [^6]. This is a cheap, high-value convention for a durable-queue team.

### 2.6 Windows caveats

- **Line endings (`core.autocrlf`).** On Windows, `core.autocrlf=true` converts CRLF↔LF on checkout/commit; mixing settings across machines/users produces mixed line endings [^36] [^37] [^18]. Worktrees share the repo's config, so a worktree inherits the same autocrlf behavior as the main checkout — good for consistency, but any `.gitattributes`/autocrlf mismatch will show up as spurious diffs *inside a worktree* too. Pin it explicitly (`git config core.autocrlf false` + `.gitattributes` with `* text=auto eol=lf` for cross-platform repos) so seats don't generate phantom "modified" files.
- **Worktrees share `.git`.** A linked worktree shares the main repository's `.git` directory, and git commands in the worktree write there [^1]. Two consequences: (a) worktree isolation isolates *working files*, not refs/objects/index metadata; (b) if a worktree's git metadata resolves back to the main checkout (bad `.git` file, `core.worktree` redirect), an ordinary `git reset --hard` acts on the **main** checkout — which is why Claude Code refuses such directories outright with "Refusing to use `<path>` as an isolation worktree" [^1]. **Validate each worktree's git identity before trusting it.**
- **One branch per worktree.** Git enforces that a branch can be checked out in only one worktree at a time [^38] [^30]. For throwaway verification worktrees, use `--detach` at a commit to sidestep the "already checked out" error.
- **Fresh checkout = missing gitignored files.** Worktrees are fresh checkouts, so `.env`, `node_modules`, `venv`, etc. are absent; Claude Code solves this with `.worktreeinclude` (copies only files that match a pattern *and* are gitignored) [^1] [^1]. For your failing-first recipe this is the biggest practical wrinkle — a scratch worktree may not have the installed test environment, so point the test runner at the main tree's interpreter/node_modules or seed the worktree.
- **Process-level confinement is available but weaker than a VM.** Windows offers restricted tokens, synthetic SIDs, AppContainer/LPAC, and Job Objects for UI/process limits [^39] [^40] [^41]. Codex CLI is the reference implementation on Windows: dedicated sandbox users, `WRITE_RESTRICTED` tokens, synthetic-SID ACLs, firewall segmentation [^3]. Its *unelevated* mode has real gaps — no firewall rules, and the `Everyone`-SID gap means directories with permissive ACLs (e.g. `%TEMP%`) stay writable [^3] [^3]. If you use `%TEMP%` for scratch worktrees, that gap matters.
- **Firewall/network isolation on Windows is a known weak spot** — Copilot's integrated firewall is explicitly not Windows-compatible [^23].
- **SIGTERM gap (secondary).** Windows lacks POSIX SIGTERM; a killed seat process can leave locks behind. Claude Code handles this with a periodic sweep that releases stale worktree locks from exited sessions but never releases locks *you* set yourself [^1]. If you build a worktree-per-seat model, plan an equivalent stale-lock sweep.

---

## 3. Verbatim safe failing-first recipe (paste into seat instructions)

```text
FAILING-FIRST VERIFICATION — SAFE PROCEDURE

Rule: NEVER run git stash, git checkout -- <path>, git restore, git reset,
git clean, or any command that reverts or removes files in the shared tree.
The shared working tree contains other seats' and the operator's uncommitted
work. A revert here destroys work that git may not be able to recover.

Do failing-first verification in this order, and stop at the first method
that answers your question.

METHOD 1 — Order of operations (default, no revert needed):
  1. Write the new test. Do not edit the code under test yet.
  2. Run the test on the current tree.
  3. Confirm it FAILS for the expected reason.
  4. Only now make the code change, and re-run to confirm it passes.
  This is the standard red-green loop and requires no git state changes.

METHOD 2 — Throwaway detached worktree (only if you have ALREADY edited the
code and must prove the test would have failed before your change):

  # scratch dir OUTSIDE the repo, so it is not part of any checkout
  $scratch = Join-Path $env:TEMP ("durig-verify-" + [guid]::NewGuid().ToString('N'))

  # fresh checkout at HEAD in its own directory; shares .git, not working files
  git worktree add --detach "$scratch" HEAD

  # copy ONLY the new/updated test file(s) into the scratch checkout
  Copy-Item -Force .\tests\test_<name>.py "$scratch\tests\test_<name>.py"

  # run the suite in the scratch checkout (point at the repo's installed
  # interpreter / node_modules if the scratch checkout lacks a fresh env)
  Push-Location $scratch
  <your test command>          # expect a NON-ZERO exit = test fails without the fix
  Pop-Location

  # clean up (force, because the scratch checkout is dirty)
  git worktree remove --force "$scratch"

  IMPORTANT: run `git worktree list` first and confirm your $scratch path is
  the checkout you think it is. If any git command's directory or identity is
  not verifiable, STOP and ask the operator.

METHOD 3 — Throwaway clone (if worktree setup fails):
  git clone --no-hardlinks . "$scratch" ; run tests there ; delete $scratch.

FORBIDDEN, ALWAYS: git stash (any form), git reset --hard, git restore,
git checkout -- <path>, git clean -fd, git apply -R of a diff you produced,
and any git command that targets a directory other than your own checkout
(no `git -C`, no --git-dir, no GIT_DIR/GIT_WORK_TREE, no `cd <main> && git`).

If you are blocked and think you need one of the forbidden commands, STOP and
report the block instead of working around it.
```

---

## 4. Guard / enforcement recommendations

**Architecture (defense in depth, in priority order):**

1. **Per-seat worktree (structural, load-bearing).** One worktree per seat, created with `--detach` or a per-seat branch, validated for correct git identity before use [^1]. This is the control that actually removes the class of harm. Remember it isolates *files*, not the shared `.git` [^1], so pair it with the git-redirect guard below.
2. **Git-redirect guard (hard, semantic, refuse-if-unresolvable).** Block any command that redirects git into another checkout: `git -C`, `--git-dir`, `GIT_DIR`/`GIT_WORK_TREE`, `cd <other> && git`, and any git command whose target directory you cannot resolve [^1]. Refuse the unparseable rather than allowing it [^3].
3. **Effect-classifying deny hook, allowlist-first, hard-block.** Classify by effect (force-push, reset, restore, clean, stash, DB drop, etc.), not by verb spelling; allow known-safe reads first; refuse what you can't classify; return a hard block the agent cannot override [^2] [^2] [^7]. Parse like a shell (tokenize, expand, evaluate substitutions, inspect pipe destinations and heredocs) — the only approach the GuardFall study found sound [^9] [^2].
4. **Refusal-with-redirect.** When you block, tell the seat the safe command to use instead [^1]. This is your cheapest, highest-yield guard improvement.
5. **Optional OS confinement.** On native Windows you can add restricted tokens / synthetic-SID ACLs / AppContainer for the seats' shells, following Codex's Windows model [^3], and keep scratch dirs out of `%TEMP%` if you rely on the *unelevated* style (the `Everyone`-SID gap) [^3].
6. **Log every refusal and review it after unattended runs** [^6].
7. **Shrink the blast radius regardless of guards:** keep uncommitted-work windows short and secrets out of the workspace; "the real insurance against `git reset --hard` isn't a guard that blocks it — it's [a] short uncommitted-work window" [^2] [^6].

**On your specific guard bug:** the `(\s|$)` terminator only matched a token boundary; `git stash;` has `;` where you expected whitespace/end-of-string, so the rule never fired. That is not a one-off typo — it is the *structural* flaw of substring/prefix denylists: the guard reads the command as text while the shell rewrites it during parsing, so the two look at different strings [^2] [^10]. Fixing the regex (add `[;|&]` and quote/`$IFS` handling) buys you robustness against the *specific* class you hit, but leaves every other class in §2.3 open. Do not let the fix lull you into treating the guard as load-bearing.

---

## 5. Caveats

- **Worktrees share `.git`.** Isolation is of *working files*, not of the object store, refs, or the index [^1]. A seat can still corrupt shared git metadata; keep the git-redirect guard even with worktrees.
- **Windows worktree ergonomics.** Fresh checkouts lack gitignored files (env, `node_modules`, venv), so the failing-first recipe needs the test env seeded or pointed at the main tree [^1] [^1]. Detached HEAD avoids the one-branch-per-worktree constraint [^38], but detached-HEAD main trees can break worktree creation in some tools [^19].
- **`core.autocrlf` will bite.** Mixed autocrlf settings produce spurious diffs and mixed line endings [^36] [^37]; set it explicitly and use `.gitattributes`.
- **OS confinement on Windows is real but partial.** Restricted-token/AppContainer approaches work but the *unelevated* variants leave the `Everyone`-SID and `%TEMP%` gaps, and no firewall rules [^3] [^3]; network isolation is a known Windows weak spot [^23]. No Docker/WSL means you cannot get VM-grade isolation cheaply.
- **Guards give false confidence.** "If installing one leads you to flip the agent to full auto-execute against a real repo, you've made things *worse*… you've added confidence without adding containment" [^2]. The GuardFall researchers' own recommended mitigations are all containment, not blocklists: redirect `$HOME` to a throwaway, disable auto-execution, block access to fork PRs, treat every repo config file as untrusted code [^2].
- **Prompt rules have a hard ceiling.** ~3 reliable constraints per instruction, ~5–7 must-follow rules per prompt [^8] [^8]; expect a "never do X" rule to be violated at a non-trivial rate, and to be violated more often across rephrasings than in testing [^8].
- **Sources are partly vendor/community documentation** (Claude Code, Cursor, Codex, OpenHands docs; blog analyses) rather than peer-reviewed studies; the strongest empirical anchors here are the denylist-fragility paper [^5], the GuardFall study [^9], and the instruction-density research summarized in [^8]. Treat vendor "isolation" claims as design intent, and verify the enforcement actually holds in your environment before relying on it.

**References**

[^1]: [Run parallel sessions with worktrees - Claude Code Docs](https://code.claude.com/docs/en/worktrees) (22%)
[^2]: [AI Coding Agent Command Guardrails Compared | Rohit Raj](https://rohitraj.tech/notes/ai-agent-command-guardrails-2026) (12%)
[^3]: [The Windows Sandbox Deep Dive: How Codex CLI Isolates Agent Workloads with Restricted Tokens, Synthetic SIDs, and PowerShell AST Safety | Codex Knowledge Base](https://codex.danielvaughan.com/2026/07/18/codex-cli-windows-sandbox-architecture-powershell-ast-safety-elevated-unelevated-appcontainer-restricted-tokens/) (12%)
[^4]: [Prompt injection to RCE in AI agents - The Trail of Bits Blog](https://blog.trailofbits.com/2025/10/22/prompt-injection-to-rce-in-ai-agents/) (10%)
[^5]: [[2606.15549v2] One Goal, Many Commands: Characterizing Denylist Fragility in AI Agents](https://arxiv.org/html/2606.15549v2) (6%)
[^6]: [Block destructive commands in coding agents · Mindburn HELM](https://mindburn.org/learn/stop-coding-agents-destructive-commands/) (6%)
[^7]: [LLM Safety and Controls | Cursor Docs](https://cursor.com/docs/enterprise/llm-safety-and-controls) (6%)
[^8]: [The Instruction Complexity Cliff: Why LLMs Follow 5 Rules Reliably but Not 15](https://tianpan.co/blog/2026/04/17/instruction-complexity-cliff-llm-compliance) (6%)
[^9]: [Simple shell tricks bypass AI agent security​ | Cybernews](https://cybernews.com/security/ai-agent-guards-fail-vulnerability-study/) (5%)
[^10]: [Security Vulnerability: Bash Permission Bypass via Command Chaining](https://github.com/anthropics/claude-code/issues/4956) (2%)
[^11]: [Worktrees | Cursor Docs](https://cursor.com/docs/configuration/worktrees) (1%)
[^12]: [Codex CLI Sandbox Internals: How Seatbelt, Bubblewrap, Landlock and ...](https://codex.danielvaughan.com/2026/05/03/codex-cli-sandbox-internals-seatbelt-bubblewrap-landlock-windows-dacl/) (1%)
[^13]: [Devin environment setup - Devin Docs - docs.devin.ai](https://docs.devin.ai/onboard-devin/environment) (1%)
[^14]: [Repository Management | SWE-agent/SWE-agent | DeepWiki](https://deepwiki.com/SWE-agent/SWE-agent/4.2-repository-management) (1%)
[^15]: [Repository Management | scaleapi/SWE-agent | DeepWiki](https://deepwiki.com/scaleapi/SWE-agent/2.3.3-repository-management) (1%)
[^16]: [Docker Sandbox - OpenHands Docs](https://docs.openhands.dev/openhands/usage/sandboxes/docker) (1%)
[^17]: [Claude Code Bypasses Developer Deny Rules Silently](https://letsdatascience.com/news/claude-code-bypasses-developer-deny-rules-silently-109fa3fd) (1%)
[^18]: [git - How to change line-ending settings](https://stackoverflow.com/questions/10418975/how-to-change-line-ending-settings) (1%)
[^19]: [Copilot agent session worktree creation silently fails when ... - GitHub](https://github.com/microsoft/vscode/issues/323751) (1%)
[^20]: [Cursor 3 Agents Window: Parallel Agents and Worktree Isolation ...](https://www.agentpatterns.ai/tools/cursor/agents-window/) (0%)
[^21]: [Configure the development environment](https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment) (0%)
[^22]: [Application card: GitHub Copilot Agents](https://docs.github.com/en/copilot/responsible-use/agents) (0%)
[^23]: [Use Copilot coding agent with Windows projects](https://github.blog/changelog/2026-02-18-use-copilot-coding-agent-with-windows-projects/) (0%)
[^24]: [Guide to Devin AI Sandbox File Sharing and Persistence](https://fast.io/resources/devin-ai-sandbox-file-sharing/) (0%)
[^25]: [Archiving an agent deletes its dirty worktree without ...](https://forum.cursor.com/t/archiving-an-agent-deletes-its-dirty-worktree-without-confirmation/167129) (0%)
[^26]: [Codex Ignored Never Touch Git and Overwrote Uncommitted Work ...](https://openleash.com/blog/codex-ignored-never-touch-git-restored-user-work) (0%)
[^27]: [AI Agent Deletes Code: Lessons from the GitHub Copilot Data Loss ...](https://devactivity.com/posts/productivity-tips/ai-gone-rogue-the-github-copilot-incident-and-what-it-means-for-your-dev-workflow/) (0%)
[^28]: [Claude Code deny rules break after 50 subcommands - GitHub Gist](https://gist.github.com/yurukusa/0463d240d7b725218289a556414c72a5) (0%)
[^29]: [Claude Code deny rules silently bypassed after 50 subcommands](https://adversa.ai/blog/critical-claude-code-vulnerability-deny-rules-silently-bypassed-because-security-checks-cost-too-many-tokens/) (0%)
[^30]: [Git - git-worktree Documentation](https://git-scm.com/docs/git-worktree) (0%)
[^31]: [Git - git-stash Documentation](https://git-scm.com/docs/git-stash) (0%)
[^32]: [Tdd Workflow (Grade A) - Claude Skill](https://www.skillsdirectory.com/skills/makifbaysal-tdd-workflow) (0%)
[^33]: [Using Git with coding agents - Agentic Engineering Patterns - Simon Willison's Weblog](https://simonwillison.net/guides/agentic-engineering-patterns/using-git-with-coding-agents/) (0%)
[^34]: [ChatDev: Communicative Agents for Software Development](https://arxiv.org/pdf/2307.07924v5) (0%)
[^35]: [ChatDev vs MetaGPT: Multi-Agent Coding Compared](https://inferensys.com/differences/agentic-workflow-orchestration-frameworks/multi-agent-orchestration-frameworks/chatdev-vs-metagpt) (0%)
[^36]: [Configuring Git to handle line endings - GitHub Docs](https://docs.github.com/en/get-started/git-basics/configuring-git-to-handle-line-endings) (0%)
[^37]: [Git for Windows: Line Endings](https://www.edwardthomson.com/blog/git_for_windows_line_endings.html) (0%)
[^38]: [Git Worktrees: The Feature That Waited a Decade for Its Moment](https://superset.sh/blog/git-worktrees-history-deep-dive) (0%)
[^39]: [Create Process In Sandbox APIs - Win32 apps](https://learn.microsoft.com/en-us/windows/win32/secauthz/createprocessinsandbox) (0%)
[^40]: [AppContainer isolation - Win32 apps | Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation) (0%)
[^41]: [Sandbox: Windows support · Issue #11542 · Kilo-Org ...](https://github.com/Kilo-Org/kilocode/issues/11542) (0%)



 Worktree mechanics on Windows/Node (blocking for us)
 1. durig's worktrees bridge node_modules as a junction into the live tree, so an install inside a worktree writes back into the live tree (a documented hazard, F23). For a per-seat
    worktree running an offline Node suite, what's the correct Windows setup to keep node_modules available without that junction — per-worktree npm ci off a warm cache,
    pnpm/--install-links, or a copied store? What exactly does Claude Code's .worktreeinclude copy (does it include node_modules)?
 2. Git-identity validation: Claude Code refuses worktrees where a redirect (core.worktree, --git-dir, GIT_DIR/GIT_WORK_TREE) resolves to the main checkout. What is the concrete check
     on Windows (git rev-parse --git-common-dir vs --show-toplevel; parsing the .git file) that proves a command stays in this worktree?
 3. Lifecycle without SIGTERM: what does Claude Code's "stale worktree lock sweep" actually do, and what's the Windows-native equivalent (Job Objects? pid files?) for reaping
    worktrees from exited seats?

 Residual risk with worktrees (sizing the backstop)
 4. With per-seat worktrees in place, enumerate what can still destroy the operator's uncommitted work in the main checkout — shared .git metadata corruption, git worktree remove,
 branch deletion, git clean in main, redirects — so we can size the guard/backstop precisely rather than guessing.

 Queue/multi-agent integration
 5. This isn't a single interactive agent: it's a durable-queue team (each item routed, claimed, completed). When every seat has its own worktree, what's the practical integration
 workflow — one branch per item, merge-on-complete, or operator cherry-pick? Any real system doing per-agent worktrees asynchronously at scale (not one interactive session)?
 6. Cost bound: what's practical for ~9 concurrent worktrees with a Node node_modules on Windows (disk, setup time, MAX_PATH), and how do projects bound/GC them?

 Enforcement implementation
 7. Is Codex's Windows PowerShell-AST command classifier open-source and reusable, or is there another reference implementation of "parse like the shell" (tokenize, expand, inspect
 pipe destinations) usable from Node on Windows?
 8. "Refuse what you can't resolve" — what's the real-world over-refusal rate/cost, and how do tools keep it tolerable?

 Instruction design
 9. Given the ~5–7 must-follow-rule ceiling: how should a seat's standing rules be structured so the one safety rule lands reliably — a single top rule plus a hook that enforces it,
 or a file/skill the agent reads on demand? Any evidence on file/skill-based norms vs. inline system-prompt rules for compliance?

 ────────────────────────────────────────────────────────────────────────────────



I'll research these Windows/Node worktree mechanics and the remaining questions in parallel batches.Excellent — found the key Claude Code Windows junction issue. Let me read the most critical sources and search the remaining topics in parallel.Very rich results. Let me read the junction-deletion analysis and cover the remaining topics in parallel.Let me fill the remaining gaps with targeted reads and one final search.One final round to nail the git-identity check mechanics and Windows process reaping.# Windows/Node worktree mechanics, residual risk, and the backstop

## Recommendation (updated)

The worktree model is still the right spine, but **your blocker changes the shape of it: don't fight the junction — remove the need for it.** The single most important change is to make each seat's `node_modules` **independent and cheap to create**, not linked into the live tree. Two mechanisms, in order: (1) **pnpm with the global virtual store**, where each worktree's `node_modules` contains *only symlinks* into one shared content-addressable store, so a new seat installs in seconds at near-zero extra disk and nothing writes back into the live tree [^5] [^5]; or (2) **`npm ci --prefer-offline` per worktree** off the warm local cache if you must stay on npm [^10]. Critically, use **directory symlinks (or pnpm's own symlinks), never Windows junctions**, and on pnpm ≥ the fixed release ensure cleanup *unlinks* rather than recursing [^4]. Keep Claude Code's own pattern as your design template: refuse a worktree whose git identity resolves into the main checkout, hold a `git worktree lock` while a seat runs, and sweep locks left by dead sessions [^1] [^1]. The guard stays a **backstop, not the seatbelt** — with per-seat worktrees plus independent `node_modules`, the residual paths by which a seat can still destroy your uncommitted work are a short, enumerable list (section 4), and you size the guard to exactly those.

---

## 1. `node_modules` in worktrees without the junction

**What `.worktreeinclude` actually does.** A worktree is a fresh checkout of *tracked* files only. `.worktreeinclude` uses `.gitignore` syntax and copies **only files that both match a pattern and are gitignored** — it never duplicates tracked files [^1]. So it is the right tool for `.env`, `.env.local`, `config/secrets.json` [^1], **but it is the wrong tool for `node_modules`**: you *could* write patterns to copy an ignored `node_modules`, but Claude Code deliberately does not carry it wholesale — you are expected to install dependencies in the worktree [^1]. The docs' own example copies two env files and a secrets config, nothing else [^1].

**The junction hazard is real and documented in two places.** Claude Code's own issue #60604: an agent created Windows junctions to share `node_modules` between feature worktrees and the main repo; when `git worktree remove --force` cleaned up, git followed the junctions recursively — `wt\node_modules` → main `node_modules` → npm-workspace junction `@scope/api` → `apps/api` — and **deleted the main repo's `apps/api` source files** [^7] [^7]. The agent chose the junction "to avoid the cost of four parallel `npm install` runs" [^7]. Recommended fixes from that thread: **never create a junction from a worktree into the main repo's `node_modules`; instead `npm install` per worktree (the npm cache makes it fast), or reference `node_modules` via a plain path env var rather than a filesystem junction** [^7].

**Why junctions specifically (vs symlinks) are the trap.** Windows has two directory-link kinds: a **symbolic link** (`mklink /D`, reparse tag `IO_REPARSE_TAG_SYMLINK`) and a **junction** (`mklink /J`, tag `IO_REPARSE_TAG_MOUNT_POINT`). Git for Windows treats only the symlink as a link; its `git clean` has refused to descend into junctions since 2.23, but **the recursive delete behind `git worktree remove` had no such check until Git for Windows 2.54.0 (April 20, 2026)** [^4]. Confirmed on a fixture: **2.53.0 emptied the junction's target; 2.55.0 left it alone** [^4]. A **directory symlink** behaves safely — `git worktree remove` unlinks it and leaves the target alone even on 2.53 [^4]. There is a matching pnpm issue ("NTFS junctions cause catastrophic deletion") and a t3code report that `git worktree remove` follows junctions "with or without `--force`" [^24] [^11].

**Your options, ranked for a native-Windows offline Node suite:**

| Approach | Write-back into live tree? | Per-worktree cost | Notes |
|---|---|---|---|
| **pnpm global virtual store** | No — `node_modules` is symlinks into a shared store | Near-zero disk, near-instant install | "each worktree's `node_modules` contains only symlinks into a single content-addressable store"; new agent installs are "nearly instant" [^5] [^5] [^5] |
| **`npm ci --prefer-offline` per worktree** | No — fully independent install | Cache-hit install, no link | `npm ci` follows the lockfile and removes any existing `node_modules`; `--prefer-offline` reuses the local cache [^10] [^10] |
| **Directory symlink to a shared install** | Only if a tool writes *through* the link; git cleanup is safe | Cheap | Safe for `git worktree remove` (unlinks, leaves target) [^4]; use Developer Mode |
| **Junction to live tree** | **Yes — the F23 hazard** | Cheap | Catastrophic on removal; **do not use** [^7] [^4] |

**pnpm caveats:** the shared store assumes **one trust boundary** — pnpm explicitly warns "Do not use one writable pnpm store for mutually untrusted agents or users" [^5]. If your seats are semi-trusted (they're your own agents), that's acceptable; if not, fall back to `npm ci` per worktree. Also, pnpm's default (non-global) layout hard-links into a per-worktree `node_modules/.pnpm`, which is fine but heavier [^5]. Whatever you choose, **pin Git for Windows ≥ 2.54** so a stray junction can't recur, and if a worktree *must* contain a junction, unlink it non-recursively before removal: `[System.IO.Directory]::Delete($link.FullName, $false)` (PowerShell) or `cmd //c rmdir 'wt\node_modules'` (fails safe without `/s`) [^4].

---

## 2. Git-identity validation: the concrete Windows check

Git gives you the primitives; you compare absolute values:

- `git rev-parse --show-toplevel` → the **working-tree root** (absolute by default; errors if there's no worktree) [^8].
- `git rev-parse --absolute-git-dir` → canonicalized absolute `$GIT_DIR` (unaffected by `--path-format`) [^8].
- `git rev-parse --git-common-dir` → `$GIT_COMMON_DIR` if defined, else `$GIT_DIR` [^8].
- `git rev-parse --is-inside-work-tree` → `true`/`false` membership only; **it does not by itself distinguish a linked worktree from the main checkout** [^8].

**How a linked worktree is laid out** (this is what you validate against): in a linked worktree, `$GIT_DIR` points at the *private* dir (e.g. `/path/main/.git/worktrees/test-next`) and `$GIT_COMMON_DIR` points back at the main worktree's `.git` (e.g. `/path/main/.git`); these are set by a **`.git` file at the top of the linked worktree** [^6]. So the invariant that proves "a command stays in *this* worktree" is:

> `--show-toplevel` == the seat's expected worktree path, **and** `--absolute-git-dir` differs from `--git-common-dir` (private dir is a subdirectory of the common dir's `worktrees/`), **and** the top-level `.git` entry is a **file** whose target is inside the common dir's `worktrees/<name>`.

Concretely, before adopting/using a worktree:

```powershell
$wt = (git -C $seatPath rev-parse --show-toplevel).Trim()
$gd = (git -C $seatPath rev-parse --absolute-git-dir).Trim()
$cd = (git -C $seatPath rev-parse --git-common-dir).Trim()
# 1. toplevel must be the seat's own directory
if ($wt -ne (Resolve-Path $seatPath).Path) { refuse "toplevel mismatch" }
# 2. private git dir must be a worktrees/<name> under the common dir (not the common dir itself)
if ($gd -eq $cd) { refuse "git dir resolves to common dir (main checkout)" }
# 3. the .git entry must be a FILE, not a directory, and point under $cd\worktrees
$gitEntry = Join-Path $wt ".git"
if (Test-Path $gitEntry -PathType Container) { refuse ".git is a directory (main checkout)" }
```

This mirrors what Claude Code refuses on: directories whose git metadata "resolves into the main checkout," e.g. a `.git` file pointing at the main repo's own `.git`, or git resolving the working tree to the main checkout **through a `core.worktree` redirect** — and it also refuses when the `.git` entry can't be read, rather than assuming safety [^1]. Note `core.worktree` "should never be shared" and must not live in the common config if `extensions.worktreeConfig` is enabled [^6] — a mis-set `core.worktree` is precisely the redirect that makes an ordinary `git reset --hard` act on the **main** checkout from inside a "worktree" [^1]. Re-run this check on **create, enter, and reuse** — the same three points where Claude Code checks [^1].

---

## 3. Lifecycle without SIGTERM: lock sweep + Windows-native reaping

**What Claude Code's stale-lock sweep does.** While an agent runs, Claude Code holds a `git worktree lock` so concurrent cleanup can't remove it, releasing it when the agent finishes; backgrounded sessions keep the lock while they run, so the sweep leaves the worktree and `git worktree remove` refuses [^1]. The periodic sweep removes *Claude-created* subagent/background worktrees older than `cleanupPeriodDays`, but **leaves any worktree that still holds work (changed/untracked files or unpushed commits)**, belongs to a non-backgrounded `--worktree` session, was created by you with `git worktree add`, or lacks Claude's marker in the git metadata [^1]. Crucially for your SIGTERM problem: **the sweep also releases a lock Claude Code set for a session whose process has exited**, so a killed background session doesn't leave its worktree permanently locked — and it **never** releases a lock *you* set with `git worktree lock` [^1]. (Known failure modes exist: issues report the recorded PID being a recycled long-lived daemon so liveness checks never fire [^25], locks self-perpetuating [^26], and worktrees never cleaned up at all [^27] — so don't assume the sweep is sufficient.)

**Windows-native equivalent.** Windows has **no SIGTERM** and no maintained process tree — killing a parent does not reap orphaned grandchildren [^28]. The native primitive is a **Job Object**: "a job object allows groups of processes to be managed as a unit," and **`TerminateJobObject` terminates all processes currently associated with the job, including nested child jobs** [^12] [^13]. The standard pattern: create the job *before* spawning children, assign each seat's process tree to it (children inherit the job unless they break away with `CREATE_BREAKAWAY_FROM_JOB`), and kill the whole job on cleanup [^29] [^12]. For a durable queue this gives you deterministic reaping:

- **Job object per seat** with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` so the tree dies when your handle closes — this is the real "no SIGTERM" answer, not PID files.
- **PID files are a weaker fallback**: Windows PIDs are recycled, so a stale PID can point at an unrelated live process (the exact bug Claude Code hit [^25]). If you use PID files, pair the PID with a start-time stamp and validate before trusting it.
- On exit, **release the seat's `git worktree lock`, then `git worktree remove`** — and only after the job object confirms the tree is dead, so no process is mid-write. Claude Code's model (hold lock while running, release on exit, sweep stale locks, never touch human-set locks) is the right shape to copy [^1].

---

## 4. Residual risk with worktrees: what can still reach the main checkout

With per-seat worktrees **and** independent `node_modules`, the live tree is protected against working-file mutation. What remains — size your guard to exactly this list:

| # | Attack path | Why worktrees don't stop it | Mitigation |
|---|---|---|---|
| 1 | **Shared `.git` metadata corruption** | Worktrees share the object store, refs, and index metadata; git commands in a worktree write there [^6] [^1] | Guard: block ref-mutating ops on shared refs (`git update-ref`, force-push, `git branch -D` of shared branches) from seats |
| 2 | **`git worktree remove` following a junction** | Removes files *outside* the worktree via the link [^7] [^4] | No junctions (section 1) + Git ≥ 2.54 + unlink-before-remove [^4] |
| 3 | **Branch deletion / ref moves** | `git branch -D` and `git push --force` act on shared refs | Seats blocked from commit/push already; also deny `branch -D`, `update-ref` |
| 4 | **`git clean`/`reset` run with a redirect into main** | `git -C <main> …`, `--git-dir`, `GIT_DIR`/`GIT_WORK_TREE`, `cd <main> && git …`, or `core.worktree` redirect | Git-identity validation (section 2) + refuse-if-unresolvable guard |
| 5 | **Git hooks are shared** | `.git/hooks/` is shared via `$GIT_COMMON_DIR`, so a `pre-commit` hook runs in every worktree's context and may assume the main layout / `node_modules` paths [^2] | `core.hooksPath` per worktree via `extensions.worktreeConfig`, or ensure hooks are layout-agnostic [^2] |
| 6 | **Cleanup races / lock bugs** | A seat killed mid-run can leave a lock; a sweep bug can remove a worktree holding work [^25] [^27] | Job-object reaping + "never remove a worktree with changed/untracked files" rule [^1] |
| 7 | **A worktree created inside the main repo** | If a worktree lives *inside* the main checkout, deletion/cleanup can touch the parent | Create worktrees as **sibling directories outside the repo** [^2] [^1] |

Net: worktrees remove the *uncommitted-working-file* class entirely, but they leave **shared `.git`** as the live surface. So the guard's job narrows to (a) git redirection into another checkout, (b) ref mutation, and (c) cleanup safety — not to policing every `git` subcommand. That's a much smaller, tractable denylist than the one that failed you.

---

## 5. Queue integration: worktree-per-task, merge-on-complete

**The architectural decision is worktree-per-task vs worktree-per-agent.** Guidance: use **worktree-per-task** when agents are ephemeral and tasks finish in minutes-to-an-hour (worktree created, used, destroyed per item; fresh install each time); use **worktree-per-agent** for long-running specialists that benefit from warm caches and persistent context [^2]. **worktree-per-task is the recommended default**, confirmed in production at incident.io (parallel feature agents) [^2]. For your durable queue — items routed, claimed, completed — **worktree-per-task maps cleanly: one worktree + one branch per queue item**, created on claim, removed on completion.

**Integration workflow.** The whole point is that "conflicts move to merge time, where standard git tooling detects them, instead of happening silently during active work" [^2]. Each worktree gets its own `HEAD`, index, and working dir, so one seat's uncommitted edits are invisible to another and `.git/index.lock` contention disappears [^2]. The practical merge pattern:

- **Branch-per-item, rebase-before-merge.** Rebase the item branch on latest main, then merge; each merge incorporates prior merges and conflicts surface as ordinary git conflicts [^2]. Enable `git rerere` (`git config rerere.enabled true`) so recurring conflict resolutions replay automatically [^2].
- **Operator cherry-pick / merge as the integration step** is exactly what you already do — keep it. Tools that automate at scale (Augment's Intent) keep a human approval gate before execution and a developer review before merge, with a Coordinator sequencing dependent tasks and a Verifier gating quality [^2]. A **FIFO merge queue** (the Overstory framework: "FIFO merge queue with four-tier conflict resolution") is the fleet-scale version [^2].
- **Sequencing constraint:** worktree isolation cannot help when Agent B needs Agent A's *new* interface while both run — those tasks must be sequenced, not parallelized [^2]. Assign seats to **strictly non-overlapping file domains**; git worktrees give no cross-worktree conflict warning [^2].
- **Cleanup:** prefer `git worktree remove` over `rm -rf` (the latter leaves stale `.git/worktrees/` metadata until `git worktree prune`) [^2]. A merged-branch cleanup loop runs as a post-merge step [^2].

Real systems doing per-agent worktrees **asynchronously at scale**: Augment's Intent (Coordinator + specialist agents, worktree-per-Space, BYOA with Claude Code/Codex/OpenCode) [^2] [^2]; the `agent-worktree` tool ("create worktree, run agent, merge, cleanup" — interactive and headless) [^14]; `agent-workspace` (worktree-per-agent, Docker or host mode) [^2]; and a practitioner report of scaling to **371 worktrees** [^2]. Note that most of these are *not* durable-queue systems like yours — your claim/complete lifecycle is closer to Intent's Coordinator model than to interactive tools, so treat Intent's approval-gate + Verifier structure as the closest analogue.

---

## 6. Cost bound: ~9 concurrent worktrees with Node `node_modules`

- **Disk.** With pnpm's global virtual store, per-worktree overhead is **near-zero** — `node_modules` holds only symlinks to one shared store, so 9 worktrees ≈ one store, not 9 copies [^5] [^5]. With independent `npm ci`, you pay ~9× the `node_modules` size, offset by cache-hit install speed [^10]. pnpm also notes "no conflicts — each worktree has its own `node_modules` tree, so agents can install different dependency versions on different branches without interference" [^5].
- **Setup time.** pnpm: "Subsequent installs in other worktrees are nearly instant because they only create symlinks" [^5]. npm: `npm ci --prefer-offline` off the warm cache (one scenario claims 75% faster, but that's a scenario, not measured general guidance) [^10] [^10].
- **MAX_PATH.** This is the real Windows tax: deeply nested `node_modules` trees exceed the ~260-char `MAX_PATH` limit and break installs/execution [^15] [^16] [^17]. Mitigations: enable Windows long-path support (`LongPathsEnabled`) [^16] and/or keep worktree paths **short and shallow** (a short staging root like `C:\wt\<id>` rather than a deep repo path) [^15]. Symlink-based (pnpm) layouts reduce the number of deep physical copies but symlink resolution still traverses long paths, so keep roots short regardless.
- **Bounding/GC.** Use Claude Code's retention model: sweep worktrees older than `cleanupPeriodDays` **but never remove one holding changed/untracked files or unpushed commits** [^1]; automate removal of worktrees whose branch is merged to remote, then `git worktree prune` [^2]; and for ephemeral-only repos, `git config gc.worktreePruneExpire now` [^2]. For 9 seats, cap concurrent worktrees in the queue and GC on completion rather than on a timer — deterministic, and avoids the sweep-races-dead-session bugs [^25] [^27].

---

## 7. Enforcement implementation: parse like the shell, from Node

**Is Codex's Windows PowerShell-AST classifier open-source and reusable?** Codex CLI is open-source, and its Windows command-safety layer ships a **PowerShell AST parser as a script** — `codex-rs/shell-command/src/command_safety/powershell_parser.ps1`, described as "PowerShell AST parser used by the Rust command-safety layer on Windows" [^18]. So yes, it's inspectable and reusable in principle: Codex parses PowerShell via the real PowerShell AST rather than string matching, and forces approval for regions it can't fully inspect [^19] [^20]. The Windows sandbox engineering write-ups describe the same "PowerShell AST Safety Classification" tier [^21] [^20]. Practical caveat: it's a `.ps1` you'd invoke from PowerShell and feed results back to Node — workable on native Windows, but you're borrowing an internal component, not a supported library API.

**Reference implementation usable from Node on Windows.** The closest purpose-built option is **`unbash`**: a fast, **zero-dependency Node/TypeScript Bash parser** that returns a typed, source-positioned AST without executing the command, and explicitly lists "classify scripts for permission prompts, allowlists, or audit findings" as a use case [^9]. It supports commands, control flow, pipelines, redirects, assignments, compound statements, parameter/word expansions, process and nested substitutions, `coproc`, heredocs, herestrings, and generated syntax [^9]. Two important limits: it **parses Bash only** — "zsh, ksh93, mksh, fish, **PowerShell**, `cmd.exe`, csh, Bats" are unsupported and may produce errors or a misleading tree [^9]; and it does **not itself issue a safe/unsafe verdict** — you consume the AST to decide [^9]. For PowerShell you'd pair it with the Codex AST approach or PowerShell's own `[System.Management.Automation.Language.Parser]::ParseInput`. Under the hood, tree-sitter-bash (`tree-sitter-bash`, 0.25.1; `node-tree-sitter`, `web-tree-sitter`) is the general-purpose Bash-grammar alternative if you prefer a grammar you drive yourself [^30] [^22] [^31].

**Why this matters for you:** your `(\s|$)` bug is the structural flaw of string matching — the guard reads the command as text while the shell rewrites it during parsing. A parser-based guard that **tokenizes, expands variables, evaluates substitutions, and inspects pipe destinations and heredocs** is the only class the GuardFall study found sound, and the "refuse what you can't resolve" rule is what Codex and Claude Code both do [^1] [^20] [^9a976a#140-152].

---

## 8. Over-refusal: real cost and how tools keep it tolerable

Over-refusal is a measured, first-class concern: the Amazon **FalseReject** benchmark (May 2025) tested 29 state-of-the-art LLMs across **16,000 seemingly-sensitive-but-harmless prompts spanning 44 safety categories** [^23]. The core finding is a **safety/over-refusal trade-off**: models that reject more toxic prompts (safer) also reject more *safe* prompts (over-refusal), with a positive rank correlation between the two [^32]. For a coding agent the cost is concrete: every false refusal is a **stalled queue item** plus an agent that may improvise around the wall (itself a bypass class). Artificial Analysis now reports safety-refusal events directly in its Coding Agent Index, with fallback models — evidence the field treats this as a quality metric, not just a safety one [^33].

**How tools keep it tolerable** — four patterns, all applicable to your guard:

1. **Allowlist-first, deny only what you can't classify.** Classify by *effect*, allow known-safe reads first, refuse the residue. This shrinks false positives by construction.
2. **Refusal-with-redirect.** Claude Code doesn't just block a git-redirecting command; it "tells Claude how to rewrite the refused command, such as splitting it into plain, separate commands" [^1]. Converting a block into a safe path is the single cheapest way to stop an agent flailing.
3. **Escalate rather than hard-block when uncertain.** Route unclassifiable commands to a human/LLM judge instead of a blanket deny; this is the "ask-list" tier that keeps denylists from being the sole gate.
4. **Measure your own over-refusal rate.** Instrument refusals and count how many were *actually* dangerous vs benign (the FalseReject framing) [^23]; a guard whose benign-refusal rate is high will get disabled or worked around, which is worse than no guard.

The honest trade: a stricter "refuse what you can't resolve" policy lowers false-negatives (good for safety) but raises false-positives (stalls). On a durable queue, bias toward **refuse-and-requeue with a redirect** rather than silent pass-through, and track the benign-refusal count so you can tune.

---

## 9. Instruction design under the ~5–7 rule ceiling

**Put the one safety rule in the always-on file, and enforce it with a hook — do not rely on an on-demand skill.** The evidence:

- **Compliance degrades with context fill and instruction count.** "An agent that follows a rule every time in a test will follow it far less often once its context window fills up," and past a point, adding rules degrades adherence to the rules already there — teams that treat `AGENTS.md` as an append-only dumping ground "watch overall compliance drift down as the file grows, even for rules that used to work" [^3]. This is the same ceiling the earlier instruction-density work found (~3 reliable constraints, ~5–7 must-follow rules) [^eaafb9#25-29] [^eaafb9#93-97].
- **Always-on vs on-demand is empirically contested.** Vercel's head-to-head eval found an always-on `AGENTS.md` hit **100% pass rate** while the skills version topped out at **79%** — "partly because the agent sometimes chose not to load the skill" [^3]. On-demand loading "adds a step the agent can skip, namely deciding to load the skill at all" [^3]. Caveat from the follow-up discussion: that result is specific to Vercel's tasks/model/setup, so measure your own [^3].
- **Mechanically:** `AGENTS.md` "loads every turn" and is always-on context; `SKILL.md` "loads only when needed" with progressive disclosure [^34] [^35]. Skills are best as a **context-management strategy** for routing tasks and reducing overload [^36] [^37] — not as the place for a *safety* invariant, because the invariant must apply unconditionally and the skill mechanism makes loading conditional.

**Recommended structure for a seat's standing rules:**

1. **One always-on top rule** in the seat's system prompt / `AGENTS.md`, phrased as a concrete, testable directive — e.g. "Never run a command that reverts or removes files outside your own worktree; run failing-first checks only via the recipe below." Concrete directives beat vague aspirations ("keep the tree clean") [^3].
2. **A hook that enforces it mechanically**, returning a hard block the agent cannot override — the deterministic layer is "your primary defense," while LLM steering only "improves agent quality but doesn't guarantee prevention" [^d63e2f#138-144] [^01db35#93-100]. Pair with refusal-with-redirect [^1].
3. **Keep the always-on file small**; move project conventions, build commands, and long recipes into a skill the seat reads *when the task matches* [^3] [^34]. Your failing-first recipe (below) is a good skill candidate — but the *prohibition* stays always-on.
4. **Test it with fixtures.** CircleCI's method: pinned fixtures, an observable behavior to assert, a runner, and a checker returning pass/fail; run each fixture several times and track pass rate, because agent output varies run-to-run [^3]. A "does the seat ever mutate the main checkout" assertion is exactly such a checker.

---

## Verbatim safe failing-first recipe (paste into seat instructions) — updated for Windows/Node

```text
FAILING-FIRST VERIFICATION — SAFE PROCEDURE (Windows / Node)

TOP RULE (always in effect): Never run a command that reverts, removes, or
redirects git operations outside your OWN worktree. Your worktree is the only
tree you may modify. The main checkout holds other seats' and the operator's
uncommitted work.

FORBIDDEN, ALWAYS (no exceptions, no workarounds):
  git stash (any form)
  git reset --hard
  git restore / git checkout -- <path>
  git clean -fd
  git apply -R of a diff you produced
  any git command aimed at another directory:
    git -C <other>, --git-dir, GIT_DIR, GIT_WORK_TREE, `cd <other> && git`
  any junction/symlink from your worktree into the main repo's node_modules
  deleting a worktree with rm -rf / Remove-Item -Recurse (use `git worktree remove`)

DEPENDENCIES: your worktree has its own node_modules. Do NOT link it to the
main tree. Install with the project's command (pnpm install, or npm ci
--prefer-offline). The store/cache makes this fast.

DO FAILING-FIRST VERIFICATION IN THIS ORDER; stop at the first method that
answers your question.

METHOD 1 — Order of operations (default, no revert needed):
  1. Write the new test. Do not edit the code under test yet.
  2. Run the test on the current tree.
  3. Confirm it FAILS for the expected reason.
  4. Only now make the code change, and re-run to confirm it passes.

METHOD 2 — Throwaway detached worktree (only if you have ALREADY edited the
code and must prove the test would have failed before your change):

  # scratch dir OUTSIDE the repo; keep the path SHORT (MAX_PATH)
  $scratch = "C:\wt\verify-" + [guid]::NewGuid().ToString('N').Substring(0,8)

  # fresh checkout at HEAD; shares .git objects, not working files
  git worktree add --detach "$scratch" HEAD

  # give the scratch checkout its own deps (never junction into main)
  Push-Location $scratch
  npm ci --prefer-offline        # or: pnpm install --frozen-lockfile
  Pop-Location

  # copy ONLY the new/updated test file(s) in
  Copy-Item -Force .\tests\test_<name>.js "$scratch\tests\test_<name>.js"

  Push-Location $scratch
  <your test command>            # NON-ZERO exit = test fails without the fix
  Pop-Location

  # cleanup: unlink any link first, then remove
  git worktree remove --force "$scratch"
  git worktree prune

BEFORE ANY METHOD-2 GIT COMMAND, verify you are in YOUR worktree:
  git rev-parse --show-toplevel          # must equal your worktree path
  git rev-parse --absolute-git-dir       # must differ from --git-common-dir
If any of these look wrong, or you cannot verify them, STOP and report the
block instead of working around it.

METHOD 3 — Throwaway clone (if worktree setup fails):
  git clone --no-hardlinks . "$scratch" ; install deps there ; run tests ;
  delete $scratch (after unlinking any links inside it).

If you are blocked and think you need one of the forbidden commands, STOP and
report the block instead of working around it.
```

---

## Caveats

- **Worktrees isolate working files, not `.git`.** They share the object store, refs, and index metadata, and git commands in a worktree write there [^6] [^1]. Keep a ref-mutation guard even with worktrees (section 4).
- **The junction fix is version-dependent.** `git worktree remove` only stops following junctions at **Git for Windows 2.54.0**; older versions delete through them [^4]. Pin the version, and still unlink-before-remove for any tree containing a junction [^4]. Note git 2.54+ *leaves the junction in place* rather than unlinking it, so you must clean it up yourself [^4].
- **`.worktreeinclude` will not carry `node_modules` for you.** It copies only gitignored files matching your patterns and never duplicates tracked files [^1]; install deps per worktree [^1].
- **pnpm's shared store assumes one trust boundary.** Do not share a writable store across mutually untrusted agents/users [^5].
- **MAX_PATH is a live constraint.** Deep `node_modules` paths break on Windows without long-path support; keep worktree roots short [^15] [^16].
- **Shared git hooks run in every worktree** and may assume the main layout / `node_modules` paths — configure `core.hooksPath` per worktree via `extensions.worktreeConfig` [^2].
- **No cross-worktree conflict warnings** — assign seats non-overlapping file domains; sequences with real dependencies cannot be parallelized by worktrees [^2] [^2].
- **Lock/cleanup bugs are real.** Reported failures include recycled-PID liveness checks never firing, self-perpetuating locks, and worktrees never cleaned up [^25] [^26] [^27]. Prefer deterministic job-object reaping and GC-on-completion over trusting a timer sweep.
- **Windows sandboxing is real but partial** and mostly about *process* isolation, not your shared-tree problem: Codex's Windows layer uses restricted tokens, synthetic SIDs, dedicated sandbox users, and firewall rules, but the unelevated variant leaves `%TEMP%`/`Everyone`-SID gaps and no firewall rules [^20] [^21] [^38] [^39]. Since you can't use Docker/WSL, process-level confinement plus worktrees is your ceiling.
- **Instruction research is partly vendor/community.** The Vercel AGENTS.md-vs-skills result is setup-specific; measure your own compliance with fixtures rather than inheriting conclusions [^3] [^3]. The strongest empirical anchors remain the instruction-density work [^eaafb9], the denylist-fragility paper [^47c1ba], and the GuardFall study [^9a976a].

**References**

[^1]: [Run parallel sessions with worktrees - Claude Code Docs](https://code.claude.com/docs/en/worktrees) (25%)
[^2]: [How to Use Git Worktrees for Parallel AI Agent Execution | Augment Code](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution) (25%)
[^3]: [AGENTS.md vs. skills: How to steer a coding agent - CircleCI](https://circleci.com/blog/agents-md-vs-skills/) (9%)
[^4]: [git worktree remove Deleted Our node_modules Through a Junction - yaw](https://yaw.sh/blog/git-worktree-remove-junction-node-modules/) (8%)
[^5]: [pnpm + Git Worktrees for Multi-Agent Development | pnpm](https://pnpm.io/git-worktrees) (5%)
[^6]: [Git - git-worktree Documentation](https://git-scm.com/docs/git-worktree) (4%)
[^7]: [Windows: agent-created node_modules junctions from git worktrees cause source-file deletion on worktree remove](https://github.com/anthropics/claude-code/issues/60604) (3%)
[^8]: [Git - git-rev-parse Documentation](https://git-scm.com/docs/git-rev-parse) (3%)
[^9]: [unbash - npm](https://www.npmjs.com/package/unbash) (3%)
[^10]: [npm with worktrees | WorktreeWise](https://www.worktreewise.com/git-worktree/npm) (2%)
[^11]: [[Bug]: Removing a worktree on Windows follows directory ... - GitHub](https://github.com/pingdotgg/t3code/issues/14990) (1%)
[^12]: [Job Objects - Win32 apps](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) (1%)
[^13]: [TerminateJobObject function (jobapi2.h) - Win32 apps](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject) (1%)
[^14]: [GitHub - nekocode/agent-worktree: A Git worktree workflow tool for AI ...](https://github.com/nekocode/agent-worktree) (1%)
[^15]: [Node npm windows file paths are too long to install packages](https://stackoverflow.com/questions/26155135/node-npm-windows-file-paths-are-too-long-to-install-packages) (1%)
[^16]: [Long node_modules paths cannot be found on Windows ...](https://github.com/nodejs/node/issues/50753) (1%)
[^17]: [npm and distribution path length problems - Adam Lynch](https://adamlynch.com/npm-distribution-path-length-problems/) (1%)
[^18]: [Codex CLI: .../command_safety/powershell_parser.ps1](https://fossies.org/linux/codex-rust/codex-rs/shell-command/src/command_safety/powershell_parser.ps1) (1%)
[^19]: [Powershell parser to properly classify commands like bash ...](https://github.com/openai/codex/issues/10557) (1%)
[^20]: [The Windows Sandbox Deep Dive: How Codex CLI Isolates Agent Workloads ...](https://codex.danielvaughan.com/2026/07/18/codex-cli-windows-sandbox-architecture-powershell-ast-safety-elevated-unelevated-appcontainer-restricted-tokens/) (1%)
[^21]: [Inside the Codex Windows Sandbox: Restricted Tokens, Synthetic SIDs ...](https://codex.danielvaughan.com/2026/05/14/codex-cli-windows-sandbox-engineering-restricted-tokens-acls-elevated-architecture/) (1%)
[^22]: [GitHub - tree-sitter/node-tree-sitter: Node.js bindings for tree-sitter ...](https://github.com/tree-sitter/node-tree-sitter) (1%)
[^23]: [When Your Codex Agent Says No: Model Refusals, Safety Boundaries, and ...](https://codex.danielvaughan.com/2026/06/14/codex-cli-model-refusals-safety-boundaries-overrefusal-workaround-patterns-safe-completions/) (1%)
[^24]: [pnpm node_modules NTFS junctions cause catastrophic ...](https://github.com/pnpm/pnpm/issues/10707) (0%)
[^25]: [[Bug] Background session worktree locks not released when session ends ...](https://github.com/anthropics/claude-code/issues/79888) (0%)
[^26]: [`locked` keeps naming the dead PID and no later session ...](https://github.com/anthropics/claude-code/issues/93231) (0%)
[^27]: [Stale worktrees are never cleaned up #26725](https://github.com/anthropics/claude-code/issues/26725) (0%)
[^28]: [subprocess: deleting child processes in Windows - Stack Overflow](https://stackoverflow.com/questions/1230669/subprocess-deleting-child-processes-in-windows) (0%)
[^29]: [Using Windows Job Objects for Process Tree Management](https://nikhilism.com/post/2017/windows-job-objects-process-tree-management/) (0%)
[^30]: [tree-sitter-bash - npm](https://www.npmjs.com/package/tree-sitter-bash) (0%)
[^31]: [web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter?activeTab=readme) (0%)
[^32]: [An Over-Refusal Benchmark for Large Language Models](https://icml.cc/virtual/2025/poster/46052) (0%)
[^33]: [Safety refusal reporting in the Artificial Analysis Coding ...](https://x.com/ArtificialAnlys/status/2105755934253568428) (0%)
[^34]: [AGENTS.md vs SKILL.md: What's the Difference and When to Use Both (2026)](https://thepromptshelf.dev/blog/agents-md-vs-skill-md-difference-2026/) (0%)
[^35]: [Deep Dive SKILL.md (Part 1/2) - A B Vijay Kumar](https://abvijaykumar.medium.com/deep-dive-skill-md-part-1-2-09fc9a536996) (0%)
[^36]: [Agent Skills, Stripped of Hype](https://stevekinney.com/writing/agent-skills) (0%)
[^37]: [Agent Skills Explained: What They Are, What They Aren't, ...](https://dev.to/loc_carrre_0d798813c662/agent-skills-explained-what-they-are-what-they-arent-and-how-to-use-them-bf9) (0%)
[^38]: [codex sandbox help still describes Windows as restricted- ...](https://github.com/openai/codex/issues/25566) (0%)
[^39]: [Help test experimental Windows sandbox · openai codex](https://github.com/openai/codex/discussions/6065) (0%)