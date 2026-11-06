# Credentials and secrets between members of an agent team — a competitor sweep over the pinned trees

**Question (operator, 2026-11-07):** *"We should research how competitors manage credentials and secrets
between subagents or members of an agent team before deciding. I feel like the best architecture would be
a separate process or service that holds secrets."* The decision this informs is **ROADMAP 333** (the
credential fork: env-only vs pi's `/login` store) and its parent seam **332 S3**.

**Host, measured in the same command as the measurements:** Linux, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.
No hostname signs this document (D205, ROADMAP 281).

**Method, and its limits.** This is the **upstream-read** half (`docs/runbooks/competitor-review.md`), not the
commissioned-research half: every `observed` claim below comes from a clone already pinned in
`docs/VENDOR-PINS.md`, read with `git -C <clone> grep` / `ls-files` (index-bounded, never a filesystem walk)
and opened with `read`. `node tools/vendor-pins.mjs --check` → **PIN CHECK PASS … 27 clone(s), every row
matches its clone's HEAD/date/licence, the table is tracked by git** (run 2026-11-07; five upstream-tag DRIFT
NOTEs, which are upstream state and not the pin). Two claims are `advertised-elsewhere` (vendor docs fetched
by the delegate, §8) and are labelled as such. A **comparison file** like this one is not audited by
`vendor-pins --check`, so **each clone's pinned HEAD is cited in the row itself** (runbook, "a comparison
file is not audited — it must cite both HEADs itself"). Per-project records stay in
`docs/reviews/<name>-review.md`; this file is the cross-project answer, and the rows this sweep touches were
added to `docs/COMPETITORS.md`.

Probes used (all in gitignored `.spike/`, promote-or-delete is a `lead` decision — ROADMAP 312 pattern):

```bash
node .spike/delegate-20261107/envprobe/procfs-canary.mjs      # can a seat-shaped shell read the broker's environ? 6 s
node .spike/delegate-20261107/envprobe/seat-env-exposure.mjs  # does any key name cross confine's env boundary? 6 s
node --test demo/confine.test.mjs                             # the existing canary gate: PASS, 0.37 s
node -e '…cfg.looksLikeSecret(shape)…'                        # what our own classifier catches, 1 s
```

---

## 1. Our own plane first, measured (the baseline a competitor row is compared against)

Six controls already exist. None of them is the boundary — `src/confine.mjs:20-25` says so in its own header:
*"This is a NARROWING layer, not the boundary."*

| # | Control | Where | Measured state |
|---|---|---|---|
| C1 | A credential is **never a config-file key** — the key names are deliberately absent from `CONFIG_KEYS` | `src/config.mjs:110-128` (comment: *"the API-KEY variables are deliberately NOT config keys: a credential belongs in the environment, never in a file that could be committed"*) | observed in source; `assertNoUnknownFileKeys` (`src/config.mjs:190`) refuses unknown FILE keys but explicitly does **not** police env (`src/config.mjs:181-184`) |
| C2 | The key is resolved **at request time in the broker's own process** from env | `cli.mjs:349-357` (`resolve: async ({ctx}) => ctx.env("DEEPINFRA_API_KEY")`), `cli.mjs:393-397` (`authContext: { env: …, fileExists: async () => false }`) | observed; `fileExists: () => false` is the 333 fork |
| C3 | A seat's shell child gets a **closed allowlist** of env names, and a name that looks credential-shaped never crosses even if a caller asks for it | `src/confine.mjs:340-385` (`ENV_ALLOWLIST`, `SECRET_NAME = /(key\|token\|secret\|password\|passwd\|credential\|cookie\|authorization)/i`, `pickEnv`), `src/confine.mjs:686-693` (`inheritEnv: false` forced, caller-supplied map filtered) | **measured**: a seat-shaped `authorEnv` child asked, deliberately, for `inheritEnv: true` plus two key names → the child's `env` contained **0 credential-shaped names** (probe above) |
| C4 | A gate pins C3 | `demo/confine.test.mjs:87-100` (canary `DEEPINFRA_API_KEY: "canary-should-not-propagate"` requested with `inheritEnv: true`) | **`PASS — all confine canaries held`**, 0.37 s (`node --test demo/confine.test.mjs`) |
| C5 | A secret-shaped **tool result is redacted before it is committed**, and secret-shaped committed content is **detected** read-side; neither echoes the value | `src/secretredact.mjs` (header: `hook(ToolTask,{afterTool})` "AFTER a tool executes and BEFORE its result entry is COMMITTED"), `src/secretdetect.mjs` | observed in source; the classifier is one definition shared by both (`src/config.mjs:73-82`) |
| C6 | The preflight stopped printing credential **values** (295) | `tools/broker-serve.mjs:191` prints `id (prefix) -> baseUrl model= ctx= out=` only | **measured**: `node tools/broker-serve.mjs --status \| grep -ci "sk-\|api.key *= *[A-Za-z0-9]{8}"` → **0**. `--dry-run` was **not** run — 295's warning still governs it |

**Two measured holes in that plane, and they are the reason the operator's instinct is worth taking
seriously.**

