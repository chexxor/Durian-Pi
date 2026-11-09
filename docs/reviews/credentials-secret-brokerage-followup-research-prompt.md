# Follow-up research prompt — credentials and secret brokerage in agent teams (round 2)

Prepared 2026-11-07 by the delegate, in the shape `docs/runbooks/research-request.md` step 4 prescribes.
**This is a prompt for a research agent; the delegate has not run it.** Commission it only for the gaps listed in
§1 that a pinned-clone read **cannot** answer — the questions answered locally already live in
`docs/reviews/credentials-in-agent-teams-competitor-sweep-2026-11-07.md` and re-asking them is wasted spend.
Register the request as a carrier row first (`DURIG_DB=./selfdev.sqlite node cli.mjs queue add --kind architect …`),
and route the result through a seat (§7 of the runbook) — do not hand the doc to a lane as a task.

---

## Context (give this verbatim to the researcher)

durian-pi is a local, single-host multi-agent rig. A **broker** process is the single writer to one SQLite store
and also hosts all seats — a seat is a conversation inside the broker process (`cli.mjs:474`), and a seat's shell
is a **child process of the broker, same uid**. Credentials are **environment variables** whose *names* (never
values) appear in the rig config: `DURIG_VERIFIER_API_KEY` (a metered third-party provider) and
`DURIG_LOCAL_API_KEY` (a loopback GPU endpoint). Seat children get an env allowlist; credential-named variables
are stripped from them (`src/confine.mjs`).

What we already know from reading our own tree and ten pinned competitor clones (do not re-derive):
pi's `CredentialStore` seam and its "stored owns the provider, no silent env fallback" precedence; pi-subagents
handing a sub-runner the parent's **resolved** `apiKey`; OpenHands' secrets service + ask-by-name tool (value
still lands in the conversation env); Codex's egress `credential_broker` (dummy/marker env values, the real
secret substituted at the network path, `Warn/Deny/Error` when a raw credential is found in a child env);
oh-my-pi's `auth-broker` (separate vault, refresh never leaves it, real-vs-redacted enforced as two types) and
`auth-gateway` (request-level proxy, per-client `models`/`accounts` grants, `404`/`400` before any credential
lookup, usage/quota at the holder, plus a `stdio` mode with "no listener, no token"); Goose's and pi's
**command-resolved** credentials (a `!cmd` / `command_auth` command whose output is the key, TTL-cached).

Two constraints that decide every answer: **native host only — no Docker/daemon sidecar is free** (each one is a
capacity and support decision), and **fast iteration is an architectural requirement** — any mechanism proposed
must come with a per-change loop measured **in seconds**, and a real model/provider call must be quarantined as a
named, budgeted opt-in lane.

## Questions

1. **Per-member credential scoping in *teams*, not apps.** For each of: CrewAI, AG2/AutoGen, LangGraph
   (swarm/Supervisor), OpenAI Agents SDK, Claude Code subagents, Codex multi-agent, Gemini CLI extensions,
   Cursor background agents, Devin, OpenHands (multi-agent), Goose recipes/extensions — does any of them give a
   **team member** a credential distinct from the parent's, and if so: where is the boundary enforced (process,
   uid, network, token scope, or only the prompt)? Quote the file/line or doc URL. **Null results are evidence:
   name the project, the version, and the path you searched.**
2. **How is a credential *boundary* tested hermetically by the projects that have one?** We want the test shape,
   not the feature: recorded/faked providers, a canary secret + a leak assertion, a fake-provider plane, or an
   integration test against a live endpoint. Report the **loop cost in seconds** for each shape you find, and
   whether the project's CI runs it on every change or gates it behind a label/slow lane.
3. **Precedence and override across planes.** Does anything support "a fleet/orchestrator selects the credential
   per role, and that selection **overrides** the human's stored login (naming the winner)"? If a project has
   both a user login and a machine/fleet credential, what wins, and is the winner printed anywhere? Cite.
4. **Rotation propagation and detection.** What do rigs do to learn a credential changed: readiness probes,
   TTLs, JWKS/OIDC metadata, invalidation events, provider webhooks? What is the **observed failure mode** when
   they don't (silent 401 masks, retry storms, expired-JWT acceptance)? Prefer sources that name the symptom in a
   changelog or issue with a date.
