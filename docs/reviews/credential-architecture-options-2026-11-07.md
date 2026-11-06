# Credential architecture — options, costs and a recommendation for the operator

**For:** the operator, 2026-11-07. **From:** the delegate (external to the team).
**Answers:** operator items (2) *"research … before deciding"* and (4) *"recommendations, or brain-storm for
me, also consider performing competitor research."*
**Evidence:** `docs/reviews/credentials-in-agent-teams-competitor-sweep-2026-11-07.md` (all mechanism claims
carry a path in a pinned clone; `observed` vs `advertised-elsewhere` marked there).
**Host of every measurement here:** Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`,
node v24.22.1, git 2.56.0. No hostname signs this document (D205).

## 0. The two decisions, kept apart

- **D-A (the fork, ROADMAP 333):** where a seat's provider credential comes from — env only, pi's stored
  credential, or a mix. Cheap to answer, and the research now attaches the mechanism that makes option (b)
  dangerous: pi's `resolve.ts:28-35` — *"A stored credential owns the provider: ambient/env is consulted only
  when nothing is stored. No silent env fallback after a failed refresh."* A seat would authenticate as
  whatever the human logged in as, and `DURIG_*` would be **ignored**, not overridden.
- **D-B (the architecture, new):** whether secrets move into a **separate process/service**, and if so which
  shape. The operator's instinct is sound and has shipped precedents; the finding is that **the shape decides
  whether it actually closes anything**: a network secrets service moves the secret from a place a seat can
  read to a place a seat can read (one uid, one env). Only request-level brokerage is a real boundary here.

## 1. The measured fact that frames both decisions

`DURIG_VERIFIER_API_KEY` and `DURIG_LOCAL_API_KEY` live in the **broker's** environment; all 12 seats are
conversations in that one process (`cli.mjs:474`), and their shells are children of it, same uid.
`src/confine.mjs` already strips credential-named env from a seat's shell (measured: 0 key-shaped names cross,
gate `demo/confine.test.mjs` PASS 0.37 s), **but** a seat-shaped shell can read the broker's environ directly —
probe printed **92 names including both keys** via `/proc/<pid>/environ`, and
`refusalFor("cat /proc/$PPID/environ")` → **no refusal**. Our own value classifier would probably not even
report the leak: `looksLikeSecret` (`src/config.mjs:73-82`) requires a known prefix **or** ≥ 40 chars **with a
digit** (measured: a 32-char alnum classifies `false`). So today the control is *"a seat doesn't think to ask"*,
which is not a control.

## 2. Options

Cost is stated the way the rig states everything else: delegate/seat wall-clock to build, and model spend
(seats run on `local/…` for free, `verifier/…` is metered; family headroom measured this session at
**$0.15041** of the operator's $0.50 trigger — 856 ledger rows, `total 0.34959`).

| # | Option | What it actually buys | Cost | What it breaks / risks | Who can do it |
|---|---|---|---|---|---|
| **A** | **Env-only, made explicit** (333 a) — keep `ctx.env(...)`, and make the fork *visible*: one line in `cli.mjs config` naming the credential source per family, and a ruling in `docs/DECISIONS.md` | Stops the next session re-discovering the fork from a `fileExists: () => false` literal; 5 minutes of reading instead of a session | ~1 h of one seat; **$0** | Buys nothing against the measured hole — it only documents it | seat (delegate can register) |
| **B** | **Read pi's credential store for seats** (333 b) | One plane, pi's `/login` UX for seats | ~1–2 h; **$0** | **Rejected on evidence:** stored-wins precedence (`resolve.ts:28-35`) silently overrides `DURIG_*`, one `auth.json` is shared by the human's interactive pi and 12 autonomous seats (`auth-storage.ts:36`, mode 0600), and a rotation becomes invisible (326). It also deletes the role→family guarantee (D48/D119) | operator + seat |
| **C** | **Hybrid** — pi's store for the paid `verifier` family, env/loopback for `local` (333 c) | Halves the operator's maintenance on the arm where the risk is lowest | ~2–4 h; **$0** | Same precedence trap on the metered arm; two rules to remember; 325's loopback rule must be re-argued per family | operator + seat |
| **D** | **Close the reachability hole without any new process** — (i) name-based secret collection at ≥ 8 chars instead of value-based ≥ 40-plus-digit; (ii) a `src/confine.mjs` refusal (and ideally a `check` finding) for `/proc/*/environ` and `/proc/self/*`; (iii) the codex ordering rule: no credential lookup for a request already refused on policy (`404 before credential lookup`); (iv) a state that says *"a credential was found in a child environment"* with a `Warn/Deny/Error` mode | Removes the cheap path from a seat to the live key, and makes the redactor actually cover our own key shapes | ~2–3 h, one `security` + one `devtools` leg; **$0** (a seat shell turn or two); gates are canary tests (the existing `demo/confine.test.mjs` runs in 0.37 s) | A command-pattern list is not a boundary — `src/confine.mjs:20-25` says so itself. This raises the bar and *names* the residual, it does not eliminate it | seat (rows **336**, **337**, **341**) |
| **E** | **Own the credential seam in the broker, typed** — implement pi's `CredentialStore` interface ourselves (or select a remote one) so "env key", "stored key" and "redacted/unusable view" are **different types**, and let a family's key be **command-resolved** (`!<shell>`, TTL-cached, 10 s bound) so rotation is visible | Directly fixes 326 (rotation invisible) and gives S3 of 332 its shape; oh-my-pi proves the same interface is enough (`OMP_AUTH_BROKER_URL` selects `RemoteAuthCredentialStore` "instead of local SQLite") | ~4–8 h; **$0** to build, ~$0.001 to prove with a provider probe | A command that resolves a key is executed *by the broker* — the command itself must never be seat-influenceable (the D-ENV-AUTH rule: `src/confine.mjs:28-32`, *"every in-repo channel is seat-forgeable"*) | seat (rows **334**, **338**) |
| **E2** | **Resolver, not value** (prime-agent @ `815e64b5`): the loop config holds an injected `get_api_key` callback (`agent_loop/mod.rs:107`), resolution happens at request time (`agent_loop/response.rs:104-111`), and a **derived** agent's config is built with `config.api_key = None` while the callback is cloned in (`agent.rs:564,571`) | No materialized credential ever enters the child's config — **with no daemon, no listener and no token** | ~0 for the model path (durian-pi already resolves broker-side at `cli.mjs:349-357`); the work is making every *other* thing a seat authenticates to (git, registries) present a **name** to the broker instead of a value | It does not stop a seat's shell from making its own requests — that is 342/337 territory. It also relies on the child being *our* code, not arbitrary user tooling | seat (rows **334**, **335**, and it is the seat-facing surface of **342**) |
| **F1** | **A network secrets/credential service** (OpenHands' `secrets-service` pattern, or a LiteLLM-style gateway with per-key budgets) | Per-seat budgets enforced by whoever holds the key = the enforcer 324 lacks; provider-side attribution (LiteLLM: the provider-visible id *is* the key's sha256) | Half a day to stand up a spike; +1 long-lived local listener; +1 thing to keep alive across a reboot; rotation still operator's | **A token replaces the key in the same one-uid env** (H1 unchanged); a second service risks the single-writer rule (A1) if it ever touches the store; a Python sidecar is against the native-host grain (D131) and is the operator's capacity/support call | **operator** (capacity, a new daemon, credentials) |
| **F2** | **Request-level brokerage inside the rig: a `stdio` gateway** (oh-my-pi's `auth-gateway stdio` shape: *"no listener, no token, no broker requirement"*; JSON-lines to one trusted parent) + a per-seat grant file (`models`/`accounts`, `404`/`400` **before** any credential lookup) | **The only found shape that closes H1 rather than relocating it.** Also expresses the role→family invariant as an enforced grant (`"verifier/*"` for verifier seats only), and puts usage/quota at the holder — 324's and 316's enforcer in one place | ~1–2 days, one `architect` design leg + one `impl` leg + one `qa` leg; **model spend only when a real provider call is probed** (measured probe cost this session class: ~$0.00026 per 6.8 k-token call) | It does **not** help a seat's *own* shell (git over HTTPS, npm) — that's F3, not F2. It adds a request path that must keep the loopback-only rule for `local` (325). Do not let the grant file become a second source of truth for model selection without the S1/S2 seams (332) landing first | seat builds; **operator** approves the design and the extra moving part |
| **F3** | **Egress proxy with placeholder substitution** (codex: dummy/marker env values; the real secret re-signed into the request at the network path; `Warn/Deny/Error` for raw credentials in a child env; body-substitution bounds) | The strongest control found, and the only one that also covers git/package-registry credentials a seat actually needs | Multi-day; CA/trust plumbing; a listener per session | Biggest new surface on a rig that has no egress proxy today; a MITM CA on the host is a security posture change, not a feature; **park** | operator would have to rule on it first |

## 3. Recommendation

**Do A + D + E now; pilot F2; reject B; hold C unless the operator wants the metered arm's maintenance
savings today; park F1 and F3.** In one line each:

1. **Answer 333 as (a) env-only, and pay the visibility tax immediately** (A) — the research strengthens the
   objection to (b) with the precedence mechanism, and (a) is the only option that keeps the family/role and
   loopback invariants expressible while S1/S2 (332) are still unbuilt.
2. **Fund D this quarter regardless of what 333 decides** — it is where the *measured* hole is, it costs
   nothing, and its gates are the existing canary tests (0.37 s) plus one new canary for `/proc`.
3. **Fund E as part of 332-S3** — pi already grew the seam (`CredentialStore`, `resolve-config-value.ts`);
   we currently decline it with a boolean. Adopting the typed view (M9) is what makes 326 fixable.
4. **Then pilot F2, the stdio gateway.** This is the honest version of the operator's instinct for *this*
   rig: a separate **holder** of credentials, but brokerage at the **request** layer rather than handing
   anything to the consumer, and **per-seat grants** that finally make *"the verifier is a different family"*
   and *"this seat's spend stops here"* machine-enforced. Prior art is in our own pinned tree
   (`oh-my-pi` @ `6f3fbc94`), so the spike has a reference implementation to read, not just a paper design.
   Note the **E2** finding first, because it re-prices F2: prime-agent gets the same "child never sees the
   value" property with an **in-process resolver** (`agent.rs:564` sets `config.api_key = None` on the derived
   config and clones the resolver in). durian-pi already resolves the model credential broker-side
   (`cli.mjs:349-357`), so F2 is only needed for the consumers that can construct their **own** requests — a
   seat's shell, git, a package registry — and for the per-seat grant/quota surface, not for the model path.
5. **Do not adopt a network secrets service (F1) on this rig before F2 is measured** — a loopback bearer token
   is reachable by exactly the probe that reached the key, so F1 first would add a daemon and change nothing.

**Ordering, with the free/paid split:** A → D → E (all **$0**, all unblocked, all gate-able with the existing
test planes) → an **`auth check`-style readiness probe** for 326 (≈1 h, ~$0.001 — one masked provider probe,
the shape already prototyped in `.spike/delegate-20261106c/keycheck.mjs`, carrier `#5277`) → F2 spike (design
first, `architect`, then `impl`/`qa`; the design must state its own fast loop per D213: a mocked-provider
behaviour test, no live provider needed to iterate).

## 4. What only the operator can do

- **Rule 333 (a/b/c)** — credentials, rotation and grants (333 is marked operator-gated for a reason).
- **Decide whether a new long-lived local daemon is acceptable** (F1/F3) — capacity, boot order, and a
  support surface; and whether a MITM-CA posture change is acceptable (F3).
- **Rotate**, and tell the rig it rotated (326's other half). The delegate can only verify a key is live.
- **Decide whether seats may ever hold a scoped token at all** — that decision is what separates F2 from F1.
- Deliberately **not** done by the delegate: any pass/delegation spend (family headroom is $0.15041), any new
  seat or capacity, any push beyond the granted batch (the grant was spent this session: `4c3fd7cc..4620cecf`).

## 5. Brainstorm — smaller things the sweep surfaced that are worth having anyway

These are cheap, independent of D-A/D-B, and each names the mechanism it borrows:

1. **Ordering rule: refuse before touching a credential.** oh-my-pi answers `404 Unknown model` and `400`
   *"before any credential lookup"*; codex authorizes host/method/path before substituting a secret. Our
   analog: a seat/model combination that policy refuses should never reach a provider request — cheaper than a
   cap, and it makes the 321 backoff story legible.
2. **Consumer config must not redirect broker traffic.** oh-my-pi's gateway *"ignores the host's `models.yml`
   overrides/custom models so local base URLs, headers, and keys cannot redirect broker-backed traffic"*.
   That is the 332 parallel-plane problem stated as a security rule: the S1/S2 layering must decide, in code,
   which plane wins — and print the winner.
3. **No silent fallback to a weaker credential plane.** Two independent sources say it: pi's *"No silent env
   fallback after a failed refresh"* and oh-my-pi's *"it never silently opens the local credential store
   instead"*. durian-pi already agrees (323 refuses to register an unpriced model rather than synthesize a
   free one) — write the same sentence into the credential path before someone "helpfully" adds a fallback.
4. **Classify credential failures as definitive vs transient** (oh-my-pi: definitive → disable that credential
   version with compare-and-set; transient → leave it for the next sweep). Pairs with 321 (provider overload
   booked with no backoff) and would stop a dark family from being re-probed into spend.
5. **Secrets reach a helper over stdin, never argv** (OpenHands: *"Secrets reach the tools on stdin, never on
   the command line, where other processes could read them"*). One sentence for
   `docs/runbooks/leaked-secret.md`, and a check for the delegate's own verbs.
6. **A seat asks the operator for a missing secret instead of dying** (OpenHands' `request_secret` client tool:
   *"Never ask the user to paste a secret into the chat… exposed to this conversation as an environment
   variable named after the secret… this tool is acknowledged immediately, before the user has answered"*).
   Fits the operator-wait design already in `docs/reviews/designer-operator-waiting.md` and would replace the
   `No API key for provider: local` dead-end (`docs/runbooks/local-provider-down.md` state 7) with a card.
7. **Reversible placeholders** (M11) are the feature durian-pi most lacks: today a redacted value is simply
   gone, so a seat that legitimately needs to *use* a credential (a git remote, a deploy command) cannot. If
   F2 lands, placeholders are the natural seat-facing surface of it.
8. **Name the credential in use, where it is set, and how to remove it** (claude's startup refusal,
   `CHANGELOG.md:1938`) — one preflight line, and it is also what makes A's "visibility tax" worth paying.
9. **Pass a resolver, never a value** (prime-agent `agent.rs:564,571`, `agent_loop/response.rs:104-111`) — the
   child config's `api_key` is `None` and the *callback* is what gets inherited. This is the cheapest true
   boundary in the whole sweep, and it is a rule we can write down today: **no durian-pi structure should hold
   a materialized credential in anything a seat can reach or a derived seat inherits.** It is also the shape
   335's ask-the-operator tool and 342's gateway should present to a seat: a **name**, resolved by the host.

## 6. What would falsify this recommendation

- If a seat shell can be shown to **not** be able to reach `/proc/<broker>/environ` on the hosts we actually
  run (e.g. `hidepid=`, a separate uid, or a sandbox), D's urgency drops — the probe is
  `node .spike/delegate-20261107/envprobe/procfs-canary.mjs` (6 s, canary values, names only).
- If the operator rules that seats may hold scoped tokens, F1 becomes cheaper than F2 and this ranking
  changes — F1's cost is a daemon, F2's is design work.
- If 332's S1/S2 land and the pi settings plane becomes a *named* input layer, C's maintenance argument gets
  stronger and may beat A.
- The redaction-coverage claim (H2) is only half-measured: the classifier's behaviour is measured, the live
  keys' shapes are not (the delegate has no key in its environment). A name-only shape check by the operator
  closes it in one command.
