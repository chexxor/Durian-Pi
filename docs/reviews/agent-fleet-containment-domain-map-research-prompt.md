# Research commission — the domain map for containing and permissioning coding-agent fleets (competitor + standards survey)

**Status: READY TO ROUTE** (delegate-written 2026-11-05, on the operator's ruling: **"continue the research. We should
have a thorough understanding of the domain before we design a solution for our needs"**, plus the operator's offer to
pass prompts to their own research agent). This commission is **for the operator to route**, not for the team to run.

The agent is off-host with **no write access to this repo**, so ask it for **content to copy**, never for commits. The
delegate fetches every cited URL into `inputs/fetched/`, builds a manifest, and checks each quote against our own copy
(`docs/runbooks/research-request.md`).

**Why this one and not another prior-art read.** We already pinned and first-pass-triaged ~27 projects
(`docs/VENDOR-PINS.md`), and a `security` seat has measured our own enforcement stack. What we do **not** have is the
**domain map**: who else runs a fleet of agent processes on real machines, what vocabulary and standards the field has
settled on, which control axes ship in products rather than papers, and what everyone silently gives up. Designing our
substrate without that map is how a team ends up building a bespoke version of something already settled — or of
something known to fail.

## Context the agent needs (self-contained — assume it cannot see our repo)

durian-pi runs a **team of twelve LLM "seats"** (model-driven agents with tool use) on **one native host**, driven by a
durable queue over one durable store. Every seat's model-issued tool call passes a single hook in an installed
extension; the hook does command deny-rules and write-target confinement. Seats work in per-item git worktrees. The host
rule is absolute: **native OS only — Linux and Windows, never WSL, never Docker, never a VM or cloud sandbox**; every
seat runs as **one OS user**; there is no container daemon and no second machine. A seat's child processes get a scrubbed
environment (no credential-named variable crosses), but there is **no egress control, no per-task grant, and no durable
record of a refusal**. A second model, different family, is intended to adjudicate requests for more reach.

So the questions are always asked against that constraint set: **one box, one OS user, no container, no daemon we can
avoid, control shipped as an installable extension, and a model as the adjudicator.**

## Questions

1. **Who operates agent *fleets* with per-agent containment today, and at what fidelity?** Build a landscape of
   shipping systems (not blog posts): coding-agent products (e.g. Claude Code, OpenAI Codex CLI/Cloud, GitHub Copilot
   CLI/Agent, Cursor, Aider, OpenHands, Goose, Cline, Windsurf, Devin, Jules, Jules-class autonomous PR agents),
   agent-sandbox/execution vendors (e.g. E2B, Modal, Daytona, Runloop, Morph, Fly Machines, Kubernetes `agent-sandbox`,
   gVisor/Firecracker-based runners), CI-shaped runners (Buildkite, Depot, self-hosted runners with hardening), and
   multi-agent frameworks (LangGraph/AutoGen/CrewAI/Swarm-class) that claim policy layers. For each: **where does the
   agent's code run** (host process / container / VM / microVM / remote), **who owns the boundary** (the product, the OS,
   a proxy, a scheduler), and is the control **enforced or advisory**? Mark `advertised` vs `observed in code` vs
   `measured by the agent`.
2. **The six control axes, compared.** For each family in Q1, what is actually implemented for:
   (a) **filesystem scope** — read rules as well as write rules? per-task clone/overlay? symlink policy?
   (b) **egress** — default-deny? per-host or per-port? TLS inspection? a proxy? a namespace? nothing?
   (c) **credentials** — injected broker-side, forwarded, proxied, or present in the environment? rotation and revocation?
   (d) **grant lifecycle** — can an agent *ask* for more reach mid-task; is the grant scoped to a task; does it expire;
   is it single-use; can it be revoked; who says yes (human, policy engine, another model)?
   (e) **audit** — one record per decision? queryable? what fields? what keeps secrets out of the audit sink?
   (f) **posture** — any instrument that *grades* the containment (a score, a CI badge, a fail-closed scanner)?
   A table with "not applicable / not shipped / shipped / shipped-and-documented" is more useful than prose.
