# Design note 2 — the permission planes, the requirements ratchet, and where plugin trust lives
### ROADMAP 241, second half: the files the first note listed as unread, read at the pin

**Host and clock (ROADMAP 244 discipline):** read on `Alex-Desktop-Win10` (Linux, Fedora kernel
`7.2.11-200.fc44.x86_64`, node v24.22.1), zone `America/Chicago` (CDT = UTC−5). The reads below ran
**2026-10-29T02:42–03:05Z**, which on this host's own calendar is still **2026-10-28** — that is the date in
the filename, and every timestamp in this file is **Z** unless marked host-local.

**Pins read (both `--depth 1`, both HEAD-verified in the same command that read them):**
`vendor/eval/codex` at `d373d649673ca8a5bca71f54be0ae47dbd79b466`; `vendor/eval/cline` at
`51f63e4fd63aeeb74d708b9c3d1f8b800aff9b3e`. `node tools/vendor-pins.mjs --check` → **PASS, 14 clones**
(run in this session, 2026-10-29T02:44Z).

**Evidence class for everything below is `observed`** — a file opened at the pin, with the line number. Not one
claim in this file comes from a summary, and no line count here is quoted without being measured in the same
session as the write. Re-open any row with
`sed -n '<start>,<end>p' vendor/eval/codex/<path>` (the clones are on disk; they are gitignored, so a reader
on another host re-fetches at the sha in `docs/VENDOR-PINS.md`).

**This is 241, not 232.** No product file was opened with an intent to change it, `src/worktree.mjs:649` and
`src/broker.mjs:1167` were not touched, nothing was claimed, and **no suite was run from this checkout**
(the 232 gate). Design options appear in §8; choosing one is the operator's and the seat's call.

---

## 1. There are two planes, and the one above is **deny-only and additive** — a ratchet

Ordinary config layers and the **requirements** tier are different objects with different merge algebras.

Layer precedence, measured (`codex-rs/config/src/config_layer_source.rs:33-50`): `PackagedDefaults −10`,
`Mdm 0`, `System 10`, `EnterpriseManaged 15`, `User 20` (`21` with a profile selected), **`Project 25`**,
`SessionFlags 30`, legacy managed `40/50`. So a repository *does* outrank the user's own config for ordinary
settings — which makes the second plane load-bearing rather than incidental.

**No project layer exists in the requirements plane.** `RequirementSource` has exactly these variants
(`codex-rs/config/src/config_requirements.rs:48-72`): `Unknown`, `MdmManagedPreferences{domain,key}`,
`Composite{sources}`, `EnterpriseManaged{id,name}`, `SystemRequirementsToml{file}`, and the two legacy managed
sources. There is **no `Project` and no `User`**. A repository cannot raise a requirement at all.

**Within that plane the merge is monotonic — it can only tighten:**
- exec rules are **additive**: *"Requirements rules are additive across layers. Higher-priority rules are
  appended first so the final rule order keeps priority visible"* (`requirements_layers/rules.rs:1-2`).
- filesystem denials are **additive**: *"`permissions.filesystem.deny_read` is intentionally additive across
  requirements layers"* (`requirements_layers/permissions.rs:1-2`), unioned with a dedup at
  `:33-38` and `:64-69`.
- hook events are **append-only**, and a conflict on the single usable managed-hook directory **fails closed**
  (`requirements_layers/hooks.rs:1-5`, asserted in `requirements_layers/stack_tests.rs:1317,1346`).

**And the requirements tier cannot grant, only restrict** — this is a parse error, not a convention:
`RequirementsExecPolicyDecisionToml` accepts `allow|prompt|forbidden` (`requirements_exec_policy.rs:40-46`), yet
`AllowDecisionNotAllowed` fires with the text *"rules prefix_rule at index N has decision 'allow', which is not
permitted in requirements.toml: Codex merges these rules with other config and uses the most restrictive result
(use 'prompt' or 'forbidden')"* (`:81-84`). A rule with an empty justification (`:75`) or a missing decision
(`:78`) is also a parse error. **Every admin rule must state a reason, and cannot widen what is allowed.**

*Why this is the finding for us:* `docs/DECISIONS.md` D158 wants repo-carriable delegate instruments and a guard
a repo cannot self-authorize. 245 covers the *trust* half. This is the other half — **who may tighten, and in
which direction the merge moves.** Our rig has no equivalent of either.

## 2. A profile's availability is *computed*, and a policy a candidate cannot enforce disqualifies the candidate

The catalog handed to clients is not a list of what is configured; it is a list of what is **usable**, and
`allowed` is derived by *trying*: `PermissionProfileCatalogEntry { id, description, allowed }`
(`core/src/config/permission_profile_catalog.rs:21-27`), built by compiling each profile and testing it against
the requirements (`:71-87`). **A profile that fails to compile is `allowed:false`, not an error** — availability
fails closed.

