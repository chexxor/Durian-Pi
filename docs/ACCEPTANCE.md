# durig — user acceptance requirements

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
- Real DeepInfra traffic flows through durig seats. **PASS** (demo/online.mjs,
  ONLINE DEMO PASS; CLI send → done)
- Ambient key only: DEEPINFRA_API_KEY read from env, never stored/printed. **PASS**

## UAR-4 — Structured team definition (six layers)
Persona, capabilities, org position, culture, collaboration rules, workflow.
- Persona fields role/goal/backstory/constraints compile into seat prompts. **PASS** (compilePersona)
- Capability tags advertised per seat; send_work can require one. **PASS** (offline-v2)
- Org edges restrict who may send to whom; restrictive-by-default. **PASS** (offline-v2: forbidden send refused)
- Constitution file injected into every seat's system prompt. **PASS** (offline-v2 asserts "P1 Grounding" appears in a pi.system entry)

## UAR-5 — Migration path for OpenRig users
An OpenRig rig.yaml converts into a durig v2 spec without hand-editing.
- Converter maps name/role/model/skills/instructions/delegates_to. **PASS**
  (test-fixture-rig.yaml → version 2 spec with edgeGroups)
- Pods grouping: converted with a warning, structure dropped. **OPEN**
  (accepted loss until pods are designed)

## UAR-6 — Offline-first testing
All structural behavior provable without network or keys.
- Demos use faux provider + MemoryStorage with loud assertions. **PASS**
- Known limitation: faux CLI mode is plumbing-only (per-process scripting);
  full offline loops live in demos. Documented in DECISIONS.md D8. **PASS**

## UAR-7 — Upstream tracking
durig stays aligned with pi-durable releases.
- Update + regression demos after each `pi update`. Applied 1.0.4→1.1.0,
  both demos green post-update. **standing practice**