**H1 — one OS user means the live key is readable by everything the seats run.** All 12 seats are
conversations inside ONE broker process (`cli.mjs:474 Harness.open`, `cli.mjs:479 env: makeSeatEnv(...)`);
their shells are children of that process, same uid. C3 protects the child's *own* environment; it does not
stop a child from reading the **broker's**. Probe `.spike/delegate-20261107/envprobe/procfs-canary.mjs`
(canary values, nothing real, output name-only):

```
host uid=1000 fake-broker pid=1162686
confine exec exit={"exitCode":0}
mimic (allowlist-shaped env) names readable from the broker's environ: 92
  key-shaped names visible: DURIG_VERIFIER_API_KEY, DURIG_LOCAL_API_KEY
```

and `refusalFor("cat /proc/$PPID/environ", {root, cwd})` → **no refusal** (`src/confine.mjs` has no entry
naming `/proc`; `grep -n "proc/" src/confine.mjs src/seatguard.mjs` → 0 hits). The seat's *file* API is
path-confined (`src/confine.mjs:488` `PATH_METHODS`), so `read /proc/…` is refused — the hole is the **shell**
path, and OS permissions do not close it on a single-uid host. This is the sharpest statement of the rig's
own doctrine, `src/confine.mjs:28-32` (**D-ENV-AUTH** — *"every in-repo channel is seat-forgeable … one OS
user, and a seat can write files"*).

**H2 — our own redactor/detector has a floor, so a stolen value may not be caught.**
`looksLikeSecret` (`src/config.mjs:73-82`) is prefix patterns plus one high-entropy rule requiring **letters
AND digits** and **≥ 40 chars**. Classified shapes (1 s probe): `sk-…`(27) `true`, `hf_…` `true`, `ghp_…`
`true`, a 32-char alnum `false`, a 34-char letters-only `false`, a 48-char single-letter run `false`. The
`local` key's length is recorded as 74 chars in ROADMAP **326**; whether either live key clears the floor is
**unmeasured by the delegate** — the keys are not in the delegate's environment
(`typeof process.env.DURIG_VERIFIER_API_KEY` → `undefined`), and reading them is the operator's verb.
Consequence: C5 is a backstop whose coverage of *our own* credentials is unproven.

---

## 2. Surface inventory (what was opened) and the not-read list

| Project (pinned HEAD, `docs/VENDOR-PINS.md`) | Opened | What it yielded |
|---|---|---|
| `vendor/pi-main` @ `2ec55d808d455b1a64a2bf7888198207a096120a` (`pi-main.pin.json`) | `packages/ai/src/auth/{credential-store,types,resolve,helpers,context}.ts`, `packages/coding-agent/src/core/{auth-storage,resolve-config-value,runtime-credentials}.ts`, `packages/coding-agent/src/cli/{auth-check,auth-command,credential-print}.ts` | **M1 + M4**: a `CredentialStore` **interface** is already the base seam; a file store with `mode: 0o600` + lockfile; stored-credential-wins precedence; command-resolved config values; an `auth check` readiness verb |
| `vendor/eval/openhands` @ `6354932e` | `src/api/secrets-service.ts`, `src/api/request-secret-client-tool.ts`, `scripts/mars-secret-store.mjs`, `src/utils/redact-custom-secrets.ts` | **M2 + M5 + M6**: a secret **service** behind an HTTP API, secrets addressed by **name**, a runtime tool that *asks the human* for a secret, keychain-backed store, a UI backstop redactor |
| `vendor/eval/codex` @ `d373d649` | `codex-rs/network-proxy/README.md`, `network-proxy/src/credential_broker.rs`, `credential_broker/environment.rs`, `core/src/shell_snapshot.rs`, `app-server/src/external_auth.rs` | **M3**: credentials brokered at the **egress** path — dummy/marker/alias env values, real secret held by the proxy, re-signing/header substitution, an explicit `Warn/Deny/Error` policy for raw credentials found in a child env |
| `vendor/eval/goose` @ `775b3958` | `crates/goose/src/providers/command_auth.rs` | **M4**: `CommandAuthProvider` — a configured command issues short-lived credentials, cached with a TTL |
| `vendor/eval/cline` @ `51f63e4f` | `apps/vscode/src/core/storage/state-migrations.ts:128` | **M1 (host-held)**: keys live in the host's `SecretStorage`, not in a file the agent can read |
| `vendor/eval/claude-code-docs` @ `58d6da1e` | `CHANGELOG.md` (targeted greps) | **M4 + M7** (`advertised`): `apiKeyHelper`, refresh-before-send on expired short JWTs, failure surfaced instead of silent 401 retries, login-method pinning, gateway env vars |
| `vendor/eval/pi-subagents` @ `31208242` | `src/extension/config.ts`, `src/runs/foreground/prompt-audit.ts`, `src/watchdog/{review,permission-arbiter}.ts` | the pi ecosystem's *current* answer: a sub-runner is handed the parent's **resolved** `apiKey` |
| **`vendor/eval/oh-my-pi`** @ `6f3fbc94` (the pins row records tag `v18.16.0` for this commit; the remote's newest tag is now `v18.17.0` — measured with a bounded `ls-remote --tags`; cite line numbers to `6f3fbc94`, never to `main`) | `docs/auth-broker-gateway.md` (387 lines, read in full), `docs/secrets.md` (153 lines, read in full), `packages/ai/src/auth-broker/{remote-store,wire-schemas,snapshot-cache}.ts` | **M9 + M10 + M11 — the operator's architecture, shipped, in our own ecosystem**: a separate `auth-broker` process holding a SQLite credential vault and refreshing server-side, an `auth-gateway` forward-proxy that members call **without ever receiving the credential**, per-member model/account grants and quota/usage accounting at the holder, and a secret-obfuscation layer whose placeholders the model can *use* but not read |
| `vendor/eval/crewai` @ `f3d0099d` | `lib/cli/src/crewai_cli/authentication/*` (paths enumerated, `token.py` read) | **M1**: platform OAuth (auth0/okta/auth0/entra/keycloak/workos) + a token helper re-exported from `crewai_core.auth.token` — this is **product** auth, not per-agent auth |

**Not read, and why:** `metagpt`, `hermes-agent`, `symphony`, `prime-agent`, `toolflow`,
`mudroom`, `aegis-orchestrator`, `ironclaw`, `pi-permission-modes`, `pi-secure-it`, `pi-code-tool`,
`sandbox-sdk`, `llm-sandbox`, `auto-permission-system`, `agent-governance-toolkit`,
`awesome-agent-sandboxes`, `aider`, `copilot-cli` (1 file only) — the five rows above already cover every
architecture *family* found (store, service, egress broker, command-issued, host-held), and the cheapest way
to keep this honest is the follow-up prompt (§9), not 20 more shallow greps in one session.
`crewai`'s per-tool credential modules (`…/tools/**/credentials.py`) were enumerated by name only.

---

## 3. The mechanisms found, with the counterpart each one has here

**M1 — a credential **store** behind an interface, one write path, stored-wins precedence.** *(observed)*
`vendor/pi-main/packages/ai/src/auth/types.ts:41-100` — `CredentialStore` with `read`/`list`/`modify`/`delete`;
*"modify is the only write path, so every mutation is a serialized read-modify-write; `Models.getAuth()` runs
OAuth refresh inside `modify` so concurrent requests cannot double-refresh a rotated token"*; and `list` must
not expose secrets (*"Implementations must not execute configured API-key commands while listing"*).
`credential-store.ts:8` ships `InMemoryCredentialStore` — *"Default in-memory credential store. **Apps inject
persistent stores**."* The coding-agent's persistent one is `auth-storage.ts:1-47`: `auth.json`,
`AUTH_FILE_WRITE_OPTIONS = { encoding:"utf-8", mode: 0o600 }`, `proper-lockfile` with an explicit Windows
`EPERM` retry loop, and `ReadOnlyAuthStorage` (`:204`) as a second implementation.
`resolve.ts:28-35`: *"A stored credential owns the provider: ambient/env is consulted only when nothing is
stored. No silent env fallback after a failed refresh."*
**Counterpart / cost here:** 333's option (b) is exactly "let the stored credential own the provider" — the
sentence above is the *mechanical* reason (b) breaks the family/role guarantee (D48/D119) and makes a rotation
invisible (326): the seat's `DURIG_*` env would be ignored, not overridden. And the interface is the seam:
durian-pi can hand pi-durable a `CredentialStore` **of our own** without touching pi.

**M2 — secrets behind a **service**, addressed by name, with a runtime "ask the human" tool.** *(observed)*
`vendor/eval/openhands/src/api/secrets-service.ts:19-46`: the client lists secrets from
`GET /api/settings/secrets` and the list is *"names and descriptions only, no values"*; writes go through
`PUT` with a name constraint (`request-secret-client-tool.ts:36-40`: letter-first, `[A-Za-z0-9_]`, ≤ 64).
`request-secret-client-tool.ts:9-26` is the standout artifact — a tool the agent calls when a task needs a
credential it does not have: *"Never ask the user to paste a secret into the chat, and never put a secret value
in this tool's arguments… The value is stored in the user's secrets and exposed to this conversation as an
environment variable named after the secret. Reference it as `$NAME` in commands; never print or echo it. One
call per missing secret."* It is also asynchronous by design (*"acknowledged immediately, before the user has
answered… keep working on anything that does not need the secret"*).
**Counterpart / cost here:** this is the operator's "separate service" **as shipped**, and it lands halfway:
the *store* is a service, but the **value still reaches the execution environment** as an env var. That is the
difference between "no one can enumerate the secret" and "no one can read it".

**M3 — credential **brokerage at the egress path**: the child sees a placeholder, the proxy holds the key.**
*(observed)* `vendor/eval/codex/codex-rs/network-proxy/src/credential_broker.rs:44-60` exports the env-key
vocabulary — `brokered_credential_marker_env_keys`, `brokered_credential_value_env_keys`,
`brokered_credential_dummy_env_keys`, `brokered_credential_binding_env_keys` — plus
`CredentialMaskingFailureMode { Warn, Deny, Error }` (*"How to handle recognized credentials left raw in a
prepared command environment"*) and `BROKERED_CREDENTIAL_ALIAS_MARKER_PREFIX = "@alias:"`.
`credential_broker/environment.rs:21-45` keeps destination hints **out of** the child env
(`CredentialBrokerContext(<redacted>)` is its `Debug` impl — the secret cannot reach a log through the type
that holds it) and produces *"an environment ready to spawn"*. `core/src/shell_snapshot.rs:21-22` imports the
same keys so **the persisted shell snapshot** cannot carry a real credential either. README (`:293-301`):
*"Inherited copies of configured credentials are masked in child environment values and protected shell
snapshots. File-backed credentials require filesystem permissions that prevent child access… The AWS CLI or
SDK signs with the dummy secret. After the exact host, method and path hook authorizes the request, the proxy
recognizes the placeholder in the SigV4 credential scope and re-signs…"*, and the guard-rails around body
substitution: markers *"opaque ASCII values of 16–256 bytes"*, each resolved credential *capped at 64 KiB*,
at most 65,536 replacements, compressed payloads and signed-stream forms **fail closed**.
**Counterpart / cost here:** this is the only family that makes the secret unreachable-by-default, and it is
also the only one that costs a new long-lived local listener. durian-pi has **no** egress proxy today; seats
talk to providers only through the broker's own provider objects (`cli.mjs:349-357`), so a seat never needs a
key for the *model* call — M3's value here is for everything **else** a seat shells (git over HTTPS, package
registries, a verifier fetching an artifact), which today either has no credential or has it in env.

**M4 — a command, not a value, is what the config holds.** *(observed in goose, pi; advertised in claude)*
`vendor/eval/goose/crates/goose/src/providers/command_auth.rs:20-36` — `CommandAuthProvider`: *"Fetches a
credential by running a user-configured command and caches the result for `refresh_interval` before
re-running it … for custom providers whose credentials are short-lived and issued by an external script
rather than a static key"*, with `DEFAULT_AUTH_COMMAND_TIMEOUT = 10 s`.
`vendor/pi-main/packages/coding-agent/src/core/resolve-config-value.ts:1-12` — config/auth values may be
**shell commands** (`$` templates, `$$`/`$!` escapes) *"Used by auth-storage.ts and model-registry.ts"*,
cached for the process lifetime.
`vendor/eval/claude-code-docs/CHANGELOG.md` (all `advertised-elsewhere`): `:1938` a startup refusal *"names
the credential in use, where it is set, and how to remove it"* when managed settings pin a login method;
`:3775` *"an expired cached token is now refreshed before sending, and 401/403 auth errors retry quietly"*
for helpers returning short-lived JWTs; `:4713` *"Fixed `apiKeyHelper` script failures being hidden behind a
generic 401 after ~10 silent retries; the script's own error is now shown within 3 attempts"*.
**Counterpart / cost here:** this is the **cheapest** thing that would fix 326 (rotation invisible) — and
pi's own resolver already does it, so durian-pi gets it for free the moment S3 is expressed in pi's shape.
The claude rows are the two pitfalls to design against: **silent auth retry** and **a helper failure
masquerading as a 401**.

**M5 — OS keychain first, encrypted file second, memory last; never argv.** *(observed)*
`vendor/eval/openhands/scripts/mars-secret-store.mjs:1-18`: *"the operating system's keychain when it has
one, else a file encrypted with the host's `OH_SECRET_KEY`, else this process's memory … The keychain
backends drive the operating system's own tools (`security` on macOS, `secret-tool` on Linux desktops)
instead of a native Node module … **Secrets reach the tools on stdin, never on the command line, where other
processes could read them** … Secrets are read once at startup and written on sign-in and sign-out, never per
request."* `cline` is the host-held variant: `apps/vscode/src/core/storage/state-migrations.ts:128`
`await context.secrets.get("apiKey")` — the editor's `SecretStorage`, not a file the agent reads.
**Counterpart / cost here:** native-host-only (D131) makes "drive the OS tool" the right shape here (no
sidecar daemon to install), and pi's `auth.json` at `0o600` is already this family minus the keychain. The
argv rule is a pitfall we do not currently state anywhere.

**M6 — value redaction as a *backstop*, not the control.** *(observed)*
`vendor/eval/openhands/src/utils/redact-custom-secrets.ts:1-30`: `MASKED_PLACEHOLDER = "<secret-hidden>"`,
applied only inside a `<CUSTOM_SECRETS>` block, *"Defensive backstop: redact any unmasked value … **in case
backend masking regresses**"*, and the closing tag is optional *"so a truncated block is still redacted, not
leaked"*.
**Counterpart:** this is our C5 (`src/secretredact.mjs`) with the same self-doubt, and OpenHands also masks
on the **server** side first — ours has no server-side layer, which is why H2's floor matters here.

**M7 — a model **gateway** with per-consumer keys: the cap is enforced by the thing that holds the key.**
*(advertised-elsewhere — fetched by the delegate, `inputs/fetched/` copies are gitignored; §8 manifest)*
LiteLLM's virtual-key docs, fetched 2026-11-07T00:0xZ (`https://docs.litellm.ai/docs/proxy/virtual_keys`,
HTTP 200, sha256 `efc9904b6ec83d1c…`): *"Spend is automatically tracked for the key in the
`LiteLLM_VerificationTokenTable`"*; *"For a virtual key the value is the key's sha256 token hash, which is the
same value stored as `user_api_key_hash` in spend logs, so you can map the provider-visible id back to a key
and its owner without any extra plumbing"*; budgets carry `max_budget` + `budget_duration` (a *reset window*),
`soft_budget`, and a `/key/{key}/regenerate` rotation verb (rotation is gated behind their Enterprise tier).
Claude Code's gateway surface (`…/CHANGELOG.md:3206`, `:3668`) names the env contract for that shape:
`CLAUDE_CODE_USE_GATEWAY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, gateway model discovery.
**Counterpart / cost here:** this is the only mechanism found that would give **324** an enforcer (the
operator's $0.50 verifier-family threshold has no rig-side enforcement today — measured headroom **$0.15041**
at session close from `selfdev.sqlite.spend.jsonl`, 856 rows, `total 0.34959`), because the budget would sit
on a per-seat credential rather than in our own pre-call arithmetic (141/145/316).

**M9 — a separate **credential-broker process** whose clients get a redacted view, enforced in the wire schema.**
*(observed — this is the operator's proposal, already built in the pi ecosystem)*
`vendor/eval/oh-my-pi/docs/auth-broker-gateway.md:1-30`: *"The auth broker centralizes credential storage and
OAuth refreshes. The auth gateway lets clients make provider requests **without receiving provider
credentials**. Direct broker clients are trusted: snapshots expose OAuth access tokens and stored API keys, but
**never the real OAuth refresh token**."* `omp auth-broker serve` "holds the canonical SQLite credential vault,
performs OAuth refreshes, and exposes snapshot, credential, block, usage, and health APIs under `/v1`"; the
bearer token lives at `<config-dir>/auth-broker.token` (mode `0600`, parent dir `0700`); the background
refresher runs every 60 s against credentials expiring within a 5-minute skew, never overlaps sweeps, and
**classifies failure**: *"Definitive failures … disable only the credential version that failed (compare-and-set
persistence protects a credential rotated by a concurrent login/refresh); transient failures … leave the
credential in place for the next sweep."*
The redaction is not a convention, it is **two types**: `wire-schemas.ts:55-63` defines the broker-side
`oauthCredentialSchema` whose `refresh` field is narrowed to **not equal** `REMOTE_REFRESH_SENTINEL`, beside a
separate snapshot-entry schema where `refresh` *is* the sentinel; and `remote-store.ts:1290-1318` — *"routes
refresh through the broker so the actual refresh token never leaves the broker host"* — returns
`{access, refresh: REMOTE_REFRESH_SENTINEL, …}`. **A redacted credential cannot be smuggled into a path that
wants a real one, or the reverse.** That is the distinction our `fileExists: () => false` literal cannot
express: 333's fork today is a boolean, not a type.
Caching is hardened with an explicit **anti-fallback rule** (`:274-280`): the client snapshot cache is
AES-256-GCM keyed on the SHA-256 of the bearer token, written `0600` (`snapshot-cache.ts:116-123`), and if it is
missing/expired/corrupt/written-for-another-URL the client *"requires a live snapshot and fails when that fetch
fails; **it never silently opens the local credential store instead**."*
**Counterpart / cost here:** the seam is the same `CredentialStore` interface of §3 M1 — oh-my-pi selects
`RemoteAuthCredentialStore` "instead of local SQLite" when `OMP_AUTH_BROKER_URL` is set (`:325-340`).
durian-pi could sit on that same seam without pi changing.

**M10 — a **gateway** in front of the credential, with per-consumer grants.** *(observed)*
`omp auth-gateway serve` is a forward proxy whose clients — *"(containerised omp, llm-git, the macOS usage
widget, …) **never see the access token**"* — and *"There is **no raw provider passthrough path**. All supported
routes go through `pi-ai` provider logic so credential-specific request shaping, OAuth refresh-on-auth-error,
and provider quirks stay centralized."* `serve --clients=<file>` (`:180-205`) is the per-consumer scoping we
have no equivalent of: `tokenSha256` digests so *"the file never holds a raw token"*; a `models` allow-list
where a disallowed model *"answers `404 Unknown model` **before any credential lookup**"*; an `accounts`
allow-list by token-free `identityKey` where *"stored, runtime and environment API keys are never used, and a
request fails rather than borrow another account"*, and *"when `accounts` is present it is also a provider
allow-list: a provider it omits is refused like a model outside `models`, so a binding cannot be sidestepped
through another provider"*; one account **pin** per client so a member's traffic does not spread across
identities; a 10 s file re-read where a removed token *"is refused from its next request, while a request
already in flight finishes"*, and a file that fails to parse *"refuses every client token until it is fixed"*
(fail closed; atomic replace required). Two ordering rules worth stealing verbatim: a token presented in a URL
or in a forwarded/logged header is *"rejected with `400` **before any credential lookup**"*, and the gateway
*"ignores the host's `models.yml` overrides/custom models so **local base URLs, headers, and keys cannot
redirect broker-backed traffic**"*. Quota and money live at the holder too: `POST /v1/credential/:id/block`
(rate-limit blocks per meter scope), `/v1/usage`, `/v1/usage/history`, `/v1/usage/observed`,
`/v1/usage/clients`, and `auth-gateway check [--strict]` as the credential-health probe — while `/v1/usage` and
`/v1/credentials/check` answer **`403` for client tokens**, so a scoped member cannot enumerate the pool it
draws from.
**`omp auth-gateway stdio` is the variant that fits this rig** (`:207-230`): *"the gateway for one trusted parent
process (an editor, a terminal's git UI, a script): **no listener, no token, no broker requirement** … Requests
and responses are JSON lines"*, with `model` accepting **role aliases** (`@smol`) and a fallback chain.
durian-pi already *is* that parent: one broker process, seats as its children (`cli.mjs:474`, `cli.mjs:479`).

**M11 — reversible secret placeholders: the model can *use* a secret it never sees.** *(observed)*
`vendor/eval/oh-my-pi/docs/secrets.md:1-40`: candidates are collected from **env names** matching
`KEY|SECRET|TOKEN|PASSWORD|PASS|AUTH|CREDENTIAL|PRIVATE|OAUTH` with **values ≥ 8 characters**, from
`secrets.yml` (global + project), from built-in credential regexes, and — a class we miss entirely — from
*"passwords embedded in connection-URL environment values … (for example `DATABASE_URL`) … regardless of the
variable name"*. Provider-visible text gets deterministic placeholders
(`$$GITHUBTOKEN_3P8W5JH1TK2Q:L$$`), and then: *"Live model-authored tool arguments are deep-walked and
**placeholders are restored before the tool executes**."* The placeholder base is *"an HMAC of the exact secret
under a private per-install key (stored at `~/.omp/agent/secret-placeholder.key` … **never sent to a model**) …
This prevents a transcript reader from dictionary-hashing a placeholder back to its secret"*, with case-hint
suffixes so one placeholder cannot be mutated into another. Coverage includes tool results and dynamic
definitions; static system prompts, static tool definitions and binary payloads are excluded — **and the
exclusion is stated**.
**Counterpart:** this is our C5 (`src/secretredact.mjs`) with three things we lack — a **name-based, 8-char**
collection rule instead of our **value-based 40-char-plus-a-digit** rule (**H2**), the connection-URL class, and
**reversibility**, which is what turns redaction from *hiding* into *letting a seat act through the secret*.

**M12 — workload **identity** rather than a shared secret.** *(advertised-elsewhere)*
SPIRE concepts, fetched 2026-11-07T00:0xZ, HTTP 200, sha256 `609d7078b1348bc6…`
(`https://spiffe.io/docs/latest/spire-about/spire-concepts/`; note the singular `spire-concept` URL is a
**404** — record the URL that answers): *"It also maintains a registry of workload identities and the
conditions that must be verified in order for those identities to be issued"*; *"Agents expose the SPIFFE
Workload API locally to workloads, and must be installed on each node on which a workload is running."*
**Counterpart:** the per-seat identity half of the operator's idea, but sized for a fleet of nodes; in a
12-seat single-uid rig the identity is already known to the broker (`DURIG_ACTIVE_SEAT`, `cli.mjs:343`), so
adopt the *pattern* (each consumer gets its own scoped credential) and reject the *machinery*.

