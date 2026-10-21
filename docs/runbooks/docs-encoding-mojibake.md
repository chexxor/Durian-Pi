---
runbook: docs-encoding-mojibake
symptom: "an em dash, section sign, ellipsis or arrow in a doc, a rig spec or a seat instruction reads as garbage; or a file shows a change you did not make"
writes: true
precondition: "read-only"
last_verified: 2026-10-20
verified_by: impl
evidence: "#3241 — node demo/seat-instruction-encoding.test.mjs (exit 0); node scripts/fix-mojibake.mjs --write; corrected diagnosis per lead ruling #3316"
check_rule: null
---

# Docs and seat instructions show mojibake (double-encoded UTF-8)

## When to use

You see a run of characters where one punctuation mark belongs: U+00E2 followed by U+20AC
followed by U+201D or U+201C (an em dash or en dash), U+00C2 U+00A7 (a section sign),
U+00E2 U+20AC U+00A6 (an ellipsis), U+00E2 U+02C6 U+02C6 (an element-of arrow). The
symptom is usually reported as "the em dashes are corrupted in every seat instruction".

## Two DIFFERENT failure modes — identify which one you have before touching anything

The first move is always to tell these apart. They share a symptom and share nothing else.

- **(1) A READ ARTEFACT — nothing is wrong on disk.** On Windows PowerShell 5.1
  `Get-Content` and `Select-String` decode with the ANSI code page (CP1252), not UTF-8, so
  a correct file PRINTS as garbage. **Most sightings are this one.** There is nothing to
  repair; the reader is the defect.
- **(2) LANDED CORRUPTION — the stored bytes are wrong.** Something read the file as CP1252
  and wrote it back as UTF-8, so the damaged characters are now the file. The same round
  trip usually also drops a UTF-8 BOM on the file.

**The one-command diagnostic that separates them** — scan the BYTES, never the shell that
shows the symptom:

```bash
node scripts/fix-mojibake.mjs <file...>   # exit 0 + "clean" = mode (1); exit 1 + a hit list = mode (2)
```

If it reports `clean`, **the display is lying and the fix is to read as UTF-8 — do not
repair the file.** Repairing a healthy file is how a five-minute diagnosis becomes a
rewrite of text that was never broken.

**Prevention:** never round-trip text through the PowerShell 5.1 defaults. Read and write
with explicit UTF-8 (`Get-Content -Encoding UTF8` / `Set-Content -Encoding UTF8`, or
`node -e` with `readFileSync(f, "utf8")` / `writeFileSync(f, s, "utf8")`). An unqualified
read piped into a UTF-8 write is exactly the defect.

## Observed blast radius (2026-10-20, the sighting this runbook came from)

Calibrate against this instead of assuming repo-wide damage. The report was "cafee74
mojibaked the em dashes in EVERY seat instruction". Measured: **mode (1)** for the seat
instructions (0 mojibake sequences and 21 real U+2014 in `rig.selfdev.json` at `cafee74`,
`b0577e1` and the fix commit alike — the instruction text never carried the damage), and
**mode (2)** for exactly two docs plus two BOMs:

- `docs/runbooks/README.md` — 12 sequences (em dash, en dash, section sign, ellipsis) + BOM
- `docs/reviews/docs-gap-audit-2026-10-17.md` — 2 sequences (em dash, element-of)
- `docs/runbooks/prepare-workspace-etarget.md` — BOM only

So the durable lesson is not "mojibake means corruption": it is that the loudest report
("EVERY seat instruction") was the read artefact and the real damage was two files nobody
had complained about.

## Impact

