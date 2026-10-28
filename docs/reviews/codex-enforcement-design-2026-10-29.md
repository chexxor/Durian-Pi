# Design note — how shipped harnesses enforce destructive operations (ROADMAP 241: research before 232)

**Written:** 2026-10-29, delegate. **Status: 241's guard axis answered; 241 stays open** (see §5 for what I did not
read). **This is not 232 and must never be reported as it.** Nothing here was built or changed in `src/`; the broker's
own destructive call (`src/broker.mjs:1167` → `src/worktree.mjs:649`) still runs where no outer harness can see it, and
232 stays unclaimed per the operator's ruling of 2026-10-29 (D158: *"Do more research before proceeding onto roadmap
232."*).

**Sources, all reproducible without this session:**
- **Codex CLI — `observed`:** `vendor/eval/codex · d373d649` (2026-10-28, Apache-2.0, `--depth 1`). Paths below are in
  that tree; `node tools/vendor-pins.mjs --check` covers the pin.
- **pi — `observed`:** upstream `@1.4.0` `.ts` recovered read-only from the installed package's `dist/**/*.js.map`
  `sourcesContent` (251 files, recipe in `docs/COMPETITORS.md` §"The 2026-10-29 tool-and-skill lifecycle sweep"). Line
  numbers are to **pi 1.4.0 upstream** and drift on upgrade — re-extract, never trust them across versions.
- **GitHub Copilot CLI — `advertised-elsewhere`:** its own issue tracker. **Cursor — `advertised-elsewhere`:** vendor
  docs, re-confirmed on the live page 2026-10-29. **No clone of either has source** (`copilot-cli 84ee80ea` is
  README/`install.sh`/changelog; Cursor publishes none).

## 1. Where the rule lives, and who can write it