---

## 4. Coverage matrix — durian-pi against the control set these projects claim

| Control | Family | durian-pi today | Evidence / gap |
|---|---|---|---|
| Credential never in a committed file | M1 | **have** | C1 `src/config.mjs:110-128` |
| Credential not in the *consumer's* environment | M3, M10 | **have (shell) / lack (OS)** | C3+C4 measured; **H1** `/proc/<broker>/environ` reachable, 92 names incl. both key names; oh-my-pi closes it by proxying the **request**, not the key |
| Real vs redacted credential are **different types**, not a boolean | M9 | **lack** | `cli.mjs:396 fileExists: async () => false` is the whole of our distinction |
| Per-consumer grant: which models, which accounts; `404`/`400` **before** credential lookup | M10 | **lack** | seats are scoped by role at the tool surface (`src/seattools.mjs:335 scopeSeatTools`), never at the credential surface — 306 (per-seat scoping) and 324 (no family enforcer) meeting |
| A member can *reference* a secret without being able to read it | M11 | **lack** | our redaction is one-way (`src/secretredact.mjs`); the `looksLikeSecret` floor is 40 chars + a digit (`src/config.mjs:73-82`) — **H2** |
| Credential **health probe** that refreshes and names the source | M1, M9, M10 | **lack** | 326; the keycheck probe is still `.spike` (carrier `#5277`) |
| One write path for a stored credential (rotation serialized) | M1 | **not-applicable today** (no store) | becomes applicable the moment 333 chooses (b)/(c) or a broker lands |
| Secrets addressed by **name**, value injected by the host | M2 | **lack** | nothing in `src/` names a secret; a seat gets an env var only for its own shell (filtered away) |
| Ask-the-human-for-a-missing-secret, asynchronously | M2 | **lack** | the rig's answer to a missing key is `No API key for provider: local` (`docs/runbooks/local-provider-down.md`) |
| Egress-side placeholder + substitution | M3 | **lack** | no proxy; provider calls go through `cli.mjs:349-357` only |
| Policy for raw credentials found in a child env (`Warn/Deny/Error`) | M3 | **partial** | `SECRET_NAME` filters names (`src/confine.mjs:363`) but there is no *mode*, and no `/proc` entry |
| Command-issued, TTL-cached, short-lived credential | M4 | **lack** | pi's resolver supports it (`resolve-config-value.ts`); durian-pi's providers declare `ctx.env(...)` only (`cli.mjs:352-357`) |
| Readiness/rotation probe that refreshes and *names the source* | M1/M4 | **lack** | 326: rotation invisible; the keycheck probe is still `.spike` (row **312** pattern, carrier `#5277`) |
| Per-consumer budget enforced by the holder of the key | M7 | **lack** | 324: no family/seat enforcer; caps are pre-call arithmetic (141/145) |
| Value redaction in the transcript | M6 | **have, with an unproven floor** | C5 + **H2** (≥ 40 chars and a digit, or a known prefix) |
| Keychain-backed store, secrets over stdin never argv | M5 | **lack** (pi's `auth.json` 0600 is the nearest, and we disable it) | `cli.mjs:396 fileExists: () => false` |

---

## 5. Where these mechanisms do **not** fit this rig (say it before adopting them)

1. **Single writer (A1).** The broker owns the store (`docs/runbooks/README.md` "The one rule that shapes
   every runbook"). Any secrets service must own **its own** storage, never the rig store — a second writer is
   the failure that corrupted this store twice.
2. **Native host only (D131).** No `docker`/`docker-compose` sidecar. Every shipped example above runs either
   in-process (pi, pi-subagents, codex's proxy) or as a user-level service (OpenHands' agent-server, SPIRE's
   agent). A Python/uvicorn sidecar (LiteLLM) is a **capacity and support** decision for the operator, not a
   seat task.
3. **Extension plane, not the base (D212).** A credential seam is a **base** seam — 332 already rules this
   (*"a seat's config input is not a customization"*). So M1/M2/M4 land as base seams; a per-team secret
   policy could be an extension on top.
4. **A bearer token on a loopback listener still sits inside the one-uid problem (H1).** oh-my-pi's own
   posture is explicit: *"Transport security between operator, broker, and gateway is delegated to the operator
   (Tailscale / Wireguard / reverse proxy + TLS)"*, and `--no-auth` *"does not enforce a loopback bind"*. On this
   rig a network broker puts a **token** where the key sits today — reachable by the same
   `/proc/<pid>/environ` path, because a client has to hold it. The **stdio** variant (M10) has *"no listener,
   no token"*, and is the only shape found that does not merely relocate H1.
5. **Cross-family verifier (D48/D119) and loopback-only `local` (325).** pi's *"a stored credential owns the
   provider"* precedence, and any gateway that collapses `local` and `verifier` behind one virtual key, both
   delete the guarantee that the verifier is a different family from the author. Whatever is adopted must keep
   the role→family mapping in durian-pi, not inherit it from a store.
6. **Their scoping is *provider* scoping, not *role* scoping.** oh-my-pi's `models`/`accounts` file grants a
   client a slice of a pool; durian-pi's invariant is a **role→family** rule (a verifier seat must not route to
   the author family — D48/D119). The format expresses that rule cleanly (one entry per seat,
   `"models": ["verifier/*"]`), but nothing in their design enforces it as an invariant — we would be adding the
   invariant, not borrowing it.
7. **Spend attribution is per-seat today** (`selfdev.sqlite.spend.jsonl` rows carry `authKeyEnv`
   `DURIG_VERIFIER_API_KEY` + model + tokens). A single shared upstream credential is why the ledger is ours
   rather than the provider's; M7 is the only family that gives the provider something to attribute to.

---

## 6. Per-mechanism call (adopt / adapt / reject) and where it goes

| Mechanism | Call | The durian-pi mechanism it changes | Row |
|---|---|---|---|
| M1 `CredentialStore` interface, injected, one serialized write path | **adopt** (it is already upstream — we just decline it) | the `authContext` we hand pi-durable at `cli.mjs:393-397` | 334 |
| M1 precedence (stored wins, no env fallback) | **reject as-is, adapt** | if 333 ever picks (b)/(c), the precedence must be per-**family**, with `DURIG_*` overriding and *naming the winner* | 333 (operator), 334 |
| M2 secret service + address-by-name + ask-the-human tool | **adapt** | the seat's missing-credential failure path (`local-provider-down.md` state 7) and `cli.mjs config`'s credential line | 335 |
| M3 egress brokerage with dummy/marker env values + `Warn/Deny/Error` for raw credentials in a child env | **adapt the small half now, defer the proxy** | the `/proc/<pid>/environ` hole (H1): `src/confine.mjs` refusal list + a `check` finding; the proxy itself is a new listener and stays parked | 336, 337 |
| M4 command-issued short-lived credential, TTL cache, 10 s bound | **adopt via pi** (S3 expressed in pi's shape gets it free) + adopt the two claude pitfalls as gates | provider definitions at `cli.mjs:349-357`, `src/providers/*` | 338 |
| M5 keychain-first store, stdin never argv | **adapt** (pi's `auth.json` 0600 + the OS tool, not a new daemon) | 333's answer shape; state the argv rule in `docs/runbooks/leaked-secret.md` | 333, 339 |
| M6 value redaction as backstop | **have — fix the floor** | `src/config.mjs:73-82` (`looksLikeSecret`) | 336 |
| M7 per-consumer virtual keys with a budget at the holder | **pilot only** (spend + operator's capacity call) | 324's enforcer gap; the ledger's `authKeyEnv` column | 340 |
| M9 broker process; redacted snapshot; sentinel enforced **as a type** | **adopt the type discipline whatever else is decided** | `cli.mjs:393-397` (our boolean today) and 333's answer shape | 334, 341 |
| M10 gateway with per-consumer grants — **the `stdio` variant** | **pilot** (the only mechanism found that closes H1 without relocating it) | the broker's provider seam (`cli.mjs:349-357`) + the seat roster | 342 |
| M10 ordering rules (`404`/`400` before any credential lookup; consumer config cannot redirect broker traffic) | **adopt** (cheap, no new process) | provider construction in `cli.mjs` / `src/providers/*` | 341 |
| M11 name-based collection (≥ 8 chars) + connection-URL class + **reversible** placeholders | **adapt** | `src/config.mjs:73-82` (the floor), `src/secretredact.mjs`, `src/secretdetect.mjs` | 336 |
| M12 workload identity (SPIRE machinery) | **reject the machinery, keep the pattern** | per-seat scoping stays inside the broker (`DURIG_ACTIVE_SEAT`) | — |

**Standards-and-policies pass (runbook Do 5, one representative artifact per category — no category
dismissed):** the MCP **authorization** surface is present in all three substrates —
`vendor/pi-main/packages/coding-agent/src/extensions/mcp/oauth.ts`,
`vendor/eval/openhands/src/types/mcp-auth.ts`,
`vendor/eval/codex/codex-rs/app-server-protocol/schema/typescript/v2/McpAuthStatus.ts` — **adapt**
(durian-pi has no MCP client today, so this is a forward constraint on S3: an MCP server added later must get
its credential from the same place a family does, not from seat env). **AWS SigV4 re-signing**
(`vendor/eval/codex/codex-rs/network-proxy/src/aws_sigv4.rs`) is the M3 sub-mechanism quoted in §3 M3 —
**reject for now** (no AWS surface in this rig; adopt the *fail-closed list* idea if M3 ever lands).
**OWASP ASI** is already self-assessed in `docs/security/owasp-asi-self-assessment.md`; this sweep found **no**
new OWASP-shaped control in the credential families worth a second self-assessment — the gap is M3/M7, which
is an architecture row, not a checklist row. SPIFFE/SVID (**reject machinery**, §3 M8).

---

## 7. What this says about 333 specifically (the operator's decision, informed)

- 333 **(b) "read pi's store"** is not a neutral convenience. `resolve.ts:28-35` makes a stored credential
  **own the provider** with **no env fallback**, so a seat would authenticate as whatever the human logged in
  as, and `auth-storage.ts:36` puts it in one `auth.json` shared by the human's interactive pi and 12
  autonomous seats. The delegate's objection in 333 stands, now with the mechanism attached.
- 333 **(a) "env-only, made explicit"** is still the right default for this quarter, **but the sweep shows the
  reason to schedule the rest**: env-only leaves H1 (one uid) as the real boundary and leaves 324/326 with no
  enforcer and no visibility.
- The operator's separate-process idea exists in the wild in **three** strengths: **OpenHands' secret service**
  (names to the agent; the value still lands in the execution env), **codex's egress broker** (a placeholder in
  the env, the real value substituted on the network path, plus a `Warn/Deny/Error` policy for a raw credential
  found in a child env), and — the closest, inside our own substrate's ecosystem — **oh-my-pi's auth-broker +
  auth-gateway** (a separate vault process whose refresh token never leaves it, a gateway through which a member
  makes requests **without ever receiving the credential**, per-member model/account grants, and quota/usage
  accounting at the holder).
- Only the last two close **H1**, and only oh-my-pi's **`stdio`** variant does it without putting a token where
  the key sits today — which matters because durian-pi's seats are already children of one broker process. Their
  per-consumer `models`/`accounts` file is also the first mechanism found that can express *"verifier seats route
  only to `verifier/*`"* as an **enforced** rule instead of an instruction.
- Recommendation, options and costs: `docs/reviews/credential-architecture-options-2026-11-07.md`.

## 8. External inputs and their manifest (the two `advertised-elsewhere` claims)

Copies are gitignored (`inputs/fetched/*.html`); this table is the tracked record. Regenerate with
`curl -sS -L -o <f> -w "%{http_code}" <url>` then `sha256sum`.

| URL | fetched (Z) | HTTP | bytes | sha256 (16) | quote found in our copy? |
|---|---|---|---|---|---|
| `https://docs.litellm.ai/docs/proxy/virtual_keys` | 2026-11-07T00:0xZ | 200 | 213,856 | `efc9904b6ec83d1c` | yes — "Spend is automatically tracked for the key in the `LiteLLM_VerificationTokenTable`"; the sha256-token-hash sentence both quoted in §3 M7 |
| `https://spiffe.io/docs/latest/spire-about/spire-concepts/` | 2026-11-07T00:0xZ | 200 | 39,700 | `609d7078b1348bc6` | yes — both sentences quoted in §3 M8. The singular variant `…/spire-concept/` returns **404** |

## 9. Open questions → the follow-up prompt

`docs/reviews/credentials-secret-brokerage-followup-research-prompt.md` carries them: iteration-cost
questions (D213) for each family, how competitors test a credential boundary hermetically (our canary test
covers C3 only), whether any shipped rig enforces per-member spend at the credential holder with an open
license, and what a *local* (self-hosted, single-box) broker costs its operator in practice.