The load-bearing validator: if a managed `deny_read` is in force, then any profile whose sandbox mode is
`DangerFullAccess` or `ExternalSandbox` is **rejected**, with the error naming the field, the candidate, the
allowed set **and the requirement source that demanded it** (`:129-144`). Its doc comment explains the ordering:
*"Add this validator before applying profile requirements so the native constrained fallback can replace
full-access or external candidates"* (`:127-128`). So a restriction is never silently dropped by a mode that
cannot honour it — **the mode loses, not the restriction.**

Profile definitions themselves are declarative and `deny_unknown_fields`-strict:
`PermissionProfileToml { description, extends, workspace_roots, filesystem, network }`
(`codex-rs/config/src/permissions_toml.rs:112-118`), `extends` resolved parent-before-child with cycle
detection (`:36-60`, `PermissionProfileResolutionError` at `:122-135`), network domain and unix-socket rules
each carrying `allow`/`deny` (`:247-322`).

## 3. The rule grammar rejects escape at parse time

Path facts in a permission rule are validated by the grammar, not by the sandbox: a filesystem path *"must be
absolute, use `~/...`, or start with `:`"* (`core/src/config/permission_path.rs:26-30`), and a subpath *"must be
a descendant path without `.` or `..` components"* (`:55-61`) — the check at `:46-49` walks every component and
rejects interior `.`/`..`. Glob characters are detected per-platform, including after Windows device-path
normalisation (`:63-71`). **A rule cannot be written in a form that resolves outside the root it names.**

## 4. The fail direction, per plane and per event (241 asked: what happens when the guard itself breaks?)

| Plane / event | What breaks | What happens | Where |
|---|---|---|---|
| exec-policy **load**, config layers | one `*.rules` file fails to parse | **every** user+project rule is dropped; the policy becomes the requirements-only policy, plus a surfaced warning | `core/src/exec_policy.rs:647-662` (`ParsePolicy` arm → `Policy::empty()`/requirements, `Some(err)`) |
| exec-policy **load**, requirements | bad admin rule | hard error at parse (`AllowDecisionNotAllowed`, `EmptyPattern`, `MissingDecision`) — admin rules never degrade | `config/src/requirements_exec_policy.rs:58-85` |
| exec-policy **match**, nothing matched | no rule for the command | **not** default-allow: if the command is flagged dangerous *or* there is no sandbox, `Prompt`, and `Forbidden` when prompts are disabled (`:801-812`); otherwise `Allow` **explicitly "relying on the sandbox for protection"** (`:818-819`) | `core/src/exec_policy.rs:777-860` |
| hook **trust** | repo/plugin hook with no user blessing | listed in `hook_entries` with `trust_status`, **not** pushed to `handlers`; a handler runs only when `Managed \| Trusted` or trust is explicitly bypassed | `hooks/src/engine/discovery.rs:881-928`, `:1000-1017` |
| hook **contents** | plugin bundle edited after approval | re-hashed **at each execution**; mismatch → error `plugin contents changed; hook approval required`; the verification is cancellation-aware (dropping the future cancels the scan) | `hooks/src/engine/plugin_trust.rs:29-66` |
| hook **timeout** | — | `SessionEnd` and `Interrupt` default to 1 s and are capped at 3 s; other events keep the 10-minute default | `discovery.rs:946-948` (doc comment, measured) |
| plugin **trust store** unreadable | `.hook-trust` baseline write races | `persist_noclobber` → first writer wins, then read back; the trust decision is never made by guessing | `plugin_trust.rs:104-112` |

**The split that matters for us:** in Codex the **admin plane fails closed and loudly**, while the **repo plane
fails open and quietly-with-a-warning**. ROADMAP 238's acceptance ("a malformed rule must stop the session") is
aimed at exactly the second row of that pair — and Codex is a cautionary example, not a model, because a typo in
one repo rule file removes *all* repo rules for that session.

## 5. Where plugin trust is persisted — the gap the first note left open, closed

`legacy_trust_path(stack, plugin_id)` finds the **first `User` layer**, takes its config file's parent, and
derives `<user config dir>/.hook-trust/<sha256(len‖config_file_path ‖ len‖plugin_id)>` — one small file holding a
content-hash baseline (`plugin_trust.rs:72-95`). Writing it uses a temp file + `fsync` + `persist_noclobber`
(`:97-113`), i.e. **immutable, first-writer-wins**. Alongside it, the user layer carries
`HookStateToml { enabled, trusted_hash, trusted_content_hash }` (`config/src/hook_config.rs:30-38`), and the two
hashes are kept separate on purpose — *"Approved plugin contents; kept separate for declaration-only clients"*
(`:35`), with the composite run key built as `"{declaration_hash}/{content_hash}"` (`discovery.rs:836-840`).