3. **Vocabulary and standards we should be speaking.** What has the field settled on for: least privilege for agents,
   capability-based security, "confused deputy" in tool-use, prompt-injection-to-action escalation, zero trust for agent
   systems, sandbox-escape taxonomy, per-agent identity. Name the **authoritative documents** (vendor docs, kernel docs,
   OWASP LLM/Agentic Top 10, MITRE ATLAS, NIST SP 800-* that actually applies, ISO/IEC 42001-class, OpenTelemetry
   `gen_ai.*` semantic conventions, Cedar/OPA/Rego policy engines, SIGSTORE/SLSA-style provenance) and for each: what it
   mandates, what it merely recommends, and whether it has any machine-checkable artifact. Flag where two standards use
   one word for different things (we already have this bug internally with "session", "grant", "policy").
4. **Failure modes with receipts.** Collect documented incidents, CVEs, advisories and issue threads where an
   AI-agent's sandbox, permission gate, hook, or approval flow failed — escape, exfiltration, unapproved egress, an
   "ask" that resolved to allow, a policy that silently stopped applying, an audit sink that leaked secrets. Each entry:
   the **issue/CVE id and its title verbatim**, what failed, what layer it failed at, and what the fix was. We want a
   catalogue we can turn into failing probes, so prefer entries with a reproducer.
5. **Adjudicating reach requests with a model — is anyone doing it in production?** Not papers: shipped flows where a
   second model, a policy engine, or a human-in-the-loop service approves an agent's request for more capability, plus
   what they measured (error rates, false-allow rate, latency, escalation path on abstention). If the honest answer is
   "the industry uses static allowlists and human prompts", say that plainly and cite the product docs that prove it.
6. **Multi-tenant single-host reality.** Who runs *several* untrusted-enough agent processes on **one** machine with one
   OS user (the CI-runner shape, the local-dev-multiple-agents shape, the "agents on my laptop" shape) and what did they
   conclude? We specifically want evidence for the claim "OS identity is a norm, not a control" and for whatever counter-
   examples exist (per-user setup, restricted tokens, per-task local users, dedicated service accounts).
7. **What does a buyer/user of a rig like ours expect to be able to see?** From product docs, security pages, and
   compliance questionnaires: the artifacts that show up as table stakes (audit log export, per-project allowlists,
   network policy config, isolation claims, SOC 2 / ISO evidence, "no data leaves the machine" claims). What is claimed
   about agent isolation that is *known* to be weak, and how do vendors word it?
8. **The licensing map for the mechanisms we would want.** For the ~15 mechanisms most likely to be adopted (OS
   sandbox libraries, egress proxies, policy engines, capability shells, audit sinks, posture graders): name the project,
   its licence, and whether its licence is compatible with an **MIT** upstream — and for anything AGPL-3.0 or GPL, state
   precisely what our obligation would be if we (a) shell out to it, (b) link it, (c) vendor it, or (d) relicense our
   tree. The operator has said AGPL adoption is permitted **if necessary**, so do not skip AGPL projects — flag them and
   state the consequence. Also note Apache-2.0 obligations (NOTICE, patent grant) and "no license file" situations.
9. **What nobody has built.** Given the map, name the gaps that matter for a small team: capabilities we would have to
   implement ourselves because no shipped project provides them at our constraint set, and the places where the field's
   accepted answer is wrong for a rig that runs *twelve cooperating agents that share one durable store*.

