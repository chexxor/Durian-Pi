# Research prompt — is there a standard (or dominant de-facto) format for an agent/persona definition file: system prompt + model + tools + security?

**Why this is a research request, not a review.** The 2026-10-28 sweep of seven vendored projects
(`docs/COMPETITORS.md` §"What the seven say about *formatting* a system-level prompt") found a **converged vocabulary with
no standard behind it**: `name`/`description`, a `tools:` allowlist, `model:` as a role alias, a JSON-Schema-shaped
`output:` return contract, replace-vs-append override slots, a protected default profile — and **no project declares any
security property in the definition file**. Seven projects is our own sample, not the field. Before the operator rules on
the seat-persona surface (ruling 1 in `docs/NEXT.md`) — and before we write a format of our own that we would have to
maintain — we need to know whether an external standard or a dominant de-facto already exists that we could adopt or
target.

## Context

durian-pi: local, single-operator rig; ~12 persistent "seats" (each a `pi` coding-agent session) driven over a sqlite
work queue by a broker; native host OS only (no containers); an operator who holds the push/approval grants. Seat
definitions today are `{name, model, instructions}` inline JSON. A parked branch (`wip/seat-prompt-files`) moves the 12
persona strings to `prompts/<seat>.md`. The candidate shape from our sweep is a markdown file with YAML front matter
carrying model (as a role alias), a tools allowlist, sub-agent spawn declarations, and a structured return contract.
Two audiences: the **human operator** editing these before the rig starts, and **seats/delegates** who must be able to
verify that what a definition claims is what the harness enforces.

## Questions

1. **Standards bodies / formal specs.** Is there any ratified or draft standard for describing an agent's identity,
   system prompt, model choice, tool grants, and security posture? Check the shape of: Agent Cards / agent-to-agent
   interop specs (e.g. A2A-style "agent card" documents), MCP's tool/resource configuration surface, the Agent Skills
   format specification (skills only — confirm what it does *not* cover), JSON Schema / **JTD** as the contract language
   for structured agent output, and any OWASP/CIS/ISO/NIST guidance that prescribes **fields** rather than behaviour.
   For each: what is normative, what is optional, and what version/date.
2. **Dominant de-facto formats in production tools.** What do widely used coding/agent tools actually put in an agent or
   subagent definition file — Claude Code subagents, OpenAI Agents SDK / AgentKit (`instructions`, tools, guardrails),
   LangGraph / Pydantic-AI agent config, CrewAI `agents.yaml`, AutoGen/Gemini/ADK agent config, AGENTS.md (who adopted
   it, is there a spec, how is precedence defined). Give the **key set** each uses, and where they agree or clash.
3. **Precedence and layering.** For systems that support several instruction layers (global/user/project/subdir), what is
   the documented merge order and last-writer-wins rule? Any documented footguns.
4. **Model selection vocabulary.** Is there precedent for declaring a model **role/tier** (e.g. `@slow`, `cheap`,
   `strong-reasoner`) resolved through config rather than a literal model id? Who does it, how are aliases defined, what
   breaks when an alias cannot be resolved.
5. **The security half — the real question.** Is there any established way to express, in an agent definition: which
   actions require **human approval**, which paths/commands are allowed, capability grants, or a reference to a threat
   model / policy (e.g. OPA/Rego sidecar, Cedar policies, OSAML, enterprise allowlists)? Is the norm "policies live
   outside the agent definition, in a policy engine", and if so, what is the accepted **linkage** between the definition
   and the policy (ids, labels, capability names)? Cite implementations, not intentions.
6. **Contract/verification conventions.** For the agent's **return contract**: is a JSON-Schema/JTD-shaped `output`
   block the norm, and is there published practice for validating agent output against it (validators used, failure
   handling, whether "error" and "fail" are kept distinct in the schema)?
7. **Migration risk.** What is the observed cost of adopting a third-party agent-definition format vs inventing a small
   one — silent breakage on upstream format changes, version pinning, and how projects note "we target format version X".

## Deliverable

Write `docs/reviews/agent-definition-format-standards-research.md`:

1. **Verdict up front** — one of: (a) a standard exists, target it (name it + version), (b) a dominant de-facto exists,
   adopt its key set (list the keys and their meanings), or (c) nothing settled; design a minimal internal format and
   keep it isolated. Give the reason in two sentences.
2. **Table of formats** — one row per system/standard: definition file name, key set, instruction layering, model
   vocabulary, security fields (or "none"), output contract, licence/spec status, cited version + date.
3. **What is genuinely interchangeable** — the subset of keys that map cleanly across systems, and the parts that do not.
4. **Security-expression practice** — Question 5's answer, with the recommended linkage between a definition and an
   external policy if the norm is separation.
5. **Recommendation for durian-pi's seat file** — a concrete field list we could adopt with the least invention, each
   field attributed to the external system it comes from, plus what we would have to build ourselves (explicitly: if
   nothing external covers approval/path grants, say so and name the closest policy-engine convention).
6. **What we should NOT adopt** — fields that only make sense with cloud, multi-user, or marketplace use.

## Evidence discipline

Every claim cites a **URL plus the artifact's version/commit/date** (this space moves within a day — measured: five of
our seven vendored clones went behind upstream in 24 h). Class each claim `observed-externally` (I read the file/spec
text), `advertised-elsewhere` (the vendor's own docs assert it, unverified), or `inferred`. Quote the exact key names.
Where a claim cannot be grounded, write `unverified` rather than generalizing. Do not treat our own
`docs/COMPETITORS.md` or `docs/reviews/*-review.md` as sources — they are our sample, not the field.

## Constraints

Written report only; do not modify code; do not clone into `vendor/eval/` (pinned by `docs/VENDOR-PINS.md`; re-cloning is
the delegate's call per `docs/runbooks/competitor-review.md` Do 0); do not open or claim a queue item. Native host OS
only. Prefer primary spec text and source files over blog summaries; a benchmark post without a repo is not evidence.