Consequences we should copy deliberately: **`git diff` can never show a plugin grant** (it lives in
`$CODEX_HOME/.hook-trust`, outside the repo); **editing the guard invalidates it** (`verify()` runs per
execution, not at install); and **disabling is not the same act as un-trusting** (`enabled` is a separate field,
and `hook_enabled` is default-on unless explicitly `false`: `discovery.rs:1019-1021`).

## 6. May a repository carry a hook **definition**? Yes — and three things follow

The first note closed the *state* question. The definition question closes the other way: `discover_handlers`
iterates **all** config layers low→high (`discovery.rs:156`) and reads each layer's `hooks_config_folder()` and
its `[hooks]` TOML; `hook_metadata_for_config_layer_source` maps `Project` → `(HookSource::Project,
is_managed = false)` (`:1029-1045`; asserted in the test at `:1926-1931`). So:

1. **a repo may carry a guard** — `hooks.json`/`[hooks]` in the project layer is discovered like any other;
2. **a repo may not bless it** — it lands `Untrusted`/`Modified` and is excluded from the run set (§4);
3. **an admin requirement can delete the whole non-managed plane** — `allow_managed_hooks_only`
   (field at `discovery.rs:105-107`, the gate *`!self.allow_managed_hooks_only || source.is_managed*` at `:114`,
   read from the requirements layer at `:134-139`), and requirement-supplied managed hooks are registered
   `HookRequirement::Required` (`:265`, in `append_managed_requirement_handlers` at `:241-280`), so their failure
   is collected as a `required_load_error` rather than a silent skip (`:83`).

That is the exact shape D158 needs: **definition in the repo, enablement above it, and a top plane that can
force the guard on.**

## 7. Cline at `51f63e4f` — a shipped worked example, and the load-report data model 235 lacks

Cline's own examples directory ships the guard we are contemplating. Its header is the cleanest statement of the
235/238 rationale found anywhere in the corpus: *"A rule in AGENTS.md / .clinerules ("never read .env files") is
a suggestion the model can ignore. This plugin makes it a hard guarantee: the beforeTool hook sits in the
execution path, so the tool call literally never runs"*
(`sdk/examples/plugins/env-blocker.ts:4-6`). Mechanics: `manifest { capabilities: ["hooks"] }` (`:88-90`),
`hooks.beforeTool({toolCall, input})` returning `{ skip: true, reason }` (`:93-113`) — and it keeps
`.env.example|sample|template` readable (`:22-33`), i.e. carve-outs are written down, not improvised.

**The lesson that transfers to a verb-matching guard:** most of the file is *argument-shape* coverage.
`extractFilePaths` visits `path`, `files`, `file_paths`, `paths` and recurses through arrays and objects
(`:42-61`); `extractShellCommands` accepts string, array, `command`, `commands`, `cmd` (`:64-83`). A guard that
reads one field name is a guard with a hole in it. **Our 232 rule must enumerate shapes, not spellings.**

**And the self-attestation data model we do not have:** Cline types the failure of a guard to load.
`PluginLoadDiagnostics { failures: [{pluginPath, pluginName, phase: "load" | "setup", message, stack}],
warnings: [duplicate_plugin_override] }`
(`sdk/packages/core/src/extensions/plugin/plugin-load-report.ts:1-20`); the resolver returns
`disabledPaths` and `discoveryFailures` separately — *"paths that cannot be resolved come back as
`discoveryFailures`, and paths turned off in settings come back as `disabledPaths`, so callers can report both"*
(`plugin-config-loader.ts:190-198`, populated at `:201-224`) — and the session surfaces *"Plugins the session
asked for but does not have (failed, disabled)"* (`:343`). That is ROADMAP **246**'s per-decision record and
235's `guard-status` already shaped: **disabled ≠ failed ≠ absent ≠ loaded-but-overridden.**

## 8. What this changes for 232 — options and a rehearsal, no code

The first note reframed 232 from "intercept the verb" to "make the plane unreachable". Reading the permission
planes sharpens it into four separable options, which are **not** mutually exclusive:

- **R — reachability (cheapest).** Ask which of the broker's own *automatic* git operations need the real
  `.git/worktrees` at all; point the automatic ones at a throwaway git dir the way Codex does for
  agent-initiated git (`core-plugins/src/git_policy.rs:7-85`, cited in the first note §3). Rehearsable in the
  disposable clone `/home/chexxor/Git/Durian-Pi-ops` with **no product change**.
- **T — trust split (245).** The rule may live in this repo; *enabling* it must be recorded outside the repo and
  keyed to the rule's content hash (`plugin_trust.rs`, §5). Rehearsable as a file shape, not as a product feature.