10. **How fast can the containment change?** (intake addendum, #5148, 2026-11-11 — required by `docs/runbooks/research-request.md` Do step 1 and the D213 iteration-architecture lens; the survey otherwise answers *who contains agents* without answering *how quickly they can change the containment*.) For each family in Q1, where the material exists: what are the pieces of the control plane and what is the loop cost of changing one; is the test plane hermetic or does it need a live model, a live host, or a network; how is the model mocked or substituted in tests; how are **prompt and policy-text changes regression-tested**; what bounds a long agent turn (a token cap, a turn cap, a wall-clock cap); and how are slow or flaky tests quarantined rather than run every time. Mark `not shipped` where a product ships control but no way to test a change to it cheaply — that absence is itself the finding.

## Deliverable

Report to **`docs/reviews/agent-fleet-containment-domain-map-research.md`**. Each section as **one fenced block with no
narration glued to the title line** (what arrives in chat is what we commit verbatim):

1. **Landscape table** (Q1) — system · where code runs · who owns the boundary · enforced/advisory · licence · evidence
   class · citation.
2. **Six-axis control matrix** (Q2) — family × {fs, egress, credentials, grant lifecycle, audit, posture}, with the
   shipped/not-shipped marks and one pointer per cell.
3. **Standards and vocabulary table** (Q3) — document · who owns it · mandates vs recommends · machine-checkable artifact
   · the one-sentence definition we should adopt. Include a **terminology collision** subsection: words that mean
   different things across sources.
4. **Failure catalogue** (Q4) — id · title verbatim · layer that failed · what the fix was · whether a probe could catch it.
5. **Adjudication reality check** (Q5) — what exists in production, what was measured, what is unknown.
6. **Single-host multi-agent evidence** (Q6) — who does it, what they concluded, with quotes.
7. **Table stakes list** (Q7) — the artifacts a user expects to see, and the isolation claims that are known-weak, with
   the vendors' exact wording.
8. **Licence map** (Q8) — mechanism · project · licence · MIT-compatible? · obligation under (a)–(d) above.
9. **Gaps we would have to fill ourselves** (Q9) — each with the closest existing thing and why it falls short.
10. **Iteration-cost table** (Q10) — family · pieces of the control plane · loop cost of changing one · hermetic/live test plane · how the model is mocked · how prompt or policy text is regression-tested · what bounds a long turn · how slow tests are quarantined. One pointer per cell, same evidence classes as above.
11. **What this changes about our plan** — a short list of decisions the map *supports* and a short list of decisions it
    *contradicts*, each tied to a row above. Do not propose our architecture; tell us where our stated constraints make
    an industry-standard option unavailable.

## Evidence discipline (non-negotiable — this is what killed a previous round)

- Every external claim: **verbatim quote ≤ 40 words + URL + your own fetch date**. A line range into a page you fetched
  into your own workspace is not portable to us.
- For code: **repo path + commit sha you read**. Never "the project uses X".
- Evidence class per row: `advertised-elsewhere` / `observed` / `measured`.
- **Title-check every issue/CVE pointer before you characterise it**, and write the title into the row: we once folded a
  report's issue numbers under the wrong titles and it read as verified evidence for a week.
- Prefer primary sources (kernel docs, vendor docs, the project's own source, CVE text). A secondary blog post is a lead,
  not a citation.
- If a system's behaviour cannot be established from public material, put it in the **could-not-verify list** rather than
  inferring it.

## Constraints

- Written report only. **Do not modify code**, do not open issues, do not run any surveyed product, do not scan or probe
  anything.
- Keep our constraint set visible: **native host only (Linux and Windows), no WSL, no Docker, no VM, no cloud sandbox,
  one OS user, no always-on daemon we can avoid, control ships as an installed extension, second-model adjudicator with
  a per-call cost cap.**
- Do not re-survey these projects, which we have already pinned and triaged: `pi-packages`, `pi-permission-modes`,
  `auto-permission-system`, `toolflow`, `pi-secure-it`, `pi-code-tool`, `mudroom`, `llm-sandbox`, `aegis-orchestrator`,
  `ironclaw`, `cloudflare/sandbox-sdk`, `microsoft/agent-governance-toolkit`, `arjan/awesome-agent-sandboxes`. Use them
  only as anchors when comparing ("like X, except …").
