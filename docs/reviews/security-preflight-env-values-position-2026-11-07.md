# SECURITY POSITION — the broker preflight prints credential VALUES (`tools/broker-serve.mjs` `envNotes`)

*Seat:* `security` · *Item:* #5338 (re-registration of RM-295 — RM-295 is **not closed**) · *Measured on:* `7e5afe39` (a descendant of `46c28b73`; contains `ef29516d` where RM-295 was first observed) · *Date:* 2026-11-07

## Verdict

**OPEN, severity HIGH.** The runbook-blessed first command of every broker recovery path prints the
**values** of every variable in the `DURIG_(LOCAL|VERIFIER)_*` environment family, and that family
**includes the provider API keys** (`src/providers/local.mjs:174` — `apiKeyEnv: ${prefix}API_KEY`). A key
that reaches terminal stdout is a **rotation event for the operator**, not a cleanup. No code change is
proposed here — the position precedes the fix and the fix is routed (#5338 → `devtools`).

RM-295 must not be read as closed: the row is registered and `docs/ROADMAP.md:5790-5824` describes the
cause correctly, but the printing code is **unchanged at HEAD** (`tools/broker-serve.mjs:465-471`), and the
`done` recorded on the earlier fix item carries **no artifact**, so there is nothing re-checkable behind it.

## Scope

- **What prints:** `tools/broker-serve.mjs:465-471` — `envNotes` spreads
  `Object.entries(process.env).filter(([k]) => /^DURIG_(LOCAL|VERIFIER)_/.test(k))` — the **whole family,
  values included** — and line 471 prints it with `JSON.stringify` on stdout for **`--status`, `--dry-run`
  and `--stop`** alike (the print sits above the action dispatch at `:482`, so every verb pays it).
- **Who runs it:** `docs/runbooks/broker-down-or-stalled.md`, `local-provider-down.md`,
  `session-start-cost.md`, `verifier-model-server.md`, `hygiene-and-dead-model-pointers.md`,
  `constitution-amendment.md` and `.agents/skills/delegating-to-durian-pi/SKILL.md` all start from this
  command — i.e. it is run **first, under stress**, and its output is pasted into reports and agent
  transcripts (measured: 7 blessers at HEAD).
- **Where the value lands:** terminal stdout. My sentinel scan found the sentinel **only** in my own
  capture file — no store row, no `.spike/*.out`, no log, no tracked file. That narrows the blast radius
  to *whatever captures the terminal*, which in this rig means **agent transcripts and pasted reports**.

## Measurement (re-runnable, sentinel-only — no real secret was printed, ever)

Sentinels are fake values I invented for the probe; the probe asserts on **my** sentinels, never on the
operator's keys, so running it cannot leak anything.

```
cd "$(git rev-parse --show-toplevel)" && mkdir -p .probe && \
DURIG_DB=./.probe/probe.sqlite \
  DURIG_LOCAL_API_KEY='SENTINEL-LOCAL-KEY-9f3a1c' \
  DURIG_VERIFIER_API_KEY='SENTINEL-VERIF-KEY-9f3a1c' \
  DURIG_LOCAL_BASE_URL='https://sentinel.invalid/v1' \
  DURIG_VERIFIER_MODEL='sentinel/model-x' \
  DURIG_VERIFIER_PRICE_USD_IN='0.000001' \
node tools/broker-serve.mjs --status > .probe/status.out; echo "exit=$?"
grep -cF 'SENTINEL-' .probe/status.out
```

Result at `7e5afe39`: **`exit=0`, 5/5 sentinel values present in stdout**, the two `*_API_KEY` values
among them. The printed line, with my sentinel values redacted:

```
env: {"DURIG_DB":"./.probe/probe.sqlite","DURIG_SEAT_ROOT":"(unset …)","DURIG_LOCAL_BASE_URL":"https://sentinel.invalid/v1",
      "DURIG_VERIFIER_MODEL":"sentinel/model-x","DURIG_VERIFIER_PRICE_USD_IN":"0.000001",
      "DURIG_VERIFIER_API_KEY":"<REDACTED>","DURIG_LOCAL_API_KEY":"<REDACTED>"}
```

Do **not** run this with the operator's `--env-file` to "confirm" it — that is how a confirmation becomes a
second leak. The sentinel form is sufficient and it is the form the gate must use.

## In-tree precedent (the mechanism already exists, twice)

- `tools/verifier-arm-probe.mjs:91-92` — prints `keyPresentInEnv: Boolean(process.env[spec.apiKeyEnv])`
  with the comment *"PRESENCE only; the value is never read out"*. **This is the shape the preflight should
  have.**
- `tools/verifier-arm-probe.mjs:126-137` — a **self-check**: it serializes its own output and fails if the
  actual value of any of its credential variables appears in it. This is the reusable control. Its
  weakness is that `credentialNames` is a **hardcoded list**, so a provider prefix added later is not
  covered; a name-class rule is what makes it survive growth.
- `src/config.mjs:82` `looksLikeSecret` + `assertNoSecretsInFile` — the value-shape predicate #5125's
  config-layer gate uses. It closes the **file** layer; this finding is the same leak class still open at
  the **preflight** layer.

## Threat model

| # | Threat (attacker = habit, not an adversary) | Proposed control | Falsification probe (can run, can fail) |
|---|---|---|---|
| T1 | An operator/seat runs the blessed `--status` under stress; the output lands in a transcript, a CI log or a pasted runbook report | Print **presence**, never a value, for credential-class keys | Sentinel run above: `grep -cF 'SENTINEL-'` on stdout must be **0** (today: **5**) |
| T2 | The credential value is durable in the **store/transcript**, so it survives compaction and gets quoted into later rows and later seats' context | Same control; plus an assertion that the sentinel is absent from the store and from `.spike/*` after the run | Same run, then `grep -rlF <sentinel> "$DURIG_DB" .spike` → must find nothing |
| T3 | A new provider prefix (`DURIG_<X>_API_KEY`) silently joins the regex family and inherits the leak | Masking keyed on **name class** (`API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL`), not a hardcoded name list | Sentinel in a name the current list does **not** contain (e.g. `DURIG_SANDBOX_API_KEY` — outside the current regex, so first widen the read, then prove the mask holds) |
| T4 | A one-line "fix" deletes the family from the dump, blinding the preflight — it exists to answer *which provider is armed, at what base URL, at what price* | Per-key output must **keep the key name** and say `set`; non-secret classes (`BASE_URL`, `MODEL`, `PRICE_USD_*`) keep printing values verbatim | Assert the line still contains `DURIG_VERIFIER_API_KEY` and the substring `set`, and that the sentinel base URL/model/price **do** appear |
| T5 | A credential whose value is short or low-entropy slips past `looksLikeSecret` (it requires length ≥ 16 and a high-entropy shape, `src/config.mjs:82-87`) | Name-class masking is **primary**; `looksLikeSecret(value)` is the second net, not the first | Sentinel `DURIG_VERIFIER_API_KEY='abc123'` (below the shape floor) must still print as `set` |
| T6 | The fix lands but regresses silently later — `envNotes` is a three-line spread that a refactor re-widens | A `toolchain`-area demo in the suite (model: `demo/config-credential-surface.test.mjs`, which already uses sentinels at the config layer) so a regression goes **red in the suite**, not in a report | `node demo/broker-serve-env-no-value.test.mjs` exits **0**; deleting the mask must make it exit non-zero |

## Non-goals

- **Rotation is not a code change.** Values printed at `ef29516d` (and any later run) are already exposed;
  rotating those provider keys is the operator's call (D205: record the fact, never the secret). This doc
  deliberately does not re-print them, and its quotes are truncated.
- Not proposed here: a secret broker, a credential store, or the `--env-file` ergonomics — those live in
  `docs/reviews/credential-architecture-options-2026-11-07.md` and its follow-up prompt.
- Not in scope: RM-296 (the same `--dry-run` makes an **unmetered-metered** provider call). Same file,
  different finding, different owner — do not bundle the two into one change.

## Gates (what must hold before the fix is accepted)

1. A **failing-first** demo exists and its red state is recorded: sentinel in every credential-class env
   var, run `--status`, assert the sentinel never appears on stdout **or stderr**.
2. Presence reporting survives: the preflight must still answer "armed or not, at what base, at what price"
   (T4) — a fix that answers nothing is a regression, not a fix.
3. Masking is by **name class with a value-shape backstop** (T3/T5), not a hardcoded list.
4. The demo runs against a **temp store** inside the worktree, never the live `rig.sqlite`/`selfdev.sqlite`,
   and it must not spawn a metered provider call (use `--status`, not `--dry-run` — RM-296).
5. `docs/runbooks/*` do not change their prescribed command; the *output* they describe must become the
   safe one, so the recovery path stays copy-pasteable under stress.

## Evidence index

- Printing code, unchanged at HEAD: `tools/broker-serve.mjs:465-471` (quoted above).
- Family includes the keys: `src/providers/local.mjs:174`, `:245`.
- Blessers: 7 (runbooks + delegate skill), grepped at HEAD.
- Precedent: `tools/verifier-arm-probe.mjs:91-92`, `:126-137`; `src/config.mjs:82-100`.
- Prior finding at the config layer: `docs/ROADMAP.md` RM-295 (`:5790-5824`), #5125.
- Probe: the sentinel block above, run at `7e5afe39` → exit 0, 5/5 values printed.
