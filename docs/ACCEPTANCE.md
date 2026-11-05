# durian-pi — user acceptance requirements

Derived from operator directives this session. Each requirement names the
check that proves it. Status: PASS = proven by a run; OPEN = not yet built.

## UAR-1 — LLM-operable CLI
An LLM agent must be able to operate the rig on the operator's behalf.
- Every command outputs exactly one JSON document. **PASS** (CLI roundtrip)
- Exit 0 on success, nonzero on failure; errors as `{ok:false,error}`. **PASS**
- `send` waits and returns the seat's reply inline (no polling). **PASS**
- No interactive prompts anywhere. **PASS**

## UAR-2 — Durable state across invocations
State must survive process death between CLI calls.
- Seats registered by `up` are visible to later `ps`. **PASS**
- Queue items persist and re-arm via `resume()`. **PASS** (sqlite storage)
- Mid-run crash recovery is pi-durable's guarantee, not ours to rebuild. **PASS** (substrate)

## UAR-3 — Provider via the extension architecture
Provider options must come from the same source the pi-deepinfra extension
uses, not duplicated constants.
- cli.mjs imports BASE_URL/PROVIDER_ID/COMPAT/fallbackModels from
  vendor/pi-deepinfra/models.ts. **PASS**
- Real DeepInfra traffic flows through durian-pi seats. **PASS** (demo/online.mjs,
  ONLINE DEMO PASS; CLI send → done)
- Ambient key only: DEEPINFRA_API_KEY read from env, never stored/printed. **PASS**

## UAR-4 — Structured team definition (six layers)
Persona, capabilities, org position, culture, collaboration rules, workflow.
- Persona fields role/goal/backstory/constraints compile into seat prompts. **PASS** (compilePersona)
- Capability tags advertised per seat; send_work can require one. **PASS** (offline-v2)
- Org edges restrict who may send to whom; restrictive-by-default. **PASS** (offline-v2: forbidden send refused)
- Constitution file injected into every seat's system prompt. **PASS** (offline-v2 asserts "P1 Grounding" appears in a pi.system entry)

## UAR-5 — Migration path for OpenRig users
An OpenRig rig.yaml converts into a durian-pi v2 spec without hand-editing.
- Converter maps name/role/model/skills/**`guidance/role.md` persona inlined as `# Role`**/instructions/delegates_to, pod edges
  **and rig-level edges** (cross-pod escalates_to / collaborates_with /
  can_observe). **PASS** (`demo/converter.test.mjs`, 20th demo)
- Pods grouping: converted with a warning, structure dropped. **OPEN**
  (accepted loss until pods are designed)

## UAR-6 — Offline-first testing
All structural behavior provable without network or keys.
- Demos use faux provider + MemoryStorage with loud assertions. **PASS**
- Known limitation: faux CLI mode is plumbing-only (per-process scripting);
  full offline loops live in demos. Documented in DECISIONS.md D8. **PASS**
- A whole delegation loop (pm → `send_work` → worker claims → `complete_work` → DONE notice) runs on mocked models with no
  network and no keys. **PASS** — `node demo/offline.mjs`, measured **0.301 s** (2026-11-05).
- The offline loop must stay **hermetic**: no test in it may require a credential, the network, or a model server.
  **OPEN — red today**: `demo/deepinfra-catalog.test.mjs` fails when `DEEPINFRA_API_KEY` is absent, so the offline run reports
  **257/258**. Registered as ROADMAP **282** clause 2 (D213).

## UAR-8 — Every piece has a fast iteration loop (D213, operator ruling 2026-11-05)
The operator must be able to change any piece and learn quickly whether it broke. A slow loop is an architectural defect, not
a cost of doing business; a part that restricts iteration is **isolated**, not tolerated.
- Pieces are **separately testable** and selection is an instrument, not a habit: `node scripts/test.mjs --list` / `--area`,
  `tools/what-to-test.mjs` (diff → derived tests), coverage enforced by `demo/test-areas.test.mjs`. **PASS** — 258 demos across
  9 areas; full suite **257/258 in 57.0 s** (measured 2026-11-05); `--timeout` (default 120 s) means a hung test is a FAIL,
  never a hang.
- **Agent behavior is testable with no model at all** (`fauxProvider`), and a smaller/faster model is legitimate **in test
  cases**; the cross-family author/verifier rule is a production staffing rule (D210/D211), not a test-lane constraint.
  **PASS** as a capability (77 of 258 demos), **OPEN** as a rule with a gate.
- Every piece **declares its iteration cost in seconds** and the seam that keeps the fast path, and `check`/CI **fails a piece
  whose loop exceeds its budget**. **OPEN** — `check` carries no timing rule today; registered as ROADMAP **282**.
- Slow-by-nature parts are **quarantined into a named lane** with their coverage replaced on the fast plane, and anything
  needing a key/network/model server lives outside the default loop. **OPEN** — ROADMAP **282**.
- The slowest runtime costs are **bounded and measured, not accepted**: turn lifetime (ROADMAP **283** — 185 generations,
  0.29%, hold 64.6% of generation busy time), compaction cost (ROADMAP **284** — p95 4.2 min, 55.5 h total), pre-request
  refusal of doomed spend (ROADMAP **285** — 14,377 refusal-ended generations, 22.5 h), and fixed sleeps replaced by event
  waits (ROADMAP **286** — 43 of 258 demos sleep).
- **Never buy speed with verification depth.** A speed-up that stops asserting the thing it used to assert is a fake green
  (D91) and is refused; removing a real-model check from the default loop is an operator/pm product call.


## UAR-7 — Upstream tracking
durian-pi stays aligned with pi-durable releases.
- Update + regression demos after each `pi update`. Applied 1.0.4→1.1.0,
  both demos green post-update. **standing practice**
