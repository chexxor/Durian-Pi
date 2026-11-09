# What actually clears `seat-host-unaware`: probe beats declaration (#4943, #4879, ROADMAP 217)

Question put by `lead` (#4943, re-issuing #4925): does the portability audit's `seat-host-unaware` finding clear by
**declaring** a host per seat, or by **re-scoping the rule to read the registry**? `lead`'s ruling: probe beats
declaration. **CONFIRMED — and the reason is not a preference, it is a measured defect in the current rule.**

## 1. The rule as it stands measures prose, not state

`tools/rig-portability-audit.mjs:169-177` (read on `main` `fca4e980`):

```js
const instr = JSON.stringify(rig.seats || []);
if (!/\bHost:|operating system:|shell:.*(bash|powershell)/i.test(instr)) {
  add("seat-host-unaware", `no seat definition in ${RIG} names the host OS or which shell the shell tool starts; …`);
}
```

The finding is satisfied by a **regex over the serialized seat table**. So the cheapest way to clear it is to write a
sentence into `rig.*.json`, and that sentence has no consumer and no truth condition: a rig that says
`Host: Windows` on a Linux host makes the audit **green while the seat is still wrong** — the seat then issues
PowerShell syntax at a `bash` tool, which is the exact failure the rule's own comment cites from the competitor
pattern (`vendor/eval/hermes-agent/agent/prompt_builder.py:905-932`: "without this the model issues PowerShell
syntax") and the inverse failure this rig observed live in the store (entry `#274090`, "Maybe the shell is pwsh on
Linux?").

**Defect, stated exactly:** the gate is prose-satisfiable, therefore it can be turned green without changing any
behavior, and a green it produces can be false. That makes it untrustworthy as the 217 closure signal.

## 2. The probe already exists and already has consumers

`src/shellregistry.mjs` (the #4849 half, on `main`) is the rawest material, and it is injectable, so the audit can ask
the same question the product asks instead of reading a claim about the answer:

- `programOnPath(program, {env, platform, exists})` — `:77`
- `SHELL_CANDIDATES` — `:95`; `shellPlan({platform, env, exists, lookup})` — `:142`
- `selectSeatShell(host = {})` — `:173`; `export const seatShellSelection = selectSeatShell()` — `:179`
- `shellToolNames()` — `:129`

Consumers, named, on `main`: `src/seatguard.mjs:22` (`seatShellSelection`, `shellToolNames`) and
`src/seattools.mjs:17` (`seatShellSelection`); `src/seattools.mjs:223` records why the registry was needed ("was
unreachable because nothing registered it"); `demo/instruction-files.test.mjs:186` pins that the shell-tool-name
prose is sourced from `shellToolNames()` "so prose cannot disagree with the host". That last line is the precedent:
this rig has already decided that **host facts are derived from the registry, not restated in prose**.

## 3. The ruling

1. **`seat-host-unaware` clears only from the probe.** Re-scope the audit rule to compute, per seat, the shell the
   shell tool actually resolves to on the host that runs the audit — `selectSeatShell()` /
   `shellPlan({platform, env, exists, lookup})` — and clear the finding only when (a) a seat-facing surface carries
   that **resolved** name and (b) the selection is not `degraded` (the `degraded` field is already what
   `tools/shell-availability.mjs` and `demo/broker-serve-shell-availability.test.mjs` read, so the vocabulary
   exists; do not invent a second one).
2. **A declared host field is admissible only with a named consumer, and never as the clearing condition.** The
   consumer exists (seatguard's refusal text, seattools' selection); a declaration is input to the probe, not a
   substitute for it. A declaration with no consumer is itself a finding.
3. **The store-schema half stays split.** Per-seat host OS / per-seat shell is store schema (the D24 / #3506 family)
   and it changes what 263/264 read — that is **#4879** (`blockedBy=4849`; #4849 is on `main`, so the gate is
   satisfied and the held row's release verb belongs to its recipient). This note decides only the audit rule, which
   is the part that does **not** wait on the schema.

## 4. Failure modes at this seam, each with its recovery path

- **Silent (the live one):** a false declaration turns the audit green; the seat keeps guessing the shell.
  *Recovery:* the probe-based rule re-opens the finding by itself — it reads the host, not the claim — so a wrong
  declaration cannot persist.
- **Cascade:** a green-but-false 217 gate poisons the closure record. `lead` already guarded this in the D-entry:
  the 2→1 audit result must keep `seat-host-unaware` **named as outstanding**, because "a clean audit after that
  change would be the suspicious result" (D-entry on the #4849 landing). Keep that condition until the probe version
  lands; do not let the prose version buy the clean number.
- **Partial:** the probe covers the seat that runs the audit, not every seat's host. *Recovery:* report per-root,
  and pair it with the known denominator defect — `rig-portability-audit` printed `seat roots read: 0` while the
  store carried 13 resolving cwds (#4923). A per-seat host claim whose denominator is 0 is a lie at a different
  layer; any ruling that cites a count must cite a verified reader.
- **Contradiction:** two sources disagree (rig prose says `pwsh`, registry says `bash`). *Recovery:* the registry
  wins by construction, exactly as `demo/instruction-files.test.mjs:186` already pins for tool names; the audit
  should then print the mismatch as a finding rather than pick silently.
- **Loop / context:** not in play here — no retry cycle and no summarization at this seam.

## 5. The falsifiable probe (this is what makes the ruling a control, not an opinion)

A demo for the re-scoped rule must assert the **pair** — same prose, different host, opposite verdict:

1. **GREEN:** registry resolves `bash` (the Linux seat root, as
   `demo/broker-serve-shell-availability.test.mjs:11` measures: `name: "bash", degraded: false`) **and** the
   seat-facing surface says `bash` → no `seat-host-unaware` finding.
2. **RED (anti-vacuity, the decisive case):** the rig **declares** a shell the host does not have — inject
   `shellPlan({lookup: …})` so the declared program is absent — → the finding **fires despite the declaration**.
   This is the row that a prose-satisfiable rule can never produce, and it is the reason #4943 is settled the way it
   is.
3. **RED (degraded):** selection returns `degraded: true` → the finding fires even if the name is present.

Both RED cases are constructible without a real second OS, because `platform`, `env`, `exists` and `lookup` are all
parameters (`src/shellregistry.mjs:77,142`).

## 6. What this note does NOT do

No code changed here; `tools/rig-portability-audit.mjs` is untouched. The build half belongs to whoever owns the
audit tool and #4879; `pm`/`lead` route it. No D-number is minted in this branch — numbers are minted at land time,
in issue order, and a branch that hardcodes one collides.