5. **Minimum-viable self-hosted credential holder with per-consumer budgets, on one host, no Postgres/Redis.**
   Concretely: oh-my-pi's `auth-broker` (SQLite), LiteLLM single-user mode, or any smaller alternative (e.g. a
   small Envoy + Lua policy, Caddy + a token file, an OpenResty/Caddy `forward_auth`, or a cloud KMS-style local
   signer). For each: what it needs to run, whether budgets/quota/usage survive a restart, and what it cannot
   enforce. Include **license** and **how it stores the master secret**.
6. **Reversible secret placeholders / tokenization in a model-facing transcript.** Prior art for what oh-my-pi
   does (deterministic HMAC placeholders restored before tool execution). Specifically: how do others stop a
   transcript reader reversing a placeholder (key storage, per-install secrets, salted vs unsalted), and what
   breaks — compaction/summarisation, diff/patch tools, structured outputs, edit tools that re-emit text?
7. **Egress brokerage for *non-LLM* credentials a seat needs: git over HTTPS, package registries, container
   registries.** Who has shipped this for coding agents (not enterprise SSO), what did the CA/trust plumbing cost
   on a **developer laptop**, and what broke? Include Codex's own limits page and any post-mortem.
8. **Process/uid isolation for members on a single host.** Does any agent team run each member under a distinct
   uid, user namespace, Bubblewrap/Seatbelt profile, or per-member container **by default**, and what did that
   cost in rig complexity (setup, Windows support, debugging)? We want the measured trade against a single-uid
   model, not a feature list.
9. **Governance/audit and standards mapping, with adopt/adapt/reject.** Per-member secret-access audit logs; and
   where our design sits against: OWASP LLM Top 10 ("Sensitive Information Disclosure", "Excessive Agency"),
   NIST SP 800-57 key hierarchy/rotation periods, SPIFFE/SPIRE workload identity, OAuth token exchange (RFC 8693)
   for delegating a scoped credential to a member, and any agent-specific framework (e.g. MCP authorization
   spec — **read its security/transport-security section for what it does *not* protect on a loopback
   transport**). For each: one paragraph on adopt/adapt/reject **for a single-host, one-uid rig**, not a cluster.
10. **Measured cost of a request-level broker in the loop.** Any published or reproducible number for added
    latency per LLM call when a local proxy/broker sits in the path, and how the projects that have one keep the
    developer loop fast (connection reuse, streaming, caching, sampling off-path).

## Deliverable

`docs/reviews/credentials-secret-brokerage-research.md`, written by the researcher, sections:
(1) **Answers to Q1–Q10**, each with the project, the version/pin, and a path or URL;
(2) **A mechanism table** — mechanism · who ships it · where the boundary is enforced (prompt / process / uid /
network / token scope) · what it does **not** protect · licence · what it takes to run on one host;
(3) **Test-shape catalogue** (Q2) with the loop cost in seconds for each;
(4) **A short "what would change durian-pi's choice" section** — the finding that would falsify the current
recommendation in `docs/reviews/credential-architecture-options-2026-11-07.md` (env-only + close reachability +
pilot a request-level gateway);
(5) **Gaps**: what could not be answered and what access would be needed to answer it.

Copy-paste-ready mechanism descriptions with source labels, **≤ 40-word quotations each**, URL **and fetch date**
per quote. Mark anything that is a version-gated feature (e.g. an enterprise/licensed gate) explicitly — we have
already been misled once this cycle by pricing an enterprise feature as if it were available
(`docs/reviews/agent-framework-spend-quota-and-billing-2026-11-06.md`, correction of the Langfuse row).

## Evidence discipline

Distinguish **observed** (a path in a repository you actually opened, with its commit) from **advertised** (their
README/docs prose). Name the clone/URL and the commit. If you read only docs, say "docs-only, not run". Null
results must name the project, version, and the paths searched. Do not present a framework's marketing claim as a
mechanism, and do not price a licensed tier as if it were the open-licensed product.

## Constraints

- **Do not clone or run anything** for this round — read-only. A candidate we would actually adopt is promoted by
  `node tools/vendor-pins.mjs --pin <name> <url>`, never by a one-off clone.
- Every candidate answer must state its **fast loop** (how a seat verifies the mechanism in seconds without a
  provider call), or be labelled as requiring a live provider/model and therefore **opt-in with a declared
  budget**.
- Native host only. Docker-in-Docker or a daemon sidecar is not free: name what has to be installed, started, and
  kept alive across a reboot, and what happens on a machine with no such service.
- Single-host, single-uid is the current topology; anything that assumes a cluster or a secrets manager (Vault,
  cloud KMS, SSO) must say so on the first line and state the minimum non-cluster variant, if one exists.