| system | where a deny/allow rule lives | can a repo commit propagate it to a teammate? |
|---|---|---|
| **Codex** `observed` | **one declarative rules file per config layer**: `load_exec_policy` iterates `config_stack.layers_low_to_high()` and loads `config_folder()/rules/*.rules` from each, later layers overriding earlier (`core/src/exec_policy.rs:664-690`, loop at `:671`); the user store is `$CODEX_HOME/rules/default.rules` (`:875`, `RULES_DIR_NAME`/`DEFAULT_POLICY_FILE` at `:54-56`). **The project layer is a real layer**, and the trust decision is expressed by *disabling* it: *"Disabled project layers already represent the trust decision, so hooks and exec-policy loading can reuse the normal trusted-layer view"* (`:665-668`). Above all layers sits a **requirements** tier (`config_stack.requirements().exec_policy`, `:713`) — an admin/org layer a repo cannot override. | **Yes**, with a trust gate — the shape our rig has no equivalent of. |
| **pi** `observed` | no rules file. A guard is **code**: a `tool_call` handler in a project extension (`.pi/extensions/`, auto-discovered `package-manager.ts:2484-2491`), inert until project trust (`package-manager.ts:2465-2467`). | Yes (repo-committed extension + one trust click), but the policy lives in imperative code, not data. |
| **Copilot CLI** advertised | a rules flag/config (`--deny-mode "command:git worktree prune"`, `sandbox:workspace-write`). | Claimed. The "no way to reload a changed rules file without restarting" claim sits on an **undefined anchor** in the round-2 report and is **unverified**; the nearest real issue the delegate found is [#4508](https://github.com/github/copilot-cli/issues/4508) *"reload `.github/instructions` mid-session"* — about **instructions**, not deny rules. What is verified about this harness's guards: [#2893](https://github.com/github/copilot-cli/issues/2893), [#3590](https://github.com/github/copilot-cli/issues/3590), [#2540](https://github.com/github/copilot-cli/issues/2540), [#5098](https://github.com/github/copilot-cli/issues/5098) — see §2. |
| **Cursor** advertised | `.cursor/hooks.json` at project or user level; `permission: allow\|deny\|ask` + `matcher` regex over the **full command string**. | Claimed (project-level file). |

**Codex's approval persistence is a rules append, not only a cache:** an interactive approval becomes a prefix rule via
`blocking_append_allow_prefix_rule` (`codex_execpolicy`, imported at `core/src/exec_policy.rs:20`), and whether an
approval becomes reusable is gated by the **model's** capability to honour prefix rules:
`auto_amendment_allowed = allow_prefix_rules == AllowPrefixRules::Honor`, with the comment *"Avoid reusable approvals
when this model does not honor prefix rules"* (`:359-360`). So reusability of a grant is a property of the *model*, not
just of the config — a subtlety none of our instruments model.

## 2. What happens when the guard itself breaks — the axis that decides our design

| system | guard fails ⇒ | class | evidence |
|---|---|---|---|
| **Codex** | **fails OPEN (silent allow).** A hook that errors, exits non-zero (other than 2 with a reason), exits with no status code, returns malformed JSON, or returns an **unsupported** `permissionDecision` (e.g. `ask`, `approve`) ⇒ `status = Failed` **and `should_block = false`**. Exit 2 with **empty stderr** ⇒ `Failed`, no block. Input-serialization failure ⇒ `serialization_failure_outcome` with `should_block: false`. | observed | `hooks/src/events/pre_tool_use.rs` — `parse_completed` and `serialization_failure_outcome`; the vendor's **own test names** are the clearest citation: `unsupported_permission_decision_fails_open`, `deprecated_approve_decision_fails_open`, `exit_code_two_blocks_processing`, `invalid_json_like_stdout_fails_instead_of_becoming_noop` (status fails, call still proceeds) |
| **Codex (asymmetry)** | **rule *loading* fails LOUD.** A missing/unparsable rules file returns `Err` (`ExecPolicyError::ReadFile` / `ParsePolicy`, `core/src/exec_policy.rs:244-271`) — the session does not start with a half-parsed policy. Config-time loud, run-time quiet. | observed | same file |
| **pi** | **fails CLOSED, and loudly.** `emitToolCall` wraps its handler in **no** try/catch (`src/core/extensions/runner.ts:1248-1266`), and the caller re-throws: `throw new Error(\`Extension failed, blocking execution: ${String(err)}\`)` (`src/core/agent-session.ts:668-680`). Contrast `emitUserBash`/`emitProjectTrustEvent`, which *do* catch and record (`runner.ts:317`, `:1277-1291`) — pi chose different contracts per event, deliberately. | observed | those two files |
| **Copilot CLI** | **guards silently do not run.** Its own tracker: hooks bypassed under parallel dispatch with a **`timeout->allow` fallback** ([#2893](https://github.com/github/copilot-cli/issues/2893)); an `ask` decision **auto-approved** by the TUI ([#3590](https://github.com/github/copilot-cli/issues/3590)); **plugin-defined `hooks.json` hooks never fire**, main session or subagents ([#2540](https://github.com/github/copilot-cli/issues/2540)); a `sessionStart` hook stops running once `sandbox.userPolicy.filesystem` paths are added ([#5098](https://github.com/github/copilot-cli/issues/5098)) | advertised-elsewhere — all four **fetched and title-checked 2026-10-29**, copies sha256-pinned in `inputs/fetched/MANIFEST.md` §3. *Not* cited here: #978/#4438, which are skills issues (see §6 of this file's naming note and `MANIFEST.md` §3) |
| **Cursor** | **fails OPEN by default**; `failClosed: true` flips it — *"hook failures (crash, timeout, non-zero exit code, no output) block the action instead of allowing it through"* (live page, 2026-10-29). **Opt-in.** | advertised-elsewhere | `https://cursor.com/docs/hooks` |
| **Cline (the rule plane, not hooks)** | **fails OPEN on a malformed guard rule.** *"If frontmatter can’t be parsed, Cline **fails open**. The rule activates with raw content visible to help debugging"* — the rule still *activates*, with its unparsed body as content. Same failure class on a different plane: a guard whose config broke is not absent, it is **live and wrong**. | advertised-elsewhere, **found verbatim 2026-10-29** | `https://docs.cline.bot/features/cline-rules` — our copy is sha256-pinned in `inputs/fetched/MANIFEST.md` §2 |

**The pattern, stated so it can be cited:** of the five guard/rule designs I can inspect, **four degrade to allow** and the
one that does not (pi) does so by crashing the turn. Nobody in this sample has found how to be *both* non-fatal and
fail-closed. That is the design bar for ROADMAP 238, not an optional nicety: a guard that cannot tell the difference
between "no rule matched" and "my rule never parsed" is worse than no guard, because it manufactures the belief of
protection.

## 3. Codex protects the *git plane* by reachability, not by verb-matching — the finding that reframes 232

`codex-rs/core-plugins/src/git_policy.rs` (85 lines, `observed`):

- It strips **18 git environment variables** that could redirect a git process to an untrusted repository or inject
  command-scoped settings: `GIT_DIR`, `GIT_WORK_TREE`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CONFIG`,
  `GIT_CONFIG_PARAMETERS`, `GIT_INDEX_FILE`, `GIT_CEILING_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_NAMESPACE`,
  `GIT_OBJECT_DIRECTORY`, `GIT_PREFIX`, `GIT_SHALLOW_FILE`, `GIT_GRAFT_FILE`, `GIT_REPLACE_REF_BASE`,
  `GIT_DISCOVERY_ACROSS_FILESYSTEM`, `GIT_IMPLICIT_WORK_TREE`, `GIT_CONFIG_COUNT`, `GIT_OPTIONAL_LOCKS`
  (`REPOSITORY_LOCAL_GIT_ENVIRONMENT_VARIABLES` at `:7-24`, removed in the loop at `:44`).
- Every plugin git command gets `-c safe.bareRepository=explicit` (`:41`; the constant's value at
  `git-utils/src/lib.rs:16`).
- Two modes (`PluginGitMode`, `:29-36`): **`Automatic`** (background git the agent initiated) versus **`Manual`**
  (explicitly user-requested git, which *keeps* repository-scoped config). Automatic mode additionally sets
  `GIT_OPTIONAL_LOCKS=0` (`:43`) and — the decisive part — `configure_trusted_git_repository` (`:56-85`) **builds a throwaway
  repository** under `$CODEX_HOME/.tmp/git-*`, writes `HEAD` and `objects/`+`refs/` into it, and points `GIT_DIR` at it,
  after verifying the staging root cannot escape Codex home (`:69`). The returned `TempDir` guard must stay alive
  until the git process exits (`:54-55`).

**Why this matters more than the hook findings.** Our framing of 232 has been *interception* — catch the verb before it
runs — and we established that interception cannot work for the broker's own call, because it is the product calling
itself. Codex never tries. It **removes the target from reach** for operations the agent started on its own, and keeps
the real repository for operations a human asked for. Translated to our rig, the question 232 should ask is not "how do
we block `git worktree prune`?" but **"which of the rig's own automatic git operations need the real `.git/worktrees`
admin directory at all, and can they be run against a scratch one — with the real one reachable only from a path a
human asked for?"** That is a design option our incident record never considered, and it is testable in the disposable
clone at `/home/chexxor/Git/Durian-Pi-ops` rather than on the working checkout.

## 4. Is the decision recorded anywhere a reviewer can read?

- **Codex — yes, in-band.** Every hook run becomes a `HookCompletedEvent` with `HookRunStatus`
  (`Completed`/`Failed`/`Blocked`) and typed `entries` (`Error`/`Warning`/`Feedback`/`Context`), and the run id embeds
  the hook's **source path** and the `tool_use_id` (`pre_tool_use.rs`, `common::hook_completed_for_tool_use`; test
  `preview_and_completed_run_ids_include_tool_use_id` shows the id form
  `pre-tool-use:0:/tmp/hooks.json:tool-call-123`). The session rollout is flushed around hook work
  (`core/src/hook_runtime.rs:490,538` → `sess.flush_rollout()`). So "the guard blocked it, and *why*" is
  reconstructable after the fact — and so is "the guard failed", because `Failed` is a distinct status. **A status of
  `Failed` on a security-relevant hook is the audit signal the other three designs lack.**
- **pi — no equivalent.** A `tool_call` handler that blocks produces a block result for that turn; there is no
  per-decision record object, and a throw becomes an error message in the turn (`agent-session.ts:679`). This is
  exactly why ROADMAP 238's acceptance must include "the guard prints its own loaded-rule set and last decision", rather
  than trusting an absence of incidents.
- **Copilot CLI / Cursor — not established.** Round 2 found no reviewer-readable decision log; I have no source to
  check. Record as `not found`, not as absent.

## 5. What I did **not** read (241 is not closed)

Read but not analysed here: `core/src/config/permissions.rs`, `permission_profile_catalog.rs`, `permissions_toml.rs`,
`requirements_layers/permissions.rs` (the **permission-profile** tier — sandbox/scope modelling, which is where
"who can bypass" is really decided); `core/src/config/permission_path.rs`; `network_policy.rs` and
`network_policy_decision.rs` (the network plane, a different blast radius); `auth_policy.rs`;
`requirements_exec_policy.rs` (admin override semantics); the **out-of-band hook-trust persistence** round 2 reported in
an `mcp-oauth` shape — I confirmed `ConfiguredHandler` carries `builtin`, `plugin_trust` and `source: HookSource::User`
and that `can_apply_control_effects()` gates whether a handler may block at all
(`pre_tool_use.rs:268`; `serialization_failure_outcome` at `:319-327`), **but I did not find where `plugin_trust` is
stored**, so round 2's out-of-band claim stays `advertised-elsewhere` and unconfirmed.

**Next reads for 241, in priority order:** (1) where `plugin_trust` and `can_apply_control_effects()` come from — that
is the "who can bypass" answer, and it decides whether a project-committed hook can block anything; (2)
`permission_profile_*` — the reachability model, which is now the more valuable half given §3; (3) requirements layers,
for the admin-override shape; (4) only then 232's design options. **Cline's** rule-frontmatter semantics are now confirmed
by quote (§2 — malformed frontmatter **activates the rule anyway**), but its `clinerules` *implementation* is still unread
now that `cline 51f63e4f` is pinned source-grade: read the tree rather than re-quoting the marketing page.

## 6. What this changes in our register (no code, no queue action taken)

1. **238 gains a hard requirement** it did not have: the guard must be **fail-closed and self-attesting** — it must
   state at startup which rule set it loaded, and a malformed rule must stop the session (Codex's load-time loud /
   run-time quiet split is the cautionary design), with a test that a throwing/broken guard blocks rather than allows.
   pi's contract already gives this at the cost of a crashed turn (`agent-session.ts:679`); the design work is to make
   it non-fatal **and** closed, which the sample shows nobody has.
2. **232's question is now sharper, and cheaper.** §3's reachability design can be probed in the disposable clone
   (`/home/chexxor/Git/Durian-Pi-ops`) with no product code: run the broker's maintenance path against a scratch
   `GIT_DIR` and see what actually breaks. That is a rehearsal, not a fix, and it belongs to the seat that claims 232.
3. **A new instrument candidate, registered not built:** both vendors distinguish *no rule matched* from *the guard
   broke*. Our delegate has no way to distinguish them in pi. A `guard-status` instrument (loaded extensions, registered
   `tool_call` handlers, last block decision) would; that is 235's package, and I did **not** write it. Copilot CLI's
   tracker shows why this matters more than a guard alone: **#2540** (*plugin-defined hooks never fire*) and **#5098**
   (*a sandbox config change stops a hook running*) mean **an installed guard that is not firing looks exactly like one
   that is working** — so the instrument is not polish, it is how you know the guard exists.
4. **A naming correction the delegate owes this file.** An earlier draft cited **#978/#4438** for Copilot CLI's fail-open
   behaviour. Those issues exist and are correctly cited by the round-2 report, but for its **skills** claims ("Skills are
   not used unless explicitely stated"; "`disable-model-invocation: true` makes a skill unreachable, not manual-only") — the
   hooks attribution was introduced in folding. The verified hooks issues are **#2893/#3590/#2540/#5098** (§2). Protocol now:
   **fetch the cited pointer and read its title before repeating a claim** (`docs/runbooks/research-request.md` Do 5, D159).
5. **Nothing here justifies touching `src/` today.** 232 unclaimed; no suite from this checkout
   (`docs/incidents/2026-10-29-windows-vm-suite-self-sweep.md`).