- **C — capability consistency (new, §2).** If a confinement policy cannot be honoured by the code path that is
  running, the *path* loses: the maintenance sweep must declare what it needs, and a sweep that cannot honour the
  declared confinement is refused rather than run loose. Codex's `deny_read` validator (`:129-144`) is the model.
- **L — load report (new, §7).** Before the broker's first pass each session, print the loaded guard set, its
  phase-level load failures, and its last decision — so "no incident" is never read as "the guard ran".

**Probe plan (rehearsal only, in the clone):** (1) scratch repo + one registered worktree; (2) run the
maintenance path against a scratch `GIT_DIR`/`--git-dir`-free invocation and record what actually breaks;
(3) measure the worktree ledger before/after with `git worktree list --porcelain` per
`docs/runbooks/workspace-move.md`. **Not to be run from this checkout while 232 is open.**

## 9. What I did **not** read (so 241 is still not fully closed)

`core/src/config/permissions.rs` (**883** lines, `wc -l` at the pin 2026-10-29T02:47Z) — read only for the
exports the catalog uses, not end to end. `codex-rs/config/src/auth_policy.rs` — exists at the pin and **unread**
(241 named it); I opened its first three lines only, which are `use codex_protocol::config_types::ForcedLoginMethod;`
and the doc comment *"Authentication restrictions supplied by locally managed requirements."* — enough to know what
plane it guards, not enough to claim anything about how. `network-proxy/src/network_policy.rs` (**1142**) — only the core adapter
(`core/src/network_policy_decision.rs`, read in full: decisions are `deny|ask`, block reasons are named —
`denied` / `not_allowed` / `not_allowed_local` / `method_not_allowed` / `proxy_disabled` — and the user-facing
message says whether the block is *approvable from this prompt* (`:46-72`); admin-denied ≠ not-on-the-allowlist,
and an approval becomes an exec-policy rule **with a justification string** (`:74-101`). `permission_profile_selection.rs`,
`permission_profile_intersection.rs` (425), `discovery.rs` lines 400-800 and 1050-1900, `cline`'s
`user-instruction-config-loader.ts` (757, only its parse-failure surface grepped: `parseError` is carried, and
a bad frontmatter is a thrown `Error` at `:358-360`, `:388-390`).

**No claim in §1–§7 depends on anything in this section.** Two things round 2 asserted and I did not re-check:
Copilot CLI's per-event failure direction (its clone is README+changelog only — `docs/VENDOR-PINS.md`), and the
Goose permission judge.

## 10. Register changes made by this note

- **241** — the "still unread" list is discharged except `auth_policy.rs` and `permissions.rs` end-to-end; the
  two questions it was open on ("who can bypass", "may a project carry a hook definition") are **answered at the
  pin** (§5, §6). Recorded in the row itself, with the residual gap named rather than papered over.
- **247 registered** — the requirements ratchet: a plane that can only tighten, cannot grant, and disqualifies
  candidates that cannot honour it. Our rig has no such plane and `rig.selfdev.json`/`durig.config.json` merge
  in the opposite direction (later file wins, both directions).
- **248 registered** — the guard-status data model: `enabled` / trust status / load phase / override, kept
  distinct, reported per component. This is 235's `guard-status` and 246's record, specified by example.
- **Nothing** in this note claims 232, starts a channel, or changes `src/`.

---

## Appendix A — the self-check that produced the "58 of 59" number in `docs/NEXT.md`

Before publishing, every quoted fragment in this file was located at its cited line and every asserted size was
re-measured: **59 checks, 58 PASS**. The one FAIL was the probe's own placeholder for
`config/src/auth_policy.rs:1` (a file this note declares unread), not a citation error — the fix was to state what
was actually seen of that file (§9), not to move the goalposts. The check list is `(clone, path, line, substring)`
rows over the two pins plus a size table; the script lived at `.spike/verify-note-241-cites.mjs`, which is
gitignored, so it **will be gone tomorrow** — that is ROADMAP **233** happening to the delegate, and the reason the
next session should re-derive it from this paragraph rather than look for it. Re-deriving it is ~25 lines: read each
file once, slice `line-3..line+2`, assert the substring. **A candidate instrument exists and is not built:**
`tools/review-cite-check.mjs`, which would walk any `docs/reviews/*.md`, extract every `path:line` reference under a
`vendor/eval/` pin, and fail on any reference that does not resolve — the cheap half of ROADMAP **244**'s
"cited-path check". Its obvious second half is **numeric** claims: the `permissions_toml.rs` "1,457 lines" error
survived until a human re-measured it (ROADMAP 244 records the correction, **680** measured), and a tool that
extracts "**N lines**" next to a cited path and compares it with `wc -l` at the pin would have caught it at commit
time instead of at re-read time.