A corrupted seat instruction is worse than a red suite: every seat reasons from a damaged
rule and nothing reports it. Corrupted docs send the next reader down a dead end. The same
round trip also drops a UTF-8 BOM onto the file, which breaks byte-compared mirrors
(`constitution.txt` / the rigs' `constitutionInline`). A FALSE report costs too: chasing a
read artefact burns a seat's session and risks "repairing" healthy files.

## Preconditions

Read-only until the `Do` step that writes. No broker involvement: these are source files.
Work in your item's worktree, never the shared tree.

## Diagnose (read-only)

Decide artefact vs. corruption with a byte-accurate reader — never with the shell that
shows the symptom.

```bash
# 1. Byte-accurate report: 0 = the file is clean, 1 = it really is damaged.
node scripts/fix-mojibake.mjs rig.selfdev.json rig.starter.json constitution.txt AGENTS.md

# 2. The guard over the whole seat-facing surface (rig specs, constitution, skills, runbooks).
node demo/seat-instruction-encoding.test.mjs

# 3. The read-artefact check: the SAME file through a codepage-dependent reader.
#    PowerShell 5.1 prints garbage here and the correct text with -Encoding UTF8.
powershell -NoProfile -Command "(Get-Content .gitattributes)[0]; (Get-Content -Encoding UTF8 .gitattributes)[0]"
```

If (1) reports `clean` and (3) shows two different renderings, the text on disk is fine:
the reporter's read path is the defect. Say so with the command output; do not "fix" a
clean file.

To reproduce the write path itself (this is how the corruption is made, not a repair):

```bash
# PS 5.1: ANSI read + UTF-8 write -> the file now STORES U+00E2 U+20AC U+201D. Never do this.
powershell -NoProfile -Command "Get-Content src.txt | Set-Content -Encoding UTF8 out.txt"
```

## Do

1. Repair the damaged files (explicit `--write`; the report run is a check and exits 1):

   ```bash
   node scripts/fix-mojibake.mjs --write <file...>
   ```

2. Confirm the repair is idempotent and the guard is green:

   ```bash
   node scripts/fix-mojibake.mjs <file...>          # expect "clean", exit 0
   node demo/seat-instruction-encoding.test.mjs      # expect PASS, exit 0
   ```

3. If the repair left a BOM (first three bytes EF BB BF), strip it — the guard checks for it.

4. Stop the source. In your own shell, read and write UTF-8 explicitly:
   `Get-Content -Encoding UTF8` / `Set-Content -Encoding UTF8`, or prefer `node -e` with
   `readFileSync(f, "utf8")` / `writeFileSync(f, s, "utf8")`. An unqualified read piped into
   a UTF-8 write is exactly the defect.

5. A corrupted **store** (a seat's transcript or instruction copy) is not repaired here: the
   store is broker-owned, single-writer. Fix the source file, then refresh the rig
   (`node cli.mjs up rig.selfdev.json --refresh`) so the seats are re-woken with clean text.

## Verify

```bash
node demo/seat-instruction-encoding.test.mjs
```

Expected: `PASS — N seat-facing file(s) clean UTF-8, no mojibake, detector proven to fire`,
exit 0. The demo also self-tests the detector (it must flag the classic pattern and decode
it back), so a green run cannot be vacuous. To watch it bite, point it at a damaged copy:

```bash
node demo/seat-instruction-encoding.test.mjs   # with DURIG_ENCODING_EXTRA=<damaged file> -> exit 1
```

## If it fails

A `no mojibake` FAIL names the file and the exact sequence: re-run
`node scripts/fix-mojibake.mjs --write <that file>`, then re-verify. A `no BOM` FAIL means a
PowerShell round trip touched the file — strip the BOM and find out which edit did it. If the
repair would change text that is meant to *illustrate* the corruption (a doc quoting the
garbage on purpose), do not run the fixer on it: it is outside the guarded surface by design.

## Escalate to

`pm` when the corruption reached a store or a landed commit on `main` (needs a refresh or a
revert decision); `architect` if a *tool* in this repo — not a seat's shell — is the writer.

## Evidence

#3241 (2026-10-20): the repair and the guard; `demo/seat-instruction-encoding.test.mjs`
green over 44 seat-facing files; `scripts/fix-mojibake.mjs` decoded 14 sequences in
`docs/runbooks/README.md` and `docs/reviews/docs-gap-audit-2026-10-17.md` and reported 0 on
re-run. The seat instruction sources were already clean — the reported corruption of "every
seat instruction" was the PowerShell read artefact, reproduced above.

#3316 (lead ruling, 2026-10-20): this runbook must carry the CORRECTED diagnosis, in this
order — (a) read artefact vs landed corruption are different failures, (b) the byte scan is
what separates them, (c) never round-trip through the PS 5.1 defaults, (d) the observed
blast radius above so the next reader calibrates instead of assuming repo-wide damage. A
runbook with the wrong root cause is worse than none: it turns a five-minute diagnosis into
a repair of files that were never broken. The premise correction is the lead's to own; the
wrong shape was never written into this file.
